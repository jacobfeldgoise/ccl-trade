import { FederalRegisterDocument, VersionSummary } from '../types';
import { formatDate, formatDateTime, formatNumber } from '../utils/format';

interface FederalRegisterTimelineProps {
  documents: FederalRegisterDocument[];
  versions: VersionSummary[];
  loading: boolean;
  error: string | null;
  generatedAt: string | null;
}

function getEffectiveDate(doc: FederalRegisterDocument): string | null {
  return doc.effectiveOn || doc.publicationDate || null;
}

export function FederalRegisterTimeline({
  documents,
  versions,
  loading,
  error,
  generatedAt,
}: FederalRegisterTimelineProps) {
  const versionMap = new Map<string, VersionSummary>();
  versions.forEach((version) => {
    versionMap.set(version.date, version);
  });

  const sortedDocuments = [...documents].sort((a, b) => {
    const dateA = getEffectiveDate(a) ?? '';
    const dateB = getEffectiveDate(b) ?? '';
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateA < dateB ? 1 : dateA > dateB ? -1 : 0;
  });

  const cachedDocuments = sortedDocuments.filter((doc) => {
    const effectiveDate = doc.effectiveOn;
    return effectiveDate ? versionMap.has(effectiveDate) : false;
  });

  return (
    <section className="fr-layout">
      <header className="fr-header">
        <div>
          <h2>Federal Register Activity</h2>
          <p>
            Rules impacting Supplements 1, 5, 6, and 7 to 15 CFR 774 and whether their effective dates have
            been captured in the local CCL archive.
          </p>
        </div>
        <div className="fr-meta">
          <div className="fr-meta-item">
            <span className="fr-meta-label">Documents tracked</span>
            <span className="fr-meta-value">{formatNumber(sortedDocuments.length)}</span>
          </div>
          <div className="fr-meta-item">
            <span className="fr-meta-label">Effective dates cached</span>
            <span className="fr-meta-value">{formatNumber(cachedDocuments.length)}</span>
          </div>
          <div className="fr-meta-item">
            <span className="fr-meta-label">Data refreshed</span>
            <span className="fr-meta-value">{generatedAt ? formatDateTime(generatedAt) : 'Unknown'}</span>
          </div>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}
      {loading && <div className="alert info">Loading Federal Register documents…</div>}

      {!loading && sortedDocuments.length === 0 && !error && (
        <div className="fr-empty">
          <h3>No Federal Register documents captured yet</h3>
          <p>
            Run <code>npm run update-fr-docs</code> to query the Federal Register API and populate the data
            set used by this view.
          </p>
        </div>
      )}

      {sortedDocuments.length > 0 && (
        <ol className="fr-timeline">
          {sortedDocuments.map((doc) => {
            const effectiveDate = getEffectiveDate(doc);
            const version = doc.effectiveOn ? versionMap.get(doc.effectiveOn) : undefined;
            const supplementsLabel = doc.supplements.length
              ? doc.supplements.map((number) => `Supplement No. ${number}`).join(', ')
              : '—';
            return (
              <li key={doc.documentNumber ?? `${doc.title}-${effectiveDate ?? 'unknown'}`} className="fr-timeline-item">
                <div className="fr-timeline-date">
                  <div className="fr-date-primary">
                    <span className="fr-date-label">Effective</span>
                    <time dateTime={doc.effectiveOn ?? undefined}>{formatDate(doc.effectiveOn ?? undefined)}</time>
                  </div>
                  <div className="fr-date-secondary">
                    <span className="fr-date-label">Published</span>
                    <time dateTime={doc.publicationDate ?? undefined}>{formatDate(doc.publicationDate ?? undefined)}</time>
                  </div>
                </div>
                <div className="fr-card" data-cached={version ? 'true' : 'false'}>
                  <header className="fr-card-header">
                    <h3>
                      {doc.htmlUrl ? (
                        <a href={doc.htmlUrl} target="_blank" rel="noreferrer">
                          {doc.title ?? 'Untitled rule'}
                        </a>
                      ) : (
                        doc.title ?? 'Untitled rule'
                      )}
                    </h3>
                    <div className="fr-card-tags">
                      {doc.documentNumber && <span className="fr-tag">FR Doc. {doc.documentNumber}</span>}
                      {doc.citation && <span className="fr-tag">{doc.citation}</span>}
                      {doc.type && <span className="fr-tag">{doc.type}</span>}
                    </div>
                  </header>
                  {doc.action && <p className="fr-card-action">{doc.action}</p>}
                  <dl className="fr-card-details">
                    <div>
                      <dt>Supplements affected</dt>
                      <dd>{supplementsLabel}</dd>
                    </div>
                    <div>
                      <dt>Agencies</dt>
                      <dd>{doc.agencies.length ? doc.agencies.join(', ') : '—'}</dd>
                    </div>
                    <div>
                      <dt>CCL cache status</dt>
                      <dd>
                        {version ? (
                          <span className="fr-status cached">
                            Stored {formatDateTime(version.fetchedAt)}
                          </span>
                        ) : effectiveDate ? (
                          <span className="fr-status missing">Not yet cached</span>
                        ) : (
                          <span className="fr-status unknown">Effective date unknown</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
