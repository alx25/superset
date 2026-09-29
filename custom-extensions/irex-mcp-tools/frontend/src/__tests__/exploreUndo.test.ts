import { clearPendingUndo, readPendingUndo, rememberPendingUndo, type PendingExploreUndo } from '../hosts/exploreUndo';

const sample: PendingExploreUndo = {
  sliceId: 42,
  previousFormDataKey: 'before-key',
  appliedFormDataKey: 'after-key',
  title: 'Cambiar métrica a SUM(cuota)',
  appliedAt: 1234567890,
};

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('rememberPendingUndo / readPendingUndo', () => {
  test('se puede leer de vuelta cuando coincide el gráfico y la key aplicada', () => {
    rememberPendingUndo(sample);
    expect(readPendingUndo(42, 'after-key')).toEqual(sample);
  });

  test('no devuelve nada si no hay ninguna entrada guardada', () => {
    expect(readPendingUndo(42, 'after-key')).toBeUndefined();
  });

  test('no devuelve nada si el slice_id no coincide (otro gráfico)', () => {
    rememberPendingUndo(sample);
    expect(readPendingUndo(999, 'after-key')).toBeUndefined();
  });

  test('no devuelve nada si la key actual no es la que quedó aplicada (el usuario navegó a otra cosa)', () => {
    rememberPendingUndo(sample);
    expect(readPendingUndo(42, 'otra-key-cualquiera')).toBeUndefined();
  });

  test('gráfico sin guardar: sliceId null coincide con null, no con un número', () => {
    rememberPendingUndo({ ...sample, sliceId: null });
    expect(readPendingUndo(null, 'after-key')).toEqual({ ...sample, sliceId: null });
    expect(readPendingUndo(42, 'after-key')).toBeUndefined();
  });

  test('JSON corrupto en sessionStorage no rompe, se trata como ausente', () => {
    window.sessionStorage.setItem('irex-explore-pending-undo', '{not valid json');
    expect(readPendingUndo(42, 'after-key')).toBeUndefined();
  });

  test('la conversación (opcional) viaja intacta ida y vuelta', () => {
    const withConversation: PendingExploreUndo = {
      ...sample,
      conversation: {
        conversationKey: 'conv-1',
        sessionId: 'explore-session-1',
        mode: 'improve_chart',
        history: [
          { role: 'user', text: 'cambiá la métrica a SUM(cuota)' },
          { role: 'assistant', text: 'Propongo sustituir la métrica...' },
        ],
      },
    };
    rememberPendingUndo(withConversation);
    expect(readPendingUndo(42, 'after-key')).toEqual(withConversation);
  });

  test('una entrada sin conversación (compatibilidad hacia atrás) se lee sin el campo', () => {
    rememberPendingUndo(sample); // `sample` no trae `conversation`
    const read = readPendingUndo(42, 'after-key');
    expect(read?.conversation).toBeUndefined();
  });
});

describe('clearPendingUndo', () => {
  test('borra la entrada — una lectura posterior no encuentra nada', () => {
    rememberPendingUndo(sample);
    clearPendingUndo();
    expect(readPendingUndo(42, 'after-key')).toBeUndefined();
  });

  test('no lanza si no había nada guardado', () => {
    expect(() => clearPendingUndo()).not.toThrow();
  });
});
