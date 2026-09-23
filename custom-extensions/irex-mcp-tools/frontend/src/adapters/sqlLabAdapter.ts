/**
 * Único módulo que conoce la API host de SQL Lab (`@apache-superset/core`).
 *
 * Ver PLAN_ASISTENTE_SQL_LAB.md, Fase 4. El panel y cualquier otro código
 * del spike deben pasar siempre por estas funciones en vez de importar
 * `sqlLab`/`editors` directamente, para que una futura migración de host
 * (ej. `chat.registerChat`) solo requiera cambiar este archivo.
 */
import { sqlLab, editors as editorsNs } from '@apache-superset/core';
import type {
  AssistantAction,
  AssistantContext,
  AssistantLastError,
  AssistantMode,
} from '../contracts/assistant';
import { ASSISTANT_CONTRACT_VERSION } from '../contracts/assistant';

export class NoActiveTabError extends Error {
  constructor() {
    super('No hay una pestaña activa en SQL Lab.');
    this.name = 'NoActiveTabError';
  }
}

async function getCurrentTabOrThrow(): Promise<sqlLab.Tab> {
  const tab = sqlLab.getCurrentTab();
  if (!tab) {
    throw new NoActiveTabError();
  }
  return tab;
}

/**
 * Construye el contrato v1 a partir del estado real de la pestaña activa.
 * Lee únicamente la pestaña activa — SQL Lab solo garantiza tener montado
 * el editor de esa pestaña (ver `probeInactiveTabEditors`). `mode`,
 * `userMessage` y `lastError` vienen del panel (Fase 5): esta función solo
 * aporta la parte que se lee en vivo del editor/pestaña.
 */
export async function readActiveContext(
  mode: AssistantMode,
  userMessage: string,
  lastError?: AssistantLastError,
): Promise<AssistantContext> {
  const tab = await getCurrentTabOrThrow();
  const editor = await tab.getEditor();
  const cursor = editor.getCursorPosition();

  return {
    contractVersion: ASSISTANT_CONTRACT_VERSION,
    source: 'superset_sqllab',
    mode,
    userMessage,
    lastError,
    tab: {
      id: tab.id,
      title: tab.title,
      databaseId: tab.databaseId,
      catalog: tab.catalog,
      schema: tab.schema,
    },
    editor: {
      sql: editor.getValue(),
      selectedSql: editor.getSelectedText(),
      cursor: { line: cursor.line, column: cursor.column },
    },
  };
}

export function listOpenTabs(): sqlLab.Tab[] {
  return sqlLab.getTabs();
}

/**
 * Aplica una acción del contrato sobre el editor de la pestaña activa,
 * o crea una pestaña nueva para `create_tab`. Nunca ejecuta la consulta:
 * eso solo ocurre en `executeConfirmed`, tras confirmación explícita
 * del usuario en el panel.
 */
export async function applyAction(action: AssistantAction): Promise<void> {
  switch (action.type) {
    case 'replace_selection': {
      const tab = await getCurrentTabOrThrow();
      const editor = await tab.getEditor();
      editor.insertText(action.sql);
      return;
    }
    case 'replace_document': {
      const tab = await getCurrentTabOrThrow();
      const editor = await tab.getEditor();
      editor.setValue(action.sql);
      return;
    }
    case 'insert_sql': {
      const tab = await getCurrentTabOrThrow();
      const editor = await tab.getEditor();
      editor.insertText(action.sql);
      return;
    }
    case 'create_tab': {
      await sqlLab.createTab({ sql: action.sql, title: action.title });
      return;
    }
    case 'propose_sql':
    case 'suggest_execution':
      // Estas acciones son de presentación: el panel decide cómo mostrarlas
      // y solo llama a applyAction/executeConfirmed cuando el usuario elige
      // un botón concreto (Aplicar, Nueva pestaña, Ejecutar).
      return;
    default: {
      const exhaustiveCheck: never = action;
      throw new Error(`Acción de asistente no soportada: ${exhaustiveCheck}`);
    }
  }
}

export function setDiagnostics(annotations: editorsNs.EditorAnnotation[]): Promise<void> {
  return getCurrentTabOrThrow().then(tab =>
    tab.getEditor().then(editor => editor.setAnnotations(annotations)),
  );
}

/** Lee el documento completo de la pestaña activa (para snapshots de deshacer/rehacer). */
export async function getCurrentDocumentValue(): Promise<string> {
  const tab = await getCurrentTabOrThrow();
  const editor = await tab.getEditor();
  return editor.getValue();
}

/**
 * Encuentra el primer y último índice de línea (0-based, sobre `after`) que
 * cambiaron entre dos documentos completos, recortando el prefijo/sufijo
 * común. No es un diff completo (no distingue líneas movidas); alcanza para
 * ubicar dónde mirar en el editor tras aplicar un cambio.
 */
function changedLineRange(before: string, after: string): { start: number; end: number } | undefined {
  if (before === after) return undefined;
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let aEnd = a.length - 1;
  let bEnd = b.length - 1;
  while (aEnd >= start && bEnd >= start && a[aEnd] === b[bEnd]) {
    aEnd -= 1;
    bEnd -= 1;
  }
  return { start, end: Math.max(start, bEnd) };
}

