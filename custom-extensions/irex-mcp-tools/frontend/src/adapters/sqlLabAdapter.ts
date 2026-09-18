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
 * el editor de esa pestaña (ver `probeInactiveTabEditors`).
 */
export async function readActiveContext(): Promise<AssistantContext> {
  const tab = await getCurrentTabOrThrow();
  const editor = await tab.getEditor();
  const cursor = editor.getCursorPosition();

  return {
    contractVersion: ASSISTANT_CONTRACT_VERSION,
    source: 'superset_sqllab',
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

/**
 * Ejecuta SQL vía el pipeline normal de SQL Lab (RLS, historial, permisos
 * de base/dataset incluidos). Debe llamarse solo tras una confirmación
 * explícita del usuario — nunca automáticamente. El MCP `execute_sql`
 * permanece deshabilitado; esta es la única vía de ejecución del spike.
 */
export function executeConfirmed(sql: string): Promise<string> {
  return sqlLab.executeQuery({ sql });
}

export function cancelQuery(queryId: string): Promise<void> {
  return sqlLab.cancelQuery(queryId);
}

export function onActiveTabChanged(listener: (tab: sqlLab.Tab) => void) {
  return sqlLab.onDidChangeActiveTab(listener);
}

export function onQuerySuccess(listener: (result: unknown) => void) {
  return sqlLab.onDidQuerySuccess(listener);
}

export function onQueryFail(listener: (result: unknown) => void) {
  return sqlLab.onDidQueryFail(listener);
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
