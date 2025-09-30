import { useEffect, useMemo, useState } from 'react';
import { EccnNode } from '../types';
import { EccnContentBlockView } from './EccnContentBlock';

interface EccnNodeViewProps {
  node: EccnNode;
  level?: number;
  onSelectEccn?: (eccn: string) => void;
  activeNode?: EccnNode;
  activePath?: Set<EccnNode>;
}

export function EccnNodeView({
  node,
  level = 0,
  onSelectEccn,
  activeNode,
  activePath,
}: EccnNodeViewProps) {
  const isRootEccn = Boolean(node.isEccn && level === 0);
  const isAccordion = Boolean(node.isEccn && !node.boundToParent && !isRootEccn);
  const isActive = activeNode === node;
  const isInActivePath = activePath?.has(node) ?? false;
  const shouldForceOpen = isAccordion ? level < 2 || isInActivePath : true;
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
    const classes = ['eccn-node', `level-${level}`, !isAccordion ? 'static' : ''];
    if (isActive) {
      classes.push('active');
    }
    if (isInActivePath && !isActive) {
      classes.push('active-path');
    }
    return classes.filter(Boolean).join(' ');
  }, [isAccordion, isActive, isInActivePath, level]);

  if (!isAccordion) {
    return (
      <div className={containerClasses} id={anchorId}>
        {showLabel ? (
          <div className="node-label" aria-label={labelText} title={labelText}>
            {labelIdentifier ? <span className="node-identifier">{labelIdentifier}</span> : null}
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
              onSelectEccn={onSelectEccn}
            />
          ))}
          {node.children?.map((child, index) => (
            <EccnNodeView
              node={child}
              level={level + 1}
              key={`${anchorId || labelText}-child-${index}`}
              onSelectEccn={onSelectEccn}
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
        <span className="node-label" aria-label={labelText} title={labelText}>
          {labelIdentifier ? <span className="node-identifier">{labelIdentifier}</span> : null}
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
            onSelectEccn={onSelectEccn}
          />
        ))}
        {node.children?.map((child, index) => (
          <EccnNodeView
            node={child}
            level={level + 1}
            key={`${anchorId || labelText}-child-${index}`}
            onSelectEccn={onSelectEccn}
            activeNode={activeNode}
            activePath={activePath}
          />
        ))}
      </div>
    </details>
  );
}
