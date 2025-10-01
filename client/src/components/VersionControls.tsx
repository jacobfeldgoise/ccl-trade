import { ChangeEvent, useMemo } from 'react';
import { VersionSummary } from '../types';
import { formatDate, formatDateTime, formatNumber } from '../utils/format';

interface VersionControlsProps {
  versions: VersionSummary[];
  defaultDate?: string;
  selectedDate?: string;
  onSelect: (date: string) => void;
  loadingVersions: boolean;
}

export function VersionControls({
  versions,
  defaultDate,
  selectedDate,
  onSelect,
  loadingVersions,
}: VersionControlsProps) {
  const sortedVersions = useMemo(() => {
    return [...versions].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [versions]);

  const handleSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const { value } = event.target;
    if (value) {
      onSelect(value);
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
          disabled={loadingVersions || sortedVersions.length === 0}
        >
          {sortedVersions.length === 0 && <option value="">No versions cached</option>}
          {sortedVersions.map((version) => (
            <option key={version.date} value={version.date}>
              {`${version.date} (fetched ${formatDateTime(version.fetchedAt)})`}
            </option>
          ))}
        </select>
        <p className="help-text">Select a cached version to explore in the CCL browser.</p>
      </div>

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
                    <dt>ECCNs</dt>
                    <dd>{formatNumber(version.counts?.eccns ?? 0)}</dd>
                  </div>
                  <div>
                    <dt>Raw XML</dt>
                    <dd>
                      {version.rawDownloadedAt
                        ? formatDateTime(version.rawDownloadedAt)
                        : 'Not downloaded'}
                    </dd>
                  </div>
                  {version.rawDownloadedAt && !version.canRedownloadXml ? (
                    <div>
                      <dt>Redownload</dt>
                      <dd>Available after 30 days</dd>
                    </div>
                  ) : null}
                </dl>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
