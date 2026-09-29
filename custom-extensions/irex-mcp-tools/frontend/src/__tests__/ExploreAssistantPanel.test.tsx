import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ExploreAssistantPanel } from '../assistant/ExploreAssistantPanel';
import { requestExploreAssistant, ExploreBackendError } from '../adapters/exploreBackendAdapter';
import { readExploreContext, readIsAdminHint, onExploreContextChanged, readExploreFidelity, type ExploreContext } from '../adapters/exploreAdapter';
import type { ExploreAssistantResponse } from '../contracts/exploreAssistant';

jest.mock('../adapters/exploreBackendAdapter', () => {
  const actual = jest.requireActual<typeof import('../adapters/exploreBackendAdapter')>('../adapters/exploreBackendAdapter');
  return { ...actual, requestExploreAssistant: jest.fn() };
});

jest.mock('../adapters/exploreAdapter', () => {
  const actual = jest.requireActual<typeof import('../adapters/exploreAdapter')>('../adapters/exploreAdapter');
  return {
    ...actual,
    readExploreContext: jest.fn(),
    readIsAdminHint: jest.fn(),
    readExploreFidelity: jest.fn(),
    onExploreContextChanged: jest.fn(),
  };
});

const requestMock = requestExploreAssistant as jest.MockedFunction<typeof requestExploreAssistant>;
const readContextMock = readExploreContext as jest.MockedFunction<typeof readExploreContext>;
const readIsAdminMock = readIsAdminHint as jest.MockedFunction<typeof readIsAdminHint>;
const readFidelityMock = readExploreFidelity as jest.MockedFunction<typeof readExploreFidelity>;
const onContextChangedMock = onExploreContextChanged as jest.MockedFunction<typeof onExploreContextChanged>;

const VALID_CONTEXT: ExploreContext = {
  sliceId: 7,
  formDataKey: 'key-1',
  formData: { datasource: '11__table', viz_type: 'table' },
  queryFidelity: { status: 'fiel', queryContext: '{"saved":true}', vizType: 'table' },
};

const RESPONSE: ExploreAssistantResponse = {
  contract_version: 1,
  source: 'superset_explore',
  session_id: 'explore-session-1',
  message: 'Este gráfico agrupa por columna y suma la métrica count.',
  actions: [],
  diagnostics: [],
};

function baseMocks(): void {
  readContextMock.mockResolvedValue(VALID_CONTEXT);
  readIsAdminMock.mockReturnValue(false);
  readFidelityMock.mockResolvedValue(VALID_CONTEXT.queryFidelity);
  onContextChangedMock.mockReturnValue({ dispose: jest.fn() });
}

beforeEach(() => {
  requestMock.mockReset();
  readContextMock.mockReset();
  readIsAdminMock.mockReset();
  readFidelityMock.mockReset();
  onContextChangedMock.mockReset();
  baseMocks();
});

describe('enviar un mensaje', () => {
  test('con el modo por defecto ("Explicar"), un click en Generar manda el prompt por defecto y muestra la respuesta', async () => {
    requestMock.mockResolvedValue(RESPONSE);
    render(<ExploreAssistantPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));

    await screen.findByText(/agrupa por columna/);
    expect(requestMock).toHaveBeenCalledTimes(1);
    const [request] = requestMock.mock.calls[0];
    expect(request.mode).toBe('explain');
    expect(request.user_message).toBe('Explicame la configuración actual de este gráfico: qué muestra y por qué.');
    expect(request.chart).toEqual({
      slice_id: 7, form_data_key: 'key-1', viz_type: 'table', datasource: { id: 11, type: 'table' },
      query_context: '{"saved":true}', // VALID_CONTEXT.queryFidelity ya viene 'fiel'
    });
  });

  test('escribir texto propio lo manda en vez del default', async () => {
    requestMock.mockResolvedValue(RESPONSE);
    render(<ExploreAssistantPanel />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Instrucciones para el asistente' }), { target: { value: 'agregá una métrica de promedio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));

    await screen.findByText(/agrupa por columna/);
    expect(requestMock.mock.calls[0][0].user_message).toBe('agregá una métrica de promedio');
  });

  test('cambiar de modo cambia lo que se manda por defecto', async () => {
    requestMock.mockResolvedValue(RESPONSE);
    render(<ExploreAssistantPanel />);

    fireEvent.click(screen.getByRole('radio', { name: 'Mejorar gráfico' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));

    await screen.findByText(/agrupa por columna/);
    expect(requestMock.mock.calls[0][0].mode).toBe('improve_chart');
    expect(requestMock.mock.calls[0][0].user_message).toContain('Sugerime mejoras');
  });

  test('el rol Admin del hint viaja en el body', async () => {
    readIsAdminMock.mockReturnValue(true);
    requestMock.mockResolvedValue(RESPONSE);
    render(<ExploreAssistantPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));

    await screen.findByText(/agrupa por columna/);
    expect(requestMock.mock.calls[0][0].user.is_admin).toBe(true);
  });
});

