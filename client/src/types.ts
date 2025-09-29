export interface CclContentEntry {
  tag: string;
  html?: string;
  text?: string;
  id?: string;
}

export interface CclNode {
  type: string;
  identifier?: string;
  heading?: string;
  attributes?: Record<string, string>;
  content?: CclContentEntry[];
  children?: CclNode[];
}

export interface CclDataset {
  version: string;
  sourceUrl: string;
  counts: {
    totalNodes: number;
  };
  date: string;
  fetchedAt: string;
  part: CclNode;
}

export interface VersionSummary {
  date: string;
  fetchedAt: string;
  sourceUrl: string;
  counts: {
    totalNodes: number;
  };
}

export interface VersionsResponse {
  defaultDate?: string;
  versions: VersionSummary[];
}
