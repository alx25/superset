import {
  AssistantBackendError,
  LEGACY_SQL_LAB_ASSISTANT_ENDPOINT,
  requestAssistantResponse,
  SQL_LAB_ASSISTANT_ENDPOINT,
} from '../adapters/chatBackendAdapter';
import type { AssistantContext } from '../contracts/assistant';

const context: AssistantContext = {
  contractVersion: 1,
  source: 'superset_sqllab',
  mode: 'create',
  userMessage: 'ventas por mes',
  tab: { id: 't1', title: 'Consulta', databaseId: 3, catalog: null, schema: 'default' },
  editor: { sql: '', selectedSql: '', cursor: { line: 0, column: 0 } },
};

const okBody = { contract_version: 1, message: 'ok', actions: [], diagnostics: [] };

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    body: null,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

let fetchMock: jest.Mock<Promise<Response>, [string, RequestInit]>;

beforeEach(() => {
  fetchMock = jest.fn();
  (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
});

test('usa la REST API de la extensión con token CSRF y cookie de sesión', async () => {
  fetchMock.mockResolvedValue(jsonResponse(200, okBody));
  await requestAssistantResponse(context, 'key-1');

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('/extensions/irex/irex-mcp-tools/assistant/sql-lab');
  expect(url).toBe(SQL_LAB_ASSISTANT_ENDPOINT);
  expect(init.credentials).toBe('same-origin');
  expect(init.headers).toMatchObject({ 'X-CSRFToken': 'csrf-de-prueba', Accept: 'text/event-stream' });
  expect(JSON.parse(String(init.body))).toMatchObject({ conversation_key: 'key-1', user_message: 'ventas por mes' });
});

test('si la ruta nueva no existe (404), reintenta una vez por el proxy viejo', async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse(404, 'Not Found')).mockResolvedValueOnce(jsonResponse(200, okBody));
  const response = await requestAssistantResponse(context, 'key-1');

  expect(response.message).toBe('ok');
  expect(fetchMock.mock.calls.map(call => call[0])).toEqual([SQL_LAB_ASSISTANT_ENDPOINT, LEGACY_SQL_LAB_ASSISTANT_ENDPOINT]);
  // Mismo body en los dos intentos: el backend del chat recibe lo mismo.
  expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
});

test.each([403, 401, 400, 502])('un %i NO reintenta: el pedido pudo haber llegado o es un rechazo real', async status => {
  fetchMock.mockResolvedValue(jsonResponse(status, 'rechazado'));
  await expect(requestAssistantResponse(context, 'key-1')).rejects.toBeInstanceOf(AssistantBackendError);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('un endpoint explícito distinto no activa el fallback', async () => {
  fetchMock.mockResolvedValue(jsonResponse(404, 'Not Found'));
  await expect(requestAssistantResponse(context, 'key-1', '/otro')).rejects.toBeInstanceOf(AssistantBackendError);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
