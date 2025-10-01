import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import {
  CclDataset,
  EccnContentBlock,
  EccnEntry,
  EccnNode,
  VersionSummary,
} from '../types';
import { formatDateTime, formatNumber } from '../utils/format';
import { EccnNodeView } from './EccnNodeView';

interface HistorySearchOption {
  entry: EccnEntry;
  normalizedCode: string;
  searchText: string;
}

interface EccnHistoryViewProps {
  versions: VersionSummary[];
  options: HistorySearchOption[];
  ensureDataset: (date: string) => Promise<CclDataset>;
  loadingVersions: boolean;
  onNavigateToEccn: (eccn: string) => void;
}

type HistoryChildDetail = {
  code: string;
  normalized: string;
  node: EccnNode | null;
  text: string;
};

type HistoryVersionEntry = {
  version: string;
  fetchedAt: string;
  sourceUrl: string;
  entry: EccnEntry | null;
  childDetails: HistoryChildDetail[];
  childMap: Map<string, HistoryChildDetail>;
};

type ChangeStatus = 'added' | 'removed' | 'changed' | 'unchanged';

type ChangeSummary = {
  added: number;
  removed: number;
  changed: number;
};

function normalizeCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

function normalizeSearchValue(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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

function findNodeByIdentifier(node: EccnNode | undefined, target: string): EccnNode | null {
  if (!node || !target) {
    return null;
  }
  const normalizedTarget = normalizeCode(target);
  const stack: EccnNode[] = [node];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const identifier = current.identifier ? normalizeCode(current.identifier) : null;
    const heading = !identifier && current.heading ? normalizeCode(current.heading) : null;

    if (identifier === normalizedTarget || heading === normalizedTarget) {
      return current;
    }

    if (current.children && current.children.length > 0) {
      stack.push(...current.children);
    }
  }

  return null;
}

function extractNodePlainText(node: EccnNode | null): string {
  if (!node) {
    return '';
  }

  const parts: string[] = [];

  if (node.heading && node.heading !== node.identifier) {
    parts.push(node.heading.trim());
  } else if (!node.heading && node.label) {
    parts.push(node.label.trim());
  }

  if (node.content && node.content.length > 0) {
    node.content.forEach((block) => {
      const text = getBlockPlainText(block).trim();
      if (text) {
        parts.push(text);
      }
    });
  }

  if (node.children && node.children.length > 0) {
    node.children.forEach((child) => {
      if (child.isEccn && !child.boundToParent) {
        return;
      }
      const childText = extractNodePlainText(child);
      if (childText) {
        parts.push(childText);
      }
    });
  }

  return parts.join('\n').replace(/\s+\n/g, '\n').trim();
}

function buildChildDetails(entry: EccnEntry): HistoryChildDetail[] {
  const root = entry.structure;
  if (!root) {
    return [];
  }

  const details: HistoryChildDetail[] = [];
  const seen = new Set<string>();

  const addDetail = (code: string, node: EccnNode | null) => {
    const normalized = normalizeCode(code);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    details.push({
      code: node?.identifier ?? code,
      normalized,
      node,
      text: extractNodePlainText(node),
    });
  };

  (entry.childEccns ?? []).forEach((code) => {
    const node = findNodeByIdentifier(root, code);
    addDetail(code, node);
  });

  root.children?.forEach((child) => {
    if (!child.isEccn || !child.identifier) {
      return;
    }
    addDetail(child.identifier, child);
  });

  return details;
}

function findEntryInDataset(dataset: CclDataset, normalizedCode: string): EccnEntry | null {
  if (!dataset.supplements) {
    return null;
  }

  for (const supplement of dataset.supplements) {
    if (!supplement.eccns) {
      continue;
    }
    for (const entry of supplement.eccns) {
      if (normalizeCode(entry.eccn) === normalizedCode) {
        return entry;
      }
    }
  }
  return null;
}

function determineChangeStatus(
  current: HistoryChildDetail | undefined,
  previous: HistoryChildDetail | undefined
): ChangeStatus {
  if (current && !previous) {
    return 'added';
  }
  if (!current && previous) {
    return 'removed';
  }
  if (!current && !previous) {
    return 'unchanged';
  }
  return current.text === previous.text ? 'unchanged' : 'changed';
}

