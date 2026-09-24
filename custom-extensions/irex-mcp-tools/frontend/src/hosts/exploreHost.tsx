/**
 * Monta el panel del asistente en Explore (PLAN_COPILOTO_EXPLORE.md, Fase 0,
 * tareas 1 y 2). Sin punto de montaje oficial (no existe un `explore.*`
 * equivalente a `sqllab.rightSidebar` en `@apache-superset/core` 6.1, ni un
 * `<ViewListExtension>` genérico fuera de SQL Lab — verificado leyendo el
 * código fuente de Superset), así que este módulo:
 *
 * 1. Observa la ruta (`routeObserver.ts`) y monta/desmonta el dock al
 *    entrar/salir de `/explore`. Nunca queda una raíz de React, un listener
 *    ni un nodo del DOM vivo fuera de Explore.
 * 2. RESERVA espacio real en vez de superponerse — mismo mecanismo, con los
 *    mismos nombres de pieza, que ya usa en producción el dock del widget de
 *    chat (`custom-src/login/mcp_widget.py`, `setupDock`/
 *    `setupDockResize`): envuelve `#app` completo (navbar incluida) en una
 *    fila flex y agrega el panel como HERMANO con ancho propio y un handle
 *    de resize entre los dos, restaurando `#app` a su posición original al
 *    desmontar. Se llegó a este mecanismo después de un primer intento con
 *    `position: fixed` que el usuario reportó con capturas tapando
 *    "Guardar" y la barra global de Superset (Registro de cambios, entrada
 *    57) — el propio usuario señaló el dock del chat como el patrón a
 *    imitar, ya resiliente en producción a la pregunta "¿cuánto mide lo que
 *    Superset dibuja arriba?": con este mecanismo esa pregunta ni se
 *    plantea, porque el dock nunca comparte espacio con nada, lo reserva.
 *    El handle también trae un botón para plegar/desplegar el panel a ancho
 *    0 sin perder el ancho elegido (entrada 59) — pedido por el usuario
 *    apenas confirmó que el dock ya no se superponía.
 * 3. Como esa raíz no hereda el `ThemeContext` del host, la envuelve en su
 *    propio `<theme.ThemeProvider>` con los tokens reales derivados por
 *    `themeBridge.ts` (mismo resultado que `theme.useTheme()` dentro del
 *    árbol del host), y se re-renderiza cuando el usuario cambia de tema.
 */
import React from 'react';
import ReactDOM from 'react-dom';
import { theme as themeNs } from '@apache-superset/core';
import { ExploreAssistantPanel } from '../assistant/ExploreAssistantPanel';
import { computeCurrentTheme, onDidChangeTheme, type PanelTheme } from './themeBridge';
import { getSurface, onDidChangeSurface } from './routeObserver';
import { activateExploreQueryCapture } from './exploreQueryCapture';

const WRAPPER_ID = 'irex-explore-dock-wrapper';
const MAIN_ID = 'irex-explore-dock-main';
const DOCK_ID = 'irex-explore-dock';
const RESIZER_ID = 'irex-explore-dock-resizer';
const TOGGLE_ID = 'irex-explore-dock-toggle';
const STYLE_ID = 'irex-explore-dock-style';
const WIDTH_STORAGE_KEY = 'irex-explore-dock-width';
const COLLAPSED_STORAGE_KEY = 'irex-explore-dock-collapsed';

/** Tema de reserva si `computeCurrentTheme()` no pudo derivar uno (bootstrap
 * ausente o roto): valores neutros, legibles en cualquier fondo claro — más
 * seguro que no mostrar nada. */
