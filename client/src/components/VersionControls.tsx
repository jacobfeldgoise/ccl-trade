import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { VersionSummary } from '../types';
import { formatDate, formatDateTime, formatNumber } from '../utils/format';

interface VersionControlsProps {
  versions: VersionSummary[];
  defaultDate?: string;
  selectedDate?: string;
  onSelect: (date: string) => void;
  onRefresh: (date: string) => Promise<void> | void;
  onLoad: (date: string) => Promise<void> | void;
  loadingVersions: boolean;
  refreshing: boolean;
}

export function VersionControls({
  versions,
  defaultDate,
  selectedDate,
  onSelect,
  onRefresh,
  onLoad,
  loadingVersions,
  refreshing,
}: VersionControlsProps) {
  const [manualDate, setManualDate] = useState('');

  useEffect(() => {
    if (selectedDate && !manualDate) {
      setManualDate(selectedDate);
    }
  }, [selectedDate, manualDate]);

  const sortedVersions = useMemo(() => {
    return [...versions].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [versions]);

  const handleSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const { value } = event.target;
    if (value) {
      onSelect(value);
    }
  };

  const handleRefreshClick = () => {
    if (selectedDate) {
      onRefresh(selectedDate);
    }
  };

  const handleManualSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (manualDate) {
      onLoad(manualDate);
    }
  };

  return (
    <section className="panel version-controls">
      <header className="panel-header">
        <h2>CCL Versions</h2>
        {defaultDate && <p className="subtle">Latest available date: {formatDate(defaultDate)}</p>}
      </header>

      <div className="control-group">
        <label htmlFor="version-select">Stored versions</label>
        <select
          id="version-select"
          className="control"
          value={selectedDate ?? ''}
          onChange={handleSelectChange}
          disabled={loadingVersions || refreshing || sortedVersions.length === 0}
        >
          {sortedVersions.length === 0 && <option value="">No versions cached</option>}
          {sortedVersions.map((version) => (
            <option key={version.date} value={version.date}>
              {`${version.date} (fetched ${formatDateTime(version.fetchedAt)})`}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button"
          onClick={handleRefreshClick}
          disabled={!selectedDate || refreshing}
        >
          {refreshing ? 'Refreshing…' : 'Refresh selected'}
        </button>
      </div>

      <form className="control-group" onSubmit={handleManualSubmit}>
        <label htmlFor="manual-date">Fetch a different version</label>
        <div className="inline-controls">
          <input
            id="manual-date"
            className="control"
            type="date"
            value={manualDate}
            onChange={(event) => setManualDate(event.target.value)}
            max={defaultDate}
          />
          <button type="submit" className="button primary" disabled={!manualDate || refreshing}>
            {refreshing ? 'Loading…' : 'Fetch & store'}
          </button>
        </div>
        <p className="help-text">
          Downloads and parses the selected CCL version, storing it locally for reuse.
        </p>
      </form>

      {sortedVersions.length > 0 && (
        <div className="control-group">
          <h3>Stored version details</h3>
          <ul className="version-list">
            {sortedVersions.map((version) => (
              <li key={`summary-${version.date}`} className={version.date === selectedDate ? 'active' : ''}>
                <div>
                  <strong>{version.date}</strong>
                  {version.date === defaultDate && <span className="badge">Latest</span>}
                </div>
                <dl>
                  <div>
                    <dt>Fetched</dt>
                    <dd>{formatDateTime(version.fetchedAt)}</dd>
                  </div>
                  <div>
                    <dt>Nodes</dt>
                    <dd>{formatNumber(version.counts?.totalNodes)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
