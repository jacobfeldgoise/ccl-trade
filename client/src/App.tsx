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
  const [supplementFilter, setSupplementFilter] = useState<string>('all');
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
          setSupplementFilter('all');
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
      setSupplementFilter('all');
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

  const filteredEccns: EccnEntry[] = useMemo(() => {
    const term = eccnFilter.trim().toLowerCase();
    return allEccns.filter((entry) => {
      if (supplementFilter !== 'all' && entry.supplement.number !== supplementFilter) {
        return false;
      }
      if (!term) {
        return true;
      }
      const searchTarget = [entry.eccn, entry.heading, entry.title]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchTarget.includes(term);
    });
  }, [allEccns, eccnFilter, supplementFilter]);

  const selectedSupplementInfo = useMemo(() => {
    if (supplementFilter === 'all') {
      return undefined;
    }
    return supplements.find((supplement) => supplement.number === supplementFilter);
  }, [supplementFilter, supplements]);

  const totalEccnCount = allEccns.length;
  const supplementScopeCount =
    supplementFilter === 'all'
      ? totalEccnCount
      : selectedSupplementInfo?.metadata?.eccnCount ?? filteredEccns.length;

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

  const handleSelectSupplementFilter = (value: string) => {
    setSupplementFilter(value);
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
                  <h3>Supplements parsed</h3>
                  <p>{formatNumber(dataset.counts?.supplements ?? 0)}</p>
                </div>
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
                      <label htmlFor="supplement-filter">Supplement</label>
                      <select
                        id="supplement-filter"
                        className="control"
                        value={supplementFilter}
                        onChange={(event) => handleSelectSupplementFilter(event.target.value)}
                      >
                        <option value="all">All supplements</option>
                        {supplements.map((supplement) => (
                          <option key={supplement.number} value={supplement.number}>
                            {`Supplement No. ${supplement.number}`}
                          </option>
                        ))}
                      </select>
                      {selectedSupplementInfo?.heading && (
                        <p className="help-text">{selectedSupplementInfo.heading}</p>
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
                        {supplementFilter === 'all'
                          ? ' across all supplements.'
                          : ` from Supplement No. ${supplementFilter}.`}
                      </p>
                    </div>

                    <ul className="eccn-list">
                      {filteredEccns.map((entry) => (
                        <li
                          key={entry.eccn}
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
