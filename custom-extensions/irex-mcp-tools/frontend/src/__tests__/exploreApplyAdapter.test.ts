import {
  ApplyExploreActionError,
  applyExploreAction,
  applyExploreActions,
  buildExploreReloadUrl,
  diffFormData,
  formatControlDiffValue,
  formatControlValue,
  isApplicableExploreAction,
  postAppliedFormData,
  type ApplicableExploreAction,
} from '../adapters/exploreApplyAdapter';
import type { ExploreAction } from '../contracts/exploreAssistant';

describe('isApplicableExploreAction', () => {
  test.each<[ExploreAction['type'], boolean]>([
    ['patch_form_data', true],
    ['add_adhoc_metric', true],
    ['add_adhoc_column', true],
    ['change_viz_type', true],
    ['add_dataset_metric', false],
    ['add_calculated_column', false],
    ['preview', false],
  ])('%s → %s', (type, expected) => {
    const action = { type } as unknown as ExploreAction;
    expect(isApplicableExploreAction(action)).toBe(expected);
  });
});

describe('applyExploreAction — patch_form_data', () => {
  const base = { viz_type: 'table', row_limit: 100, groupby: ['col_a'] };

  test('op:set reemplaza el valor entero del control', () => {
    const action: ApplicableExploreAction = {
      type: 'patch_form_data',
      base_form_data_key: 'k',
      operations: [{ op: 'set', control: 'row_limit', value: 500 }],
    };
    expect(applyExploreAction(base, action)).toEqual({ ...base, row_limit: 500 });
  });

  test('op:add sobre un array existente agrega al final, sin mutar el original', () => {
    const action: ApplicableExploreAction = {
      type: 'patch_form_data',
      base_form_data_key: 'k',
      operations: [{ op: 'add', control: 'groupby', value: 'col_b' }],
    };
    const result = applyExploreAction(base, action);
    expect(result.groupby).toEqual(['col_a', 'col_b']);
    expect(base.groupby).toEqual(['col_a']); // no se mutó
  });

  test('op:add sobre un control ausente arranca un array', () => {
    const action: ApplicableExploreAction = {
      type: 'patch_form_data',
      base_form_data_key: 'k',
      operations: [{ op: 'add', control: 'adhoc_filters', value: { clause: 'WHERE' } }],
    };
    expect(applyExploreAction(base, action).adhoc_filters).toEqual([{ clause: 'WHERE' }]);
  });

  test('op:remove borra el control', () => {
    const action: ApplicableExploreAction = {
      type: 'patch_form_data',
      base_form_data_key: 'k',
      operations: [{ op: 'remove', control: 'row_limit' }],
    };
    const result = applyExploreAction(base, action);
    expect('row_limit' in result).toBe(false);
  });

  test('varias operations se aplican en orden', () => {
    const action: ApplicableExploreAction = {
      type: 'patch_form_data',
      base_form_data_key: 'k',
      operations: [
        { op: 'set', control: 'row_limit', value: 10 },
        { op: 'add', control: 'groupby', value: 'col_c' },
        { op: 'remove', control: 'viz_type' },
      ],
    };
    const result = applyExploreAction(base, action);
    expect(result).toEqual({ row_limit: 10, groupby: ['col_a', 'col_c'] });
  });

  test('no muta el form_data original', () => {
    const original = { ...base };
    applyExploreAction(base, { type: 'patch_form_data', base_form_data_key: 'k', operations: [{ op: 'set', control: 'row_limit', value: 1 }] });
    expect(base).toEqual(original);
  });
});

