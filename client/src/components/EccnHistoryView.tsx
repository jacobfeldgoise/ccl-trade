import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import {
  EccnEntry,
  EccnHistoryLeaf,
  EccnHistoryResponse,
  EccnNode,
  VersionSummary,
} from '../types';
import { formatDateTime, formatNumber } from '../utils/format';
import { EccnNodeView } from './EccnNodeView';
import {
  eccnSegmentsMatchQuery,
  extractEccnQuery,
  normalizeSearchText,
  type EccnSegment,
} from '../utils/eccnSearch';

interface HistorySearchOption {
  entry: EccnEntry;
  normalizedCode: string;
  searchText: string;
  segments: EccnSegment[] | null;
}

interface EccnHistoryViewProps {
  versions: VersionSummary[];
  options: HistorySearchOption[];
  loadHistory: (eccn: string) => Promise<EccnHistoryResponse>;
  loadingVersions: boolean;
  onNavigateToEccn: (eccn: string) => void;
  query?: string;
  onQueryChange?: (value: string) => void;
  selectedCode?: string;
  onSelectedCodeChange?: (value: string) => void;
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
  published: boolean;
  childDetails: HistoryChildDetail[];
  childMap: Map<string, HistoryChildDetail>;
};

type ChangeStatus = 'added' | 'removed' | 'changed' | 'unchanged';

type ChangeSummary = {
  added: number;
  removed: number;
  changed: number;
};

type PreparedLeafVersion = {
  version: string;
  fetchedAt: string | null;
  sourceUrl: string | null;
  text: string;
  structure: EccnNode | null;
  ancestors: string[];
};

type PreparedLeaf = {
  code: string;
  normalized: string;
  versionMap: Map<string, PreparedLeafVersion>;
};

function normalizeCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
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
  if (!current || !previous) {
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

function prepareLeaf(leaf: EccnHistoryLeaf): PreparedLeaf {
  const normalized = normalizeCode(leaf.eccn);
  const versionMap = new Map<string, PreparedLeafVersion>();

  const historyEntries = Array.isArray(leaf.history) ? leaf.history : [];

  historyEntries.forEach((entry) => {
    if (!entry || typeof entry.version !== 'string') {
      return;
    }

    const ancestors = Array.isArray(entry.ancestors)
      ? entry.ancestors.map((ancestor) => normalizeCode(ancestor)).filter(Boolean)
      : [];

    versionMap.set(entry.version, {
      version: entry.version,
      fetchedAt: entry.fetchedAt ?? null,
      sourceUrl: entry.sourceUrl ?? null,
      text: entry.text ?? '',
      structure: entry.structure ?? null,
      ancestors,
    });
  });

  return {
    code: leaf.eccn,
    normalized,
    versionMap,
  };
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
  loadHistory,
  loadingVersions,
  onNavigateToEccn,
  query: initialQuery = '',
  onQueryChange,
  selectedCode: externalSelectedCode = '',
  onSelectedCodeChange,
}: EccnHistoryViewProps) {
  const [query, setQuery] = useState(initialQuery);
  const [selectedCode, setSelectedCode] = useState(externalSelectedCode);
  const [historyData, setHistoryData] = useState<EccnHistoryResponse | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    setSelectedCode(externalSelectedCode);
  }, [externalSelectedCode]);

  const updateSelectedCode = useCallback(
    (value: string) => {
      setSelectedCode(value);
      onSelectedCodeChange?.(value);
    },
    [onSelectedCodeChange]
  );

  const updateQuery = (value: string) => {
    setQuery(value);
    onQueryChange?.(value);
  };

  const normalizedSelected = useMemo(() => normalizeCode(selectedCode), [selectedCode]);

  const normalizedQuery = useMemo(() => normalizeSearchText(query), [query]);
  const querySegments = useMemo(() => extractEccnQuery(query)?.segments ?? null, [query]);
  const queryTokens = useMemo(
    () => (normalizedQuery ? normalizedQuery.split(/\s+/).filter(Boolean) : []),
    [normalizedQuery]
  );
  const trimmedQuery = useMemo(() => query.trim(), [query]);

  const filteredOptions = useMemo(() => {
    if (!trimmedQuery) {
      return options;
    }

    return options.filter(({ searchText, segments }) => {
      if (querySegments) {
        if (!segments) {
          return false;
        }

        return eccnSegmentsMatchQuery(querySegments, segments);
      }

      if (queryTokens.length === 0) {
        return false;
      }

      return queryTokens.every((token) => searchText.includes(token));
    });
  }, [options, trimmedQuery, querySegments, queryTokens]);

  const selectedOption = useMemo(
    () => options.find((option) => option.normalizedCode === normalizedSelected) ?? null,
    [options, normalizedSelected]
  );

  useEffect(() => {
    if (!selectedCode) {
      return;
    }
    if (options.length === 0) {
      return;
    }
    const normalized = normalizeCode(selectedCode);
    if (!options.some((option) => option.normalizedCode === normalized)) {
      updateSelectedCode('');
    }
  }, [options, selectedCode, updateSelectedCode]);

  useEffect(() => {
    if (!normalizedSelected || versions.length === 0) {
      setHistoryData(null);
      setHistoryError(null);
      setLoadingHistory(false);
      return;
    }

    let cancelled = false;

    setLoadingHistory(true);
    setHistoryError(null);

    loadHistory(normalizedSelected)
      .then((data) => {
        if (!cancelled) {
          setHistoryData(data);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setHistoryData(null);
        setHistoryError(
          error instanceof Error
            ? error.message
            : 'Failed to load ECCN history for the selected code.'
        );
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingHistory(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [normalizedSelected, loadHistory, versions]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }
    const normalized = normalizeCode(trimmed);
    const match = options.find((option) => option.normalizedCode === normalized);
    if (match) {
      updateSelectedCode(match.entry.eccn);
      updateQuery(match.entry.eccn);
    } else {
      updateSelectedCode(normalized);
      updateQuery(normalized);
    }
  };

  const handleSelectOption = (option: HistorySearchOption) => {
    updateSelectedCode(option.entry.eccn);
    updateQuery(option.entry.eccn);
  };

  const preparedLeaves = useMemo<PreparedLeaf[]>(() => {
    if (!historyData || !Array.isArray(historyData.leaves)) {
      return [];
    }
    return historyData.leaves
      .map((leaf) => prepareLeaf(leaf))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [historyData]);

  const historyEntries = useMemo<HistoryVersionEntry[]>(() => {
    if (versions.length === 0) {
      return [];
    }

    const sortedVersions = [...versions].sort((a, b) => a.date.localeCompare(b.date));

    const entries = sortedVersions.map<HistoryVersionEntry>((summary) => {
      const childDetails: HistoryChildDetail[] = [];
      const childMap = new Map<string, HistoryChildDetail>();
      let published = false;
      let fetchedAt: string | null = summary.fetchedAt ?? null;
      let sourceUrl: string | null = summary.sourceUrl ?? null;

      preparedLeaves.forEach((leaf) => {
        const record = leaf.versionMap.get(summary.date);
        if (!record) {
          return;
        }

        const detail: HistoryChildDetail = {
          code: leaf.code,
          normalized: leaf.normalized,
          node: record.structure ?? null,
          text: record.text ?? '',
        };

        childDetails.push(detail);
        childMap.set(leaf.normalized, detail);

        if (leaf.normalized === normalizedSelected || record.ancestors.includes(normalizedSelected)) {
          published = true;
        }

        if (!fetchedAt && record.fetchedAt) {
          fetchedAt = record.fetchedAt;
        }
        if (!sourceUrl && record.sourceUrl) {
          sourceUrl = record.sourceUrl;
        }
      });

      return {
        version: summary.date,
        fetchedAt: fetchedAt ?? '',
        sourceUrl: sourceUrl ?? '',
        published,
        childDetails,
        childMap,
      } satisfies HistoryVersionEntry;
    });

    const firstIndex = entries.findIndex((entry) => entry.published);
    return firstIndex >= 0 ? entries.slice(firstIndex) : [];
  }, [preparedLeaves, versions, normalizedSelected]);

  const childOrder = useMemo(() => {
    return preparedLeaves.map((leaf) => ({ normalized: leaf.normalized, display: leaf.code }));
  }, [preparedLeaves]);

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
              onChange={(event) => updateQuery(event.target.value)}
              placeholder="Search by code or keyword"
              autoComplete="off"
            />
            <p className="help-text">
              Showing {formatNumber(filteredOptions.length)} of {formatNumber(options.length)} ECCNs.
            </p>
          </form>
          <ul className="history-option-list" role="list">
            {filteredOptions.map((option) => {
              const isActive = option.normalizedCode === normalizedSelected;
              return (
                <li
                  key={option.normalizedCode}
                  className={`history-option-item${isActive ? ' active' : ''}`}
                >
                  <button
                    type="button"
                    className="history-option-button"
                    onClick={() => handleSelectOption(option)}
                  >
                    <div className="history-option-header">
                      <span className="history-option-code">{option.entry.eccn}</span>
                      {option.entry.supplement ? (
                        <span
                          className="history-option-tag"
                          title={
                            option.entry.supplement.heading
                              ? `Supplement No. ${option.entry.supplement.number} – ${option.entry.supplement.heading}`
                              : `Supplement No. ${option.entry.supplement.number}`
                          }
                        >
                          {`Supp. No. ${option.entry.supplement.number}`}
                        </span>
                      ) : null}
                    </div>
                    {option.entry.title ? (
                      <span className="history-option-title">{option.entry.title}</span>
                    ) : option.entry.heading ? (
                      <span className="history-option-title">{option.entry.heading}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
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
                        {entry.published ? (
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
