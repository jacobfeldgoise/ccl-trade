import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { EccnContentBlock, EccnNode } from '../types';

interface EccnNodeViewProps {
  node: EccnNode;
  level?: number;
}

export function EccnNodeView({ node, level = 0 }: EccnNodeViewProps) {
  const isAccordion = Boolean(node.isEccn && !node.boundToParent);
  const [open, setOpen] = useState(() => (isAccordion ? level < 2 : true));

  useEffect(() => {
    setOpen(isAccordion ? level < 2 : true);
  }, [isAccordion, level, node.identifier]);

  const labelText = useMemo(() => {
    const parts = [] as string[];
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

  if (!isAccordion) {
    return (
      <div className={`eccn-node level-${level} static`} id={anchorId}>
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
            <ContentBlock entry={entry} key={`${anchorId || labelText}-content-${index}`} />
          ))}
          {node.children?.map((child, index) => (
            <EccnNodeView node={child} level={level + 1} key={`${anchorId || labelText}-child-${index}`} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <details
      className={`eccn-node level-${level}`}
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
          <ContentBlock entry={entry} key={`${anchorId || labelText}-content-${index}`} />
        ))}
        {node.children?.map((child, index) => (
          <EccnNodeView node={child} level={level + 1} key={`${anchorId || labelText}-child-${index}`} />
        ))}
      </div>
    </details>
  );
}

function ContentBlock({ entry }: { entry: EccnContentBlock }) {
  if (entry.type === 'text') {
    return <p className="content text-only">{entry.text}</p>;
  }

  const sanitizedHtml = entry.html
    ? DOMPurify.sanitize(entry.html, { USE_PROFILES: { html: true } })
    : entry.text;

  if (!sanitizedHtml) {
    return null;
  }

  const className = `content content-${(entry.tag || 'html').toLowerCase()}`;

  return <div className={className} dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />;
}
