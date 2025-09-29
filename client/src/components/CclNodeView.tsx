import { useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { CclContentEntry, CclNode } from '../types';

interface CclNodeViewProps {
  node: CclNode;
  level?: number;
}

export function CclNodeView({ node, level = 0 }: CclNodeViewProps) {
  const [open, setOpen] = useState(level < 2);

  const label = useMemo(() => {
    const parts = [] as string[];
    if (node.identifier) parts.push(node.identifier);
    if (node.heading) parts.push(node.heading);
    if (!node.heading && !node.identifier) parts.push(node.type);
    return parts.join(' – ');
  }, [node.identifier, node.heading, node.type]);

  const anchorId = useMemo(() => {
    if (node.identifier) {
      return `node-${node.identifier.replace(/[^\w.-]+/g, '-')}`;
    }
    if (node.heading) {
      return `node-${node.heading.replace(/[^\w.-]+/g, '-').toLowerCase()}`;
    }
    return undefined;
  }, [node.identifier, node.heading]);

  return (
    <details
      className={`ccl-node level-${level}`}
      open={open}
      onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
      id={anchorId}
    >
      <summary>
        <span className="node-type">{node.type}</span>
        <span className="node-label">{label}</span>
      </summary>
      <div className="node-body">
        {node.content?.map((entry, index) => (
          <ContentBlock entry={entry} key={`${anchorId || label}-content-${index}`} />
        ))}
        {node.children?.map((child, index) => (
          <CclNodeView node={child} level={level + 1} key={`${anchorId || label}-child-${index}`} />
        ))}
      </div>
    </details>
  );
}

function ContentBlock({ entry }: { entry: CclContentEntry }) {
  if (entry.tag === '#text') {
    return <p className="content text-only">{entry.text}</p>;
  }

  const sanitizedHtml = entry.html
    ? DOMPurify.sanitize(entry.html, { USE_PROFILES: { html: true } })
    : entry.text;

  if (!sanitizedHtml) {
    return null;
  }

  const className = `content content-${entry.tag.toLowerCase()}`;

  return <div className={className} dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />;
}
