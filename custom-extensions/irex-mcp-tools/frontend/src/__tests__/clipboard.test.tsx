import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { copyText } from '../assistant/clipboard';
import { PanelHeader } from '../assistant/PanelHeader';

type Mutable = { isSecureContext?: boolean; clipboard?: unknown; execCommand?: unknown };
const win = window as unknown as Mutable;
const nav = navigator as unknown as Mutable;
const doc = document as unknown as Mutable;

let copiedValue: string | undefined;
let execCommand: jest.Mock;

// jsdom ignora en silencio redefinir `isSecureContext` una vez fijado como
// valor no escribible: se define UNA vez con getters que leen estas variables.
let secureContext = false;
let clipboardApi: { writeText: jest.Mock } | undefined;
Object.defineProperty(win, 'isSecureContext', { configurable: true, get: () => secureContext });
Object.defineProperty(nav, 'clipboard', { configurable: true, get: () => clipboardApi });

function setContext({ secure, clipboard }: { secure: boolean; clipboard?: { writeText: jest.Mock } }) {
  secureContext = secure;
  clipboardApi = clipboard;
}

beforeEach(() => {
  copiedValue = undefined;
  execCommand = jest.fn((command: string) => {
    const active = document.activeElement as HTMLTextAreaElement | null;
    if (command === 'copy' && active?.tagName === 'TEXTAREA') copiedValue = active.value;
    return command === 'copy';
  });
  Object.defineProperty(doc, 'execCommand', { value: execCommand, configurable: true, writable: true });
});

describe('copyText', () => {
  test('sin contexto seguro (HTTP, caso real de test/prod): usa el método clásico', async () => {
    setContext({ secure: false, clipboard: undefined });
    await expect(copyText('sqllab-abc')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(copiedValue).toBe('sqllab-abc');
    expect(document.querySelector('textarea')).toBeNull();
  });

  test('con contexto seguro usa la API moderna', async () => {
    const writeText = jest.fn(() => Promise.resolve());
    setContext({ secure: true, clipboard: { writeText } });
    await expect(copyText('SELECT 1')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('SELECT 1');
    expect(execCommand).not.toHaveBeenCalled();
  });

  test('si la API moderna falla, cae al método clásico', async () => {
    const writeText = jest.fn(() => Promise.reject(new Error('denegado')));
    setContext({ secure: true, clipboard: { writeText } });
    await expect(copyText('SELECT 2')).resolves.toBe(true);
    expect(copiedValue).toBe('SELECT 2');
  });

  test('si nada funciona devuelve false (no falla en silencio)', async () => {
    setContext({ secure: false, clipboard: undefined });
    execCommand.mockImplementation(() => false);
    await expect(copyText('x')).resolves.toBe(false);
  });
});

describe('botón de copiar id de sesión', () => {
  test('copia por HTTP y lo confirma', async () => {
    setContext({ secure: false, clipboard: undefined });
    render(<PanelHeader sessionId="sqllab-123" onNewSession={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar id de sesión' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copiado'));
    expect(copiedValue).toBe('sqllab-123');
  });

  test('si no puede copiar, lo dice', async () => {
    setContext({ secure: false, clipboard: undefined });
    execCommand.mockImplementation(() => false);
    render(<PanelHeader sessionId="sqllab-123" onNewSession={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar id de sesión' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No se pudo copiar'));
  });
});
