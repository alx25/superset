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
 * Fase 6 (PLAN_COPILOTO_EXPLORE.md): aplicar una propuesta del asistente al
 * gráfico. `applyExploreAction`/`diffFormData` son puras (transforman un
 * form_data, no tocan la red) — la escritura real (`postAppliedFormData`)
 * va aparte para poder testear el transform sin mockear `fetch`.
 *
 * El gráfico NUNCA se guarda desde acá (regla del plan): solo se escribe un
 * form_data NUEVO en la caché de Explore (mismo mecanismo que usa Explore al
 * ejecutar/renderizar, `POST /api/v1/explore/form_data`) y se recarga la
 * página con esa key — igual que si el usuario hubiera tocado los controles
 * a mano. Guardar sigue siendo, siempre, el botón "Guardar" de Superset.
 *
 * Deliberadamente SIN `tab_id` en el POST de "Aplicar" (a diferencia de
 * `exploreAdapter.ts::readExploreContext`, que sí lo manda al SEMBRAR una
 * key inicial — ver el comentario de `postAppliedFormData` más abajo):
 * `CreateFormDataCommand` (`superset/commands/explore/form_data/create.py`)
 * reusa la key existente de esa pestaña/gráfico cuando SÍ hay `tab_id`, lo
 * que pisaría el estado antes de aplicar y dejaría sin nada a lo que
 * volver con "Deshacer". Sin `tab_id`, siempre genera una key nueva e
 * independiente — la anterior queda intacta.
 */
import { authentication } from '@apache-superset/core';
import type { ExploreAction, ExploreOperation } from '../contracts/exploreAssistant';

export type ApplicableExploreAction = Extract<
  ExploreAction,
  { type: 'patch_form_data' | 'add_adhoc_metric' | 'add_adhoc_column' | 'change_viz_type' }
>;

/** Las otras variantes (`add_dataset_metric`, `add_calculated_column`,
 * `preview`) no se aplican desde acá: las dos primeras son Fase 7 (dataset,
 * Admin, endpoint propio), y `preview` no es un cambio. */
export function isApplicableExploreAction(action: ExploreAction): action is ApplicableExploreAction {
  return (
    action.type === 'patch_form_data' ||
    action.type === 'add_adhoc_metric' ||
    action.type === 'add_adhoc_column' ||
    action.type === 'change_viz_type'
  );
}

function applyOperation(formData: Record<string, unknown>, op: ExploreOperation): Record<string, unknown> {
  const next = { ...formData };
  if (op.op === 'remove') {
    delete next[op.control];
    return next;
  }
  if (op.op === 'set') {
    next[op.control] = op.value;
    return next;
  }
  // op === 'add': si el control ya es un array, agrega al final; si no
  // (vacío o ausente), arranca un array de un solo elemento. Nunca
  // sobrescribe un valor escalar existente con silencio — un control que
  // hoy vale un string y recibe un 'add' se vuelve un array de dos: es lo
  // más parecido a "agregar" sin inventar qué se pretendía reemplazar.
  const current = next[op.control];
  next[op.control] = Array.isArray(current) ? [...current, op.value] : [current, op.value].filter(v => v !== undefined);
  return next;
}

/** Misma forma que un `AdhocMetric`/`AdhocColumn` de tipo SQL de Superset
 * (`expressionType: 'SQL'`) — la que arma la UI de Explore cuando el
 * usuario escribe una métrica/columna a mano. `expression_type: 'SIMPLE'`
 * (columna + agregación por separado, sin SQL) no tiene una forma directa
 * a partir de un solo string `expression`: se cae a SQL igual — un nombre
 * de columna suelto sigue siendo una expresión SQL válida. */
function buildAdhocEntry(label: string, expression: string): Record<string, unknown> {
  return { expressionType: 'SQL', sqlExpression: expression, label, hasCustomLabel: true };
}

/** Transforma `formData` según la acción — nunca muta el original. */
export function applyExploreAction(formData: Record<string, unknown>, action: ApplicableExploreAction): Record<string, unknown> {
  if (action.type === 'patch_form_data') {
    return action.operations.reduce(applyOperation, formData);
  }
  if (action.type === 'change_viz_type') {
    return { ...formData, viz_type: action.viz_type };
  }
  // add_adhoc_metric / add_adhoc_column
  const entry = buildAdhocEntry(action.label, action.expression);
  const next = { ...formData };
  const current = next[action.control];
  next[action.control] = Array.isArray(current) ? [...current, entry] : [entry];
  return next;
}

