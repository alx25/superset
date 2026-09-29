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

/** Adaptador de lectura de Explore. La URL da el estado persistido; la
 * petición ejecutada da el query_context. Son fuentes distintas y nunca se
 * comparan como si sus form_data tuvieran la misma representación. */
import { fetchFormData, fetchSavedChart, parseExploreLocation, resolveQueryFidelity, type QueryFidelity } from '../hosts/exploreState';
import { onDidChangeLocation } from '../hosts/routeObserver';
import { onExploreQueryCaptured } from '../hosts/exploreQueryCapture';
import { postAppliedFormData } from './exploreApplyAdapter';
import type { ExploreAssistantRequest, ExploreMode } from '../contracts/exploreAssistant';

export interface ExploreContext {
  sliceId?: number;
  formDataKey?: string;
  formData?: Record<string, unknown>;
  queryFidelity: QueryFidelity;
}

/** Lectura ligera para el indicador del dock. Evita pedir form_data una
 * segunda vez cada vez que llega una respuesta del gráfico. */
export function readExploreFidelity(search: string): Promise<QueryFidelity> {
  return resolveQueryFidelity(search);
}

/** `sessionStorage['tab_id']` — el mismo id que usa el propio Explore
 * (`useTabId()`) para asociar una key de form_data a la pestaña actual.
 * Solo se usa al SEMBRAR una key inicial (`seedFormDataKeyForSavedChart`
 * acá abajo); el flujo de "Aplicar" (Fase 6, `exploreApplyAdapter.ts`)
 * deliberadamente NO lo manda, por una razón opuesta y ya documentada
 * ahí. */
function readTabId(): string | undefined {
  try {
    return window.sessionStorage.getItem('tab_id') ?? undefined;
  } catch {
    return undefined;
  }
}

/** Un gráfico GUARDADO recién abierto, sin ningún control tocado
 * todavía, no tiene `form_data_key` en la URL — Explore solo la genera
 * al primer cambio. Sin una key, ninguna tool del MCP tiene nada que
 * verificar (`get_explore_state` y el resto del contrato solo aceptan
 * `form_data_key`, nunca un `dataset_id`/`slice_id` sueltos). Se persiste
 * la configuración YA GUARDADA del gráfico bajo una key nueva — la MISMA
 * operación que hace Explore con solo tocar un control — para tener algo
 * real que ofrecerle al asistente.
 *
 * Encontrado en vivo (2026-09-25, slice_id 157): "Explicar"/"Mejorar
 * gráfico" fallaban con "No se pudo leer el estado persistido de
 * Explore" SIN generar ningún log del backend del chat — el pedido nunca
 * llegaba a mandarse, porque `context.formDataKey` era `undefined` desde
 * el arranque (`buildExploreAssistantRequest` corta antes de la red). El
 * indicador de fidelidad podía igual decir "disponible" porque
 * `resolveQueryFidelity` SÍ tiene su propio respaldo para este caso
 * (`exploreState.ts`, lee el gráfico guardado directamente) — son
 * caminos independientes, uno no implica el otro. */
async function seedFormDataKeyForSavedChart(sliceId: number): Promise<{ formDataKey: string; formData: Record<string, unknown> } | undefined> {
  const saved = await fetchSavedChart(sliceId);
  if (!saved?.params) return undefined;
  const datasourceRaw = saved.params.datasource;
  const ref = typeof datasourceRaw === 'string' ? parseDatasourceRef(datasourceRaw) : undefined;
  if (!ref) return undefined;
  try {
    const formDataKey = await postAppliedFormData(ref.id, ref.type, saved.params, sliceId, readTabId());
    return { formDataKey, formData: saved.params };
  } catch {
    return undefined;
  }
}

/** Deja la key recién sembrada en la URL (mismo patrón que usa el propio
 * Explore: query param, sin recargar) para que el PRÓXIMO turno la
 * reutilice en vez de sembrar una nueva cada vez. Best-effort: si falla,
 * el turno actual ya tiene lo que necesita (la key viaja en el
 * `ExploreContext` devuelto) — solo se pierde la reutilización futura. */
function rememberSeededFormDataKeyInUrl(formDataKey: string): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('form_data_key', formDataKey);
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    // no-op — best-effort, ver el comentario de arriba.
  }
}

/** Lee una instantánea del gráfico sin atribuir ediciones al usuario. La
 * ausencia del estado persistido se representa como undefined, no como un
 * form_data vacío que podría confundirse con un gráfico nuevo. */
export async function readExploreContext(search: string): Promise<ExploreContext> {
  const location = parseExploreLocation(search);
  const [formData, queryFidelity] = await Promise.all([
    location.formDataKey ? fetchFormData(location.formDataKey) : Promise.resolve(undefined),
    resolveQueryFidelity(search),
  ]);
  if (formData) return { ...location, formData, queryFidelity };

  // Sin form_data ahí: si es un gráfico guardado sin key todavía, se
  // siembra una — ver `seedFormDataKeyForSavedChart`. Un gráfico SIN
  // guardar (sliceId undefined) no tiene de dónde sembrar nada; queda
  // igual que antes (formData undefined, "no se pudo leer").
  if (location.sliceId !== undefined && !location.formDataKey) {
    const seeded = await seedFormDataKeyForSavedChart(location.sliceId);
    if (seeded) {
      rememberSeededFormDataKeyInUrl(seeded.formDataKey);
      return { sliceId: location.sliceId, formDataKey: seeded.formDataKey, formData: seeded.formData, queryFidelity };
    }
  }

  return { ...location, formData, queryFidelity };
}

