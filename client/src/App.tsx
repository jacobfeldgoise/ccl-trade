import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { getCcl, getVersions, refreshCcl } from './api';
import {
  CclDataset,
  CclSupplement,
  EccnEntry,
  VersionSummary,
  VersionsResponse,
} from './types';
import { VersionControls } from './components/VersionControls';
import { EccnNodeView } from './components/EccnNodeView';
import { formatDateTime, formatNumber } from './utils/format';

const ECCN_BASE_PATTERN = /^[0-9][A-Z][0-9]{3}$/;
const ECCN_SEGMENT_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const ECCN_ALLOWED_CHARS_PATTERN = /^[0-9A-Z.\-\s]+$/;

type EccnQueryResult = {
  code: string;
  segments: string[];
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

function parseEccnSegments(value: string | null | undefined): string[] | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  const baseMatch = normalized.match(/^([0-9][A-Z][0-9]{3})/);
  if (!baseMatch) {
    return null;
  }

  const segments = [baseMatch[1]];
  let remainder = normalized.slice(baseMatch[1].length);

  while (remainder.startsWith('.')) {
    remainder = remainder.slice(1);
    const segmentMatch = remainder.match(/^[A-Z0-9-]+/);
    if (!segmentMatch) {
      break;
    }
    segments.push(segmentMatch[0]);
    remainder = remainder.slice(segmentMatch[0].length);
  }

  return segments;
}

function normalizeSearchText(value: string | null | undefined): string {
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

function buildEccnSearchTarget(entry: EccnEntry): string {
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

function extractEccnQuery(value: string | null | undefined): EccnQueryResult | null {
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

  const parts = upper.split('.');
  if (parts.length === 0) {
    return null;
  }

  const base = parts[0]?.replace(/\s+/g, '') ?? '';
  if (!ECCN_BASE_PATTERN.test(base)) {
    return null;
  }

  const segments = [base];

  for (let index = 1; index < parts.length; index += 1) {
    const segment = parts[index]?.trim();
    if (!segment || segment.includes(' ')) {
      return null;
    }
    if (!ECCN_SEGMENT_PATTERN.test(segment)) {
      return null;
    }
    segments.push(segment);
  }

  return {
    code: segments.join('.'),
    segments,
  };
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
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [defaultDate, setDefaultDate] = useState<string | undefined>();
  const [selectedDate, setSelectedDate] = useState<string | undefined>();
  const [dataset, setDataset] = useState<CclDataset | null>(null);
  const [selectedEccn, setSelectedEccn] = useState<string | undefined>();
  const [eccnFilter, setEccnFilter] = useState('');
  const [selectedSupplements, setSelectedSupplements] = useState<string[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [loadingDataset, setLoadingDataset] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipNextLoad = useRef(false);

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

  const handleSelectVersion = (date: string) => {
    if (date === selectedDate) {
      return;
    }
    setSelectedDate(date);
  };

  const handleRefreshVersion = async (date: string) => {
    setRefreshing(true);
    setError(null);
    try {
      const data = await refreshCcl(date);
      skipNextLoad.current = true;
      setDataset(data);
      setSelectedDate(date);
      setEccnFilter('');
      setSelectedEccn(undefined);
      await loadVersions();
    } catch (err) {
      setError(`Unable to refresh version ${date}: ${getErrorMessage(err)}`);
    } finally {
      setRefreshing(false);
    }
  };

  const handleLoadNewVersion = async (date: string) => {
    await handleRefreshVersion(date);
  };

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

  const searchableEccns = useMemo(() => {
    return allEccns.map((entry) => ({
      entry,
      searchText: buildEccnSearchTarget(entry),
    }));
  }, [allEccns]);

  const filteredEccns: EccnEntry[] = useMemo(() => {
    const normalizedTerm = normalizeSearchText(eccnFilter);
    const tokens = normalizedTerm.split(/\s+/).filter(Boolean);
    const eccnQuery = extractEccnQuery(eccnFilter);
    const queryCode = eccnQuery?.code ?? null;
    const querySegments = eccnQuery?.segments ?? null;

    if (selectedSupplements.length === 0) {
      return [];
    }

    return searchableEccns
      .filter(({ entry, searchText }) => {
        if (!selectedSupplements.includes(entry.supplement.number)) {
          return false;
        }
        if (queryCode && querySegments) {
          const entryCode = entry.eccn.toUpperCase();
          if (entryCode === queryCode) {
            return true;
          }
          if (entryCode.startsWith(`${queryCode}.`) || entryCode.startsWith(`${queryCode}-`)) {
            return true;
          }

          const entrySegments = parseEccnSegments(entryCode);
          if (!entrySegments || entrySegments[0] !== querySegments[0]) {
            return false;
          }

          return querySegments.every((segment, index) => {
            const entrySegment = entrySegments[index];
            if (!entrySegment) {
              return false;
            }
            if (entrySegment === segment) {
              return true;
            }
            return entrySegment.startsWith(`${segment}-`);
          });
        }
        if (tokens.length === 0) {
          return true;
        }
        return tokens.every((token) => searchText.includes(token));
      })
      .map(({ entry }) => entry);
  }, [searchableEccns, eccnFilter, selectedSupplements]);

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
    if (!filteredEccns.length) {
      setSelectedEccn(undefined);
      return;
    }
    setSelectedEccn((previous) => {
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
  };

  const handleSelectEccn = (value: string) => {
    setSelectedEccn(value);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Commerce Control List Explorer</h1>
        <p>
          Download, store, and browse the U.S. Commerce Control List (15 CFR 774) across historical
          versions.
        </p>
      </header>
      <main className="app-main">
        <aside className="sidebar">
          <VersionControls
            versions={versions}
            defaultDate={defaultDate}
            selectedDate={selectedDate}
            onSelect={handleSelectVersion}
            onRefresh={handleRefreshVersion}
            onLoad={handleLoadNewVersion}
            loadingVersions={loadingVersions}
            refreshing={refreshing}
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
                              <dd>{activeEccn.parentEccn ?? '–'}</dd>
                            </div>
                            <div>
                              <dt>Child ECCNs</dt>
                              <dd>
                                {activeEccn.childEccns && activeEccn.childEccns.length > 0
                                  ? activeEccn.childEccns.join(', ')
                                  : '–'}
                              </dd>
                            </div>
                          </dl>
                        </header>
                        <EccnNodeView node={activeEccn.structure} />
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
    </div>
  );
}

export default App;
