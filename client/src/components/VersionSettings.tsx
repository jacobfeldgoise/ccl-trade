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
  onRedownloadXml: (date: string) => Promise<void> | void;
  error?: string | null;
}

export function VersionSettings({
  defaultDate,
  selectedDate,
  versions,
  refreshing,
  onReparseAll,
  onLoad,
  onRedownloadXml,
  error,
}: VersionSettingsProps) {
  const [manualDate, setManualDate] = useState('');
  const [redownloadDate, setRedownloadDate] = useState('');

  useEffect(() => {
    if (selectedDate && !manualDate) {
      setManualDate(selectedDate);
    }
  }, [selectedDate, manualDate]);

  useEffect(() => {
    if (selectedDate) {
      setRedownloadDate(selectedDate);
    }
  }, [selectedDate]);

  const selectedVersion = useMemo(
    () => versions.find((version) => version.date === selectedDate),
    [versions, selectedDate]
  );

  const redownloadTarget = useMemo(
    () => versions.find((version) => version.date === redownloadDate),
    [versions, redownloadDate]
  );

  const canRedownload = Boolean(redownloadTarget?.canRedownloadXml);

  const redownloadHelpText = (() => {
    if (!redownloadDate) {
      return 'Select a stored version to enable raw XML redownloads.';
    }
    if (!redownloadTarget) {
      return 'The selected date is not stored locally.';
    }
    if (!redownloadTarget.rawDownloadedAt) {
      return 'The raw XML has not been downloaded yet; use “Download & parse” to fetch it.';
    }
    if (!redownloadTarget.canRedownloadXml) {
      return 'Raw XML can only be redownloaded if the existing copy is older than 30 days.';
    }
    return `Last downloaded ${formatDateTime(redownloadTarget.rawDownloadedAt)}.`;
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

  const handleRedownloadSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (redownloadDate && canRedownload) {
      onRedownloadXml(redownloadDate);
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
        {selectedVersion?.rawDownloadedAt ? (
          <p className="help-text subtle">
            Selected version raw XML downloaded {formatDateTime(selectedVersion.rawDownloadedAt)}.
          </p>
        ) : null}
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
        <p className="help-text">
          Downloads the selected CCL version, stores the raw XML, and parses it for offline use.
        </p>
      </form>

      <form className="control-group" onSubmit={handleRedownloadSubmit}>
        <h3>Redownload raw XML</h3>
        <div className="inline-controls">
          <input
            id="settings-redownload-date"
            className="control"
            type="date"
            value={redownloadDate}
            onChange={(event) => setRedownloadDate(event.target.value)}
            max={defaultDate}
          />
          <button
            type="submit"
            className="button"
            disabled={!redownloadDate || refreshing || !canRedownload}
          >
            {refreshing ? 'Processing…' : 'Redownload raw XML'}
          </button>
        </div>
        <p className="help-text">{redownloadHelpText}</p>
      </form>

      {error ? <div className="alert error">{error}</div> : null}
    </section>
  );
}
