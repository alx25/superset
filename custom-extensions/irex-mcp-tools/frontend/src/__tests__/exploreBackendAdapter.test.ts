import { EXPLORE_ASSISTANT_ENDPOINT, ExploreBackendError, requestExploreAssistant } from '../adapters/exploreBackendAdapter';
import type { ExploreAssistantRequest } from '../contracts/exploreAssistant';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';

const request: ExploreAssistantRequest = {
  contract_version: 1,
  source: 'superset_explore',
  mode: 'explain',
  user_message: 'Explica el gráfico',
  conversation_key: 'f82d64be-0e0e-4bb6-bcf9-4a99d4917e19',
  user: { is_admin: false },
  chart: { slice_id: 7, form_data_key: 'key', viz_type: 'table', datasource: { id: 11, type: 'table' } },
  form_data: { viz_type: 'table' },
  dataset: {},
};
const result = { contract_version: 1, source: 'superset_explore', message: 'Es una tabla', actions: [], diagnostics: [] };

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    body: null,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

let fetchMock: jest.Mock<Promise<Response>, [string, RequestInit]>;
beforeEach(() => {
  (globalThis as unknown as { TextDecoder: typeof TextDecoder }).TextDecoder = NodeTextDecoder as unknown as typeof TextDecoder;
  (globalThis as unknown as { TextEncoder: typeof TextEncoder }).TextEncoder = NodeTextEncoder as unknown as typeof TextEncoder;
  fetchMock = jest.fn();
  (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
});

test('envía el contrato a la REST propia con sesión y CSRF', async () => {
  fetchMock.mockResolvedValue(response(200, result));
  expect((await requestExploreAssistant(request)).message).toBe('Es una tabla');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(EXPLORE_ASSISTANT_ENDPOINT);
  expect(init.credentials).toBe('same-origin');
  expect(init.headers).toMatchObject({ 'X-CSRFToken': 'csrf-de-prueba', Accept: 'text/event-stream' });
  expect(JSON.parse(String(init.body))).toEqual(request);
});

test.each([403, 404, 503])('no reintenta un HTTP %i por el proxy legacy', async status => {
  fetchMock.mockResolvedValue(response(status, 'rechazado'));
  await expect(requestExploreAssistant(request)).rejects.toMatchObject({ httpStatus: status });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('procesa progreso y done.explore_response de SSE', async () => {
  const chunks = [
    'event: session\ndata: {"session_id":"explore-1"}\n\n',
    'event: status\ndata: {"state":"thinking"}\n\n',
    `event: done\ndata: ${JSON.stringify({ explore_response: result })}\n\n`,
  ];
  let index = 0;
  const stream = {
    getReader: () => ({
      read: () => Promise.resolve(index < chunks.length
        ? { done: false, value: new TextEncoder().encode(chunks[index++]) }
        : { done: true, value: undefined }),
      cancel: () => Promise.resolve(),
    }),
  } as unknown as ReadableStream<Uint8Array>;
  fetchMock.mockResolvedValue({
    ...response(200, ''),
    headers: { get: () => 'text/event-stream' },
    body: stream,
  } as unknown as Response);
  const events: string[] = [];
  const parsed = await requestExploreAssistant(request, undefined, event => events.push(event.type));
  expect(parsed.message).toBe('Es una tabla');
  expect(events).toEqual(['session', 'status']);
});

test('rechaza una respuesta que intenta usar el contrato SQL Lab', async () => {
  fetchMock.mockResolvedValue(response(200, { ...result, source: 'superset_sqllab' }));
  await expect(requestExploreAssistant(request)).rejects.toThrow(ExploreBackendError);
});
