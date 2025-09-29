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
    counts: parsed.counts,
    supplements: parsed.supplements,
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

const TARGET_SUPPLEMENTS = new Set(['1', '5', '6', '7']);
const ECCN_CODE_CAPTURE_PATTERN = /([0-9][A-Z][0-9]{3})/;

function parsePart(xml) {
  const $ = load(xml, { xmlMode: true, decodeEntities: true });
  const part = $('DIV5[TYPE="PART"][N="774"]').first();
  if (!part.length) {
    throw new Error(`Part ${PART_NUMBER} not found in the downloaded title data`);
  }

  const supplements = [];

  part.find('DIV8[TYPE="SUPPLEMENT"]').each((_, rawSupplement) => {
    const supplementEl = $(rawSupplement);
    const heading = extractHeading($, supplementEl);
    const number = determineSupplementNumber(supplementEl, heading);
    if (!number || !TARGET_SUPPLEMENTS.has(number)) {
      return;
    }

    supplements.push(parseSupplement($, supplementEl, number, heading));
  });

  const counts = {
    supplements: supplements.length,
    eccns: supplements.reduce((sum, supplement) => sum + supplement.eccns.length, 0),
  };

  return { supplements, counts };
}

function determineSupplementNumber(element, headingText) {
  const sources = [element.attr('N'), headingText];
  for (const source of sources) {
    if (!source) continue;
    const normalized = String(source);
    const match = normalized.match(/Supplement\s+No\.?\s*(\d+)/i);
    if (match) {
      return match[1];
    }
    const fallback = normalized.match(/(?:^|[^\d])([1567])(?:[^\d]|$)/);
    if (fallback) {
      return fallback[1];
    }
  }
  return null;
}

