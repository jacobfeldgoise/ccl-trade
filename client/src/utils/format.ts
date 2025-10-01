export function formatDate(dateString?: string): string {
  if (!dateString) return 'Unknown';
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
