import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { Agent as UndiciAgent, setGlobalDispatcher } from 'undici';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FEDERAL_REGISTER_DATA_DIR = path.join(__dirname, 'data');
const FEDERAL_REGISTER_JSON = path.join(
  FEDERAL_REGISTER_DATA_DIR,
  'federal-register-documents.json'
);
const API_BASE_URL = 'https://www.federalregister.gov/api/v1/documents.json';
const USER_AGENT =
  process.env.FEDERAL_REGISTER_USER_AGENT ||
  'ccl-trade-data-fetcher/1.0 (+https://github.com)';
const SUPPLEMENTS = [
  { number: '1', searchTerms: ['"Supplement No. 1"', '"Supp. No. 1"'] },
  { number: '5', searchTerms: ['"Supplement No. 5"', '"Supp. No. 5"'] },
  { number: '6', searchTerms: ['"Supplement No. 6"', '"Supp. No. 6"'] },
  { number: '7', searchTerms: ['"Supplement No. 7"', '"Supp. No. 7"'] },
];

export async function ensureFederalRegisterStorage() {
  await fs.mkdir(FEDERAL_REGISTER_DATA_DIR, { recursive: true });
}

export async function readFederalRegisterDocuments() {
  await ensureFederalRegisterStorage();
  try {
    const raw = await fs.readFile(FEDERAL_REGISTER_JSON, 'utf-8');
    const parsed = JSON.parse(raw);
    const documents = Array.isArray(parsed?.documents) ? parsed.documents : [];
    return {
      generatedAt: parsed?.generatedAt ?? null,
      supplements: Array.isArray(parsed?.supplements) ? parsed.supplements : [],
      documentCount:
        typeof parsed?.documentCount === 'number' ? parsed.documentCount : documents.length,
      documents,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { generatedAt: null, supplements: [], documentCount: 0, documents: [] };
    }
    if (error instanceof SyntaxError) {
      console.error('Invalid Federal Register JSON payload', error.message);
    }
    throw error;
  }
}

export async function updateFederalRegisterDocuments(options = {}) {
  const { onProgress } = options;
  const log = typeof onProgress === 'function' ? onProgress : null;

  const aggregate = new Map();
  log?.('Fetching Federal Register documents impacting 15 CFR 774 supplements…');

  for (const supplement of SUPPLEMENTS) {
    log?.(`Searching for Supplement No. ${supplement.number}…`);
    const docs = await fetchDocumentsForSupplement(
      supplement.number,
      supplement.searchTerms,
      log
    );
    for (const [documentNumber, payload] of docs.entries()) {
      if (aggregate.has(documentNumber)) {
        const existing = aggregate.get(documentNumber);
        payload.supplements.forEach((value) => existing.supplements.add(value));
      } else {
        aggregate.set(documentNumber, payload);
      }
    }
  }

  const documents = Array.from(aggregate.values()).map((entry) =>
    normalizeDocument(entry.raw, entry.supplements)
  );

  documents.sort((a, b) => {
    const dateA = a.effectiveOn || a.publicationDate || '';
    const dateB = b.effectiveOn || b.publicationDate || '';
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateA < dateB ? 1 : dateA > dateB ? -1 : 0;
  });

  const output = {
    generatedAt: new Date().toISOString(),
    supplements: SUPPLEMENTS.map((entry) => entry.number),
    documentCount: documents.length,
    documents,
  };

  await ensureFederalRegisterStorage();
  await fs.writeFile(FEDERAL_REGISTER_JSON, `${JSON.stringify(output, null, 2)}\n`, 'utf-8');
  log?.(`Stored ${documents.length} document(s) at ${FEDERAL_REGISTER_JSON}`);

  return output;
}

const execFileAsync = promisify(execFile);

