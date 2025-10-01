#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'federal-register-documents.json');
const API_BASE_URL = 'https://www.federalregister.gov/api/v1/documents.json';
const USER_AGENT = process.env.FEDERAL_REGISTER_USER_AGENT || 'ccl-trade-data-fetcher/1.0 (+https://github.com)';
const SUPPLEMENTS = [
  { number: '1', searchTerms: ['"Supplement No. 1"', '"Supp. No. 1"'] },
  { number: '5', searchTerms: ['"Supplement No. 5"', '"Supp. No. 5"'] },
  { number: '6', searchTerms: ['"Supplement No. 6"', '"Supp. No. 6"'] },
  { number: '7', searchTerms: ['"Supplement No. 7"', '"Supp. No. 7"'] },
];

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

async function fetchDocumentsForSupplement(supplementNumber, searchTerms) {
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
    effectiveOn: rawDoc.effective_on || rawDoc.effective_date || null,
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

async function ensureOutputDir() {
  const dir = path.dirname(OUTPUT_PATH);
  await fs.mkdir(dir, { recursive: true });
}

async function main() {
  console.log('Fetching Federal Register documents impacting supplements to 15 CFR 774…');
  const aggregate = new Map();

  for (const supplement of SUPPLEMENTS) {
    console.log(`Searching for Supplement No. ${supplement.number}…`);
    const docs = await fetchDocumentsForSupplement(supplement.number, supplement.searchTerms);
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

  await ensureOutputDir();
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf-8');
  console.log(`Wrote ${documents.length} document(s) to ${OUTPUT_PATH}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('Failed to update Federal Register document list:', error);
    process.exitCode = 1;
  });
}
