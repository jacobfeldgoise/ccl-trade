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

if (process.env.CCL_SKIP_SERVER !== 'true') {
  startServer();
}

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
const ECCN_HEADING_PATTERN = /^([0-9][A-Z][0-9]{3})(?=$|[\s.\-–—:;(\[])/;
const ALL_OF_FOLLOWING_PATTERN = /\ball of the following\b/i;

function parsePart(xml) {
  const $ = load(xml, { xmlMode: true, decodeEntities: true });
  const part = $('DIV5[TYPE="PART"][N="774"]').first();
  if (!part.length) {
    throw new Error(`Part ${PART_NUMBER} not found in the downloaded title data`);
  }

  const supplements = [];

  part.children().each((_, rawChild) => {
    if (!rawChild.name || !/^DIV\d+$/i.test(rawChild.name)) {
      return;
    }

    const supplementEl = $(rawChild);
    const typeAttr = (supplementEl.attr('TYPE') || '').toUpperCase();
    if (typeAttr !== 'SUPPLEMENT' && typeAttr !== 'APPENDIX') {
      return;
    }

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
  const parser = SUPPLEMENT_PARSERS[number] || parseSupplementOne;
  return parser($, supplementEl, number, heading);
}

const SUPPLEMENT_PARSERS = {
  '1': parseSupplementOne,
  '5': parseSupplementFive,
  '6': parseSupplementSix,
  '7': parseSupplementSeven,
};

function createEccnEntries($, { code, heading, nodes, content, breadcrumbs, supplement }) {
  const tree = nodes
    ? buildEccnTreeFromNodes($, nodes, { code, heading })
    : buildEccnTreeFromContent({ code, heading, content: content || [] });

  return flattenEccnTree(tree, { code, heading, breadcrumbs, supplement });
}

function buildEccnTreeFromContent({ code, heading, content }) {
  const root = createTreeNode({
    identifier: code,
    heading: heading || null,
    path: [],
    parent: null,
  });

  if (Array.isArray(content)) {
    for (const block of content) {
      if (block) {
        root.content.push(block);
        if (block?.text) {
          markNodeRequiresAllChildren(root, block.text);
        }
      }
    }
  }

  return root;
}

function buildEccnTreeFromNodes($, nodes, { code, heading }) {
  const root = createTreeNode({
    identifier: code,
    heading: heading || null,
    path: [],
    parent: null,
  });
  const nodeMap = new Map();
  nodeMap.set('', root);

  let lastPath = [];

  const pathBearingTags = new Set(['P', 'LI']);
  const nonRecursiveCaptureTags = new Set(['NOTE']);
  const contentTags = new Set(['P', 'LI', 'NOTE', 'TABLE', 'UL', 'OL', 'DL']);

  const processBlock = (node, { allowPath }) => {
    const block = buildContentBlock($, node);
    if (!block) {
      return;
    }

    let pathTokens = null;
    if (allowPath) {
      pathTokens = derivePathFromNode($, node, code, block, lastPath);
    }

    const targetTokens = Array.isArray(pathTokens)
      ? pathTokens
      : Array.isArray(lastPath)
      ? lastPath
      : [];
    const targetNode = ensureTreeNode({
      root,
      map: nodeMap,
      baseCode: code,
      pathTokens: Array.isArray(targetTokens) ? targetTokens : [],
    });

    if (targetNode !== root) {
      const headingCandidate = deriveParagraphHeadingFromBlock(node, block, targetNode.identifier);
      if (headingCandidate) {
        if (shouldAdoptHeading(targetNode.heading, headingCandidate, targetNode.identifier)) {
          targetNode.heading = headingCandidate;
        }
        markNodeRequiresAllChildren(targetNode, headingCandidate);
      }
    }

    targetNode.content.push(block);
    markNodeRequiresAllChildrenFromBlock(targetNode, block);

    if (Array.isArray(pathTokens)) {
      lastPath = pathTokens.slice();
    }
  };

  const traverse = (node) => {
    if (!node) {
      return;
    }

    if (node.type === 'text') {
      const text = (node.data || '').trim();
      if (!text) {
        return;
      }
      const targetNode = ensureTreeNode({
        root,
        map: nodeMap,
        baseCode: code,
        pathTokens: Array.isArray(lastPath) ? lastPath : [],
      });
      targetNode.content.push({ type: 'text', text });
      markNodeRequiresAllChildren(targetNode, text);
      return;
    }

    if (node.type !== 'tag') {
      return;
    }

    const tagName = node.name ? node.name.toUpperCase() : '';
    const allowPath = pathBearingTags.has(tagName) || hasEccnId($, node, code);
    const shouldCapture = contentTags.has(tagName) || allowPath || tagName.startsWith('HD');

    if (shouldCapture) {
      processBlock(node, { allowPath });

      if (pathBearingTags.has(tagName) || nonRecursiveCaptureTags.has(tagName)) {
        return;
      }
    }

    const element = $(node);
    const children = element.contents().toArray();
    for (const child of children) {
      traverse(child);
    }
  };

  for (const rawNode of nodes) {
    traverse(rawNode);
  }

  refreshRequireAllChildrenFlags(root);

  return root;
}

function ensureTreeNode({ root, map, baseCode, pathTokens }) {
  if (!pathTokens.length) {
    return root;
  }

  let current = root;
  const keyParts = [];

  for (const token of pathTokens) {
    keyParts.push(token);
    const key = keyParts.join('.');
    let child = map.get(key);
    if (!child) {
      child = createTreeNode({
        identifier: `${baseCode}.${key}`,
        heading: null,
        path: keyParts.slice(),
        parent: current,
      });
      map.set(key, child);
      current.children.push(child);
    }
    current = child;
  }

  return current;
}

function hasEccnId($, node, baseCode) {
  if (!node || node.type !== 'tag') {
    return false;
  }

  const element = $(node);
  const idAttr = element.attr('ID') || element.attr('id');
  if (!idAttr) {
    return false;
  }

  const tokens = extractPathTokensFromId(idAttr, baseCode);
  return Array.isArray(tokens);
}

function derivePathFromNode($, node, baseCode, block, lastPath) {
  if (!node || node.type === 'text') {
    return null;
  }

  const element = $(node);
  const idAttr = element.attr('ID') || element.attr('id');
  const fromId = extractPathTokensFromId(idAttr, baseCode);
  if (fromId) {
    return fromId;
  }

  const compound = extractCompoundEnumeratorTokens(block?.text);
  if (compound) {
    return compound;
  }

  const enumerator = extractEnumeratorFromBlock(block);
  if (enumerator) {
    const { token, type } = enumerator;
    const level = determineEnumeratorLevel(type);
    if (level) {
      const normalized = normalizeEnumeratorToken(token, type);
      const trimmedText = block?.text ? String(block.text).trim() : '';
      let derived = buildPathForEnumerator(normalized, level, lastPath);

      if (type === 'roman' && /^[a-z]$/i.test(token) && !trimmedText.startsWith('(')) {
        if (!derived || derived[0] !== normalized) {
          return [normalized];
        }
      }

      if (!derived && type === 'roman' && /^[a-z]$/i.test(token)) {
        derived = buildPathForEnumerator(normalized, 1, lastPath);
      }

      if (derived) {
        return derived;
      }
    }
  }

  const fromText = extractPathTokensFromText(block?.text, baseCode);
  if (fromText) {
    return fromText;
  }

  return null;
}

function extractPathTokensFromId(id, baseCode) {
  if (!id || !baseCode) {
    return null;
  }

  const normalizedId = String(id).toLowerCase();
  const normalizedCode = String(baseCode).toLowerCase().replace(/[^a-z0-9]/g, '');
  const index = normalizedId.lastIndexOf(normalizedCode);
  if (index === -1) {
    return null;
  }

  let suffix = normalizedId.slice(index + normalizedCode.length);
  if (!suffix) {
    return [];
  }

  suffix = suffix.replace(/[^a-z0-9]+/g, '');
  if (!suffix || /^note\d*/.test(suffix)) {
    return null;
  }

  const tokens = [];
  let current = '';
  let currentType = '';

  for (const char of suffix) {
    const type = /[0-9]/.test(char) ? 'digit' : 'letter';
    if (current && type !== currentType) {
      tokens.push(current);
      current = '';
    }
    current += char;
    currentType = type;
  }

  if (current) {
    tokens.push(current);
  }

  const filtered = tokens.filter((token) => !/^note\d*$/i.test(token));
  if (!filtered.length) {
    return null;
  }

  return filtered;
}

function extractPathTokensFromText(text, baseCode) {
  if (!text || !baseCode) {
    return null;
  }

  const normalizedBase = String(baseCode).trim();
  if (!normalizedBase) {
    return null;
  }

  const normalizedText = String(text);
  const lowerText = normalizedText.toLowerCase();
  const lowerBase = normalizedBase.toLowerCase();

  let index = lowerText.indexOf(lowerBase);
  while (index !== -1) {
    const beforeChar = index > 0 ? lowerText.charAt(index - 1) : '';
    if (!beforeChar || /[^a-z0-9]/i.test(beforeChar)) {
      break;
    }
    index = lowerText.indexOf(lowerBase, index + 1);
  }

  if (index === -1) {
    return null;
  }

  const MAX_OFFSET_FOR_DIRECT_CODE = 5;
  if (index > MAX_OFFSET_FOR_DIRECT_CODE) {
    return null;
  }

  const suffix = normalizedText
    .slice(index + normalizedBase.length)
    .replace(/^[^A-Za-z0-9]+/, '');

  if (!suffix) {
    return null;
  }

  const tokens = [];

  for (const rawPart of suffix.split('.')) {
    const part = rawPart.trim();
    if (!part) {
      continue;
    }

    const type = classifyEnumeratorToken(part);
    if (!type) {
      return null;
    }

    tokens.push(normalizeEnumeratorToken(part, type));
  }

  return tokens.length ? tokens : null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractEnumeratorFromBlock(block) {
  if (!block) {
    return null;
  }

  if (block.type === 'text') {
    return extractEnumeratorFromText(block.text);
  }

  const text = block.text || null;
  return extractEnumeratorFromText(text);
}

function extractEnumeratorFromText(text) {
  if (!text) {
    return null;
  }

  const normalized = String(text).replace(/^\s+/, '');
  if (!normalized) {
    return null;
  }

  const compound = extractCompoundEnumeratorTokens(normalized);
  if (compound) {
    return {
      token: compound[compound.length - 1],
      type: classifyEnumeratorToken(compound[compound.length - 1]),
    };
  }

  const patterns = [
    /^\(([ivxlcdm]{1,6})\)/i,
    /^\(([a-z]{1,2})\)/i,
    /^\(([0-9]{1,3})\)/,
    /^([ivxlcdm]{1,6})[).\-–—]/i,
    /^([a-z]{1,2})[).\-–—]/i,
    /^([0-9]{1,3})[).\-–—]/,
    /^([A-Z]{1,2})[).\-–—]/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      const token = match[1];
      const type = classifyEnumeratorToken(token);
      if (type) {
        return { token, type };
      }
    }
  }

  return null;
}

