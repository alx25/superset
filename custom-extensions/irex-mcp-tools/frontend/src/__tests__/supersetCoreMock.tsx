/**
 * Doble de `@apache-superset/core` para Jest (ver jest.config.js). Reproduce
 * solo la superficie que usa la extensión y deja el estado bajo control de
 * cada test mediante `fakeHost`.
 *
 * Detalle que se respeta a propósito: igual que el host real, los eventos
 * de consulta (`onDidQuery*`) quedan atados a la pestaña activa EN EL
 * MOMENTO de suscribirse (ver `predicate` en
 * superset-frontend/src/core/sqlLab/index.ts). Sin esto no se podría probar
 * la re-suscripción al cambiar de pestaña.
 */
import React from 'react';

type Listener<T> = (event: T) => void;
interface Disposable {
  dispose: () => void;
}

interface ScopedListener<T> {
  tabId: string | undefined;
  listener: Listener<T>;
}

class Emitter<T> {
  private listeners: ScopedListener<T>[] = [];

  constructor(private readonly tabScoped: boolean) {}

  readonly event = (listener: Listener<T>): Disposable => {
    const entry: ScopedListener<T> = {
      tabId: this.tabScoped ? fakeHost.activeTab?.id : undefined,
      listener,
    };
    this.listeners.push(entry);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter(l => l !== entry);
      },
    };
  };

  /** Dispara el evento. Si es tab-scoped, solo llega a quien se suscribió
   * estando `tabId` activa. */
  fire(event: T, tabId?: string): void {
    this.listeners
      .filter(l => !this.tabScoped || l.tabId === tabId)
      .forEach(l => l.listener(event));
  }

  count(): number {
    return this.listeners.length;
  }

  clear(): void {
    this.listeners = [];
  }
}

export interface FakeEditorState {
  value: string;
  selectedText: string;
  cursor: { line: number; column: number };
}

function createFakeEditor(state: FakeEditorState) {
  return {
    state,
    getValue: jest.fn(() => state.value),
    getSelectedText: jest.fn(() => state.selectedText),
    getCursorPosition: jest.fn(() => state.cursor),
    // El host reemplaza la selección si la hay; si no, inserta en el cursor
    // (acá: al final, alcanza para los tests).
    insertText: jest.fn((text: string) => {
      state.value = state.selectedText ? state.value.replace(state.selectedText, text) : state.value + text;
      state.selectedText = '';
    }),
    setValue: jest.fn((text: string) => {
      state.value = text;
    }),
    setAnnotations: jest.fn(),
    clearAnnotations: jest.fn(),
    setSelection: jest.fn(),
    scrollToLine: jest.fn(),
    focus: jest.fn(),
  };
}

export type FakeEditor = ReturnType<typeof createFakeEditor>;

export interface FakeTab {
  id: string;
  title: string;
  databaseId: number;
  catalog: string | null;
  schema: string | null;
  editor: FakeEditor;
  getEditor: () => Promise<FakeEditor>;
}

export function createFakeTab(id: string, editorState: Partial<FakeEditorState> = {}): FakeTab {
  const editor = createFakeEditor({
    value: editorState.value ?? '',
    selectedText: editorState.selectedText ?? '',
    cursor: editorState.cursor ?? { line: 0, column: 0 },
  });
  return {
    id,
    title: `Pestaña ${id}`,
    databaseId: 3,
    catalog: null,
    schema: 'public',
    editor,
    getEditor: () => Promise.resolve(editor),
  };
}

let queryCounter = 0;