describe('errores', () => {
  test('un error del backend se muestra como "Error: ..." en rojo', async () => {
    requestMock.mockRejectedValue(new ExploreBackendError('El backend Explore respondió 502.'));
    render(<ExploreAssistantPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));

    await screen.findByText('El backend Explore respondió 502.');
  });

  test('sin estado persistido (form_data_key ausente) no llega a mandar el pedido y muestra el motivo', async () => {
    readContextMock.mockResolvedValue({ sliceId: undefined, formDataKey: undefined, formData: undefined, queryFidelity: { status: 'no-disponible', reason: 'sin guardar' } });
    render(<ExploreAssistantPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));

    await screen.findByText('No se pudo leer el estado persistido de Explore.');
    expect(requestMock).not.toHaveBeenCalled();
  });
});

describe('aclaración', () => {
  test('responder una aclaración manda la opción elegida como próximo mensaje', async () => {
    requestMock.mockResolvedValueOnce({
      ...RESPONSE,
      message: 'Necesito saber qué período comparar.',
      suggestion_kind: 'clarification',
      clarification_questions: [{ id: 'q1', text: '¿Qué período?', options: ['Último mes', 'Último trimestre'] }],
    });
    render(<ExploreAssistantPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));
    await screen.findByText('¿Qué período?');

    requestMock.mockResolvedValueOnce(RESPONSE);
    fireEvent.click(screen.getByRole('button', { name: 'Último mes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar →' }));

    await screen.findByText(/agrupa por columna/);
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(requestMock.mock.calls[1][0].user_message).toBe('Último mes');
  });
});

describe('acciones — Fase 6', () => {
  test('una acción aplicable (add_adhoc_metric) se describe y ofrece "Ver cambio"', async () => {
    requestMock.mockResolvedValue({
      ...RESPONSE,
      actions: [{ type: 'add_adhoc_metric', base_form_data_key: 'key-1', control: 'metrics', label: 'Promedio', expression: 'AVG(precio)' }],
    });
    render(<ExploreAssistantPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));

    await screen.findByText(/Agregar la métrica "Promedio"/);
    expect(screen.getByRole('button', { name: 'Ver cambio' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^aplicar$/i })).toBeNull(); // recién aparece tras preparar
  });

  test('la URL sin la key de la propuesta (estado cambió mientras tanto) se rechaza al pedir "Ver cambio"', async () => {
    requestMock.mockResolvedValue({
      ...RESPONSE,
      actions: [{ type: 'add_adhoc_metric', base_form_data_key: 'key-de-otra-propuesta', control: 'metrics', label: 'Promedio', expression: 'AVG(precio)' }],
    });
    render(<ExploreAssistantPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));
    await screen.findByText(/Agregar la métrica "Promedio"/);

    fireEvent.click(screen.getByRole('button', { name: 'Ver cambio' }));

    await screen.findByText(/El estado del gráfico cambió desde que se generó esta propuesta/);
  });

  test('una acción que requiere Admin (add_dataset_metric) no ofrece aplicar desde acá', async () => {
    requestMock.mockResolvedValue({
      ...RESPONSE,
      actions: [{ type: 'add_dataset_metric', dataset_id: 11, label: 'Total', expression: 'SUM(monto)' }],
    });
    render(<ExploreAssistantPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));

    await screen.findByText(/Agregar al dataset la métrica guardada "Total"/);
    expect(screen.getByText('Esto requiere rol Admin y todavía no está disponible desde acá.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver cambio' })).toBeNull();
  });

  test('una acción de preview no ofrece aplicar, vive en el propio gráfico', async () => {
    requestMock.mockResolvedValue({ ...RESPONSE, actions: [{ type: 'preview' }] });
    render(<ExploreAssistantPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));

    await screen.findByText('Vista previa del resultado');
    expect(screen.getByText('La vista previa vive en el propio gráfico.')).toBeInTheDocument();
  });
});

