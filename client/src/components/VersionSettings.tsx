import { FormEvent, useEffect, useMemo, useState } from 'react';
import { VersionSummary } from '../types';
import { formatDate, formatDateTime } from '../utils/format';

interface VersionSettingsProps {
  defaultDate?: string;
  selectedDate?: string;
  versions: VersionSummary[];
  refreshing: boolean;
  onReparseAll: () => Promise<void> | void;
  onLoad: (date: string) => Promise<void> | void;
  error?: string | null;
}

export function VersionSettings({
  defaultDate,
  selectedDate,
  versions,
  refreshing,
  onReparseAll,
  onLoad,
  error,
}: VersionSettingsProps) {
  const [manualDate, setManualDate] = useState('');

  useEffect(() => {
    if (selectedDate && !manualDate) {
      setManualDate(selectedDate);
    }
  }, [selectedDate, manualDate]);

  const selectedVersion = useMemo(
    () => versions.find((version) => version.date === selectedDate),
    [versions, selectedDate]
  );

  const manualTarget = useMemo(
    () => versions.find((version) => version.date === manualDate),
    [versions, manualDate]
  );

  const manualHelpText = (() => {
    if (!manualDate) {
      return 'Downloads the selected CCL version, stores the raw XML, and parses it for offline use.';
    }
    if (!manualTarget) {
      return 'The selected date is not cached yet; fetching will download and parse the dataset.';
    }
    if (!manualTarget.rawDownloadedAt) {
      return 'Raw XML for this version has not been downloaded yet; fetching will download and parse it now.';
    }
    if (manualTarget.canRedownloadXml) {
      return `Raw XML last downloaded ${formatDateTime(
        manualTarget.rawDownloadedAt
      )}. Fetching will refresh the XML before parsing because it is older than 30 days.`;
    }
    return `Raw XML last downloaded ${formatDateTime(
      manualTarget.rawDownloadedAt
    )}. Fetching will reuse the cached XML until it is at least 30 days old.`;
  })();

  const selectedVersionRawText = (() => {
    if (!selectedVersion) {
      return null;
    }
    if (!selectedVersion.rawDownloadedAt) {
      return 'Selected version raw XML has not been downloaded yet.';
    }
    if (selectedVersion.canRedownloadXml) {
      return `Selected version raw XML downloaded ${formatDateTime(
        selectedVersion.rawDownloadedAt
      )}. Fetching this version will refresh the XML before parsing.`;
    }
    return `Selected version raw XML downloaded ${formatDateTime(
      selectedVersion.rawDownloadedAt
    )}. Refresh will be available after 30 days.`;
  })();

  const handleReparseClick = () => {
    onReparseAll();
  };

  const handleManualSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (manualDate) {
      onLoad(manualDate);
    }
  };

  const latestDateLabel = defaultDate ? formatDate(defaultDate) : null;

  return (
    <section className="panel settings-panel">
      <header className="panel-header">
        <h2>CCL Data Settings</h2>
        {latestDateLabel ? <p className="subtle">Latest available date: {latestDateLabel}</p> : null}
      </header>

      <div className="control-group">
        <h3>Re-parse stored data</h3>
        <p className="help-text">
          Re-generates all stored JSON data from the downloaded raw XML files. Use this after
          updating parsing logic or redownloading XML files.
        </p>
        <button type="button" className="button" onClick={handleReparseClick} disabled={refreshing}>
          {refreshing ? 'Re-parsing…' : 'Re-parse all stored XML'}
        </button>
        {selectedVersionRawText ? <p className="help-text subtle">{selectedVersionRawText}</p> : null}
      </div>

      <form className="control-group" onSubmit={handleManualSubmit}>
        <h3>Download &amp; parse a specific version</h3>
        <div className="inline-controls">
          <input
            id="settings-manual-date"
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
        <p className="help-text">{manualHelpText}</p>
      </form>

      {error ? <div className="alert error">{error}</div> : null}
    </section>
  );
}
