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
import { fetchFormData, parseExploreLocation, resolveQueryFidelity, type QueryFidelity } from '../hosts/exploreState';
import { onDidChangeLocation } from '../hosts/routeObserver';
import { onExploreQueryCaptured } from '../hosts/exploreQueryCapture';
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

/** Lee una instantánea del gráfico sin atribuir ediciones al usuario. La
 * ausencia del estado persistido se representa como undefined, no como un
 * form_data vacío que podría confundirse con un gráfico nuevo. */
export async function readExploreContext(search: string): Promise<ExploreContext> {
  const location = parseExploreLocation(search);
  const [formData, queryFidelity] = await Promise.all([
    location.formDataKey ? fetchFormData(location.formDataKey) : Promise.resolve(undefined),
    resolveQueryFidelity(search),
  ]);
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


/**
 * `chart.query_context` (entrada 72) rompió "Explicar" en la app real
 * apenas se probó (entrada 73, 2026-09-24): el backend del chat validaba el
 * body con un modelo Pydantic `extra="forbid"` sobre `chart`, así que un
 * campo nuevo que ese modelo no conoce todavía tumba la solicitud ENTERA
 * con 422 antes de llegar al modelo — no la ignora. Interruptor apagado
 * por default: la capacidad (tools `irex.explain_chart`/`preview_chart`,
 * ver entrada 72) queda construida y lista, pero el campo no se manda
 * hasta que el agente del backend del chat confirme que agregó
 * `query_context: str | None = None` a ese modelo (o el equivalente que
 * use). Prender: `SEND_QUERY_CONTEXT_IN_REQUEST = true`.
 */
const SEND_QUERY_CONTEXT_IN_REQUEST = false;

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
  const match = /^([1-9]\d*)__([a-z][a-z0-9_]*)$/.exec(datasource);
  const datasourceId = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(datasourceId) || !match || match[2] !== 'table') {
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
      datasource: { id: datasourceId, type: match[2] },
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
