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

/** Transporte Explore v1. Solo habla con la REST propia de la extensión:
 * un 404 no activa el proxy legacy, que no comparte el gate de esta ruta. */
import { authentication } from '@apache-superset/core';
import { parseExploreAssistantResponse, type ExploreAssistantRequest, type ExploreAssistantResponse } from '../contracts/exploreAssistant';
import type { AssistantProgressListener } from './chatBackendAdapter';

export const EXPLORE_ASSISTANT_ENDPOINT = '/extensions/irex/irex-mcp-tools/assistant/explore';

export class ExploreBackendError extends Error {
  constructor(message: string, readonly httpStatus?: number) {
    super(message);
    this.name = 'ExploreBackendError';
  }
}

function parseResponse(raw: unknown): ExploreAssistantResponse {
  try {
    return parseExploreAssistantResponse(raw);
  } catch (error) {
    throw new ExploreBackendError(error instanceof Error ? error.message : 'Respuesta Explore inválida.');
  }
}

function parseFrame(frame: string): { event?: string; data?: string } {
  const data: string[] = [];
  let event: string | undefined;
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  return { event, data: data.length ? data.join('\n') : undefined };
}

async function consumeExploreStream(
  stream: ReadableStream<Uint8Array>,
  onProgress?: AssistantProgressListener,
): Promise<ExploreAssistantResponse> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const processFrame = (raw: string): ExploreAssistantResponse | undefined => {
    const frame = parseFrame(raw);
    if (!frame.data) return undefined;
    let payload: unknown;
    try {
      payload = JSON.parse(frame.data);
    } catch {
      return undefined;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
    const event = payload as Record<string, unknown>;
    const kind = frame.event ?? (typeof event.type === 'string' ? event.type : undefined);
    if (kind === 'session' && typeof event.session_id === 'string') {
      onProgress?.({ type: 'session', sessionId: event.session_id });
    } else if (kind === 'status' &&
      (event.state === 'thinking' || event.state === 'calling_tool' || event.state === 'responding')) {
      onProgress?.({ type: 'status', state: event.state });
    } else if (kind === 'activity' && typeof event.message === 'string') {
      onProgress?.({ type: 'activity', message: event.message });
    } else if (kind === 'error') {
      throw new ExploreBackendError(typeof event.message === 'string' ? event.message : 'Error del backend Explore.');
    } else if (kind === 'done') {
      const response = parseResponse(event.explore_response);
      return !response.session_id && typeof event.session_id === 'string'
        ? { ...response, session_id: event.session_id } : response;
    }
    return undefined;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let separator = buffer.indexOf('\n\n');
      while (separator !== -1) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const response = processFrame(frame);
        if (response) return response;
        separator = buffer.indexOf('\n\n');
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  throw new ExploreBackendError('El backend Explore cerró la conexión sin evento done.');
}

/** Envía un pedido ya construido por `buildExploreAssistantRequest`. El
 * servidor vuelve a fijar identidad, rol Admin y MCP antes de reenviarlo. */
export async function requestExploreAssistant(
  request: ExploreAssistantRequest,
  signal?: AbortSignal,
  onProgress?: AssistantProgressListener,
): Promise<ExploreAssistantResponse> {
  const csrf = await authentication.getCSRFToken().catch(() => undefined);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (csrf) headers['X-CSRFToken'] = csrf;
  const response = await fetch(EXPLORE_ASSISTANT_ENDPOINT, {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) {
    throw new ExploreBackendError(await response.text() || `El backend Explore respondió ${response.status}.`, response.status);
  }
  if ((response.headers.get('Content-Type') ?? '').includes('text/event-stream') && response.body) {
    return consumeExploreStream(response.body, onProgress);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    throw new ExploreBackendError('La respuesta Explore no es JSON válido.');
  }
  return parseResponse(payload);
}