describe('lista de cambios con casilleros — varias acciones de una misma propuesta (Fase 6, feedback 2026-09-25)', () => {
  test('con una sola acción aplicable, no aparece el casillero — se muestra como una tarjeta simple', async () => {
    requestMock.mockResolvedValue({
      ...RESPONSE,
      actions: [{ type: 'add_adhoc_metric', base_form_data_key: 'key-1', control: 'metrics', label: 'Promedio', expression: 'AVG(precio)' }],
    });
    render(<ExploreAssistantPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));

    await screen.findByText(/Agregar la métrica "Promedio"/);
    expect(screen.queryByText(/cambios relacionados/)).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  test('con 2+ acciones aplicables, aparece un único casillero con todo tildado por defecto — sin aviso de "se pierden las demás"', async () => {
    requestMock.mockResolvedValue({
      ...RESPONSE,
      actions: [
        { type: 'patch_form_data', base_form_data_key: 'key-1', operations: [{ op: 'set', control: 'groupby', value: ['segmento_nombre'] }] },
        { type: 'add_adhoc_metric', base_form_data_key: 'key-1', control: 'metrics', label: 'Venta sell in', expression: 'SUM(sell_in)' },
      ],
    });
    render(<ExploreAssistantPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));

    await screen.findByText('Esta propuesta tiene 2 cambios relacionados. Elegí cuáles aplicar juntos, en un solo paso.');
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.every(box => (box as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole('button', { name: 'Ver cambio' })).toBeInTheDocument();
    expect(screen.queryByText(/se pierden|descartan|dejan de estar disponibles/)).toBeNull();
  });

  test('destildar todas las acciones deshabilita "Ver cambio" — nunca se puede aplicar un paquete vacío', async () => {
    requestMock.mockResolvedValue({
      ...RESPONSE,
      actions: [
        { type: 'patch_form_data', base_form_data_key: 'key-1', operations: [{ op: 'set', control: 'groupby', value: ['segmento_nombre'] }] },
        { type: 'add_adhoc_metric', base_form_data_key: 'key-1', control: 'metrics', label: 'Venta sell in', expression: 'SUM(sell_in)' },
      ],
    });
    render(<ExploreAssistantPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));
    await screen.findByText(/cambios relacionados/);

    screen.getAllByRole('checkbox').forEach(box => fireEvent.click(box));

    expect(screen.getByRole('button', { name: 'Ver cambio' })).toBeDisabled();
  });

  test('"Ver cambio" respeta la misma comprobación de key que una tarjeta individual', async () => {
    requestMock.mockResolvedValue({
      ...RESPONSE,
      actions: [
        { type: 'add_adhoc_metric', base_form_data_key: 'key-vieja', control: 'metrics', label: 'Venta sell in', expression: 'SUM(sell_in)' },
        { type: 'add_adhoc_metric', base_form_data_key: 'key-vieja', control: 'metrics', label: 'Cuota', expression: 'SUM(cuota)' },
      ],
    });
    render(<ExploreAssistantPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));
    await screen.findByText(/cambios relacionados/);

    fireEvent.click(screen.getByRole('button', { name: 'Ver cambio' }));

    await screen.findByText(/El estado del gráfico cambió desde que se generó esta propuesta/);
  });
});

