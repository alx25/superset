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
 * Captura y sube una imagen del gráfico YA RENDERIZADO -- "ojos" para el
 * LLM, a pedido del usuario 2026-09-29, coordinado con el backend del
 * chat: la captura se sube y se confirma ANTES de mandar el mensaje del
 * usuario a Explore (el MCP no puede pedirle al navegador que capture en
 * el momento en que el modelo llama a la tool).
 *
 * Captura con `dom-to-image-more` sobre `.panel-body .chart-container` --
 * el MISMO selector que usa "Exportar a imagen" de Explore
 * (`useExploreAdditionalActionsMenu/index.tsx`), ya probado: captura
 * exactamente lo que el usuario está viendo en pantalla en ese momento
 * (no dispara una consulta nueva, a diferencia de un screenshot server-side
 * -- evita el mismo riesgo de no-determinismo de orden de filas que ya
 * encontramos en un caso real).
 */
import domToImage from 'dom-to-image-more';
import { authentication } from '@apache-superset/core';

const CHART_CONTAINER_SELECTOR = '.panel-body .chart-container';
const UPLOAD_ENDPOINT = '/extensions/irex/irex-mcp-tools/chart-screenshots/upload';
const JPEG_QUALITY = 0.85;
// Limita ancho/costo de la captura (el backend del chat pidió "límite de
// tamaño y dimensiones" -- guardar en tokens de visión, no solo bytes).
const MAX_CAPTURE_WIDTH = 1600;
// `Loading` (@superset-ui/core/components) es el MISMO componente que
// Chart.tsx usa tanto para "esperando la consulta" (chartStatus==='loading')
// como para el loading interno de renderChartContainer() cuando
// shouldRenderChart() todavía es false -- en los dos casos deja
// data-test="loading-indicator" en el DOM. Esperar a que desaparezca de
// dentro del contenedor es la única señal confiable de "ya terminó de
// renderizar" (hallazgo real, 2026-09-30: sin esto, la captura salía con
// el spinner y el texto "Esperando por Postgresql..." en vez del gráfico).
const LOADING_INDICATOR_SELECTOR = '[data-test="loading-indicator"]';
const RENDER_WAIT_TIMEOUT_MS = 30000;
const RENDER_POLL_INTERVAL_MS = 300;

export class ChartScreenshotError extends Error {}

/** Espera a que el contenedor del gráfico ya NO tenga ningún spinner de
 * carga adentro -- ver `LOADING_INDICATOR_SELECTOR`. Tira
 * `ChartScreenshotError` si se agota el tiempo (nunca captura el spinner
 * en silencio). */
async function waitForChartRendered(container: HTMLElement): Promise<void> {
  const deadline = Date.now() + RENDER_WAIT_TIMEOUT_MS;
  while (container.querySelector(LOADING_INDICATOR_SELECTOR)) {
    if (Date.now() >= deadline) {
      throw new ChartScreenshotError('El gráfico todavía está cargando -- esperá a que termine y volvé a intentar.');
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, RENDER_POLL_INTERVAL_MS));
  }
}

/** `data:image/jpeg;base64,...` → `Blob` sin pasar por `fetch()` (más
 * simple de probar, y no depende de que el navegador soporte fetch sobre
 * `data:` URLs -- lo soporta, pero no hace falta asumirlo). */
function dataUrlToBlob(dataUrl: string): Blob {
  const commaIndex = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, commaIndex);
  const base64 = dataUrl.slice(commaIndex + 1);
  const mimeMatch = /data:(.*?);base64/.exec(header);
  const mime = mimeMatch?.[1] ?? 'image/jpeg';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

/** Captura el gráfico visible ahora mismo como JPEG. Nunca dispara una
 * consulta nueva -- toma lo que ya está en pantalla, pero SÍ espera a que
 * la consulta EN CURSO termine (ver `waitForChartRendered`) para no
 * capturar el spinner de carga en vez del gráfico. */
