import { buildExploreAssistantRequest } from '../adapters/exploreAdapter';
import { parseExploreAssistantResponse } from '../contracts/exploreAssistant';

const base = {
  contract_version: 1,
  source: 'superset_explore',
  message: 'Propuesta',
  actions: [],
  diagnostics: [],
};

describe('contrato Explore v1', () => {
  test('acepta una propuesta de controles tipada', () => {
    const response = parseExploreAssistantResponse({
      ...base,
      actions: [{ type: 'patch_form_data', base_form_data_key: 'key-1',
        operations: [{ op: 'set', control: 'metrics', value: ['count'] }] }],
      diagnostics: [{ severity: 'warning', message: 'Control no ejecutado', control: 'metrics' }],
    });
    expect(response.actions).toHaveLength(1);
    expect(response.diagnostics[0].control).toBe('metrics');
  });

  test.each([
    { ...base, source: 'superset_sqllab' },
    { ...base, actions: [{ type: 'replace_document', sql: 'select 1' }] },
    { ...base, actions: [{ type: 'patch_form_data', base_form_data_key: 'key-1',
      operations: [{ op: 'set', control: 'metrics' }] }] },
    { ...base, actions: [{ type: 'add_dataset_metric', dataset_id: 0, label: 'x', expression: 'SUM(x)' }] },
    { ...base, suggestion_kind: 'clarification', actions: [{ type: 'preview' }] },
  ])('rechaza una respuesta o acción incompatible con el contrato', raw => {
    expect(() => parseExploreAssistantResponse(raw)).toThrow();
  });

  test('acepta aclaraciones sin acciones', () => {
    const response = parseExploreAssistantResponse({
      ...base,
      suggestion_kind: 'clarification',
      clarification_reason: 'Falta elegir el eje',
      clarification_questions: [{ id: 'axis', text: '¿Qué eje?', options: ['X', 'Y'] }],
    });
    expect(response.clarification_questions?.[0].options).toEqual(['X', 'Y']);
  });
});


describe('body Explore v1', () => {
  const context = {
    sliceId: 7,
    formDataKey: 'key-1',
    formData: { viz_type: 'table', datasource: '11__table', slice_id: 1187 },
    queryFidelity: {
      status: 'fiel' as const,
      vizType: 'table',
      queryContext: JSON.stringify({ datasource: { id: 11, type: 'table' }, queries: [{}] }),
    },
  };

  test('deriva la identidad del estado persistido y usa el slice_id de la URL', () => {
    const request = buildExploreAssistantRequest(context, 'explain', 'Explica', 'uuid', false);
    // NO viaja `query_context` aunque la fidelidad del fixture sea 'fiel':
    // el backend del chat lo rechaza con 422 (`extra_forbidden`) hasta que
    // actualice su schema — ver SEND_QUERY_CONTEXT_IN_REQUEST en
    // exploreAdapter.ts (entrada 73 del Registro de cambios, 2026-09-24).
    expect(request.chart).toEqual({
      slice_id: 7, form_data_key: 'key-1', viz_type: 'table', datasource: { id: 11, type: 'table' },
    });
    expect(request.form_data).toEqual(context.formData);
    expect(request.user.is_admin).toBe(false);
  });

  test('permite leer configuración persistida sin SQL ejecutado, sin mandar un query_context que no es fiel', () => {
    const request = buildExploreAssistantRequest(
      { ...context, queryFidelity: { status: 'no-disponible', reason: 'sin ejecutar' } },
      'explain', 'Explica', 'uuid', false,
    );
    expect(request.chart.datasource).toEqual({ id: 11, type: 'table' });
    expect(request.chart.query_context).toBeUndefined();
  });

  test('rechaza key o identidad de dataset inválida', () => {
    expect(() => buildExploreAssistantRequest({ ...context, formDataKey: undefined }, 'explain', '', 'uuid', false)).toThrow();
    expect(() => buildExploreAssistantRequest({ ...context, formData: { viz_type: 'table', datasource: '0__table' } }, 'explain', '', 'uuid', false)).toThrow();
    expect(() => buildExploreAssistantRequest({ ...context, formData: { viz_type: 'table', datasource: '11__query' } }, 'explain', '', 'uuid', false)).toThrow();
  });
});
