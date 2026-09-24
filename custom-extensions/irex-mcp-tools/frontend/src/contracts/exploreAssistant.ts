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

/** Contrato v1 del copiloto Explore. El transporte y la aplicación de
 * acciones se habilitan únicamente tras verificar el estado por MCP. */
export const EXPLORE_CONTRACT_VERSION = 1;
export type ExploreMode = 'explain' | 'improve_chart' | 'metrics';

export interface ExploreChartContext {
  slice_id: number | null;
  form_data_key: string;
  viz_type: string;
  datasource: { id: number; type: string };
  /**
   * El `query_context` EXACTO que el navegador capturó al observar la
   * última ejecución real del gráfico (`POST /api/v1/chart/data` — ver
   * `hosts/exploreQueryCapture.ts`), como texto JSON tal cual. Presente
   * solo cuando hay una captura para el gráfico abierto (o su
   * `query_context` guardado, si no hubo ejecuciones posteriores — mismo
   * criterio que `resolveQueryFidelity`, `status: 'fiel'`). Es lo que el
   * modelo debe pasar sin modificar a `irex.explain_chart`/
   * `irex.preview_chart` — esas tools lo re-ejecutan bajo RLS como
   * verificación independiente; nunca se reconstruye a partir de
   * `form_data`.
   */
  query_context?: string;
}

export interface ExploreAssistantRequest {
  contract_version: typeof EXPLORE_CONTRACT_VERSION;
  source: 'superset_explore';
  mode: ExploreMode;
  user_message: string;
  conversation_key: string;
  user: { is_admin: boolean };
  chart: ExploreChartContext;
  form_data: Record<string, unknown>;
  dataset: Record<string, unknown>;
}

export type ExploreOperation =
  | { op: 'set' | 'add'; control: string; value: unknown }
  | { op: 'remove'; control: string };

export type ExploreAction =
  | { type: 'patch_form_data'; base_form_data_key: string; operations: ExploreOperation[]; title?: string }
  | { type: 'add_adhoc_metric' | 'add_adhoc_column'; base_form_data_key: string; control: string; label: string; expression: string; expression_type?: 'SQL' | 'SIMPLE'; title?: string }
  | { type: 'change_viz_type'; base_form_data_key: string; viz_type: string; title?: string }
  | { type: 'add_dataset_metric' | 'add_calculated_column'; dataset_id: number; label: string; expression: string; expression_type?: 'SQL' | 'SIMPLE'; title?: string }
  | { type: 'preview'; title?: string };

export interface ExploreDiagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
  control?: string;
}

