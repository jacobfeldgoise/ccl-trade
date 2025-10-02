const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatDate(dateString?: string): string {
  if (!dateString) return 'Unknown';

  const isoDateOnlyMatch = ISO_DATE_ONLY.exec(dateString.trim());
  if (isoDateOnlyMatch) {
    // Interpret API-provided YYYY-MM-DD dates as calendar dates without a
    // timezone component so they display consistently regardless of the
    // viewer's locale.
    const [, year, month, day] = isoDateOnlyMatch;
    const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) {
      return dateString;
    }
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      timeZone: 'UTC',
    }).format(date);
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return dateString;
  }
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

export function formatDateTime(dateString?: string): string {
  if (!dateString) return 'Unknown';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return dateString;
  }
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatNumber(value: number | undefined): string {
  if (typeof value !== 'number') return '–';
  return value.toLocaleString();
}

interface FormatUsdOptions {
  compact?: boolean;
  maximumFractionDigits?: number;
}

export function formatUsd(value: number | undefined, options: FormatUsdOptions = {}): string {
  if (typeof value !== 'number') return '–';
  const { compact = false, maximumFractionDigits } = options;
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: maximumFractionDigits ?? (compact ? 1 : 0),
  });
}

export function formatPercent(value: number | undefined, fractionDigits = 1): string {
  if (typeof value !== 'number') return '–';
  return `${(value * 100).toFixed(fractionDigits)}%`;
}
