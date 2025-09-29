import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import { load } from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4000;
const DATA_DIR = path.join(__dirname, '..', 'data');
const TITLE_NUMBER = 15;
const PART_NUMBER = '774';
const ECFR_BASE = 'https://www.ecfr.gov/api/versioner/v1';
const USER_AGENT = 'ccl-trade-app/1.0 (+https://github.com)';

const app = express();
app.use(express.json({ limit: '2mb' }));

const loadingVersions = new Map();
let defaultVersionPromise = null;

app.get('/api/versions', async (req, res) => {
  try {
    const files = await ensureDataDirAndList();
    const versions = await Promise.all(
      files.map(async (file) => {
        const fullPath = path.join(DATA_DIR, file);
        try {
          const raw = await fs.readFile(fullPath, 'utf-8');
          const json = JSON.parse(raw);
          return {
            date: json.date,
            fetchedAt: json.fetchedAt,
            sourceUrl: json.sourceUrl,
            counts: json.counts,
          };
        } catch (err) {
          console.error('Failed to read stored version', file, err.message);
          return null;
        }
      })
    );

    const defaultDate = await getDefaultDate();
    res.json({
      defaultDate,
      versions: versions.filter(Boolean).sort((a, b) => (a.date < b.date ? 1 : -1)),
    });
  } catch (error) {
    console.error('Error listing versions', error);
    res.status(500).json({ message: 'Failed to list versions', error: error.message });
  }
});

app.get('/api/ccl', async (req, res) => {
  const date = req.query.date || (await getDefaultDateSafe(res));
  if (!date) {
    return;
  }

  try {
    const data = await loadVersion(date);
    res.json(data);
  } catch (error) {
    console.error('Error loading version', date, error);
    res.status(500).json({ message: `Failed to load CCL for ${date}`, error: error.message });
  }
});

app.post('/api/ccl/refresh', async (req, res) => {
  const { date, force } = req.body || {};
  const targetDate = date || (await getDefaultDateSafe(res));
  if (!targetDate) {
    return;
  }

  try {
    const data = await loadVersion(targetDate, { force: force !== false });
    res.json({
      message: `Refreshed CCL data for ${targetDate}`,
      data,
    });
  } catch (error) {
    console.error('Error refreshing version', targetDate, error);
    res.status(500).json({ message: `Failed to refresh CCL for ${targetDate}`, error: error.message });
  }
});

// Serve built client assets if they exist
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', async (req, res, next) => {
  try {
    const indexPath = path.join(clientDist, 'index.html');
    await fs.access(indexPath);
    res.sendFile(indexPath);
  } catch (error) {
    next();
  }
});

startServer();

async function startServer() {
  try {
    await ensureDataDir();
    const defaultDate = await getDefaultDate();
    if (defaultDate) {
      await loadVersion(defaultDate).catch((err) => {
        console.error('Failed to preload default version', err.message);
      });
    }
  } catch (error) {
    console.error('Initialization failed', error);
  }

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to ensure data directory', error);
    throw error;
  }
}

async function ensureDataDirAndList() {
  await ensureDataDir();
  const files = await fs.readdir(DATA_DIR);
  return files.filter((file) => file.startsWith('ccl-') && file.endsWith('.json'));
}

