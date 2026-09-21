/**
 * Adaptador hacia el backend externo del chat (Fase 6 del plan).
 *
 * El navegador nunca habla directo con el backend del chat — todo pasa por
 * el proxy same-origin que ya expone `custom-src/login/mcp_widget.py`
 * (`/api/chat-widget/api/<subpath>`), que agrega automáticamente los
 * headers de identidad (`X-Superset-User`, etc.) a partir de la sesión de
 * Flask ya autenticada. Este módulo no gestiona JWT ni headers de auth: el
 * `fetch` same-origin con `credentials: 'same-origin'` alcanza.
 *
 * Convierte entre el `camelCase` de `contracts/assistant.ts` (uso interno
 * del panel) y el `snake_case` del wire format documentado en
 * `docs/sql-lab-assistant-contract.md`.
 */
import type {
  AssistantAction,
  AssistantContext,
  AssistantDiagnostic,
  AssistantResponse,
} from '../contracts/assistant';
import { ASSISTANT_CONTRACT_VERSION } from '../contracts/assistant';

/** Subpath detrás de `/api/chat-widget/api/` para este contrato. Coordinar
 * cualquier cambio de nombre con el agente que mantiene el backend del chat. */
export const SQL_LAB_ASSISTANT_ENDPOINT = '/api/chat-widget/api/sql-lab-assistant';

export class AssistantBackendError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'AssistantBackendError';
  }
}

function serializeContext(context: AssistantContext): Record<string, unknown> {
  return {
    contract_version: context.contractVersion,
    source: context.source,
    mode: context.mode,
    user_message: context.userMessage,
    last_error: context.lastError
      ? { message: context.lastError.message, sql: context.lastError.sql }
      : null,
    tab: {
      id: context.tab.id,
      title: context.tab.title,
      database_id: context.tab.databaseId,
      catalog: context.tab.catalog,
      schema: context.tab.schema,
    },
    editor: {
      sql: context.editor.sql,
      selected_sql: context.editor.selectedSql,
      cursor: {
        line: context.editor.cursor.line,
        column: context.editor.cursor.column,
      },
    },
  };
}

function parseAction(raw: unknown, index: number): AssistantAction {
  if (typeof raw !== 'object' || raw === null || !('type' in raw)) {
    throw new AssistantBackendError(`actions[${index}] inválida: no es un objeto con "type".`);
  }
  const action = raw as Record<string, unknown>;
  const sql = typeof action.sql === 'string' ? action.sql : undefined;

  switch (action.type) {
    case 'propose_sql': {
      const target = action.target;
      if (
        (target !== 'selection' && target !== 'document' && target !== 'newTab') ||
        sql === undefined ||
        typeof action.title !== 'string'
      ) {
        throw new AssistantBackendError(
          `actions[${index}] tipo propose_sql inválida: faltan target/sql/title.`,
        );
      }
      return { type: 'propose_sql', target, sql, title: action.title };
    }
    case 'replace_selection':
      if (sql === undefined) {
        throw new AssistantBackendError(`actions[${index}] replace_selection sin "sql".`);
      }
      return {
        type: 'replace_selection',
        sql,
        title: typeof action.title === 'string' ? action.title : undefined,
      };
    case 'replace_document':
      if (sql === undefined) {
        throw new AssistantBackendError(`actions[${index}] replace_document sin "sql".`);
      }
      return {
        type: 'replace_document',
        sql,
        title: typeof action.title === 'string' ? action.title : undefined,
      };
    case 'insert_sql':
      if (sql === undefined) {
        throw new AssistantBackendError(`actions[${index}] insert_sql sin "sql".`);
      }
      return {
        type: 'insert_sql',
        sql,
        title: typeof action.title === 'string' ? action.title : undefined,
      };
    case 'create_tab':
      if (sql === undefined) {
        throw new AssistantBackendError(`actions[${index}] create_tab sin "sql".`);
      }
      return {
        type: 'create_tab',
        sql,
        title: typeof action.title === 'string' ? action.title : undefined,
      };
    case 'suggest_execution':
      if (sql === undefined) {
        throw new AssistantBackendError(`actions[${index}] suggest_execution sin "sql".`);
      }
      return {
        type: 'suggest_execution',
        sql,
        reason: typeof action.reason === 'string' ? action.reason : undefined,
      };
    default:
      throw new AssistantBackendError(
        `actions[${index}] tiene un "type" no soportado por el contrato v1: ${String(action.type)}`,
      );
  }
}

