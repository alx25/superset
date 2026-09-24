/**
 * `jest.resetModules()`: `exploreHost` importa `routeObserver` a nivel de
 * módulo (singleton), así que cada test necesita su propia instancia — ver
 * el mismo criterio en `routeObserver.test.ts`.
 */
export {}; // Ver la nota equivalente en routeObserver.test.ts — evita que
// `load()` colisione (a nivel de tipos) con la de ese otro archivo.

type ExploreHostModule = typeof import('../hosts/exploreHost');
type ActFn = typeof import('react-dom/test-utils').act;

/** `act` tiene que venir del MISMO `require()` que `exploreHost` (después del
 * `jest.resetModules()` de `beforeEach`), no de un `import` estático de este
 * archivo cacheado antes del reset: si no, `act` termina atado a una copia de
 * `react-dom` distinta de la que usa `ReactDOM.render` dentro del módulo, y
 * ya no puede sincronizar el flush de sus `useEffect`. */
function loadAct(): ActFn {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  return (require('react-dom/test-utils') as typeof import('react-dom/test-utils')).act;
}

function load(): ExploreHostModule {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  return require('../hosts/exploreHost') as ExploreHostModule;
}

const WRAPPER_ID = 'irex-explore-dock-wrapper';
const MAIN_ID = 'irex-explore-dock-main';
const DOCK_ID = 'irex-explore-dock';
const RESIZER_ID = 'irex-explore-dock-resizer';
const TOGGLE_ID = 'irex-explore-dock-toggle';
const COLLAPSED_STORAGE_KEY = 'irex-explore-dock-collapsed';
const STYLE_ID = 'irex-explore-dock-style';
const WIDTH_STORAGE_KEY = 'irex-explore-dock-width';

// jsdom no implementa ResizeObserver — no lo necesita este módulo (el dock
// reserva espacio con flexbox, no mide nada), pero PanelHeader/otros
// componentes ya probados en el árbol de assistant/ pueden esperarlo.
class ResizeObserverStub {
  observe(): void {}

  disconnect(): void {}
}