const FALLBACK_THEME: PanelTheme = {
  colorBgContainer: '#ffffff',
  colorText: 'rgba(0, 0, 0, 0.88)',
  colorTextSecondary: 'rgba(0, 0, 0, 0.65)',
  colorBorder: '#d9d9d9',
  colorBorderSecondary: '#f0f0f0',
  colorPrimary: '#1677ff',
  colorPrimaryBg: '#e6f4ff',
  colorPrimaryBorder: '#91caff',
  colorFillTertiary: '#f5f5f5',
  colorFillQuaternary: '#fafafa',
  colorError: '#ff4d4f',
  colorErrorBg: '#fff2f0',
  colorErrorBorder: '#ffccc7',
  colorWarning: '#faad14',
  colorWarningBg: '#fffbe6',
  colorWarningBorder: '#ffe58f',
  colorSuccess: '#52c41a',
  borderRadius: 6,
  borderRadiusSM: 4,
} as unknown as PanelTheme;

/** Igual que en `mcp_widget.py`: ancho mínimo arrastrable, y máximo como
 * mitad de la ventana (recalculado en cada drag, no una vez). */
const MIN_WIDTH = 380;

function maxWidth(): number {
  return Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.5));
}

function defaultWidth(): number {
  return Math.min(460, Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.34)));
}

function readStoredWidth(): number | undefined {
  try {
    const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY);
    const parsed = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed >= MIN_WIDTH && parsed <= maxWidth()) return parsed;
  } catch {
    // localStorage puede no estar disponible (contexto privado/bloqueado) — se
    // cae al ancho por defecto, no es un error del que valga la pena avisar.
  }
  return undefined;
}

function writeStoredWidth(width: number): void {
  try {
    window.localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
  } catch {
    // idem: persistir el ancho es una comodidad, no una garantía.
  }
}

function readStoredCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeStoredCollapsed(value: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, value ? '1' : '0');
  } catch {
    // idem: persistir el estado plegado es una comodidad, no una garantía.
  }
}

/** CSS del handle de resize (hover + grip visual) — no se puede expresar
 * `:hover` con estilos inline de React, así que va en una única hoja de
 * estilo global, inyectada una sola vez (idempotente entre montajes). Mismo
 * dibujo que el handle del dock de chat, en gris neutro para leerse bien en
 * tema claro y oscuro sin necesidad de detectarlo. */
function injectStylesOnce(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = [
    `#${RESIZER_ID}{position:relative;flex:0 0 auto;width:6px;cursor:col-resize;`,
    'background:transparent;touch-action:none;}',
    `#${RESIZER_ID}:hover,#${RESIZER_ID}.irex-resizing{background:rgba(0,0,0,.12);}`,
    `#${RESIZER_ID}::after{content:"";position:absolute;top:50%;left:50%;`,
    'transform:translate(-50%,-50%);width:4px;height:28px;border-radius:2px;',
    'background:repeating-linear-gradient(to bottom,rgba(128,128,128,.55) 0,',
    'rgba(128,128,128,.55) 2px,transparent 2px,transparent 5px);pointer-events:none;}',
    `#${RESIZER_ID}:hover::after,#${RESIZER_ID}.irex-resizing::after{background:`,
    'repeating-linear-gradient(to bottom,rgba(128,128,128,.9) 0,rgba(128,128,128,.9) 2px,',
    'transparent 2px,transparent 5px);}',
    // Botón de ocultar/mostrar: un círculo que se apoya sobre el resizer
    // (mitad adentro del lienzo, mitad adentro del panel) para quedar
    // clickeable y VISIBLE incluso con el panel en ancho 0 — vive fuera de
    // `#${DOCK_ID}` a propósito, así `overflow:hidden` del dock nunca se lo
    // lleva puesto. Colores fijos (no de tema): vive fuera del árbol de
    // React que sí tiene el bootstrap del tema disponible.
    `#${TOGGLE_ID}{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);`,
    'width:20px;height:36px;border-radius:10px;border:1px solid rgba(0,0,0,.15);',
    'background:#fff;color:rgba(0,0,0,.65);display:flex;align-items:center;',
    'justify-content:center;font-size:12px;line-height:1;cursor:pointer;padding:0;',
    'box-shadow:0 1px 3px rgba(0,0,0,.15);pointer-events:auto;}',
    `#${TOGGLE_ID}:hover{background:#f5f5f5;color:rgba(0,0,0,.88);}`,
  ].join('');
  document.head.appendChild(style);
}