function classifyEnumeratorToken(token) {
  if (!token) {
    return null;
  }

  const raw = String(token);
  const lower = raw.toLowerCase();

  if (/^[0-9]{1,3}$/.test(raw)) {
    return 'digit';
  }

  if (/^[ivxlcdm]{1,6}$/.test(lower)) {
    return 'roman';
  }

  if (/^[A-Z]{1,2}$/.test(raw)) {
    return 'upper';
  }

  if (/^[a-z]{1,2}$/.test(lower)) {
    return 'letter';
  }

  return null;
}

function determineEnumeratorLevel(type) {
  switch (type) {
    case 'letter':
      return 1;
    case 'digit':
      return 2;
    case 'roman':
      return 3;
    case 'upper':
      return 4;
    default:
      return null;
  }
}

function normalizeEnumeratorToken(token, type) {
  if (!token) {
    return token;
  }

  if (type === 'digit') {
    return String(token).replace(/^0+/, '') || '0';
  }

  return String(token).toLowerCase();
}

function extractCompoundEnumeratorTokens(text) {
  if (!text) {
    return null;
  }

  const normalized = String(text).replace(/^\s+/, '');
  if (!normalized) {
    return null;
  }

  const pattern = /^([A-Za-z0-9]{1,4}(?:\.[A-Za-z0-9]{1,4})+)(?:[).,;:\s\-–—]|$)/;
  const match = normalized.match(pattern);
  if (!match) {
    return null;
  }

  const rawTokens = match[1].split('.');
  if (rawTokens.length < 2) {
    return null;
  }

  const tokens = [];

  for (const rawToken of rawTokens) {
    const type = classifyEnumeratorToken(rawToken);
    if (!type) {
      return null;
    }
    tokens.push(normalizeEnumeratorToken(rawToken, type));
  }

  return tokens;
}