/** Notifica cambios de URL o de la ejecución del gráfico. El consumidor
 * debe volver a leer y descartar resultados de lecturas anteriores. */
export function onExploreContextChanged(listener: (kind: 'location' | 'capture') => void): { dispose: () => void } {
  const location = onDidChangeLocation(() => listener('location'));
  const detachCapture = onExploreQueryCaptured(() => listener('capture'));
  return {
    dispose: () => {
      location.dispose();
      detachCapture();
    },
  };
}

/** Pista de rol Admin para `user.is_admin` del body — NUNCA autoritativa
 * (el contrato la trata como pista del navegador: el backend re-verifica
 * el rol real vía `irex.get_explore_state`, con la identidad MCP del
 * usuario, antes de habilitar cualquier acción sobre el dataset). Se lee
 * del mismo `data-bootstrap` de `#app` que ya usa `themeBridge.ts` —
 * `bootstrap.user.roles` es un mapa `{nombreDeRol: permisos[]}` cuando el
 * bootstrap se pidió con `include_perms=True` (`bootstrap_user_data`,
 * `superset/views/utils.py`). Sin ese campo (usuario anónimo, bootstrap
 * roto) el hint cae a `false` — más conservador que asumir Admin. */
export function readIsAdminHint(doc: Document = document): boolean {
  try {
    const raw = doc.getElementById('app')?.getAttribute('data-bootstrap');
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { user?: { roles?: Record<string, unknown> } };
    const roles = parsed.user?.roles;
    return !!roles && typeof roles === 'object' && Object.prototype.hasOwnProperty.call(roles, 'Admin');
  } catch {
    return false;
  }
}


/** `"11__table"` → `{id: 11, type: "table"}` — la forma de `form_data.datasource`.
 * Un solo lugar para este regex (lo usan `buildExploreAssistantRequest` acá
 * abajo y `ExploreActionCard` al preparar un "Aplicar", Fase 6): evita que
 * dos copias del mismo patrón diverjan con el tiempo. Solo acepta
 * datasources de tipo `table` (con `id` positivo) — lo único que maneja
 * hoy el resto del contrato. */
export function parseDatasourceRef(datasource: string): { id: number; type: 'table' } | undefined {
  const match = /^([1-9]\d*)__([a-z][a-z0-9_]*)$/.exec(datasource);
  if (!match || match[2] !== 'table') return undefined;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? { id, type: 'table' } : undefined;
}

/**
 * `chart.query_context` (entrada 72) rompió "Explicar" en la app real
 * apenas se probó (entrada 73, 2026-09-24): el backend del chat validaba el
 * body con un modelo Pydantic `extra="forbid"` sobre `chart`, así que un
 * campo nuevo que ese modelo no conoce todavía tumba la solicitud ENTERA
 * con 422 antes de llegar al modelo — no la ignora. Reactivado (entrada
 * 79, 2026-09-25): el agente del backend del chat confirmó que agregó
 * `query_context` como string opcional a ese modelo (ya no da 422). El
 * backend TODAVÍA no pasa el valor al modelo ni lo usa para llamar a
 * `irex.explain_chart`/`irex.preview_chart` — decisión suya, quiere
 * verificar primero que la captura corresponde al usuario y al estado
 * actual antes de confiar en ella — así que mandar el campo hoy no
 * habilita SQL/resultados todavía, pero tampoco rompe nada: el backend ya
 * lo acepta sin error.
 */
const SEND_QUERY_CONTEXT_IN_REQUEST = true;

/** Arma el body v1 del último estado persistido. La identidad del dataset
 * sale de form_data; el MCP comprueba de nuevo key, chart y datasource.
 * La disponibilidad de SQL ejecutado es independiente de esta solicitud. */
export function buildExploreAssistantRequest(
  context: ExploreContext,
  mode: ExploreMode,
  userMessage: string,
  conversationKey: string,
  isAdmin: boolean,
): ExploreAssistantRequest {
  if (!context.formDataKey || !context.formData) {
    throw new Error('No se pudo leer el estado persistido de Explore.');
  }
  const { datasource, viz_type: vizType } = context.formData;
  if (typeof datasource !== 'string' || typeof vizType !== 'string' || !vizType.trim()) {
    throw new Error('El estado persistido no identifica el dataset o tipo de gráfico.');
  }
  const ref = parseDatasourceRef(datasource);
  if (!ref) {
    throw new Error('El estado persistido no identifica un dataset válido.');
  }
  return {
    contract_version: 1,
    source: 'superset_explore',
    mode,
    user_message: userMessage,
    conversation_key: conversationKey,
    user: { is_admin: isAdmin },
    chart: {
      slice_id: context.sliceId ?? null,
      form_data_key: context.formDataKey,
      viz_type: vizType,
      datasource: ref,
      // Mismo criterio que el indicador del dock (`resolveQueryFidelity`):
      // solo iría un query_context cuando la fidelidad ya resolvió a 'fiel'
      // (capturado en vivo, o el guardado del gráfico si no hubo
      // ejecuciones posteriores) — nunca uno "no disponible" o a medio
      // resolver. Apagado por ahora (ver SEND_QUERY_CONTEXT_IN_REQUEST).
      ...(SEND_QUERY_CONTEXT_IN_REQUEST && context.queryFidelity.status === 'fiel'
        ? { query_context: context.queryFidelity.queryContext }
        : {}),
    },
    form_data: context.formData,
    dataset: {},
  };
}
