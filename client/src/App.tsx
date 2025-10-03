import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import {
  downloadCcl,
  getCcl,
  getEccnHistory,
  getFederalRegisterDocuments,
  getVersions,
  refreshFederalRegisterDocuments,
  reparseStoredCcls,
} from './api';
import {
  CclDataset,
  CclSupplement,
  EccnHistoryResponse,
  FederalRegisterDocument,
  FederalRegisterRefreshEvent,
  FederalRegisterRefreshStatus,
  EccnContentBlock,
  EccnEntry,
  EccnNode,
  VersionSummary,
  VersionsResponse,
} from './types';
import { VersionControls } from './components/VersionControls';
import { VersionSettings } from './components/VersionSettings';
import { EccnNodeView } from './components/EccnNodeView';
import { EccnContentBlockView } from './components/EccnContentBlock';
import { TradeDataView } from './components/TradeDataView';
import { FederalRegisterTimeline } from './components/FederalRegisterTimeline';
import { EccnHistoryView } from './components/EccnHistoryView';
import { formatDateTime, formatNumber } from './utils/format';
import {
  ECCN_ALLOWED_CHARS_PATTERN,
  buildEccnSearchTarget,
  eccnSegmentsMatchQuery,
  extractEccnQuery,
  normalizeSearchText,
  parseNormalizedEccn,
  type EccnSegment,
} from './utils/eccnSearch';
const SCROLL_TOP_THRESHOLD = 480;

type AppTab = 'explorer' | 'history' | 'trade' | 'federal-register' | 'settings';

type UrlState = {
  tab: AppTab;
  explorerQuery: string;
  historyQuery: string;
  tradeQuery: string;
  explorerEccn: string;
  historyEccn: string;
};

const DEFAULT_APP_TAB: AppTab = 'explorer';
const TAB_QUERY_PARAM = 'tab';
const EXPLORER_QUERY_PARAM = 'explorer';
const HISTORY_QUERY_PARAM = 'history';
const TRADE_QUERY_PARAM = 'trade';
const EXPLORER_ECCN_PARAM = 'explorerEccn';
const HISTORY_ECCN_PARAM = 'historyEccn';