function buildPathForEnumerator(token, level, lastPath) {
  if (!token || !level) {
    return null;
  }

  const base = Array.isArray(lastPath) ? lastPath.slice(0, level - 1) : [];
  if (level > 1 && base.length < level - 1) {
    return null;
  }

  base[level - 1] = token;
  return base;
}

function deriveParagraphHeadingFromBlock(node, block, identifier) {
  const textSource = block?.text || (node && node.type === 'text' ? node.data : null);
  if (!textSource) {
    return null;
  }

  const stripped = stripLeadingEnumerators(String(textSource));
  if (!stripped) {
    return null;
  }

  if (identifier) {
    const withoutCode = deriveEccnTitle(identifier, stripped);
    if (withoutCode) {
      return withoutCode;
    }
  }

  return stripped || null;
}

function shouldAdoptHeading(currentHeading, candidateHeading, identifier) {
  if (!candidateHeading) {
    return false;
  }

  if (!currentHeading) {
    return true;
  }

  const current = normalizeHeadingValue(currentHeading);
  const candidate = normalizeHeadingValue(candidateHeading);
  if (!candidate) {
    return false;
  }

  if (!current) {
    return true;
  }

  const currentLooksLikeIdentifier = isIdentifierLikeHeading(current, identifier);
  const candidateLooksLikeIdentifier = isIdentifierLikeHeading(candidate, identifier);

  if (currentLooksLikeIdentifier && !candidateLooksLikeIdentifier) {
    return true;
  }

  if (!currentLooksLikeIdentifier && candidateLooksLikeIdentifier) {
    return false;
  }

  if (currentLooksLikeIdentifier && candidateLooksLikeIdentifier) {
    return candidate.length > current.length;
  }

  const currentWordCount = current.split(/\s+/).filter(Boolean).length;
  const candidateWordCount = candidate.split(/\s+/).filter(Boolean).length;

  if (candidateWordCount > currentWordCount) {
    return true;
  }

  if (candidate.length > current.length + 10) {
    return true;
  }

  return false;
}

