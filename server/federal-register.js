import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
          'effective_date',
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
    effectiveOn:
      rawDoc.effective_on ||
      rawDoc.publication_date ||
      rawDoc.effective_date ||
      null,
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

async function fetchJson(url) {
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

  return response.json();
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