function parseDiagnostic(raw: unknown, index: number): AssistantDiagnostic {
  if (typeof raw !== 'object' || raw === null) {
    throw new AssistantBackendError(`diagnostics[${index}] inválida: no es un objeto.`);
  }
  const diag = raw as Record<string, unknown>;
  if (
    typeof diag.line !== 'number' ||
    typeof diag.message !== 'string' ||
    (diag.severity !== 'error' && diag.severity !== 'warning' && diag.severity !== 'info')
  ) {
    throw new AssistantBackendError(`diagnostics[${index}] inválida: faltan line/severity/message.`);
  }
  return {
    line: diag.line,
    column: typeof diag.column === 'number' ? diag.column : undefined,
    severity: diag.severity,
    message: diag.message,
  };
}

/**
 * Convierte la respuesta cruda del backend (snake_case, sin tipar) al
 * contrato interno. No parsea SQL desde `message` — solo confía en el
 * campo `sql` tipado de cada `action`, tal como exige el contrato.
 */
export function parseAssistantResponse(raw: unknown): AssistantResponse {
  if (typeof raw !== 'object' || raw === null) {
    throw new AssistantBackendError('Respuesta del backend del chat no es un objeto JSON.');
  }
  const body = raw as Record<string, unknown>;

  if (body.contract_version !== ASSISTANT_CONTRACT_VERSION) {
    throw new AssistantBackendError(
      `contract_version del backend (${String(body.contract_version)}) no coincide con la ` +
        `versión soportada por el panel (${ASSISTANT_CONTRACT_VERSION}).`,
    );
  }
  if (typeof body.message !== 'string') {
    throw new AssistantBackendError('Respuesta del backend del chat sin campo "message".');
  }
  if (!Array.isArray(body.actions) || !Array.isArray(body.diagnostics)) {
    throw new AssistantBackendError('Respuesta del backend del chat sin "actions"/"diagnostics".');
  }

  return {
    contractVersion: ASSISTANT_CONTRACT_VERSION,
    message: body.message,
    actions: body.actions.map(parseAction),
    diagnostics: body.diagnostics.map(parseDiagnostic),
  };
}

/** Progreso intermedio emitido por el backend mientras arma la propuesta —
 * ver eventos `status`/`activity` en el SSE de `sql-lab-assistant`. */
export type AssistantProgressEvent =
  | { type: 'status'; state: 'thinking' | 'calling_tool' | 'responding' }
  | { type: 'activity'; message: string };

export type AssistantProgressListener = (event: AssistantProgressEvent) => void;

interface SseFrame {
  event?: string;
  data: string;
}

/** Un frame SSE es un bloque de líneas `campo: valor` terminado en línea
 * vacía. Solo nos interesan `event:`/`data:` — el resto (`id:`, `retry:`,
 * comentarios `:`) se ignora, igual que hace cualquier consumidor SSE
 * genérico (mismo criterio que el widget principal del chat). */
