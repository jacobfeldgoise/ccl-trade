import { useCallback, useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { EccnContentBlock, EccnNode } from '../types';

interface EccnNodeViewProps {
  node: EccnNode;
  level?: number;
  onSelectEccn?: (eccn: string) => void;
}

const ECCN_REFERENCE_PATTERN = /\b([0-9][A-Z][0-9]{3}(?:\.[A-Z0-9-]+)*)\b/g;

function createEccnReferencePattern(): RegExp {
  return new RegExp(ECCN_REFERENCE_PATTERN.source, 'g');
}

export function EccnNodeView({ node, level = 0, onSelectEccn }: EccnNodeViewProps) {
  const isRootEccn = Boolean(node.isEccn && level === 0);
  const isAccordion = Boolean(node.isEccn && !node.boundToParent && !isRootEccn);
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
            <ContentBlock
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
            />
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
          <ContentBlock
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
          />
        ))}
      </div>
    </details>
  );
}

function linkHtmlEccnReferences(html: string): string {
  if (!html) {
    return html;
  }

  if (typeof document === 'undefined') {
    return html.replace(createEccnReferencePattern(), (_match, eccn: string) =>
      `<a href="#" class="eccn-reference-link" data-eccn-reference="${eccn}">${eccn}</a>`
    );
  }

  const template = document.createElement('template');
  template.innerHTML = html;

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  textNodes.forEach((textNode) => {
    const textContent = textNode.textContent;
    if (!textContent) {
      return;
    }

    const matches = [...textContent.matchAll(createEccnReferencePattern())];
    if (matches.length === 0) {
      return;
    }

    const fragments: Array<string | HTMLAnchorElement> = [];
    let lastIndex = 0;

    matches.forEach((match) => {
      const [fullMatch, eccn] = match;
      const startIndex = match.index ?? 0;
      if (startIndex > lastIndex) {
        fragments.push(textContent.slice(lastIndex, startIndex));
      }

      const anchor = document.createElement('a');
      anchor.textContent = fullMatch;
      anchor.setAttribute('href', '#');
      anchor.classList.add('eccn-reference-link');
      anchor.setAttribute('data-eccn-reference', eccn);
      fragments.push(anchor);

      lastIndex = startIndex + fullMatch.length;
    });

    if (lastIndex < textContent.length) {
      fragments.push(textContent.slice(lastIndex));
    }

    const parent = textNode.parentNode;
    if (!parent) {
      return;
    }

    fragments.forEach((fragment) => {
      if (typeof fragment === 'string') {
        parent.insertBefore(document.createTextNode(fragment), textNode);
      } else {
        parent.insertBefore(fragment, textNode);
      }
    });

    parent.removeChild(textNode);
  });

  return template.innerHTML;
}

function ContentBlock({ entry, onSelectEccn }: { entry: EccnContentBlock; onSelectEccn?: (eccn: string) => void }) {
  if (entry.type === 'text') {
    const text = entry.text ?? '';
    const fragments: Array<string | JSX.Element> = [];
    let lastIndex = 0;
    const matches = [...text.matchAll(createEccnReferencePattern())];

    matches.forEach((match, index) => {
      const [fullMatch, eccn] = match;
      const startIndex = match.index ?? 0;
      if (startIndex > lastIndex) {
        fragments.push(text.slice(lastIndex, startIndex));
      }

      fragments.push(
        <button
          type="button"
          className="eccn-reference-button"
          onClick={() => onSelectEccn?.(eccn)}
          key={`text-ref-${eccn}-${index}`}
        >
          {fullMatch}
        </button>
      );

      lastIndex = startIndex + fullMatch.length;
    });

    if (lastIndex < text.length) {
      fragments.push(text.slice(lastIndex));
    }

    if (fragments.length === 0) {
      fragments.push(text);
    }

    return <p className="content text-only">{fragments}</p>;
  }

  const sanitizedHtml = entry.html
    ? DOMPurify.sanitize(entry.html, { USE_PROFILES: { html: true } })
    : entry.text;

  if (!sanitizedHtml) {
    return null;
  }

  const className = `content content-${(entry.tag || 'html').toLowerCase()}`;
  const linkedHtml = linkHtmlEccnReferences(sanitizedHtml);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onSelectEccn) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('[data-eccn-reference]') as HTMLElement | null;
      if (!anchor) {
        return;
      }

      const eccn = anchor.getAttribute('data-eccn-reference');
      if (!eccn) {
        return;
      }

      event.preventDefault();
      onSelectEccn(eccn);
    },
    [onSelectEccn]
  );

  return (
    <div
      className={className}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: linkedHtml }}
    />
  );
}