function sanitizeEccnParam(value: string | null): string {
  if (!value) {
    return '';
  }

  const parsed = extractEccnQuery(value);
  if (parsed) {
    return parsed.code;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const upper = trimmed.toUpperCase();
  if (!ECCN_ALLOWED_CHARS_PATTERN.test(upper)) {
    return '';
  }

  const compressed = upper.replace(/\s+/g, '');
  return compressed;
}

function parseAppTab(value: string | null): AppTab {
  switch (value) {
    case 'explorer':
    case 'history':
    case 'trade':
    case 'federal-register':
    case 'settings':
      return value;
    default:
      return DEFAULT_APP_TAB;
  }
}

function getUrlStateFromSearch(search: string): UrlState {
  const params = new URLSearchParams(search);
  return {
    tab: parseAppTab(params.get(TAB_QUERY_PARAM)),
    explorerQuery: params.get(EXPLORER_QUERY_PARAM) ?? '',
    historyQuery: params.get(HISTORY_QUERY_PARAM) ?? '',
    tradeQuery: params.get(TRADE_QUERY_PARAM) ?? '',
    explorerEccn: sanitizeEccnParam(params.get(EXPLORER_ECCN_PARAM)),
    historyEccn: sanitizeEccnParam(params.get(HISTORY_ECCN_PARAM)),
  };
}

function readInitialUrlState(): UrlState {
  if (typeof window === 'undefined') {
    return {
      tab: DEFAULT_APP_TAB,
      explorerQuery: '',
      historyQuery: '',
      tradeQuery: '',
      explorerEccn: '',
      historyEccn: '',
    };
  }
  return getUrlStateFromSearch(window.location.search);
}

type SearchableEccn = {
  entry: EccnEntry;
  searchText: string;
  normalizedCode: string;
  segments: EccnSegment[] | null;
};

interface HighLevelField {
  id: string;
  label: string;
  blocks: EccnContentBlock[];
}

const SANITIZE_ANCHOR_PATTERN = /[^\w.-]+/g;
const CONTROL_HEADING_PATTERN = /control(?:s)?\s+(?:country\s+chart|table)/i;

interface AnchorRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface EccnPreviewState {
  normalizedCode: string;
  displayEccn: string;
  entry: EccnEntry | null;
  anchor: HTMLElement;
  rect: AnchorRect;
}

function getAnchorRect(element: HTMLElement): AnchorRect {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function normalizeNodeIdentifier(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, '');

  return normalized || null;
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function getBlockPlainText(block: EccnContentBlock): string {
  if (block.text) {
    return block.text;
  }
  if (block.html) {
    return stripHtmlTags(block.html);
  }
  return '';
}

function collectPrimaryBlocks(node: EccnNode): EccnContentBlock[] {
  const blocks: EccnContentBlock[] = [];
  if (node.content) {
    blocks.push(...node.content);
  }
  if (node.children) {
    node.children.forEach((child) => {
      if (child.boundToParent) {
        blocks.push(...collectPrimaryBlocks(child));
      }
    });
  }
  return blocks;
}

function extractValueAfterLabel(plainText: string, label: string): string | null {
  const escapedLabel = label.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
  const prefixPattern = new RegExp(`^\\s*${escapedLabel}\\s*[:\\-–—]*\\s*`, 'i');
  if (!prefixPattern.test(plainText)) {
    return null;
  }
  const value = plainText.replace(prefixPattern, '').trim();
  return value || null;
}

const COMMON_SECTION_STOP_PATTERNS = [
  /List of Items Controlled/i,
  /Related Controls?/i,
  /Related Definitions?/i,
  /^Items:?/i,
  /^Item:?/i,
  /License Requirements/i,
];

const LICENSE_SECTION_STOP_PATTERNS = [...COMMON_SECTION_STOP_PATTERNS, /Reason for Control/i];

const REASON_SECTION_STOP_PATTERNS = [...COMMON_SECTION_STOP_PATTERNS, /List Based License Exceptions/i];

const LICENSE_SECTION_PLACEHOLDER_PATTERN = /^\(\s*See\s+Part\s+740\b/i;

const ECCN_HEADING_PATTERN_CLIENT = /^([0-9][A-Z][0-9]{3})(?=$|[\s.\-–—:;([[])/;

const LIST_BASED_LICENSE_LABEL_PATTERN = /^\s*List Based License Exceptions\b/i;
const LICENSE_EXCEPTION_CODE_LINE_PATTERN = /^\s*([A-Z]{3}(?:\/[A-Z]{3})?)\s*[:：]\s*(.*)$/;
const LICENSE_EXCEPTION_CODE_ONLY_PATTERN = /^\s*([A-Z]{3}(?:\/[A-Z]{3})?)\s*[:：]?\s*$/;
const LICENSE_EXCEPTION_SPECIAL_PATTERN = /^\s*Special Conditions for\s+([A-Z]{3}(?:\/[A-Z]{3})?)\b/i;
const REASON_FOR_CONTROL_LABEL_PATTERN = /^\s*Reason for Control\b/i;

const KNOWN_REASON_CODES = new Set([
  'AT',
  'CB',
  'CC',
  'EI',
  'FC',
  'MT',
  'NP',
  'NS',
  'RS',
  'SI',
  'SL',
  'SS',
  'UN',
]);

function isPlaceholderLicenseValue(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  return LICENSE_SECTION_PLACEHOLDER_PATTERN.test(value);
}

function shouldStopCollectingLicenseBlocks(block: EccnContentBlock | undefined): boolean {
  if (!block) {
    return true;
  }

  const plain = getBlockPlainText(block);
  const trimmed = plain.trim();

  if (!trimmed && !block.html) {
    return false;
  }

  if (block.tag && /^FP-2$/i.test(block.tag)) {
    return true;
  }

  if (ECCN_HEADING_PATTERN_CLIENT.test(trimmed)) {
    return true;
  }

  if (block.html && /<E\b/i.test(block.html)) {
    if (/special conditions for sta/i.test(trimmed)) {
      return false;
    }
    return true;
  }

  if (LICENSE_SECTION_STOP_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return true;
  }

  if (LIST_BASED_LICENSE_LABEL_PATTERN.test(trimmed)) {
    return true;
  }

  return false;
}

function shouldStopCollectingReasonBlocks(block: EccnContentBlock | undefined): boolean {
  if (!block) {
    return true;
  }

  const plain = getBlockPlainText(block);
  const trimmed = plain.trim();

  if (!trimmed && !block.html) {
    return false;
  }

  if (block.tag && /^FP-2$/i.test(block.tag)) {
    return true;
  }

  if (ECCN_HEADING_PATTERN_CLIENT.test(trimmed)) {
    return true;
  }

  if (block.html && /<E\b/i.test(block.html)) {
    return true;
  }

  if (REASON_SECTION_STOP_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return true;
  }

  if (REASON_FOR_CONTROL_LABEL_PATTERN.test(trimmed)) {
    return true;
  }

  return false;
}

interface SectionCollectionResult {
  blocks: EccnContentBlock[];
  nextIndex: number;
}

interface CollectSectionOptions {
  stopPredicate: (block: EccnContentBlock | undefined) => boolean;
  skipValue?: (value: string | null | undefined) => boolean;
  includeSkippedValueInFallback?: boolean;
}

function collectSectionAfterLabel(
  blocks: EccnContentBlock[],
  startIndex: number,
  label: string,
  options: CollectSectionOptions
): SectionCollectionResult {
  const startBlock = blocks[startIndex];
  if (!startBlock) {
    return { blocks: [], nextIndex: startIndex + 1 };
  }

  const plain = getBlockPlainText(startBlock);
  const extractedValue = extractValueAfterLabel(plain, label);
  const shouldSkipValue = options.skipValue?.(extractedValue) ?? false;
  const collected: EccnContentBlock[] = [];

  if (extractedValue && !shouldSkipValue) {
    collected.push({ type: 'text', text: extractedValue });
  }

  let nextIndex = startIndex + 1;
  for (; nextIndex < blocks.length; nextIndex += 1) {
    const candidate = blocks[nextIndex];
    if (options.stopPredicate(candidate)) {
      break;
    }
    collected.push(candidate);
  }

  const shouldIncludeSkippedValue =
    extractedValue && shouldSkipValue && options.includeSkippedValueInFallback;

  if (collected.length === 0) {
    if (shouldIncludeSkippedValue || (extractedValue && !shouldSkipValue)) {
      collected.push({ type: 'text', text: extractedValue });
    } else if (startBlock.html) {
      collected.push({ type: 'html', html: startBlock.html, tag: startBlock.tag });
    } else if (startBlock.text) {
      collected.push({ type: 'text', text: startBlock.text });
    }
  }

  return { blocks: collected, nextIndex };
}

function collectSectionFromIndex(
  blocks: EccnContentBlock[],
  startIndex: number,
  options: Pick<CollectSectionOptions, 'stopPredicate'>
): SectionCollectionResult {
  const collected: EccnContentBlock[] = [];

  let nextIndex = startIndex;
  for (; nextIndex < blocks.length; nextIndex += 1) {
    const candidate = blocks[nextIndex];
    if (nextIndex !== startIndex && options.stopPredicate(candidate)) {
      break;
    }
    if (!candidate) {
      break;
    }
    collected.push(candidate);
  }

  return { blocks: collected, nextIndex };
}

interface LicenseExceptionEntry {
  code: string;
  description: string;
}

function isLicenseExceptionCodeText(text: string): boolean {
  return LICENSE_EXCEPTION_CODE_ONLY_PATTERN.test(text.trim());
}

function parseLicenseExceptionBlocks(
  blocks: EccnContentBlock[]
): { entries: LicenseExceptionEntry[]; leftovers: EccnContentBlock[] } {
  const entries: Array<{ code: string; descriptionParts: string[] }> = [];
  const leftovers: EccnContentBlock[] = [];
  const pendingSpecial = new Map<string, string[]>();

  let current: { code: string; descriptionParts: string[] } | null = null;

  for (const block of blocks) {
    const plain = getBlockPlainText(block).trim();
    if (!plain) {
      continue;
    }

    if (LIST_BASED_LICENSE_LABEL_PATTERN.test(plain)) {
      continue;
    }

    const specialMatch = plain.match(LICENSE_EXCEPTION_SPECIAL_PATTERN);
    if (specialMatch) {
      const code = specialMatch[1].toUpperCase();
      if (current && current.code === code) {
        current.descriptionParts.push(plain);
      } else {
        const existing = pendingSpecial.get(code) ?? [];
        existing.push(plain);
        pendingSpecial.set(code, existing);
      }
      continue;
    }

    const codeLineMatch = plain.match(LICENSE_EXCEPTION_CODE_LINE_PATTERN);
    if (codeLineMatch) {
      const code = codeLineMatch[1].toUpperCase();
      const remainder = codeLineMatch[2]?.trim();
      const entry = { code, descriptionParts: [] as string[] };
      const special = pendingSpecial.get(code);
      if (special) {
        entry.descriptionParts.push(...special);
        pendingSpecial.delete(code);
      }
      if (remainder) {
        entry.descriptionParts.push(remainder);
      }
      current = entry;
      entries.push(entry);
      continue;
    }

    const codeOnlyMatch = plain.match(LICENSE_EXCEPTION_CODE_ONLY_PATTERN);
    if (codeOnlyMatch) {
      const code = codeOnlyMatch[1].toUpperCase();
      const entry = { code, descriptionParts: [] as string[] };
      const special = pendingSpecial.get(code);
      if (special) {
        entry.descriptionParts.push(...special);
        pendingSpecial.delete(code);
      }
      current = entry;
      entries.push(entry);
      continue;
    }

    if (current) {
      current.descriptionParts.push(plain);
      continue;
    }

    leftovers.push(block);
  }

  const parsedEntries: LicenseExceptionEntry[] = entries.map((entry) => ({
    code: entry.code,
    description: entry.descriptionParts.join(' ').replace(/\s+/g, ' ').trim(),
  }));

  return { entries: parsedEntries, leftovers };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getDummyCodeDetail(code: string, type: 'license' | 'reason'): string {
  if (type === 'license') {
    return `Placeholder description for license exception ${code}.`;
  }
  return `Placeholder description for reason for control ${code}.`;
}

function buildCodeChipHtml(code: string, type: 'license' | 'reason'): string {
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) {
    return '';
  }
  const detail = getDummyCodeDetail(normalizedCode, type);
  return `<span class="code-chip code-chip-${type}" title="${escapeHtml(detail)}" data-code="${escapeHtml(
    normalizedCode
  )}">${escapeHtml(normalizedCode)}</span>`;
}

function buildCodeChipListHtml(codes: string[], type: 'license' | 'reason'): string {
  const chips = codes
    .map((code) => buildCodeChipHtml(code, type))
    .filter(Boolean)
    .join('');
  return `<div class="code-chip-list code-chip-list-${type}">${chips}</div>`;
}

function buildLicenseExceptionContent(blocks: EccnContentBlock[]): EccnContentBlock[] {
  const { entries, leftovers } = parseLicenseExceptionBlocks(blocks);
  if (!entries.length) {
    return blocks;
  }

  const rowsHtml = entries
    .map((entry) => {
      const description = entry.description || '—';
      const codeHtml = buildCodeChipHtml(entry.code, 'license') || escapeHtml(entry.code);
      return `    <tr>\n      <th scope="row">${codeHtml}</th>\n      <td>${escapeHtml(description)}</td>\n    </tr>`;
    })
    .join('\n');

  const tableHtml = `\n<table class="license-exception-table">\n  <thead>\n    <tr>\n      <th scope="col">Exception</th>\n      <th scope="col">Description</th>\n    </tr>\n  </thead>\n  <tbody>\n${rowsHtml}\n  </tbody>\n</table>`;

  const tableText = entries.map((entry) => `${entry.code}: ${entry.description || '—'}`).join(' ');

  const rendered: EccnContentBlock[] = [
    {
      type: 'html',
      tag: 'TABLE',
      html: tableHtml,
      text: tableText,
    },
  ];

  if (leftovers.length) {
    rendered.push(...leftovers);
  }

  return rendered;
}

function summarizeReasonValue(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const upper = raw.toUpperCase();
  const detected: string[] = [];
  const seen = new Set<string>();
  const pattern = /\b([A-Z]{2,3})\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(upper))) {
    const code = match[1];
    if (KNOWN_REASON_CODES.has(code) && !seen.has(code)) {
      detected.push(code);
      seen.add(code);
    }
  }

  if (detected.length > 0) {
    return detected.join(', ');
  }

  return null;
}

function extractReasonSummaryCodes(summary: string): string[] {
  const seen = new Set<string>();
  const codes: string[] = [];
  const upper = summary.toUpperCase();
  const pattern = /\b([A-Z]{2,3})\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(upper))) {
    const code = match[1];
    if (!seen.has(code) && KNOWN_REASON_CODES.has(code)) {
      seen.add(code);
      codes.push(code);
    }
  }
  return codes;
}

function extractHighLevelDetails(node: EccnNode): HighLevelField[] {
  const blocks = collectPrimaryBlocks(node);
  let reasonBlocks: EccnContentBlock[] = [];
  let reasonSummary: string | null = null;
  let reasonCountryBlocks: EccnContentBlock[] = [];
  let reasonDetailBlocks: EccnContentBlock[] = [];
  const licenseBlocks: EccnContentBlock[] = [];
  let controlTableBlock: EccnContentBlock | null = null;
  let controlHeading: string | null = null;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const plain = getBlockPlainText(block);

    if (reasonBlocks.length === 0 && plain && REASON_FOR_CONTROL_LABEL_PATTERN.test(plain)) {
      if (!reasonSummary) {
        reasonSummary = summarizeReasonValue(extractValueAfterLabel(plain, 'Reason for Control'));
      }
      const { blocks: collected, nextIndex } = collectSectionAfterLabel(blocks, index, 'Reason for Control', {
        stopPredicate: shouldStopCollectingReasonBlocks,
      });

      if (collected.length > 0) {
        reasonBlocks = collected;
      }

      index = nextIndex - 1;
      continue;
    }

    if (!licenseBlocks.length && plain && LIST_BASED_LICENSE_LABEL_PATTERN.test(plain)) {
      const { blocks: collected, nextIndex } = collectSectionAfterLabel(blocks, index, 'List Based License Exceptions', {
        stopPredicate: shouldStopCollectingLicenseBlocks,
        skipValue: isPlaceholderLicenseValue,
        includeSkippedValueInFallback: true,
      });

      if (collected.length > 0) {
        licenseBlocks.push(...collected);
      }

      index = nextIndex - 1;
      continue;
    }

    if (!licenseBlocks.length && plain && isLicenseExceptionCodeText(plain)) {
      const { blocks: collected, nextIndex } = collectSectionFromIndex(blocks, index, {
        stopPredicate: shouldStopCollectingLicenseBlocks,
      });

      if (collected.length > 0) {
        licenseBlocks.push(...collected);
      }

      index = nextIndex - 1;
      continue;
    }

    if (!controlTableBlock) {
      const hasTableHtml = Boolean(block.html && /<table[\s>]/i.test(block.html));
      if (hasTableHtml && block.html) {
        controlTableBlock = { type: 'html', html: block.html, tag: block.tag };
        if (!controlHeading && index > 0) {
          const previousPlain = getBlockPlainText(blocks[index - 1]).trim();
          if (previousPlain && CONTROL_HEADING_PATTERN.test(previousPlain)) {
            controlHeading = previousPlain;
          }
        }
        continue;
      }

      if (plain && CONTROL_HEADING_PATTERN.test(plain)) {
        controlHeading = plain.trim();
        const next = blocks[index + 1];
        if (next && next.html && /<table[\s>]/i.test(next.html)) {
          controlTableBlock = { type: 'html', html: next.html, tag: next.tag };
          index += 1;
        }
      }
    }
  }

  const fields: HighLevelField[] = [];
  if (reasonBlocks.length) {
    const combinedReasonText = reasonBlocks
      .map((block) => getBlockPlainText(block))
      .filter((text) => Boolean(text && text.trim()))
      .join(' ');

    const aggregatedSummary = summarizeReasonValue(combinedReasonText);
    if (aggregatedSummary) {
      reasonSummary = aggregatedSummary;
    }

    const tableIndices = new Set<number>();
    const contextualIndices = new Set<number>();

    reasonBlocks.forEach((block, index) => {
      if (block.html && /<table[\s>]/i.test(block.html)) {
        tableIndices.add(index);
        const previous = reasonBlocks[index - 1];
        if (previous) {
          const previousText = getBlockPlainText(previous).trim();
          if (previousText && /country/i.test(previousText)) {
            contextualIndices.add(index - 1);
          }
        }
        const next = reasonBlocks[index + 1];
        if (next) {
          const nextText = getBlockPlainText(next).trim();
          if (nextText && /country/i.test(nextText)) {
            contextualIndices.add(index + 1);
          }
        }
      }
    });

    const normalizedSummary = reasonSummary
      ? reasonSummary.replace(/\s+/g, ' ').trim().toLowerCase()
      : null;

    reasonBlocks.forEach((block, index) => {
      if (tableIndices.has(index) || contextualIndices.has(index)) {
        reasonCountryBlocks.push(block);
        return;
      }

      if (
        normalizedSummary &&
        block.type === 'text' &&
        block.text &&
        block.text.replace(/\s+/g, ' ').trim().toLowerCase() === normalizedSummary
      ) {
        return;
      }

      reasonDetailBlocks.push(block);
    });
  }

  if (reasonSummary) {
    const codes = extractReasonSummaryCodes(reasonSummary);
    if (codes.length) {
      fields.push({
        id: 'reason-for-control',
        label: 'Reason for Control',
        blocks: [
          {
            type: 'html',
            tag: 'DIV',
            html: buildCodeChipListHtml(codes, 'reason'),
            text: reasonSummary,
          },
        ],
      });
    } else {
      fields.push({ id: 'reason-for-control', label: 'Reason for Control', blocks: [{ type: 'text', text: reasonSummary }] });
    }
  }

  if (!reasonSummary && !reasonDetailBlocks.length && reasonCountryBlocks.length) {
    fields.push({ id: 'reason-for-control', label: 'Reason for Control', blocks: reasonCountryBlocks });
    reasonCountryBlocks = [];
  } else if (!reasonSummary && reasonDetailBlocks.length) {
    fields.push({
      id: 'reason-for-control',
      label: 'Reason for Control',
      blocks: reasonDetailBlocks,
    });
  }

  if (reasonCountryBlocks.length) {
    fields.push({
      id: 'reason-for-control-country-chart',
      label: 'Country Chart',
      blocks: reasonCountryBlocks,
    });
  }
  if (controlTableBlock) {
    const blocksToShow = controlHeading
      ? ([{ type: 'text', text: controlHeading }, controlTableBlock] as EccnContentBlock[])
      : [controlTableBlock];
    fields.push({ id: 'control-table', label: 'Control table', blocks: blocksToShow });
  }
  if (licenseBlocks.length) {
    const renderedBlocks = buildLicenseExceptionContent(licenseBlocks);
    fields.push({
      id: 'list-based-license-exceptions',
      label: 'List Based License Exceptions',
      blocks: renderedBlocks,
    });
  }
  return fields;
}

function findNodePathByIdentifier(node: EccnNode, target: string): EccnNode[] | null {
  const normalizedTarget = target.trim();
  const normalizedIdentifier = normalizeNodeIdentifier(node.identifier);
  if (normalizedIdentifier && normalizedIdentifier === normalizedTarget) {
    return [node];
  }

  if (!node.children || node.children.length === 0) {
    return null;
  }

  for (const child of node.children) {
    const childPath = findNodePathByIdentifier(child, normalizedTarget);
    if (childPath) {
      return [node, ...childPath];
    }
  }

  return null;
}

function getNodeAnchorId(node: EccnNode): string | undefined {
  if (node.identifier) {
    return `eccn-node-${node.identifier.replace(SANITIZE_ANCHOR_PATTERN, '-')}`;
  }
  if (node.heading) {
    return `eccn-node-${node.heading.replace(SANITIZE_ANCHOR_PATTERN, '-').toLowerCase()}`;
  }
  return undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'An unexpected error occurred.';
}

function App() {
  const initialUrlStateRef = useRef<UrlState>(readInitialUrlState());
  const initialUrlState = initialUrlStateRef.current;

  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [defaultDate, setDefaultDate] = useState<string | undefined>();
  const [selectedDate, setSelectedDate] = useState<string | undefined>();
  const [dataset, setDataset] = useState<CclDataset | null>(null);
  const datasetCacheRef = useRef<Map<string, CclDataset>>(new Map());
  const historyCacheRef = useRef<Map<string, EccnHistoryResponse>>(new Map());
  const [selectedEccn, setSelectedEccn] = useState<string | undefined>(() =>
    initialUrlState.explorerEccn ? initialUrlState.explorerEccn : undefined
  );
  const [focusedNodeIdentifier, setFocusedNodeIdentifier] = useState<string | undefined>();
  const [eccnFilter, setEccnFilter] = useState(initialUrlState.explorerQuery);
  const [historyQuery, setHistoryQuery] = useState(initialUrlState.historyQuery);
  const [tradeQuery, setTradeQuery] = useState(initialUrlState.tradeQuery);
  const [historySelectedEccn, setHistorySelectedEccn] = useState(initialUrlState.historyEccn);
  const [selectedSupplements, setSelectedSupplements] = useState<string[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [loadingDataset, setLoadingDataset] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eccnPreview, setEccnPreview] = useState<EccnPreviewState | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>(initialUrlState.tab);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const skipNextLoad = useRef(false);
  const previewCardRef = useRef<HTMLDivElement | null>(null);
  const [federalDocuments, setFederalDocuments] = useState<FederalRegisterDocument[]>([]);
  const [federalDocumentsGeneratedAt, setFederalDocumentsGeneratedAt] = useState<string | null>(null);
  const [loadingFederalDocuments, setLoadingFederalDocuments] = useState(false);
  const [federalDocumentsError, setFederalDocumentsError] = useState<string | null>(null);
  const [refreshingFederalDocuments, setRefreshingFederalDocuments] = useState(false);
  const [federalDocumentsStatus, setFederalDocumentsStatus] = useState<string | null>(null);
  const [federalDocumentsProgress, setFederalDocumentsProgress] = useState<string | null>(null);
  const [federalDocumentsMissingDates, setFederalDocumentsMissingDates] = useState<string[]>([]);
  const [federalDocumentsNotYetAvailableDates, setFederalDocumentsNotYetAvailableDates] =
    useState<string[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handlePopState = () => {
      const nextState = getUrlStateFromSearch(window.location.search);
      setActiveTab(nextState.tab);
      setEccnFilter(nextState.explorerQuery);
      setHistoryQuery(nextState.historyQuery);
      setTradeQuery(nextState.tradeQuery);
      setSelectedEccn(nextState.explorerEccn || undefined);
      setHistorySelectedEccn(nextState.historyEccn);
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const url = new URL(window.location.href);
    const params = new URLSearchParams(url.search);

    if (activeTab === DEFAULT_APP_TAB) {
      params.delete(TAB_QUERY_PARAM);
    } else {
      params.set(TAB_QUERY_PARAM, activeTab);
    }

    const syncQueryParam = (key: string, value: string) => {
      if (value.trim()) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    };

    syncQueryParam(EXPLORER_QUERY_PARAM, eccnFilter);
    syncQueryParam(HISTORY_QUERY_PARAM, historyQuery);
    syncQueryParam(TRADE_QUERY_PARAM, tradeQuery);
    syncQueryParam(EXPLORER_ECCN_PARAM, selectedEccn ?? '');
    syncQueryParam(HISTORY_ECCN_PARAM, historySelectedEccn);

    const nextSearch = params.toString();
    const currentSearch = url.search.length > 0 ? url.search.slice(1) : '';
    if (nextSearch !== currentSearch) {
      const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ''}${url.hash}`;
      window.history.replaceState(null, '', nextUrl);
    }
  }, [activeTab, eccnFilter, historyQuery, tradeQuery, selectedEccn, historySelectedEccn]);

  const syncFederalRegisterStatus = useCallback(
    (status: FederalRegisterRefreshStatus | null | undefined) => {
      if (!status) {
        return;
      }
      setRefreshingFederalDocuments(Boolean(status.running));
      setFederalDocumentsProgress(status.progressMessage ?? null);
      setFederalDocumentsStatus(status.statusMessage ?? null);
      setFederalDocumentsError(status.errorMessage ?? null);
      if (status.result) {
        setFederalDocumentsGeneratedAt(status.result.generatedAt);
        setFederalDocumentsMissingDates(status.result.missingEffectiveDates ?? []);
        setFederalDocumentsNotYetAvailableDates(
          status.result.notYetAvailableEffectiveDates ?? []
        );
      }
    },
    []
  );

  const loadVersions = useCallback(async (): Promise<VersionsResponse | null> => {
    setLoadingVersions(true);
    setError(null);
    try {
      const response = await getVersions();
      setDefaultDate(response.defaultDate);
      setVersions(response.versions);
      return response;
    } catch (err) {
      const message = getErrorMessage(err);
      setError(`Unable to list stored versions: ${message}`);
      return null;
    } finally {
      setLoadingVersions(false);
    }
  }, []);

  const loadFederalDocuments = useCallback(async () => {
    setLoadingFederalDocuments(true);
    setFederalDocumentsError(null);
    try {
      const response = await getFederalRegisterDocuments();
      setFederalDocuments(response.documents);
      setFederalDocumentsGeneratedAt(response.generatedAt);
      setFederalDocumentsMissingDates(response.missingEffectiveDates ?? []);
      setFederalDocumentsNotYetAvailableDates(response.notYetAvailableEffectiveDates ?? []);
    } catch (err) {
      setFederalDocumentsError(
        `Unable to load Federal Register documents: ${getErrorMessage(err)}`,
      );
    } finally {
      setLoadingFederalDocuments(false);
    }
  }, []);

  const refreshFederalDocuments = useCallback(async () => {
    setFederalDocumentsError(null);
    setFederalDocumentsStatus(null);
    setFederalDocumentsProgress(null);
    try {
      const response = await refreshFederalRegisterDocuments();
      syncFederalRegisterStatus(response.status);
      if (response.started && !response.status.progressMessage) {
        setFederalDocumentsProgress('Starting Federal Register refresh…');
      } else if (response.alreadyRunning && !response.status.progressMessage) {
        setFederalDocumentsProgress('Federal Register refresh already in progress…');
      }
    } catch (err) {
      const message = getErrorMessage(err);
      const errorMessage = `Unable to refresh Federal Register documents: ${message}`;
      setFederalDocumentsError(errorMessage);
    }
  }, [syncFederalRegisterStatus]);

  const handleFederalRegisterRefreshEvent = useCallback(
    (event: FederalRegisterRefreshEvent) => {
      if (event.type === 'status') {
        syncFederalRegisterStatus(event.status);
        return;
      }

      if (event.type === 'progress') {
        if (event.message) {
          setFederalDocumentsProgress(event.message);
        }
        setRefreshingFederalDocuments(true);
        return;
      }

      if (event.type === 'complete') {
        if (event.message) {
          setFederalDocumentsStatus(event.message);
        }
        if (event.result) {
          setFederalDocumentsGeneratedAt(event.result.generatedAt);
          setFederalDocumentsMissingDates(event.result.missingEffectiveDates ?? []);
          setFederalDocumentsNotYetAvailableDates(
            event.result.notYetAvailableEffectiveDates ?? []
          );
        }
        setFederalDocumentsProgress(null);
        setRefreshingFederalDocuments(false);
        loadFederalDocuments().catch((loadError) => {
          console.error('Unable to reload Federal Register documents after refresh', loadError);
          setFederalDocumentsError(
            'Unable to reload Federal Register documents after refresh completion.'
          );
        });
        return;
      }

      if (event.type === 'error') {
        const message = event.message || 'Failed to refresh Federal Register documents.';
        setFederalDocumentsError(message);
        setFederalDocumentsProgress(null);
        setRefreshingFederalDocuments(false);
      }
    },
    [loadFederalDocuments, syncFederalRegisterStatus]
  );

  useEffect(() => {
    let isMounted = true;
    (async () => {
      const response = await loadVersions();
      if (!response || !isMounted) {
        return;
      }
      const initial = response.versions[0]?.date ?? response.defaultDate;
      if (initial) {
        skipNextLoad.current = false;
        setSelectedDate(initial);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [loadVersions]);

  useEffect(() => {
    loadFederalDocuments();
  }, [loadFederalDocuments]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return;
    }

    const source = new EventSource('/api/federal-register/refresh/events');

    source.onmessage = (event) => {
      if (!event.data) {
        return;
      }
      try {
        const parsed = JSON.parse(event.data) as FederalRegisterRefreshEvent;
        handleFederalRegisterRefreshEvent(parsed);
      } catch (error) {
        console.warn('Unable to parse Federal Register refresh event payload', error);
      }
    };

    source.onerror = (event) => {
      console.error('Federal Register refresh event stream error', event);
    };

    return () => {
      source.onmessage = null;
      source.onerror = null;
      source.close();
    };
  }, [handleFederalRegisterRefreshEvent]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const updateVisibility = () => {
      setShowScrollTop(window.scrollY > SCROLL_TOP_THRESHOLD);
    };

    window.addEventListener('scroll', updateVisibility, { passive: true });
    updateVisibility();

    return () => {
      window.removeEventListener('scroll', updateVisibility);
    };
  }, []);

  useEffect(() => {
    if (!selectedDate) {
      return;
    }
    if (skipNextLoad.current) {
      skipNextLoad.current = false;
      return;
    }

    let cancelled = false;
    setLoadingDataset(true);
    setError(null);

    getCcl(selectedDate)
      .then((data) => {
        if (!cancelled) {
          setDataset(data);
          setEccnFilter('');
          setSelectedEccn(undefined);
          setFocusedNodeIdentifier(undefined);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(`Unable to load version ${selectedDate}: ${getErrorMessage(err)}`);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDataset(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  useEffect(() => {
    if (dataset) {
      datasetCacheRef.current.set(dataset.version, dataset);
    }
  }, [dataset]);

  const handleSelectVersion = (date: string) => {
    if (date === selectedDate) {
      return;
    }
    setSelectedDate(date);
  };

  const applyDataset = useCallback(
    (data: CclDataset) => {
      skipNextLoad.current = true;
      setDataset(data);
      setSelectedDate(data.version);
      setEccnFilter('');
      setSelectedEccn(undefined);
      setFocusedNodeIdentifier(undefined);
    },
    [skipNextLoad]
  );

  const handleDownloadVersion = async (date: string) => {
    setRefreshing(true);
    setError(null);
    try {
      const data = await downloadCcl(date);
      applyDataset(data);
      historyCacheRef.current.clear();
      await loadVersions();
    } catch (err) {
      setError(`Unable to download version ${date}: ${getErrorMessage(err)}`);
    } finally {
      setRefreshing(false);
    }
  };

  const handleReparseAll = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await reparseStoredCcls();
      datasetCacheRef.current.clear();
      historyCacheRef.current.clear();
      await loadVersions();
      if (selectedDate) {
        const data = await getCcl(selectedDate);
        applyDataset(data);
      }
    } catch (err) {
      setError(`Unable to re-parse stored XML files: ${getErrorMessage(err)}`);
    } finally {
      setRefreshing(false);
    }
  };

  const handleLoadNewVersion = async (date: string) => {
    await handleDownloadVersion(date);
  };

  const handleScrollToTop = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const ensureHistory = useCallback(
    async (code: string): Promise<EccnHistoryResponse> => {
      const normalized = code.trim().toUpperCase().replace(/\s+/g, '');
      if (!normalized) {
        throw new Error('An ECCN code is required to load history.');
      }

      const cached = historyCacheRef.current.get(normalized);
      if (cached) {
        return cached;
      }

      const loaded = await getEccnHistory(normalized);
      historyCacheRef.current.set(normalized, loaded);
      historyCacheRef.current.set(loaded.eccn.trim().toUpperCase().replace(/\s+/g, ''), loaded);
      return loaded;
    },
    []
  );

  const supplements = useMemo(() => {
    if (!dataset || !Array.isArray(dataset.supplements)) {
      return [] as CclSupplement[];
    }
    return dataset.supplements;
  }, [dataset]);

  useEffect(() => {
    if (!supplements.length) {
      setSelectedSupplements([]);
      return;
    }

    setSelectedSupplements(supplements.map((supplement) => supplement.number));
  }, [supplements]);

  const allEccns: EccnEntry[] = useMemo(() => {
    return supplements.flatMap((supplement) =>
      supplement.eccns.map((entry) =>
        entry.supplement
          ? entry
          : {
              ...entry,
              supplement: {
                number: supplement.number,
                heading: supplement.heading ?? null,
              },
            }
      )
    );
  }, [supplements]);

  const searchableEccns = useMemo<SearchableEccn[]>(() => {
    const seen = new Set<string>();

    return allEccns.flatMap<SearchableEccn>((entry) => {
      const supplementNumber = entry.supplement.number;
      const normalizedCode = entry.eccn.trim().toUpperCase();
      const key = `${supplementNumber}::${normalizedCode}`;

      if (seen.has(key)) {
        return [];
      }

      seen.add(key);

      const parsed = parseNormalizedEccn(normalizedCode);

      return [
        {
          entry,
          searchText: buildEccnSearchTarget(entry),
          normalizedCode,
          segments: parsed?.segments ?? null,
        },
      ];
    });
  }, [allEccns]);

  const historyOptions = useMemo(
    () => {
      const unique = new Map<
        string,
        { entry: EccnEntry; normalizedCode: string; searchText: string; segments: EccnSegment[] | null }
      >();

      searchableEccns.forEach(({ entry, normalizedCode, searchText, segments }) => {
        if (!unique.has(normalizedCode)) {
          unique.set(normalizedCode, { entry, normalizedCode, searchText, segments });
        }
      });

      return Array.from(unique.values()).sort((a, b) => a.entry.eccn.localeCompare(b.entry.eccn));
    },
    [searchableEccns]
  );

  const eccnLookup = useMemo(() => {
    const map = new Map<string, EccnEntry>();
    allEccns.forEach((entry) => {
      const normalized = entry.eccn.trim().toUpperCase();
      if (!map.has(normalized)) {
        map.set(normalized, entry);
      }
    });
    return map;
  }, [allEccns]);

  const filteredEccns: EccnEntry[] = useMemo(() => {
    const normalizedTerm = normalizeSearchText(eccnFilter);
    const tokens = normalizedTerm.split(/\s+/).filter(Boolean);
    const eccnQuery = extractEccnQuery(eccnFilter);
    const querySegments = eccnQuery?.segments ?? null;

    if (selectedSupplements.length === 0) {
      return [];
    }

    return searchableEccns
      .filter(({ entry, searchText, segments }) => {
        if (!selectedSupplements.includes(entry.supplement.number)) {
          return false;
        }

        if (querySegments) {
          if (!segments) {
            return false;
          }

          return eccnSegmentsMatchQuery(querySegments, segments);
        }

        if (tokens.length === 0) {
          return true;
        }

        return tokens.every((token) => searchText.includes(token));
      })
      .map(({ entry }) => entry);
  }, [searchableEccns, selectedSupplements, eccnFilter]);

  const singleSelectedSupplement = useMemo(() => {
    if (selectedSupplements.length !== 1) {
      return undefined;
    }
    const [selectedNumber] = selectedSupplements;
    return supplements.find((supplement) => supplement.number === selectedNumber);
  }, [selectedSupplements, supplements]);

  const totalEccnCount = allEccns.length;
  const allSupplementsSelected =
    supplements.length > 0 && selectedSupplements.length === supplements.length;
  const supplementScopeCount =
    selectedSupplements.length === 0
      ? 0
      : allSupplementsSelected
      ? totalEccnCount
      : selectedSupplements.reduce((total, number) => {
          const supplement = supplements.find((item) => item.number === number);
          if (!supplement) {
            return total;
          }
          if (supplement.metadata?.eccnCount != null) {
            return total + supplement.metadata.eccnCount;
          }
          return total + supplement.eccns.length;
        }, 0);

  useEffect(() => {
    setFocusedNodeIdentifier(undefined);
    setSelectedEccn((previous) => {
      if (filteredEccns.length === 0) {
        return previous;
      }
      if (previous && filteredEccns.some((entry) => entry.eccn === previous)) {
        return previous;
      }
      return filteredEccns[0]?.eccn;
    });
  }, [filteredEccns]);

  const activeEccn: EccnEntry | undefined = useMemo(() => {
    if (!filteredEccns.length) {
      return undefined;
    }
    if (selectedEccn) {
      return filteredEccns.find((entry) => entry.eccn === selectedEccn) ?? filteredEccns[0];
    }
    return filteredEccns[0];
  }, [filteredEccns, selectedEccn]);

  const highLevelFields = useMemo<HighLevelField[]>(() => {
    if (!activeEccn) {
      return [];
    }
    return extractHighLevelDetails(activeEccn.structure);
  }, [activeEccn]);

  const eccnChildren = activeEccn?.structure.children ?? [];

  const normalizedFocusedIdentifier = useMemo(() => normalizeNodeIdentifier(focusedNodeIdentifier), [focusedNodeIdentifier]);

  const { focusedNode, focusedPath } = useMemo<{
    focusedNode: EccnNode | undefined;
    focusedPath: Set<EccnNode> | undefined;
  }>(() => {
    if (!activeEccn || !normalizedFocusedIdentifier) {
      return { focusedNode: undefined, focusedPath: undefined };
    }

    const directPath = findNodePathByIdentifier(activeEccn.structure, normalizedFocusedIdentifier);
    if (directPath) {
      return {
        focusedNode: directPath[directPath.length - 1],
        focusedPath: new Set(directPath),
      };
    }

    if (normalizedFocusedIdentifier.includes('.')) {
      const baseIdentifier = normalizedFocusedIdentifier.split('.')[0];
      const basePath = findNodePathByIdentifier(activeEccn.structure, baseIdentifier);
      if (basePath) {
        return {
          focusedNode: basePath[basePath.length - 1],
          focusedPath: new Set(basePath),
        };
      }
    }

    return { focusedNode: undefined, focusedPath: undefined };
  }, [activeEccn, normalizedFocusedIdentifier]);

  useEffect(() => {
    if (!focusedNode) {
      return;
    }
    const anchorId = getNodeAnchorId(focusedNode);
    if (!anchorId || typeof document === 'undefined') {
      return;
    }
    const element = document.getElementById(anchorId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [focusedNode]);

  useEffect(() => {
    if (activeTab !== 'explorer') {
      setEccnPreview(null);
    }
  }, [activeTab]);

  const handleToggleSupplementFilter = (value: string) => {
    setSelectedSupplements((previous) => {
      const nextSelection = new Set(previous);
      if (nextSelection.has(value)) {
        nextSelection.delete(value);
      } else {
        nextSelection.add(value);
      }

      const ordered = supplements.map((supplement) => supplement.number);
      return ordered.filter((number) => nextSelection.has(number));
    });
    setEccnFilter('');
    setSelectedEccn(undefined);
    setFocusedNodeIdentifier(undefined);
  };

  const handleSelectEccn = useCallback(
    (value: string) => {
      setEccnPreview(null);
      const parsed = extractEccnQuery(value) ?? parseNormalizedEccn(value);
      if (!parsed || parsed.segments.length === 0) {
        return;
      }

    const normalizedCode = parsed.code.toUpperCase();
    const exactMatch = eccnLookup.get(normalizedCode);

    if (exactMatch) {
      setSelectedEccn(exactMatch.eccn);
      setFocusedNodeIdentifier(undefined);

      const supplementNumber = exactMatch.supplement.number;
      if (supplementNumber) {
        setSelectedSupplements((previous) => {
          if (previous.includes(supplementNumber)) {
            return previous;
          }
          const next = new Set(previous);
          next.add(supplementNumber);
          return supplements
            .map((supplement) => supplement.number)
            .filter((number) => next.has(number));
        });
      }
      return;
    }

    const baseSegment = parsed.segments[0];
    const baseCode = baseSegment.raw;
    setSelectedEccn(baseCode);

    const baseMatch = eccnLookup.get(baseCode.toUpperCase());
    if (baseMatch) {
      const supplementNumber = baseMatch.supplement.number;
      if (supplementNumber) {
        setSelectedSupplements((previous) => {
          if (previous.includes(supplementNumber)) {
            return previous;
          }
          const next = new Set(previous);
          next.add(supplementNumber);
          return supplements
            .map((supplement) => supplement.number)
            .filter((number) => next.has(number));
        });
      }
    }

    if (parsed.segments.length > 1) {
      setFocusedNodeIdentifier(parsed.code);
    } else {
      setFocusedNodeIdentifier(undefined);
    }
    },
    [eccnLookup, supplements]
  );

  const handleNavigateToEccn = useCallback(
    (value: string) => {
      setActiveTab('explorer');
      handleSelectEccn(value);
    },
    [handleSelectEccn]
  );

  const handlePreviewEccn = useCallback(
    (value: string, anchor: HTMLElement) => {
      if (!anchor) {
        return;
      }

      const trimmedValue = value.trim();
      const parsed = extractEccnQuery(trimmedValue) ?? parseNormalizedEccn(trimmedValue);
      const fallbackValue = trimmedValue || value;
      const normalizedCode = (parsed?.code ?? fallbackValue).toUpperCase();
      const matchedEntry = eccnLookup.get(normalizedCode) ?? null;
      const displayEccn = matchedEntry?.eccn ?? fallbackValue;

      setEccnPreview((previous) => {
        if (previous && previous.anchor === anchor && previous.normalizedCode === normalizedCode) {
          return null;
        }

        return {
          normalizedCode,
          displayEccn,
          entry: matchedEntry,
          anchor,
          rect: getAnchorRect(anchor),
        };
      });
    },
    [eccnLookup]
  );

  const handleClosePreview = useCallback(() => {
    setEccnPreview(null);
  }, []);

  const handleConfirmPreview = useCallback(() => {
    if (!eccnPreview) {
      return;
    }

    const eccnToOpen = eccnPreview.displayEccn;
    setEccnPreview(null);
    handleSelectEccn(eccnToOpen);
  }, [eccnPreview, handleSelectEccn]);

  useEffect(() => {
    const anchor = eccnPreview?.anchor;
    if (!anchor || typeof window === 'undefined') {
      return;
    }

    const updateRect = () => {
      setEccnPreview((previous) => {
        if (!previous || previous.anchor !== anchor) {
          return previous;
        }
        if (!anchor.isConnected) {
          return null;
        }
        return {
          ...previous,
          rect: getAnchorRect(anchor),
        };
      });
    };

    updateRect();

    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('resize', updateRect);

    return () => {
      window.removeEventListener('scroll', updateRect, true);
      window.removeEventListener('resize', updateRect);
    };
  }, [eccnPreview?.anchor]);

  useEffect(() => {
    if (!eccnPreview || typeof document === 'undefined') {
      return;
    }

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      const card = previewCardRef.current;
      if (card && target && card.contains(target)) {
        return;
      }
      if (eccnPreview.anchor && target && eccnPreview.anchor.contains(target)) {
        return;
      }
      handleClosePreview();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClosePreview();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [eccnPreview, handleClosePreview]);

  useEffect(() => {
    if (!eccnPreview || typeof window === 'undefined') {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      previewCardRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [eccnPreview]);

  const previewPosition = useMemo(() => {
    if (!eccnPreview) {
      return null;
    }

    const anchorRect = eccnPreview.rect;
    const viewportWidth = typeof window !== 'undefined'
      ? window.innerWidth || document.documentElement.clientWidth || 0
      : 0;
    const viewportHeight = typeof window !== 'undefined'
      ? window.innerHeight || document.documentElement.clientHeight || 0
      : 0;

    const maxCardWidth = viewportWidth ? Math.min(360, viewportWidth - 32) : 360;
    const halfWidth = maxCardWidth / 2;

    let left = anchorRect.left + anchorRect.width / 2;
    if (viewportWidth) {
      left = Math.min(viewportWidth - 16 - halfWidth, Math.max(16 + halfWidth, left));
    }

    let position: 'above' | 'below' = 'below';
    let top = anchorRect.bottom + 12;

    if (viewportHeight) {
      const spaceBelow = viewportHeight - anchorRect.bottom;
      const spaceAbove = anchorRect.top;
      if (spaceBelow < 260 && spaceAbove > spaceBelow) {
        position = 'above';
        top = Math.max(16, anchorRect.top - 12);
      } else {
        top = Math.min(Math.max(16, top), viewportHeight - 16);
      }
    }

    return {
      left,
      top,
      position,
      maxWidth: maxCardWidth,
    };
  }, [eccnPreview]);

  const previewIdSuffix = eccnPreview
    ? eccnPreview.normalizedCode.replace(/[^A-Z0-9]+/gi, '-').toLowerCase()
    : null;
  const previewTitleId = previewIdSuffix ? `eccn-preview-title-${previewIdSuffix}` : undefined;
  const previewBodyId = previewIdSuffix ? `eccn-preview-body-${previewIdSuffix}` : undefined;
  const previewEntry = eccnPreview?.entry ?? null;
  const previewHeading = previewEntry
    ? previewEntry.title ||
      (previewEntry.heading && previewEntry.heading !== previewEntry.eccn ? previewEntry.heading : null)
    : null;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Commerce Control List Explorer</h1>
        <p>
          Download, store, and browse the U.S. Commerce Control List (15 CFR 774) across historical
          versions.
        </p>
        <nav className="app-tabs" aria-label="Primary navigation">
          <button
            type="button"
            className="app-tab-button"
            data-active={activeTab === 'explorer'}
            onClick={() => setActiveTab('explorer')}
            aria-current={activeTab === 'explorer' ? 'page' : undefined}
          >
            CCL Explorer
          </button>
          <button
            type="button"
            className="app-tab-button"
            data-active={activeTab === 'history'}
            onClick={() => setActiveTab('history')}
            aria-current={activeTab === 'history' ? 'page' : undefined}
          >
            ECCN History
          </button>
          <button
            type="button"
            className="app-tab-button"
            data-active={activeTab === 'trade'}
            onClick={() => setActiveTab('trade')}
            aria-current={activeTab === 'trade' ? 'page' : undefined}
          >
            Trade Data by ECCN
          </button>
          <button
            type="button"
            className="app-tab-button"
            data-active={activeTab === 'federal-register'}
            onClick={() => setActiveTab('federal-register')}
            aria-current={activeTab === 'federal-register' ? 'page' : undefined}
          >
            Federal Register Timeline
          </button>
          <button
            type="button"
            className="app-tab-button"
            data-active={activeTab === 'settings'}
            onClick={() => setActiveTab('settings')}
            aria-current={activeTab === 'settings' ? 'page' : undefined}
          >
            Settings
          </button>
        </nav>
      </header>
      <main className="app-main">
        {activeTab === 'explorer' ? (
          <div className="explorer-layout">
            <aside className="sidebar">
              <VersionControls
                versions={versions}
                defaultDate={defaultDate}
                selectedDate={selectedDate}
                onSelect={handleSelectVersion}
                loadingVersions={loadingVersions}
              />
              {error && <div className="alert error">{error}</div>}
            </aside>
            <section className="content-area">
              {selectedDate && (
                <header className="dataset-header">
                  <h2>Version {selectedDate}</h2>
                  {dataset && (
                    <p>
                      Retrieved {formatDateTime(dataset.fetchedAt)} from{' '}
                      <a href={dataset.sourceUrl} target="_blank" rel="noreferrer">
                        eCFR API
                      </a>
                      .
                    </p>
                  )}
                </header>
              )}
    
              {loadingDataset && <div className="alert info">Loading CCL content…</div>}
    
              {dataset && !loadingDataset ? (
                <>
                  <section className="dataset-summary">
                    <div>
                      <h3>Total ECCNs captured</h3>
                      <p>{formatNumber(dataset.counts?.eccns ?? 0)}</p>
                    </div>
                    <div>
                      <h3>Stored locally</h3>
                      <p>{formatDateTime(dataset.fetchedAt)}</p>
                    </div>
                  </section>
    
                  {supplements.length > 0 ? (
                    <div className="eccn-browser">
                      <aside className="eccn-sidebar">
                        <div className="control-group">
                          <span className="control-label">Supplements</span>
                          <div className="checkbox-list">
                            {supplements.map((supplement) => {
                              const checkboxId = `supplement-${supplement.number}`;
                              return (
                                <label key={supplement.number} className="checkbox-option" htmlFor={checkboxId}>
                                  <input
                                    id={checkboxId}
                                    type="checkbox"
                                    checked={selectedSupplements.includes(supplement.number)}
                                    onChange={() => handleToggleSupplementFilter(supplement.number)}
                                  />
                                  <span>{`Supplement No. ${supplement.number}`}</span>
                                </label>
                              );
                            })}
                          </div>
                          {singleSelectedSupplement?.heading && (
                            <p className="help-text">{singleSelectedSupplement.heading}</p>
                          )}
                        </div>
    
                        <div className="control-group">
                          <label htmlFor="eccn-filter">Filter ECCNs</label>
                          <input
                            id="eccn-filter"
                            className="control"
                            type="search"
                            value={eccnFilter}
                            onChange={(event) => setEccnFilter(event.target.value)}
                            placeholder="Search by code or title"
                          />
                          <p className="help-text">
                            Showing {formatNumber(filteredEccns.length)} of{' '}
                            {formatNumber(supplementScopeCount)} ECCNs
                            {selectedSupplements.length === 0
                              ? ' with no supplements selected.'
                              : allSupplementsSelected
                              ? ' across all supplements.'
                              : selectedSupplements.length === 1
                              ? ` from Supplement No. ${selectedSupplements[0]}${
                                  singleSelectedSupplement?.heading
                                    ? ` – ${singleSelectedSupplement.heading}`
                                    : ''
                                }.`
                              : ` across ${selectedSupplements.length} supplements.`}
                          </p>
                        </div>
    
                        <ul className="eccn-list">
                          {filteredEccns.map((entry) => (
                            <li
                              key={`${entry.supplement.number}-${entry.eccn}`}
                              className={entry.eccn === activeEccn?.eccn ? 'active' : ''}
                            >
                              <button type="button" onClick={() => handleSelectEccn(entry.eccn)}>
                                <div className="eccn-list-header">
                                  <span className="eccn-code">{entry.eccn}</span>
                                  <span
                                    className="eccn-tag"
                                    title={
                                      entry.supplement.heading
                                        ? `Supplement No. ${entry.supplement.number} – ${entry.supplement.heading}`
                                        : `Supplement No. ${entry.supplement.number}`
                                    }
                                  >
                                    {`Supp. No. ${entry.supplement.number}`}
                                  </span>
                                </div>
                                {entry.title && <span className="eccn-title">{entry.title}</span>}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </aside>
    
                      <div className="eccn-detail">
                        {activeEccn ? (
                          <article>
                            <header className="eccn-header">
                              <h3>
                                <span className="eccn-code">{activeEccn.eccn}</span>
                                {activeEccn.title && <span className="eccn-title">{activeEccn.title}</span>}
                              </h3>
                              <dl className="eccn-meta">
                                <div>
                                  <dt>Supplement</dt>
                                  <dd>
                                    {activeEccn.supplement
                                      ? `Supplement No. ${activeEccn.supplement.number}` +
                                        (activeEccn.supplement.heading
                                          ? ` – ${activeEccn.supplement.heading}`
                                          : '')
                                      : '–'}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Category</dt>
                                  <dd>{activeEccn.category ?? '–'}</dd>
                                </div>
                                <div>
                                  <dt>Group</dt>
                                  <dd>{activeEccn.group ?? '–'}</dd>
                                </div>
                                <div>
                                  <dt>Breadcrumbs</dt>
                                  <dd>
                                    {activeEccn.breadcrumbs.length > 0
                                      ? activeEccn.breadcrumbs.join(' › ')
                                      : '–'}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Parent ECCN</dt>
                                  <dd>
                                    {activeEccn.parentEccn ? (
                                      <div className="eccn-meta-eccn-list">
                                        <button
                                          type="button"
                                          className="eccn-reference-button"
                                          onClick={(event) =>
                                            handlePreviewEccn(activeEccn.parentEccn!, event.currentTarget)
                                          }
                                          aria-label={`View ECCN ${activeEccn.parentEccn}`}
                                          title={`View ECCN ${activeEccn.parentEccn}`}
                                        >
                                          {activeEccn.parentEccn}
                                        </button>
                                      </div>
                                    ) : (
                                      '–'
                                    )}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Child ECCNs</dt>
                                  <dd>
                                    {activeEccn.childEccns && activeEccn.childEccns.length > 0
                                      ? (
                                          <div className="eccn-meta-eccn-list">
                                            {activeEccn.childEccns.map((childEccn) => (
                                              <button
                                                type="button"
                                                className="eccn-reference-button"
                                                onClick={(event) => handlePreviewEccn(childEccn, event.currentTarget)}
                                                aria-label={`View ECCN ${childEccn}`}
                                                title={`View ECCN ${childEccn}`}
                                                key={childEccn}
                                              >
                                                {childEccn}
                                              </button>
                                            ))}
                                          </div>
                                        )
                                      : '–'}
                                  </dd>
                                </div>
                              </dl>
                            </header>
                            {highLevelFields.length > 0 && (
                              <dl className="eccn-high-level">
                                {highLevelFields.map((field) => (
                                  <div className="eccn-high-level-row" key={field.id}>
                                    <dt>{field.label}</dt>
                                    <dd>
                                      {field.blocks.map((block, index) => (
                                        <EccnContentBlockView
                                          entry={block}
                                          key={`${field.id}-${index}`}
                                          onPreviewEccn={handlePreviewEccn}
                                          className="high-level-content"
                                        />
                                      ))}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            )}
                            <section className="eccn-children">
                              <h4>ECCN Children</h4>
                              {eccnChildren.length > 0 ? (
                                <div className="eccn-children-tree">
                                  {eccnChildren.map((child, index) => {
                                    const key = getNodeAnchorId(child) ?? `eccn-child-${index}`;
                                    return (
                                      <EccnNodeView
                                        node={child}
                                        level={1}
                                        key={key}
                                        onPreviewEccn={handlePreviewEccn}
                                        activeNode={focusedNode}
                                        activePath={focusedPath}
                                      />
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="help-text">This ECCN does not have any child entries.</p>
                              )}
                            </section>
                          </article>
                        ) : (
                          <div className="placeholder">No ECCNs match the current filter.</div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="placeholder">
                      No ECCNs were parsed from the selected version. Try refreshing the dataset.
                    </div>
                  )}
                </>
              ) : null}
    
              {!dataset && !loadingDataset && (
                <div className="placeholder">Select or fetch a version to explore the CCL.</div>
              )}
            </section>
          </div>
        ) : null}
        {activeTab === 'history' ? (
          <EccnHistoryView
            versions={versions}
            options={historyOptions}
            loadHistory={ensureHistory}
            loadingVersions={loadingVersions}
            onNavigateToEccn={handleNavigateToEccn}
            query={historyQuery}
            onQueryChange={setHistoryQuery}
            selectedCode={historySelectedEccn}
            onSelectedCodeChange={setHistorySelectedEccn}
          />
        ) : null}
        {activeTab === 'trade' ? (
          <div className="trade-layout">
            <TradeDataView
              onNavigateToEccn={handleNavigateToEccn}
              query={tradeQuery}
              onQueryChange={setTradeQuery}
            />
          </div>
        ) : null}
        {activeTab === 'federal-register' ? (
          <FederalRegisterTimeline
            documents={federalDocuments}
            versions={versions}
            loading={loadingFederalDocuments}
            error={federalDocumentsError}
            generatedAt={federalDocumentsGeneratedAt}
            missingEffectiveDates={federalDocumentsMissingDates}
            notYetAvailableEffectiveDates={federalDocumentsNotYetAvailableDates}
          />
        ) : null}
        {activeTab === 'settings' ? (
          <div className="settings-layout">
            <VersionSettings
              defaultDate={defaultDate}
              selectedDate={selectedDate}
              versions={versions}
              onReparseAll={handleReparseAll}
              onLoad={handleLoadNewVersion}
              refreshing={refreshing}
              error={error}
              federalDocumentsGeneratedAt={federalDocumentsGeneratedAt}
              federalDocumentsRefreshing={refreshingFederalDocuments}
              onRefreshFederalDocuments={refreshFederalDocuments}
              federalDocumentsStatus={federalDocumentsStatus}
              federalDocumentsError={federalDocumentsError}
              federalDocumentsProgress={federalDocumentsProgress}
            />
            <section className="panel settings-info">
              <header className="panel-header">
                <h2>How data caching works</h2>
              </header>
              <p>
                The Explorer stores downloaded Commerce Control List data on the server, including the raw
                XML source and parsed JSON that powers the interface. Re-parsing rebuilds every stored
                version from the XML files, while "Download &amp; parse" fetches a specific edition on demand
                and keeps the XML up to date when it is older than a month.
              </p>
              <p className="help-text">
                Raw XML files are cached locally on the server and automatically refreshed the next time you
                fetch a version after 30 days, keeping data fresh without repeatedly downloading large files.
              </p>
            </section>
          </div>
        ) : null}
      </main>
      <footer className="app-footer">
        <p>
          Data source:{' '}
          <a
            href="https://www.ecfr.gov/on/2025-09-25/title-15/subtitle-B/chapter-VII/subchapter-C/part-774"
            target="_blank"
            rel="noreferrer"
          >
            eCFR (Title 15, Part 774)
          </a>
        </p>
        <p className="fine-print">The data is cached locally for offline analysis.</p>
      </footer>
      {showScrollTop ? (
        <button
          type="button"
          className="scroll-to-top"
          onClick={handleScrollToTop}
          aria-label="Back to top"
        >
          <span aria-hidden="true">↑</span>
          <span>Back to top</span>
        </button>
      ) : null}
      {activeTab === 'explorer' && eccnPreview && previewPosition ? (
        <div className="eccn-preview-overlay">
          <div
            className="eccn-preview-card"
            ref={previewCardRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={previewTitleId}
            aria-describedby={previewBodyId}
            data-position={previewPosition.position}
            style={{
              top: previewPosition.top,
              left: previewPosition.left,
              maxWidth: previewPosition.maxWidth,
            }}
            tabIndex={-1}
          >
            <header className="eccn-preview-header">
              <div className="eccn-preview-heading">
                <span className="eccn-preview-code" id={previewTitleId}>
                  {eccnPreview.displayEccn}
                </span>
                {previewHeading ? <p className="eccn-preview-title">{previewHeading}</p> : null}
              </div>
              <button
                type="button"
                className="eccn-preview-close"
                onClick={handleClosePreview}
                aria-label="Close ECCN preview"
              >
                <span aria-hidden="true">×</span>
              </button>
            </header>
            <div className="eccn-preview-body" id={previewBodyId}>
              {previewEntry ? (
                <>
                  <dl className="eccn-preview-meta">
                    <div>
                      <dt>Supplement</dt>
                      <dd>
                        {previewEntry.supplement
                          ? `Supp. No. ${previewEntry.supplement.number}` +
                            (previewEntry.supplement.heading
                              ? ` – ${previewEntry.supplement.heading}`
                              : '')
                          : '–'}
                      </dd>
                    </div>
                    <div>
                      <dt>Category</dt>
                      <dd>{previewEntry.category ?? '–'}</dd>
                    </div>
                    <div>
                      <dt>Group</dt>
                      <dd>{previewEntry.group ?? '–'}</dd>
                    </div>
                    <div>
                      <dt>Breadcrumbs</dt>
                      <dd>
                        {previewEntry.breadcrumbs.length > 0
                          ? previewEntry.breadcrumbs.join(' › ')
                          : '–'}
                      </dd>
                    </div>
                  </dl>
                </>
              ) : (
                <p className="eccn-preview-empty">
                  This ECCN was referenced in the text but is not part of the loaded supplements. Selecting
                  "Open ECCN" will try to locate it in the dataset.
                </p>
              )}
            </div>
            <div className="eccn-preview-actions">
              <button type="button" className="button primary" onClick={handleConfirmPreview}>
                Open ECCN
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