describe('aviso de "Deshacer" (Fase 6)', () => {
  afterEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  test('con una entrada pendiente que coincide con la URL actual, se muestra y permite deshacer', () => {
    window.history.replaceState({}, '', '/explore/?slice_id=7&form_data_key=key-after');
    window.sessionStorage.setItem(
      'irex-explore-pending-undo',
      JSON.stringify({ sliceId: 7, previousFormDataKey: 'key-before', appliedFormDataKey: 'key-after', title: 'Cambiar row_limit', appliedAt: 1 }),
    );
    render(<ExploreAssistantPanel />);
    expect(screen.getByText('Cambiar row_limit')).toBeInTheDocument();

    // No se reemplaza `window.location` entero para probar el click (jsdom
    // no permite restaurarlo de forma confiable entre tests — el intento
    // dejaba `location.search` "pegado" para el resto del archivo). Lo que
    // importa comprobar acá es que el click limpia el pendiente; la URL a la
    // que `buildExploreReloadUrl` apunta ya está cubierta por sus propios
    // tests en `exploreApplyAdapter.test.ts`. jsdom reporta un "navigation
    // not implemented" al invocar `location.assign` real, sin lanzar.
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(window.sessionStorage.getItem('irex-explore-pending-undo')).toBeNull();
  });

  test('sin entrada pendiente, no muestra nada', () => {
    window.history.replaceState({}, '', '/explore/?slice_id=7&form_data_key=key-after');
    render(<ExploreAssistantPanel />);
    expect(screen.queryByRole('button', { name: 'Deshacer' })).toBeNull();
  });

  test('con una entrada de otro gráfico (slice_id distinto), no la muestra', () => {
    window.history.replaceState({}, '', '/explore/?slice_id=99&form_data_key=key-after');
    window.sessionStorage.setItem(
      'irex-explore-pending-undo',
      JSON.stringify({ sliceId: 7, previousFormDataKey: 'key-before', appliedFormDataKey: 'key-after', title: 'Cambiar row_limit', appliedAt: 1 }),
    );
    render(<ExploreAssistantPanel />);
    expect(screen.queryByRole('button', { name: 'Deshacer' })).toBeNull();
  });

  test('con una entrada pendiente que trae conversación, la restaura al montar (el reload de "Aplicar" no la borra)', () => {
    window.history.replaceState({}, '', '/explore/?slice_id=7&form_data_key=key-after');
    window.sessionStorage.setItem(
      'irex-explore-pending-undo',
      JSON.stringify({
        sliceId: 7,
        previousFormDataKey: 'key-before',
        appliedFormDataKey: 'key-after',
        title: 'Cambiar un control del gráfico',
        appliedAt: 1,
        conversation: {
          conversationKey: 'conv-restaurada',
          sessionId: 'explore-session-restaurada',
          mode: 'improve_chart',
          history: [
            { role: 'user', text: 'En lugar de plan quiero ver la cuota' },
            { role: 'assistant', text: 'Propongo sustituir la métrica actual SUM(planv) por SUM(cuota).' },
          ],
        },
      }),
    );

    render(<ExploreAssistantPanel />);

    expect(screen.getByText('En lugar de plan quiero ver la cuota')).toBeInTheDocument();
    expect(screen.getByText('Propongo sustituir la métrica actual SUM(planv) por SUM(cuota).')).toBeInTheDocument();
    expect(screen.getByText('explore-session-restaurada')).toBeInTheDocument();
  });

  test('con una entrada pendiente SIN conversación (compatibilidad hacia atrás), arranca vacía sin romper', () => {
    window.history.replaceState({}, '', '/explore/?slice_id=7&form_data_key=key-after');
    window.sessionStorage.setItem(
      'irex-explore-pending-undo',
      JSON.stringify({ sliceId: 7, previousFormDataKey: 'key-before', appliedFormDataKey: 'key-after', title: 'Cambiar row_limit', appliedAt: 1 }),
    );

    render(<ExploreAssistantPanel />);

    expect(screen.getByText('Cambiar row_limit')).toBeInTheDocument(); // el banner sí se muestra
    expect(screen.queryByText(/explore-session/)).toBeNull(); // pero sin sesión de chat restaurada
  });
});

describe('Nueva sesión', () => {
  test('vacía la conversación y rota la sesión (el próximo turno ya no muestra el session_id anterior)', async () => {
    requestMock.mockResolvedValue(RESPONSE);
    render(<ExploreAssistantPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));
    await screen.findByText(/agrupa por columna/);
    expect(screen.getByText('explore-session-1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Nueva sesión' }));

    expect(screen.queryByText('explore-session-1')).toBeNull();
    expect(screen.queryByText(/agrupa por columna/)).toBeNull();
  });
});

