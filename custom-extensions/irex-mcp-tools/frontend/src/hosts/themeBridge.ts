/**
 * Deriva el theme de Superset SIN depender del contexto de React del host,
 * para montajes fuera del árbol de la app (el dock de Explore: no hay
 * ningún `sqllab.rightSidebar` equivalente ahí, ver `routeObserver.ts` y
 * `exploreHost.tsx`; PLAN_COPILOTO_EXPLORE.md, Fase 0).
 *
 * `theme.useTheme()` (que sí usa el panel de SQL Lab) es literalmente el
 * `useTheme()` de Emotion: lee un `React.Context`, así que solo funciona
 * dentro del ÁRBOL de React del host. Una raíz de React separada
 * (`ReactDOM.render` en un nodo propio, sin ancestro `<ThemeProvider>`) NO
 * lo hereda — es una propiedad del árbol de React, no del bundle ni del
 * módulo compartido, aunque `@apache-superset/core` se resuelva en runtime
 * contra el mismo `window.superset` que usa el host (ver
 * `frontend/webpack.config.js`: `externalsType: "window"`).
 *
 * Solución verificada contra la app de test real (2026-09-24):
 * 1. `document.getElementById('app').dataset.bootstrap` trae
 *    `common.theme.{default,dark}` — el mismo `{algorithm, token}`
 *    serializado (`algorithm` como string `"default"`/`"dark"`) en TODAS
 *    las páginas autenticadas (`/explore/`, `/sqllab/`, `/superset/welcome/`
 *    probadas; no es específico de SQL Lab).
 * 2. `themeNs.Theme.fromConfig(cfg)` (la misma clase pública que usa el
 *    host) sabe deserializar ese formato — está pensado para eso
 *    (`SerializableThemeConfig`) — y calcula los tokens con el `antd`
 *    compartido como singleton por Module Federation: mismo resultado que
 *    `theme.useTheme()` dentro del árbol del host, sin reimplementar el
 *    algoritmo de Ant Design.
 * 3. El modo claro/oscuro vive en `localStorage['superset-theme-mode']`
 *    (`'default'|'dark'|'system'`), con `prefers-color-scheme` como
 *    resolución de `'system'` — mismo criterio que ya usa el inline script
 *    de `custom-src/login/mcp_widget.py` para "El Don".
 * 4. `ThemeAgentBridge.tsx` (customización propia del proyecto, mounted
 *    dentro del árbol del host) dispara `window` `CustomEvent`
 *    `'superset-agent:theme-change'` cada vez que el tema cambia — se usa
 *    acá solo como DISPARADOR para recalcular (no se consume su `detail`,
 *    que trae un subconjunto reducido de tokens pensado para un widget más
 *    simple, insuficiente para los componentes que reutiliza este panel).
 */
import { theme as themeNs } from '@apache-superset/core';

const THEME_MODE_STORAGE_KEY = 'superset-theme-mode';
const THEME_CHANGE_EVENT = 'superset-agent:theme-change';

export type PanelTheme = ReturnType<typeof themeNs.useTheme>;

interface RawThemeBootstrap {
  default?: unknown;
  dark?: unknown;
}

/** Lee y parsea `data-bootstrap` del contenedor de la app. `undefined` si
 * el nodo no existe o el atributo no es JSON válido (nunca lanza). */
export function readBootstrapThemeConfig(doc: Document = document): RawThemeBootstrap | undefined {
  try {
    const raw = doc.getElementById('app')?.getAttribute('data-bootstrap');
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { common?: { theme?: RawThemeBootstrap } };
    return parsed.common?.theme;
  } catch {
    return undefined;
  }
}

/** true si corresponde el tema oscuro, según la preferencia guardada por
 * Superset (o la del sistema operativo si es `'system'` o no hay ninguna). */
export function isDarkMode(win: Window = window): boolean {
  let stored: string | null = null;
  try {
    stored = win.localStorage.getItem(THEME_MODE_STORAGE_KEY);
  } catch {
    // Almacenamiento no disponible (ventana privada, etc.): seguir al SO.
  }
  if (stored === 'dark') return true;
  if (stored === 'default') return false;
  try {
    return win.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** Config cruda (aún sin pasar por `Theme.fromConfig`) que corresponde al
 * modo actual. Separado de `computeCurrentTheme` para poder testear la
 * selección sin depender de la clase `Theme` real (antd). */
export function selectThemeConfig(bootstrap: RawThemeBootstrap | undefined, dark: boolean): unknown {
  if (!bootstrap) return undefined;
  return dark ? bootstrap.dark : bootstrap.default;
}

/** Theme completo, con los mismos tokens que vería el panel de SQL Lab
 * dentro del árbol del host. `undefined` si no se pudo derivar (bootstrap
 * ausente/roto): el llamador debe tener un tema de reserva. */
export function computeCurrentTheme(doc: Document = document, win: Window = window): PanelTheme | undefined {
  const cfg = selectThemeConfig(readBootstrapThemeConfig(doc), isDarkMode(win));
  if (!cfg) return undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return themeNs.Theme.fromConfig(cfg as any).theme;
  } catch {
    return undefined;
  }
}

/** Se dispara cada vez que Superset cambia de tema (claro/oscuro, o un tema
 * custom vía administración). El listener debe volver a llamar
 * `computeCurrentTheme()`: este evento es solo el disparador. */
export function onDidChangeTheme(listener: () => void, win: Window = window): { dispose: () => void } {
  win.addEventListener(THEME_CHANGE_EVENT, listener);
  return { dispose: () => win.removeEventListener(THEME_CHANGE_EVENT, listener) };
}
