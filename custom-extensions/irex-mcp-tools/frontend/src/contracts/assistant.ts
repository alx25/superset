/**
 * Contrato v1 entre el panel de SQL Lab y el backend del chat.
 *
 * Ver PLAN_ASISTENTE_SQL_LAB.md, Fase 3. Este archivo define únicamente
 * tipos: no debe importar nada de `@apache-superset/core` ni de React,
 * para que el backend del chat (mantenido por otro agente) pueda
 * copiarlo/portarlo sin arrastrar dependencias de Superset.
 */

export const ASSISTANT_CONTRACT_VERSION = 1;

export interface AssistantTabContext {
  id: string;
  title: string;
  databaseId: number;
  catalog: string | null;
  schema: string | null;
}

export interface AssistantCursorPosition {
  line: number;
  column: number;
}

export interface AssistantEditorContext {
  sql: string;
  selectedSql: string;
  cursor: AssistantCursorPosition;
}

export interface AssistantContext {
  contractVersion: typeof ASSISTANT_CONTRACT_VERSION;
  source: 'superset_sqllab';
  tab: AssistantTabContext;
  editor: AssistantEditorContext;
}

export type AssistantActionTarget = 'selection' | 'document' | 'newTab';

export interface AssistantActionProposeSql {
  type: 'propose_sql';
  target: AssistantActionTarget;
  sql: string;
  title: string;
}

export interface AssistantActionReplaceSelection {
  type: 'replace_selection';
  sql: string;
}

export interface AssistantActionReplaceDocument {
  type: 'replace_document';
  sql: string;
}

export interface AssistantActionInsertSql {
  type: 'insert_sql';
  sql: string;
}

export interface AssistantActionCreateTab {
  type: 'create_tab';
  sql: string;
  title?: string;
}

export interface AssistantActionSuggestExecution {
  type: 'suggest_execution';
  sql: string;
  reason?: string;
}

/**
 * `suggest_execution` nunca ejecuta por sí sola: el panel solo la muestra
 * como una acción que el usuario debe confirmar explícitamente.
 */
export type AssistantAction =
  | AssistantActionProposeSql
  | AssistantActionReplaceSelection
  | AssistantActionReplaceDocument
  | AssistantActionInsertSql
  | AssistantActionCreateTab
  | AssistantActionSuggestExecution;

export type AssistantDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface AssistantDiagnostic {
  line: number;
  column?: number;
  severity: AssistantDiagnosticSeverity;
  message: string;
}

export interface AssistantResponse {
  contractVersion: typeof ASSISTANT_CONTRACT_VERSION;
  message: string;
  actions: AssistantAction[];
  diagnostics: AssistantDiagnostic[];
}

export function isAssistantResponse(value: unknown): value is AssistantResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<AssistantResponse>;
  return (
    candidate.contractVersion === ASSISTANT_CONTRACT_VERSION &&
    typeof candidate.message === 'string' &&
    Array.isArray(candidate.actions) &&
    Array.isArray(candidate.diagnostics)
  );
}
