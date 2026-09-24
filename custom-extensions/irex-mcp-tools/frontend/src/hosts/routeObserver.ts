/**
 * Observador de ruta para montar/ocultar UI de la extensión según la
 * página actual de Superset (SPA con navegación por `pushState`).
 *
 * Mismo mecanismo, en TypeScript, que ya usa el inline `<script>` de
 * `custom-src/login/mcp_widget.py` para ocultar "El Don" en `/sqllab`
 * (Registro de cambios, entrada 50): Superset no dispara un evento propio
 * de cambio de ruta accesible desde una extensión en 6.1 (no hay
 * `navigation.onDidChangePage` — eso llega en `master`), así que hay que
 * envolver `history.pushState`/`replaceState` y escuchar `popstate`.
 *
 * Un solo listener global por proceso: cada llamador se suscribe a
 * `onDidChangeSurface`, no reenvuelve `history` de nuevo (envolverlo dos
 * veces duplicaría los eventos).
 */

export type Surface = 'explore' | 'sqllab' | 'other';

function surfaceOf(pathname: string): Surface {
  if (/^\/explore\/?/.test(pathname)) return 'explore';
  if (/^\/sqllab\/?/.test(pathname)) return 'sqllab';
  return 'other';
}

type Listener = (surface: Surface) => void;
type LocationListener = () => void;

let installed = false;
let current: Surface = 'other';
const listeners = new Set<Listener>();
const locationListeners = new Set<LocationListener>();

function notify(): void {
  // `locationListeners` se avisa SIEMPRE (cambió la URL, aunque la
  // superficie siga siendo 'explore' — ej. otro `slice_id`, una
  // `form_data_key` nueva tras ejecutar). `listeners` (superficie) solo
  // cuando cambia 'explore'/'sqllab'/'other' — ver el criterio de "no
  // remonta" ya probado en exploreHost.test.tsx.
  locationListeners.forEach(listener => listener());
  const next = surfaceOf(window.location.pathname);
  if (next === current) return;
  current = next;
  listeners.forEach(listener => listener(current));
}

function install(): void {
  if (installed) return;
  installed = true;
  current = surfaceOf(window.location.pathname);

  (['pushState', 'replaceState'] as const).forEach(name => {
    // `pushState`/`replaceState` tienen la misma firma real (state, unused,
    // url?); tipar por unión de sobrecargas confunde a `Parameters<>` con un
    // spread. `unknown[]` + spread es seguro: solo reenviamos los argumentos.
    const original = window.history[name].bind(window.history) as (...args: unknown[]) => void;
    window.history[name] = function patched(this: History, ...args: unknown[]) {
      original(...args);
      notify();
    } as History[typeof name];
  });
  window.addEventListener('popstate', notify);
}

/** Superficie actual ('explore' | 'sqllab' | 'other'). */
export function getSurface(): Surface {
  install();
  return current;
}

/** Se llama con la superficie nueva cada vez que cambia. No dispara para el
 * valor inicial: leerlo con `getSurface()` antes de suscribirse. */
export function onDidChangeSurface(listener: Listener): { dispose: () => void } {
  install();
  listeners.add(listener);
  return { dispose: () => listeners.delete(listener) };
}

/** Se llama con CADA cambio de URL (`pushState`/`replaceState`/`popstate`),
 * cambie o no la superficie — a diferencia de `onDidChangeSurface`. Lo
 * necesita el copiloto de Explore (criterios de salida 1 y 2 de la Fase 0
 * de `PLAN_COPILOTO_EXPLORE.md`) para reaccionar a un cambio de `slice_id`
 * o de `form_data_key` sin salir de `/explore`. */
export function onDidChangeLocation(listener: LocationListener): { dispose: () => void } {
  install();
  locationListeners.add(listener);
  return { dispose: () => locationListeners.delete(listener) };
}

/** Solo para tests: vuelve al estado sin instalar (permite reinstalar con un
 * `window.location`/`window.history` nuevos por test). */
export function _resetForTests(): void {
  installed = false;
  listeners.clear();
  locationListeners.clear();
  current = 'other';
}
