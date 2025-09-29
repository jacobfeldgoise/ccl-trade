import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import { getCcl, getVersions, refreshCcl } from './api';
import { CclDataset, VersionSummary, VersionsResponse } from './types';
import { VersionControls } from './components/VersionControls';
import { CclNodeView } from './components/CclNodeView';
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
                  <h3>Part heading</h3>
                  <p>{dataset.part.heading ?? 'Part 774'}</p>
                </div>
                <div>
                  <h3>Total nodes parsed</h3>
                  <p>{formatNumber(dataset.counts?.totalNodes)}</p>
                </div>
                <div>
                  <h3>Stored locally</h3>
                  <p>{formatDateTime(dataset.fetchedAt)}</p>
                </div>
              </section>
              <div className="tree-container">
                <CclNodeView node={dataset.part} />
              </div>
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
