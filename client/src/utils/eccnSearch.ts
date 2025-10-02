import type { EccnEntry } from '../types';

export const ECCN_BASE_PATTERN = /^[0-9][A-Z][0-9]{3}$/;
export const ECCN_SEGMENT_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
export const ECCN_ALLOWED_CHARS_PATTERN = /^[0-9A-Z.\-\s]+$/;

export type EccnSegment = {
  raw: string;
  parts: string[];
};

export type ParsedEccnCode = {
  code: string;
  segments: EccnSegment[];
};

function stripWrappingPunctuation(value: string): string {
  let working = value.trim();

  while (working && /[).,;:–—]+$/u.test(working)) {
    working = working.replace(/[).,;:–—]+$/u, '').trimEnd();
  }

  while (working && /^[([{"'`]+/u.test(working)) {
    working = working.replace(/^[([{"'`]+/u, '').trimStart();
  }

  return working;
}

export function parseNormalizedEccn(value: string | null | undefined): ParsedEccnCode | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().toUpperCase();
  if (!trimmed) {
    return null;
  }

  const squished = trimmed.replace(/\s+/g, '');
  if (!squished) {
    return null;
  }

  if (squished.length < 5) {
    return null;
  }

  const base = squished.slice(0, 5);
  if (!ECCN_BASE_PATTERN.test(base)) {
    return null;
  }
  const segments: EccnSegment[] = [
    {
      raw: base,
      parts: base.split('-'),
    },
  ];

  let index = base.length;

  while (index < squished.length) {
    if (squished[index] !== '.') {
      return null;
    }
    index += 1;

    const segmentStart = index;
    while (index < squished.length && squished[index] !== '.') {
      index += 1;
    }

    const segmentRaw = squished.slice(segmentStart, index);
    if (!segmentRaw) {
      return null;
    }
    if (!ECCN_SEGMENT_PATTERN.test(segmentRaw)) {
      return null;
    }

    segments.push({
      raw: segmentRaw,
      parts: segmentRaw.split('-'),
    });
  }

  return {
    code: segments.map((segment) => segment.raw).join('.'),
    segments,
  };
}

export function eccnSegmentsMatchQuery(
  querySegments: EccnSegment[],
  entrySegments: EccnSegment[]
): boolean {
  if (!querySegments.length || !entrySegments.length) {
    return false;
  }

  if (entrySegments[0].raw !== querySegments[0].raw) {
    return false;
  }

  if (entrySegments.length < querySegments.length) {
    return false;
  }

  return querySegments.every((querySegment, index) => {
    const target = entrySegments[index];
    if (!target) {
      return false;
    }

    if (index === 0) {
      return target.raw === querySegment.raw;
    }

    if (target.raw === querySegment.raw) {
      return true;
    }

    if (target.parts.length < querySegment.parts.length) {
      return false;
    }

    return querySegment.parts.every((part, partIndex) => target.parts[partIndex] === part);
  });
}

export function normalizeSearchText(value: string | null | undefined): string {
  if (!value) {
    return '';
  }

  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function buildEccnSearchTarget(entry: EccnEntry): string {
  const fields: Array<string | null | undefined> = [
    entry.eccn,
    entry.heading,
    entry.title,
    entry.category ? `category ${entry.category}` : null,
    entry.group ? `group ${entry.group}` : null,
    entry.parentEccn ? `parent ${entry.parentEccn}` : null,
    entry.childEccns && entry.childEccns.length > 0 ? entry.childEccns.join(' ') : null,
    entry.breadcrumbs.length > 0 ? entry.breadcrumbs.join(' ') : null,
    entry.supplement?.heading,
    entry.supplement?.number,
    entry.supplement ? `supplement ${entry.supplement.number}` : null,
    entry.supplement ? `supp no ${entry.supplement.number}` : null,
  ];

  return normalizeSearchText(fields.filter(Boolean).join(' '));
}

export function extractEccnQuery(value: string | null | undefined): ParsedEccnCode | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const stripped = stripWrappingPunctuation(trimmed);
  if (!stripped) {
    return null;
  }

  const upper = stripped.toUpperCase();
  if (!ECCN_ALLOWED_CHARS_PATTERN.test(upper)) {
    return null;
  }

  return parseNormalizedEccn(upper);
}
