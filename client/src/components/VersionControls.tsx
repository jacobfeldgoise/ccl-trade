import { useMemo } from 'react';
import { VersionSummary } from '../types';
import { formatDate, formatNumber } from '../utils/format';

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

  return (
    <section className="panel version-controls">
      <header className="panel-header">
        <h2>CCL Versions</h2>
        {defaultDate && <p className="subtle">Latest available date: {formatDate(defaultDate)}</p>}
      </header>

      <div className="control-group">
        <div className="control-group-header">
          <span className="control-label">Stored versions</span>
          {sortedVersions.length > 0 && (
            <span className="control-label-meta">
              {formatNumber(sortedVersions.length)} cached
            </span>
          )}
        </div>

        {sortedVersions.length === 0 ? (
          <div className="empty-state">No versions cached.</div>
        ) : (
          <ul className="version-selector" role="list">
            {sortedVersions.map((version) => {
              const isActive = version.date === selectedDate;
              const xmlStatus = version.rawDownloadedAt
                ? version.canRedownloadXml
                  ? 'XML ready for refresh'
                  : 'XML cached'
                : 'XML not cached';

              return (
                <li key={`summary-${version.date}`}>
                  <label
                    className={`version-option${isActive ? ' active' : ''}${loadingVersions ? ' disabled' : ''}`}
                  >
                    <input
                      type="radio"
                      name="stored-version"
                      value={version.date}
                      checked={isActive}
                      onChange={() => onSelect(version.date)}
                      disabled={loadingVersions}
                    />
                    <span className="version-option-content">
                      <span className="version-option-main">
                        <span className="version-option-date">{formatDate(version.date)}</span>
                        {version.date === defaultDate && <span className="badge">Latest</span>}
                      </span>
                      <span className="version-option-sub">
                        <span>{formatNumber(version.counts?.eccns ?? 0)} ECCNs</span>
                        <span className={`version-option-chip${version.rawDownloadedAt ? ' success' : ' muted'}`}>
                          {xmlStatus}
                        </span>
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        <p className="help-text">Select a cached version to explore in the CCL browser.</p>
      </div>
    </section>
  );
}