async function getDefaultDate() {
  if (!defaultVersionPromise) {
    defaultVersionPromise = (async () => {
      const url = `${ECFR_BASE}/titles?format=json`;
      const response = await fetch(url, {
        headers: buildHeaders('application/json'),
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch titles metadata: ${response.status} ${response.statusText}`);
      }
      const json = await response.json();
      const title = (json.titles || []).find((entry) => Number(entry.number) === TITLE_NUMBER);
      if (!title) {
        throw new Error(`Title ${TITLE_NUMBER} metadata not found in response`);
      }
      return title.up_to_date_as_of;
    })();
  }

  try {
    return await defaultVersionPromise;
  } catch (error) {
    defaultVersionPromise = null;
    console.error('Failed to determine default date', error.message);
    throw error;
  }
}

async function getDefaultDateSafe(res) {
  try {
    const date = await getDefaultDate();
    return date;
  } catch (error) {
    res.status(500).json({ message: 'Unable to determine default CCL version', error: error.message });
    return null;
  }
}

async function loadVersion(date, { force = false } = {}) {
  if (!date) {
    throw new Error('A version date (YYYY-MM-DD) is required');
  }

  if (!force) {
    const cached = await readVersionFromDisk(date);
    if (cached) {
      return cached;
    }
  }

  if (loadingVersions.has(date)) {
    return loadingVersions.get(date);
  }

  const promise = (async () => {
    try {
      const parsed = await fetchAndParseCcl(date);
      const stored = await persistVersion(date, parsed);
      return stored;
    } finally {
      loadingVersions.delete(date);
    }
  })();

  loadingVersions.set(date, promise);
  return promise;
}

async function readVersionFromDisk(date) {
  const filePath = path.join(DATA_DIR, buildFileName(date));
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Failed to read cached version for ${date}:`, error.message);
    }
    return null;
  }
}

async function persistVersion(date, data) {
  const filePath = path.join(DATA_DIR, buildFileName(date));
  const enriched = {
    ...data,
    date,
    fetchedAt: new Date().toISOString(),
  };
  await fs.writeFile(filePath, JSON.stringify(enriched, null, 2), 'utf-8');
  return enriched;
}

function buildFileName(date) {
  return `ccl-${date}.json`;
}

async function fetchAndParseCcl(date) {
  const url = `${ECFR_BASE}/full/${date}/title-${TITLE_NUMBER}?format=xml`;
  const response = await fetch(url, {
    headers: buildHeaders('application/xml'),
  });
  if (!response.ok) {
    const body = await safeReadBody(response);
    throw new Error(`Failed to download CCL data (${response.status} ${response.statusText}): ${body}`);
  }

  const xml = await response.text();
  const parsed = parsePart(xml);
  return {
    version: date,
    sourceUrl: url,
    counts: {
      totalNodes: countNodes(parsed),
    },
    part: parsed,
  };
}

async function safeReadBody(response) {
  try {
    return await response.text();
  } catch (error) {
    return '<unavailable>';
  }
}

function buildHeaders(accept) {
  return {
    Accept: accept,
    'User-Agent': USER_AGENT,
  };
}

function parsePart(xml) {
  const $ = load(xml, { xmlMode: true, decodeEntities: true });
  const part = $('DIV5[TYPE="PART"][N="774"]').first();
  if (!part.length) {
    throw new Error(`Part ${PART_NUMBER} not found in the downloaded title data`);
  }

  return parseDiv($, part, { includeAttrs: true });
}

function parseDiv($, element, options = {}) {
  const node = {
    type: element.attr('TYPE') || element[0].name,
    identifier: element.attr('N') || null,
    heading: extractHeading($, element),
    attributes: options.includeAttrs ? { ...element.attr() } : undefined,
    content: [],
    children: [],
  };

  element.contents().each((_, rawChild) => {
    if (rawChild.type === 'text') {
      const text = rawChild.data.trim();
      if (text) {
        node.content.push({ tag: '#text', text });
      }
      return;
    }

    const child = $(rawChild);
    const tagName = rawChild.name ? rawChild.name.toUpperCase() : '#UNKNOWN';

    if (tagName === 'HEAD') {
      return;
    }

    if (/^DIV\d+$/.test(tagName)) {
      node.children.push(parseDiv($, child));
      return;
    }

    const html = normalizeHtml($, rawChild);
    const text = child.text().replace(/\s+/g, ' ').trim();
    const entry = {
      tag: tagName,
      html,
    };
    if (text) {
      entry.text = text;
    }
    const idAttr = child.attr('ID');
    if (idAttr) {
      entry.id = idAttr;
    }
    node.content.push(entry);
  });

  if (node.content.length === 0) {
    delete node.content;
  }
  if (node.children.length === 0) {
    delete node.children;
  }
  if (!node.attributes) {
    delete node.attributes;
  }
  if (!node.heading) {
    delete node.heading;
  }
  if (!node.identifier) {
    delete node.identifier;
  }

  return node;
}

function extractHeading($, element) {
  const head = element.children('HEAD').first();
  if (!head.length) {
    return null;
  }
  return head.text().replace(/\s+/g, ' ').trim();
}

function normalizeHtml($, node) {
  return $.html(node, { decodeEntities: false }).trim();
}

function countNodes(node) {
  if (!node) return 0;
  const childCount = (node.children || []).reduce((acc, child) => acc + countNodes(child), 0);
  return 1 + childCount;
}

