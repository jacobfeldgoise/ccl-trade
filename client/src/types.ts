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
  rawDownloadedAt: string | null;
  canRedownloadXml: boolean;
}

export interface VersionsResponse {
  defaultDate?: string;
  versions: VersionSummary[];
}

export interface FederalRegisterDocument {
  documentNumber: string | null;
  title: string | null;
  htmlUrl: string | null;
  publicationDate: string | null;
  effectiveOn: string | null;
  type: string | null;
  action: string | null;
  signingDate: string | null;
  supplements: string[];
  agencies: string[];
  citation: string | null;
  docketIds: string[];
  cfrReferences?: unknown;
}

export interface FederalRegisterDocumentsResponse {
  generatedAt: string | null;
  supplements: string[];
  documentCount: number;
  documents: FederalRegisterDocument[];
}

export interface FederalRegisterRawXmlDownload {
  date: string;
  filePath: string;
}

export interface FederalRegisterRefreshResponse {
  message: string;
  generatedAt: string | null;
  documentCount: number;
  processedDates: { date: string; fetchedAt: string }[];
  rawXmlDownloads: FederalRegisterRawXmlDownload[];
}

export interface FederalRegisterRefreshEvent {
  type: 'progress' | 'complete' | 'error';
  message?: string;
  result?: FederalRegisterRefreshResponse;
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