/** Varias acciones de la MISMA propuesta, aplicadas en orden — mismo
 * mecanismo que ya usan las `operations` de un solo `patch_form_data`
 * (`applyOperation`), pero a nivel de acciones completas. Sin esto,
 * aplicar la primera de N acciones recarga la página (`postAppliedFormData`
 * + `window.location.assign`) y las demás tarjetas de esa misma respuesta
 * desaparecen — el usuario reportó (2026-09-25) que tener que reabrir la
 * propuesta y aplicar una por una "no es adecuado". Une todas en un solo
 * form_data antes de un único POST/reload. */
export function applyExploreActions(formData: Record<string, unknown>, actions: ApplicableExploreAction[]): Record<string, unknown> {
  return actions.reduce((current, action) => applyExploreAction(current, action), formData);
}

export interface ControlDiffEntry {
  control: string;
  before: unknown;
  after: unknown;
}

/** Solo los controles que efectivamente cambian, para la tarjeta de diff —
 * comparación estructural (no por referencia), orden estable por nombre. */
export function diffFormData(before: Record<string, unknown>, after: Record<string, unknown>): ControlDiffEntry[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const entries: ControlDiffEntry[] = [];
  keys.forEach(control => {
    const beforeValue = before[control];
    const afterValue = after[control];
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      entries.push({ control, before: beforeValue, after: afterValue });
    }
  });
  return entries.sort((a, b) => a.control.localeCompare(b.control));
}

/** Legible para un humano, no para depurar — la tarjeta de diff mostraba el
 * JSON crudo de cada control (`{"aggregate":"SUM","column":{...column
 * completa...}}`) y el usuario reportó que era "muy técnico, muy confuso"
 * (2026-09-25). Reconoce las formas reales de `AdhocMetric`/`AdhocColumn`
 * que arma Superset y las reduce a lo que alguien reconocería con solo
 * mirar el gráfico: la etiqueta, o `AGREGACIÓN(columna)`/`sqlExpression`
 * cuando no hay etiqueta propia. Lo que no calza con ninguna forma
 * conocida cae a JSON acotado — mejor un poco técnico que silencioso. */
export function formatControlValue(value: unknown): string {
  if (value === undefined) return '(sin definir)';
  if (value === null) return '(vacío)';
  if (typeof value === 'string') return value || '(vacío)';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.length === 0 ? '(ninguno)' : value.map(formatControlValue).join(', ');
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj.hasCustomLabel === true && typeof obj.label === 'string' && obj.label) return obj.label;
    if (typeof obj.sqlExpression === 'string' && obj.sqlExpression) return obj.sqlExpression;
    if (typeof obj.aggregate === 'string' && obj.aggregate && typeof obj.column === 'object' && obj.column) {
      const columnName = (obj.column as Record<string, unknown>).column_name;
      if (typeof columnName === 'string' && columnName) return `${obj.aggregate}(${columnName})`;
    }
    if (typeof obj.label === 'string' && obj.label) return obj.label;
    if (typeof obj.column_name === 'string' && obj.column_name) return obj.column_name;
    if (typeof obj.metric_name === 'string' && obj.metric_name) return obj.metric_name;
    const text = JSON.stringify(value);
    return text.length > 160 ? `${text.slice(0, 160)}…` : text;
  }
  return String(value);
}

/** Ajustes de UNA columna dentro de `column_config` (personalización:
 * formato numérico, moneda, nombre visible) — no calza con ninguna forma
 * de `formatControlValue` (no es un AdhocMetric/AdhocColumn), así que
 * necesita su propio resumen. */
function formatColumnSettings(settings: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof settings.d3NumberFormat === 'string' && settings.d3NumberFormat) {
    parts.push(`formato numérico "${settings.d3NumberFormat}"`);
  }
  if (typeof settings.d3SmallNumberFormat === 'string' && settings.d3SmallNumberFormat) {
    parts.push(`formato para valores chicos "${settings.d3SmallNumberFormat}"`);
  }
  if (typeof settings.currency === 'object' && settings.currency !== null) {
    const symbol = (settings.currency as Record<string, unknown>).symbol;
    if (typeof symbol === 'string' && symbol) parts.push(`moneda "${symbol}"`);
  }
  if (typeof settings.displayName === 'string' && settings.displayName) {
    parts.push(`se muestra como "${settings.displayName}"`);
  }
  return parts.length > 0 ? parts.join(', ') : formatControlValue(settings);
}