/** Arrastrar el handle cambia el ancho del dock en vivo, mutando el DOM
 * directamente (no vía estado de React: en cada `mousemove` sería un
 * re-render de más). Se persiste en `localStorage` recién al soltar.
 * `onResized` se usa para que `mount()` lleve la cuenta del último ancho
 * elegido (necesario para poder restaurarlo al des-plegar desde plegado).
 * Sin efecto mientras `isCollapsed()` — no tiene sentido arrastrar un panel
 * en ancho 0. Devuelve la función de limpieza — se llama desde `unmount()`. */
function setupResize(dock: HTMLElement, resizer: HTMLElement, isCollapsed: () => boolean, onResized: (width: number) => void): () => void {
  let dragging = false;
  let startX = 0;
  let startWidth = 0;
  let dragMax = maxWidth();

  const onMouseDown = (ev: MouseEvent): void => {
    if (isCollapsed()) return;
    dragging = true;
    startX = ev.clientX;
    startWidth = dock.getBoundingClientRect().width;
    dragMax = maxWidth();
    resizer.classList.add('irex-resizing');
    document.body.style.userSelect = 'none';
    ev.preventDefault();
  };
  const onMouseMove = (ev: MouseEvent): void => {
    if (!dragging) return;
    // El dock está a la derecha: arrastrar hacia la izquierda lo agranda.
    let next = startWidth + (startX - ev.clientX);
    if (next < MIN_WIDTH) next = MIN_WIDTH;
    if (next > dragMax) next = dragMax;
    dock.style.width = `${next}px`;
  };
  const onMouseUp = (): void => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('irex-resizing');
    document.body.style.userSelect = '';
    const current = parseInt(dock.style.width, 10);
    if (Number.isFinite(current)) {
      writeStoredWidth(current);
      onResized(current);
    }
  };

  resizer.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  return () => {
    resizer.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };
}

/** La lógica del asistente (leer el estado, mandar el pedido, mostrar la
 * conversación) vive en `assistant/ExploreAssistantPanel.tsx` — este
 * archivo se queda solo con el mecanismo de montaje/resize/plegado/tema,
 * que es una preocupación totalmente distinta y no depende de qué
 * asistente se muestre adentro. */
function ExploreDockRoot(): React.ReactElement {
  const [theme, setTheme] = React.useState<PanelTheme>(() => computeCurrentTheme() ?? FALLBACK_THEME);

  React.useEffect(() => {
    // El bootstrap ya está en el DOM al montar, pero por si esta raíz se
    // monta antes de que termine de asentarse, un segundo intento no hace
    // daño (recalcular es barato: solo lee JSON + llama a Theme.fromConfig).
    setTheme(computeCurrentTheme() ?? FALLBACK_THEME);
    const sub = onDidChangeTheme(() => setTheme(computeCurrentTheme() ?? FALLBACK_THEME));
    return () => sub.dispose();
  }, []);

  return (
    <themeNs.ThemeProvider theme={theme}>
      <div
        style={{
          height: '100%',
          width: '100%',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          background: theme.colorBgContainer,
          color: theme.colorText,
          fontSize: 12,
        }}
        data-testid="irex-explore-dock-root"
      >
        <ExploreAssistantPanel />
      </div>
    </themeNs.ThemeProvider>
  );
}

let wrapper: HTMLDivElement | undefined;
let main: HTMLDivElement | undefined;
let resizer: HTMLDivElement | undefined;
let dock: HTMLElement | undefined;
let toggle: HTMLButtonElement | undefined;
let originalParent: (Node & ParentNode) | undefined;
let originalNextSibling: ChildNode | null = null;
let detachResize: (() => void) | undefined;
let detachQueryCapture: (() => void) | undefined;
let collapsed = false;
let expandedWidth = MIN_WIDTH;

