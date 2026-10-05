/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

/**
 * Formateadores livianos, propios (sin dependencia nueva), para mostrar CSS
 * y HTML/Handlebars LEGIBLES en la tarjeta de diff del asistente de Explore
 * — el modelo entrega `styleTemplate`/`handlebarsTemplate` minificados en
 * una sola línea (pedido del usuario 2026-09-28: "en los CSS y HTML los
 * entrega desordenados"). Son best-effort para LECTURA humana en el diff,
 * no un parser CSS/HTML formal — nunca se usan para decidir si el valor es
 * válido, ni para transformar lo que de verdad se aplica/guarda (eso sigue
 * siendo el texto tal cual lo mandó el modelo).
 */

const INDENT_UNIT = '  ';

/**
 * Indenta CSS plano según profundidad de llaves, con un salto de línea
 * después de cada `;`/`{`/`}` — preserva el contenido de strings entre
 * comillas tal cual (no cuenta llaves ni inserta saltos ahí, ej. dentro de
 * `content:"a{b}"`), así que no rompe valores con llaves literales.
 */
export function formatCss(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) return trimmed;

  let depth = 0;
  let out = '';
  let i = 0;
  const n = trimmed.length;

  const newlineIndent = (extra = 0) => `\n${INDENT_UNIT.repeat(Math.max(depth + extra, 0))}`;

  while (i < n) {
    const ch = trimmed[i];

    if (ch === '"' || ch === "'") {
      // Copia el string literal completo (con escapes) sin tocar nada adentro.
      const quote = ch;
      let j = i + 1;
      out += ch;
      while (j < n && trimmed[j] !== quote) {
        if (trimmed[j] === '\\' && j + 1 < n) {
          out += trimmed[j] + trimmed[j + 1];
          j += 2;
          continue;
        }
        out += trimmed[j];
        j += 1;
      }
      if (j < n) {
        out += trimmed[j]; // comilla de cierre
        j += 1;
      }
      i = j;
      continue;
    }

    if (ch === '{') {
      depth += 1;
      out = out.replace(/[ \t]+$/, '');
      out += ' {' + newlineIndent();
      i += 1;
      // saltea espacios/saltos ya existentes tras la llave
      while (i < n && /\s/.test(trimmed[i])) i += 1;
      continue;
    }

    if (ch === '}') {
      depth = Math.max(depth - 1, 0);
      out = out.replace(/\s*$/, '');
      out += newlineIndent() + '}';
      // Línea en blanco entre reglas HERMANAS de nivel superior (legibilidad);
      // dentro de un anidamiento (@media/@container) alcanza con un salto.
      out += depth === 0 ? '\n\n' : newlineIndent();
      i += 1;
      while (i < n && /\s/.test(trimmed[i])) i += 1;
      continue;
    }

    if (ch === ';') {
      out += ';' + newlineIndent();
      i += 1;
      while (i < n && /\s/.test(trimmed[i])) i += 1;
      continue;
    }

    if (/\s/.test(ch)) {
      // Colapsa espacios/saltos existentes a uno solo (se reinsertan los
      // propios arriba en cada punto estructural).
      out += out.endsWith(' ') || out.endsWith('\n') ? '' : ' ';
      i += 1;
      while (i < n && /\s/.test(trimmed[i])) i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out
    .split('\n')
    .map(line => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const VOID_HTML_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

type HtmlToken =
  | { kind: 'open'; text: string; tag: string }
  | { kind: 'close'; text: string; tag: string }
  | { kind: 'void'; text: string }
  | { kind: 'hbOpen'; text: string }
  | { kind: 'hbClose'; text: string }
  | { kind: 'hbElse'; text: string }
  | { kind: 'text'; text: string };

/**
 * Tokeniza HTML mezclado con Handlebars lo suficiente para indentar por
 * profundidad — reconoce `<tag ...>` (abre), `</tag>` (cierra), `<tag .../>`
 * y elementos vacíos (`<br>`, `<img>`, etc., no cambian profundidad),
 * `{{#bloque}}`/`{{/bloque}}`/`{{else}}` de Handlebars, y trata cualquier
 * otra cosa (texto, `{{valor}}` simple, comentarios) como una hoja sin
 * profundidad propia. No es un parser completo — atributos con `>` dentro
 * de comillas se manejan, pero casos muy exóticos pueden salir mal
 * indentados sin romper el contenido (es solo para LECTURA).
 */
function tokenizeHtml(source: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let i = 0;
  const n = source.length;

  while (i < n) {
    if (source.startsWith('{{#', i) || source.startsWith('{{^', i)) {
      const end = source.indexOf('}}', i);
      const text = end === -1 ? source.slice(i) : source.slice(i, end + 2);
      tokens.push({ kind: 'hbOpen', text });
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (source.startsWith('{{/', i)) {
      const end = source.indexOf('}}', i);
      const text = end === -1 ? source.slice(i) : source.slice(i, end + 2);
      tokens.push({ kind: 'hbClose', text });
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (source.startsWith('{{else', i)) {
      const end = source.indexOf('}}', i);
      const text = end === -1 ? source.slice(i) : source.slice(i, end + 2);
      tokens.push({ kind: 'hbElse', text });
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (source.startsWith('{{', i)) {
      // Expresión simple ({{value}}, {{helper arg}}, {{{triple}}}, etc.) —
      // no cambia profundidad, es una hoja como cualquier texto.
      const end = source.indexOf('}}', i + 2);
      const text = end === -1 ? source.slice(i) : source.slice(i, end + 2);
      tokens.push({ kind: 'text', text });
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (source[i] === '<' && source[i + 1] === '!') {
      // comentario/doctype: hasta el próximo '>'
      const end = source.indexOf('>', i);
      const text = end === -1 ? source.slice(i) : source.slice(i, end + 1);
      tokens.push({ kind: 'text', text });
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (source[i] === '<') {
      // Busca el '>' que cierra la etiqueta, respetando comillas.
      let j = i + 1;
      let quote: string | null = null;
      while (j < n) {
        const c = source[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
          quote = c;
        } else if (c === '>') {
          break;
        }
        j += 1;
      }
      const text = source.slice(i, j + 1);
      const isClose = /^<\//.test(text);
      const isSelfClose = /\/>\s*$/.test(text);
      const tagMatch = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(text);
      const tag = tagMatch ? tagMatch[1].toLowerCase() : '';
      if (isClose) {
        tokens.push({ kind: 'close', text, tag });
      } else if (isSelfClose || VOID_HTML_TAGS.has(tag)) {
        tokens.push({ kind: 'void', text });
      } else {
        tokens.push({ kind: 'open', text, tag });
      }
      i = j + 1;
      continue;
    }
    // Texto/expresión simple hasta el próximo '<' o '{{'.
    let j = i;
    while (j < n && source[j] !== '<' && !source.startsWith('{{', j)) j += 1;
    const text = source.slice(i, j);
    if (text.trim()) tokens.push({ kind: 'text', text: text.trim() });
    i = j === i ? i + 1 : j;
  }

  return tokens;
}

export function formatHtml(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) return trimmed;

  const tokens = tokenizeHtml(trimmed);
  let depth = 0;
  const lines: string[] = [];

  tokens.forEach(token => {
    if (token.kind === 'close' || token.kind === 'hbClose') {
      depth = Math.max(depth - 1, 0);
    }
    const indent = INDENT_UNIT.repeat(depth);
    if (token.kind === 'hbElse') {
      lines.push(`${INDENT_UNIT.repeat(Math.max(depth - 1, 0))}${token.text}`);
    } else {
      lines.push(`${indent}${token.text}`);
    }
    if (token.kind === 'open' || token.kind === 'hbOpen') {
      depth += 1;
    }
  });

  return lines.join('\n');
}

/** Controles cuyo valor es CSS plano — se muestran con `formatCss` en el diff. */
export const CSS_CONTROLS = new Set(['styleTemplate']);
/** Controles cuyo valor es HTML/Handlebars — se muestran con `formatHtml`. */
export const HTML_CONTROLS = new Set(['handlebarsTemplate']);

/** Formatea el valor de un control para el diff SI es uno de los conocidos
 * como CSS/HTML — para cualquier otro control, devuelve `undefined` (quien
 * llama debe usar el formateo genérico de siempre). Nunca lanza: un valor
 * que no es un string plano (undefined, objeto) tampoco se formatea acá. */
export function formatCodeForDiff(control: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  if (CSS_CONTROLS.has(control)) return formatCss(value);
  if (HTML_CONTROLS.has(control)) return formatHtml(value);
  return undefined;
}

/**
 * Formateador de SQL, mismo espíritu que `formatCss`/`formatHtml` arriba
 * (best-effort para LECTURA humana en el diff de SQL Lab, nunca un parser
 * SQL formal ni algo que decida validez) — hallazgo real 2026-10-05,
 * sesión `sqllab-a14b0f7c...`: el modelo propuso un `replace_document` con
 * el SQL entero en una sola línea (sin ningún salto), y `SqlDiff.tsx` diffa
 * línea por línea sin formatear primero — el resultado fue "se borra todo,
 * se agrega 1 línea gigante", un diff inútil para revisar el cambio real.
 *
 * No reimplementa `tokenizeSql` (ese es para resaltado de color, no para
 * decidir saltos de línea) — reconoce los mismos tramos atómicos (strings,
 * comentarios, bloques Jinja, identificadores entre comillas) para nunca
 * reestructurar su CONTENIDO, y agrega saltos de línea + indentación por
 * profundidad de paréntesis en dos puntos: (1) antes de cada palabra clave
 * de cláusula (SELECT/FROM/WHERE/GROUP BY/JOIN/etc., SIN importar la
 * profundidad — hasta dentro de una subconsulta conviene que tengan su
 * propia línea); (2) después de una coma que separa ítems de la cláusula
 * ACTUAL (misma profundidad en la que se vio la última palabra clave) — una
 * coma dentro de una llamada a función (`coalesce(a,b)`) queda pegada, no
 * se le pierde el rastro a `clauseDepth` por eso.
 */
const SQL_CLAUSE_STARTS = new Set([
  'with', 'select', 'from', 'where', 'group by', 'order by', 'having',
  'limit', 'offset', 'union all', 'union', 'intersect', 'except',
  'full outer join', 'full join', 'left outer join', 'left join',
  'right outer join', 'right join', 'inner join', 'cross join', 'join',
  'left array join', 'array join', 'on', 'using', 'qualify', 'window',
  'settings', 'partition by',
]);

/** Palabra completa (identificador) a partir de `from`, sin exigir que
 * empiece justo ahí — salta espacios primero. Para armar frases de hasta 3
 * palabras (`"left outer join"`) sin consumir nada hasta confirmar match. */
function peekWordAt(source: string, from: number): { word: string; next: number } | undefined {
  let i = from;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
  if (!match) return undefined;
  return { word: match[0], next: i + match[0].length };
}

/** Prueba la frase MÁS LARGA primero (hasta 3 palabras) para no confundir
 * "group" suelto con "group by", ni cortar "left outer join" en "left
 * join". Devuelve el texto real matcheado (conserva su propio espaciado
 * interno) para no inventar separación donde el modelo puso otra. */
function tryMatchClausePhrase(source: string, from: number): { matchedText: string; next: number } | undefined {
  const positions: number[] = [from];
  const words: string[] = [];
  let cursor = from;
  for (let w = 0; w < 3; w += 1) {
    const peek = peekWordAt(source, cursor);
    if (!peek) break;
    words.push(peek.word);
    cursor = peek.next;
    positions.push(cursor);
  }
  for (let count = words.length; count >= 1; count -= 1) {
    const phrase = words.slice(0, count).join(' ').toLowerCase();
    if (SQL_CLAUSE_STARTS.has(phrase)) {
      return { matchedText: source.slice(from, positions[count]), next: positions[count] };
    }
  }
  return undefined;
}

export function formatSql(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) return trimmed;

  let depth = 0;
  // Por nivel de paréntesis: si ESE paréntesis se abrió para una subconsulta
  // o CTE (`(SELECT ...`/`(WITH ...`), el `)` que lo cierra también rompe
  // de línea -- una llamada a función simple (`toWeek(...)`) no.
  const multilineParen: boolean[] = [];
  // Profundidad en la que se vio la última palabra clave de cláusula — una
  // coma en ESA MISMA profundidad separa ítems de la lista (columnas del
  // SELECT, CTEs del WITH, columnas del GROUP BY); más profunda, es de una
  // llamada a función anidada, se deja pegada.
  let clauseDepth: number | undefined;
  let out = '';

  const indent = (level: number) => INDENT_UNIT.repeat(Math.max(level, 0));
  const breakLine = (level: number) => {
    out = out.replace(/[ \t]+$/, '');
    out += `\n${indent(level)}`;
  };
  const currentLineHasContent = () => out.slice(out.lastIndexOf('\n') + 1).trim() !== '';

  let i = 0;
  const n = trimmed.length;
  while (i < n) {
    const c = trimmed[i];
    const two = trimmed.slice(i, i + 2);

    if (two === '--') {
      const end = trimmed.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out += trimmed.slice(i, stop);
      i = stop;
      continue;
    }
    if (two === '/*') {
      const end = trimmed.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += trimmed.slice(i, stop);
      i = stop;
      continue;
    }
    if (two === '{{' || two === '{%' || two === '{#') {
      const close = two === '{{' ? '}}' : two === '{%' ? '%}' : '#}';
      const end = trimmed.indexOf(close, i + 2);
      const stop = end === -1 ? n : end + close.length;
      out += trimmed.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (trimmed[j] === "'" && trimmed[j + 1] === "'") j += 2;
        else if (trimmed[j] === "'") {
          j += 1;
          break;
        } else j += 1;
      }
      out += trimmed.slice(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === '`') {
      const end = trimmed.indexOf(c, i + 1);
      const stop = end === -1 ? n : end + 1;
      out += trimmed.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === '$' && /^\$[A-Za-z_]*\$/.test(trimmed.slice(i))) {
      const tag = /^\$[A-Za-z_]*\$/.exec(trimmed.slice(i))![0];
      const end = trimmed.indexOf(tag, i + tag.length);
      const stop = end === -1 ? n : end + tag.length;
      out += trimmed.slice(i, stop);
      i = stop;
      continue;
    }

    if (/\s/.test(c)) {
      // Colapsa cualquier corrida de espacios/saltos del original a UNO
      // solo -- los saltos que de verdad importan los agrega esta función
      // en los puntos estructurales de arriba.
      out = out === '' || out.endsWith(' ') || out.endsWith('\n') ? out : `${out} `;
      let j = i;
      while (j < n && /\s/.test(trimmed[j])) j += 1;
      i = j;
      continue;
    }

    if (c === '(' || c === '[') {
      // `[...]` (array literal, ej. `ARRAY JOIN [a,b,c]`) comparte la
      // misma pila/profundidad que `(` -- sin esto, una coma DENTRO del
      // array se confunde con una coma de la cláusula (misma profundidad
      // vista en `clauseDepth`) y corta ahí (hallazgo real probando contra
      // el SQL de producción de la sesión que reportó el bug). Nunca abre
      // multilínea (`[` no empieza una subconsulta).
      out += c;
      const peek = c === '(' ? peekWordAt(trimmed, i + 1) : undefined;
      const opensBlock = !!peek && (peek.word.toLowerCase() === 'select' || peek.word.toLowerCase() === 'with');
      depth += 1;
      multilineParen.push(opensBlock);
      if (opensBlock) breakLine(depth);
      i += 1;
      continue;
    }
    if (c === ')' || c === ']') {
      const wasMultiline = multilineParen.pop() ?? false;
      depth = Math.max(depth - 1, 0);
      if (clauseDepth !== undefined && clauseDepth > depth) clauseDepth = undefined;
      if (wasMultiline) breakLine(depth);
      out = out.replace(/[ \t]+$/, '');
      out += c;
      i += 1;
      continue;
    }
    if (c === ',') {
      out = out.replace(/[ \t]+$/, '');
      out += ',';
      i += 1;
      if (clauseDepth !== undefined && depth === clauseDepth) {
        while (i < n && /\s/.test(trimmed[i])) i += 1;
        breakLine(depth + 1);
      }
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      const clause = tryMatchClausePhrase(trimmed, i);
      if (clause) {
        // Sin el `if`: cuando NO hace falta el salto (ya estamos recién
        // bajados de línea por un `(` de subconsulta, ver `breakLine`
        // arriba) este `replace` se comía la indentación que ya estaba
        // puesta, dejando "SELECT" pegado al margen en vez de indentado
        // (hallazgo real corriendo esto contra el SQL de producción).
        if (currentLineHasContent()) breakLine(depth);
        out += clause.matchedText.replace(/\s+/g, ' ').toUpperCase();
        clauseDepth = depth;
        i = clause.next;
        continue;
      }
      const end = i + /^[A-Za-z_][A-Za-z0-9_]*/.exec(trimmed.slice(i))![0].length;
      out += trimmed.slice(i, end);
      i = end;
      continue;
    }

    out += c;
    i += 1;
  }

  return out
    .split('\n')
    .map(line => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim();
}

/** `true` cuando `sql` tiene cara de venir SIN saltos de línea reales
 * (el caso real encontrado: una consulta larga entera en una sola línea) —
 * umbral de longitud para no reformatear un `SELECT 1` corto que
 * legítimamente no necesita ninguna línea nueva. Quien llama (`SqlDiff`)
 * solo normaliza con `formatSql` cuando esto da `true`, para no arriesgar
 * reformatear (con OTRO estilo) un SQL que ya viene bien formateado. */
export function looksUnformattedSql(sql: string): boolean {
  return sql.trim().length > 80 && !sql.includes('\n');
}
