/**
 * Lectura del estado real de Explore vía REST (criterios de salida 1 y 2 de
 * la Fase 0, `PLAN_COPILOTO_EXPLORE.md`). Sin acceso al árbol de React del
 * host ni a su store de Redux (esta extensión vive en una raíz de React
 * aparte, ver `exploreHost.tsx`), la única fuente pública y estable es la
 * misma API REST que el propio Explore usa para persistir su estado sin
 * guardar (`/api/v1/explore/form_data`) y el gráfico ya guardado
 * (`/api/v1/chart/<id>`).
 *
 * **Criterio de salida 1 — opción (b) del plan.** El asistente lee el
 * último estado persistido por Explore en `form_data_key` y explica que
 * podría no incluir controles editados después. Explore actualiza esa key
 * tras ejecutar, volver a renderizar, cambiar de pestaña o guardar; por
 * eso no se debe llamarla siempre «último estado ejecutado». El estado
 * pendiente solo vive en el store del host, no en la API REST pública.
 *
 * **Criterio de salida 2 — el `query_context` fiel.** Se prefiere el
 * último request completo que Explore ejecutó para el gráfico abierto.
 * Su `query_context` ya fue producido por el buildQuery del plugin. Si
 * todavía no se observó uno, el contexto guardado solo se reutiliza cuando
 * el estado persistido coincide exactamente con chart.params; la diferencia
 * entre ambos no demuestra cambios del usuario.
 */

import { getLatestExecutedQueryContext } from './exploreQueryCapture';

export const UNSAVED_STATE_CONTRACT =
  'Leo el último estado que Explore guardó en la URL. Si cambiaste controles ' +
  'sin actualizar el gráfico, esos cambios pueden no estar ahí todavía.';

/** Margen de seguridad tras un cambio de URL antes de leer `form_data`: la
 * key ya refleja el debounce de 1s de Explore (ver comentario del módulo),
 * este margen solo cubre la carrera entre "la URL cambió" y "el registro ya
 * está confirmado del lado del servidor". */
export const RESOLVE_DEBOUNCE_MS = 400;

export interface ExploreLocation {
  sliceId?: number;
  formDataKey?: string;
}

export function parseExploreLocation(search: string): ExploreLocation {
  const params = new URLSearchParams(search);
  const sliceIdRaw = params.get('slice_id');
  const sliceId = sliceIdRaw && /^[1-9]\d*$/.test(sliceIdRaw) ? Number(sliceIdRaw) : NaN;
  return {
    sliceId: Number.isSafeInteger(sliceId) ? sliceId : undefined,
    formDataKey: params.get('form_data_key') ?? undefined,
  };
}

/** `undefined` en cualquier falla (red, 404, JSON inválido) — el llamador
 * lo trata siempre como "no puedo confiar en esto", nunca como error que
 * haya que propagar: es la postura conservadora que pide el plan. */
async function getJson<T>(url: string): Promise<T | undefined> {
  try {
    const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

interface FormDataGetResponse {
  form_data: string;
}

/** `GET /api/v1/explore/form_data/<key>` — `form_data` viaja como texto
 * JSON (`FormDataPutSchema`/`Get` de Superset), no como objeto. */
export async function fetchFormData(key: string): Promise<Record<string, unknown> | undefined> {
  const body = await getJson<FormDataGetResponse>(`/api/v1/explore/form_data/${encodeURIComponent(key)}`);
  if (!body) return undefined;
  try {
    return JSON.parse(body.form_data) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

interface ChartGetResponse {
  result?: {
    viz_type?: string;
    params?: string;
    query_context?: string | null;
  };
}

export interface SavedChart {
  vizType?: string;
  params?: Record<string, unknown>;
  queryContext?: string;
}

/** `GET /api/v1/chart/<id>` — `params`/`query_context` también viajan como
 * texto JSON en el esquema REST de Superset. */
async function fetchSavedChart(sliceId: number): Promise<SavedChart | undefined> {
  const body = await getJson<ChartGetResponse>(`/api/v1/chart/${sliceId}`);
  if (!body?.result) return undefined;
  let params: Record<string, unknown> | undefined;
  try {
    params = body.result.params ? (JSON.parse(body.result.params) as Record<string, unknown>) : undefined;
  } catch {
    params = undefined;
  }
  return {
    vizType: body.result.viz_type,
    params,
    queryContext: body.result.query_context ?? undefined,
  };
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

/** Solo una igualdad estructural exacta confirma que se puede reutilizar el
 * contexto guardado. La desigualdad no permite inferir cambios del usuario. */
function sameFormData(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean {
  if (!a || !b) return false;
  return JSON.stringify(sortKeysDeep(a)) === JSON.stringify(sortKeysDeep(b));
}

export type QueryFidelity =
  | { status: 'fiel'; queryContext: string; vizType?: string; source?: 'ejecutado' }
  | { status: 'no-disponible'; reason: string; vizType?: string };

/** Implementa la decisión del criterio de salida 2 — ver el comentario del
 * módulo. `search` se pasa explícito (no se lee `window.location.search`
 * adentro) para poder testear sin depender de la navegación real de jsdom. */
export async function resolveQueryFidelity(search: string): Promise<QueryFidelity> {
  const { sliceId, formDataKey } = parseExploreLocation(search);
  const executed = getLatestExecutedQueryContext(sliceId);
  if (executed) {
    return {
      status: 'fiel',
      queryContext: executed.queryContext,
      vizType: typeof executed.formData.viz_type === 'string' ? executed.formData.viz_type : undefined,
      source: 'ejecutado',
    };
  }

  if (sliceId === undefined) {
    return {
      status: 'no-disponible',
      reason: 'El gráfico todavía no se guardó y no se capturó su query_context ejecutado.',
    };
  }

  const saved = await fetchSavedChart(sliceId);
  if (!saved) {
    return { status: 'no-disponible', reason: 'No se pudo leer el gráfico guardado.' };
  }

  if (!formDataKey) {
    if (saved.queryContext) return { status: 'fiel', queryContext: saved.queryContext, vizType: saved.vizType };
    return {
      status: 'no-disponible',
      reason: 'El gráfico guardado todavía no tiene un query_context guardado (ejecutalo y guardalo una vez).',
      vizType: saved.vizType,
    };
  }

  const current = await fetchFormData(formDataKey);
  if (!current) {
    return {
      status: 'no-disponible',
      reason: 'No se pudo leer el estado actual del gráfico (form_data_key inválida o vencida).',
      vizType: saved.vizType,
    };
  }
  if (!saved.queryContext) {
    return {
      status: 'no-disponible',
      reason: 'El gráfico guardado todavía no tiene un query_context guardado (ejecutalo y guardalo una vez).',
      vizType: saved.vizType,
    };
  }

  if (!sameFormData(current, saved.params)) {
    return {
      status: 'no-disponible',
      reason:
        'No se pudo verificar el SQL de este estado. Explore agrega campos al abrir ' +
        'y actualizar el gráfico, así que una diferencia con la versión guardada ' +
        'no demuestra que hayas hecho cambios. Falta obtener el query_context de ' +
        'la ejecución actual.',
      vizType: saved.vizType,
    };
  }

  return { status: 'fiel', queryContext: saved.queryContext, vizType: saved.vizType };
}
