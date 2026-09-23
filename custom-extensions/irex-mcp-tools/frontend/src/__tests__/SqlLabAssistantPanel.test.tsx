import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createFakeTab, fakeHost } from './supersetCoreMock';
import { AssistantBackendError, requestAssistantResponse } from '../adapters/chatBackendAdapter';
import { SqlLabAssistantPanel } from '../assistant/SqlLabAssistantPanel';
import type { AssistantResponse } from '../contracts/assistant';

jest.mock('../adapters/chatBackendAdapter', () => {
  const actual = jest.requireActual<typeof import('../adapters/chatBackendAdapter')>('../adapters/chatBackendAdapter');
  return { ...actual, requestAssistantResponse: jest.fn() };
});

const requestMock = requestAssistantResponse as jest.MockedFunction<typeof requestAssistantResponse>;

const proposal: AssistantResponse = {
  contractVersion: 1,
  message: 'La columna real es anio_id.',
  actions: [{ type: 'propose_sql', target: 'document', sql: 'SELECT anio_id FROM t', title: 'Corregir columna' }],
  diagnostics: [],
};

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

let tab: ReturnType<typeof createFakeTab>;
let confirmSpy: jest.SpyInstance<boolean, [message?: string]>;

beforeAll(() => {
  (window as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
});

beforeEach(() => {
  tab = createFakeTab('t1', { value: 'SELECT anio FROM t' });
  fakeHost.reset(tab);
  requestMock.mockReset();
  confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => confirmSpy.mockRestore());

async function askAndExecute(): Promise<void> {
  requestMock.mockResolvedValue(proposal);
  render(<SqlLabAssistantPanel />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'corregí la columna' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pedir propuesta' }));
  await screen.findByText('Propuesta · Corregir columna');
  fireEvent.click(screen.getByRole('button', { name: 'Ejecutar con confirmación' }));
  await screen.findByText('Ejecutando consulta…');
}

describe('correlación de eventos por queryId', () => {
  test('el éxito de otra consulta de la pestaña no cierra el aviso; el de la propia sí', async () => {
    await askAndExecute();

    act(() => fakeHost.querySuccess.fire({ clientId: 'manual-del-usuario' }, 't1'));
    expect(screen.getByText('Ejecutando consulta…')).toBeInTheDocument();
    expect(screen.queryByText('Consulta ejecutada correctamente.')).not.toBeInTheDocument();

    act(() => fakeHost.querySuccess.fire({ clientId: 'q-1' }, 't1'));
    expect(screen.queryByText('Ejecutando consulta…')).not.toBeInTheDocument();
    expect(screen.getByText('Consulta ejecutada correctamente.')).toBeInTheDocument();
  });

  test('un error de una consulta manual habilita "Corregir error" sin cerrar el aviso propio', async () => {
    await askAndExecute();

    act(() =>
      fakeHost.queryFail.fire({ clientId: 'manual', errorMessage: 'Unknown identifier anio', executedSql: 'SELECT anio' }, 't1'),
    );
    expect(screen.getByRole('button', { name: 'Corregir error' })).toBeInTheDocument();
    expect(screen.getByText('Ejecutando consulta…')).toBeInTheDocument();
  });

  test('Cancelar llama cancelQuery con el id propio y el evento stop cierra el aviso', async () => {
    await askAndExecute();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(fakeHost.cancelQuery).toHaveBeenCalledWith('q-1');

    act(() => fakeHost.queryStop.fire({ clientId: 'q-1' }, 't1'));
    expect(screen.queryByText('Ejecutando consulta…')).not.toBeInTheDocument();
  });
});

describe('cambio de pestaña', () => {
  test('limpia el aviso de ejecución y re-suscribe los eventos a la pestaña nueva', async () => {
    await askAndExecute();
    const tab2 = createFakeTab('t2');

    act(() => fakeHost.switchTo(tab2));
    expect(screen.queryByText('Ejecutando consulta…')).not.toBeInTheDocument();

    // Los eventos de la pestaña nueva llegan (antes del fix de la entrada 12
    // el panel quedaba escuchando solo la pestaña del montaje).
    act(() => fakeHost.queryFail.fire({ clientId: 'x', errorMessage: 'falla en t2', executedSql: null }, 't2'));
    expect(screen.getByText('falla en t2')).toBeInTheDocument();
    // Y no quedan listeners viejos colgados: success/fail/stop, uno de cada uno.
    expect(fakeHost.querySuccess.count()).toBe(1);
    expect(fakeHost.queryFail.count()).toBe(1);
    expect(fakeHost.queryStop.count()).toBe(1);
  });
});

describe('errores del backend del chat', () => {
  test('Permission denied se muestra una sola vez, sin reintentar', async () => {
    requestMock.mockRejectedValue(
      new AssistantBackendError('Permission denied: can_execute_sql_query on SQLLab for user test (tool: query_dataset)'),
    );
    render(<SqlLabAssistantPanel />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ventas por mes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pedir propuesta' }));

    await waitFor(() => expect(screen.getAllByText(/Permission denied/).length).toBeGreaterThan(0));
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(fakeHost.executeQuery).not.toHaveBeenCalled();
  });

  test('sin pestaña activa no llega a llamar al backend', async () => {
    fakeHost.reset(undefined);
    render(<SqlLabAssistantPanel />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hola' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pedir propuesta' }));
    await waitFor(() => expect(screen.getAllByText(/No hay una pestaña activa/).length).toBeGreaterThan(0));
    expect(requestMock).not.toHaveBeenCalled();
  });
});
