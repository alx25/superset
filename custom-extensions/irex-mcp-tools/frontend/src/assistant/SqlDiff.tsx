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

export interface SqlDiffProps {
  before: string;
  after: string;
}

export function SqlDiff({ before, after }: SqlDiffProps): React.ReactElement {
  const lines = useMemo(() => computeLineDiff(before, after), [before, after]);
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
      <pre
        style={{
          fontFamily: "'SF Mono', Consolas, Monaco, monospace",
          fontSize: 11.5,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          background: CODE_BG,
          padding: 8,
          margin: 0,
          maxHeight: 240,
          overflowY: 'auto',
        }}
      >
        {lines.map((line, index) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={index} style={LINE_STYLE[line.kind]}>
            {LINE_PREFIX[line.kind]}
            {line.text}
          </div>
        ))}
      </pre>
    </div>
  );
}