async function fetchDocumentsForSupplement(supplementNumber, searchTerms, log) {
  const collected = new Map();

  for (const term of searchTerms) {
    let page = 1;
    let totalPages = 1;

    do {
      const url = buildQuery({
        page,
        per_page: 100,
        order: 'newest',
        'conditions[cfr][title]': 15,
        'conditions[cfr][part]': 774,
        'conditions[type][]': 'RULE',
        'conditions[term]': `${term} "part 774"`,
        'fields[]': [
          'document_number',
          'title',
          'html_url',
          'publication_date',
          'effective_on',
          'dates',
          'type',
          'action',
          'signing_date',
          'agencies',
          'citation',
          'docket_ids',
          'cfr_references',
        ],
      });

      const json = await fetchJson(url);
      const results = Array.isArray(json.results) ? json.results : [];
      for (const doc of results) {
        if (!doc || typeof doc !== 'object') {
          continue;
        }
        const documentNumber = doc.document_number;
        if (!documentNumber) {
          continue;
        }
        const existing = collected.get(documentNumber);
        if (existing) {
          existing.supplements.add(supplementNumber);
        } else {
          collected.set(documentNumber, {
            raw: doc,
            supplements: new Set([supplementNumber]),
          });
        }
      }

      totalPages = typeof json.total_pages === 'number' ? json.total_pages : page;
      page += 1;
    } while (page <= totalPages);
  }

  log?.(
    `Found ${collected.size} unique document(s) mentioning Supplement No. ${supplementNumber}.`
  );

  return collected;
}

function normalizeDocument(rawDoc, supplements) {
  const cfrReferences = Array.isArray(rawDoc.cfr_references)
    ? rawDoc.cfr_references.filter((entry) => entry && entry.part === '774')
    : [];

  return {
    documentNumber: rawDoc.document_number || null,
    title: rawDoc.title || null,
    htmlUrl: rawDoc.html_url || null,
    publicationDate: rawDoc.publication_date || null,
    effectiveOn: resolveEffectiveOn(rawDoc),
    type: rawDoc.type || null,
    action: rawDoc.action || null,
    signingDate: rawDoc.signing_date || null,
    supplements: Array.from(supplements).sort(),
    agencies: Array.isArray(rawDoc.agencies)
      ? rawDoc.agencies
          .filter((agency) => agency && agency.name)
          .map((agency) => agency.name)
      : [],
    citation: rawDoc.citation || null,
    docketIds: Array.isArray(rawDoc.docket_ids) ? rawDoc.docket_ids : [],
    cfrReferences,
  };
}

function resolveEffectiveOn(rawDoc) {
  const direct = normalizeIsoDate(rawDoc?.effective_on);
  if (direct) {
    return direct;
  }

  const textualSources = [rawDoc?.effective_date, rawDoc?.dates];
  for (const source of textualSources) {
    const parsed = parseEffectiveDateText(source);
    if (parsed) {
      return parsed;
    }
  }

  return normalizeIsoDate(rawDoc?.publication_date);
}

const MONTH_NAME_MAP = new Map(
  [
    ['january', 1],
    ['jan', 1],
    ['jan.', 1],
    ['february', 2],
    ['feb', 2],
    ['feb.', 2],
    ['march', 3],
    ['mar', 3],
    ['mar.', 3],
    ['april', 4],
    ['apr', 4],
    ['apr.', 4],
    ['may', 5],
    ['june', 6],
    ['jun', 6],
    ['jun.', 6],
    ['july', 7],
    ['jul', 7],
    ['jul.', 7],
    ['august', 8],
    ['aug', 8],
    ['aug.', 8],
    ['september', 9],
    ['sept', 9],
    ['sept.', 9],
    ['sep', 9],
    ['sep.', 9],
    ['october', 10],
    ['oct', 10],
    ['oct.', 10],
    ['november', 11],
    ['nov', 11],
    ['nov.', 11],
    ['december', 12],
    ['dec', 12],
    ['dec.', 12],
  ].map(([name, month]) => [name, month])
);

const MONTH_PATTERN = Array.from(MONTH_NAME_MAP.keys())
  .sort((a, b) => b.length - a.length)
  .map((value) => value.replace('.', '\\.'))
  .join('|');