function parseSseFrame(rawFrame: string): SseFrame | null {
  const dataLines: string[] = [];
  let event: string | undefined;
  for (const line of rawFrame.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

/**
 * Lee la respuesta SSE de `sql-lab-assistant` frame por frame y resuelve
 * con el `AssistantResponse` final (evento `done.sql_lab_response`).
 * `tool_call`/`tool_result` crudos NO se exponen por SSE (podrían traer SQL
 * o resultados sensibles) — esta función ni los espera ni los procesaría;
 * cualquier evento que no sea `status`/`activity`/`done`/`error` se ignora
 * en silencio, para no romper si el backend suma eventos nuevos después.
 */
async function consumeAssistantStream(
  body: ReadableStream<Uint8Array>,
  onProgress?: AssistantProgressListener,
): Promise<AssistantResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const processFrame = (rawFrame: string): AssistantResponse | undefined => {
    const frame = parseSseFrame(rawFrame);
    if (!frame) return undefined;

    let payload: unknown;
    try {
      payload = JSON.parse(frame.data);
    } catch {
      return undefined; // frame no-JSON (keep-alive/comentario) — se ignora
    }
    if (typeof payload !== 'object' || payload === null) return undefined;
    const body_ = payload as Record<string, unknown>;
    const eventType = frame.event ?? (typeof body_.type === 'string' ? body_.type : undefined);

    switch (eventType) {
      case 'status':
        if (body_.state === 'thinking' || body_.state === 'calling_tool' || body_.state === 'responding') {
          onProgress?.({ type: 'status', state: body_.state });
        }
        return undefined;
      case 'activity':
        if (typeof body_.message === 'string') {
          onProgress?.({ type: 'activity', message: body_.message });
        }
        return undefined;
      case 'done':
        return parseAssistantResponse(body_.sql_lab_response);
      case 'error':
        throw new AssistantBackendError(
          typeof body_.message === 'string' ? body_.message : 'El backend del chat reportó un error.',
        );
      default:
        return undefined; // evento desconocido — adelante a futuro, no rompe
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        // Normaliza CRLF->LF antes de separar frames; el payload JSON de
        // cada `data:` ya trae sus propios saltos de línea escapados, así
        // que esto nunca toca contenido real, solo el framing SSE.
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      }

      let separatorIndex: number;
      // eslint-disable-next-line no-cond-assign
      while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
        const rawFrame = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const result = processFrame(rawFrame);
        if (result) return result;
      }

      if (done) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  throw new AssistantBackendError('El backend del chat cerró la conexión sin enviar un evento "done".');
}

/**
 * Envía el contexto de SQL Lab al backend del chat y devuelve su
 * propuesta. Un `Permission denied: ...` (RBAC de la Fase 2) llega como
 * error HTTP del proxy o como texto plano en el body — se expone tal cual
 * en `AssistantBackendError.message` para que el panel lo muestre sin
 * reintentar (ver "Requerimientos para el agente del chat" en el plan).
 *
 * El backend responde por SSE (`Accept: text/event-stream`) para poder
 * emitir progreso intermedio (`onProgress`) mientras arma la propuesta —
 * ver `consumeAssistantStream`. Si el backend todavía no lo soporta y
 * responde JSON plano (`Content-Type` sin `text/event-stream`), se procesa
 * como el contrato v1 de siempre; ningún entorno queda roto por desplegar
 * el frontend antes que el backend, o viceversa.
 */
export async function requestAssistantResponse(
  context: AssistantContext,
  endpoint: string = SQL_LAB_ASSISTANT_ENDPOINT,
  signal?: AbortSignal,
  onProgress?: AssistantProgressListener,
): Promise<AssistantResponse> {
  const httpResponse = await fetch(endpoint, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(serializeContext(context)),
    signal,
  });

  if (!httpResponse.ok) {
    const rawText = await httpResponse.text();
    throw new AssistantBackendError(
      rawText || `El backend del chat respondió ${httpResponse.status}.`,
      httpResponse.status,
    );
  }

  const contentType = httpResponse.headers.get('Content-Type') ?? '';
  if (contentType.includes('text/event-stream') && httpResponse.body) {
    return consumeAssistantStream(httpResponse.body, onProgress);
  }

  // Fallback JSON v1 — backend todavía no desplegado con soporte SSE.
  const rawText = await httpResponse.text();
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new AssistantBackendError('La respuesta del backend del chat no es JSON válido.');
  }

  return parseAssistantResponse(parsedJson);
}
