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
import {
  activateExploreQueryCapture,
  getLatestExecutedQueryContext,
  onExploreQueryCaptured,
} from '../hosts/exploreQueryCapture';

const formData = { slice_id: 7, viz_type: 'table', metrics: ['count'], datasource: '1__table' };
const context = {
  datasource: { id: 1, type: 'table' },
  result_type: 'full',
  result_format: 'json',
  queries: [{ metrics: ['count'] }],
  form_data: { ...formData, force: false, result_format: 'json', result_type: 'full' },
};

function response(status: number): Response {
  return { status } as Response;
}

let originalFetch: typeof fetch;
let fetchMock: jest.Mock<Promise<Response>, [RequestInfo | URL, RequestInit?]>;
let detach: (() => void) | undefined;

beforeEach(() => {
  originalFetch = window.fetch;
  fetchMock = jest.fn().mockResolvedValue(response(200));
  window.fetch = fetchMock;
});

afterEach(() => {
  detach?.();
  detach = undefined;
  window.fetch = originalFetch;
});

test('captura el query_context enviado por Explore para el mismo gráfico', async () => {
  detach = activateExploreQueryCapture();
  const listener = jest.fn();
  const stopListening = onExploreQueryCaptured(listener);
  const body = JSON.stringify(context);

  await window.fetch('/api/v1/chart/data', { method: 'POST', body });
  await Promise.resolve();

  expect(getLatestExecutedQueryContext(7)?.queryContext).toBe(body);
  expect(getLatestExecutedQueryContext(8)).toBeUndefined();
  expect(listener).toHaveBeenCalledTimes(1);
  stopListening();
});

test('ignora respuestas fallidas, otras rutas y solicitudes que no son full', async () => {
  fetchMock.mockResolvedValueOnce(response(400)).mockResolvedValue(response(200));
  detach = activateExploreQueryCapture();
  await window.fetch('/api/v1/chart/data', { method: 'POST', body: JSON.stringify(context) });
  expect(getLatestExecutedQueryContext(7)).toBeUndefined();

  await window.fetch('/api/v1/chart/7', { method: 'POST', body: JSON.stringify(context) });
  expect(getLatestExecutedQueryContext(7)).toBeUndefined();

  await window.fetch('/api/v1/chart/data', {
    method: 'POST',
    body: JSON.stringify({ ...context, result_type: 'query' }),
  });
  expect(getLatestExecutedQueryContext(7)).toBeUndefined();
});

test('la última consulta completa reemplaza el contexto anterior del mismo gráfico', async () => {
  detach = activateExploreQueryCapture();
  const originalBody = JSON.stringify(context);
  await window.fetch('/api/v1/chart/data', { method: 'POST', body: originalBody });
  await window.fetch('/api/v1/chart/data', {
    method: 'POST',
    body: JSON.stringify({ ...context, form_data: { ...context.form_data, metrics: ['sum'] } }),
  });
  expect(getLatestExecutedQueryContext(7)?.queryContext).toBe(JSON.stringify({ ...context, form_data: { ...context.form_data, metrics: ['sum'] } }));
});

test('la limpieza restaura fetch y elimina el contexto capturado', async () => {
  detach = activateExploreQueryCapture();
  await window.fetch('/api/v1/chart/data', { method: 'POST', body: JSON.stringify(context) });
  expect(getLatestExecutedQueryContext(7)).toBeDefined();
  detach();
  detach = undefined;
  expect(window.fetch).toBe(fetchMock);
  expect(getLatestExecutedQueryContext(7)).toBeUndefined();
});