function normalizeHeadingValue(value) {
  if (!value) {
    return '';
  }
  return String(value).replace(/\s+/g, ' ').trim();
}

function isIdentifierLikeHeading(heading, identifier) {
  if (!heading) {
    return true;
  }

  const normalizedHeading = heading.replace(/\s+/g, ' ').trim();
  if (!normalizedHeading) {
    return true;
  }

  if (/^[(\[]?[a-z0-9]{1,4}[)\].-]?$/.test(normalizedHeading)) {
    return true;
  }

  const headingComparable = normalizeIdentifierForComparison(normalizedHeading);
  if (!headingComparable) {
    return true;
  }

  const identifierComparable = normalizeIdentifierForComparison(identifier);
  if (identifierComparable && headingComparable === identifierComparable) {
    return true;
  }

  return false;
}

function normalizeIdentifierForComparison(value) {
  if (!value) {
    return '';
  }
  return String(value)
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();
}

function stripLeadingEnumerators(text) {
  if (!text) {
    return '';
  }

  let working = text.replace(/\s+/g, ' ').trim();
  if (!working) {
    return '';
  }

  let changed = false;
  do {
    changed = false;
    const match = working.match(/^\(([a-z0-9]{1,4}|[ivxlcdm]{1,5})\)[-\s\u2013\u2014:;.,]*/i);
    if (match) {
      const candidate = working.slice(match[0].length).trim();
      if (candidate) {
        working = candidate;
        changed = true;
        continue;
      }
    }

    const dotMatch = working.match(/^([a-z0-9]{1,4})\.[-\s\u2013\u2014:;.,]*/i);
    if (dotMatch) {
      const candidate = working.slice(dotMatch[0].length).trim();
      if (candidate) {
        working = candidate;
        changed = true;
      }
    }
  } while (changed);

  return working.trim();
}