function summarizeChanges(
  entry: HistoryVersionEntry,
  previous: HistoryVersionEntry | undefined,
  childOrder: Array<{ normalized: string }>
): ChangeSummary {
  return childOrder.reduce(
    (acc, child) => {
      const current = entry.childMap.get(child.normalized);
      const prior = previous?.childMap.get(child.normalized);
      const status = determineChangeStatus(current, prior);
      if (status === 'added') {
        acc.added += 1;
      } else if (status === 'removed') {
        acc.removed += 1;
      } else if (status === 'changed') {
        acc.changed += 1;
      }
      return acc;
    },
    { added: 0, removed: 0, changed: 0 } satisfies ChangeSummary
  );
}

function renderTextParagraphs(text: string): JSX.Element {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return <p className="history-child-placeholder">No captured content for this child ECCN.</p>;
  }
  return (
    <div className="history-child-text">
      {lines.map((line, index) => (
        <p key={`history-line-${index}`}>{line}</p>
      ))}
    </div>
  );
}

export function EccnHistoryView({
  versions,
  options,
  ensureDataset,
  loadingVersions,
  onNavigateToEccn,
}: EccnHistoryViewProps) {
  const [query, setQuery] = useState('');
  const [selectedCode, setSelectedCode] = useState('');
  const [historyEntries, setHistoryEntries] = useState<HistoryVersionEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const normalizedQuery = useMemo(() => normalizeSearchValue(query), [query]);
  const normalizedSelected = useMemo(() => normalizeCode(selectedCode), [selectedCode]);

  const filteredOptions = useMemo(() => {
    if (!normalizedQuery && !query.trim()) {
      return options;
    }

    const codeQuery = normalizeCode(query);
    const tokens = normalizedQuery ? normalizedQuery.split(/\s+/).filter(Boolean) : [];

    return options.filter((option) => {
      if (codeQuery && option.normalizedCode.includes(codeQuery)) {
        return true;
      }
      if (tokens.length === 0) {
        return false;
      }
      return tokens.every((token) => option.searchText.includes(token));
    });
  }, [options, normalizedQuery, query]);

  const limitedOptions = useMemo(() => filteredOptions.slice(0, 200), [filteredOptions]);

  const selectedOption = useMemo(
    () => options.find((option) => option.normalizedCode === normalizedSelected) ?? null,
    [options, normalizedSelected]
  );

  useEffect(() => {
    if (!selectedCode) {
      return;
    }
    const normalized = normalizeCode(selectedCode);
    if (!options.some((option) => option.normalizedCode === normalized)) {
      setSelectedCode('');
    }
  }, [options, selectedCode]);

  useEffect(() => {
    if (!normalizedSelected || versions.length === 0) {
      setHistoryEntries([]);
      setHistoryError(null);
      setLoadingHistory(false);
      return;
    }

    let cancelled = false;

    const loadHistory = async () => {
      setLoadingHistory(true);
      setHistoryError(null);
      try {
        const sortedVersions = [...versions].sort((a, b) => a.date.localeCompare(b.date));
        const entries: HistoryVersionEntry[] = [];

        for (const version of sortedVersions) {
          if (cancelled) {
            return;
          }
          const dataset = await ensureDataset(version.date);
          if (cancelled) {
            return;
          }
          const entry = findEntryInDataset(dataset, normalizedSelected);
          const childDetails = entry ? buildChildDetails(entry) : [];
          entries.push({
            version: version.date,
            fetchedAt: dataset.fetchedAt,
            sourceUrl: dataset.sourceUrl,
            entry: entry ?? null,
            childDetails,
            childMap: new Map(childDetails.map((detail) => [detail.normalized, detail])),
          });
        }

        if (cancelled) {
          return;
        }

        const firstIndex = entries.findIndex((entry) => entry.entry);
        const trimmed = firstIndex >= 0 ? entries.slice(firstIndex) : [];
        setHistoryEntries(trimmed);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setHistoryError(
          error instanceof Error ? error.message : 'Failed to load ECCN history for the selected code.'
        );
        setHistoryEntries([]);
      } finally {
        if (!cancelled) {
          setLoadingHistory(false);
        }
      }
    };

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [normalizedSelected, ensureDataset, versions]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }
    const normalized = normalizeCode(trimmed);
    const match = options.find((option) => option.normalizedCode === normalized);
    if (match) {
      setSelectedCode(match.entry.eccn);
      setQuery(match.entry.eccn);
    } else {
      setSelectedCode(normalized);
      setQuery(normalized);
    }
  };

  const handleSelectOption = (option: HistorySearchOption) => {
    setSelectedCode(option.entry.eccn);
    setQuery(option.entry.eccn);
  };

  const childOrder = useMemo(() => {
    const seen = new Set<string>();
    const order: Array<{ normalized: string; display: string }> = [];
    historyEntries.forEach((entry) => {
      entry.childDetails.forEach((detail) => {
        if (!seen.has(detail.normalized)) {
          seen.add(detail.normalized);
          order.push({ normalized: detail.normalized, display: detail.code });
        }
      });
    });
    return order;
  }, [historyEntries]);

  const versionsTracked = historyEntries.length;
  const uniqueChildCount = childOrder.length;
  const earliestVersion = historyEntries[0]?.version;
  const latestVersion = historyEntries[historyEntries.length - 1]?.version;

  const selectedDisplayCode = selectedOption?.entry.eccn ?? (selectedCode ? selectedCode.toUpperCase() : '');
  const selectedTitle = selectedOption?.entry.title ?? selectedOption?.entry.heading ?? null;

  const statusLabels: Record<ChangeStatus, string> = {
    added: 'Added',
    removed: 'Removed',
    changed: 'Changed',
    unchanged: 'Unchanged',
  };

  return (
    <div className="history-layout">
      <aside className="history-sidebar">
        <section className="history-panel">
          <header className="history-panel-header">
            <h2>Compare child ECCNs</h2>
            <p>
              Review how the language of child ECCNs has evolved across stored versions of the Commerce
              Control List.
            </p>
          </header>
          <form className="history-search" onSubmit={handleSubmit}>
            <label htmlFor="history-query">Find an ECCN</label>
            <input
              id="history-query"
              className="control"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by code or keyword"
              autoComplete="off"
            />
            <p className="help-text">
              Showing {formatNumber(limitedOptions.length)} of {formatNumber(options.length)} ECCNs.
              {filteredOptions.length > limitedOptions.length ? ' Narrow your search to see more.' : ''}
            </p>
          </form>
          <ul className="history-option-list" role="list">
            {limitedOptions.map((option) => (
              <li key={option.normalizedCode}>
                <button
                  type="button"
                  className="history-option-button"
                  data-active={option.normalizedCode === normalizedSelected}
                  onClick={() => handleSelectOption(option)}
                >
                  <span className="history-option-code">{option.entry.eccn}</span>
                  {option.entry.title ? (
                    <span className="history-option-title">{option.entry.title}</span>
                  ) : option.entry.heading ? (
                    <span className="history-option-title">{option.entry.heading}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </aside>
      <section className="history-area">
        {loadingVersions ? (
          <div className="alert info">Loading stored CCL versions…</div>
        ) : null}
        {!loadingVersions && versions.length === 0 ? (
          <div className="placeholder">
            No stored versions are available yet. Refresh a CCL dataset to begin tracking history.
          </div>
        ) : null}
        {selectedDisplayCode ? (
          <>
            <header className="history-header">
              <div>
                <h2>
                  <span className="history-selected-code">{selectedDisplayCode}</span>
                  {selectedTitle ? <span className="history-selected-title">{selectedTitle}</span> : null}
                </h2>
                {selectedOption?.entry.supplement ? (
                  <p className="history-selected-meta">
                    {`Supplement No. ${selectedOption.entry.supplement.number}`}
                    {selectedOption.entry.supplement.heading
                      ? ` – ${selectedOption.entry.supplement.heading}`
                      : ''}
                  </p>
                ) : null}
              </div>
              <div className="history-actions">
                <button
                  type="button"
                  className="button primary"
                  onClick={() => onNavigateToEccn(selectedDisplayCode)}
                  disabled={!versionsTracked}
                >
                  View in explorer
                </button>
              </div>
            </header>

            {loadingHistory ? <div className="alert info">Loading ECCN history…</div> : null}
            {historyError ? <div className="alert error">{historyError}</div> : null}

            {!loadingHistory && !historyError && historyEntries.length === 0 ? (
              <div className="placeholder">
                The selected ECCN was not found in the stored versions. Refresh additional datasets to
                capture its history.
              </div>
            ) : null}

            {historyEntries.length > 0 ? (
              <>
                <section className="history-summary" aria-label="History summary">
                  <article className="history-summary-card">
                    <span className="history-summary-label">Versions compared</span>
                    <span className="history-summary-value">{formatNumber(versionsTracked)}</span>
                    {earliestVersion && latestVersion ? (
                      <span className="history-summary-context">
                        {earliestVersion === latestVersion
                          ? `Version ${earliestVersion}`
                          : `${earliestVersion} → ${latestVersion}`}
                      </span>
                    ) : null}
                  </article>
                  <article className="history-summary-card">
                    <span className="history-summary-label">Tracked child ECCNs</span>
                    <span className="history-summary-value">{formatNumber(uniqueChildCount)}</span>
                    <span className="history-summary-context">Across stored versions</span>
                  </article>
                  <article className="history-summary-card">
                    <span className="history-summary-label">Most recent retrieval</span>
                    <span className="history-summary-value">
                      {formatDateTime(historyEntries[historyEntries.length - 1]?.fetchedAt ?? '')}
                    </span>
                    <span className="history-summary-context">From eCFR API</span>
                  </article>
                </section>

                <div className="history-timeline">
                  {historyEntries.map((entry, index) => {
                    const previous = index > 0 ? historyEntries[index - 1] : undefined;
                    const changeSummary = summarizeChanges(entry, previous, childOrder);
                    return (
                      <article className="history-version-card" key={`history-version-${entry.version}`}>
                        <header className="history-version-header">
                          <div>
                            <h3>Version {entry.version}</h3>
                            <p className="history-version-meta">
                              Retrieved {formatDateTime(entry.fetchedAt)} from the eCFR.
                            </p>
                          </div>
                          <div className="history-change-summary">
                            <span>
                              <strong>{formatNumber(changeSummary.added)}</strong> added
                            </span>
                            <span>
                              <strong>{formatNumber(changeSummary.changed)}</strong> changed
                            </span>
                            <span>
                              <strong>{formatNumber(changeSummary.removed)}</strong> removed
                            </span>
                          </div>
                        </header>
                        {entry.entry ? (
                          childOrder.length > 0 ? (
                            <ul className="history-child-list" role="list">
                              {childOrder.map((child) => {
                                const current = entry.childMap.get(child.normalized);
                                const prior = previous?.childMap.get(child.normalized);
                                const status = determineChangeStatus(current, prior);
                                const detailNode = current?.node ?? null;
                                return (
                                  <li
                                    key={`${entry.version}-${child.normalized}`}
                                    className="history-child-item"
                                    data-status={status}
                                  >
                                    <details open={status === 'added' || status === 'changed'}>
                                      <summary>
                                        <span className="history-child-code">{child.display}</span>
                                        <span className="history-status-badge" data-status={status}>
                                          {statusLabels[status]}
                                        </span>
                                      </summary>
                                      <div className="history-child-body">
                                        {current ? (
                                          detailNode ? (
                                            <div className="history-child-node">
                                              <EccnNodeView node={detailNode} level={0} />
                                            </div>
                                          ) : current.text ? (
                                            renderTextParagraphs(current.text)
                                          ) : (
                                            <p className="history-child-placeholder">
                                              Content for this child ECCN is unavailable in this version.
                                            </p>
                                          )
                                        ) : (
                                          <p className="history-child-placeholder">
                                            This child ECCN is not present in this version.
                                          </p>
                                        )}
                                      </div>
                                    </details>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <p className="help-text">
                              No child ECCNs were captured for this entry in the stored datasets.
                            </p>
                          )
                        ) : (
                          <div className="placeholder">
                            This ECCN was not published in the {entry.version} dataset.
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </>
            ) : null}
          </>
        ) : (
          <div className="placeholder">Select an ECCN to view its history.</div>
        )}
      </section>
    </div>
  );
}