/** Como `formatControlValue`, pero para el control `column_config`
 * (Personalización → formato numérico/moneda/nombre visible por columna o
 * métrica) — su forma real es un MAPA `{"nombre de columna": {ajustes}}`,
 * no un único `AdhocMetric`/`AdhocColumn`, así que `formatControlValue`
 * solo (que espera UN valor, no un mapa de varios) caía al JSON crudo del
 * mapa entero — mismo problema de legibilidad que ya se había resuelto
 * para métricas/columnas, encontrado en una propuesta real que aplicaba
 * formato a 3 métricas a la vez (2026-09-25). El resto de los controles
 * se resuelve exactamente igual que siempre — esto NO reemplaza a
 * `formatControlValue`, decide primero si hace falta el caso especial. */
export function formatControlDiffValue(control: string, value: unknown): string {
  if (control === 'column_config' && value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      (pair): pair is [string, Record<string, unknown>] => typeof pair[1] === 'object' && pair[1] !== null && !Array.isArray(pair[1]),
    );
    if (entries.length > 0) {
      return entries.map(([label, settings]) => `${label}: ${formatColumnSettings(settings)}`).join('; ');
    }
  }
  return formatControlValue(value);
}

export class ApplyExploreActionError extends Error {}

/** `POST /api/v1/explore/form_data` — devuelve la key nueva. Mismo `omit`
 * de `url_params` que hace Explore antes de persistir
 * (`sanitizeFormData.ts`): no tiene sentido conservarlo en un form_data
 * que no vino de la URL.
 *
 * `tabId`, cuando se pasa, va como QUERY PARAM de la URL
 * (`?tab_id=...`), nunca en el body — bug real encontrado en vivo
 * (2026-09-25, sesión con slice_id 38/459 y otros): mandarlo en el body
 * daba 400 (`Failed to load resource: ... 400`, visible en la consola del
 * navegador) porque `FormDataPostSchema`
 * (`superset/explore/form_data/schemas.py`) NO declara `tab_id` — el
 * endpoint real (`superset/explore/form_data/api.py::post`) lo lee con
 * `request.args.get("tab_id")`, exclusivamente de la query string.
 *
 * Queda SIN mandar por defecto (`undefined`) — el flujo de "Aplicar" de
 * Fase 6 lo hace a propósito así (ver el comentario del módulo): con
 * `tab_id` real, `CreateFormDataCommand` REUSA la key existente de la
 * pestaña en vez de generar una nueva, pisando el estado anterior y
 * dejando sin nada a lo que volver con "Deshacer". El único llamador que
 * SÍ pasa `tabId` es `exploreAdapter.ts::readExploreContext`, al sembrar
 * una key inicial para un gráfico guardado recién abierto que todavía no
 * tiene ninguna en la URL — ahí se busca lo contrario: que la key quede
 * asociada a la pestaña, como si Explore la hubiera generado sola, para
 * no crear una key nueva en cada turno del asistente. */
export async function postAppliedFormData(
  datasourceId: number,
  datasourceType: string,
  formData: Record<string, unknown>,
  chartId?: number,
  tabId?: string,
): Promise<string> {
  const { url_params: _urlParams, ...cleanFormData } = formData;
  const csrf = await authentication.getCSRFToken().catch(() => undefined);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (csrf) headers['X-CSRFToken'] = csrf;
  const url = tabId ? `/api/v1/explore/form_data?tab_id=${encodeURIComponent(tabId)}` : '/api/v1/explore/form_data';
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify({
      datasource_id: datasourceId,
      datasource_type: datasourceType,
      form_data: JSON.stringify(cleanFormData),
      ...(chartId ? { chart_id: chartId } : {}),
    }),
  });
  if (!response.ok) {
    throw new ApplyExploreActionError(`No se pudo aplicar el cambio (el servidor respondió ${response.status}).`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApplyExploreActionError('La respuesta no fue JSON válido.');
  }
  const key = (body as { key?: unknown } | null)?.key;
  if (typeof key !== 'string' || !key) {
    throw new ApplyExploreActionError('La respuesta no incluyó una key nueva.');
  }
  return key;
}

/** URL de recarga tras aplicar — mismo patrón que usa el propio Explore al
 * navegar a un form_data guardado. */
export function buildExploreReloadUrl(formDataKey: string, sliceId: number | null): string {
  const params = new URLSearchParams();
  params.set('form_data_key', formDataKey);
  if (sliceId !== null) params.set('slice_id', String(sliceId));
  return `/explore/?${params.toString()}`;
}