export interface ExploreAssistantResponse {
  contract_version: typeof EXPLORE_CONTRACT_VERSION;
  source: 'superset_explore';
  session_id?: string;
  message: string;
  actions: ExploreAction[];
  diagnostics: ExploreDiagnostic[];
  suggestion_kind?: 'clarification';
  clarification_reason?: string;
  clarification_questions?: Array<{ id: string; text: string; options: string[]; axis?: string }>;
  skip_suggestions?: boolean;
  suggestions?: unknown[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalTitle(raw: Record<string, unknown>): { title?: string } {
  return nonempty(raw.title) ? { title: raw.title } : {};
}

/** Rechaza todo el sobre si contiene una acción mal formada. Ninguna acción
 * de este parser se aplica automáticamente: el catálogo, la key actual y
 * la confirmación se comprobarán inmediatamente antes de aplicar. */
export function parseExploreAssistantResponse(raw: unknown): ExploreAssistantResponse {
  const body = record(raw);
  if (!body || body.contract_version !== 1 || body.source !== 'superset_explore' ||
      typeof body.message !== 'string' || !Array.isArray(body.actions) || !Array.isArray(body.diagnostics)) {
    throw new Error('Respuesta Explore v1 inválida.');
  }
  const actions: ExploreAction[] = body.actions.map((value: unknown, index: number): ExploreAction => {
    const action = record(value);
    if (!action) throw new Error(`Acción Explore ${index} inválida.`);
    const title = optionalTitle(action);
    switch (action.type) {
      case 'patch_form_data': {
        if (!nonempty(action.base_form_data_key) || !Array.isArray(action.operations)) break;
        const operations: ExploreOperation[] = action.operations.map((item: unknown): ExploreOperation => {
          const operation = record(item);
          if (!operation || !nonempty(operation.control)) throw new Error('Operación Explore inválida.');
          if (operation.op === 'remove') return { op: 'remove', control: operation.control };
          if ((operation.op === 'set' || operation.op === 'add') && 'value' in operation) {
            return { op: operation.op, control: operation.control, value: operation.value };
          }
          throw new Error('Operación Explore inválida.');
        });
        return { type: 'patch_form_data', base_form_data_key: action.base_form_data_key, operations, ...title };
      }
      case 'add_adhoc_metric':
      case 'add_adhoc_column':
        if (!nonempty(action.base_form_data_key) || !nonempty(action.control) ||
            !nonempty(action.label) || !nonempty(action.expression)) break;
        return { type: action.type, base_form_data_key: action.base_form_data_key,
          control: action.control, label: action.label, expression: action.expression,
          ...(action.expression_type === 'SQL' || action.expression_type === 'SIMPLE'
            ? { expression_type: action.expression_type } : {}), ...title };
      case 'change_viz_type':
        if (!nonempty(action.base_form_data_key) || !nonempty(action.viz_type)) break;
        return { type: 'change_viz_type', base_form_data_key: action.base_form_data_key, viz_type: action.viz_type, ...title };
      case 'add_dataset_metric':
      case 'add_calculated_column':
        if (!Number.isSafeInteger(action.dataset_id) || Number(action.dataset_id) <= 0 ||
            !nonempty(action.label) || !nonempty(action.expression)) break;
        return { type: action.type, dataset_id: action.dataset_id as number,
          label: action.label, expression: action.expression,
          ...(action.expression_type === 'SQL' || action.expression_type === 'SIMPLE'
            ? { expression_type: action.expression_type } : {}), ...title };
      case 'preview':
        return { type: 'preview', ...title };
      default:
        break;
    }
    throw new Error(`Acción Explore ${index} inválida.`);
  });
  const diagnostics: ExploreDiagnostic[] = body.diagnostics.map((value: unknown, index: number) => {
    const diagnostic = record(value);
    if (!diagnostic || !nonempty(diagnostic.message) ||
        (diagnostic.severity !== 'error' && diagnostic.severity !== 'warning' && diagnostic.severity !== 'info')) {
      throw new Error(`Diagnóstico Explore ${index} inválido.`);
    }
    return { severity: diagnostic.severity, message: diagnostic.message,
      ...(nonempty(diagnostic.control) ? { control: diagnostic.control } : {}) };
  });
  if (body.suggestion_kind === 'clarification' && actions.length > 0) {
    throw new Error('Una aclaración Explore no puede incluir acciones.');
  }
  const questions = body.suggestion_kind === 'clarification' && Array.isArray(body.clarification_questions)
    ? body.clarification_questions.map((value: unknown, index: number) => {
        const question = record(value);
        if (!question || !nonempty(question.id) || !nonempty(question.text) ||
            !Array.isArray(question.options) || question.options.length === 0 ||
            !question.options.every(nonempty)) {
          throw new Error(`Aclaración Explore ${index} inválida.`);
        }
        return { id: question.id, text: question.text, options: question.options as string[],
          ...(nonempty(question.axis) ? { axis: question.axis } : {}) };
      }) : undefined;
  return {
    contract_version: 1,
    source: 'superset_explore',
    message: body.message,
    actions,
    diagnostics,
    ...(nonempty(body.session_id) ? { session_id: body.session_id } : {}),
    ...(body.suggestion_kind === 'clarification' ? { suggestion_kind: 'clarification' as const } : {}),
    ...(typeof body.clarification_reason === 'string' ? { clarification_reason: body.clarification_reason } : {}),
    ...(questions ? { clarification_questions: questions } : {}),
    ...(typeof body.skip_suggestions === 'boolean' ? { skip_suggestions: body.skip_suggestions } : {}),
  };
}
