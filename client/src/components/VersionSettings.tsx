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
  federalDocumentsGeneratedAt: string | null;
  federalDocumentsRefreshing: boolean;
  onRefreshFederalDocuments: () => Promise<void> | void;
  federalDocumentsStatus?: string | null;
  federalDocumentsError?: string | null;
  federalDocumentsProgress?: string | null;
}

export function VersionSettings({
  defaultDate,
  selectedDate,
  versions,
  refreshing,
  onReparseAll,
  onLoad,
  error,
  federalDocumentsGeneratedAt,
  federalDocumentsRefreshing,
  onRefreshFederalDocuments,
  federalDocumentsStatus,
  federalDocumentsError,
  federalDocumentsProgress,
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
    )}. It is still within the 30 day cache window, so fetching is temporarily disabled.`;
  })();

  const isManualFetchDisabled =
    !manualDate ||
    refreshing ||
    (!!manualTarget?.rawDownloadedAt && manualTarget?.canRedownloadXml === false);

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

  const handleFederalRefreshClick = () => {
    onRefreshFederalDocuments();
  };

  const latestDateLabel = defaultDate ? formatDate(defaultDate) : null;
  const federalRegisterLastRefreshed = federalDocumentsGeneratedAt
    ? `Last refreshed ${formatDateTime(federalDocumentsGeneratedAt)}.`
    : 'No Federal Register metadata has been cached yet.';

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
          <button type="submit" className="button primary" disabled={isManualFetchDisabled}>
            {refreshing ? 'Loading…' : 'Fetch & store'}
          </button>
        </div>
        <p className="help-text">{manualHelpText}</p>
      </form>

      <div className="control-group">
        <h3>Federal Register timeline</h3>
        <p className="help-text">
          Downloads the latest Federal Register metadata for Supplements 1, 5, 6, and 7 to 15 CFR 774 and
          stores it on the server for the timeline view.
        </p>
        <button
          type="button"
          className="button"
          onClick={handleFederalRefreshClick}
          disabled={federalDocumentsRefreshing}
        >
          {federalDocumentsRefreshing ? 'Refreshing…' : 'Refresh Federal Register data'}
        </button>
        <p className="help-text subtle">{federalRegisterLastRefreshed}</p>
        {federalDocumentsProgress ? (
          <div className="help-text subtle status-log">{federalDocumentsProgress}</div>
        ) : null}
        {federalDocumentsStatus ? <div className="alert info">{federalDocumentsStatus}</div> : null}
        {federalDocumentsError ? <div className="alert error">{federalDocumentsError}</div> : null}
      </div>

      {error ? <div className="alert error">{error}</div> : null}
    </section>
  );
}
