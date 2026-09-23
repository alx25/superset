import React, { useMemo, useState } from 'react';
import { Icon } from './icons';
import { SqlCode } from './sqlHighlight';
import { MONO } from './ui';

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

// Bloque de código con fondo oscuro fijo, independiente del tema claro/oscuro
// de Superset: mismo criterio que la mayoría de los chats con código. Colores
// verificados contra CODE_BG con contraste AA o superior: texto ≈11:1,
// agregado ≈11:1, eliminado ≈7:1.
const CODE_BG = '#1e1e2e';
const CODE_HEADER_BG = '#181825';
const CODE_TEXT = '#cdd6f4';
const CODE_MUTED = '#a6adc8';
const ADDED = '#a6e3a1';
const REMOVED = '#f38ba8';
const LINE_STYLE: Record<DiffLineKind, React.CSSProperties> = {
  same: { color: CODE_TEXT, borderLeft: '2px solid transparent' },
  // Sin tachado en lo eliminado: el color, el fondo, el borde y el signo "-"
  // ya lo distinguen, y el tachado vuelve ilegible justo lo que hay que revisar.
  added: { background: 'rgba(166, 227, 161, 0.14)', color: ADDED, borderLeft: `2px solid ${ADDED}` },
  removed: { background: 'rgba(243, 139, 168, 0.14)', color: REMOVED, borderLeft: `2px solid ${REMOVED}` },
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

function Badge({ color, children }: { color: string; children: React.ReactNode }): React.ReactElement {
  return (
    <span
      style={{
        color,
        border: `1px solid ${color}55`,
        background: `${color}1a`,
        borderRadius: 3,
        padding: '0 5px',
        fontSize: 11,
        lineHeight: '16px',
      }}
    >
      {children}
    </span>
  );
}

export function SqlDiff({ before, after }: SqlDiffProps): React.ReactElement {
  const lines = useMemo(() => computeLineDiff(before, after), [before, after]);
  const displayItems = useMemo(() => buildDisplayItems(lines), [lines]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [tall, setTall] = useState(false);
  React.useEffect(() => setExpanded(new Set()), [before, after]);
  const added = lines.filter(l => l.kind === 'added').length;
  const removed = lines.filter(l => l.kind === 'removed').length;
  const isNew = before.trim() === '';

  return (
    <div style={{ overflow: 'hidden' }}>
      {/* El tema de Superset le ganaba al background/color inline (blanco
          sobre blanco en modo claro); un <style> acotado con !important es la
          única forma de garantizar el bloque oscuro sin CSS global. */}
      <style>{`
        .irex-sqldiff-body {
          background-color: ${CODE_BG} !important;
          color: ${CODE_TEXT} !important;
        }
      `}</style>
      <div
        style={{
          background: CODE_HEADER_BG,
          color: CODE_MUTED,
          fontSize: 11,
          fontFamily: MONO,
          padding: '4px 8px 4px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ letterSpacing: 0.4 }}>{isNew ? 'SQL NUEVO' : 'DIFF'}</span>
        {removed > 0 && <Badge color={REMOVED}>−{removed}</Badge>}
        {added > 0 && <Badge color={ADDED}>+{added}</Badge>}
        {added === 0 && removed === 0 && <span>sin cambios</span>}
        <button
          type="button"
          onClick={() => setTall(t => !t)}
          aria-label={tall ? 'Reducir el diff' : 'Ampliar el diff'}
          title={tall ? 'Reducir' : 'Ampliar'}
          style={{
            marginLeft: 'auto',
            background: 'none',
            border: 'none',
            color: CODE_MUTED,
            cursor: 'pointer',
            padding: 2,
          }}
        >
          <Icon name={tall ? 'collapse' : 'expand'} size={12} />
        </button>
      </div>
      <div
        className="irex-sqldiff-body"
        style={{
          fontFamily: MONO,
          fontSize: 11.5,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          background: CODE_BG,
          color: CODE_TEXT,
          padding: '6px 0',
          margin: 0,
          maxHeight: tall ? 520 : 220,
          overflowY: 'auto',
        }}
      >
        {displayItems.map((item, index) => {
          if (item.kind === 'line') {
            return (
              // eslint-disable-next-line react/no-array-index-key
              <div key={index} style={{ ...LINE_STYLE[item.line.kind], padding: '0 10px 0 8px' }}>
                {LINE_PREFIX[item.line.kind]}
                <SqlCode code={item.line.text} />
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
                  background: 'rgba(255,255,255,0.05)',
                  border: 'none',
                  color: CODE_MUTED,
                  fontFamily: 'inherit',
                  fontSize: 11,
                  padding: '1px 10px',
                  margin: '2px 0',
                  cursor: 'pointer',
                }}
              >
                {isOpen ? '▾' : '▸'} {item.lines.length} línea{item.lines.length === 1 ? '' : 's'} sin cambios
              </button>
              {isOpen &&
                item.lines.map((line, lineIndex) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <div key={lineIndex} style={{ ...LINE_STYLE[line.kind], padding: '0 10px 0 8px' }}>
                    {LINE_PREFIX[line.kind]}
                    <SqlCode code={line.text} />
                  </div>
                ))}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
