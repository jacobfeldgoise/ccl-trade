import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useState } from 'react';
import { EccnNode } from '../types';
import { EccnContentBlockView } from './EccnContentBlock';

interface EccnNodeViewProps {
  node: EccnNode;
  level?: number;
  onPreviewEccn?: (eccn: string, anchor: HTMLElement) => void;
  activeNode?: EccnNode;
  activePath?: Set<EccnNode>;
}

export function EccnNodeView({
  node,
  level = 0,
  onPreviewEccn,
  activeNode,
  activePath,
}: EccnNodeViewProps) {
  const isRootEccn = Boolean(node.isEccn && level === 0);
  const isAccordion = Boolean(node.isEccn && !node.boundToParent && !isRootEccn);
  const hasDetails = Boolean((node.content?.length ?? 0) > 0 || (node.children?.length ?? 0) > 0);
  const isCollapsible = isAccordion && hasDetails;
  const isActive = activeNode === node;
  const isInActivePath = activePath?.has(node) ?? false;
  const shouldForceOpen = isCollapsible ? level < 2 || isInActivePath : true;
  const [open, setOpen] = useState(() => shouldForceOpen);

  useEffect(() => {
    setOpen(shouldForceOpen);
  }, [shouldForceOpen]);

  const labelText = useMemo(() => {
    const parts: string[] = [];
    if (node.identifier) parts.push(node.identifier);
    if (node.heading && node.heading !== node.identifier) parts.push(node.heading);
    if (!parts.length && node.label) parts.push(node.label);
    if (!parts.length && node.heading) parts.push(node.heading);
    return parts.join(' – ') || 'Details';
  }, [node.identifier, node.heading, node.label]);

  const labelIdentifier = node.identifier;
  const labelHeading = useMemo(() => {
    if (node.heading && node.heading !== node.identifier) {
      return node.heading;
    }
    if (!node.identifier && node.heading) {
      return node.heading;
    }
    if (!node.identifier && !node.heading && node.label) {
      return node.label;
    }
    return undefined;
  }, [node.heading, node.identifier, node.label]);

  const labelFallback = !labelIdentifier && !labelHeading ? labelText : undefined;

  const anchorId = useMemo(() => {
    if (node.identifier) {
      return `eccn-node-${node.identifier.replace(/[^\w.-]+/g, '-')}`;
    }
    if (node.heading) {
      return `eccn-node-${node.heading.replace(/[^\w.-]+/g, '-').toLowerCase()}`;
    }
    return undefined;
  }, [node.identifier, node.heading]);

  const showLabel = !node.boundToParent;

  const containerClasses = useMemo(() => {
    const classes = ['eccn-node', `level-${level}`];
    if (isCollapsible) {
      classes.push('accordion', 'has-details');
      if (open) {
        classes.push('is-open');
      }
    } else if (isAccordion) {
      classes.push('accordion', 'no-details');
    } else {
      classes.push('static');
    }
    if (isActive) {
      classes.push('active');
    }
    if (isInActivePath && !isActive) {
      classes.push('active-path');
    }
    return classes.filter(Boolean).join(' ');
  }, [isAccordion, isActive, isInActivePath, isCollapsible, level, open]);

  const handleIdentifierPreview = onPreviewEccn && node.identifier
    ? (event: ReactMouseEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        onPreviewEccn(node.identifier!, event.currentTarget as HTMLElement);
      }
    : undefined;

  const identifierElement = labelIdentifier
    ? handleIdentifierPreview
      ? (
          <button
            type="button"
            className="node-identifier is-clickable"
            onClick={handleIdentifierPreview}
            aria-haspopup="dialog"
          >
            {labelIdentifier}
          </button>
        )
      : (
          <span className="node-identifier">{labelIdentifier}</span>
        )
    : null;

  if (!isCollapsible) {
    return (
      <div className={containerClasses} id={anchorId}>
        {showLabel ? (
          <div
            className="node-label"
            aria-label={labelText}
            title={labelText}
            aria-disabled={isAccordion && !hasDetails ? true : undefined}
          >
            {identifierElement}
            {labelHeading ? <span className="node-heading">{labelHeading}</span> : null}
            {!labelIdentifier && !labelHeading ? (
              <span className="node-heading">{labelFallback}</span>
            ) : null}
          </div>
        ) : null}
        <div className="node-body">
          {node.content?.map((entry, index) => (
            <EccnContentBlockView
              entry={entry}
              key={`${anchorId || labelText}-content-${index}`}
              onPreviewEccn={onPreviewEccn}
            />
          ))}
          {node.children?.map((child, index) => (
            <EccnNodeView
              node={child}
              level={level + 1}
              key={`${anchorId || labelText}-child-${index}`}
              onPreviewEccn={onPreviewEccn}
              activeNode={activeNode}
              activePath={activePath}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <details
      className={containerClasses}
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      id={anchorId}
    >
      <summary>
        <span className="node-toggle-icon" aria-hidden="true">
          ▸
        </span>
        <span className="node-label" aria-label={labelText} title={labelText}>
          {identifierElement}
          {labelHeading ? <span className="node-heading">{labelHeading}</span> : null}
          {!labelIdentifier && !labelHeading ? (
            <span className="node-heading">{labelFallback}</span>
          ) : null}
        </span>
      </summary>
      <div className="node-body">
        {node.content?.map((entry, index) => (
          <EccnContentBlockView
            entry={entry}
            key={`${anchorId || labelText}-content-${index}`}
            onPreviewEccn={onPreviewEccn}
          />
        ))}
        {node.children?.map((child, index) => (
          <EccnNodeView
            node={child}
            level={level + 1}
            key={`${anchorId || labelText}-child-${index}`}
            onPreviewEccn={onPreviewEccn}
            activeNode={activeNode}
            activePath={activePath}
          />
        ))}
      </div>
    </details>
  );
}
