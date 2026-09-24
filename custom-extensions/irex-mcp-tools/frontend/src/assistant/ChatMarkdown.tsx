import React from 'react';
import { theme as themeNs } from '@apache-superset/core';
import { looksLikeSql, SQL_FENCE_LANGUAGES, SqlCode, tokenizeSql } from './sqlHighlight';

type PanelTheme = ReturnType<typeof themeNs.useTheme>;

type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'code'; content: string; lang: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'hr' }
  | { kind: 'blockquote'; lines: string[] };

const FENCE_RE = /^```(\w*)\s*$/;
const BULLET_RE = /^[-*]\s+/;
const NUMBERED_RE = /^\d+[.)]\s+/;
const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const BLOCKQUOTE_RE = /^>\s?/;

/**
 * Marca "1) "/"2. " en medio de una oración, no al inicio de línea — lo que
 * escribe el modelo cuando enumera sugerencias sin usar saltos de línea de
 * verdad (reportado por el usuario con captura: "1) ... 2) ... 3) ..." todo
 * pegado en un solo párrafo denso). `NUMBERED_RE` de arriba no lo detecta
 * porque exige el marcador al INICIO de línea — acá se busca la misma
 * secuencia en medio del texto.
 */
const INLINE_NUMBERED_MARKER_RE = /(?:^|\s)(\d+)[.)]\s+/g;

/**
 * Si `line` tiene 2+ marcadores numéricos SEGUIDOS empezando en 1 (1), 2),
 * 3)...), la separa en un párrafo introductorio (lo que precede al primer
 * marcador) y una lista — igual que si el modelo hubiera usado saltos de
 * línea reales. Exigir la secuencia completa desde 1 evita falsos
 * positivos sobre prosa común (una sola mención suelta como "a las 3) horas"
 * nunca junta dos marcadores consecutivos, así que no dispara esto).
 */
function splitInlineEnumeration(line: string): { intro: string; items: string[] } | undefined {
  const matches: RegExpExecArray[] = [];
  INLINE_NUMBERED_MARKER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((match = INLINE_NUMBERED_MARKER_RE.exec(line))) {
    matches.push(match);
  }
  if (matches.length < 2) return undefined;
  const numbers = matches.map(m => Number(m[1]));
  if (numbers[0] !== 1) return undefined;
  for (let i = 1; i < numbers.length; i += 1) {
    if (numbers[i] !== numbers[i - 1] + 1) return undefined;
  }
  const firstMatch = matches[0];
  const intro = line.slice(0, firstMatch.index).trim();
  const items = matches.map((match, index) => {
    const start = match.index! + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index! : line.length;
    return line.slice(start, end).trim();
  });
  return { intro, items };
}

/**
 * Subconjunto de Markdown para las respuestas del asistente: encabezados
 * (#..######), párrafos, listas, blockquotes, línea horizontal, bloques de
 * código con ```, negrita/itálica e inline code. No es un parser Markdown
 * completo (no hay tablas ni links) — cubre lo que realmente aparece en las
 * respuestas del chat sin sumar una librería nueva al bundle por un puñado
 * de casos. Nunca usa `dangerouslySetInnerHTML`: arma nodos React
 * directamente, así el texto del backend (semi-confiable) no puede
 * inyectar HTML.
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
      blocks.push({ kind: 'code', content: codeLines.join('\n'), lang: fenceMatch[1].toLowerCase() });
      continue;
    }

    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      blocks.push({ kind: 'heading', level: headingMatch[1].length, text: headingMatch[2].trim() });
      i += 1;
      continue;
    }

    if (HR_RE.test(line.trim())) {
      blocks.push({ kind: 'hr' });
      i += 1;
      continue;
    }

    if (BLOCKQUOTE_RE.test(line)) {
      const quoteLines: string[] = [];
      while (i < rawLines.length && BLOCKQUOTE_RE.test(rawLines[i])) {
        quoteLines.push(rawLines[i].replace(BLOCKQUOTE_RE, ''));
        i += 1;
      }
      blocks.push({ kind: 'blockquote', lines: quoteLines });
      continue;
    }

    // Se chequea ANTES que el numerado de inicio-de-línea de abajo: una
    // línea que arranca "1) Uno. 2) Dos. 3) Tres." también matchea
    // `NUMBERED_RE` (arranca con "1) "), y sin esta prioridad ese chequeo
    // se quedaría con TODO el resto de la línea como un único ítem "Uno.
    // 2) Dos. 3) Tres." en vez de partirlo en tres.
    const inlineFromLineStart = splitInlineEnumeration(line);
    if (inlineFromLineStart) {
      if (inlineFromLineStart.intro) blocks.push({ kind: 'paragraph', lines: [inlineFromLineStart.intro] });
      blocks.push({ kind: 'list', ordered: true, items: inlineFromLineStart.items });
      i += 1;
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
      !NUMBERED_RE.test(rawLines[i]) &&
      !HEADING_RE.test(rawLines[i]) &&
      !HR_RE.test(rawLines[i].trim()) &&
      !BLOCKQUOTE_RE.test(rawLines[i])
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

/**
 * Chip de código inline, liviano: poco relleno y tipografía apenas menor
 * para que una frase con varios identificadores no se vuelva una fila de
 * bloques. Las palabras clave SQL escritas en MAYÚSCULAS (`CROSS JOIN
 * LATERAL`) se resaltan con el color primario (AA en los dos temas); en
 * minúsculas no, porque inline suelen ser nombres de columnas (`key`, `set`).
 */
function InlineCode({ theme, code }: { theme: PanelTheme; code: string }): React.ReactElement {
  return (
    <code
      style={{
        fontFamily: "'SF Mono', 'JetBrains Mono', Consolas, Monaco, monospace",
        fontSize: '0.9em',
        color: theme.colorText,
        background: theme.colorFillTertiary,
        padding: '0 3px',
        borderRadius: 3,
        boxDecorationBreak: 'clone',
        WebkitBoxDecorationBreak: 'clone',
      }}
    >
      {tokenizeSql(code).map((token, index) =>
        token.type === 'keyword' && token.text === token.text.toUpperCase() ? (
          // eslint-disable-next-line react/no-array-index-key
          <span key={index} style={{ color: theme.colorPrimary, fontWeight: 600 }}>
            {token.text}
          </span>
        ) : (
          // eslint-disable-next-line react/no-array-index-key
          <React.Fragment key={index}>{token.text}</React.Fragment>
        ),
      )}
    </code>
  );
}

function renderInline(text: string, theme: PanelTheme, keyPrefix: string): React.ReactNode[] {
  return tokenizeInline(text).map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (token.kind) {
      case 'code':
        return (
          <InlineCode key={key} theme={theme} code={token.content} />
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

const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
// Relativos al tamaño del contenedor (el panel usa una escala compacta, ver
// `ui.ts`): un encabezado apenas más grande y en negrita alcanza para
// jerarquizar sin robar alto al código.
const HEADING_SIZES: Record<number, { fontSize: string; fontWeight: number }> = {
  1: { fontSize: '1.15em', fontWeight: 700 },
  2: { fontSize: '1.08em', fontWeight: 700 },
  3: { fontSize: '1.03em', fontWeight: 600 },
};

function headingStyle(level: number): React.CSSProperties {
  const { fontSize, fontWeight } = HEADING_SIZES[level] ?? { fontSize: '1em', fontWeight: 600 };
  return { margin: 0, fontSize, fontWeight, lineHeight: 1.4 };
}

export interface ChatMarkdownProps {
  text: string;
}

export function ChatMarkdown({ text }: ChatMarkdownProps): React.ReactElement {
  const theme = themeNs.useTheme();
  const blocks = React.useMemo(() => parseBlocks(text), [text]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
                // Ajuste de línea (como el diff): en un panel de ~380px el
                // scroll horizontal pasa desapercibido y el final quedaba oculto.
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {SQL_FENCE_LANGUAGES.has(block.lang) || (!block.lang && looksLikeSql(block.content)) ? (
                <SqlCode code={block.content} />
              ) : (
                block.content
              )}
            </pre>
          );
        }
        if (block.kind === 'heading') {
          const Tag = HEADING_TAGS[Math.min(Math.max(block.level, 1), 6) - 1];
          return (
            <Tag key={blockIndex} style={headingStyle(block.level)}>
              {renderInline(block.text, theme, `${blockIndex}-h`)}
            </Tag>
          );
        }
        if (block.kind === 'hr') {
          return <hr key={blockIndex} style={{ border: 'none', borderTop: `1px solid ${theme.colorBorderSecondary}`, margin: 0 }} />;
        }
        if (block.kind === 'blockquote') {
          return (
            <div
              key={blockIndex}
              style={{
                borderLeft: `3px solid ${theme.colorBorderSecondary}`,
                paddingLeft: 10,
                color: theme.colorTextSecondary,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {block.lines.map((line, lineIndex) => (
                // eslint-disable-next-line react/no-array-index-key
                <div key={lineIndex}>{renderInline(line, theme, `${blockIndex}-bq-${lineIndex}`)}</div>
              ))}
            </div>
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
