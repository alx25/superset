import { AssistantBackendError, parseAssistantResponse } from '../adapters/chatBackendAdapter';

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contract_version: 1,
    message: 'Listo',
    actions: [{ type: 'propose_sql', target: 'document', sql: 'SELECT 1', title: 'Corregir' }],
    diagnostics: [{ line: 3, column: 8, severity: 'warning', message: 'Ojo' }],
    ...overrides,
  };
}

describe('parseAssistantResponse — contrato v1 válido', () => {
  test('convierte snake_case al contrato interno', () => {
    const parsed = parseAssistantResponse(validBody({ session_id: 'abc' }));
    expect(parsed).toEqual({
      contractVersion: 1,
      message: 'Listo',
      actions: [{ type: 'propose_sql', target: 'document', sql: 'SELECT 1', title: 'Corregir' }],
      diagnostics: [{ line: 3, column: 8, severity: 'warning', message: 'Ojo' }],
      sessionId: 'abc',
      clarification: undefined,
    });
  });

  test('arma la aclaración solo desde clarification_questions, nunca desde suggestions', () => {
    const parsed = parseAssistantResponse(
      validBody({
        suggestion_kind: 'clarification',
        suggestions: ['legado, se ignora'],
        clarification_questions: [{ id: 'q1', text: '¿Qué período?', options: ['Mes', 'Año'] }],
      }),
    );
    expect(parsed.clarification?.questions).toEqual([
      { id: 'q1', axis: undefined, text: '¿Qué período?', options: ['Mes', 'Año'] },
    ]);
  });

  test('suggestion_kind sin preguntas no genera aclaración', () => {
    expect(parseAssistantResponse(validBody({ suggestion_kind: 'clarification' })).clarification).toBeUndefined();
  });
});

describe('parseAssistantResponse — contratos malformados se rechazan', () => {
  test.each<[string, unknown]>([
    ['no es un objeto', 'texto'],
    ['null', null],
    ['contract_version distinta', validBody({ contract_version: 2 })],
    ['sin message', validBody({ message: undefined })],
    ['actions no es lista', validBody({ actions: {} })],
    ['sin diagnostics', validBody({ diagnostics: undefined })],
    ['acción de tipo desconocido', validBody({ actions: [{ type: 'drop_everything', sql: 'x' }] })],
    ['propose_sql sin target', validBody({ actions: [{ type: 'propose_sql', sql: 'x', title: 't' }] })],
    ['replace_document sin sql', validBody({ actions: [{ type: 'replace_document' }] })],
    ['suggest_execution con sql no string', validBody({ actions: [{ type: 'suggest_execution', sql: 42 }] })],
    ['diagnóstico con severidad inválida', validBody({ diagnostics: [{ line: 1, severity: 'fatal', message: 'x' }] })],
    [
      'aclaración sin opciones',
      validBody({ suggestion_kind: 'clarification', clarification_questions: [{ id: 'q', text: 't', options: [] }] }),
    ],
  ])('%s', (_label, body) => {
    expect(() => parseAssistantResponse(body)).toThrow(AssistantBackendError);
  });

  test('nunca extrae SQL del texto libre del message', () => {
    const parsed = parseAssistantResponse(validBody({ message: '```sql\nDELETE FROM t\n```', actions: [] }));
    expect(parsed.actions).toEqual([]);
  });
});
