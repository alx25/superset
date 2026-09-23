import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createFakeTab, fakeHost } from './supersetCoreMock';
import { ActionCard } from '../assistant/SqlLabAssistantPanel';
import type { AssistantAction, AssistantContext } from '../contracts/assistant';

const context: AssistantContext = {
  contractVersion: 1,
  source: 'superset_sqllab',
  mode: 'review_document',
  userMessage: '',
  tab: { id: 't1', title: 'Pestaña t1', databaseId: 3, catalog: null, schema: 'public' },
  editor: { sql: 'SELECT anio FROM t', selectedSql: '', cursor: { line: 0, column: 0 } },
};

function renderCard(action: AssistantAction) {
  const props = { onDismiss: jest.fn(), onExecuted: jest.fn(), onApplied: jest.fn() };
  render(<ActionCard action={action} context={context} {...props} />);
  return props;
}

let confirmSpy: jest.SpyInstance<boolean, [message?: string]>;
let tab: ReturnType<typeof createFakeTab>;

beforeEach(() => {
  tab = createFakeTab('t1', { value: 'SELECT anio FROM t' });
  fakeHost.reset(tab);
  confirmSpy = jest.spyOn(window, 'confirm');
});

afterEach(() => {
  confirmSpy.mockRestore();
});

describe('confirmación obligatoria antes de ejecutar', () => {
  const readAction: AssistantAction = { type: 'propose_sql', target: 'document', sql: 'SELECT anio_id FROM t', title: 'Fix' };

  test('si el usuario cancela el confirm, no se ejecuta nada', () => {
    confirmSpy.mockReturnValue(false);
    const props = renderCard(readAction);
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar con confirmación' }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toContain('máximo 1000 filas');
    expect(fakeHost.executeQuery).not.toHaveBeenCalled();
    expect(props.onExecuted).not.toHaveBeenCalled();
  });

  test('si confirma, ejecuta el SQL exacto con límite y avisa el queryId', async () => {
    confirmSpy.mockReturnValue(true);
    const props = renderCard(readAction);
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar con confirmación' }));
    await waitFor(() => expect(props.onExecuted).toHaveBeenCalledWith('q-1'));
    expect(fakeHost.executeQuery).toHaveBeenCalledWith({ sql: 'SELECT anio_id FROM t', limit: 1000 });
    // Ejecutar no aplica ni descarta la propuesta (entrada 27 del registro).
    expect(tab.editor.setValue).not.toHaveBeenCalled();
    expect(props.onDismiss).not.toHaveBeenCalled();
  });

  test('replace_selection e insert_sql no ofrecen ejecutar (pueden ser fragmentos)', () => {
    renderCard({ type: 'replace_selection', sql: 'anio_id' });
    expect(screen.queryByRole('button', { name: 'Ejecutar con confirmación' })).not.toBeInTheDocument();
  });
});

describe('confirmación reforzada para DDL/DML', () => {
  const writeAction: AssistantAction = { type: 'suggest_execution', sql: 'DELETE FROM t WHERE anio < 2000' };

  test('no usa window.confirm y exige escribir EJECUTAR', async () => {
    const props = renderCard(writeAction);
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar con confirmación' }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Este SQL puede modificar datos o estructura')).toBeInTheDocument();
    expect(screen.getByText(/DELETE/, { selector: 'li' })).toBeInTheDocument();

    const runButton = screen.getByRole('button', { name: 'Ejecutar de todos modos' });
    expect(runButton).toBeDisabled();

    const input = screen.getByLabelText('Escribí EJECUTAR para confirmar');
    fireEvent.change(input, { target: { value: 'ejecuta' } });
    expect(runButton).toBeDisabled();
    expect(fakeHost.executeQuery).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'ejecutar' } });
    expect(runButton).toBeEnabled();
    fireEvent.click(runButton);

    await waitFor(() => expect(props.onExecuted).toHaveBeenCalledWith('q-1'));
    expect(fakeHost.executeQuery).toHaveBeenCalledWith({ sql: 'DELETE FROM t WHERE anio < 2000', limit: 1000 });
    expect(screen.queryByText('Este SQL puede modificar datos o estructura')).not.toBeInTheDocument();
  });

  test('Cancelar cierra el bloque sin ejecutar', () => {
    renderCard(writeAction);
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar con confirmación' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByText('Este SQL puede modificar datos o estructura')).not.toBeInTheDocument();
    expect(fakeHost.executeQuery).not.toHaveBeenCalled();
  });
});

describe('diff y aplicación', () => {
  test('muestra el diff contra el documento antes de aplicar', () => {
    renderCard({ type: 'replace_document', sql: 'SELECT anio_id FROM t' });
    const diffLine = (text: string) =>
      screen.getByText((_content, element) => element?.tagName === 'DIV' && element.textContent === text);
    expect(diffLine('- SELECT anio FROM t')).toBeInTheDocument();
    expect(diffLine('+ SELECT anio_id FROM t')).toBeInTheDocument();
    expect(tab.editor.setValue).not.toHaveBeenCalled();
  });

  test('Aplicar cambio sobre el documento guarda snapshot para deshacer y descarta la tarjeta', async () => {
    const props = renderCard({ type: 'replace_document', sql: 'SELECT anio_id FROM t' });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar al editor' }));
    await waitFor(() => expect(props.onDismiss).toHaveBeenCalled());
    expect(tab.editor.setValue).toHaveBeenCalledWith('SELECT anio_id FROM t');
    expect(props.onApplied).toHaveBeenCalledWith({
      before: 'SELECT anio FROM t',
      after: 'SELECT anio_id FROM t',
      tabTitle: 'Pestaña t1',
    });
    expect(fakeHost.executeQuery).not.toHaveBeenCalled();
  });

  test('propose_sql con target newTab abre una pestaña nueva y no hay nada que deshacer', async () => {
    const props = renderCard({ type: 'propose_sql', target: 'newTab', sql: 'SELECT 9', title: 'Otra' });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir en nueva pestaña' }));
    await waitFor(() => expect(fakeHost.createTab).toHaveBeenCalledWith({ sql: 'SELECT 9', title: 'Otra' }));
    expect(props.onApplied).not.toHaveBeenCalled();
  });
});

describe('copiar el SQL propuesto', () => {
  test('funciona sin contexto seguro (HTTP) y confirma "Copiado"', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    let copied: string | undefined;
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      writable: true,
      value: jest.fn(() => {
        copied = (document.activeElement as HTMLTextAreaElement).value;
        return true;
      }),
    });
    renderCard({ type: 'replace_document', sql: 'SELECT anio_id FROM t' });
    fireEvent.click(screen.getByRole('button', { name: 'Copiar SQL propuesto' }));
    await screen.findByText('Copiado');
    expect(copied).toBe('SELECT anio_id FROM t');
  });
});