function flattenEccnTree(root, { code, heading, breadcrumbs, supplement }) {
  const entries = [];
  const category = code ? code.charAt(0) : null;
  const group = code ? code.slice(0, 2) : null;

  const visit = (node, suppressedDueToAncestor) => {
    const parent = node.parent;
    const isRoot = node === root;
    const parentRequiresAll = parent ? parent.requireAllChildren : false;
    const suppressed = Boolean(suppressedDueToAncestor || parentRequiresAll);

    node.boundToParent = Boolean(suppressedDueToAncestor);

    node.isEccn = true;

    let entry = null;
    if (!suppressed) {
      const nodeHeading = isRoot ? heading || node.heading : node.heading || null;
      entry = {
        eccn: node.identifier,
        heading: nodeHeading,
        title: isRoot ? deriveEccnTitle(code, nodeHeading) : nodeHeading,
        category,
        group,
        breadcrumbs: buildNodeBreadcrumbs(node, root, breadcrumbs || []),
        supplement,
        structure: null,
        parentEccn: parent ? parent.identifier : null,
        childEccns: [],
      };

      entries.push(entry);
    }

    const childSuppression = suppressed || node.requireAllChildren;

    for (const child of node.children) {
      const childProducesEntry = visit(child, childSuppression);
      if (entry && childProducesEntry) {
        entry.childEccns.push(child.identifier);
      }
    }

    if (entry) {
      entry.structure = convertTreeNodeToStructure(node);
    }

    return Boolean(entry);
  };

  visit(root, false);
  return entries;
}

function markNodeRequiresAllChildren(node, text) {
  if (!node || node.requireAllChildren || !text) {
    return;
  }

  if (ALL_OF_FOLLOWING_PATTERN.test(text)) {
    node.requireAllChildren = true;
  }
}

function markNodeRequiresAllChildrenFromBlock(node, block) {
  if (!node || !block) {
    return;
  }

  if (block.text) {
    markNodeRequiresAllChildren(node, block.text);
    return;
  }

  if (block.html) {
    const stripped = block.html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&');
    markNodeRequiresAllChildren(node, stripped);
  }
}

function refreshRequireAllChildrenFlags(node) {
  if (!node) {
    return;
  }

  if (node.heading) {
    markNodeRequiresAllChildren(node, node.heading);
  }

  if (Array.isArray(node.content)) {
    for (const block of node.content) {
      markNodeRequiresAllChildrenFromBlock(node, block);
    }
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      refreshRequireAllChildrenFlags(child);
    }
  }
}

function buildNodeBreadcrumbs(node, root, baseBreadcrumbs) {
  const trail = [];
  let current = node.parent;

  while (current && current !== root) {
    const label = current.heading || current.identifier;
    if (label) {
      trail.unshift(label);
    }
    current = current.parent;
  }

  if (node !== root && root.heading) {
    trail.unshift(root.heading);
  }

  return [...(baseBreadcrumbs || []), ...trail];
}

function convertTreeNodeToStructure(node) {
  const children = node.children.map((child) => convertTreeNodeToStructure(child));
  const label = node.heading && node.heading !== node.identifier ? `${node.identifier} – ${node.heading}` : node.identifier;
  const content = filterRedundantContent(node);

  return {
    identifier: node.identifier,
    heading: node.heading || null,
    label,
    content: content.length > 0 ? content : undefined,
    children: children.length > 0 ? children : undefined,
    isEccn: Boolean(node.isEccn),
    boundToParent: Boolean(node.boundToParent),
    requireAllChildren: Boolean(node.requireAllChildren),
  };
}

function filterRedundantContent(node) {
  if (!Array.isArray(node.content) || node.content.length === 0) {
    return [];
  }

  if (!node.heading || node.boundToParent) {
    return node.content.slice();
  }

  const candidates = new Set();

  const headingText = normalizeComparableText(node.heading);
  if (headingText) {
    candidates.add(headingText);
  }

  if (node.identifier) {
    const identifierText = normalizeComparableText(node.identifier);
    if (identifierText) {
      candidates.add(identifierText);
    }

    const dashed = normalizeComparableText(`${node.identifier} – ${node.heading}`);
    if (dashed) {
      candidates.add(dashed);
    }

    const spaced = normalizeComparableText(`${node.identifier} ${node.heading}`);
    if (spaced) {
      candidates.add(spaced);
    }
  }

  return node.content.filter((block) => {
    const comparable = extractComparableText(block);
    if (!comparable) {
      return true;
    }

    return !candidates.has(comparable);
  });
}

