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
    // Sin query_context: apagado por default (SEND_QUERY_CONTEXT_IN_REQUEST
    // en exploreAdapter.ts) aunque VALID_CONTEXT.queryFidelity sea 'fiel'.
    expect(request.chart).toEqual({
      slice_id: 7, form_data_key: 'key-1', viz_type: 'table', datasource: { id: 11, type: 'table' },
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

describe('acciones — de solo lectura por ahora', () => {
  test('una propuesta con acciones se describe, sin botón de aplicar', async () => {
    requestMock.mockResolvedValue({
      ...RESPONSE,
      actions: [{ type: 'add_adhoc_metric', base_form_data_key: 'key-1', control: 'metrics', label: 'Promedio', expression: 'AVG(precio)' }],
    });
    render(<ExploreAssistantPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Generar' }));

    await screen.findByText(/Agregar la métrica "Promedio"/);
    expect(screen.getByText('Aplicar propuestas automáticamente todavía no está disponible.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /aplicar/i })).toBeNull();
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
