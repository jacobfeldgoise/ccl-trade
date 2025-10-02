import { useCallback, useEffect, useMemo, useState } from 'react';

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

const ISO_DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

function getYearLabel(value: string | null): string {
  if (!value) {
    return 'Unknown';
  }

  const match = ISO_DATE_ONLY_REGEX.exec(value.trim());
  if (match) {
    return match[1];
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown';
  }

  return String(parsed.getUTCFullYear());
}

interface TimelineItem {
  doc: FederalRegisterDocument;
  effectiveDate: string | null;
  supplementsLabel: string;
  anchorId: string;
  version?: VersionSummary;
}

interface TimelineNavItem {
  label: string;
  anchorId: string;
}

export function FederalRegisterTimeline({
  documents,
  versions,
  loading,
  error,
  generatedAt,
}: FederalRegisterTimelineProps) {
  const { timelineItems, navItems, totalDocuments, cachedDocumentCount } = useMemo(() => {
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

    const seenLabels = new Set<string>();
    const navEntries: TimelineNavItem[] = [];
    const items: TimelineItem[] = sortedDocuments.map((doc, index) => {
      const effectiveDate = getEffectiveDate(doc);
      const anchorId = `fr-doc-${index}`;
      const version = doc.effectiveOn ? versionMap.get(doc.effectiveOn) : undefined;
      const supplementsLabel = doc.supplements.length
        ? doc.supplements.map((number) => `Supplement No. ${number}`).join(', ')
        : '—';

      const label = getYearLabel(effectiveDate);
      if (!seenLabels.has(label)) {
        seenLabels.add(label);
        navEntries.push({ label, anchorId });
      }

      return {
        doc,
        effectiveDate,
        supplementsLabel,
        anchorId,
        version,
      };
    });

    const cachedCount = items.reduce((total, item) => (item.version ? total + 1 : total), 0);

    return {
      timelineItems: items,
      navItems: navEntries,
      totalDocuments: sortedDocuments.length,
      cachedDocumentCount: cachedCount,
    };
  }, [documents, versions]);

  const [activeAnchor, setActiveAnchor] = useState<string | null>(null);

  useEffect(() => {
    if (!navItems.length) {
      setActiveAnchor(null);
      return;
    }

    setActiveAnchor((previous) => {
      if (previous && navItems.some((item) => item.anchorId === previous)) {
        return previous;
      }
      return navItems[0].anchorId;
    });
  }, [navItems]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!navItems.length) {
      return;
    }

    const handleScroll = () => {
      const offset = 160;
      let current: string | null = navItems[0]?.anchorId ?? null;

      for (const item of navItems) {
        const element = document.getElementById(item.anchorId);
        if (!element) {
          continue;
        }

        const rect = element.getBoundingClientRect();
        if (rect.top - offset <= 0) {
          current = item.anchorId;
        } else {
          break;
        }
      }

      setActiveAnchor(current);
    };

    handleScroll();

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [navItems]);

  const handleNavigate = useCallback((anchorId: string) => {
    if (typeof document === 'undefined') {
      return;
    }

    const element = document.getElementById(anchorId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setActiveAnchor(anchorId);
  }, []);

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
            <span className="fr-meta-value">{formatNumber(totalDocuments)}</span>
          </div>
          <div className="fr-meta-item">
            <span className="fr-meta-label">Effective dates cached</span>
            <span className="fr-meta-value">{formatNumber(cachedDocumentCount)}</span>
          </div>
          <div className="fr-meta-item">
            <span className="fr-meta-label">Data refreshed</span>
            <span className="fr-meta-value">{generatedAt ? formatDateTime(generatedAt) : 'Unknown'}</span>
          </div>
        </div>
      </header>

      <div className="fr-content">
        {navItems.length > 0 && (
          <nav className="fr-timeline-nav" aria-label="Federal Register timeline years">
            {navItems.map((item) => {
              const isActive = activeAnchor === item.anchorId;
              return (
                <button
                  key={item.anchorId}
                  type="button"
                  className={`fr-nav-button${isActive ? ' active' : ''}`}
                  onClick={() => handleNavigate(item.anchorId)}
                  aria-current={isActive ? 'true' : undefined}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        )}

        <div className="fr-timeline-area">
          {error && <div className="alert error">{error}</div>}
          {loading && <div className="alert info">Loading Federal Register documents…</div>}

          {!loading && totalDocuments === 0 && !error && (
            <div className="fr-empty">
              <h3>No Federal Register documents captured yet</h3>
              <p>
                Use the Settings tab to refresh the Federal Register metadata. Documents will appear here
                after they are downloaded from the API.
              </p>
            </div>
          )}

          {timelineItems.length > 0 && (
            <ol className="fr-timeline">
              {timelineItems.map(({ doc, effectiveDate, supplementsLabel, anchorId, version }, index) => {
                return (
                  <li
                    key={doc.documentNumber ?? `${doc.title}-${effectiveDate ?? 'unknown'}`}
                    id={anchorId}
                    className="fr-timeline-item"
                    aria-label={`Federal Register document ${index + 1}`}
                  >
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
                              <span className="fr-status cached">Stored {formatDateTime(version.fetchedAt)}</span>
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
        </div>
      </div>
    </section>
  );
}
