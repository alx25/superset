/**
 * `jest.resetModules()` en cada test: `routeObserver` es un singleton por
 * módulo (un solo listener global instalado una vez), así que cada test
 * necesita su propia instancia para no arrastrar el `history.pushState`
 * parcheado ni los suscriptores del test anterior.
 */
export {}; // Sin esto, tsc trata el archivo como script global (sin `import`/
// `export` real a nivel de módulo) y su `load()` colisiona con la de
// `exploreHost.test.tsx` — el `typeof import(...)` de abajo es solo un tipo,
// no cuenta como import real para esa clasificación.

type RouteObserverModule = typeof import('../hosts/routeObserver');

function load(): RouteObserverModule {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  return require('../hosts/routeObserver') as RouteObserverModule;
}

// Ver la nota equivalente y más extensa en exploreHost.test.tsx: sin esto,
// `jest.resetModules()` deja los `pushState`/`replaceState` reales envueltos
// en una capa nueva por cada test (el parche vive en `window.history`, que
// persiste entre tests del mismo archivo; `_resetForTests()` no lo deshace).
// Acá no rompe ninguna aserción (cada test solo mira su propio array local),
// pero sin este reset cada `pushState` dispara también los listeners zombis
// de los tests anteriores — trabajo de más y un supuesto frágil.
const nativePushState = window.history.pushState.bind(window.history);
const nativeReplaceState = window.history.replaceState.bind(window.history);

beforeEach(() => {
  window.history.pushState = nativePushState;
  window.history.replaceState = nativeReplaceState;
  jest.resetModules();
  window.history.replaceState({}, '', '/');
});

describe('getSurface — detección inicial por pathname', () => {
  test.each([
    ['/explore/?slice_id=1', 'explore'],
    ['/explore', 'explore'],
    ['/sqllab/', 'sqllab'],
    ['/sqllab', 'sqllab'],
    ['/dashboard/list/', 'other'],
    ['/superset/welcome/', 'other'],
  ] as const)('%s → %s', (path, expected) => {
    window.history.replaceState({}, '', path);
    expect(load().getSurface()).toBe(expected);
  });
});

describe('onDidChangeSurface — navegación dentro de la SPA', () => {
  test('pushState/replaceState notifican solo cuando la superficie cambia', () => {
    window.history.replaceState({}, '', '/dashboard/list/');
    const { getSurface, onDidChangeSurface } = load();
    expect(getSurface()).toBe('other');

    const seen: string[] = [];
    const sub = onDidChangeSurface(s => seen.push(s));

    window.history.pushState({}, '', '/explore/?slice_id=1');
    window.history.pushState({}, '', '/explore/?slice_id=2'); // sigue en 'explore': sin notificación nueva
    window.history.replaceState({}, '', '/sqllab/');
    sub.dispose();
    window.history.pushState({}, '', '/dashboard/list/'); // ya sin suscripción

    expect(seen).toEqual(['explore', 'sqllab']);
  });

  test('popstate (atrás/adelante del navegador) también notifica', async () => {
    window.history.replaceState({}, '', '/dashboard/list/');
    const { getSurface, onDidChangeSurface } = load();
    getSurface();

    const seen: string[] = [];
    onDidChangeSurface(s => seen.push(s));

    window.history.pushState({}, '', '/explore/');
    window.history.back(); // jsdom mantiene un stack real: vuelve a /dashboard/list/ y dispara popstate
    // jsdom despacha `popstate` de forma asíncrona (a diferencia de pushState).
    await new Promise(resolve => {
      window.addEventListener('popstate', resolve, { once: true });
    });

    expect(seen).toEqual(['explore', 'other']);
  });

  test('dos suscriptores reciben el mismo cambio; solo se desinstala el que se dispose()', () => {
    window.history.replaceState({}, '', '/');
    const { onDidChangeSurface } = load();
    const a: string[] = [];
    const b: string[] = [];
    const subA = onDidChangeSurface(s => a.push(s));
    onDidChangeSurface(s => b.push(s));

    window.history.pushState({}, '', '/sqllab/');
    subA.dispose();
    window.history.pushState({}, '', '/explore/');

    expect(a).toEqual(['sqllab']);
    expect(b).toEqual(['sqllab', 'explore']);
  });
});

describe('onDidChangeLocation — cada cambio de URL, cambie o no la superficie', () => {
  test('notifica también dentro de la MISMA superficie (otro slice_id, otra form_data_key)', () => {
    window.history.replaceState({}, '', '/explore/?slice_id=1');
    const { onDidChangeLocation } = load();
    let count = 0;
    onDidChangeLocation(() => {
      count += 1;
    });

    window.history.pushState({}, '', '/explore/?slice_id=2');
    window.history.replaceState({}, '', '/explore/?slice_id=2&form_data_key=abc');

    expect(count).toBe(2); // onDidChangeSurface no habría disparado ninguna de las dos
  });

  test('también notifica cuando SÍ cambia la superficie (no es mutuamente excluyente con onDidChangeSurface)', () => {
    window.history.replaceState({}, '', '/dashboard/list/');
    const { onDidChangeLocation, onDidChangeSurface } = load();
    const locationHits: number[] = [];
    const surfaceHits: string[] = [];
    onDidChangeLocation(() => locationHits.push(1));
    onDidChangeSurface(s => surfaceHits.push(s));

    window.history.pushState({}, '', '/explore/?slice_id=1');

    expect(locationHits).toEqual([1]);
    expect(surfaceHits).toEqual(['explore']);
  });

  test('dispose() deja de notificar', () => {
    window.history.replaceState({}, '', '/explore/?slice_id=1');
    const { onDidChangeLocation } = load();
    const seen: number[] = [];
    const sub = onDidChangeLocation(() => seen.push(1));

    window.history.pushState({}, '', '/explore/?slice_id=2');
    sub.dispose();
    window.history.pushState({}, '', '/explore/?slice_id=3');

    expect(seen).toEqual([1]);
  });
});
