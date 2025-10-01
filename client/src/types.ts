export interface EccnContentBlock {
  type: 'html' | 'text';
  tag?: string;
  html?: string;
  text?: string | null;
  id?: string | null;
}

export interface EccnNode {
  identifier?: string | null;
  label?: string | null;
  heading?: string | null;
  content?: EccnContentBlock[];
  children?: EccnNode[];
  isEccn?: boolean;
  boundToParent?: boolean;
  requireAllChildren?: boolean;
}

export interface EccnEntry {
  eccn: string;
  heading?: string | null;
  title?: string | null;
  category?: string | null;
  group?: string | null;
  breadcrumbs: string[];
  supplement: {
    number: string;
    heading?: string | null;
  };
  structure: EccnNode;
  parentEccn?: string | null;
  childEccns?: string[];
}

export interface SupplementMetadata {
  eccnCount: number;
  categoryCounts: Record<string, number>;
}

export interface CclSupplement {
  number: string;
  heading?: string | null;
  eccns: EccnEntry[];
  metadata: SupplementMetadata;
}

export interface CclDataset {
  version: string;
  sourceUrl: string;
  counts: {
    supplements: number;
    eccns: number;
  };
  date: string;
  fetchedAt: string;
  supplements: CclSupplement[];
}

export interface VersionSummary {
  date: string;
  fetchedAt: string;
  sourceUrl: string;
  counts: {
    supplements: number;
    eccns: number;
  };
}

export interface VersionsResponse {
  defaultDate?: string;
  versions: VersionSummary[];
}

export interface TradeDestinationBreakdown {
  country: string;
  exportValueUsd: number;
  share: number;
}

export interface EccnTradeRecord {
  eccn: string;
  description: string;
  latestYear: number;
  exportValueUsd: number;
  importValueUsd?: number;
  notes?: string;
  topDestinations: TradeDestinationBreakdown[];
}
