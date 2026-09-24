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

/** Observa únicamente la petición REST que Explore ya envía al actualizar
 * un gráfico. Conserva el query_context exacto que construyó el plugin del
 * host, sin reimplementar buildQuery ni ejecutar una consulta adicional.
 * El hook vive solo mientras Explore está montado y nunca altera la respuesta.
 * La última respuesta 200 de tipo `full` es el último estado ejecutado,
 * aunque la configuración de la URL use otra representación de controles.
 */
interface CapturedQuery {
  queryContext: string;
  formData: Record<string, unknown>;
  sliceId?: number;
}

let captured: CapturedQuery[] = [];
let stopCapture: (() => void) | undefined;
const listeners = new Set<() => void>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseChartRequest(input: RequestInfo | URL, init?: RequestInit): CapturedQuery | undefined {
  if (typeof input !== 'string' && !(input instanceof URL)) return undefined;
  if (init?.method?.toUpperCase() !== 'POST' || typeof init.body !== 'string') return undefined;
  let url: URL;
  try {
    url = new URL(String(input), window.location.href);
  } catch {
    return undefined;
  }
  if (url.origin !== window.location.origin || !url.pathname.endsWith('/api/v1/chart/data')) return undefined;
  try {
    const context: unknown = JSON.parse(init.body);
    if (!isRecord(context) || !isRecord(context.form_data) || !Array.isArray(context.queries)) return undefined;
    if (context.queries.length === 0 || !isRecord(context.datasource)) return undefined;
    if (context.result_type !== 'full' || context.result_format !== 'json') return undefined;
    const sliceId = context.form_data.slice_id;
    return {
      queryContext: init.body,
      formData: context.form_data,
      sliceId: typeof sliceId === 'number' && Number.isSafeInteger(sliceId) ? sliceId : undefined,
    };
  } catch {
    return undefined;
  }
}

/** Instalar antes de que Explore monte el gráfico (ExtensionsStartup espera
 * a que carguen las extensiones). Devuelve limpieza idempotente. */
export function activateExploreQueryCapture(): () => void {
  if (stopCapture) return stopCapture;
  const originalFetch = window.fetch;
  let active = true;
  const wrappedFetch: typeof fetch = (input, init) => {
    const candidate = parseChartRequest(input, init);
    const response = originalFetch.call(window, input, init);
    if (candidate) {
      void response.then(
        result => {
          if (active && result.status === 200 && !init?.signal?.aborted) {
            captured = [...captured.slice(-7), candidate];
            listeners.forEach(listener => listener());
          }
        },
        () => {},
      );
    }
    return response;
  };
  window.fetch = wrappedFetch;
  stopCapture = () => {
    active = false;
    if (window.fetch === wrappedFetch) window.fetch = originalFetch;
    captured = [];
    stopCapture = undefined;
  };
  return stopCapture;
}

export function onExploreQueryCaptured(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Devuelve la última consulta completa observada para el gráfico abierto.
 * Explore genera el request desde controles normalizados, mientras la URL
 * persiste el estado crudo del editor; no se comparan esas dos formas. */
export function getLatestExecutedQueryContext(sliceId?: number): CapturedQuery | undefined {
  for (let i = captured.length - 1; i >= 0; i -= 1) {
    const item = captured[i];
    if (sliceId === undefined ? item.sliceId === undefined || item.sliceId === 0 : item.sliceId === sliceId) return item;
  }
  return undefined;
}
