/**
 * Divide la respuesta del asistente (Markdown) en un resumen, que se muestra
 * siempre, y un detalle, que va plegado en un `<details>`. La idea es no
 * saturar al usuario cuando solo quiere ver la propuesta de código.
 *
 * Criterio:
 * - Con encabezados (`#`…`######`): el resumen es el texto previo al primer
 *   encabezado más la PRIMERA sección completa (sin su encabezado; en el
 *   backend actual suele ser "## Resultado clave"). El detalle son las demás
 *   secciones, con sus encabezados.
 * - Sin encabezados: el resumen es el primer párrafo y el detalle el resto.
 * - Si el detalle queda vacío, no hay nada que plegar.
 */
export interface MessageSections {
  summary: string;
  details: string;
}

const HEADING = /^#{1,6}\s+\S/;

export function splitAssistantMessage(message: string): MessageSections {
  const text = message.replace(/\r\n/g, '\n').trim();
  if (!text) return { summary: '', details: '' };

  const lines = text.split('\n');
  const headingIndexes = lines.reduce<number[]>((acc, line, index) => (HEADING.test(line) ? [...acc, index] : acc), []);

  if (headingIndexes.length > 0) {
    const [first, second] = headingIndexes;
    const preamble = lines.slice(0, first).join('\n').trim();
    const firstSection = lines.slice(first + 1, second ?? lines.length).join('\n').trim();
    const summary = [preamble, firstSection].filter(Boolean).join('\n\n');
    const details = second === undefined ? '' : lines.slice(second).join('\n').trim();
    // Un único encabezado sin contenido propio: mejor mostrar todo como resumen.
    if (!summary) return { summary: text, details: '' };
    return { summary, details };
  }

  const paragraphs = text.split(/\n\s*\n/);
  return {
    summary: paragraphs[0].trim(),
    details: paragraphs.slice(1).join('\n\n').trim(),
  };
}

/** Encabezados que repiten lo que ya dice el rótulo del desplegable. */
const REDUNDANT_DETAIL_HEADINGS = new Set([
  'detalle',
  'detalles',
  'mas detalle',
  'mas detalles',
  'detalle tecnico',
  'explicacion',
  'justificacion',
  'por que',
]);

function normalizeHeading(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Quita el primer encabezado del detalle si solo repite el rótulo del
 * desplegable ("Ver detalle" → "## Detalle"). */
export function stripRedundantHeading(details: string): string {
  const lines = details.split('\n');
  const match = /^#{1,6}\s+(.+)$/.exec(lines[0] ?? '');
  if (!match || !REDUNDANT_DETAIL_HEADINGS.has(normalizeHeading(match[1]))) return details;
  return lines.slice(1).join('\n').trim();
}