describe('applyExploreAction — add_adhoc_metric / add_adhoc_column', () => {
  test('agrega una métrica SQL al control indicado', () => {
    const action: ApplicableExploreAction = {
      type: 'add_adhoc_metric',
      base_form_data_key: 'k',
      control: 'metrics',
      label: 'Cuota',
      expression: 'SUM(cuota)',
    };
    const result = applyExploreAction({ metrics: ['count'] }, action);
    expect(result.metrics).toEqual(['count', { expressionType: 'SQL', sqlExpression: 'SUM(cuota)', label: 'Cuota', hasCustomLabel: true }]);
  });

  test('con el control vacío, arranca la lista', () => {
    const action: ApplicableExploreAction = {
      type: 'add_adhoc_metric',
      base_form_data_key: 'k',
      control: 'metric',
      label: 'Cuota',
      expression: 'SUM(cuota)',
    };
    const result = applyExploreAction({}, action);
    expect(result.metric).toEqual([{ expressionType: 'SQL', sqlExpression: 'SUM(cuota)', label: 'Cuota', hasCustomLabel: true }]);
  });

  test('add_adhoc_column usa la misma forma que add_adhoc_metric (AdhocColumn SQL)', () => {
    const action: ApplicableExploreAction = {
      type: 'add_adhoc_column',
      base_form_data_key: 'k',
      control: 'groupby',
      label: 'Mes',
      expression: "DATE_TRUNC('month', fecha)",
    };
    const result = applyExploreAction({}, action);
    expect(result.groupby).toEqual([{ expressionType: 'SQL', sqlExpression: "DATE_TRUNC('month', fecha)", label: 'Mes', hasCustomLabel: true }]);
  });
});

describe('applyExploreAction — change_viz_type', () => {
  test('reemplaza viz_type y conserva el resto', () => {
    const result = applyExploreAction({ viz_type: 'table', row_limit: 100 }, { type: 'change_viz_type', base_form_data_key: 'k', viz_type: 'echarts_timeseries_bar' });
    expect(result).toEqual({ viz_type: 'echarts_timeseries_bar', row_limit: 100 });
  });
});

describe('applyExploreActions — varias acciones de una misma propuesta, en un solo paso', () => {
  test('encadena las acciones en orden, cada una sobre el resultado de la anterior', () => {
    const actions: ApplicableExploreAction[] = [
      { type: 'patch_form_data', base_form_data_key: 'k', operations: [{ op: 'set', control: 'groupby', value: ['segmento_nombre'] }] },
      { type: 'add_adhoc_metric', base_form_data_key: 'k', control: 'metrics', label: 'Venta sell in', expression: 'SUM(sell_in)' },
      { type: 'add_adhoc_metric', base_form_data_key: 'k', control: 'metrics', label: 'Cuota', expression: 'SUM(cuota)' },
    ];
    const result = applyExploreActions({ metrics: ['Variación porcentual vs cuota'] }, actions);
    expect(result.groupby).toEqual(['segmento_nombre']);
    expect(result.metrics).toEqual([
      'Variación porcentual vs cuota',
      { expressionType: 'SQL', sqlExpression: 'SUM(sell_in)', label: 'Venta sell in', hasCustomLabel: true },
      { expressionType: 'SQL', sqlExpression: 'SUM(cuota)', label: 'Cuota', hasCustomLabel: true },
    ]);
  });

  test('sin acciones, devuelve el form_data tal cual', () => {
    const formData = { viz_type: 'table' };
    expect(applyExploreActions(formData, [])).toEqual(formData);
  });

  test('no muta el form_data original', () => {
    const original = { metrics: ['count'] };
    const before = { ...original };
    applyExploreActions(original, [{ type: 'add_adhoc_metric', base_form_data_key: 'k', control: 'metrics', label: 'Cuota', expression: 'SUM(cuota)' }]);
    expect(original).toEqual(before);
  });
});

describe('diffFormData', () => {
  test('solo devuelve los controles que cambiaron', () => {
    const before = { a: 1, b: 2, c: 3 };
    const after = { a: 1, b: 20, c: 3 };
    expect(diffFormData(before, after)).toEqual([{ control: 'b', before: 2, after: 20 }]);
  });

  test('detecta controles agregados y quitados', () => {
    const before = { a: 1, removed: 'x' };
    const after = { a: 1, added: 'y' };
    const result = diffFormData(before, after);
    expect(result).toContainEqual({ control: 'removed', before: 'x', after: undefined });
    expect(result).toContainEqual({ control: 'added', before: undefined, after: 'y' });
  });

  test('compara por contenido, no por referencia (arrays/objetos iguales no aparecen)', () => {
    const before = { groupby: ['a', 'b'] };
    const after = { groupby: ['a', 'b'] }; // mismo contenido, otra referencia
    expect(diffFormData(before, after)).toEqual([]);
  });

  test('orden estable por nombre de control', () => {
    const before = { zeta: 1, alpha: 1 };
    const after = { zeta: 2, alpha: 2 };
    expect(diffFormData(before, after).map(e => e.control)).toEqual(['alpha', 'zeta']);
  });

  test('sin cambios, lista vacía', () => {
    const same = { a: 1, b: [1, 2] };
    expect(diffFormData(same, { ...same })).toEqual([]);
  });
});