function extractComparableText(block) {
  if (!block) {
    return null;
  }

  if (block.text) {
    return normalizeComparableText(block.text);
  }

  if (block.html) {
    const stripped = block.html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&');
    return normalizeComparableText(stripped);
  }

  return null;
}

function normalizeComparableText(value) {
  if (!value) {
    return null;
  }

  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) {
    return null;
  }

  const withoutEnumerators = stripLeadingEnumerators(collapsed) || collapsed;

  const stripped = withoutEnumerators
    .replace(/^["'“”‘’()\[\]{}\-–—:;,.!?]+/, '')
    .replace(/["'“”‘’()\[\]{}\-–—:;,.!?]+$/, '');

  return (stripped || withoutEnumerators).toLowerCase() || null;
}

function createTreeNode({ identifier, heading, path, parent }) {
  return {
    identifier,
    heading: heading || null,
    content: [],
    children: [],
    path: path ? path.slice() : [],
    parent: parent || null,
    requireAllChildren: false,
    isEccn: false,
    boundToParent: false,
  };
}

function parseSupplementOne($, supplementEl, number, heading) {
  const eccns = [];
  const seenCodes = new Set();
  const headingTrail = [];
  const children = supplementEl.children().toArray();

  let current = null;

  const finalizeCurrent = () => {
    if (!current) {
      return;
    }

    const entries = createEccnEntries($, {
      code: current.code,
      heading: current.heading,
      nodes: current.nodes,
      breadcrumbs: current.breadcrumbs,
      supplement: {
        number,
        heading: heading || null,
      },
    });

    eccns.push(...entries);
    current = null;
  };

  for (const node of children) {
    if (!node || (node.type !== 'tag' && node.type !== 'text')) {
      continue;
    }

    if (node.type === 'text') {
      if (current) {
        const text = node.data.replace(/\s+/g, ' ').trim();
        if (text) {
          current.nodes.push({ type: 'text', data: text });
        }
      }
      continue;
    }

    const element = $(node);
    const tagName = node.name ? node.name.toUpperCase() : '';

    const headingLevel = getHeadingLevel(tagName);
    if (headingLevel) {
      const headingText = element.text().replace(/\s+/g, ' ').trim();
      updateHeadingTrail(headingTrail, headingLevel, headingText);
      if (!current || headingLevel <= 2) {
        // Treat top-level headings as navigational context instead of ECCN content.
        continue;
      }
    }

    const eccnInfo = extractEccnHeadingFromNode($, element);
    if (eccnInfo && !seenCodes.has(eccnInfo.code)) {
      finalizeCurrent();
      seenCodes.add(eccnInfo.code);
      current = {
        code: eccnInfo.code,
        heading: eccnInfo.heading,
        nodes: [node],
        breadcrumbs: headingTrail.filter(Boolean),
      };
      continue;
    }

    if (current) {
      current.nodes.push(node);
    }
  }

  finalizeCurrent();

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

function parseSupplementFive($, supplementEl, number, heading) {
  const eccns = [];
  const table = supplementEl.find('TABLE').first();
  if (!table.length) {
    return {
      number,
      heading: heading || null,
      eccns,
      metadata: {
        eccnCount: 0,
        categoryCounts: {},
      },
    };
  }

  const header = table.children('THEAD').first().length
    ? table.children('THEAD').first()
    : table.children('thead').first();
  const headerHtml = header.length ? normalizeHtml($, header[0]) : '';

  let body = table.children('TBODY');
  if (!body.length) {
    body = table.children('tbody');
  }
  const rows = (body.length ? body.children('TR') : table.find('TR')).toArray();

  let current = null;

  const finalizeCurrent = () => {
    if (!current) {
      return;
    }

    const rowHtml = current.rows.map((row) => normalizeHtml($, row)).join('');
    const tableHtml = `<table class="supplement-table supplement-5-table">${headerHtml}${
      rowHtml ? `<tbody>${rowHtml}</tbody>` : ''
    }</table>`;

    const entries = createEccnEntries($, {
      code: current.code,
      heading: current.heading,
      content: [
        {
          type: 'html',
          tag: 'TABLE',
          html: tableHtml,
          text: null,
          id: null,
        },
      ],
      breadcrumbs: [],
      supplement: {
        number,
        heading: heading || null,
      },
    });

    eccns.push(...entries);
    current = null;
  };

  for (const row of rows) {
    const element = $(row);
    const text = element.text().replace(/\s+/g, ' ').trim();
    if (!text) {
      if (current) {
        current.rows.push(row);
      }
      continue;
    }

    const match = text.match(ECCN_HEADING_PATTERN);
    if (match) {
      finalizeCurrent();
      current = {
        code: match[1],
        heading: text,
        rows: [row],
      };
      continue;
    }

    if (current) {
      current.rows.push(row);
    }
  }

  finalizeCurrent();

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

function parseSupplementSix($, supplementEl, number, heading) {
  return parseListStyleSupplement($, supplementEl, number, heading);
}

function parseSupplementSeven($, supplementEl, number, heading) {
  return parseListStyleSupplement($, supplementEl, number, heading);
}

function parseListStyleSupplement($, supplementEl, number, heading) {
  const eccns = [];
  const seenCodes = new Set();
  const headingTrail = [];
  const supplementInfo = {
    number,
    heading: heading || null,
  };

  const nodes = supplementEl.children().toArray();
  let current = null;

  const finalizeCurrent = () => {
    if (!current) {
      return;
    }

    for (const code of current.codes) {
      if (seenCodes.has(code)) {
        continue;
      }

      const entries = createEccnEntries($, {
        code,
        heading: current.heading,
        nodes: current.nodes,
        breadcrumbs: current.breadcrumbs,
        supplement: supplementInfo,
      });

      eccns.push(...entries);
      seenCodes.add(code);
    }

    current = null;
  };

  for (const node of nodes) {
    if (!node || (node.type !== 'tag' && node.type !== 'text')) {
      continue;
    }

    if (node.type === 'text') {
      const text = node.data.replace(/\s+/g, ' ').trim();
      if (!text) {
        continue;
      }
      if (current) {
        current.nodes.push({ type: 'text', data: text });
      }
      continue;
    }

    const element = $(node);
    const tagName = node.name ? node.name.toUpperCase() : '';

    const headingLevel = getHeadingLevel(tagName);
    if (headingLevel) {
      finalizeCurrent();
      const headingText = element.text().replace(/\s+/g, ' ').trim();
      updateHeadingTrail(headingTrail, headingLevel, headingText);
      continue;
    }

    const codes = extractEccnCodesFromNode($, element);
    if (codes.length > 0) {
      finalizeCurrent();
      current = {
        codes,
        heading: element.text().replace(/\s+/g, ' ').trim(),
        nodes: [node],
        breadcrumbs: headingTrail.filter(Boolean),
      };
      continue;
    }

    if (current) {
      current.nodes.push(node);
    }
  }

  finalizeCurrent();

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

function extractEccnCodesFromNode($, element) {
  const text = element.text().replace(/\s+/g, ' ').trim();
  if (!text) {
    return [];
  }
  return extractEccnCodesFromText(text);
}

const ECCN_BASE_PATTERN = /[0-9][A-Z][0-9]{3}(?:\.[A-Za-z0-9]+)*/g;

function extractEccnCodesFromText(text) {
  const codes = [];
  const seen = new Set();

  ECCN_BASE_PATTERN.lastIndex = 0;

  let lastCode = null;
  let match;
  while ((match = ECCN_BASE_PATTERN.exec(text))) {
    const fullCode = sanitizeEccnCode(match[0]);
    if (!fullCode) {
      continue;
    }

    if (!seen.has(fullCode)) {
      seen.add(fullCode);
      codes.push(fullCode);
    }

    lastCode = fullCode;

    const root = fullCode.split('.')[0];
    if (!root) {
      continue;
    }

    let tailIndex = ECCN_BASE_PATTERN.lastIndex;
    while (tailIndex < text.length) {
      const tail = text.slice(tailIndex);
      const prefixMatch = tail.match(/^[\s,;:–—\-()\[\]]*(and|or|to|through)?\s*/i);
      if (!prefixMatch) {
        break;
      }

      const connector = prefixMatch[1] ? prefixMatch[1].toLowerCase() : null;
      const afterPrefix = tail.slice(prefixMatch[0].length);
      if (!afterPrefix.startsWith('.') && !/^[A-Za-z]\./.test(afterPrefix)) {
        break;
      }

      const segmentMatch = afterPrefix.match(/^(?:\.[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)|(?:[A-Za-z](?:\.[A-Za-z0-9]+)+)/);
      if (!segmentMatch) {
        break;
      }

      const suffix = segmentMatch[0];
      const normalizedSuffix = sanitizeSuffix(suffix);
      const consumed = prefixMatch[0].length + segmentMatch[0].length;
      tailIndex += consumed;

      if (!normalizedSuffix) {
        continue;
      }

      const derived = `${root}${normalizedSuffix}`;

      if ((connector === 'through' || connector === 'to') && lastCode) {
        const rangeCodes = expandEccnRange(lastCode, derived);
        for (const rangeCode of rangeCodes) {
          if (!seen.has(rangeCode)) {
            seen.add(rangeCode);
            codes.push(rangeCode);
          }
        }
      }

      if (!seen.has(derived)) {
        seen.add(derived);
        codes.push(derived);
      }

      lastCode = derived;
    }
  }

  return codes;
}

function sanitizeSuffix(suffix) {
  if (!suffix) {
    return null;
  }
  const trimmed = suffix
    .replace(/^[\s,;:–—\-()\[\]]*/, '')
    .replace(/[\s).,;:–—'"“”\-\]]+$/g, '');
  if (!trimmed) {
    return null;
  }
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

function expandEccnRange(startCode, endCode) {
  if (!startCode || !endCode) {
    return [];
  }

  const startParts = startCode.split('.');
  const endParts = endCode.split('.');

  if (startParts.length !== endParts.length) {
    return [];
  }

  for (let i = 0; i < startParts.length - 1; i += 1) {
    if (startParts[i] !== endParts[i]) {
      return [];
    }
  }

  const startValue = Number(startParts[startParts.length - 1]);
  const endValue = Number(endParts[endParts.length - 1]);
  if (!Number.isInteger(startValue) || !Number.isInteger(endValue) || startValue >= endValue) {
    return [];
  }

  const prefix = startParts.slice(0, -1).join('.');
  const results = [];
  for (let value = startValue + 1; value < endValue; value += 1) {
    const next = prefix ? `${prefix}.${value}` : String(value);
    results.push(next);
  }

  return results;
}

function sanitizeEccnCode(code) {
  if (!code) {
    return null;
  }
  return code.replace(/[\s).,;:–—'"“”-]+$/g, '');
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
  return normalizedHeading.replace(regex, '').replace(/^[\s,.;:–—-]+/, '').trim() || null;
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

function getHeadingLevel(tagName) {
  if (!tagName || !tagName.startsWith('HD')) {
    return 0;
  }
  const level = Number(tagName.slice(2));
  return Number.isFinite(level) ? level : 0;
}

function updateHeadingTrail(trail, level, text) {
  const index = level - 1;
  trail[index] = text;
  trail.length = index + 1;
}

function extractEccnHeadingFromNode($, element) {
  const bold = element.children('B').first();
  const strong = element.children('STRONG').first();
  const target = bold.length ? bold : strong.length ? strong : element;
  const text = target.text().replace(/\s+/g, ' ').trim();
  if (!text) {
    return null;
  }

  const match = text.match(ECCN_HEADING_PATTERN);
  if (!match) {
    return null;
  }

  return {
    code: match[1],
    heading: text,
  };
}

function buildContentBlock($, node) {
  if (!node) {
    return null;
  }

  if (node.type === 'text') {
    const text = (node.data || '').trim();
    if (!text) {
      return null;
    }
    return { type: 'text', text };
  }

  const element = $(node);
  const html = normalizeHtml($, node);
  if (!html) {
    return null;
  }

  const tagName = node.name ? node.name.toUpperCase() : '#UNKNOWN';
  const text = element.text().replace(/\s+/g, ' ').trim() || null;
  const id = element.attr('ID') || null;

  return {
    type: 'html',
    tag: tagName,
    html,
    text,
    id,
  };
}

export { fetchAndParseCcl, parsePart, flattenEccnTree, createTreeNode, markNodeRequiresAllChildren };

