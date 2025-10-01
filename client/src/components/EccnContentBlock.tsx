import { useCallback } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import DOMPurify from 'dompurify';
import { EccnContentBlock } from '../types';

const ECCN_REFERENCE_PATTERN = /\b([0-9][A-Z][0-9]{3}(?:\.[A-Za-z0-9-]+)*)\b/g;

function createEccnReferencePattern(): RegExp {
  return new RegExp(ECCN_REFERENCE_PATTERN.source, 'g');
}

function linkHtmlEccnReferences(html: string): string {
  if (!html) {
    return html;
  }

  if (typeof document === 'undefined') {
    return html.replace(createEccnReferencePattern(), (_match, eccn: string) =>
      `<a href="#" class="eccn-reference-link" data-eccn-reference="${eccn}" aria-label="View ECCN ${eccn}" title="View ECCN ${eccn}">${eccn}</a>`
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
      anchor.setAttribute('aria-label', `View ECCN ${eccn}`);
      anchor.setAttribute('title', `View ECCN ${eccn}`);
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

interface EccnContentBlockViewProps {
  entry: EccnContentBlock;
  onPreviewEccn?: (eccn: string, anchor: HTMLElement) => void;
  className?: string;
}

export function EccnContentBlockView({ entry, onPreviewEccn, className }: EccnContentBlockViewProps) {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!onPreviewEccn) {
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
      onPreviewEccn(eccn, anchor);
    },
    [onPreviewEccn]
  );

  if (entry.type === 'text') {
    const text = entry.text ?? '';
    const fragments: Array<string | ReactNode> = [];
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
          onClick={(event) => onPreviewEccn?.(eccn, event.currentTarget)}
          aria-label={`View ECCN ${eccn}`}
          title={`View ECCN ${eccn}`}
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

    const mergedClassName = ['content', 'text-only', className].filter(Boolean).join(' ');

    return <p className={mergedClassName}>{fragments}</p>;
  }

  const sanitizedHtml = entry.html
    ? DOMPurify.sanitize(entry.html, { USE_PROFILES: { html: true } })
    : entry.text;

  if (!sanitizedHtml) {
    return null;
  }

  const entryClass = `content content-${(entry.tag || 'html').toLowerCase()}`;
  const mergedClassName = [entryClass, className].filter(Boolean).join(' ');
  const linkedHtml = linkHtmlEccnReferences(sanitizedHtml);

  return (
    <div
      className={mergedClassName}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: linkedHtml }}
    />
  );
}
