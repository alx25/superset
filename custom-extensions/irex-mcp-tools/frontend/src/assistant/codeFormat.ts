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
