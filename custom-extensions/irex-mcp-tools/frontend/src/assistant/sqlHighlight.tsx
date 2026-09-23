import React from 'react';

/**
 * Resaltado de sintaxis SQL liviano (sin dependencias: Prism/highlight.js
 * sumarían decenas de KB por un solo lenguaje). Cubre lo que aparece en SQL
 * Lab: PostgreSQL/ClickHouse, casts `::tipo` y plantillas Jinja. Es
 * deliberadamente por línea o fragmento: un comentario `/* *\/` que cruza
 * líneas del diff no se reconoce, y eso solo cambia colores, nunca texto.
 *
 * Nunca usa HTML crudo: devuelve nodos React con el texto tal cual.
 */

export type SqlTokenType =
  | 'keyword'
  | 'type'
  | 'function'
  | 'string'
  | 'number'
  | 'comment'
  | 'template'
  | 'operator'
  | 'plain';

export interface SqlToken {
  type: SqlTokenType;
  text: string;
}

const KEYWORDS = new Set(
  (
    'SELECT FROM WHERE AND OR NOT IN IS NULL AS ON JOIN LEFT RIGHT INNER OUTER FULL CROSS LATERAL NATURAL USING ' +
    'GROUP BY ORDER HAVING LIMIT OFFSET FETCH FIRST NEXT ONLY UNION INTERSECT EXCEPT ALL DISTINCT CASE WHEN THEN ' +
    'ELSE END WITH RECURSIVE INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE VIEW MATERIALIZED DROP ALTER ' +
    'TRUNCATE BETWEEN LIKE ILIKE SIMILAR EXISTS ASC DESC NULLS OVER PARTITION WINDOW ROWS RANGE PRECEDING ' +
    'FOLLOWING UNBOUNDED CURRENT ROW FILTER TRUE FALSE CAST INTERVAL RETURNING EXPLAIN ANALYZE SETTINGS FINAL ' +
    'PREWHERE ARRAY ANY SOME SEMI ANTI GLOBAL QUALIFY TOP ESCAPE COLLATE'
  ).split(' '),
);

const TYPES = new Set(
  (
    'int integer smallint bigint int2 int4 int8 numeric decimal real float float4 float8 double precision ' +
    'text varchar char character string date time timestamp timestamptz interval boolean bool json jsonb uuid ' +
    'bytea money inet array uint8 uint16 uint32 uint64 int16 int32 int64 float32 float64 datetime datetime64 ' +
    'date32 nullable lowcardinality'
  ).split(' '),
);

/** Lenguajes de bloque ``` que se resaltan como SQL. Sin lenguaje: solo si
 * el bloque tiene cara de SQL (ver `looksLikeSql`). */
export const SQL_FENCE_LANGUAGES = new Set(['sql', 'pgsql', 'postgres', 'postgresql', 'clickhouse', 'mysql', 'tsql', 'plsql']);

export function looksLikeSql(code: string): boolean {
  return /\b(select|with|insert|update|delete|create|explain)\b[\s\S]*\b(from|into|set|table|as|select)\b/i.test(code);
}

export function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  const push = (type: SqlTokenType, text: string) => {
    const last = tokens[tokens.length - 1];
    if (last && last.type === type && (type === 'plain' || type === 'operator')) last.text += text;
    else tokens.push({ type, text });
  };
  const until = (from: number, close: string) => {
    const end = sql.indexOf(close, from);
    return end === -1 ? sql.length : end + close.length;
  };
  let i = 0;
  let afterCast = false;
  while (i < sql.length) {
    const c = sql[i];
    const two = sql.slice(i, i + 2);
    let end: number;
    if (two === '--') {
      end = sql.indexOf('\n', i);
      end = end === -1 ? sql.length : end;
      push('comment', sql.slice(i, end));
    } else if (two === '/*') {
      end = until(i + 2, '*/');
      push('comment', sql.slice(i, end));
    } else if (two === '{#') {
      end = until(i + 2, '#}');
      push('comment', sql.slice(i, end));
    } else if (two === '{{' || two === '{%') {
      end = until(i + 2, two === '{{' ? '}}' : '%}');
      push('template', sql.slice(i, end));
    } else if (c === "'") {
      end = i + 1;
      while (end < sql.length) {
        if (sql[end] === "'" && sql[end + 1] === "'") end += 2;
        else if (sql[end] === "'") {
          end += 1;
          break;
        } else end += 1;
      }
      push('string', sql.slice(i, end));
    } else if (c === '$' && /^\$[A-Za-z_]*\$/.test(sql.slice(i))) {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))![0];
      end = until(i + tag.length, tag);
      push('string', sql.slice(i, end));
    } else if (c === '"' || c === '`') {
      end = until(i + 1, c);
      push('plain', sql.slice(i, end));
    } else if (/[0-9]/.test(c) && !/[A-Za-z0-9_]/.test(sql[i - 1] ?? '')) {
      end = i + (/^\d+(?:\.\d+)?(?:e[+-]?\d+)?/i.exec(sql.slice(i))![0].length);
      push('number', sql.slice(i, end));
    } else if (/[A-Za-z_]/.test(c)) {
      end = i + /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i))![0].length;
      const word = sql.slice(i, end);
      const next = sql.slice(end).match(/^\s*(\S)/)?.[1];
      if (afterCast && TYPES.has(word.toLowerCase())) push('type', word);
      else if (KEYWORDS.has(word.toUpperCase())) push('keyword', word);
      else if (next === '(' && sql[i - 1] !== '.') push('function', word);
      else push('plain', word);
      afterCast = false;
      i = end;
      continue;
    } else if (two === '::') {
      push('operator', two);
      afterCast = true;
      i += 2;
      continue;
    } else if (/[=<>!|+\-*/%]/.test(c)) {
      end = i + 1;
      push('operator', c);
    } else {
      end = i + 1;
      push('plain', c);
    }
    if (!/\s/.test(c)) afterCast = false;
    i = end;
  }
  return tokens;
}

/**
 * Paleta para el bloque de código oscuro fijo (#1e1e2e). Todos los colores
 * con contraste AA o superior sobre ese fondo (ver contrast.test.ts). `plain`
 * no fuerza color: hereda el del contenedor, así en el diff las líneas
 * agregadas/eliminadas conservan su verde/rojo en los identificadores.
 */
export const DARK_CODE_PALETTE: Record<SqlTokenType, React.CSSProperties | undefined> = {
  keyword: { color: '#cba6f7', fontWeight: 600 },
  type: { color: '#f9e2af' },
  function: { color: '#89b4fa' },
  string: { color: '#a6e3a1' },
  number: { color: '#fab387' },
  comment: { color: '#a6adc8', fontStyle: 'italic' },
  template: { color: '#f5c2e7' },
  operator: { color: '#94e2d5' },
  plain: undefined,
};

export function SqlCode({
  code,
  palette = DARK_CODE_PALETTE,
}: {
  code: string;
  palette?: Record<SqlTokenType, React.CSSProperties | undefined>;
}): React.ReactElement {
  return (
    <>
      {tokenizeSql(code).map((token, index) => {
        const style = palette[token.type];
        return style ? (
          // eslint-disable-next-line react/no-array-index-key
          <span key={index} style={style}>
            {token.text}
          </span>
        ) : (
          // eslint-disable-next-line react/no-array-index-key
          <React.Fragment key={index}>{token.text}</React.Fragment>
        );
      })}
    </>
  );
}