const ISO_DATE_REGEX = /\b(\d{4}-\d{2}-\d{2})\b/g;
const SPELLED_OUT_REGEX = new RegExp(
  `\\b(${MONTH_PATTERN})\\s+([0-3]?\\d)(?:st|nd|rd|th)?(?:,)?\\s*(\\d{4})`,
  'gi'
);
const NUMERIC_DATE_REGEX = /\b(0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])[\/-](\d{4})\b/g;

function parseEffectiveDateText(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const cleaned = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return null;
  }

  const candidates = new Set();

  for (const match of cleaned.matchAll(ISO_DATE_REGEX)) {
    const iso = normalizeIsoDate(match[1]);
    if (iso) {
      candidates.add(iso);
    }
  }

  for (const match of cleaned.matchAll(SPELLED_OUT_REGEX)) {
    const monthToken = match[1]?.toLowerCase().replace(/\.$/, '');
    const month = MONTH_NAME_MAP.get(monthToken);
    if (!month) {
      continue;
    }
    const day = Number.parseInt(match[2], 10);
    const year = Number.parseInt(match[3], 10);
    const iso = toIsoDate(year, month, day);
    if (iso) {
      candidates.add(iso);
    }
  }

  for (const match of cleaned.matchAll(NUMERIC_DATE_REGEX)) {
    const month = Number.parseInt(match[1], 10);
    const day = Number.parseInt(match[2], 10);
    const year = Number.parseInt(match[3], 10);
    const iso = toIsoDate(year, month, day);
    if (iso) {
      candidates.add(iso);
    }
  }

  if (candidates.size === 0) {
    return null;
  }

  return Array.from(candidates).sort()[0];
}

function normalizeIsoDate(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!ISO_DATE_ONLY_REGEX.test(trimmed)) {
    return null;
  }
  return trimmed;
}

const ISO_DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function toIsoDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  if (month < 1 || month > 12) {
    return null;
  }

  if (day < 1 || day > 31) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

async function fetchJson(url) {
  ensureFetchDispatcher();
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const body = await safeReadBody(response);
      throw new Error(`Request failed (${response.status} ${response.statusText}): ${body}`);
    }

    return await response.json();
  } catch (error) {
    return fetchJsonWithCurl(url, error);
  }
}

let curlFallbackWarned = false;

async function fetchJsonWithCurl(url, originalError) {
  if (process.env.FEDERAL_REGISTER_DISABLE_CURL_FALLBACK === '1') {
    throw originalError;
  }

  if (!curlFallbackWarned) {
    console.warn(
      'fetch failed for Federal Register API, falling back to curl:',
      originalError
    );
    curlFallbackWarned = true;
  }

  try {
    const { stdout } = await execFileAsync('curl', [
      '--silent',
      '--show-error',
      '--fail',
      '--location',
      '--header',
      `User-Agent: ${USER_AGENT}`,
      '--header',
      'Accept: application/json',
      url,
    ]);
    return JSON.parse(stdout);
  } catch (curlError) {
    if (originalError) {
      curlError.message = `${curlError.message}\nOriginal fetch error: ${originalError.message}`;
    }
    throw curlError;
  }
}

let dispatcherConfigured = false;

function ensureFetchDispatcher() {
  if (dispatcherConfigured) {
    return;
  }

  try {
    setGlobalDispatcher(
      new UndiciAgent({
        connect: {
          // Prefer IPv4 to avoid environments where IPv6 routing is blocked.
          family: 4,
        },
      })
    );
    dispatcherConfigured = true;
  } catch (error) {
    // If the dispatcher cannot be configured (e.g. older Node/undici), log once
    // and continue with the default behaviour so the request still has a chance
    // to succeed.
    if (!ensureFetchDispatcher._warned) {
      console.warn('Failed to configure fetch dispatcher:', error);
      ensureFetchDispatcher._warned = true;
    }
  }
}

async function safeReadBody(response) {
  try {
    return await response.text();
  } catch (error) {
    return '<unavailable>';
  }
}

function buildQuery(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => {
        search.append(key, String(item));
      });
      return;
    }
    search.set(key, String(value));
  });
  return `${API_BASE_URL}?${search.toString()}`;
}

export function getFederalRegisterStoragePath() {
  return FEDERAL_REGISTER_JSON;
}