function parseSupplement($, supplementEl, number, heading) {
  const eccnElements = [];
  const seen = new Set();

  supplementEl.find('[N]').each((_, raw) => {
    if (!raw.name) {
      return;
    }
    const tagName = raw.name.toUpperCase();
    if (!/^DIV\d+$/.test(tagName)) {
      return;
    }

    const el = $(raw);
    const candidate = extractEccnCandidate($, el);
    if (!candidate) {
      return;
    }
    if (seen.has(candidate.eccn)) {
      return;
    }
    seen.add(candidate.eccn);
    eccnElements.push(candidate);
  });

  eccnElements.sort((a, b) => compareIdentifiers(a.eccn, b.eccn));

  const eccns = eccnElements.map((entry) =>
    parseEccn($, entry.element, supplementEl, { eccn: entry.eccn, identifier: entry.identifier })
  );

  const categoryCounts = eccns.reduce((acc, entry) => {
    const key = entry.category || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    number,
    heading: heading || null,
    eccns,
    metadata: {
      eccnCount: eccns.length,
      categoryCounts,
    },
  };
}

function extractEccnCandidate($, element) {
  const identifier = (element.attr('N') || '').trim();
  const identifierMatch = findEccnInIdentifier(identifier);
  const heading = extractHeading($, element);
  const headingMatch = findEccnInHeading(heading);

  const match = identifierMatch || headingMatch;
  if (!match) {
    return null;
  }

  return {
    eccn: match.code,
    identifier: identifier || null,
    element,
  };
}

function findEccnInIdentifier(identifier) {
  if (!identifier) {
    return null;
  }

  const match = identifier.match(ECCN_CODE_CAPTURE_PATTERN);
  if (!match) {
    return null;
  }

  const code = match[1];
  const suffix = identifier.slice(match.index + code.length);
  if (/[A-Z0-9]/i.test(suffix)) {
    return null;
  }

  return { code };
}

function findEccnInHeading(heading) {
  if (!heading) {
    return null;
  }

  const match = heading.match(/^(?:ECCN\s+)?([0-9][A-Z][0-9]{3})\b/);
  if (!match) {
    return null;
  }

  return { code: match[1] };
}

function parseEccn($, element, supplementEl, context = {}) {
  const eccn = context.eccn || (element.attr('N') || '').trim() || null;
  const heading = extractHeading($, element);
  const title = deriveEccnTitle(eccn, heading);
  const breadcrumbs = collectBreadcrumbs($, element, supplementEl);
  const baseIdentifier = pickBaseIdentifier(context.identifier, eccn);
  const structure = parseEccnNode($, element, baseIdentifier);

  return {
    eccn,
    heading: heading || null,
    title,
    category: eccn ? eccn.charAt(0) : null,
    group: eccn ? eccn.slice(0, 2) : null,
    breadcrumbs,
    structure,
  };
}

function pickBaseIdentifier(identifier, eccn) {
  const normalized = (identifier || '').trim();
  if (!normalized) {
    return eccn || null;
  }
  if (!eccn) {
    return normalized;
  }

  const containsEccn = normalized.toUpperCase().includes(eccn.toUpperCase());
  return containsEccn ? normalized : eccn;
}

function deriveEccnTitle(eccn, heading) {
  if (!heading) {
    return null;
  }
  const normalizedHeading = heading.replace(/\s+/g, ' ').trim();
  if (!normalizedHeading) {
    return null;
  }
  const regex = new RegExp(`^(${eccn}|ECCN\s+${eccn})\s*[-–—]?\s*`, 'i');
  return normalizedHeading.replace(regex, '').trim() || null;
}

function collectBreadcrumbs($, element, stopAt) {
  const crumbs = [];
  let current = element.parent();
  while (current && current.length && current[0] !== stopAt[0]) {
    if (current[0].type === 'tag') {
      const heading = extractHeading($, current);
      if (heading) {
        crumbs.push(heading);
      }
    }
    current = current.parent();
  }
  return crumbs.reverse();
}

function parseEccnNode($, element, baseIdentifier) {
  const identifier = (element.attr('N') || baseIdentifier || '').trim();
  const heading = extractHeading($, element);
  const node = {
    identifier: identifier || null,
    label: deriveNodeLabel(identifier, baseIdentifier),
    heading: heading || null,
    content: [],
    children: [],
  };

  element.contents().each((_, rawChild) => {
    if (rawChild.type === 'text') {
      const text = rawChild.data.trim();
      if (text) {
        node.content.push({ type: 'text', text });
      }
      return;
    }

    const child = $(rawChild);
    const tagName = rawChild.name ? rawChild.name.toUpperCase() : '#UNKNOWN';

    if (tagName === 'HEAD') {
      return;
    }

    if (/^DIV\d+$/.test(tagName)) {
      const childIdentifier = (child.attr('N') || '').trim();
      if (isDescendantIdentifier(childIdentifier, baseIdentifier)) {
        node.children.push(parseEccnNode($, child, baseIdentifier));
        return;
      }
    }

    const html = normalizeHtml($, rawChild);
    if (!html) {
      return;
    }
    const text = child.text().replace(/\s+/g, ' ').trim();
    const idAttr = child.attr('ID') || null;
    node.content.push({
      type: 'html',
      tag: tagName,
      html,
      text: text || null,
      id: idAttr,
    });
  });

  if (node.content.length === 0) {
    delete node.content;
  }
  if (node.children.length === 0) {
    delete node.children;
  }
  if (!node.heading) {
    delete node.heading;
  }
  if (!node.identifier) {
    delete node.identifier;
  }
  if (!node.label) {
    delete node.label;
  }

  return node;
}

function deriveNodeLabel(identifier, baseIdentifier) {
  if (!identifier || !baseIdentifier) {
    return null;
  }
  if (identifier === baseIdentifier) {
    return baseIdentifier;
  }
  const remainder = identifier.slice(baseIdentifier.length);
  return remainder.replace(/^\./, '') || null;
}

function isDescendantIdentifier(identifier, base) {
  if (!identifier || !base) {
    return false;
  }
  if (identifier === base) {
    return true;
  }
  if (!identifier.startsWith(base)) {
    return false;
  }
  const remainder = identifier.slice(base.length);
  return /^([.][\w-]+)+$/.test(remainder);
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

function compareIdentifiers(a, b) {
  const valueA = (a || '').toString();
  const valueB = (b || '').toString();
  if (valueA < valueB) return -1;
  if (valueA > valueB) return 1;
  return 0;
}