describe('formatControlValue', () => {
  test('undefined/null/escalares', () => {
    expect(formatControlValue(undefined)).toBe('(sin definir)');
    expect(formatControlValue(null)).toBe('(vacío)');
    expect(formatControlValue('')).toBe('(vacío)');
    expect(formatControlValue('planv')).toBe('planv');
    expect(formatControlValue(500)).toBe('500');
    expect(formatControlValue(true)).toBe('true');
  });

  test('array vacío y array de escalares', () => {
    expect(formatControlValue([])).toBe('(ninguno)');
    expect(formatControlValue(['col_a', 'col_b'])).toBe('col_a, col_b');
  });

  test('métrica SIMPLE (aggregate + column completa) se reduce a "AGREGACIÓN(columna)" — el caso real reportado por el usuario', () => {
    const simpleMetric = {
      aggregate: 'SUM',
      column: { advanced_data_type: null, certification_details: null, certified_by: null, column_name: 'planv', type: 'DOUBLE' },
      expressionType: 'SIMPLE',
    };
    expect(formatControlValue(simpleMetric)).toBe('SUM(planv)');
  });

  test('métrica SQL con label propio (hasCustomLabel) usa el label, no la expresión', () => {
    const sqlMetric = { expressionType: 'SQL', sqlExpression: 'SUM(cuota)', label: 'Cuota', hasCustomLabel: true, optionName: 'metric_cuota' };
    expect(formatControlValue(sqlMetric)).toBe('Cuota');
  });

  test('métrica SQL sin label propio usa la expresión', () => {
    const sqlMetric = { expressionType: 'SQL', sqlExpression: 'AVG(precio)', label: 'AVG(precio)', hasCustomLabel: false };
    expect(formatControlValue(sqlMetric)).toBe('AVG(precio)');
  });

  test('columna simple (groupby) usa column_name', () => {
    expect(formatControlValue({ column_name: 'fecha', type: 'DATETIME' })).toBe('fecha');
  });

  test('métrica guardada por nombre usa metric_name', () => {
    expect(formatControlValue({ metric_name: 'count', expression: 'COUNT(*)' })).toBe('count');
  });

  test('array de métricas mixtas (string + SIMPLE + SQL) se listan legibles, separadas por coma', () => {
    const metrics = ['count', { aggregate: 'SUM', column: { column_name: 'planv' } }, { expressionType: 'SQL', sqlExpression: 'SUM(cuota)', label: 'Cuota', hasCustomLabel: true }];
    expect(formatControlValue(metrics)).toBe('count, SUM(planv), Cuota');
  });

  test('objeto sin ninguna forma conocida cae a JSON acotado', () => {
    expect(formatControlValue({ foo: 'bar', baz: 1 })).toBe('{"foo":"bar","baz":1}');
  });

  test('JSON de más de 160 caracteres se trunca con elipsis', () => {
    const big = { list: Array.from({ length: 30 }, (_, i) => `valor_largo_${i}`) };
    const result = formatControlValue(big);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBe(161);
  });
});