/** Aplica el ancho (plegado → 0, sin perder de vista a qué ancho volver) y
 * actualiza el ícono/`aria-label` del botón. Se llama al montar y en cada
 * click del toggle — nunca cambia `expandedWidth` (eso lo hace el resize). */
function applyCollapsedState(): void {
  if (!dock || !toggle || !resizer) return;
  if (collapsed) {
    dock.style.width = '0px';
    dock.style.minWidth = '0px';
    toggle.textContent = '‹';
    toggle.setAttribute('aria-label', 'Mostrar panel del asistente');
    resizer.style.cursor = 'default';
  } else {
    dock.style.width = `${expandedWidth}px`;
    dock.style.minWidth = `${MIN_WIDTH}px`;
    toggle.textContent = '›';
    toggle.setAttribute('aria-label', 'Ocultar panel del asistente');
    resizer.style.cursor = 'col-resize';
  }
}

function mount(): void {
  if (wrapper) return; // ya montado
  const app = document.getElementById('app');
  if (!app || !app.parentNode) return; // sin #app no hay dónde anclar — no reventar la página

  injectStylesOnce();
  detachQueryCapture = activateExploreQueryCapture();

  originalParent = app.parentNode as Node & ParentNode;
  originalNextSibling = app.nextSibling;

  wrapper = document.createElement('div');
  wrapper.id = WRAPPER_ID;
  wrapper.style.cssText = 'display:flex;height:100vh;';

  main = document.createElement('div');
  main.id = MAIN_ID;
  // `#app` puede llegar ya envuelto por el dock del chat (`.mcp-dashboard-
  // dock-main`, oculto pero presente en /explore — ver mcp_widget.py). No
  // importa: se envuelve relativo al padre ACTUAL de `#app`, sea ese el
  // <body> directo o ya el `main` del chat.
  main.style.cssText = 'flex:1 1 auto;min-width:0;height:100%;overflow-y:auto;';

  originalParent.insertBefore(wrapper, app);
  main.appendChild(app);
  wrapper.appendChild(main);

  resizer = document.createElement('div');
  resizer.id = RESIZER_ID;
  wrapper.appendChild(resizer);

  toggle = document.createElement('button');
  toggle.id = TOGGLE_ID;
  toggle.type = 'button';
  resizer.appendChild(toggle);

  dock = document.createElement('aside');
  dock.id = DOCK_ID;
  dock.style.cssText = `flex:0 0 auto;box-sizing:border-box;min-width:${MIN_WIDTH}px;max-width:${maxWidth()}px;height:100%;overflow:hidden;background:#fff;`;
  wrapper.appendChild(dock);

  expandedWidth = readStoredWidth() ?? defaultWidth();
  collapsed = readStoredCollapsed();
  applyCollapsedState();

  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    writeStoredCollapsed(collapsed);
    applyCollapsedState();
  });

  detachResize = setupResize(
    dock,
    resizer,
    () => collapsed,
    width => {
      expandedWidth = width;
    },
  );

  ReactDOM.render(<ExploreDockRoot />, dock);
}

function unmount(): void {
  if (!wrapper || !main || !originalParent) return;
  if (dock) ReactDOM.unmountComponentAtNode(dock);
  detachResize?.();
  detachResize = undefined;
  detachQueryCapture?.();
  detachQueryCapture = undefined;

  const app = document.getElementById('app');
  if (app && main.contains(app)) {
    originalParent.insertBefore(app, originalNextSibling);
  }
  wrapper.remove();

  wrapper = undefined;
  main = undefined;
  resizer = undefined;
  dock = undefined;
  toggle = undefined;
  originalParent = undefined;
  originalNextSibling = null;
}

/** Se llama una sola vez desde `index.tsx`. Idempotente: si ya se instaló
 * (recarga en caliente, doble import), no duplica listeners. */
export function activateExploreHost(): void {
  if (getSurface() === 'explore') mount();
  onDidChangeSurface(surface => {
    if (surface === 'explore') mount();
    else unmount();
  });
}

/** Solo para tests. */
export function _isMountedForTests(): boolean {
  return wrapper !== undefined;
}
