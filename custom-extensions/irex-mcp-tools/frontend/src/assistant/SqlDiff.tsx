import React, { useMemo, useState } from 'react';

type DiffLineKind = 'same' | 'added' | 'removed';

interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/**
 * Diff línea por línea vía LCS (programación dinámica O(n*m)). Suficiente
 * para consultas SQL típicas (decenas de líneas); no pensado para
 * documentos grandes.
 */
function computeLineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;

  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ kind: 'same', text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ kind: 'removed', text: a[i] });
      i += 1;
    } else {
      result.push({ kind: 'added', text: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    result.push({ kind: 'removed', text: a[i] });
    i += 1;
  }
  while (j < m) {
    result.push({ kind: 'added', text: b[j] });
    j += 1;
  }
  return result;
}

// Estilo tipo terminal/editor de código fijo (independiente del tema
// claro/oscuro de Superset) — mismo criterio que la mayoría de los chats
// con bloques de código: el bloque en sí siempre es oscuro para que el
// resaltado sea legible sin depender del tema circundante.
const CODE_BG = '#1e1e2e';
const CODE_TEXT = '#cdd6f4';
const LINE_STYLE: Record<DiffLineKind, React.CSSProperties> = {
  same: { color: CODE_TEXT },
  added: { background: 'rgba(166, 227, 161, 0.15)', color: '#a6e3a1' },
  removed: {
    background: 'rgba(243, 139, 168, 0.15)',
    color: '#f38ba8',
    textDecoration: 'line-through',
  },
};
const LINE_PREFIX: Record<DiffLineKind, string> = {
  same: '  ',
  added: '+ ',
  removed: '- ',
};

type DisplayItem = { kind: 'line'; line: DiffLine } | { kind: 'collapsed'; lines: DiffLine[] };

// Contexto tipo `git diff`: tramos largos sin cambios se colapsan detrás de
// un separador clickeable, mostrando solo CONTEXT líneas a cada lado del
// cambio real. Evita que una propuesta sobre una consulta larga muestre la
// consulta entera de nuevo por un ajuste de una línea.
const CONTEXT = 2;
const COLLAPSE_THRESHOLD = 2 * CONTEXT + 3;

function buildDisplayItems(lines: DiffLine[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind !== 'same') {
      items.push({ kind: 'line', line: lines[i] });
      i += 1;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j].kind === 'same') j += 1;
    const runLength = j - i;
    if (runLength <= COLLAPSE_THRESHOLD) {
      for (let k = i; k < j; k += 1) items.push({ kind: 'line', line: lines[k] });
    } else {
      for (let k = i; k < i + CONTEXT; k += 1) items.push({ kind: 'line', line: lines[k] });
      items.push({ kind: 'collapsed', lines: lines.slice(i + CONTEXT, j - CONTEXT) });
      for (let k = j - CONTEXT; k < j; k += 1) items.push({ kind: 'line', line: lines[k] });
    }
    i = j;
  }
  return items;
}

export interface SqlDiffProps {
  before: string;
  after: string;
}

export function SqlDiff({ before, after }: SqlDiffProps): React.ReactElement {
  const lines = useMemo(() => computeLineDiff(before, after), [before, after]);
  const displayItems = useMemo(() => buildDisplayItems(lines), [lines]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  React.useEffect(() => setExpanded(new Set()), [before, after]);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard
      .writeText(after)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  return (
    <div style={{ borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.15)' }}>
      {/* El tema claro/oscuro de Superset venía ganándole al `background`/
          `color` inline de más abajo (se veía en blanco sobre blanco en modo
          claro). `!important` vía un <style> propio es la única forma de
          garantizar que este bloque de código se vea siempre igual, sin
          importar qué CSS del host tenga más especificidad. */}
      <style>{`
        .irex-sqldiff-body {
          background-color: ${CODE_BG} !important;
          color: ${CODE_TEXT} !important;
        }
      `}</style>
      <div
        style={{
          background: '#181825',
          color: '#9399b2',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 0.3,
          textTransform: 'uppercase',
          padding: '4px 10px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>SQL</span>
        <button
          type="button"
          onClick={handleCopy}
          style={{
            background: 'none',
            border: 'none',
            color: '#9399b2',
            fontSize: 10,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          {copied ? '✓ copiado' : 'copiar'}
        </button>
      </div>
      <div
        className="irex-sqldiff-body"
        style={{
          fontFamily: "'SF Mono', Consolas, Monaco, monospace",
          fontSize: 11.5,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          background: CODE_BG,
          color: CODE_TEXT,
          padding: 8,
          margin: 0,
          maxHeight: 240,
          overflowY: 'auto',
        }}
      >
        {displayItems.map((item, index) => {
          if (item.kind === 'line') {
            return (
              // eslint-disable-next-line react/no-array-index-key
              <div key={index} style={LINE_STYLE[item.line.kind]}>
                {LINE_PREFIX[item.line.kind]}
                {item.line.text}
              </div>
            );
          }
          const isOpen = expanded.has(index);
          return (
            // eslint-disable-next-line react/no-array-index-key
            <React.Fragment key={index}>
              <button
                type="button"
                onClick={() =>
                  setExpanded(prev => {
                    const next = new Set(prev);
                    if (next.has(index)) next.delete(index);
                    else next.add(index);
                    return next;
                  })
                }
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: 'rgba(255,255,255,0.04)',
                  border: 'none',
                  color: '#9399b2',
                  fontFamily: 'inherit',
                  fontSize: 11,
                  padding: '2px 4px',
                  margin: '2px 0',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                {isOpen ? '▾' : '▸'} {item.lines.length} línea{item.lines.length === 1 ? '' : 's'} sin cambios
              </button>
              {isOpen &&
                item.lines.map((line, lineIndex) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <div key={lineIndex} style={LINE_STYLE[line.kind]}>
                    {LINE_PREFIX[line.kind]}
                    {line.text}
                  </div>
                ))}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
