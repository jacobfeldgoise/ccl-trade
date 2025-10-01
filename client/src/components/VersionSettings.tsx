import { FormEvent, useEffect, useState } from 'react';
import { formatDate } from '../utils/format';

interface VersionSettingsProps {
  defaultDate?: string;
  selectedDate?: string;
  refreshing: boolean;
  onRefresh: (date: string) => Promise<void> | void;
  onLoad: (date: string) => Promise<void> | void;
  error?: string | null;
}

export function VersionSettings({
  defaultDate,
  selectedDate,
  refreshing,
  onRefresh,
  onLoad,
  error,
}: VersionSettingsProps) {
  const [manualDate, setManualDate] = useState('');

  useEffect(() => {
    if (selectedDate && !manualDate) {
      setManualDate(selectedDate);
    }
  }, [selectedDate, manualDate]);

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

  const latestDateLabel = defaultDate ? formatDate(defaultDate) : null;
  const selectedDateLabel = selectedDate ? formatDate(selectedDate) : null;

  return (
    <section className="panel settings-panel">
      <header className="panel-header">
        <h2>CCL Data Settings</h2>
        {latestDateLabel ? <p className="subtle">Latest available date: {latestDateLabel}</p> : null}
      </header>

      <div className="control-group">
        <h3>Refresh stored version</h3>
        <p className="help-text">
          {selectedDateLabel
            ? `Refresh the cached data for the currently selected version (${selectedDateLabel}).`
            : 'Select a stored version from the explorer to enable refreshing.'}
        </p>
        <button
          type="button"
          className="button"
          onClick={handleRefreshClick}
          disabled={!selectedDate || refreshing}
        >
          {refreshing ? 'Refreshing…' : 'Refresh selected version'}
        </button>
      </div>

      <form className="control-group" onSubmit={handleManualSubmit}>
        <h3>Fetch a specific version</h3>
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
          Downloads and parses the selected CCL version, storing it locally for offline use.
        </p>
      </form>

      {error ? <div className="alert error">{error}</div> : null}
    </section>
  );
}