beforeAll(() => {
  (window as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
});

// Ver la nota extensa en routeObserver.test.ts: sin este reset,
// `jest.resetModules()` deja `pushState`/`replaceState` envueltos en una
// capa nueva por cada test (el parche vive en `window.history`, que persiste
// entre tests del mismo archivo) — un test puede terminar reactivando el
// listener zombi de un test anterior.
const nativePushState = window.history.pushState.bind(window.history);
const nativeReplaceState = window.history.replaceState.bind(window.history);

beforeEach(() => {
  window.history.pushState = nativePushState;
  window.history.replaceState = nativeReplaceState;
  jest.resetModules();
  document.head.querySelector(`#${STYLE_ID}`)?.remove();
  // `#app` es requisito real: es lo que Superset siempre tiene en cualquier
  // página autenticada, y lo que `mount()` busca envolver (igual que el
  // dock del chat). Sin él, `mount()` se queda callado adrede (ver comentario
  // en exploreHost.tsx) — reproducir esa base en cada test.
  document.body.innerHTML = '<div id="app"><div id="app-content">contenido de Superset</div></div>';
  window.history.replaceState({}, '', '/dashboard/list/');
  try {
    window.localStorage.clear();
  } catch {
    // no-op: algunos entornos de test no exponen localStorage real.
  }
  // Montar ahora también dispara `resolveQueryFidelity` (fetch a
  // /api/v1/...). Default: 404 controlado — evita que Node (fetch nativo
  // desde 18) intente resolver la URL relativa de cualquier otra forma en
  // los tests de este archivo que no les importa la fidelidad y no mockean
  // `fetch` por su cuenta (la describe de "criterios de salida 1 y 2" pisa
  // este mock con uno más específico en su propio beforeEach).
  (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
});

describe('activateExploreHost — montaje según la ruta', () => {
  test('no monta nada en una superficie que no es Explore', () => {
    const { activateExploreHost, _isMountedForTests } = load();
    activateExploreHost();
    expect(_isMountedForTests()).toBe(false);
    expect(document.getElementById(DOCK_ID)).toBeNull();
    expect(document.getElementById('app')?.parentElement?.id).toBe(''); // #app sigue colgando directo del body
  });

  test('monta de entrada si ya se cargó dentro de /explore', () => {
    window.history.replaceState({}, '', '/explore/?slice_id=1');
    const { activateExploreHost, _isMountedForTests } = load();
    activateExploreHost();
    expect(_isMountedForTests()).toBe(true);
    const dock = document.getElementById(DOCK_ID);
    expect(dock).not.toBeNull();
    expect(dock?.textContent).toContain('Asistente de gráficos');
    // "Nueva sesión" ya funciona (ExploreAssistantPanel conectado al chat,
    // entrada 70) — antes no había conversación que vaciar y el botón no
    // se mostraba.
    expect(dock?.querySelector('[aria-label="Nueva sesión"]')).not.toBeNull();
  });

  test('monta al navegar a /explore y desmonta al salir, sin dejar nodos en el DOM', () => {
    const { activateExploreHost, _isMountedForTests } = load();
    activateExploreHost();
    expect(_isMountedForTests()).toBe(false);

    window.history.pushState({}, '', '/explore/?slice_id=7');
    expect(_isMountedForTests()).toBe(true);
    expect(document.getElementById(DOCK_ID)).not.toBeNull();

    window.history.pushState({}, '', '/dashboard/list/');
    expect(_isMountedForTests()).toBe(false);
    expect(document.getElementById(DOCK_ID)).toBeNull();
    expect(document.getElementById(WRAPPER_ID)).toBeNull();
  });

  test('ida y vuelta repetida no deja más de un dock ni falla al desmontar dos veces', () => {
    const { activateExploreHost, _isMountedForTests } = load();
    activateExploreHost();

    for (let i = 0; i < 3; i += 1) {
      window.history.pushState({}, '', '/explore/');
      window.history.pushState({}, '', '/sqllab/');
    }
    expect(_isMountedForTests()).toBe(false);
    expect(document.querySelectorAll(`#${DOCK_ID}`).length).toBe(0);
    expect(document.querySelectorAll(`#${WRAPPER_ID}`).length).toBe(0);
  });

  test('navegar dentro de /explore (otro gráfico) no remonta — un solo dock', () => {
    window.history.replaceState({}, '', '/explore/?slice_id=1');
    const { activateExploreHost, _isMountedForTests } = load();
    activateExploreHost();
    const first = document.getElementById(DOCK_ID);

    window.history.pushState({}, '', '/explore/?slice_id=2');
    expect(_isMountedForTests()).toBe(true);
    expect(document.getElementById(DOCK_ID)).toBe(first); // mismo nodo: no se desmontó/remontó
  });
});

describe('mount() reserva espacio envolviendo #app (mismo mecanismo que el dock del chat) — no lo tapa', () => {
  test('#app termina dentro de .../main, con el dock y el resizer como hermanos', () => {
    window.history.replaceState({}, '', '/explore/?slice_id=1');
    const { activateExploreHost } = load();
    activateExploreHost();

    const wrapperEl = document.getElementById(WRAPPER_ID);
    const mainEl = document.getElementById(MAIN_ID);
    const dockEl = document.getElementById(DOCK_ID);
    const resizerEl = document.getElementById(RESIZER_ID);
    expect(wrapperEl).not.toBeNull();
    expect(mainEl).not.toBeNull();
    expect(dockEl).not.toBeNull();
    expect(resizerEl).not.toBeNull();

    // #app sigue teniendo su contenido original: se movió como unidad, no se recreó.
    const app = document.getElementById('app');
    expect(app?.parentElement).toBe(mainEl);
    expect(app?.querySelector('#app-content')?.textContent).toBe('contenido de Superset');

    // orden en el DOM: main, luego resizer, luego dock — el dock a la derecha.
    expect(wrapperEl?.children[0]).toBe(mainEl);
    expect(wrapperEl?.children[1]).toBe(resizerEl);
    expect(wrapperEl?.children[2]).toBe(dockEl);

    // nada de position:fixed/absolute — el espacio es reservado, no superpuesto.
    expect(dockEl?.style.position).toBe('');
  });

  test('al desmontar, #app vuelve exactamente a su posición original (no un clon)', () => {
    document.body.innerHTML =
      '<div id="before-app">antes</div><div id="app"><div id="app-content">contenido de Superset</div></div><div id="after-app">después</div>';
    const { activateExploreHost } = load();
    activateExploreHost(); // superficie 'other': no monta todavía

    window.history.pushState({}, '', '/explore/?slice_id=1');
    expect(document.getElementById(WRAPPER_ID)).not.toBeNull();

    window.history.pushState({}, '', '/dashboard/list/');
    expect(document.getElementById(WRAPPER_ID)).toBeNull();

    // #app quedó exactamente donde estaba: entre #before-app y #after-app, hijo directo del body.
    const body = document.body;
    expect(Array.from(body.children).map(el => el.id)).toEqual(['before-app', 'app', 'after-app']);
    expect(document.getElementById('app')?.querySelector('#app-content')?.textContent).toBe('contenido de Superset');
  });

  test('sin #app en el DOM, no revienta: no monta nada', () => {
    document.body.innerHTML = '<div id="not-app"></div>';
    const { activateExploreHost, _isMountedForTests } = load();
    window.history.replaceState({}, '', '/explore/?slice_id=1');
    expect(() => activateExploreHost()).not.toThrow();
    expect(_isMountedForTests()).toBe(false);
    expect(document.getElementById(DOCK_ID)).toBeNull();
  });
});

describe('resize del dock — arrastrar el handle, con límites y persistencia (mismo patrón que el dock de chat)', () => {
  function mountInExplore(): { act: ActFn; dock: HTMLElement; resizer: HTMLElement } {
    window.history.replaceState({}, '', '/explore/?slice_id=1');
    const { activateExploreHost } = load();
    activateExploreHost();
    const dock = document.getElementById(DOCK_ID) as HTMLElement;
    const resizer = document.getElementById(RESIZER_ID) as HTMLElement;
    return { act: loadAct(), dock, resizer };
  }

  function drag(resizer: HTMLElement, fromX: number, toX: number): void {
    resizer.dispatchEvent(new MouseEvent('mousedown', { clientX: fromX, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: toX, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }

  test('arrastrar el handle hacia la izquierda agranda el dock', () => {
    const { dock, resizer } = mountInExplore();
    dock.getBoundingClientRect = () => ({ width: 400 } as DOMRect);

    drag(resizer, /* fromX */ 500, /* toX */ 400); // 100px hacia la izquierda → +100

    expect(dock.style.width).toBe('500px');
  });

  test('no se puede arrastrar por debajo del mínimo (380px)', () => {
    const { dock, resizer } = mountInExplore();
    dock.getBoundingClientRect = () => ({ width: 400 } as DOMRect);

    drag(resizer, /* fromX */ 400, /* toX */ 900); // 500px hacia la derecha → clamp a MIN_WIDTH

    expect(dock.style.width).toBe('380px');
  });

  test('no se puede arrastrar por encima del máximo (50% de la ventana)', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    const { dock, resizer } = mountInExplore();
    dock.getBoundingClientRect = () => ({ width: 400 } as DOMRect);

    drag(resizer, /* fromX */ 900, /* toX */ 0); // 900px hacia la izquierda → clamp a 50vw = 500

    expect(dock.style.width).toBe('500px');
  });

  test('el ancho elegido se guarda en localStorage y se reusa en el próximo montaje', () => {
    const { dock, resizer } = mountInExplore();
    dock.getBoundingClientRect = () => ({ width: 400 } as DOMRect);
    drag(resizer, 500, 420); // +80 → 480px

    expect(window.localStorage.getItem(WIDTH_STORAGE_KEY)).toBe('480');

    // "recargar": vuelve a /dashboard/list/ (desmonta), módulo nuevo, vuelve a /explore/.
    window.history.pushState({}, '', '/dashboard/list/');
    jest.resetModules();
    window.history.replaceState({}, '', '/explore/?slice_id=1');
    const { activateExploreHost } = load();
    activateExploreHost();

    expect((document.getElementById(DOCK_ID) as HTMLElement).style.width).toBe('480px');
  });

  test('al desmontar, arrastrar ya no mueve nada (los listeners de window se limpiaron)', async () => {
    const { act, dock, resizer } = mountInExplore();
    dock.getBoundingClientRect = () => ({ width: 400 } as DOMRect);

    await act(async () => {
      window.history.pushState({}, '', '/dashboard/list/'); // desmonta
    });

    // el nodo `dock` ya no está en el DOM, pero conservamos la referencia
    // para confirmar que sus listeners realmente se soltaron.
    expect(() => drag(resizer, 500, 400)).not.toThrow();
    expect(dock.style.width).not.toBe('500px'); // no se aplicó: el listener de mousemove ya no existe
  });
});

describe('botón de plegar/desplegar el panel', () => {
  function mountInExplore(): { dock: HTMLElement; toggle: HTMLButtonElement } {
    window.history.replaceState({}, '', '/explore/?slice_id=1');
    const { activateExploreHost } = load();
    activateExploreHost();
    return {
      dock: document.getElementById(DOCK_ID) as HTMLElement,
      toggle: document.getElementById(TOGGLE_ID) as HTMLButtonElement,
    };
  }

  test('empieza desplegado con el ancho por defecto, con aria-label de "ocultar"', () => {
    const { dock, toggle } = mountInExplore();
    expect(parseInt(dock.style.width, 10)).toBeGreaterThanOrEqual(380);
    expect(toggle.getAttribute('aria-label')).toBe('Ocultar panel del asistente');
  });

  test('un click pliega el panel a 0 sin perder el ancho elegido; otro click lo restaura', () => {
    const { dock, toggle } = mountInExplore();
    const original = dock.style.width;

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dock.style.width).toBe('0px');
    expect(toggle.getAttribute('aria-label')).toBe('Mostrar panel del asistente');

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dock.style.width).toBe(original); // el mismo ancho de antes, no el default recalculado
  });

  test('plegar no borra el contenido del panel: solo cambia el ancho (el resto lo hace CSS)', () => {
    const { dock, toggle } = mountInExplore();
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dock.textContent).toContain('Asistente de gráficos'); // sigue montado, solo con ancho 0
  });

  test('con el panel plegado, arrastrar el resizer no hace nada', () => {
    const { dock, toggle } = mountInExplore();
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const resizer = document.getElementById(RESIZER_ID) as HTMLElement;
    dock.getBoundingClientRect = () => ({ width: 0 } as DOMRect);

    resizer.dispatchEvent(new MouseEvent('mousedown', { clientX: 500, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(dock.style.width).toBe('0px'); // seguía plegado: el drag no lo movió
  });

  test('el estado plegado persiste en localStorage y se reusa en el próximo montaje', () => {
    const { toggle } = mountInExplore();
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(window.localStorage.getItem(COLLAPSED_STORAGE_KEY)).toBe('1');

    window.history.pushState({}, '', '/dashboard/list/');
    jest.resetModules();
    window.history.replaceState({}, '', '/explore/?slice_id=1');
    const { activateExploreHost } = load();
    activateExploreHost();

    expect((document.getElementById(DOCK_ID) as HTMLElement).style.width).toBe('0px');
    expect((document.getElementById(TOGGLE_ID) as HTMLButtonElement).getAttribute('aria-label')).toBe('Mostrar panel del asistente');
  });
});

describe('el tema se deriva del bootstrap del host, no de position:fixed', () => {
  test('el contenido del panel se renderiza y usa PanelHeader (humo, ya cubierto en detalle por themeBridge.test.ts)', () => {
    window.history.replaceState({}, '', '/explore/?slice_id=1');
    const { activateExploreHost } = load();
    activateExploreHost();
    expect(document.getElementById(DOCK_ID)?.textContent).toContain('Asistente de gráficos');
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
}

describe('criterios de salida 1 y 2 de la Fase 0 (exploreState.ts) integrados en el panel', () => {
  let fetchMock: jest.Mock<Promise<Response>, [string, RequestInit]>;

  beforeEach(() => {
    fetchMock = jest.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/v1/chart/')) {
        return Promise.resolve(
          jsonResponse(200, {
            result: { viz_type: 'table', params: JSON.stringify({ viz_type: 'table' }), query_context: '{"saved":true}' },
          }),
        );
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
  });

  test('siempre muestra el contrato del estado guardado por Explore, incluso mientras resuelve', async () => {
    window.history.replaceState({}, '', '/explore/?slice_id=1');
    const { activateExploreHost } = load();
    const act = loadAct();
    await act(async () => {
      activateExploreHost();
      await Promise.resolve();
    });
    expect(document.getElementById(DOCK_ID)?.textContent).toContain('Leo el último estado que Explore guardó en la URL');
  });

  test('gráfico guardado sin form_data_key: resuelve a "SQL fiel disponible"', async () => {
    window.history.replaceState({}, '', '/explore/?slice_id=1');
    const { activateExploreHost } = load();
    const act = loadAct();

    await act(async () => {
      activateExploreHost();
      await Promise.resolve(); // deja correr el .then() del fetch mockeado (resuelve en un microtask)
    });

    const status = document.querySelector('[data-testid="irex-explore-fidelity"]');
    expect(status?.textContent).toBe('SQL fiel disponible (table).');
  });

  test('gráfico nuevo sin slice_id: resuelve a "no disponible" sin llamar a la red', async () => {
    window.history.replaceState({}, '', '/explore/');
    const { activateExploreHost } = load();
    const act = loadAct();

    await act(async () => {
      activateExploreHost();
      await Promise.resolve();
    });

    const status = document.querySelector('[data-testid="irex-explore-fidelity"]');
    expect(status?.textContent).toContain('SQL/vista previa no disponible');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('ignora la respuesta pendiente del gráfico anterior al cambiar de URL', async () => {
    let releaseFirst: (response: Response) => void = () => {};
    const firstResponse = new Promise<Response>(resolve => {
      releaseFirst = resolve;
    });
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/v1/chart/1') return firstResponse;
      return Promise.resolve(jsonResponse(200, {
        result: { viz_type: 'table', params: '{}', query_context: '{"second":true}' },
      }));
    });
    window.history.replaceState({}, '', '/explore/?slice_id=1');
    const { activateExploreHost } = load();
    const act = loadAct();

    await act(async () => {
      activateExploreHost();
      await Promise.resolve();
    });
    await act(async () => {
      window.history.pushState({}, '', '/explore/?slice_id=2');
      releaseFirst(jsonResponse(200, {
        result: { viz_type: 'bar', params: '{}', query_context: '{"first":true}' },
      }));
      await Promise.resolve();
    });
    expect(document.querySelector('[data-testid="irex-explore-fidelity"]')?.textContent).toContain('Comprobando');

    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 450));
    });
    expect(document.querySelector('[data-testid="irex-explore-fidelity"]')?.textContent).toBe('SQL fiel disponible (table).');
  });

  test('el panel actualiza la fidelidad al observar el query_context enviado por Explore', async () => {
    const current = { slice_id: 7, datasource: '1__table', viz_type: 'table', metrics: ['count'] };
    const queryContext = {
      datasource: { id: 1, type: 'table' },
      result_type: 'full',
      result_format: 'json',
      queries: [{ metrics: ['count'] }],
      form_data: { ...current, force: false, result_format: 'json', result_type: 'full' },
    };
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/v1/chart/data') return Promise.resolve(jsonResponse(200, {}));
      if (url === '/api/v1/chart/7') {
        return Promise.resolve(jsonResponse(200, {
          result: { viz_type: 'table', params: '{"viz_type":"table"}', query_context: '{"saved":true}' },
        }));
      }
      return Promise.resolve(jsonResponse(200, { form_data: JSON.stringify(current) }));
    });
    window.history.replaceState({}, '', '/explore/?slice_id=7&form_data_key=abc');
    const { activateExploreHost } = load();
    const act = loadAct();
    await act(async () => {
      activateExploreHost();
      await Promise.resolve();
    });
    expect(document.querySelector('[data-testid="irex-explore-fidelity"]')?.textContent).toContain('No se pudo verificar');

    await act(async () => {
      await window.fetch('/api/v1/chart/data', { method: 'POST', body: JSON.stringify(queryContext) });
      await Promise.resolve();
    });
    expect(document.querySelector('[data-testid="irex-explore-fidelity"]')?.textContent).toBe(
      'SQL del estado ejecutado disponible (table).',
    );
  });

  test('cambiar de slice_id sin salir de /explore vuelve a resolver (onDidChangeLocation, no onDidChangeSurface)', async () => {
    window.history.replaceState({}, '', '/explore/');
    const { activateExploreHost } = load();
    const act = loadAct();

    await act(async () => {
      activateExploreHost();
      await Promise.resolve();
    });
    expect(document.querySelector('[data-testid="irex-explore-fidelity"]')?.textContent).toContain('no disponible');

    await act(async () => {
      window.history.pushState({}, '', '/explore/?slice_id=1'); // sigue en 'explore': onDidChangeSurface no dispara
      await new Promise(resolve => {
        window.setTimeout(resolve, 450); // > RESOLVE_DEBOUNCE_MS (400ms)
      });
    });

    expect(document.querySelector('[data-testid="irex-explore-fidelity"]')?.textContent).toBe('SQL fiel disponible (table).');
  });
});
