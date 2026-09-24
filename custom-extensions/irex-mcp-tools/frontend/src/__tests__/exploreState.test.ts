import { readExploreContext } from '../adapters/exploreAdapter';
import { parseExploreLocation, resolveQueryFidelity } from '../hosts/exploreState';
import { activateExploreQueryCapture } from '../hosts/exploreQueryCapture';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

let fetchMock: jest.Mock<Promise<Response>, [string, RequestInit]>;

beforeEach(() => {
  fetchMock = jest.fn();
  (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
});

describe('parseExploreLocation', () => {
  test.each([
    ['?slice_id=42&form_data_key=abc-123', { sliceId: 42, formDataKey: 'abc-123' }],
    ['?slice_id=42', { sliceId: 42, formDataKey: undefined }],
    ['', { sliceId: undefined, formDataKey: undefined }],
    ['?slice_id=not-a-number', { sliceId: undefined, formDataKey: undefined }],
    ['?slice_id=12abc', { sliceId: undefined, formDataKey: undefined }],
    ['?slice_id=9007199254740992', { sliceId: undefined, formDataKey: undefined }],
  ] as const)('%s → %j', (search, expected) => {
    expect(parseExploreLocation(search)).toEqual(expected);
  });
});

const SAVED_PARAMS = { viz_type: 'table', metrics: ['count'], groupby: ['col_a'] };
const CURRENT_FORM_DATA_MATCHING = { groupby: ['col_a'], metrics: ['count'], viz_type: 'table' }; // mismo contenido, otro orden de claves
const CURRENT_FORM_DATA_DIVERGENT = { viz_type: 'table', metrics: ['count'], groupby: ['col_a', 'col_b'] };

function mockChart(overrides: { viz_type?: string; params?: unknown; query_context?: string | null } = {}): void {
  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(
      jsonResponse(200, {
        result: {
          viz_type: overrides.viz_type ?? 'table',
          params: JSON.stringify(overrides.params ?? SAVED_PARAMS),
          query_context: 'query_context' in overrides ? overrides.query_context : '{"saved":true}',
        },
      }),
    ),
  );
}

function mockFormData(formData: unknown): void {
  fetchMock.mockImplementationOnce(() => Promise.resolve(jsonResponse(200, { form_data: JSON.stringify(formData) })));
}

