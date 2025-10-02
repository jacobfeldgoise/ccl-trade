import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');
const METADATA_FILE = path.join(DATA_DIR, 'ccl-date-metadata.json');

const DEFAULT_METADATA = {
  missingEffectiveDates: [],
  downloadedEffectiveDates: [],
  notYetAvailableEffectiveDates: [],
};

function normalizeDate(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function normalizeDateList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  const set = new Set();
  for (const value of values) {
    const normalized = normalizeDate(value);
    if (!normalized) {
      continue;
    }
    set.add(normalized);
  }
  return Array.from(set).sort();
}

async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readMetadataFile() {
  await ensureStorage();
  try {
    const raw = await fs.readFile(METADATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      missingEffectiveDates: normalizeDateList(parsed?.missingEffectiveDates),
      downloadedEffectiveDates: normalizeDateList(parsed?.downloadedEffectiveDates),
      notYetAvailableEffectiveDates: normalizeDateList(parsed?.notYetAvailableEffectiveDates),
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { ...DEFAULT_METADATA };
    }
    if (error instanceof SyntaxError) {
      console.error('Invalid CCL date metadata payload', error.message);
      return { ...DEFAULT_METADATA };
    }
    throw error;
  }
}

async function writeMetadataFile(metadata) {
  const payload = {
    missingEffectiveDates: normalizeDateList(metadata?.missingEffectiveDates),
    downloadedEffectiveDates: normalizeDateList(metadata?.downloadedEffectiveDates),
    notYetAvailableEffectiveDates: normalizeDateList(metadata?.notYetAvailableEffectiveDates),
  };
  await ensureStorage();
  await fs.writeFile(METADATA_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  return payload;
}

export async function getCclDateMetadata() {
  return readMetadataFile();
}

export async function getMissingEffectiveDates() {
  const metadata = await readMetadataFile();
  return metadata.missingEffectiveDates;
}

export async function getDownloadedEffectiveDates() {
  const metadata = await readMetadataFile();
  return metadata.downloadedEffectiveDates;
}

export async function setMissingEffectiveDates(dates) {
  const metadata = await readMetadataFile();
  metadata.missingEffectiveDates = normalizeDateList(dates);
  metadata.downloadedEffectiveDates = metadata.downloadedEffectiveDates.filter(
    (date) => !metadata.missingEffectiveDates.includes(date)
  );
  metadata.notYetAvailableEffectiveDates = metadata.notYetAvailableEffectiveDates.filter(
    (date) => !metadata.missingEffectiveDates.includes(date)
  );
  const updated = await writeMetadataFile(metadata);
  return updated.missingEffectiveDates;
}

export async function setDownloadedEffectiveDates(dates) {
  const metadata = await readMetadataFile();
  metadata.downloadedEffectiveDates = normalizeDateList(dates);
  metadata.missingEffectiveDates = metadata.missingEffectiveDates.filter(
    (date) => !metadata.downloadedEffectiveDates.includes(date)
  );
  metadata.notYetAvailableEffectiveDates = metadata.notYetAvailableEffectiveDates.filter(
    (date) => !metadata.downloadedEffectiveDates.includes(date)
  );
  const updated = await writeMetadataFile(metadata);
  return updated.downloadedEffectiveDates;
}

export async function addMissingEffectiveDate(date) {
  const normalized = normalizeDate(date);
  const metadata = await readMetadataFile();
  if (!normalized) {
    return metadata.missingEffectiveDates;
  }
  if (!metadata.missingEffectiveDates.includes(normalized)) {
    metadata.missingEffectiveDates = [...metadata.missingEffectiveDates, normalized].sort();
  }
  metadata.downloadedEffectiveDates = metadata.downloadedEffectiveDates.filter(
    (entry) => entry !== normalized
  );
  metadata.notYetAvailableEffectiveDates = metadata.notYetAvailableEffectiveDates.filter(
    (entry) => entry !== normalized
  );
  const updated = await writeMetadataFile(metadata);
  return updated.missingEffectiveDates;
}

export async function addDownloadedEffectiveDate(date) {
  const normalized = normalizeDate(date);
  const metadata = await readMetadataFile();
  if (!normalized) {
    return metadata.downloadedEffectiveDates;
  }
  if (!metadata.downloadedEffectiveDates.includes(normalized)) {
    metadata.downloadedEffectiveDates = [...metadata.downloadedEffectiveDates, normalized].sort();
  }
  metadata.missingEffectiveDates = metadata.missingEffectiveDates.filter(
    (entry) => entry !== normalized
  );
  metadata.notYetAvailableEffectiveDates = metadata.notYetAvailableEffectiveDates.filter(
    (entry) => entry !== normalized
  );
  const updated = await writeMetadataFile(metadata);
  return updated.downloadedEffectiveDates;
}

export async function getNotYetAvailableEffectiveDates() {
  const metadata = await readMetadataFile();
  return metadata.notYetAvailableEffectiveDates;
}

export async function setNotYetAvailableEffectiveDates(dates) {
  const metadata = await readMetadataFile();
  metadata.notYetAvailableEffectiveDates = normalizeDateList(dates);
  metadata.missingEffectiveDates = metadata.missingEffectiveDates.filter(
    (date) => !metadata.notYetAvailableEffectiveDates.includes(date)
  );
  metadata.downloadedEffectiveDates = metadata.downloadedEffectiveDates.filter(
    (date) => !metadata.notYetAvailableEffectiveDates.includes(date)
  );
  const updated = await writeMetadataFile(metadata);
  return updated.notYetAvailableEffectiveDates;
}

export async function addNotYetAvailableEffectiveDate(date) {
  const normalized = normalizeDate(date);
  const metadata = await readMetadataFile();
  if (!normalized) {
    return metadata.notYetAvailableEffectiveDates;
  }
  if (!metadata.notYetAvailableEffectiveDates.includes(normalized)) {
    metadata.notYetAvailableEffectiveDates = [
      ...metadata.notYetAvailableEffectiveDates,
      normalized,
    ].sort();
  }
  metadata.missingEffectiveDates = metadata.missingEffectiveDates.filter(
    (entry) => entry !== normalized
  );
  metadata.downloadedEffectiveDates = metadata.downloadedEffectiveDates.filter(
    (entry) => entry !== normalized
  );
  const updated = await writeMetadataFile(metadata);
  return updated.notYetAvailableEffectiveDates;
}
