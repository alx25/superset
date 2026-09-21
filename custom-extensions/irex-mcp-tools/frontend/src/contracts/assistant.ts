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

/**
 * Los 4 flujos ofrecidos por el panel (Fase 5). Determinan qué le pide el
 * usuario al asistente sobre el contexto adjunto:
 * - create: partir de cero, sin SQL previo relevante.
 * - review_document: revisar/corregir todo el contenido del editor.
 * - review_selection: revisar/corregir solo el texto seleccionado.
 * - explain_error: explicar y proponer una corrección para `lastError`.
 */
export type AssistantMode = 'create' | 'review_document' | 'review_selection' | 'explain_error';

export interface AssistantLastError {
  message: string;
  sql: string;
}

export interface AssistantContext {
  contractVersion: typeof ASSISTANT_CONTRACT_VERSION;
  source: 'superset_sqllab';
  mode: AssistantMode;
  userMessage: string;
  tab: AssistantTabContext;
  editor: AssistantEditorContext;
  lastError?: AssistantLastError;
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
  /** Opcional: si viene, se muestra como título de la tarjeta en vez del genérico. */
  title?: string;
}

export interface AssistantActionReplaceDocument {
  type: 'replace_document';
  sql: string;
  title?: string;
}

export interface AssistantActionInsertSql {
  type: 'insert_sql';
  sql: string;
  title?: string;
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

/**
 * Una pregunta de aclaración con opciones cerradas — el backend bloquea la
 * propuesta hasta que el usuario elige (2026-09-21, mismo patrón que ya
 * usa el widget principal del chat). Siempre de una sola opción por
 * pregunta; el panel agrega "Otro: especificar" si el backend no lo incluyó.
 */
export interface AssistantClarificationQuestion {
  id: string;
  /** Categoría interna de la pregunta (uso del backend) — no se muestra. */
  axis?: string;
  text: string;
  options: string[];
}

export interface AssistantClarification {
  reason?: string;
  questions: AssistantClarificationQuestion[];
}

export interface AssistantResponse {
  contractVersion: typeof ASSISTANT_CONTRACT_VERSION;
  message: string;
  actions: AssistantAction[];
  diagnostics: AssistantDiagnostic[];
  /**
   * Id canónico de la conversación en el backend (`session_id`), para
   * mostrar en el panel y cruzar con `/api/logs/sessions/<session_id>`.
   * Opcional: puede faltar si el backend todavía no lo manda.
   */
  sessionId?: string;
  /**
   * Presente solo cuando `suggestion_kind === "clarification"` y trae al
   * menos una pregunta. Se arma SIEMPRE desde `clarification_questions` —
   * nunca desde el campo plano `suggestions` (legado de otro consumidor).
   */
  clarification?: AssistantClarification;
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