describe('formatControlDiffValue — control "column_config" (personalización/formatos)', () => {
  test('mapa de columna→ajustes con d3NumberFormat, el caso real de una propuesta de formato', () => {
    const value = {
      'Venta sell in': { d3NumberFormat: 'd' },
      Cuota: { d3NumberFormat: 'd' },
      'Diferencia sell in - cuota': { d3NumberFormat: ',d' },
    };
    expect(formatControlDiffValue('column_config', value)).toBe(
      'Venta sell in: formato numérico "d"; Cuota: formato numérico "d"; Diferencia sell in - cuota: formato numérico ",d"',
    );
  });

  test('combina varios ajustes de la misma columna', () => {
    const value = { Cuota: { d3NumberFormat: ',.2f', displayName: 'Cuota mensual' } };
    expect(formatControlDiffValue('column_config', value)).toBe('Cuota: formato numérico ",.2f", se muestra como "Cuota mensual"');
  });

  test('moneda con símbolo', () => {
    const value = { Venta: { currency: { symbol: 'USD', symbolPosition: 'prefix' } } };
    expect(formatControlDiffValue('column_config', value)).toBe('Venta: moneda "USD"');
  });

  test('ajuste sin ninguna clave reconocida cae al JSON de esa columna, no al del mapa entero', () => {
    const value = { Cuota: { someUnknownSetting: true } };
    expect(formatControlDiffValue('column_config', value)).toBe('Cuota: {"someUnknownSetting":true}');
  });

  test('undefined/vacío se comporta igual que formatControlValue', () => {
    expect(formatControlDiffValue('column_config', undefined)).toBe('(sin definir)');
    expect(formatControlDiffValue('column_config', {})).toBe(formatControlValue({}));
  });

  test('otros controles (no column_config) se comportan exactamente igual que formatControlValue', () => {
    const metric = { expressionType: 'SQL', sqlExpression: 'SUM(cuota)', label: 'Cuota', hasCustomLabel: true };
    expect(formatControlDiffValue('metric', metric)).toBe(formatControlValue(metric));
    expect(formatControlDiffValue('row_limit', 500)).toBe(formatControlValue(500));
  });

  test('un valor de column_config que NO es un mapa (ej. viene mal formado) cae a formatControlValue tal cual', () => {
    expect(formatControlDiffValue('column_config', 'no es un objeto')).toBe('no es un objeto');
  });
});

describe('buildExploreReloadUrl', () => {
  test('con slice_id', () => {
    expect(buildExploreReloadUrl('key-1', 42)).toBe('/explore/?form_data_key=key-1&slice_id=42');
  });

  test('sin slice_id (gráfico nuevo)', () => {
    expect(buildExploreReloadUrl('key-1', null)).toBe('/explore/?form_data_key=key-1');
  });
});

describe('postAppliedFormData', () => {
  let fetchMock: jest.Mock<Promise<Response>, [string, RequestInit]>;

  function jsonResponse(status: number, body: unknown): Response {
    return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
  }

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
  });

  test('manda el body correcto y sin tab_id en la URL, devuelve la key', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { key: 'new-key-1' }));
    const key = await postAppliedFormData(11, 'table', { viz_type: 'table', url_params: { foo: 'bar' } }, 42);

    expect(key).toBe('new-key-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/explore/form_data');
    expect(url).not.toContain('tab_id');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    const body = JSON.parse(init.body as string);
    expect(body.datasource_id).toBe(11);
    expect(body.datasource_type).toBe('table');
    expect(body.chart_id).toBe(42);
    expect(JSON.parse(body.form_data)).toEqual({ viz_type: 'table' }); // url_params se quita
  });

  test('con tabId, lo manda como query param en la URL (nunca en el body — bug real: el endpoint solo lo lee de la query string, mandarlo en el body daba 400)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { key: 'new-key-1' }));
    await postAppliedFormData(11, 'table', { viz_type: 'table' }, 42, 'tab-abc');
    const [urlWithTab, initWithTab] = fetchMock.mock.calls[0];
    expect(urlWithTab).toBe('/api/v1/explore/form_data?tab_id=tab-abc');
    expect('tab_id' in JSON.parse(initWithTab.body as string)).toBe(false);

    fetchMock.mockClear();
    await postAppliedFormData(11, 'table', { viz_type: 'table' }, 42);
    const [urlWithoutTab] = fetchMock.mock.calls[0];
    expect(urlWithoutTab).toBe('/api/v1/explore/form_data');
  });

  test('sin chart_id (gráfico sin guardar), no lo manda', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { key: 'new-key-1' }));
    await postAppliedFormData(11, 'table', { viz_type: 'table' });
    const body = JSON.parse((fetchMock.mock.calls[0][1].body as string));
    expect('chart_id' in body).toBe(false);
  });

  test('HTTP no-2xx lanza ApplyExploreActionError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, {}));
    await expect(postAppliedFormData(11, 'table', {})).rejects.toThrow(ApplyExploreActionError);
  });

  test('respuesta sin key lanza ApplyExploreActionError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, {}));
    await expect(postAppliedFormData(11, 'table', {})).rejects.toThrow(ApplyExploreActionError);
  });
});