describe('resolveQueryFidelity — criterio de salida 2 (query_context fiel)', () => {
  test('sin slice_id (gráfico nuevo, sin guardar): no disponible, sin llamar a la red', async () => {
    const result = await resolveQueryFidelity('');
    expect(result).toEqual({
      status: 'no-disponible',
      reason: 'El gráfico todavía no se guardó y no se capturó su query_context ejecutado.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('slice_id sin form_data_key (gráfico guardado, sin ejecuciones posteriores): usa el query_context guardado', async () => {
    mockChart({ query_context: '{"real":true}', viz_type: 'echarts_timeseries_bar' });

    const result = await resolveQueryFidelity('?slice_id=7');

    expect(result).toEqual({ status: 'fiel', queryContext: '{"real":true}', vizType: 'echarts_timeseries_bar' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/chart/7');
  });

  test('form_data actual idéntico al guardado (aunque con otro orden de claves): fiel', async () => {
    mockChart();
    mockFormData(CURRENT_FORM_DATA_MATCHING);

    const result = await resolveQueryFidelity('?slice_id=7&form_data_key=abc');

    expect(result.status).toBe('fiel');
    if (result.status === 'fiel') expect(result.queryContext).toBe('{"saved":true}');
  });

  test('usa el query_context exacto que Explore ejecutó aunque los params guardados difieran', async () => {
    const current = { ...CURRENT_FORM_DATA_DIVERGENT, slice_id: 7, datasource: '1__table' };
    const context = {
      datasource: { id: 1, type: 'table' },
      result_type: 'full',
      result_format: 'json',
      queries: [{ metrics: ['count'] }],
      form_data: { ...current, force: false, result_format: 'json', result_type: 'full' },
    };
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/v1/chart/data') return Promise.resolve(jsonResponse(200, {}));
      if (url === '/api/v1/chart/7') {
        return Promise.resolve(jsonResponse(200, {
          result: { viz_type: 'table', params: JSON.stringify(SAVED_PARAMS), query_context: '{"saved":true}' },
        }));
      }
      return Promise.resolve(jsonResponse(200, { form_data: JSON.stringify(current) }));
    });
    const detach = activateExploreQueryCapture();
    try {
      await fetch('/api/v1/chart/data', { method: 'POST', body: JSON.stringify(context) });
      const result = await resolveQueryFidelity('?slice_id=7&form_data_key=abc');
      expect(result).toEqual({
        status: 'fiel',
        queryContext: JSON.stringify(context),
        vizType: 'table',
        source: 'ejecutado',
      });
    } finally {
      detach();
    }
  });

  test('form_data distinto del guardado: no se infieren cambios del usuario, sin importar el tipo de gráfico', async () => {
    mockChart({ viz_type: 'irex_pivot_table_rx1' }); // uno de los plugins propios — misma regla, sin excepción
    mockFormData(CURRENT_FORM_DATA_DIVERGENT);

    const result = await resolveQueryFidelity('?slice_id=7&form_data_key=abc');

    expect(result.status).toBe('no-disponible');
    if (result.status === 'no-disponible') {
      expect(result.reason).toContain('no demuestra que hayas hecho cambios');
      expect(result.vizType).toBe('irex_pivot_table_rx1');
    }
  });

  test('el gráfico guardado no existe o no se pudo leer: no disponible', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, {}));

    const result = await resolveQueryFidelity('?slice_id=999');

    expect(result).toEqual({ status: 'no-disponible', reason: 'No se pudo leer el gráfico guardado.' });
  });

  test('el gráfico guardado no tiene query_context propio todavía: no disponible', async () => {
    mockChart({ query_context: null });

    const result = await resolveQueryFidelity('?slice_id=7');

    expect(result.status).toBe('no-disponible');
    if (result.status === 'no-disponible') expect(result.reason).toContain('todavía no tiene un query_context guardado');
  });

  test('form_data_key vencida o inválida (404 en form_data): no disponible', async () => {
    mockChart();
    fetchMock.mockResolvedValueOnce(jsonResponse(404, {}));

    const result = await resolveQueryFidelity('?slice_id=7&form_data_key=vencida');

    expect(result.status).toBe('no-disponible');
    if (result.status === 'no-disponible') expect(result.reason).toContain('form_data_key inválida o vencida');
  });

  test('fetch tirando una excepción de red no propaga: no disponible', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const result = await resolveQueryFidelity('?slice_id=7');

    expect(result).toEqual({ status: 'no-disponible', reason: 'No se pudo leer el gráfico guardado.' });
  });

  test('JSON inválido en query_context/params/form_data no revienta: se trata como ausente', async () => {
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(jsonResponse(200, { result: { viz_type: 'table', params: '{not valid json', query_context: '{"saved":true}' } })),
    );
    mockFormData(CURRENT_FORM_DATA_MATCHING);

    const result = await resolveQueryFidelity('?slice_id=7&form_data_key=abc');

    // params guardado quedó `undefined` (JSON inválido) → sameFormData no puede compararlo → conservador: no-disponible.
    expect(result.status).toBe('no-disponible');
  });
});


describe('readExploreContext — adaptador de Explore', () => {
  test('separa el estado persistido de la consulta ejecutada', async () => {
    const persisted = { viz_type: 'table', slice_id: 7, metrics: ['saved'] };
    const executed = {
      datasource: { id: 1, type: 'table' },
      queries: [{ metrics: ['executed'] }],
      form_data: { viz_type: 'table', slice_id: 7, metrics: ['executed'] },
      result_type: 'full',
      result_format: 'json',
    };
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/v1/chart/data') return Promise.resolve(jsonResponse(200, {}));
      if (url === '/api/v1/explore/form_data/key') {
        return Promise.resolve(jsonResponse(200, { form_data: JSON.stringify(persisted) }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const detach = activateExploreQueryCapture();
    try {
      await fetch('/api/v1/chart/data', { method: 'POST', body: JSON.stringify(executed) });
      const context = await readExploreContext('?slice_id=7&form_data_key=key');
      expect(context.sliceId).toBe(7);
      expect(context.formDataKey).toBe('key');
      expect(context.formData).toEqual(persisted);
      expect(context.queryFidelity).toEqual({
        status: 'fiel', queryContext: JSON.stringify(executed), vizType: 'table', source: 'ejecutado',
      });
    } finally {
      detach();
    }
  });
});
