import { useCallback, useEffect, useMemo, useState } from 'react';

import { FederalRegisterDocument, VersionSummary } from '../types';
import { formatDate, formatDateTime, formatNumber } from '../utils/format';

interface FederalRegisterTimelineProps {
  documents: FederalRegisterDocument[];
  versions: VersionSummary[];
  loading: boolean;
  error: string | null;
  generatedAt: string | null;
  missingEffectiveDates: string[];
  notYetAvailableEffectiveDates: string[];
}

function getEffectiveDate(doc: FederalRegisterDocument): string | null {
  return doc.effectiveOn || doc.publicationDate || null;
}

const ISO_DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

function normalizeDateValue(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (ISO_DATE_ONLY_REGEX.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }

  return parsed.toISOString().slice(0, 10);
}

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
  missingEffectiveDate: boolean;
  notYetAvailableEffectiveDate: boolean;
  ruleType: string | null;
}

interface TimelineNavItem {
  label: string;
  anchorId: string;
  count: number;
}

function cleanRuleType(action: string | null | undefined): string | null {
  if (!action) {
    return null;
  }

  const normalized = action.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }

  const cleaned = normalized.replace(/[\s.;:,]+$/u, '');
  return cleaned || normalized;
}

export function FederalRegisterTimeline({
  documents,
  versions,
  loading,
  error,
  generatedAt,
  missingEffectiveDates,
  notYetAvailableEffectiveDates,
}: FederalRegisterTimelineProps) {
  const { timelineItems, navItems, totalDocuments, cachedDocumentCount, anchorYearMap } = useMemo(() => {
    const versionMap = new Map<string, VersionSummary>();
    versions.forEach((version) => {
      versionMap.set(version.date, version);
    });

    const missingSet = new Set(
      (missingEffectiveDates ?? [])
        .map((date) => (typeof date === 'string' ? date.trim() : ''))
        .filter((date) => ISO_DATE_ONLY_REGEX.test(date))
    );

    const notYetAvailableSet = new Set(
      (notYetAvailableEffectiveDates ?? [])
        .map((date) => (typeof date === 'string' ? date.trim() : ''))
        .filter((date) => ISO_DATE_ONLY_REGEX.test(date))
    );

    const sortedDocuments = [...documents].sort((a, b) => {
      const dateA = getEffectiveDate(a) ?? '';
      const dateB = getEffectiveDate(b) ?? '';
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateA < dateB ? 1 : dateA > dateB ? -1 : 0;
    });

    const navEntries: TimelineNavItem[] = [];
    const navEntryMap = new Map<string, TimelineNavItem>();
    const anchorYearLookup = new Map<string, string>();
    const items: TimelineItem[] = sortedDocuments.map((doc, index) => {
      const effectiveDateRaw = getEffectiveDate(doc);
      const normalizedEffectiveDate = normalizeDateValue(effectiveDateRaw);
      const effectiveDate = normalizedEffectiveDate ?? effectiveDateRaw?.trim() ?? null;
      const anchorId = `fr-doc-${index}`;
      const version = normalizedEffectiveDate ? versionMap.get(normalizedEffectiveDate) : undefined;
      const supplementsLabel = doc.supplements.length
        ? doc.supplements.map((number) => `Supplement No. ${number}`).join(', ')
        : '—';
      const missingEffectiveDate = normalizedEffectiveDate
        ? missingSet.has(normalizedEffectiveDate)
        : false;
      const notYetAvailableEffectiveDate = normalizedEffectiveDate
        ? notYetAvailableSet.has(normalizedEffectiveDate)
        : false;
      const ruleType = cleanRuleType(doc.action);

      const label = getYearLabel(effectiveDate);
      let navEntry = navEntryMap.get(label);
      if (!navEntry) {
        navEntry = { label, anchorId, count: 0 };
        navEntryMap.set(label, navEntry);
        navEntries.push(navEntry);
      }
      navEntry.count += 1;
      anchorYearLookup.set(anchorId, label);

      return {
        doc,
        effectiveDate,
        supplementsLabel,
        anchorId,
        version,
        missingEffectiveDate,
        notYetAvailableEffectiveDate,
        ruleType,
      };
    });

    const cachedCount = items.reduce((total, item) => (item.version ? total + 1 : total), 0);

    return {
      timelineItems: items,
      navItems: navEntries,
      totalDocuments: sortedDocuments.length,
      cachedDocumentCount: cachedCount,
      anchorYearMap: anchorYearLookup,
    };
  }, [documents, versions, missingEffectiveDates, notYetAvailableEffectiveDates]);

  const [activeAnchor, setActiveAnchor] = useState<string | null>(null);
  const activeYearLabel = useMemo(() => {
    if (!activeAnchor) {
      return null;
    }

    return anchorYearMap.get(activeAnchor) ?? null;
  }, [activeAnchor, anchorYearMap]);

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
                  <span className="fr-nav-label">{item.label}</span>
                  <span className="fr-nav-count">{formatNumber(item.count)}</span>
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
            <>
              <div className="fr-year-indicator" aria-live="polite">
                <span className="fr-year-label">Effective Date</span>
                <span className="fr-year-value">{activeYearLabel ?? '—'}</span>
              </div>
              <ol className="fr-timeline">
                {timelineItems.map(
                  (
                    {
                      doc,
                      effectiveDate,
                      supplementsLabel,
                      anchorId,
                      version,
                      missingEffectiveDate,
                      notYetAvailableEffectiveDate,
                      ruleType,
                    },
                    index
                  ) => {
                    const documentTypeTag = doc.type?.trim() ?? null;
                    const showDocumentTypeTag =
                      documentTypeTag && documentTypeTag.toLowerCase() !== 'rule';
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
                            <time dateTime={doc.effectiveOn ?? undefined}>
                              {formatDate(doc.effectiveOn ?? undefined)}
                            </time>
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
                              {doc.documentNumber && (
                                <span className="fr-tag">FR Doc. {doc.documentNumber}</span>
                              )}
                              {doc.citation && <span className="fr-tag">{doc.citation}</span>}
                              {showDocumentTypeTag && <span className="fr-tag">{documentTypeTag}</span>}
                            </div>
                          </header>
                          {(ruleType || doc.action) && (
                            <p className="fr-card-action">{ruleType ?? doc.action}</p>
                          )}
                          <dl className="fr-card-details">
                            <div>
                              <dt>Published</dt>
                              <dd>
                                <time dateTime={doc.publicationDate ?? undefined}>
                                  {formatDate(doc.publicationDate ?? undefined)}
                                </time>
                              </dd>
                            </div>
                            <div>
                              <dt>Supplements affected</dt>
                              <dd>{supplementsLabel}</dd>
                            </div>
                            <div>
                              <dt>Rule Type</dt>
                              <dd>{ruleType ?? '—'}</dd>
                            </div>
                            <div>
                              <dt>CCL cache status</dt>
                              <dd>
                                {version ? (
                                  <span className="fr-status cached">
                                    Stored {formatDateTime(version.fetchedAt)}
                                  </span>
                                ) : notYetAvailableEffectiveDate ? (
                                  <span className="fr-status pending">Not yet available</span>
                                ) : missingEffectiveDate ? (
                                  <span className="fr-status unavailable">Unavailable</span>
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
                  }
                )}
              </ol>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