export const fakeHost = {
  activeTab: undefined as FakeTab | undefined,
  tabs: [] as FakeTab[],
  changeActiveTab: new Emitter<FakeTab>(false),
  querySuccess: new Emitter<{ clientId: string }>(true),
  queryFail: new Emitter<{ clientId: string; errorMessage: string; executedSql: string | null }>(true),
  queryStop: new Emitter<{ clientId: string }>(true),
  executeQuery: jest.fn((_options?: { sql?: string; limit?: number }) => {
    queryCounter += 1;
    return Promise.resolve(`q-${queryCounter}`);
  }),
  cancelQuery: jest.fn((_queryId: string) => Promise.resolve()),
  createTab: jest.fn((_options?: { sql?: string; title?: string }) => Promise.resolve()),

  reset(tab?: FakeTab): void {
    queryCounter = 0;
    this.activeTab = tab;
    this.tabs = tab ? [tab] : [];
    this.changeActiveTab.clear();
    this.querySuccess.clear();
    this.queryFail.clear();
    this.queryStop.clear();
    this.executeQuery.mockClear();
    this.cancelQuery.mockClear();
    this.createTab.mockClear();
  },

  /** Simula que el usuario activa otra pestaña. */
  switchTo(tab: FakeTab): void {
    if (this.tabs.indexOf(tab) === -1) this.tabs.push(tab);
    this.activeTab = tab;
    this.changeActiveTab.fire(tab);
  },
};

export const sqlLab = {
  getCurrentTab: () => fakeHost.activeTab,
  getTabs: () => fakeHost.tabs,
  createTab: (options?: { sql?: string; title?: string }) => fakeHost.createTab(options),
  executeQuery: (options?: { sql?: string; limit?: number }) => fakeHost.executeQuery(options),
  cancelQuery: (queryId: string) => fakeHost.cancelQuery(queryId),
  onDidChangeActiveTab: fakeHost.changeActiveTab.event,
  onDidQuerySuccess: fakeHost.querySuccess.event,
  onDidQueryFail: fakeHost.queryFail.event,
  onDidQueryStop: fakeHost.queryStop.event,
};

export const editors = {};

export const authentication = {
  getCSRFToken: jest.fn(() => Promise.resolve<string | undefined>('csrf-de-prueba')),
};

export const views = { registerView: jest.fn() };

interface AlertProps {
  message: React.ReactNode;
  type?: string;
  action?: React.ReactNode;
  showIcon?: boolean;
  closable?: boolean;
  onClose?: () => void;
}

export const components = {
  Alert: ({ message, type, action }: AlertProps) => (
    <div role="alert" data-type={type}>
      {message}
      {action}
    </div>
  ),
};

const TOKENS: Record<string, string | number> = {
  borderRadius: 6,
  borderRadiusSM: 4,
  colorBgContainer: '#fff',
  colorBorder: '#ddd',
  colorBorderSecondary: '#eee',
  colorError: '#c00',
  colorErrorBg: '#fee',
  colorErrorBorder: '#f99',
  colorErrorText: '#900',
  colorFillSecondary: '#f5f5f5',
  colorFillTertiary: '#fafafa',
  colorPrimary: '#1677ff',
  colorPrimaryBg: '#e6f4ff',
  colorPrimaryBorder: '#91caff',
  colorText: '#000',
  colorTextSecondary: '#555',
  colorTextTertiary: '#888',
  colorWarning: '#fa0',
  colorWarningBg: '#fffbe6',
  colorWarningBorder: '#ffe58f',
  colorWarningText: '#a60',
  colorWhite: '#fff',
};

// Contexto real de React: permite probar `exploreHost.tsx`, que envuelve su
// propia raíz en `<theme.ThemeProvider>` (no hereda el contexto del host —
// ver `themeBridge.ts`) sin necesitar la clase `Theme`/antd real.
const ThemeContext = React.createContext<Record<string, string | number>>(TOKENS);

export const theme = {
  useTheme: () => React.useContext(ThemeContext),
  ThemeProvider: ({ theme: value, children }: { theme: Record<string, string | number>; children: React.ReactNode }) => (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  ),
  // Fake mínimo: no reproduce el algoritmo real de antd (eso se prueba fuera
  // de Jest, ver la entrada 56 del Registro de cambios); solo permite
  // probar que `themeBridge.ts` LLAMA a `Theme.fromConfig(cfg).theme` con el
  // config esperado y usa lo que devuelve.
  Theme: {
    fromConfig: (cfg: { token?: Record<string, string | number> } | undefined) => ({
      theme: { ...TOKENS, ...(cfg?.token ?? {}) },
    }),
  },
};
