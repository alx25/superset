import {
  computeCurrentTheme,
  isDarkMode,
  onDidChangeTheme,
  readBootstrapThemeConfig,
  selectThemeConfig,
} from '../hosts/themeBridge';

/** Igual al `common.theme` real verificado contra la app de test
 * (2026-09-24, PLAN_COPILOTO_EXPLORE.md Fase 0): `{algorithm, token}` con
 * `algorithm` serializado como string, presente e idéntico en /explore/,
 * /sqllab/ y /superset/welcome/. */
function appWithBootstrap(theme: unknown): void {
  document.body.innerHTML = '';
  const app = document.createElement('div');
  app.id = 'app';
  app.setAttribute('data-bootstrap', JSON.stringify({ common: { theme } }));
  document.body.appendChild(app);
}

afterEach(() => {
  document.body.innerHTML = '';
  window.localStorage.clear();
});

describe('readBootstrapThemeConfig', () => {
  test('lee y parsea common.theme del nodo #app', () => {
    appWithBootstrap({ default: { algorithm: 'default', token: { colorPrimary: '#123456' } }, dark: {} });
    expect(readBootstrapThemeConfig()).toEqual({
      default: { algorithm: 'default', token: { colorPrimary: '#123456' } },
      dark: {},
    });
  });

  test('sin #app, sin atributo, o JSON roto: undefined (nunca lanza)', () => {
    document.body.innerHTML = '';
    expect(readBootstrapThemeConfig()).toBeUndefined();

    const app = document.createElement('div');
    app.id = 'app';
    document.body.appendChild(app);
    expect(readBootstrapThemeConfig()).toBeUndefined();

    app.setAttribute('data-bootstrap', '{esto no es json');
    expect(readBootstrapThemeConfig()).toBeUndefined();
  });
});

describe('isDarkMode', () => {
  test.each([
    ['dark', true],
    ['default', false],
  ] as const)('localStorage=%s -> %s', (stored, expected) => {
    window.localStorage.setItem('superset-theme-mode', stored);
    expect(isDarkMode()).toBe(expected);
  });

  test('sin valor guardado, o "system": sigue la preferencia del SO', () => {
    const matchMedia = jest.fn().mockReturnValue({ matches: true });
    Object.defineProperty(window, 'matchMedia', { value: matchMedia, configurable: true });

    expect(isDarkMode()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');

    window.localStorage.setItem('superset-theme-mode', 'system');
    expect(isDarkMode()).toBe(true);
  });

  test('sin matchMedia disponible: no lanza, asume claro', () => {
    // `Object.defineProperty(window, 'matchMedia', { value: undefined })` no
    // alcanza: jsdom conserva el valor anterior (verificado). `delete` sí
    // quita la propiedad de verdad.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).matchMedia;
    expect(isDarkMode()).toBe(false);
  });
});

describe('selectThemeConfig', () => {
  const bootstrap = { default: { token: { colorPrimary: 'light' } }, dark: { token: { colorPrimary: 'dark' } } };
  test('elige default u dark según el modo', () => {
    expect(selectThemeConfig(bootstrap, false)).toEqual({ token: { colorPrimary: 'light' } });
    expect(selectThemeConfig(bootstrap, true)).toEqual({ token: { colorPrimary: 'dark' } });
  });
  test('sin bootstrap: undefined', () => {
    expect(selectThemeConfig(undefined, false)).toBeUndefined();
  });
});

describe('computeCurrentTheme', () => {
  test('deriva el theme con Theme.fromConfig(cfg) del modo actual (mock: token gana sobre TOKENS)', () => {
    window.localStorage.setItem('superset-theme-mode', 'dark');
    appWithBootstrap({ default: { token: { colorPrimary: '#claro' } }, dark: { token: { colorPrimary: '#oscuro' } } });
    expect(computeCurrentTheme()?.colorPrimary).toBe('#oscuro');
  });

  test('sin bootstrap disponible: undefined (el llamador usa su propio fallback)', () => {
    document.body.innerHTML = '';
    expect(computeCurrentTheme()).toBeUndefined();
  });
});

describe('onDidChangeTheme', () => {
  test('se dispara con el evento del proyecto y se puede desuscribir', () => {
    const calls: number[] = [];
    const sub = onDidChangeTheme(() => calls.push(1));
    window.dispatchEvent(new CustomEvent('superset-agent:theme-change'));
    sub.dispose();
    window.dispatchEvent(new CustomEvent('superset-agent:theme-change'));
    expect(calls).toEqual([1]);
  });
});
