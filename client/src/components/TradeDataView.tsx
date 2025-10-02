import { useEffect, useMemo, useState } from 'react';
import { tradeDataByEccn } from '../data/tradeData';
import { formatNumber, formatPercent, formatUsd } from '../utils/format';

interface TradeDataViewProps {
  query?: string;
  onQueryChange?: (value: string) => void;
  onNavigateToEccn?: (eccn: string) => void;
}

export function TradeDataView({
  onNavigateToEccn,
  query: initialQuery = '',
  onQueryChange,
}: TradeDataViewProps) {
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    onQueryChange?.(value);
  };
  const normalizedQuery = query.trim().toLowerCase();

  const filteredRecords = useMemo(() => {
    if (!normalizedQuery) {
      return tradeDataByEccn;
    }
    return tradeDataByEccn.filter((record) => {
      const haystack = `${record.eccn} ${record.description} ${record.notes ?? ''}`.toLowerCase();
      return normalizedQuery.split(/\s+/).every((token) => haystack.includes(token));
    });
  }, [normalizedQuery]);

  const sortedRecords = useMemo(
    () => [...filteredRecords].sort((a, b) => (b.exportValueUsd ?? 0) - (a.exportValueUsd ?? 0)),
    [filteredRecords]
  );

  const totalExportValue = useMemo(
    () => sortedRecords.reduce((total, record) => total + (record.exportValueUsd ?? 0), 0),
    [sortedRecords]
  );

  const totalImportValue = useMemo(
    () => sortedRecords.reduce((total, record) => total + (record.importValueUsd ?? 0), 0),
    [sortedRecords]
  );

  const leadingDestination = useMemo(() => {
    const aggregates = new Map<string, number>();
    sortedRecords.forEach((record) => {
      record.topDestinations.forEach((destination) => {
        aggregates.set(
          destination.country,
          (aggregates.get(destination.country) ?? 0) + destination.exportValueUsd
        );
      });
    });
    let bestCountry: string | null = null;
    let bestValue = 0;
    aggregates.forEach((value, country) => {
      if (value > bestValue) {
        bestCountry = country;
        bestValue = value;
      }
    });
    if (!bestCountry) {
      return null;
    }
    return { country: bestCountry, exportValueUsd: bestValue };
  }, [sortedRecords]);

  return (
    <div className="trade-area">
      <header className="trade-header">
        <div>
          <h2>Trade data by ECCN</h2>
          <p>
            Explore aggregated U.S. export and import values grouped by Export Control Classification
            Number.
          </p>
        </div>
      </header>

      <section className="trade-summary" aria-label="Trade summary">
        <article className="trade-summary-card">
          <span className="trade-summary-label">Records displayed</span>
          <span className="trade-summary-value">{formatNumber(sortedRecords.length)}</span>
          <span className="trade-summary-context">
            of {formatNumber(tradeDataByEccn.length)} tracked ECCNs
          </span>
        </article>
        <article className="trade-summary-card">
          <span className="trade-summary-label">Total export value</span>
          <span className="trade-summary-value">{formatUsd(totalExportValue, { compact: true })}</span>
          <span className="trade-summary-context">Latest reported year</span>
        </article>
        <article className="trade-summary-card">
          <span className="trade-summary-label">Total import value</span>
          <span className="trade-summary-value">{formatUsd(totalImportValue, { compact: true })}</span>
          <span className="trade-summary-context">Latest reported year</span>
        </article>
        {leadingDestination ? (
          <article className="trade-summary-card">
            <span className="trade-summary-label">Leading destination</span>
            <span className="trade-summary-value">{leadingDestination.country}</span>
            <span className="trade-summary-context">
              {formatUsd(leadingDestination.exportValueUsd, { compact: true })} in exports
            </span>
          </article>
        ) : null}
      </section>

      <section className="trade-table-card">
        <div className="control-group trade-controls">
          <label htmlFor="trade-query">Filter ECCNs</label>
          <input
            id="trade-query"
            className="control"
            type="search"
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            placeholder="Search by ECCN, keyword, or notes"
          />
          <p className="help-text">
            Showing {formatNumber(sortedRecords.length)} of {formatNumber(tradeDataByEccn.length)} trade
            records.
          </p>
        </div>

        {sortedRecords.length > 0 ? (
          <div className="trade-table-wrapper">
            <table className="trade-table">
              <thead>
                <tr>
                  <th scope="col">ECCN</th>
                  <th scope="col">Description</th>
                  <th scope="col">Latest year</th>
                  <th scope="col">Export value</th>
                  <th scope="col">Import value</th>
                  <th scope="col">Top destinations</th>
                  {onNavigateToEccn ? <th scope="col" className="trade-table-actions">Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {sortedRecords.map((record) => (
                  <tr key={record.eccn}>
                    <th scope="row">
                      <span className="trade-eccn">{record.eccn}</span>
                    </th>
                    <td>
                      <div className="trade-description">{record.description}</div>
                      {record.notes ? <p className="trade-note">{record.notes}</p> : null}
                    </td>
                    <td className="trade-year">{record.latestYear}</td>
                    <td className="trade-value">{formatUsd(record.exportValueUsd)}</td>
                    <td className="trade-value">{formatUsd(record.importValueUsd)}</td>
                    <td>
                      <ul className="trade-destinations">
                        {record.topDestinations.map((destination) => (
                          <li key={`${record.eccn}-${destination.country}`} className="trade-destination">
                            <span>{destination.country}</span>
                            <span className="trade-destination-metric">
                              {formatUsd(destination.exportValueUsd, { compact: true })}
                              <span className="trade-destination-share">
                                {formatPercent(destination.share, 1)}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    {onNavigateToEccn ? (
                      <td className="trade-table-actions">
                        <button
                          type="button"
                          className="button ghost"
                          onClick={() => onNavigateToEccn(record.eccn)}
                        >
                          View in explorer
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="placeholder trade-empty">No trade data matches the current filter.</div>
        )}
      </section>
    </div>
  );
}
