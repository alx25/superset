/**
 * Clasificación conservadora del SQL antes de "Ejecutar con confirmación"
 * (Fase 8 de PLAN_ASISTENTE_SQL_LAB.md).
 *
 * NO es un control de seguridad: la autoridad es el servidor de SQL Lab,
 * que revalida cada ejecución con el parser de Superset (`has_mutation()`
 * + `allow_dml` de la base, `superset/sql_lab.py`) y los permisos del
 * usuario de conexión. Esto solo decide cuándo pedir una confirmación
 * reforzada. El parser de Superset es Python y la API pública del frontend
 * no lo expone, así que acá se usa un escaneo de palabras clave que falla
 * hacia el lado seguro: ante la duda, pide confirmación reforzada. Un falso
 * positivo (p. ej. una columna sin comillas llamada `comment`) solo cuesta
 * una confirmación extra.
 */

/** Palabras que, fuera de comentarios/strings/identificadores entre
 * comillas, indican una posible escritura, DDL o efecto fuera de la consulta. */
const WRITE_KEYWORDS = new Set([
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  'UPSERT',
  'INTO',
  'CREATE',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'RENAME',
  'COMMENT',
  'GRANT',
  'REVOKE',
  'COPY',
  'CALL',
  'EXEC',
  'EXECUTE',
  'DO',
  'VACUUM',
  'ANALYZE',
  'REINDEX',
  'CLUSTER',
  'REFRESH',
  'LOCK',
  'OPTIMIZE',
  'ATTACH',
  'DETACH',
  'SYSTEM',
  'KILL',
]);

export interface ExecutionRisk {
  /** true = pedir confirmación reforzada antes de ejecutar. */
  reinforced: boolean;
  /** Motivos legibles para mostrar al usuario (vacío si `reinforced` es false). */
  reasons: string[];
}

/**
 * Reemplaza por espacios todo lo que no es código SQL "desnudo": comentarios
 * `--` y `/* *\/`, strings `'...'` (con `''` escapado), dollar-quoting de
 * Postgres (`$tag$...$tag$`), identificadores `"..."`/`` `...` ``/`[...]` y
 * comentarios Jinja `{# #}`. Los bloques `{% %}`/`{{ }}` se conservan: pueden
 * generar SQL, así que sus palabras también cuentan.
 */
function stripNonCode(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? n : end;
      out += ' ';
    } else if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      out += ' ';
    } else if (c === '{' && next === '#') {
      const end = sql.indexOf('#}', i + 2);
      i = end === -1 ? n : end + 2;
      out += ' ';
    } else if (c === "'") {
      i += 1;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") break;
        else i += 1;
      }
      i += 1;
      out += ' ';
    } else if (c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      const end = sql.indexOf(close, i + 1);
      i = end === -1 ? n : end + 1;
      out += ' ';
    } else if (c === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        i = end === -1 ? n : end + tag[0].length;
        out += ' ';
      } else {
        out += c;
        i += 1;
      }
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

export function assessExecutionRisk(sql: string): ExecutionRisk {
  const code = stripNonCode(sql);
  const reasons: string[] = [];

  const statements = code
    .split(';')
    .map(part => part.trim())
    .filter(part => part.length > 0);
  if (statements.length > 1) {
    reasons.push(`Contiene ${statements.length} sentencias separadas por ';'.`);
  }

  const words = code.toUpperCase().match(/[A-Z_][A-Z0-9_]*/g) ?? [];
  const found: string[] = [];
  words.forEach(word => {
    if (WRITE_KEYWORDS.has(word) && found.indexOf(word) === -1) found.push(word);
  });
  if (found.length > 0) {
    reasons.push(`Incluye palabras de escritura o DDL: ${found.join(', ')}.`);
  }

  return { reinforced: reasons.length > 0, reasons };
}

/** Palabra que hay que escribir para habilitar una ejecución reforzada. */
export const REINFORCED_CONFIRMATION_WORD = 'EJECUTAR';
