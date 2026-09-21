import React from 'react';
import { theme as themeNs } from '@apache-superset/core';

type PanelTheme = ReturnType<typeof themeNs.useTheme>;

type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'code'; content: string }
  | { kind: 'list'; ordered: boolean; items: string[] };

const FENCE_RE = /^```(\w*)\s*$/;
const BULLET_RE = /^[-*]\s+/;
const NUMBERED_RE = /^\d+[.)]\s+/;

/**
 * Subconjunto de Markdown para las respuestas del asistente: párrafos,
 * listas, bloques de código con ```, negrita/itálica e inline code. No es
 * un parser Markdown completo (no hay tablas, links, headers) — cubre lo
 * que realmente aparece en las respuestas del chat sin sumar una librería
 * nueva al bundle por un puñado de casos. Nunca usa `dangerouslySetInnerHTML`:
 * arma nodos React directamente, así el texto del backend (semi-confiable)
 * no puede inyectar HTML.
 */
function parseBlocks(text: string): Block[] {
  const rawLines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      const codeLines: string[] = [];
      i += 1;
      while (i < rawLines.length && !/^```\s*$/.test(rawLines[i])) {
        codeLines.push(rawLines[i]);
        i += 1;
      }
      i += 1; // salta la marca de cierre, si la hay
      blocks.push({ kind: 'code', content: codeLines.join('\n') });
      continue;
    }

    const isBullet = BULLET_RE.test(line);
    const isNumbered = !isBullet && NUMBERED_RE.test(line);
    if (isBullet || isNumbered) {
      const itemRe = isBullet ? BULLET_RE : NUMBERED_RE;
      const items: string[] = [];
      while (i < rawLines.length && itemRe.test(rawLines[i])) {
        items.push(rawLines[i].replace(itemRe, ''));
        i += 1;
      }
      blocks.push({ kind: 'list', ordered: isNumbered, items });
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < rawLines.length &&
      rawLines[i].trim() !== '' &&
      !FENCE_RE.test(rawLines[i]) &&
      !BULLET_RE.test(rawLines[i]) &&
      !NUMBERED_RE.test(rawLines[i])
    ) {
      paraLines.push(rawLines[i]);
      i += 1;
    }
    blocks.push({ kind: 'paragraph', lines: paraLines });
  }

  return blocks;
}

type InlineToken = { kind: 'text' | 'code' | 'bold' | 'italic'; content: string };

// Orden importa: code antes que bold antes que italic, para que
// `**no `code`**` o `*a* y **b**` se resuelvan como se espera.
const INLINE_RE = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;

function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  // eslint-disable-next-line no-cond-assign
  while ((match = INLINE_RE.exec(text))) {
    if (match.index > lastIndex) {
      tokens.push({ kind: 'text', content: text.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) tokens.push({ kind: 'code', content: match[1] });
    else if (match[2] !== undefined) tokens.push({ kind: 'bold', content: match[2] });
    else if (match[3] !== undefined) tokens.push({ kind: 'italic', content: match[3] });
    lastIndex = INLINE_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    tokens.push({ kind: 'text', content: text.slice(lastIndex) });
  }
  return tokens;
}

function InlineCode({ theme, children }: { theme: PanelTheme; children: React.ReactNode }): React.ReactElement {
  return (
    <code
      style={{
        fontFamily: "'SF Mono', Consolas, Monaco, monospace",
        fontSize: '0.92em',
        background: theme.colorFillTertiary,
        padding: '1px 5px',
        borderRadius: 3,
      }}
    >
      {children}
    </code>
  );
}

function renderInline(text: string, theme: PanelTheme, keyPrefix: string): React.ReactNode[] {
  return tokenizeInline(text).map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (token.kind) {
      case 'code':
        return (
          <InlineCode key={key} theme={theme}>
            {token.content}
          </InlineCode>
        );
      case 'bold':
        return <strong key={key}>{token.content}</strong>;
      case 'italic':
        return <em key={key}>{token.content}</em>;
      default:
        return <React.Fragment key={key}>{token.content}</React.Fragment>;
    }
  });
}

export interface ChatMarkdownProps {
  text: string;
}

export function ChatMarkdown({ text }: ChatMarkdownProps): React.ReactElement {
  const theme = themeNs.useTheme();
  const blocks = React.useMemo(() => parseBlocks(text), [text]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {blocks.map((block, blockIndex) => {
        if (block.kind === 'code') {
          return (
            <pre
              key={blockIndex}
              style={{
                margin: 0,
                padding: '8px 10px',
                borderRadius: theme.borderRadiusSM,
                background: '#1e1e2e',
                color: '#cdd6f4',
                fontFamily: "'SF Mono', Consolas, Monaco, monospace",
                fontSize: 11.5,
                lineHeight: 1.5,
                overflowX: 'auto',
                whiteSpace: 'pre',
              }}
            >
              {block.content}
            </pre>
          );
        }
        if (block.kind === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag
              key={blockIndex}
              style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}
            >
              {block.items.map((item, itemIndex) => (
                // eslint-disable-next-line react/no-array-index-key
                <li key={itemIndex}>{renderInline(item, theme, `${blockIndex}-${itemIndex}`)}</li>
              ))}
            </ListTag>
          );
        }
        return (
          <p key={blockIndex} style={{ margin: 0 }}>
            {block.lines.map((line, lineIndex) => (
              // eslint-disable-next-line react/no-array-index-key
              <React.Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                {renderInline(line, theme, `${blockIndex}-${lineIndex}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