/**
 * Acerca la experiencia de "Aplicar cambio" a un editor de código nativo:
 * selecciona en el editor real de SQL Lab exactamente el rango que cambió,
 * hace scroll hasta ahí y deja una anotación con el motivo. `EditorHandle`
 * no expone decoraciones/diff inline (ver `@apache-superset/core/editors`),
 * así que esto es lo más cercano disponible sin tocar el host.
 */
export async function revealChange(before: string, after: string, message: string): Promise<void> {
  const range = changedLineRange(before, after);
  if (!range) return;
  const tab = await getCurrentTabOrThrow();
  const editor = await tab.getEditor();
  const afterLines = after.split('\n');
  editor.setSelection({
    start: { line: range.start, column: 0 },
    end: { line: range.end, column: afterLines[range.end]?.length ?? 0 },
  });
  editor.scrollToLine(range.start);
  editor.setAnnotations([{ line: range.start, message, severity: 'info' }]);
  editor.focus();
}

/** Limpia la anotación dejada por `revealChange` (p. ej. al deshacer). */
export async function clearRevealedChange(): Promise<void> {
  const tab = await getCurrentTabOrThrow();
  const editor = await tab.getEditor();
  editor.clearAnnotations();
}

/**
 * Límite de filas de toda ejecución lanzada por el asistente (Fase 8). Igual
 * a `DEFAULT_SQLLAB_LIMIT` de esta instalación, pero explícito: sin esto,
 * `executeQuery` hereda el límite elegido en la pestaña, que el usuario
 * puede haber subido hasta `SQL_MAX_ROW` (100000). La API pública no expone
 * el límite de la pestaña, así que no se puede tomar el mínimo de los dos.
 * Superset solo lo aplica a consultas de lectura; no afecta DML/DDL.
 */
export const ASSISTANT_EXECUTION_LIMIT = 1000;

/**
 * Ejecuta SQL vía el pipeline normal de SQL Lab (RLS, historial, permisos
 * de base/dataset y `allow_dml` incluidos — el servidor revalida con el
 * parser de Superset). Debe llamarse solo tras una confirmación explícita
 * del usuario — nunca automáticamente. El MCP `execute_sql` permanece
 * deshabilitado; esta es la única vía de ejecución del asistente.
 *
 * Devuelve el client id de la consulta: el mismo valor que llega como
 * `clientId` en `onQuerySuccess`/`onQueryFail`/`onQueryStop`.
 */
export function executeConfirmed(sql: string): Promise<string> {
  return sqlLab.executeQuery({ sql, limit: ASSISTANT_EXECUTION_LIMIT });
}

export function cancelQuery(queryId: string): Promise<void> {
  return sqlLab.cancelQuery(queryId);
}

export function onActiveTabChanged(listener: (tab: sqlLab.Tab) => void) {
  return sqlLab.onDidChangeActiveTab(listener);
}

export function onQuerySuccess(listener: (result: sqlLab.QueryResultContext) => void) {
  return sqlLab.onDidQuerySuccess(listener);
}

export function onQueryFail(listener: (result: sqlLab.QueryErrorResultContext) => void) {
  return sqlLab.onDidQueryFail(listener);
}

export function onQueryStop(listener: (query: sqlLab.QueryContext) => void) {
  return sqlLab.onDidQueryStop(listener);
}

export type TabEditorProbeStatus = 'resolved' | 'timeout' | 'rejected';

export interface TabEditorProbeResult {
  tabId: string;
  tabTitle: string;
  isActive: boolean;
  status: TabEditorProbeStatus;
  elapsedMs: number;
  valuePreview?: string;
  errorMessage?: string;
}

/**
 * Fase 0, punto 6: mide qué pasa al llamar `tab.getEditor()` sobre pestañas
 * que no son la activa — Superset solo garantiza montar el editor de la
 * pestaña activa, y el comentario de la API no aclara si `getEditor()` de
 * una inactiva queda pendiente indefinidamente, se resuelve igual, o
 * rechaza. Corre cada llamada con un timeout propio para no colgar el panel
 * si alguna pestaña nunca resuelve.
 */
export async function probeInactiveTabEditors(
  timeoutMs = 1500,
): Promise<TabEditorProbeResult[]> {
  const tabs = sqlLab.getTabs();
  const activeTab = sqlLab.getCurrentTab();

  const probeOne = async (tab: sqlLab.Tab): Promise<TabEditorProbeResult> => {
    const start = performance.now();
    const isActive = tab.id === activeTab?.id;

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>(resolve => {
      timeoutHandle = setTimeout(() => resolve('timeout'), timeoutMs);
    });

    try {
      const outcome = await Promise.race<sqlLab.Editor | "timeout">([
        tab.getEditor(),
        timeout,
      ]);
      const elapsedMs = performance.now() - start;

      if (outcome === 'timeout') {
        return { tabId: tab.id, tabTitle: tab.title, isActive, status: 'timeout', elapsedMs };
      }

      const value = outcome.getValue();
      return {
        tabId: tab.id,
        tabTitle: tab.title,
        isActive,
        status: 'resolved',
        elapsedMs,
        valuePreview: value.slice(0, 80),
      };
    } catch (error) {
      const elapsedMs = performance.now() - start;
      return {
        tabId: tab.id,
        tabTitle: tab.title,
        isActive,
        status: 'rejected',
        elapsedMs,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  };

  return Promise.all(tabs.map(probeOne));
}