export async function captureChartScreenshot(): Promise<Blob> {
  const node = document.querySelector<HTMLElement>(CHART_CONTAINER_SELECTOR);
  if (!node) {
    throw new ChartScreenshotError('No se encontró el gráfico renderizado en la página.');
  }
  await waitForChartRendered(node);
  await document.fonts?.ready?.catch(() => undefined);
  const naturalWidth = node.offsetWidth || MAX_CAPTURE_WIDTH;
  const scale = naturalWidth > MAX_CAPTURE_WIDTH ? MAX_CAPTURE_WIDTH / naturalWidth : 1;
  const dataUrl = await domToImage.toJpeg(node, {
    quality: JPEG_QUALITY,
    bgcolor: '#ffffff',
    scale,
  });
  return dataUrlToBlob(dataUrl);
}

/** Convierte cualquier imagen (PNG, WEBP, JPEG, lo que el usuario adjunte
 * o pegue del portapapeles con Ctrl+V) a JPEG, reescalando si excede
 * `maxWidth` -- mismo límite que `MAX_CAPTURE_WIDTH` usa para la captura
 * del propio gráfico, y mismo content-type que ya acepta
 * `chart_screenshot_api.py` (`_ALLOWED_CONTENT_TYPES = {"image/jpeg",
 * "image/jpg"}`) -- así una imagen de REFERENCIA subida por el usuario
 * (pedido 2026-10-05, "adjuntar una imagen... para que el LLM revise y
 * aplique") reusa el mismo endpoint de subida sin tocar el backend. */
export async function convertImageToJpeg(
  blob: Blob,
  maxWidth: number = MAX_CAPTURE_WIDTH,
): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new ChartScreenshotError('El archivo no es una imagen válida.');
  }
  try {
    const scale = bitmap.width > maxWidth ? maxWidth / bitmap.width : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new ChartScreenshotError('No se pudo procesar la imagen en este navegador.');
    }
    // Fondo blanco -- igual que `captureChartScreenshot` (`bgcolor:
    // '#ffffff'`) -- para que un PNG con transparencia no termine con
    // fondo negro al pasar a JPEG (JPEG no soporta canal alfa).
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        result => {
          if (result) resolve(result);
          else reject(new ChartScreenshotError('No se pudo convertir la imagen a JPEG.'));
        },
        'image/jpeg',
        JPEG_QUALITY,
      );
    });
  } finally {
    bitmap.close();
  }
}

export interface UploadChartScreenshotParams {
  sliceId: number | null;
  formDataKey: string;
  datasourceId: number;
  detail: string;
}

/** Sube la captura ya tomada -- devuelve el `capture_id` opaco (vence a
 * los 10 minutos) que el usuario pasa en su mensaje para que el modelo
 * sepa qué pedirle a `irex.get_chart_screenshot`. */
export async function uploadChartScreenshot(
  blob: Blob,
  params: UploadChartScreenshotParams,
): Promise<string> {
  const csrf = await authentication.getCSRFToken().catch(() => undefined);
  const headers: Record<string, string> = {};
  if (csrf) headers['X-CSRFToken'] = csrf;

  const body = new FormData();
  body.append('image', blob, 'chart.jpg');
  body.append('dataset_id', String(params.datasourceId));
  body.append('form_data_key', params.formDataKey);
  if (params.sliceId !== null) body.append('slice_id', String(params.sliceId));
  body.append('detail', params.detail);

  const response = await fetch(UPLOAD_ENDPOINT, {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body,
  });
  if (!response.ok) {
    let message = `No se pudo subir la captura (HTTP ${response.status}).`;
    try {
      const payload = await response.json();
      if (typeof payload?.message === 'string') message = payload.message;
    } catch {
      // sin cuerpo JSON -- se queda con el mensaje genérico
    }
    throw new ChartScreenshotError(message);
  }
  const payload = await response.json();
  if (typeof payload?.capture_id !== 'string' || !payload.capture_id) {
    throw new ChartScreenshotError('Respuesta de subida inválida.');
  }
  return payload.capture_id as string;
}