describe('estado de fidelidad', () => {
  test('muestra el contrato y el resultado de readExploreFidelity', async () => {
    readFidelityMock.mockResolvedValue({ status: 'no-disponible', reason: 'el gráfico no está guardado' });
    render(<ExploreAssistantPanel />);

    expect(screen.getByText(/Leo el último estado que Explore guardó en la URL/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('irex-explore-fidelity')).toHaveTextContent('el gráfico no está guardado'));
  });
});

describe('comandos "/" del composer (2026-09-28)', () => {
  const textboxName = 'Instrucciones para el asistente';

  afterEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  test('un intercambio exitoso en un gráfico guardado se graba para poder retomarlo después', async () => {
    window.history.replaceState({}, '', '/explore/?slice_id=7&form_data_key=key-1');
    requestMock.mockResolvedValue(RESPONSE);
    render(<ExploreAssistantPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));
    await screen.findByText(/agrupa por columna/);

    const raw = window.localStorage.getItem('irex-explore-chat-history:7');
    expect(raw).not.toBeNull();
    const entries = JSON.parse(raw as string);
    expect(entries).toHaveLength(1);
    expect(entries[0].history).toEqual([
      { role: 'user', text: 'Explicame la configuración actual de este gráfico: qué muestra y por qué.' },
      { role: 'assistant', text: RESPONSE.message },
    ]);
    expect(entries[0].sessionId).toBe('explore-session-1');
  });

  test('tipear "/" muestra el menú de autocompletado con los comandos registrados', () => {
    render(<ExploreAssistantPanel />);
    fireEvent.change(screen.getByRole('textbox', { name: textboxName }), { target: { value: '/' } });

    expect(screen.getByRole('listbox', { name: 'Comandos disponibles' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /\/resume/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /\/clear/ })).toBeInTheDocument();
  });

  test('escribir "/" cambia el botón de "Generar" a "Ejecutar"', () => {
    render(<ExploreAssistantPanel />);
    fireEvent.change(screen.getByRole('textbox', { name: textboxName }), { target: { value: '/clear ' } });

    expect(screen.getByRole('button', { name: /Ejecutar/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generar' })).toBeNull();
  });

  test('/clear se comporta igual que "Nueva sesión"', async () => {
    requestMock.mockResolvedValue(RESPONSE);
    render(<ExploreAssistantPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));
    await screen.findByText(/agrupa por columna/);
    expect(screen.getByText('explore-session-1')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: textboxName }), { target: { value: '/clear ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar' }));

    expect(screen.queryByText('explore-session-1')).toBeNull();
    expect(screen.queryByText(/agrupa por columna/)).toBeNull();
  });

  test('/resume en un gráfico sin guardar avisa que no hay nada que retomar', () => {
    // sin slice_id en la URL -> gráfico sin guardar
    render(<ExploreAssistantPanel />);
    fireEvent.change(screen.getByRole('textbox', { name: textboxName }), { target: { value: '/resume ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar' }));

    expect(screen.getByText(/todavía no está guardado/)).toBeInTheDocument();
  });

  test('/resume sin conversaciones previas avisa que no hay ninguna', () => {
    window.history.replaceState({}, '', '/explore/?slice_id=7&form_data_key=key-1');
    render(<ExploreAssistantPanel />);
    fireEvent.change(screen.getByRole('textbox', { name: textboxName }), { target: { value: '/resume ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar' }));

    expect(screen.getByText(/No hay conversaciones anteriores guardadas/)).toBeInTheDocument();
  });

  test('/resume con UNA sola conversación previa la retoma directo, sin picker', () => {
    window.history.replaceState({}, '', '/explore/?slice_id=7&form_data_key=key-1');
    window.localStorage.setItem(
      'irex-explore-chat-history:7',
      JSON.stringify([
        {
          conversationKey: 'conv-unica',
          sessionId: 'explore-session-unica',
          mode: 'improve_chart',
          history: [{ role: 'user', text: 'Sumá una métrica de promedio' }, { role: 'assistant', text: 'Propongo AVG(cuota).' }],
          updatedAt: Date.now(),
        },
      ]),
    );
    render(<ExploreAssistantPanel />);

    fireEvent.change(screen.getByRole('textbox', { name: textboxName }), { target: { value: '/resume ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar' }));

    expect(screen.getByText('Sumá una métrica de promedio')).toBeInTheDocument();
    expect(screen.getByText('Propongo AVG(cuota).')).toBeInTheDocument();
    expect(screen.getByText('explore-session-unica')).toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: /retomar/ })).toBeNull();
    expect(screen.queryByText(/Elegí una conversación/)).toBeNull();
  });

  test('/resume con varias conversaciones muestra un picker; elegir una la retoma', () => {
    window.history.replaceState({}, '', '/explore/?slice_id=7&form_data_key=key-1');
    window.localStorage.setItem(
      'irex-explore-chat-history:7',
      JSON.stringify([
        {
          conversationKey: 'conv-vieja',
          sessionId: 'explore-session-vieja',
          mode: 'explain',
          history: [{ role: 'user', text: 'Explicame este gráfico' }, { role: 'assistant', text: 'Respuesta vieja' }],
          updatedAt: 1,
        },
        {
          conversationKey: 'conv-nueva',
          sessionId: 'explore-session-nueva',
          mode: 'improve_chart',
          history: [{ role: 'user', text: 'Agregá una métrica' }, { role: 'assistant', text: 'Respuesta nueva' }],
          updatedAt: 2,
        },
      ]),
    );
    render(<ExploreAssistantPanel />);

    fireEvent.change(screen.getByRole('textbox', { name: textboxName }), { target: { value: '/resume ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar' }));

    expect(screen.getByText(/Elegí una conversación para retomar \(2\)/)).toBeInTheDocument();
    // más reciente primero
    expect(screen.getByText('Agregá una métrica')).toBeInTheDocument();
    expect(screen.getByText('Explicame este gráfico')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Explicame este gráfico'));

    expect(screen.getByText('Respuesta vieja')).toBeInTheDocument();
    expect(screen.getByText('explore-session-vieja')).toBeInTheDocument();
    expect(screen.queryByText(/Elegí una conversación/)).toBeNull();
  });

  test('/resume <n> elige directo por índice, sin mostrar el picker', () => {
    window.history.replaceState({}, '', '/explore/?slice_id=7&form_data_key=key-1');
    window.localStorage.setItem(
      'irex-explore-chat-history:7',
      JSON.stringify([
        {
          conversationKey: 'conv-vieja',
          sessionId: 'explore-session-vieja',
          mode: 'explain',
          history: [{ role: 'user', text: 'Explicame este gráfico' }, { role: 'assistant', text: 'Respuesta vieja' }],
          updatedAt: 1,
        },
        {
          conversationKey: 'conv-nueva',
          sessionId: 'explore-session-nueva',
          mode: 'improve_chart',
          history: [{ role: 'user', text: 'Agregá una métrica' }, { role: 'assistant', text: 'Respuesta nueva' }],
          updatedAt: 2,
        },
      ]),
    );
    render(<ExploreAssistantPanel />);

    // #1 = la más reciente (conv-nueva), igual que el picker las numera.
    fireEvent.change(screen.getByRole('textbox', { name: textboxName }), { target: { value: '/resume 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar' }));

    expect(screen.getByText('Respuesta vieja')).toBeInTheDocument();
    expect(screen.getByText('explore-session-vieja')).toBeInTheDocument();
    expect(screen.queryByText(/Elegí una conversación/)).toBeNull();
  });

  test('/resume <n> fuera de rango avisa en vez de romper', () => {
    window.history.replaceState({}, '', '/explore/?slice_id=7&form_data_key=key-1');
    window.localStorage.setItem(
      'irex-explore-chat-history:7',
      JSON.stringify([
        { conversationKey: 'conv-1', sessionId: 's-1', mode: 'explain', history: [{ role: 'user', text: 'hola' }], updatedAt: 1 },
      ]),
    );
    render(<ExploreAssistantPanel />);

    fireEvent.change(screen.getByRole('textbox', { name: textboxName }), { target: { value: '/resume 5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar' }));

    expect(screen.getByText(/No hay una conversación #5/)).toBeInTheDocument();
  });
});
