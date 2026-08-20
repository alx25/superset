/**
 * Widget de chat embebible para el agente de Superset.
 *
 * Uso: incluir un único <script> en cualquier página:
 *
 *   <script src="http://TU_SERVIDOR:8008/web/widget.js" defer
 *           data-api-url="http://TU_SERVIDOR:8008"
 *           data-mcp-url="http://TU_SUPERSET:5008/mcp"
 *           data-user="USUARIO_SUPERSET"
 *           data-first-name="NOMBRE"
 *           data-last-name="APELLIDO"
 *           data-theme="default"
 *           data-debug="false"></script>
 *
 * - data-api-url: origen de la API (ver server.py / agent.config.Settings,
 *   CORS_ORIGINS). Si se omite, usa el mismo origen que sirve este script.
 * La autenticacion del API la realiza el proxy de Superset agregando
 * X-Service-Secret y X-Superset-User. El widget nunca recibe ni almacena JWT.
 * - data-mcp-url: URL MCP de Superset que usara el backend del chat. Debe
 *   estar permitida en MCP_ALLOWED_URLS o coincidir con MCP_URL.
 * - data-user: usuario logueado en Superset, para contexto del prompt.
 * - data-first-name/data-last-name/data-name: nombre visible del usuario.
 *   No se usa para permisos; data-user sigue siendo el identificador tecnico.
 * - data-debug: valor inicial del flag de debug (se puede cambiar luego
 *   desde la UI; la elección del usuario se recuerda en localStorage).
 * - data-logo-url: URL opcional para reemplazar /assets/logo.png.
 * - data-css-url: URL opcional para reemplazar /web/widget.css.
 * - data-theme: override opcional del tema activo del host. Acepta "dark",
 *   "light" o "default" (claro). Si se omite, usa UI_THEME del backend.
 *   Puede actualizarse en caliente cambiando el atributo o emitiendo
 *   "superset-agent:theme-change" con detail.theme.
 *
 * El widget se renderiza dentro de un Shadow DOM para poder embeberse sin
 * colisionar con los estilos de la página anfitriona. Los estilos viven en
 * /web/widget.css.
 */
(function () {
  const currentScript = (
    document.currentScript
    || document.querySelector('script[src*="/web/widget.js"]')
    || document.querySelector('script[data-api-url]')
  );
  const API_URL = ((currentScript && currentScript.dataset.apiUrl) || "").replace(/\/$/, "");
  const MCP_URL = ((currentScript && currentScript.dataset.mcpUrl) || "").replace(/\/$/, "");
  const SUPERSET_USER = ((currentScript && currentScript.dataset.user) || "").trim();
  const SUPERSET_FIRST_NAME = (
    (currentScript && (currentScript.dataset.firstName || currentScript.getAttribute("data-first_name")))
    || ""
  ).trim();
  const SUPERSET_LAST_NAME = (
    (currentScript && (currentScript.dataset.lastName || currentScript.getAttribute("data-last_name")))
    || ""
  ).trim();
  const SUPERSET_FULL_NAME = (
    ((currentScript && currentScript.dataset.name) || "").trim()
    || [SUPERSET_FIRST_NAME, SUPERSET_LAST_NAME].filter(Boolean).join(" ").trim()
  );
  const SUPERSET_DISPLAY_NAME = SUPERSET_FULL_NAME || SUPERSET_USER || "usuario";
  const DEFAULT_DEBUG = currentScript ? currentScript.dataset.debug === "true" : false;
  const INITIAL_THEME_OVERRIDE = normalizeThemeOverride(
    currentScript && currentScript.getAttribute("data-theme")
  );
  const SCRIPT_URL = currentScript && currentScript.src ? currentScript.src : "";
  const SCRIPT_ORIGIN = (() => {
    try {
      return SCRIPT_URL ? new URL(SCRIPT_URL).origin : "";
    } catch {
      return "";
    }
  })();
  const WEB_BASE_URL = (() => {
    try {
      return SCRIPT_URL ? new URL(".", SCRIPT_URL).href.replace(/\/$/, "") : `${SCRIPT_ORIGIN}/web`;
    } catch {
      return `${SCRIPT_ORIGIN}/web`;
    }
  })();
  const ASSET_BASE_URL = API_URL || SCRIPT_ORIGIN || "";
  const CSS_URL = (currentScript && currentScript.dataset.cssUrl) || `${WEB_BASE_URL}/widget.css`;
  const LOGO_URL = (
    (currentScript && currentScript.dataset.logoUrl)
    || `${ASSET_BASE_URL}/assets/logo.png`
  );

  const USER_SCOPE = SUPERSET_USER || "anonymous";
  const SESSION_KEY = `superset-agent:session-id:${USER_SCOPE}`;
  const EXPANDED_KEY = "superset-agent:expanded";
  const DEBUG_KEY = "superset-agent:debug";
  const CUSTOM_MODEL_KEY = "superset-agent:custom-model";
  const MODEL_BACKEND_KEY = "superset-agent:model-backend";
  const MODEL_NAME_KEY = "superset-agent:model-name";
  const SHARED_DOCK_OPEN_KEY = `superset-agent:shared-dock-open:${USER_SCOPE}`;
  const SHARED_READ_KEY = `superset-agent:shared-read:${USER_SCOPE}`;
  const DEFAULT_MODEL_BACKEND = "opencode";
  const DEFAULT_MODEL_NAME = "deepseek-v4-pro";

  const STATUS_LABELS = {
    thinking: "Analizando solicitud...",
    calling_tool: "Consultando datos...",
    responding: "Preparando respuesta...",
  };

  const PROGRESS_LABELS = {
    thinking: "Analizando tu solicitud...",
    calling_tool: "Consultando datos en Superset...",
    responding: "Preparando la respuesta...",
    canceling: "Cancelando solicitud...",
  };

  const SEND_ICON = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="22" y1="2" x2="11" y2="13"/>
      <polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
  `;

  const STOP_ICON = `
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2.5"/>
    </svg>
  `;

  const COPY_ICON = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="9" width="11" height="11" rx="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  `;

  const HTML = `
    <div id="launcher" class="launcher">
      <button id="bubble-hint" class="bubble-hint hidden" type="button">
        <span class="bubble-hint-eyebrow">El Don con IA</span>
        <span id="bubble-hint-text" class="bubble-hint-text"></span>
      </button>
      <button id="bubble" class="bubble" type="button" title="Abrir El Don con IA">
        <span class="bubble-ring"></span>
        <img class="bubble-logo" src="${escapeAttr(LOGO_URL)}" alt="El Don con IA">
      </button>
    </div>

    <div id="panel" class="panel hidden">

      <!-- Header -->
      <div class="header">
        <div class="header-left">
          <button id="history-btn" class="icon-btn" type="button" title="Conversaciones">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="4" y1="6" x2="20" y2="6"/>
              <line x1="4" y1="12" x2="20" y2="12"/>
              <line x1="4" y1="18" x2="20" y2="18"/>
            </svg>
          </button>
          <button id="top-new-session-btn" class="icon-btn icon-btn-primary" type="button" title="Nueva conversación">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
          <div class="header-icon">
            <img src="${escapeAttr(LOGO_URL)}" alt="">
          </div>
          <div class="header-text">
            <div class="title">El Don con IA</div>
            <div class="header-subtitle-row">
              <span class="subtitle">Asistente de datos</span>
              <span id="header-model" class="header-model hidden"></span>
            </div>
            <button id="header-session-id" class="header-session-id" type="button" title="Copiar ID de chat"></button>
          </div>
        </div>
        <div class="header-actions">
          <button id="expand-btn" class="icon-btn" type="button" title="Expandir" aria-label="Expandir"></button>
          <div id="header-more-wrap" class="header-more-wrap">
            <button id="header-more-btn" class="icon-btn" type="button" title="Más opciones" aria-expanded="false">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/>
              </svg>
            </button>
            <div id="header-menu" class="header-menu hidden">
              <button id="settings-btn" class="header-menu-item" type="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
                <span>Configuración</span>
              </button>
            </div>
          </div>
          <button id="close-btn" class="icon-btn" type="button" title="Cerrar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Settings drawer (slides over messages) -->
      <div id="settings-drawer" class="settings-drawer">
        <div class="settings-header">
          <span class="settings-title">Configuración</span>
          <button id="settings-close-btn" class="icon-btn" type="button" title="Cerrar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="settings-body">

          <div class="settings-section">
            <span class="settings-section-label">Sesión actual</span>
            <div class="session-id-box">
              <span id="session-id" class="session-id"></span>
              <button id="copy-session-btn" class="session-action-btn" type="button">Copiar</button>
              <button id="new-session-btn" class="session-action-btn" type="button">Nueva</button>
            </div>
          </div>

          <div class="settings-section">
            <span class="settings-section-label">Preferencias</span>
            <div class="settings-row">
              <span class="settings-row-label">Modo debug</span>
              <label class="toggle-switch">
                <input type="checkbox" id="debug-toggle" />
                <span class="toggle-track"></span>
              </label>
            </div>
            <div class="settings-row">
              <span class="settings-row-label">Modelo personalizado</span>
              <label class="toggle-switch">
                <input type="checkbox" id="custom-model-toggle" />
                <span class="toggle-track"></span>
              </label>
            </div>
          </div>

          <div id="model-controls" class="settings-section hidden">
            <span class="settings-section-label">Modelo de IA</span>
            <div id="model-selects" class="model-selects">
              <select id="model-backend" aria-label="Fuente de IA"></select>
              <select id="model-name"    aria-label="Modelo de IA"></select>
            </div>
          </div>

        </div>
      </div>

      <div class="chat-shell">
        <aside id="conversation-sidebar" class="conversation-sidebar">
          <div class="conversation-header">
            <span class="conversation-title">Conversaciones</span>
            <button id="conversation-refresh-btn" class="icon-btn" type="button" title="Refrescar conversaciones">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/>
                <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/>
              </svg>
            </button>
            <button id="conversation-new-btn" class="icon-btn" type="button" title="Nuevo chat">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
          </div>
          <div id="conversation-list" class="conversation-list"></div>
          <div id="shared-dock" class="shared-dock">
            <button id="shared-dock-toggle" class="shared-dock-toggle" type="button">
              <span class="shared-dock-label">Compartidas conmigo</span>
              <span class="shared-dock-badges">
                <span id="shared-unread-count" class="shared-unread-count hidden"></span>
                <span id="shared-count" class="shared-count">0</span>
              </span>
            </button>
            <div id="shared-dock-list" class="shared-dock-list"></div>
          </div>
        </aside>
        <button id="history-scrim" class="history-scrim" type="button" aria-label="Cerrar conversaciones"></button>

        <div class="chat-main">
          <div id="shared-banner" class="shared-banner hidden"></div>

          <!-- Messages -->
          <div id="messages" class="messages"></div>
          <div id="suggestion-float" class="suggestion-float hidden" aria-live="polite"></div>

          <!-- Status -->
          <div id="status" class="status hidden">
            <span class="status-dot"></span>
            <span id="status-text"></span>
          </div>

          <!-- Composer -->
          <form id="form" class="composer">
            <textarea id="input" rows="1" placeholder="Pregúntale a El Don con IA…" autocomplete="off" spellcheck="true"></textarea>
            <button id="cancel-btn" class="cancel-btn hidden" type="button" title="Cancelar">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="4" width="16" height="16" rx="2.5"/>
              </svg>
            </button>
            <button id="send-btn" type="submit" title="Enviar">
              ${SEND_ICON}
            </button>
          </form>
          <div id="ai-disclaimer" class="ai-disclaimer hidden">
            El Don con IA usa Inteligencia Artificial para responder. Ten cuidado: la IA podría cometer errores.
          </div>
        </div>
      </div>

      <div id="toast-region" class="toast-region" aria-live="polite" aria-atomic="true"></div>

      <div id="share-modal" class="share-modal hidden" role="dialog" aria-modal="true" aria-labelledby="share-modal-title">
        <div class="share-dialog">
          <div class="share-dialog-header">
            <div>
              <div id="share-modal-title" class="share-dialog-title">Compartir conversación</div>
              <div class="share-dialog-subtitle">El acceso será solo lectura.</div>
            </div>
            <button id="share-close-btn" class="icon-btn" type="button" title="Cerrar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <div class="share-dialog-body">
            <label class="share-label" for="share-title-input">Título visible</label>
            <input id="share-title-input" class="share-input share-title-input" type="text" autocomplete="off" maxlength="140" placeholder="Título de la conversación">
            <label class="share-label" for="share-user-input">Usuario destino</label>
            <div class="share-input-row">
              <input id="share-user-input" class="share-input" type="text" autocomplete="off" placeholder="usuario_superset">
              <button id="share-submit-btn" class="share-submit" type="button">Compartir</button>
            </div>
            <div id="share-status" class="share-status hidden"></div>
            <div class="share-note">Podrá ver mensajes, tablas y gráficos, pero no podrá responder ni modificar esta conversación.</div>
            <div class="share-list-title">Accesos actuales</div>
            <div id="share-list" class="share-list"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  /* ─── Helpers ─────────────────────────────────────────────────────────── */

  function getSessionId() {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = createSessionId();
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  }

  function requestHeaders() {
    return { "Content-Type": "application/json" };
  }

  function normalizeThemeOverride(value) {
    const theme = String(value || "").trim().toLowerCase();
    if (theme === "dark") return "dark";
    if (theme === "light" || theme === "default") return "light";
    return null;
  }

  function displayUserName(user) {
    const value = String(user || "").trim();
    if (!value) return "";
    return value.toLowerCase() === SUPERSET_USER.toLowerCase()
      ? SUPERSET_DISPLAY_NAME
      : value;
  }

  let echartsLoadPromise = null;
  const chartNumberFormatter = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  });
  const tableNumberFormatter = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  });

  function ensureEcharts() {
    if (window.echarts) return Promise.resolve(window.echarts);
    if (echartsLoadPromise) return echartsLoadPromise;
    echartsLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js";
      script.async = true;
      script.onload = () => resolve(window.echarts);
      script.onerror = () => {
        echartsLoadPromise = null;
        reject(new Error("No se pudo cargar Apache ECharts."));
      };
      document.head.appendChild(script);
    });
    return echartsLoadPromise;
  }

  function formatChartNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return chartNumberFormatter.format(value);
    }
    if (Array.isArray(value)) {
      return value
        .map((item) => (
          typeof item === "number" && Number.isFinite(item)
            ? chartNumberFormatter.format(item)
            : String(item ?? "")
        ))
        .join(" / ");
    }
    return value == null ? "" : String(value);
  }

  function formatTableCell(value) {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "number" && Number.isFinite(value)) {
      return tableNumberFormatter.format(value);
    }
    return String(value);
  }

  function applyChartNumberFormatting(option) {
    if (!option || typeof option !== "object") return option;

    const series = Array.isArray(option.series)
      ? option.series
      : (option.series ? [option.series] : []);

    for (const serie of series) {
      if (!serie || typeof serie !== "object") continue;
      if (serie.label && serie.label.show) {
        serie.label.formatter = (params) => formatChartNumber(params.value);
      }
      if (serie.type === "pie" && serie.label) {
        serie.label.formatter = (params) =>
          `${params.name}: ${formatChartNumber(params.value)}`;
      }
    }

    if (option.yAxis) {
      const yAxes = Array.isArray(option.yAxis) ? option.yAxis : [option.yAxis];
      for (const axis of yAxes) {
        if (!axis || typeof axis !== "object") continue;
        axis.axisLabel = {
          ...(axis.axisLabel || {}),
          formatter: (value) => formatChartNumber(value),
        };
      }
    }

    option.tooltip = {
      ...(option.tooltip || {}),
      valueFormatter: (value) => formatChartNumber(value),
    };

    return option;
  }

  function cloneChartOption(option) {
    if (!option || typeof option !== "object") return {};
    try {
      return JSON.parse(JSON.stringify(option));
    } catch {
      return { ...option };
    }
  }

  function applyChartTheme(option, theme) {
    if (!option || typeof option !== "object") return option;
    const textColor = theme === "dark" ? "#dbe7f5" : "#334155";
    const applyTextStyle = (value) => {
      if (!value || typeof value !== "object") return;
      value.textStyle = {
        ...(value.textStyle || {}),
        color: textColor,
      };
    };

    const titles = Array.isArray(option.title) ? option.title : [option.title];
    titles.forEach(applyTextStyle);
    const legends = Array.isArray(option.legend) ? option.legend : [option.legend];
    legends.forEach(applyTextStyle);

    for (const axisValue of [option.xAxis, option.yAxis]) {
      const axes = Array.isArray(axisValue) ? axisValue : [axisValue];
      for (const axis of axes) {
        if (!axis || typeof axis !== "object") continue;
        const axisLabel = axis.axisLabel && typeof axis.axisLabel === "object"
          ? axis.axisLabel
          : {};
        if (axisLabel.color === "inherit") continue;
        axis.axisLabel = {
          ...axisLabel,
          color: textColor,
        };
      }
    }
    return option;
  }

  function prepareChartOption(option, theme) {
    const prepared = cloneChartOption(option);
    applyChartNumberFormatting(prepared);
    return applyChartTheme(prepared, theme);
  }

  function currentDashboardId() {
    const match = window.location.href.match(/\/superset\/dashboard\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function cleanDashboardTitle(value) {
    return (value || "")
      .replace(/\s*[-|]\s*Superset\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function currentDashboardTitle() {
    if (!currentDashboardId()) return "";
    const selectors = [
      '[data-test="dashboard-title"]',
      '[data-test-id="dashboard-title"]',
      '[data-test="dashboard-title-container"]',
      ".dashboard-title",
      ".dashboard-component-chart-holder .header-title",
      ".dashboard-header h1",
      ".dashboard h1",
      "h1",
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const text = cleanDashboardTitle(el && (el.textContent || el.getAttribute("title")));
      if (text) return text;
    }
    const documentTitle = cleanDashboardTitle(document.title);
    if (documentTitle && !/^superset$/i.test(documentTitle)) return documentTitle;
    const slugOrId = currentDashboardId();
    return slugOrId ? `dashboard ${slugOrId}` : "";
  }

  function shortDashboardTitle(value) {
    const title = cleanDashboardTitle(value);
    if (!title) return "este dashboard";
    return title.length > 54 ? `${title.slice(0, 51).trim()}...` : title;
  }

  function formatConversationDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function conversationDashboardLabel(item) {
    const title = shortDashboardTitle(item?.dashboard_title || "");
    if (item?.dashboard_title) return `desde: "${title}"`;
    if (item?.dashboard_id) return `desde: "dashboard ${item.dashboard_id}"`;
    return "";
  }

  function createSessionId() {
    const webCrypto = globalThis.crypto;
    if (webCrypto && typeof webCrypto.randomUUID === "function") {
      return webCrypto.randomUUID();
    }
    if (webCrypto && typeof webCrypto.getRandomValues === "function") {
      const bytes = webCrypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
      return [
        hex.slice(0, 4).join(""),
        hex.slice(4, 6).join(""),
        hex.slice(6, 8).join(""),
        hex.slice(8, 10).join(""),
        hex.slice(10, 16).join(""),
      ].join("-");
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
      const value = Math.floor(Math.random() * 16);
      return (char === "x" ? value : (value & 0x3) | 0x8).toString(16);
    });
  }

  function getStoredDebug() {
    const stored = localStorage.getItem(DEBUG_KEY);
    return stored === null ? DEFAULT_DEBUG : stored === "true";
  }

  function getStoredExpanded() {
    return localStorage.getItem(EXPANDED_KEY) === "true";
  }

  function getStoredCustomModel() {
    return localStorage.getItem(CUSTOM_MODEL_KEY) === "true";
  }

  /** Parsea un frame SSE ("event: ...\ndata: ...") a {event, data}.
   *  sse-starlette termina cada línea en "\r\n", así que aceptamos
   *  ambos finales de línea. */
  function parseSseFrame(frame) {
    let event = "message";
    const dataLines = [];
    for (const line of frame.split(/\r\n|\n/)) {
      if (line.startsWith(":")) return null;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return null;
    try {
      return { event, data: JSON.parse(dataLines.join("\n")) };
    } catch {
      return null;
    }
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function toolNameFromEvent(data) {
    const nestedName = data?.arguments?.name;
    if (typeof nestedName === "string" && nestedName) return nestedName;
    return typeof data?.name === "string" ? data.name : "";
  }

  function isChartOptionToolName(name) {
    return /\.?irex\.chart_option$/.test(name) || /\.chart_option$/.test(name);
  }

  function containsToolMarkup(text) {
    const value = String(text || "").toLowerCase();
    return value.includes("<tool_call") || value.includes("</tool_call")
      || value.includes("<toolcall") || value.includes("</toolcall")
      || value.includes("dsml") || value.includes("tool_calls");
  }

  function escapeAttr(text) {
    return escapeHtml(text).replace(/`/g, "&#96;");
  }

  function isSafeUrl(url) {
    return /^(https?:\/\/|mailto:)/i.test(url);
  }

  function renderInlineMarkdown(text) {
    const codeParts = [];
    let html = escapeHtml(text).replace(/`([^`]+)`/g, (_match, code) => {
      const token = `@@CODE${codeParts.length}@@`;
      codeParts.push(`<code>${code}</code>`);
      return token;
    });

    // Los links se protegen con un placeholder ANTES de correr bold/italic:
    // el <a href="..." target="_blank"> generado ya contiene un guion bajo
    // propio (_blank), y si la URL (ej. un token de descarga) también tiene
    // uno, el regex de cursiva de más abajo los empareja entre sí y corta el
    // href a la mitad. Mismo patrón que @@CODE@@ para evitar que bold/italic
    // toquen HTML ya generado.
    const linkParts = [];
    html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
      const decodedUrl = url.replace(/&amp;/g, "&");
      if (!isSafeUrl(decodedUrl)) return match;
      const token = `@@LINK${linkParts.length}@@`;
      linkParts.push(`<a href="${escapeAttr(decodedUrl)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
      return token;
    });
    html = html
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
      .replace(/_([^_\n]+)_/g, "<em>$1</em>");

    for (let i = 0; i < linkParts.length; i += 1) {
      html = html.replace(`@@LINK${i}@@`, linkParts[i]);
    }
    for (let i = 0; i < codeParts.length; i += 1) {
      html = html.replace(`@@CODE${i}@@`, codeParts[i]);
    }
    return html;
  }

  function splitTableRow(line) {
    let value = line.trim();
    if (value.startsWith("|")) value = value.slice(1);
    if (value.endsWith("|")) value = value.slice(0, -1);
    return value.split("|").map((cell) => cell.trim());
  }

  function parseTableSeparator(line) {
    const cells = splitTableRow(line);
    if (cells.length < 2) return null;
    const alignments = [];
    for (const cell of cells) {
      if (!/^:?-+:?$/.test(cell)) return null;
      const left = cell.startsWith(":");
      const right = cell.endsWith(":");
      alignments.push(left && right ? "center" : right ? "right" : "left");
    }
    return alignments;
  }

  function tableCellClass(alignment) {
    if (alignment === "right") return ' class="align-right"';
    if (alignment === "center") return ' class="align-center"';
    return "";
  }

  function renderMarkdownTable(headerLine, separatorLine, bodyLines) {
    const headers = splitTableRow(headerLine);
    const alignments = parseTableSeparator(separatorLine) || [];
    const rows = bodyLines.map(splitTableRow);
    const thead = headers.map((cell, index) => (
      `<th${tableCellClass(alignments[index])}>${renderInlineMarkdown(cell)}</th>`
    )).join("");
    const tbody = rows.map((row) => {
      const cells = headers.map((_header, index) => (
        `<td${tableCellClass(alignments[index])}>${renderInlineMarkdown(row[index] || "")}</td>`
      )).join("");
      return `<tr>${cells}</tr>`;
    }).join("");
    return `<div class="table-wrap"><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`;
  }

  function renderMarkdown(text) {
    const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let paragraph = [];
    let listType = null;
    let inCode = false;
    let codeLines = [];

    function closeParagraph() {
      if (!paragraph.length) return;
      out.push(`<p>${renderInlineMarkdown(paragraph.join("\n")).replace(/\n/g, "<br>")}</p>`);
      paragraph = [];
    }

    function closeList() {
      if (!listType) return;
      out.push(`</${listType}>`);
      listType = null;
    }

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const fence = line.match(/^```/);
      if (fence) {
        if (inCode) {
          out.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
          codeLines = [];
          inCode = false;
        } else {
          closeParagraph();
          closeList();
          inCode = true;
        }
        continue;
      }

      if (inCode) { codeLines.push(line); continue; }

      if (!line.trim()) { closeParagraph(); closeList(); continue; }

      const nextLine = lines[lineIndex + 1] || "";
      if (line.includes("|") && parseTableSeparator(nextLine)) {
        closeParagraph();
        closeList();
        const bodyLines = [];
        lineIndex += 2;
        while (lineIndex < lines.length && lines[lineIndex].includes("|") && lines[lineIndex].trim()) {
          bodyLines.push(lines[lineIndex]);
          lineIndex += 1;
        }
        lineIndex -= 1;
        out.push(renderMarkdownTable(line, nextLine, bodyLines));
        continue;
      }

      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        closeParagraph();
        closeList();
        const level = heading[1].length;
        out.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
        continue;
      }

      const unordered = line.match(/^\s*[-*]\s+(.+)$/);
      if (unordered) {
        closeParagraph();
        if (listType !== "ul") { closeList(); listType = "ul"; out.push("<ul>"); }
        out.push(`<li>${renderInlineMarkdown(unordered[1])}</li>`);
        continue;
      }

      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (ordered) {
        closeParagraph();
        if (listType !== "ol") { closeList(); listType = "ol"; out.push("<ol>"); }
        out.push(`<li>${renderInlineMarkdown(ordered[1])}</li>`);
        continue;
      }

      closeList();
      paragraph.push(line);
    }

    if (inCode) out.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    closeParagraph();
    closeList();
    return out.join("");
  }

  /* ─── Widget class ────────────────────────────────────────────────────── */

  class AgentWidget {
    constructor() {
      this.sessionId = getSessionId();
      this.debug = getStoredDebug();
      this.expanded = getStoredExpanded();
      this.customModel = getStoredCustomModel();
      this.modelBackend = localStorage.getItem(MODEL_BACKEND_KEY) || "";
      this.modelName = localStorage.getItem(MODEL_NAME_KEY) || "";
      this.defaultModelBackend = DEFAULT_MODEL_BACKEND;
      this.defaultModelName = DEFAULT_MODEL_NAME;
      this.modelOptions = [];
      this.maxConcurrentChats = 2;
      this.allowDebug = false;
      this.lastModelUsed = "";
      this.serverTheme = "light";
      this.themeOverride = INITIAL_THEME_OVERRIDE;
      this.theme = this.themeOverride || this.serverTheme;
      this.uiFeatures = {
        dynamicDashboardHint: false,
        dynamicDashboardHintModel: false,
        dashboardHintInterventionLevel: 0,
        answerSuggestions: false,
        answerSuggestionsModel: false,
        answerSuggestionsInterventionLevel: 0,
        suggestionsMaxItems: 3,
      };
      this.conversations = [];
      this.sharedConversations = [];
      this.sharedDockOpen = localStorage.getItem(SHARED_DOCK_OPEN_KEY) === "true";
      this.sharedReadIds = this.loadSharedReadIds();
      this.readOnlyConversation = false;
      this.currentConversationOwner = "";
      this.sharingConversationId = "";
      this.sharingConversationTitle = "";
      this.shareLoading = false;
      this.busy = false;
      this.activeTurns = new Map();
      this.remoteBusySessionIds = new Set();
      this.completedTurnIds = new Set();
      this.assistantEl = null;
      this.assistantText = "";
      this.lastUserMessage = "";
      this.lastTurnDashboardId = "";
      this.lastTurnDashboardTitle = "";
      this.suggestionChipsEl = null;
      this.suggestionRequestSeq = 0;
      this.creatingSession = false;
      this.deletingConversationIds = new Set();
      this.progressEl = null;
      this.progressTextEl = null;
      this.progressStatusText = "";
      this.turnStartedAt = 0;
      this.turnDurationEl = null;
      this.suggestionAnchorEl = null;
      this.activityEl = null;
      this.activitySummaryEl = null;
      this.activityListEl = null;
      this.activityCount = 0;
      this.lastActivityText = "";
      this.taskPlanEl = null;
      this.taskPlan = null;
      this.pendingChartTool = false;
      this.suppressAssistantStream = false;
      this.lastTurnCompleted = false;
      this.historyOpen = false;
      this.welcomeEl = null;
      this.chartInstances = [];
      this.launcherDashboardId = "";
      this.launcherHintShownDashboardId = "";
      this.launcherHintTimer = null;
      this.launcherHintDelayMs = 6500;
      this.launcherNotifyTimer = null;
      this.dashboardHintCache = new Map();
      this.dashboardHintPending = new Set();
      this.launcherDrag = null;
      this.suppressBubbleClick = false;
      this._build();
      this.observeThemeOverride();
      this.loadModelOptions();
      this.loadConversations().then(() => this.restoreCurrentConversation()).catch(() => {
        this.renderWelcome();
      });
      window.addEventListener("resize", () => this.resizeCharts());
      this.observeDashboardLocation();
      this.liveStateTimer = window.setInterval(() => {
        if (this.activeTurns.size || this.remoteBusySessionIds.size || this.historyOpen) {
          this.loadConversations().catch(() => {});
        }
      }, 3000);
    }

    _build() {
      const host = document.createElement("div");
      host.id = "superset-agent-widget";
      host.dataset.theme = this.theme;
      document.body.appendChild(host);
      this.host = host;
      const shadow = host.attachShadow({ mode: "open" });

      const stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = CSS_URL;
      shadow.appendChild(stylesheet);

      const wrapper = document.createElement("div");
      wrapper.innerHTML = HTML;
      shadow.appendChild(wrapper);

      this.launcher          = shadow.getElementById("launcher");
      this.bubble            = shadow.getElementById("bubble");
      this.bubbleHint        = shadow.getElementById("bubble-hint");
      this.bubbleHintText    = shadow.getElementById("bubble-hint-text");
      this.panel             = shadow.getElementById("panel");
      this.messagesEl        = shadow.getElementById("messages");
      this.sharedBannerEl    = shadow.getElementById("shared-banner");
      this.suggestionFloatEl = shadow.getElementById("suggestion-float");
      this.statusEl          = shadow.getElementById("status");
      this.statusTextEl      = shadow.getElementById("status-text");
      this.aiDisclaimer      = shadow.getElementById("ai-disclaimer");
      this.form              = shadow.getElementById("form");
      this.input             = shadow.getElementById("input");
      this.sendBtn           = shadow.getElementById("send-btn");
      this.cancelBtn         = shadow.getElementById("cancel-btn");
      this.historyBtn        = shadow.getElementById("history-btn");
      this.topNewSessionBtn  = shadow.getElementById("top-new-session-btn");
      this.conversationSidebar = shadow.getElementById("conversation-sidebar");
      this.historyScrim      = shadow.getElementById("history-scrim");
      this.conversationList  = shadow.getElementById("conversation-list");
      this.conversationRefreshBtn = shadow.getElementById("conversation-refresh-btn");
      this.conversationNewBtn= shadow.getElementById("conversation-new-btn");
      this.archiveCurrentBtn = shadow.getElementById("archive-current-btn");
      this.sharedDockEl      = shadow.getElementById("shared-dock");
      this.sharedDockToggle  = shadow.getElementById("shared-dock-toggle");
      this.sharedDockList    = shadow.getElementById("shared-dock-list");
      this.sharedCountEl     = shadow.getElementById("shared-count");
      this.sharedUnreadCountEl = shadow.getElementById("shared-unread-count");
      this.shareModal        = shadow.getElementById("share-modal");
      this.shareCloseBtn     = shadow.getElementById("share-close-btn");
      this.shareTitleInput   = shadow.getElementById("share-title-input");
      this.shareUserInput    = shadow.getElementById("share-user-input");
      this.shareSubmitBtn    = shadow.getElementById("share-submit-btn");
      this.shareStatusEl     = shadow.getElementById("share-status");
      this.shareListEl       = shadow.getElementById("share-list");
      this.debugToggle       = shadow.getElementById("debug-toggle");
      this.modelControls     = shadow.getElementById("model-controls");
      this.customModelToggle = shadow.getElementById("custom-model-toggle");
      this.modelSelects      = shadow.getElementById("model-selects");
      this.modelBackendSelect= shadow.getElementById("model-backend");
      this.modelNameSelect   = shadow.getElementById("model-name");
      this.sessionIdEl       = shadow.getElementById("session-id");
      this.headerSessionIdEl = shadow.getElementById("header-session-id");
      this.headerModelEl     = shadow.getElementById("header-model");
      this.copySessionBtn    = shadow.getElementById("copy-session-btn");
      this.newSessionBtn     = shadow.getElementById("new-session-btn");
      this.expandBtn         = shadow.getElementById("expand-btn");
      this.settingsBtn       = shadow.getElementById("settings-btn");
      this.headerMoreWrap    = shadow.getElementById("header-more-wrap");
      this.headerMoreBtn     = shadow.getElementById("header-more-btn");
      this.headerMenu        = shadow.getElementById("header-menu");
      this.toastRegion       = shadow.getElementById("toast-region");
      this.settingsDrawer    = shadow.getElementById("settings-drawer");
      this.settingsCloseBtn  = shadow.getElementById("settings-close-btn");

      this.debugToggle.checked       = this.debug;
      this.customModelToggle.checked = this.customModel;
      this.updateSessionDisplay();
      this.applyExpanded();

      this.bubble.addEventListener("pointerdown", (e) => this.startLauncherDrag(e));
      this.bubble.addEventListener("click", (e) => {
        if (this.suppressBubbleClick) {
          e.preventDefault();
          this.suppressBubbleClick = false;
          return;
        }
        this.resetLauncherPosition();
        this.setOpen(true);
      });
      this.bubbleHint.addEventListener("click", () => {
        this.resetLauncherPosition();
        this.setOpen(true);
      });
      shadow.getElementById("close-btn").addEventListener("click", () => this.setOpen(false));
      this.expandBtn.addEventListener("click", () => {
        this.closeHeaderMenu();
        this.toggleExpanded();
      });
      this.headerMoreBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        this.toggleHeaderMenu();
      });
      shadow.addEventListener("click", (event) => {
        if (!this.headerMoreWrap?.contains(event.target)) this.closeHeaderMenu();
      });
      this.form.addEventListener("submit", (e) => {
        e.preventDefault();
        if (this.busy) {
          this.cancelTurn();
          return;
        }
        this.sendMessage();
      });
      this.input.addEventListener("input", () => this.autoResizeInput());
      this.messagesEl.addEventListener("scroll", () => this.updateSuggestionFloatVisibility(), { passive: true });
      this.panel.addEventListener("wheel", (event) => this.containPanelScroll(event), { passive: false });
      this.input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
        e.preventDefault();
        if (this.busy) {
          this.cancelTurn();
          return;
        }
        this.sendMessage();
      });
      this.cancelBtn.addEventListener("click", () => this.cancelTurn());
      this.historyBtn.addEventListener("click", () => this.toggleHistory());
      this.historyScrim.addEventListener("click", () => this.setHistoryOpen(false));
      this.topNewSessionBtn.addEventListener("click", (event) => this.handleNewSessionClick(event));
      this.conversationRefreshBtn.addEventListener("click", () => this.refreshConversations());
      this.conversationNewBtn.addEventListener("click", (event) => this.handleNewSessionClick(event));
      if (this.archiveCurrentBtn) {
        this.archiveCurrentBtn.addEventListener("click", () => this.archiveCurrentConversation());
      }
      if (this.sharedDockToggle) {
        this.sharedDockToggle.addEventListener("click", () => this.toggleSharedDock());
      }
      if (this.shareCloseBtn) {
        this.shareCloseBtn.addEventListener("click", () => this.closeShareModal());
      }
      if (this.shareModal) {
        this.shareModal.addEventListener("click", (event) => {
          if (event.target === this.shareModal) this.closeShareModal();
        });
      }
      if (this.shareSubmitBtn) {
        this.shareSubmitBtn.addEventListener("click", () => this.submitShare());
      }
      if (this.shareUserInput) {
        this.shareUserInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            this.submitShare();
          }
        });
      }
      this.copySessionBtn.addEventListener("click", () => this.copySessionId());
      this.headerSessionIdEl.addEventListener("click", () => this.copySessionId());
      this.newSessionBtn.addEventListener("click", (event) => this.handleNewSessionClick(event));
      this.settingsBtn.addEventListener("click", () => {
        this.closeHeaderMenu();
        this.toggleSettings();
      });
      this.settingsCloseBtn.addEventListener("click", () => this.closeSettings());

      this.debugToggle.addEventListener("change", () => {
        this.debug = this.debugToggle.checked;
        localStorage.setItem(DEBUG_KEY, this.debug ? "true" : "false");
      });
      this.customModelToggle.addEventListener("change", () => {
        this.customModel = this.customModelToggle.checked;
        localStorage.setItem(CUSTOM_MODEL_KEY, this.customModel ? "true" : "false");
        this.updateModelControls();
      });
      this.modelBackendSelect.addEventListener("change", () => {
        this.modelBackend = this.modelBackendSelect.value;
        localStorage.setItem(MODEL_BACKEND_KEY, this.modelBackend);
        this.ensureSelectedModel(true, false);
        this.renderModelSelectors();
      });
      this.modelNameSelect.addEventListener("change", () => {
        this.modelName = this.modelNameSelect.value;
        localStorage.setItem(MODEL_NAME_KEY, this.modelName);
      });

      this.updateModelControls();
    }

    toggleHeaderMenu() {
      const open = this.headerMenu.classList.contains("hidden");
      this.headerMenu.classList.toggle("hidden", !open);
      this.headerMoreBtn.classList.toggle("active", open);
      this.headerMoreBtn.setAttribute("aria-expanded", open ? "true" : "false");
    }

    closeHeaderMenu() {
      if (!this.headerMenu || !this.headerMoreBtn) return;
      this.headerMenu.classList.add("hidden");
      this.headerMoreBtn.classList.remove("active");
      this.headerMoreBtn.setAttribute("aria-expanded", "false");
    }

    handleNewSessionClick(event) {
      event.preventDefault();
      event.stopPropagation();
      if (window.matchMedia?.("(max-width: 640px)").matches) this.setHistoryOpen(false);
      this.newSession();
    }

    containPanelScroll(event) {
      const target = event.target instanceof Element ? event.target : null;
      const vertical = Math.abs(event.deltaY) >= Math.abs(event.deltaX);
      const delta = vertical ? event.deltaY : event.deltaX;
      const selector = ".messages, .conversation-list, .shared-dock-list, .settings-body, "
        + ".share-dialog-body, .table-wrap, #input.scrollable";
      let scroller = target?.closest(selector) || null;
      let canMoveInsideWidget = false;
      while (scroller && this.panel.contains(scroller)) {
        const position = vertical ? scroller.scrollTop : scroller.scrollLeft;
        const viewport = vertical ? scroller.clientHeight : scroller.clientWidth;
        const extent = vertical ? scroller.scrollHeight : scroller.scrollWidth;
        if (extent > viewport + 1) {
          const atStart = position <= 0;
          const atEnd = position + viewport >= extent - 1;
          if ((delta < 0 && !atStart) || (delta > 0 && !atEnd)) {
            canMoveInsideWidget = true;
            break;
          }
        }
        scroller = scroller.parentElement?.closest(selector) || null;
      }
      if (!canMoveInsideWidget) event.preventDefault();
      event.stopPropagation();
    }

    observeThemeOverride() {
      if (currentScript && typeof MutationObserver !== "undefined") {
        this.themeObserver = new MutationObserver((mutations) => {
          if (mutations.some((mutation) => mutation.attributeName === "data-theme")) {
            this.setThemeOverride(currentScript.getAttribute("data-theme"));
          }
        });
        this.themeObserver.observe(currentScript, {
          attributes: true,
          attributeFilter: ["data-theme"],
        });
      }
      window.addEventListener("superset-agent:theme-change", (event) => {
        this.setThemeOverride(event.detail?.theme);
      });
    }

    setThemeOverride(value) {
      this.themeOverride = normalizeThemeOverride(value);
      this.applyResolvedTheme();
    }

    toggleSettings() {
      if (!this.allowDebug) return;
      if (this.settingsDrawer.classList.contains("open")) {
        this.closeSettings();
      } else {
        this.settingsDrawer.classList.add("open");
        this.settingsBtn.classList.add("active");
      }
    }

    closeSettings() {
      this.settingsDrawer.classList.remove("open");
      this.settingsBtn.classList.remove("active");
    }

    applyDebugAvailability() {
      this.settingsBtn.classList.toggle("hidden", !this.allowDebug);
      this.headerMoreWrap?.classList.toggle("hidden", !this.allowDebug);
      this.settingsBtn.disabled = !this.allowDebug || this.busy;
      if (!this.allowDebug) {
        this.debug = false;
        this.debugToggle.checked = false;
        this.closeSettings();
      }
      this.updateHeaderModel();
    }

    updateHeaderModel(model = "") {
      if (model) this.lastModelUsed = String(model).trim();
      if (!this.headerModelEl) return;
      const fallbackModel = this.defaultModelBackend && this.defaultModelName
        ? `${this.defaultModelBackend}:${this.defaultModelName}`
        : "";
      const value = this.lastModelUsed || fallbackModel;
      const visible = this.allowDebug && Boolean(value);
      this.headerModelEl.classList.toggle("hidden", !visible);
      if (!visible) {
        this.headerModelEl.textContent = "";
        this.headerModelEl.removeAttribute("title");
        return;
      }
      const separator = value.indexOf(":");
      const backend = separator >= 0 ? value.slice(0, separator) : "";
      const modelName = separator >= 0 ? value.slice(separator + 1) : value;
      this.headerModelEl.textContent = backend ? `${backend} · ${modelName}` : modelName;
      this.headerModelEl.title = `Modelo usado: ${value}`;
    }

    observeDashboardLocation() {
      this.updateLauncherHint();
      setInterval(() => this.updateLauncherHint(), 1500);
    }

    startLauncherDrag(event) {
      if (!this.launcher || !this.bubble || (event.pointerType === "mouse" && event.button !== 0)) return;
      this.hideLauncherHint(true);
      const rect = this.launcher.getBoundingClientRect();
      this.launcherDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: rect.left,
        startTop: rect.top,
        moved: false,
      };
      this.bubble.setPointerCapture(event.pointerId);
      this.launcher.classList.add("dragging");
      this.bubble.addEventListener("pointermove", this.onLauncherDragMove);
      this.bubble.addEventListener("pointerup", this.onLauncherDragEnd);
      this.bubble.addEventListener("pointercancel", this.onLauncherDragEnd);
    }

    onLauncherDragMove = (event) => {
      if (!this.launcherDrag || !this.launcher || event.pointerId !== this.launcherDrag.pointerId) return;
      const dx = event.clientX - this.launcherDrag.startX;
      const dy = event.clientY - this.launcherDrag.startY;
      if (Math.abs(dx) + Math.abs(dy) > 6) this.launcherDrag.moved = true;

      const rect = this.launcher.getBoundingClientRect();
      const margin = 12;
      const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
      const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
      const left = Math.min(Math.max(margin, this.launcherDrag.startLeft + dx), maxLeft);
      const top = Math.min(Math.max(margin, this.launcherDrag.startTop + dy), maxTop);
      this.launcher.style.left = `${left}px`;
      this.launcher.style.top = `${top}px`;
      this.launcher.style.right = "auto";
      this.launcher.style.bottom = "auto";
      this.launcher.classList.add("moved");
    };

    onLauncherDragEnd = (event) => {
      if (!this.launcherDrag || !this.bubble || event.pointerId !== this.launcherDrag.pointerId) return;
      if (this.bubble.hasPointerCapture(event.pointerId)) {
        this.bubble.releasePointerCapture(event.pointerId);
      }
      this.bubble.removeEventListener("pointermove", this.onLauncherDragMove);
      this.bubble.removeEventListener("pointerup", this.onLauncherDragEnd);
      this.bubble.removeEventListener("pointercancel", this.onLauncherDragEnd);
      this.suppressBubbleClick = Boolean(this.launcherDrag.moved);
      if (this.suppressBubbleClick) {
        window.setTimeout(() => {
          this.suppressBubbleClick = false;
        }, 350);
      }
      this.launcherDrag = null;
      if (this.launcher) this.launcher.classList.remove("dragging");
    };

    resetLauncherPosition() {
      if (!this.launcher) return;
      this.launcher.style.left = "";
      this.launcher.style.top = "";
      this.launcher.style.right = "";
      this.launcher.style.bottom = "";
      this.launcher.classList.remove("moved", "dragging");
    }

    updateLauncherHint() {
      if (!this.bubbleHint || !this.panel || !this.bubble) return;
      if (this.busy) {
        this.updateLauncherActivityState();
        return;
      }
      const dashboardId = currentDashboardId();
      const isOpen = !this.panel.classList.contains("hidden");
      if (!dashboardId || isOpen || this.bubble.classList.contains("hidden")) {
        this.hideLauncherHint();
        this.launcherDashboardId = dashboardId || "";
        if (!dashboardId) this.launcherHintShownDashboardId = "";
        return;
      }
      if (dashboardId === this.launcherHintShownDashboardId && this.bubbleHint.classList.contains("hidden")) {
        this.launcherDashboardId = dashboardId;
        return;
      }
      if (dashboardId === this.launcherDashboardId && !this.bubbleHint.classList.contains("hidden")) {
        return;
      }

      this.launcherDashboardId = dashboardId;
      this.launcherHintShownDashboardId = dashboardId;
      const title = shortDashboardTitle(currentDashboardTitle());
      const cacheKey = `${dashboardId}:${title}`;
      const cachedHint = this.dashboardHintCache.get(cacheKey);
      const shouldLoadDynamicHint = this.uiFeatures.dynamicDashboardHint && !cachedHint;
      const interventionLevel = Number(this.uiFeatures.dashboardHintInterventionLevel) || 0;
      if (shouldLoadDynamicHint && interventionLevel >= 2) {
        this.hideLauncherHint(true);
        this.loadDashboardHint(dashboardId, title, cacheKey);
        return;
      }
      const text = cachedHint || this.localDashboardHint(title, dashboardId);
      this.showLauncherHint(text, {
        eyebrow: "El Don con IA",
        kind: "dashboard",
        duration: this.launcherHintDelayMs,
      });
      if (shouldLoadDynamicHint) {
        this.loadDashboardHint(dashboardId, title, cacheKey);
      }
    }

    localDashboardHint(title, dashboardId) {
      const label = shortDashboardTitle(title);
      const variants = [
        `¿Revisamos los indicadores de ${label}?`,
        `Puedo ayudarte a encontrar hallazgos en ${label}.`,
        `Analicemos tendencias, filtros y alertas de ${label}.`,
        `Te ayudo a convertir ${label} en respuestas rápidas.`,
      ];
      const seed = Array.from(`${dashboardId || ""}:${label}`)
        .reduce((sum, char) => sum + char.charCodeAt(0), 0);
      return variants[seed % variants.length];
    }

    async loadDashboardHint(dashboardId, title, cacheKey) {
      if (!dashboardId || this.dashboardHintPending.has(cacheKey)) return;
      this.dashboardHintPending.add(cacheKey);
      try {
        const resp = await fetch(`${API_URL}/api/ui/dashboard-hint`, {
          method: "POST",
          headers: requestHeaders(),
          body: JSON.stringify({
            dashboard_id: dashboardId,
            dashboard_title: title,
            page_url: window.location.href,
            mcp_url: MCP_URL || null,
            user: SUPERSET_USER || null,
          }),
        });
        if (!resp.ok) return;
        const data = await resp.json();
        const text = String(data.text || "").trim();
        if (!text) return;
        this.dashboardHintCache.set(cacheKey, text);
        if (
          dashboardId === this.launcherDashboardId
          && !this.busy
          && !this.isPanelOpen()
          && !this.bubble.classList.contains("hidden")
        ) {
          this.showLauncherHint(text, {
            eyebrow: "El Don con IA",
            kind: "dashboard",
            duration: this.launcherHintDelayMs,
          });
        }
      } catch {
        // Las ayudas UI no deben interrumpir el widget.
      } finally {
        this.dashboardHintPending.delete(cacheKey);
      }
    }

    showLauncherHint(text, { eyebrow = "El Don con IA", kind = "dashboard", duration = 6500 } = {}) {
      if (!this.bubbleHint || !this.bubbleHintText) return;
      const eyebrowEl = this.bubbleHint.querySelector(".bubble-hint-eyebrow");
      if (eyebrowEl) eyebrowEl.textContent = eyebrow;
      this.bubbleHintText.textContent = text;
      this.bubbleHint.classList.remove("hidden", "leaving", "working", "done", "dashboard");
      this.bubbleHint.classList.add(kind);
      window.clearTimeout(this.launcherHintTimer);
      if (duration > 0) {
        this.launcherHintTimer = window.setTimeout(() => this.hideLauncherHint(), duration);
      }
    }

    hideLauncherHint(immediate = false) {
      if (!this.bubbleHint || this.bubbleHint.classList.contains("hidden")) return;
      window.clearTimeout(this.launcherHintTimer);
      if (immediate) {
        this.bubbleHint.classList.add("hidden");
        this.bubbleHint.classList.remove("leaving", "working", "done", "dashboard");
        return;
      }
      this.bubbleHint.classList.add("leaving");
      this.launcherHintTimer = window.setTimeout(() => {
        if (!this.bubbleHint) return;
        this.bubbleHint.classList.add("hidden");
        this.bubbleHint.classList.remove("leaving", "working", "done", "dashboard");
      }, 180);
    }

    isPanelOpen() {
      return this.panel && !this.panel.classList.contains("hidden");
    }

    updateLauncherActivityState() {
      if (!this.bubble || !this.panel) return;
      const minimized = !this.isPanelOpen() && !this.bubble.classList.contains("hidden");
      this.bubble.classList.toggle("working", Boolean(this.busy && minimized));
      if (this.busy && minimized) {
        this.showLauncherHint("Estoy analizando tu solicitud...", {
          eyebrow: "Trabajando",
          kind: "working",
          duration: 0,
        });
      } else if (!this.busy && this.bubbleHint?.classList.contains("working")) {
        this.hideLauncherHint();
      }
    }

    focusComposer() {
      if (!this.input || this.isPanelOpen() === false || this.busy) return;
      window.setTimeout(() => {
        if (!this.input || this.busy || !this.isPanelOpen()) return;
        this.input.focus({ preventScroll: true });
      }, 0);
    }

    autoResizeInput() {
      if (!this.input) return;
      this.input.style.height = "auto";
      const maxHeight = Number.parseInt(getComputedStyle(this.input).maxHeight, 10) || 160;
      const nextHeight = Math.min(this.input.scrollHeight, maxHeight);
      this.input.style.height = `${nextHeight}px`;
      this.input.classList.toggle("scrollable", this.input.scrollHeight > maxHeight + 1);
    }

    showLauncherDoneNotification() {
      if (!this.bubble || !this.panel || this.isPanelOpen() || this.bubble.classList.contains("hidden")) return;
      window.clearTimeout(this.launcherNotifyTimer);
      this.bubble.classList.add("has-notification");
      this.showLauncherHint("Respuesta lista. Haz click para verla.", {
        eyebrow: "Listo",
        kind: "done",
        duration: 7500,
      });
      this.launcherNotifyTimer = window.setTimeout(() => {
        if (this.bubble) this.bubble.classList.remove("has-notification");
      }, 7600);
    }

    updateSessionDisplay() {
      const shortId = this.sessionId ? this.sessionId.slice(0, 8) : "";
      if (this.sessionIdEl) this.sessionIdEl.textContent = this.sessionId;
      if (this.headerSessionIdEl) {
        this.headerSessionIdEl.textContent = shortId ? `Chat ${shortId}` : "";
        this.headerSessionIdEl.title = this.sessionId
          ? `Copiar ID de chat: ${this.sessionId}`
          : "Copiar ID de chat";
      }
    }

    setHistoryOpen(open) {
      this.historyOpen = Boolean(open);
      this.conversationSidebar.classList.toggle("open", this.historyOpen);
      this.historyBtn.classList.toggle("active", this.historyOpen);
      this.historyScrim?.classList.toggle("open", this.historyOpen);
      if (this.historyOpen) this.loadConversations();
    }

    toggleHistory() {
      this.setHistoryOpen(!this.historyOpen);
    }

    async refreshConversations() {
      if (!this.conversationRefreshBtn) return;
      this.conversationRefreshBtn.disabled = true;
      this.conversationRefreshBtn.classList.add("spinning");
      try {
        await this.loadConversations();
      } finally {
        this.conversationRefreshBtn.disabled = false;
        this.conversationRefreshBtn.classList.remove("spinning");
      }
    }

    async loadConversations() {
      const params = new URLSearchParams();
      if (SUPERSET_USER) params.set("user", SUPERSET_USER);
      const headers = requestHeaders();
      const [ownedResp, sharedResp] = await Promise.all([
        fetch(`${API_URL}/api/conversations?${params.toString()}`, { headers }),
        fetch(`${API_URL}/api/conversations/shared?${params.toString()}`, { headers }).catch(() => null),
      ]);
      if (!ownedResp.ok) return;
      const data = await ownedResp.json();
      const previousRemoteBusy = this.remoteBusySessionIds.has(this.sessionId);
      this.conversations = Array.isArray(data.conversations) ? data.conversations : [];
      this.remoteBusySessionIds = new Set(
        this.conversations
          .filter((item) => Boolean(item.live_state?.active))
          .map((item) => String(item.id))
      );
      if (sharedResp && sharedResp.ok) {
        const sharedData = await sharedResp.json();
        this.sharedConversations = Array.isArray(sharedData.conversations) ? sharedData.conversations : [];
      } else {
        this.sharedConversations = [];
      }
      this.renderConversationList();
      if (!this.activeTurns.has(this.sessionId)) {
        const currentRemoteBusy = this.remoteBusySessionIds.has(this.sessionId);
        this.setBusy(currentRemoteBusy);
        if (previousRemoteBusy && !currentRemoteBusy) {
          this.completedTurnIds.add(this.sessionId);
          this.loadCurrentConversation().catch(() => {});
        }
      }
    }

    renderConversationList() {
      const listScrollTop = this.conversationList.scrollTop;
      const sharedScrollTop = this.sharedDockList?.scrollTop || 0;
      this.conversationList.innerHTML = "";
      if (!this.conversations.length) {
        const empty = document.createElement("div");
        empty.className = "conversation-empty";
        empty.textContent = "Sin conversaciones propias.";
        this.conversationList.appendChild(empty);
      } else {
        this.renderConversationSection("Mis conversaciones", this.sortedConversations(this.conversations), false, this.conversationList);
      }
      this.renderSharedDock();
      this.conversationList.scrollTop = listScrollTop;
      if (this.sharedDockList) this.sharedDockList.scrollTop = sharedScrollTop;
    }

    sortedConversations(items) {
      return [...items].sort((a, b) => {
        const timeA = Date.parse(a.updated_at || "") || 0;
        const timeB = Date.parse(b.updated_at || "") || 0;
        if (timeA !== timeB) return timeB - timeA;
        return String(a.id || "").localeCompare(String(b.id || ""));
      });
    }

    renderConversationSection(title, items, shared, container = this.conversationList) {
      if (!items.length) return;
      const heading = document.createElement("div");
      heading.className = "conversation-section-title";
      heading.textContent = title;
      container.appendChild(heading);
      for (const item of items) {
        container.appendChild(this.createConversationRow(item, shared));
      }
    }

    createConversationRow(item, shared) {
      const row = document.createElement("div");
      row.className = "conversation-item";
      row.classList.toggle("active", item.id === this.sessionId);
      row.classList.toggle("shared", Boolean(shared));
      row.classList.toggle("unread", Boolean(shared && this.isSharedUnread(item)));
      row.classList.toggle("deleting", this.deletingConversationIds.has(item.id));
      const working = !shared && this.isSessionBusy(item.id);
      const completed = !working && this.completedTurnIds.has(String(item.id));
      row.classList.toggle("working", working);
      row.classList.toggle("completed", completed);
      const dashboardLabel = conversationDashboardLabel(item);
      const ownerLabel = shared && item.owner_user ? `Compartida por ${displayUserName(item.owner_user)}` : "";
      const shareCount = Number(item.share_count || 0);
      let stateClass = "empty";
      let stateContent = "&nbsp;";
      if (working) {
        stateClass = "working";
        stateContent = `<span class="conversation-work-spinner"></span>${escapeHtml(this.sessionWorkLabel(item.id))}`;
      } else if (completed) {
        stateClass = "completed";
        stateContent = "● Respuesta lista";
      } else if (shared) {
        stateClass = "shared";
        stateContent = "Solo lectura";
      } else if (shareCount > 0) {
        stateClass = "shared";
        stateContent = `Compartida con ${shareCount}`;
      }
      const detailsTitle = [dashboardLabel, ownerLabel].filter(Boolean).join(" · ");
      row.innerHTML = `
        <button class="conversation-open" type="button"${detailsTitle ? ` title="${escapeAttr(detailsTitle)}"` : ""}>
          <span class="conversation-item-title">${escapeHtml(item.title || "Nueva conversación")}</span>
          <span class="conversation-item-meta">${escapeHtml(formatConversationDate(item.updated_at))}</span>
          <span class="conversation-item-state ${stateClass}">${stateContent}</span>
          <span class="conversation-item-preview">${escapeHtml(item.last_message || "Sin mensajes")}</span>
        </button>
        <div class="conversation-actions">
          ${shared ? "" : `
            <button class="conversation-action conversation-share${shareCount ? " shared-active" : ""}" type="button" title="${shareCount ? `Compartida con ${shareCount}` : "Compartir"}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="18" cy="5" r="3"/>
                <circle cx="6" cy="12" r="3"/>
                <circle cx="18" cy="19" r="3"/>
                <path d="M8.6 10.8l6.8-4.1"/>
                <path d="M8.6 13.2l6.8 4.1"/>
              </svg>
            </button>
            <button class="conversation-action conversation-delete" type="button" title="Eliminar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18"/>
                <path d="M8 6V4h8v2"/>
                <path d="M19 6l-1 14H6L5 6"/>
              </svg>
            </button>
          `}
        </div>
      `;
      row.querySelector(".conversation-open").addEventListener("click", () => this.openConversation(item.id));
      const shareButton = row.querySelector(".conversation-share");
      if (shareButton) {
        shareButton.addEventListener("click", (event) => {
          event.stopPropagation();
          this.openShareModal(item.id);
        });
      }
      const deleteButton = row.querySelector(".conversation-delete");
      if (deleteButton) {
        const deleting = this.deletingConversationIds.has(item.id);
        deleteButton.disabled = working || deleting;
        if (deleting) deleteButton.classList.add("deleting");
        if (working) deleteButton.title = "Cancela la respuesta antes de eliminar";
        deleteButton.addEventListener("click", (event) => {
          event.stopPropagation();
          this.deleteConversation(item.id, deleteButton);
        });
      }
      return row;
    }

    renderSharedDock() {
      if (!this.sharedDockEl || !this.sharedDockList) return;
      const count = this.sharedConversations.length;
      const unread = this.sharedConversations.filter((item) => this.isSharedUnread(item)).length;
      this.sharedDockEl.classList.toggle("open", this.sharedDockOpen);
      this.sharedDockEl.classList.toggle("has-unread", unread > 0);
      if (this.sharedCountEl) this.sharedCountEl.textContent = String(count);
      if (this.sharedUnreadCountEl) {
        this.sharedUnreadCountEl.textContent = unread ? `${unread} nueva${unread === 1 ? "" : "s"}` : "";
        this.sharedUnreadCountEl.classList.toggle("hidden", unread === 0);
      }
      this.sharedDockList.innerHTML = "";
      if (!this.sharedDockOpen) return;
      if (!count) {
        const empty = document.createElement("div");
        empty.className = "conversation-empty compact";
        empty.textContent = "No tienes conversaciones compartidas.";
        this.sharedDockList.appendChild(empty);
        return;
      }
      for (const item of this.sharedConversations) {
        this.sharedDockList.appendChild(this.createConversationRow(item, true));
      }
    }

    toggleSharedDock() {
      this.sharedDockOpen = !this.sharedDockOpen;
      localStorage.setItem(SHARED_DOCK_OPEN_KEY, this.sharedDockOpen ? "true" : "false");
      this.renderSharedDock();
    }

    loadSharedReadIds() {
      try {
        const value = JSON.parse(localStorage.getItem(SHARED_READ_KEY) || "[]");
        return new Set(Array.isArray(value) ? value.filter(Boolean).map(String) : []);
      } catch {
        return new Set();
      }
    }

    saveSharedReadIds() {
      localStorage.setItem(SHARED_READ_KEY, JSON.stringify([...this.sharedReadIds].slice(-500)));
    }

    isSharedUnread(item) {
      return Boolean(item && item.id && !this.sharedReadIds.has(String(item.id)));
    }

    markSharedRead(conversationId) {
      if (!conversationId) return;
      this.sharedReadIds.add(String(conversationId));
      this.saveSharedReadIds();
    }

    isEmptyConversationItem(item) {
      const count = Number(item?.message_count || 0);
      return Boolean(item && item.id && !item.archived && count === 0);
    }

    emptyConversationItem() {
      return this.conversations.find((item) => this.isEmptyConversationItem(item));
    }

    async loadCurrentConversation() {
      const params = new URLSearchParams();
      if (SUPERSET_USER) params.set("user", SUPERSET_USER);
      const resp = await fetch(`${API_URL}/api/conversations/${encodeURIComponent(this.sessionId)}?${params.toString()}`, {
        headers: requestHeaders(),
      });
      if (resp.status === 404) {
        this.setReadOnlyConversation(false);
        this.renderWelcome();
        return;
      }
      if (!resp.ok) {
        this.addSystemNotice("No se pudo recargar esta conversación.", {
          actionLabel: "Reintentar",
          onAction: () => this.loadCurrentConversation(),
        });
        return;
      }
      const data = await resp.json();
      if (data.conversation) {
        if (data.conversation.is_shared) this.markSharedRead(data.conversation.id);
        await this.renderConversation(data.conversation);
        this.renderConversationList();
      }
    }

    async restoreCurrentConversation() {
      const exists = [...this.conversations, ...this.sharedConversations]
        .some((item) => item.id === this.sessionId);
      if (exists) {
        await this.loadCurrentConversation();
        return;
      }
      this.setReadOnlyConversation(false);
      this.renderWelcome();
    }

    async openConversation(conversationId) {
      if (!conversationId) return;
      const params = new URLSearchParams();
      if (SUPERSET_USER) params.set("user", SUPERSET_USER);
      const resp = await fetch(`${API_URL}/api/conversations/${encodeURIComponent(conversationId)}?${params.toString()}`, {
        headers: requestHeaders(),
      });
      if (!resp.ok) {
        this.showToast("No se pudo abrir la conversación.", {
          tone: "error",
          actionLabel: "Reintentar",
          onAction: () => this.openConversation(conversationId),
        });
        return;
      }
      const data = await resp.json();
      if (!data.conversation) return;
      this.sessionId = data.conversation.id;
      this.completedTurnIds.delete(String(this.sessionId));
      localStorage.setItem(SESSION_KEY, this.sessionId);
      this.updateSessionDisplay();
      this.setBusy(this.isSessionBusy(this.sessionId));
      if (data.conversation.is_shared) {
        this.markSharedRead(data.conversation.id);
      }
      await this.renderConversation(data.conversation);
      const job = this.activeTurns.get(this.sessionId);
      if (job) this.setProgress(job.message || job.state || "thinking");
      this.renderConversationList();
      if (window.matchMedia?.("(max-width: 640px)").matches) this.setHistoryOpen(false);
    }

    isSessionBusy(sessionId) {
      const key = String(sessionId || "");
      return this.activeTurns.has(key) || this.remoteBusySessionIds.has(key);
    }

    sessionWorkLabel(sessionId) {
      const job = this.activeTurns.get(String(sessionId || ""));
      const item = this.conversations.find((entry) => String(entry.id) === String(sessionId));
      const message = String(job?.message || item?.live_state?.message || "").trim();
      if (message) return message.replace(/[.]$/, "");
      const plan = job?.taskPlan || item?.live_state?.task_plan;
      if (plan?.current && plan?.total) return `Análisis ${plan.current}/${plan.total}`;
      const state = job?.state || item?.live_state?.state || "running";
      const labels = {
        accepted: "Preparando…",
        running: "Trabajando…",
        thinking: "Analizando…",
        calling_tool: "Consultando datos…",
        activity: "Trabajando…",
        responding: "Redactando respuesta…",
      };
      return labels[state] || "Trabajando…";
    }

    async renderConversation(conversation) {
      this.setReadOnlyConversation(Boolean(conversation.is_shared), conversation.owner_user || conversation.user || "");
      this.clearCharts();
      this.messagesEl.innerHTML = "";
      this.suggestionChipsEl = null;
      if (this.suggestionFloatEl) {
        this.suggestionFloatEl.classList.add("hidden");
        this.suggestionFloatEl.innerHTML = "";
      }
      this.assistantEl = null;
      this.assistantText = "";
      this.progressEl = null;
      this.progressTextEl = null;
      this.turnDurationEl = null;
      this.suggestionAnchorEl = null;
      this.resetActivityRefs();
      this.taskPlanEl = null;
      this.taskPlan = null;
      this.suppressAssistantStream = false;
      const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
      const latestModelMessage = [...messages].reverse().find((item) => (
        item?.model && item.model !== "local:task-planner"
      ));
      this.lastModelUsed = latestModelMessage?.model || "";
      this.updateHeaderModel();
      if (!messages.length) {
        this.renderWelcome();
        return;
      }
      const latestPlanMessage = [...messages].reverse().find((item) => (
        (item.role === "task_plan" || item.role === "task_plan_update") && item.plan
      ));
      let planRendered = false;
      for (const item of messages) {
        if (item.role === "task_plan" || item.role === "task_plan_update") {
          if (!planRendered && latestPlanMessage?.plan) {
            this.renderTaskPlan(latestPlanMessage.plan);
            planRendered = true;
          }
          continue;
        }
        if (item.artifact) {
          await this.renderArtifactMessage(item.artifact);
        } else if (item.role === "user") {
          this.addMessage("user", item.text || "", false, this.dashboardSourceLabel(item.dashboard_title, item.dashboard_id));
        } else if (item.role === "assistant") {
          this.addMessage("assistant", item.text || "", true);
        } else {
          this.addMessage("system", item.text || "");
        }
      }
    }

    dashboardSourceLabel(title = "", dashboardId = currentDashboardId()) {
      if (!dashboardId) return "";
      const cleanTitle = title ? shortDashboardTitle(title) : `dashboard ${dashboardId}`;
      return `desde: "${cleanTitle}"`;
    }

    setReadOnlyConversation(readOnly, owner = "") {
      this.readOnlyConversation = Boolean(readOnly);
      this.currentConversationOwner = displayUserName(owner) || owner || "";
      if (this.sharedBannerEl) {
        if (this.readOnlyConversation) {
          const ownerText = this.currentConversationOwner
            ? `Conversación compartida por ${this.currentConversationOwner}.`
            : "Conversación compartida.";
          this.sharedBannerEl.textContent = `${ownerText} Solo lectura.`;
          this.sharedBannerEl.classList.remove("hidden");
        } else {
          this.sharedBannerEl.textContent = "";
          this.sharedBannerEl.classList.add("hidden");
        }
      }
      if (this.input) {
        this.input.placeholder = this.readOnlyConversation
          ? "Esta conversación es de solo lectura"
          : "Pregúntale a El Don con IA…";
      }
      this.setBusy(this.busy);
    }

    renderWelcome() {
      this.clearCharts();
      this.lastModelUsed = "";
      this.updateHeaderModel();
      this.messagesEl.innerHTML = "";
      this.suggestionChipsEl = null;
      if (this.suggestionFloatEl) {
        this.suggestionFloatEl.classList.add("hidden");
        this.suggestionFloatEl.innerHTML = "";
      }
      this.assistantEl = null;
      this.assistantText = "";
      this.suggestionAnchorEl = null;
      this.resetActivityRefs();
      const name = SUPERSET_DISPLAY_NAME;
      const el = document.createElement("div");
      el.className = "welcome";
      el.innerHTML = `
        <div class="welcome-mark">
          <img src="${escapeAttr(LOGO_URL)}" alt="">
        </div>
        <div class="welcome-title">Hola, ${escapeHtml(name)}. Soy El Don con IA</div>
        <div class="welcome-subtitle">Asistente de datos creado en honor a nuestro fundador. Puedo ayudarte con dashboards, métricas, tablas y gráficos de Superset.</div>
      `;
      this.welcomeEl = el;
      this.messagesEl.appendChild(el);
    }

    clearWelcome() {
      if (!this.welcomeEl) return;
      this.welcomeEl.remove();
      this.welcomeEl = null;
    }

    async renderArtifactMessage(artifact) {
      if (!artifact || !artifact.payload) return;
      if (artifact.type === "echarts") {
        await this.renderChartBubble(artifact.payload);
      } else if (artifact.type === "table") {
        this.addTableBubble(artifact.payload);
      }
    }

    async archiveCurrentConversation() {
      if (this.busy || this.readOnlyConversation) return;
      await fetch(`${API_URL}/api/conversations/${encodeURIComponent(this.sessionId)}/archive`, {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify({ archived: true, user: SUPERSET_USER || null }),
      }).catch(() => {});
      this.showToast("Conversación archivada.", { tone: "success" });
      await this.newSession();
    }

    async deleteConversation(conversationId, button = null) {
      if (this.busy || !conversationId || this.deletingConversationIds.has(conversationId)) return;
      this.deletingConversationIds.add(conversationId);
      const row = button ? button.closest(".conversation-item") : null;
      if (button) {
        button.disabled = true;
        button.classList.add("deleting");
        button.title = "Eliminando";
      }
      if (row) row.classList.add("deleting");
      const path = `${API_URL}/api/conversations/${encodeURIComponent(conversationId)}`;
      try {
        let resp = await fetch(`${path}/delete`, {
          method: "POST",
          headers: requestHeaders(),
          body: JSON.stringify({ user: SUPERSET_USER || null }),
        }).catch(() => {});
        if (!resp) {
          this.showToast("No se pudo eliminar la conversación.", { tone: "error" });
          return;
        }
        if (resp && !resp.ok && (resp.status === 404 || resp.status === 405)) {
          const params = new URLSearchParams();
          if (SUPERSET_USER) params.set("user", SUPERSET_USER);
          resp = await fetch(`${path}?${params.toString()}`, {
            method: "DELETE",
            headers: requestHeaders(),
          }).catch(() => resp);
        }
        if (resp && !resp.ok && resp.status !== 404) {
          this.showToast("No se pudo eliminar la conversación.", { tone: "error" });
          return;
        }
        if (conversationId === this.sessionId) {
          await this.newSession();
        } else {
          await this.loadConversations().catch(() => {});
        }
        this.showToast("Conversación eliminada.", { tone: "success" });
      } finally {
        this.deletingConversationIds.delete(conversationId);
        if (button && button.isConnected) {
          button.disabled = false;
          button.classList.remove("deleting");
          button.title = "Eliminar";
        }
        if (row && row.isConnected) row.classList.remove("deleting");
      }
    }

    async openShareModal(conversationId) {
      if (this.busy || !conversationId || !SUPERSET_USER) return;
      this.sharingConversationId = conversationId;
      const item = this.conversations.find((conversation) => conversation.id === conversationId) || {};
      this.sharingConversationTitle = item.title || "Nueva conversación";
      if (this.shareTitleInput) this.shareTitleInput.value = this.sharingConversationTitle;
      if (this.shareUserInput) this.shareUserInput.value = "";
      if (this.shareStatusEl) {
        this.shareStatusEl.textContent = "";
        this.shareStatusEl.classList.add("hidden");
      }
      if (this.shareListEl) this.shareListEl.innerHTML = `<div class="share-empty">Cargando accesos...</div>`;
      if (this.shareModal) this.shareModal.classList.remove("hidden");
      this.setShareBusy(false);
      await this.loadShareList();
      window.setTimeout(() => this.shareTitleInput?.focus({ preventScroll: true }), 0);
    }

    closeShareModal() {
      if (this.shareModal) this.shareModal.classList.add("hidden");
      this.sharingConversationId = "";
      this.setShareBusy(false);
    }

    setShareBusy(busy) {
      this.shareLoading = Boolean(busy);
      if (this.shareSubmitBtn) {
        this.shareSubmitBtn.disabled = this.shareLoading;
        this.shareSubmitBtn.textContent = this.shareLoading ? "Compartiendo..." : "Compartir";
      }
      if (this.shareUserInput) this.shareUserInput.disabled = this.shareLoading;
    }

    async loadShareList() {
      if (!this.sharingConversationId || !this.shareListEl) return;
      const params = new URLSearchParams();
      if (SUPERSET_USER) params.set("user", SUPERSET_USER);
      const resp = await fetch(
        `${API_URL}/api/conversations/${encodeURIComponent(this.sharingConversationId)}/shares?${params.toString()}`,
        { headers: requestHeaders() }
      ).catch(() => null);
      if (!resp || !resp.ok) {
        this.shareListEl.innerHTML = `<div class="share-empty">No se pudieron cargar los accesos.</div>`;
        return;
      }
      const data = await resp.json();
      this.renderShareList(Array.isArray(data.shares) ? data.shares : []);
    }

    renderShareList(shares) {
      if (!this.shareListEl) return;
      this.shareListEl.innerHTML = "";
      if (!shares.length) {
        this.shareListEl.innerHTML = `<div class="share-empty">Aún no se compartió con nadie.</div>`;
        return;
      }
      for (const item of shares) {
        const row = document.createElement("div");
        row.className = "share-list-item";
        row.innerHTML = `
          <div class="share-list-user">
            <span>${escapeHtml(item.target_user || "")}</span>
            <small>Solo lectura</small>
          </div>
          <button class="share-revoke" type="button">Revocar</button>
        `;
        row.querySelector(".share-revoke").addEventListener("click", () => {
          this.revokeShare(item.target_user, row);
        });
        this.shareListEl.appendChild(row);
      }
    }

    async submitShare() {
      if (this.shareLoading || !this.sharingConversationId || !this.shareUserInput) return;
      const targetUser = this.shareUserInput.value.trim().toLowerCase();
      if (!targetUser) {
        this.shareUserInput.focus();
        return;
      }
      this.setShareBusy(true);
      try {
        const title = this.shareTitleInput?.value.trim() || this.sharingConversationTitle || "Nueva conversación";
        const resp = await fetch(
          `${API_URL}/api/conversations/${encodeURIComponent(this.sharingConversationId)}/share`,
          {
            method: "POST",
            headers: requestHeaders(),
            body: JSON.stringify({
              user: SUPERSET_USER || null,
              target_user: targetUser,
              permission: "read",
              title,
            }),
          }
        );
        if (!resp.ok) {
          let message = "No se pudo compartir la conversación.";
          try {
            const data = await resp.json();
            if (data.error) message = data.error;
          } catch {}
          if (this.shareListEl) this.shareListEl.innerHTML = `<div class="share-empty">${escapeHtml(message)}</div>`;
          return;
        }
        const data = await resp.json();
        this.shareUserInput.value = "";
        if (data.conversation) {
          const index = this.conversations.findIndex((item) => item.id === data.conversation.id);
          if (index >= 0) {
            this.conversations[index] = {
              ...this.conversations[index],
              ...data.conversation,
              share_count: Array.isArray(data.shares) ? data.shares.length : this.conversations[index].share_count,
            };
          }
        }
        if (this.shareStatusEl) {
          this.shareStatusEl.textContent = `Compartida con ${targetUser}.`;
          this.shareStatusEl.classList.remove("hidden");
        }
        this.showToast(`Conversación compartida con ${targetUser}.`, { tone: "success" });
        this.renderShareList(Array.isArray(data.shares) ? data.shares : []);
        await this.loadConversations().catch(() => {});
      } finally {
        this.setShareBusy(false);
      }
    }

    async revokeShare(targetUser, row = null) {
      if (!this.sharingConversationId || !targetUser || this.shareLoading) return;
      if (row) row.classList.add("deleting");
      const params = new URLSearchParams();
      if (SUPERSET_USER) params.set("user", SUPERSET_USER);
      const resp = await fetch(
        `${API_URL}/api/conversations/${encodeURIComponent(this.sharingConversationId)}/share/${encodeURIComponent(targetUser)}?${params.toString()}`,
        { method: "DELETE", headers: requestHeaders() }
      ).catch(() => null);
      if (row) row.classList.remove("deleting");
      if (!resp || !resp.ok) {
        this.showToast("No se pudo revocar el acceso.", { tone: "error" });
        return;
      }
      const data = await resp.json();
      this.renderShareList(Array.isArray(data.shares) ? data.shares : []);
      this.showToast(`Acceso revocado para ${targetUser}.`, { tone: "success" });
      await this.loadConversations().catch(() => {});
    }

    toggleExpanded() {
      this.expanded = !this.expanded;
      localStorage.setItem(EXPANDED_KEY, this.expanded ? "true" : "false");
      this.applyExpanded();
      setTimeout(() => this.resizeCharts(), 120);
    }

    applyExpanded() {
      if (!this.panel || !this.expandBtn) return;
      this.panel.classList.toggle("expanded", this.expanded);
      this.expandBtn.classList.toggle("active", this.expanded);
      this.expandBtn.title = this.expanded ? "Contraer" : "Expandir";
      this.expandBtn.setAttribute("aria-label", this.expandBtn.title);
      this.expandBtn.innerHTML = this.expanded
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <polyline points="4 14 10 14 10 20"/>
             <polyline points="20 10 14 10 14 4"/>
             <line x1="14" y1="10" x2="21" y2="3"/>
             <line x1="3" y1="21" x2="10" y2="14"/>
           </svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <polyline points="15 3 21 3 21 9"/>
             <polyline points="9 21 3 21 3 15"/>
             <line x1="21" y1="3" x2="14" y2="10"/>
             <line x1="3" y1="21" x2="10" y2="14"/>
           </svg>`;
    }

    async copySessionId() {
      if (await this.copyText(this.sessionId)) {
        this.copySessionBtn.textContent = "Copiado";
        this.showToast("ID de sesión copiado.", { tone: "success" });
      } else {
        this.addMessage("system", `ID de sesión: ${this.sessionId}`);
        this.copySessionBtn.textContent = "Ver";
      }
      setTimeout(() => { this.copySessionBtn.textContent = "Copiar"; }, 1200);
    }

    async copyText(text) {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(String(text || ""));
          return true;
        }
      } catch {
        // HTTP o permisos del navegador: usa el fallback compatible.
      }
      const textarea = document.createElement("textarea");
      textarea.value = String(text || "");
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      textarea.remove();
      return copied;
    }

    showToast(message, { tone = "info", duration = 2600, actionLabel = "", onAction = null } = {}) {
      if (!this.toastRegion || !message) return;
      const toast = document.createElement("div");
      toast.className = `toast ${tone}`;
      const text = document.createElement("span");
      text.textContent = message;
      toast.appendChild(text);
      if (actionLabel && typeof onAction === "function") {
        const action = document.createElement("button");
        action.type = "button";
        action.textContent = actionLabel;
        action.addEventListener("click", () => {
          toast.remove();
          onAction();
        });
        toast.appendChild(action);
        duration = Math.max(duration, 6000);
      }
      this.toastRegion.appendChild(toast);
      while (this.toastRegion.children.length > 3) this.toastRegion.firstElementChild?.remove();
      window.setTimeout(() => {
        toast.classList.add("leaving");
        window.setTimeout(() => toast.remove(), 180);
      }, duration);
    }

    addSystemNotice(text, { actionLabel = "", onAction = null, tone = "error" } = {}) {
      this.clearWelcome();
      const notice = document.createElement("div");
      notice.className = `msg msg-system system-notice ${tone}`;
      const label = document.createElement("span");
      label.textContent = text;
      notice.appendChild(label);
      if (actionLabel && typeof onAction === "function") {
        const action = document.createElement("button");
        action.type = "button";
        action.textContent = actionLabel;
        action.addEventListener("click", () => {
          notice.remove();
          onAction();
        });
        notice.appendChild(action);
      }
      this.messagesEl.appendChild(notice);
      this.scrollToBottom();
      return notice;
    }

    retryUserMessage(text) {
      if (!this.input || this.busy || this.readOnlyConversation) return;
      this.input.value = String(text || "");
      this.autoResizeInput();
      this.focusComposer();
      this.sendMessage();
    }

    createCopyButton(getText) {
      const button = document.createElement("button");
      button.className = "msg-copy-btn";
      button.type = "button";
      button.title = "Copiar mensaje";
      button.setAttribute("aria-label", "Copiar mensaje");
      button.innerHTML = COPY_ICON;
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const copied = await this.copyText(typeof getText === "function" ? getText() : "");
        button.classList.toggle("copied", copied);
        button.title = copied ? "Mensaje copiado" : "No se pudo copiar";
        button.setAttribute("aria-label", button.title);
        if (copied) {
          button.innerHTML = "✓";
          this.showToast("Mensaje copiado.", { tone: "success" });
        } else {
          this.showToast("No se pudo copiar el mensaje.", { tone: "error" });
        }
        window.setTimeout(() => {
          if (!button.isConnected) return;
          button.classList.remove("copied");
          button.title = "Copiar mensaje";
          button.setAttribute("aria-label", "Copiar mensaje");
          button.innerHTML = COPY_ICON;
        }, 1400);
      });
      return button;
    }

    async newSession() {
      if (this.creatingSession) return;
      this.creatingSession = true;
      try {
        await this.loadConversations().catch(() => {});
        const emptyConversation = this.emptyConversationItem();
        if (emptyConversation) {
          if (emptyConversation.id !== this.sessionId) {
            await this.openConversation(emptyConversation.id);
          } else {
            this.renderWelcome();
          }
          return;
        }

        this.sessionId = createSessionId();
        this.setBusy(false);
        this.setReadOnlyConversation(false);
        localStorage.setItem(SESSION_KEY, this.sessionId);
        this.updateSessionDisplay();
        await fetch(`${API_URL}/api/conversations`, {
          method: "POST",
          headers: requestHeaders(),
          body: JSON.stringify({
            session_id: this.sessionId,
            user: SUPERSET_USER || null,
            user_display_name: SUPERSET_DISPLAY_NAME || null,
            mcp_url: MCP_URL || null,
            dashboard_id: currentDashboardId(),
            page_url: window.location.href,
          }),
        }).catch(() => {});
        this.clearCharts();
        this.messagesEl.innerHTML = "";
        this.suggestionChipsEl = null;
        this.assistantEl = null;
        this.assistantText = "";
        this.progressEl = null;
        this.progressTextEl = null;
        this.suggestionAnchorEl = null;
        this.resetActivityRefs();
        this.suppressAssistantStream = false;
        this.renderWelcome();
        await this.loadConversations().catch(() => {});
      } finally {
        this.creatingSession = false;
      }
    }

    async loadModelOptions() {
      try {
        const resp = await fetch(`${API_URL}/api/models`);
        if (!resp.ok) return;
        const data = await resp.json();
        this.modelOptions = Array.isArray(data.models) ? data.models : [];
        this.maxConcurrentChats = Math.max(1, Number(data.max_concurrent_chats_per_user) || 2);
        if (data.default_model && typeof data.default_model === "object") {
          this.defaultModelBackend = data.default_model.backend || this.defaultModelBackend;
          this.defaultModelName = data.default_model.model || this.defaultModelName;
        }
        this.allowDebug = data.allow_debug === true;
        this.updateHeaderModel();
        if (data.ui && typeof data.ui === "object") {
          this.serverTheme = String(data.ui.theme || "").trim().toLowerCase() === "dark"
            ? "dark"
            : "light";
          this.applyResolvedTheme();
          this.uiFeatures = {
            dynamicDashboardHint: data.ui.dynamic_dashboard_hint === true,
            dynamicDashboardHintModel: data.ui.dynamic_dashboard_hint_model === true,
            dashboardHintInterventionLevel: Math.max(0, Math.min(Number(data.ui.dashboard_hint_intervention_level) || 0, 2)),
            answerSuggestions: data.ui.answer_suggestions === true,
            answerSuggestionsModel: data.ui.answer_suggestions_model === true,
            answerSuggestionsInterventionLevel: Math.max(0, Math.min(Number(data.ui.answer_suggestions_intervention_level) || 0, 2)),
            suggestionsMaxItems: Math.max(1, Math.min(Number(data.ui.suggestions_max_items) || 3, 4)),
          };
        }
        this.applyDebugAvailability();
        this.ensureSelectedModel(false, true);
        this.renderModelSelectors();
      } catch {
        this.modelOptions = [];
        this.allowDebug = false;
        this.applyDebugAvailability();
      }
    }

    applyResolvedTheme() {
      this.theme = this.themeOverride || this.serverTheme;
      if (this.host) this.host.dataset.theme = this.theme;
      this.refreshChartThemes();
    }

    ensureSelectedModel(resetModel, preferDefaultOnInvalid = false) {
      if (!this.modelOptions.length) return;
      const preferred = this.modelOptions.find(
        (item) => item.backend === this.defaultModelBackend && item.model === this.defaultModelName
      );
      const hasStoredSelection = Boolean(this.modelBackend && this.modelName);
      if (!hasStoredSelection && preferred) {
        this.modelBackend = preferred.backend;
        this.modelName = preferred.model;
        localStorage.setItem(MODEL_BACKEND_KEY, this.modelBackend);
        localStorage.setItem(MODEL_NAME_KEY, this.modelName);
        return;
      }
      const hasBackend = this.modelOptions.some((item) => item.backend === this.modelBackend);
      if (!hasBackend) {
        this.modelBackend = (preferred || this.modelOptions[0]).backend;
        localStorage.setItem(MODEL_BACKEND_KEY, this.modelBackend);
        resetModel = true;
      }
      const modelsForBackend = this.modelOptions.filter((item) => item.backend === this.modelBackend);
      const hasModel = !resetModel && modelsForBackend.some((item) => item.model === this.modelName);
      if (!hasModel && modelsForBackend.length) {
        if (preferDefaultOnInvalid && preferred) {
          this.modelBackend = preferred.backend;
          this.modelName = preferred.model;
          localStorage.setItem(MODEL_BACKEND_KEY, this.modelBackend);
          localStorage.setItem(MODEL_NAME_KEY, this.modelName);
          return;
        }
        const preferredForBackend = modelsForBackend.find((item) => item.model === this.defaultModelName);
        this.modelName = (preferredForBackend || modelsForBackend[0]).model;
        localStorage.setItem(MODEL_NAME_KEY, this.modelName);
      }
    }

    renderModelSelectors() {
      const backends = [...new Set(this.modelOptions.map((item) => item.backend))];
      this.modelBackendSelect.innerHTML = "";
      for (const backend of backends) {
        const option = document.createElement("option");
        option.value = backend;
        option.textContent = backend;
        this.modelBackendSelect.appendChild(option);
      }
      this.modelBackendSelect.value = this.modelBackend;

      const modelsForBackend = this.modelOptions.filter((item) => item.backend === this.modelBackend);
      this.modelNameSelect.innerHTML = "";
      for (const item of modelsForBackend) {
        const option = document.createElement("option");
        option.value = item.model;
        option.textContent = item.model;
        this.modelNameSelect.appendChild(option);
      }
      this.modelNameSelect.value = this.modelName;
      this.updateModelControls();
    }

    updateModelControls() {
      const show = this.customModel;
      this.modelControls.classList.toggle("hidden", !show);
      this.modelBackendSelect.disabled = !show || !this.modelOptions.length;
      this.modelNameSelect.disabled    = !show || !this.modelOptions.length;
    }

    setOpen(open) {
      if (open) {
        this.hideLauncherHint();
        if (this.bubble) this.bubble.classList.remove("has-notification", "working");
        this.resetLauncherPosition();
        this.panel.classList.remove("hidden");
        this.panel.classList.add("animating-in");
        this.panel.addEventListener("animationend", () => {
          this.panel.classList.remove("animating-in");
        }, { once: true });
        this.bubble.classList.add("hidden");
        this.input.focus();
        this.autoResizeInput();
        setTimeout(() => this.resizeCharts(), 120);
      } else {
        this.panel.classList.add("hidden");
        this.bubble.classList.remove("hidden");
        this.closeHeaderMenu();
        this.setHistoryOpen(false);
        this.closeSettings();
        this.updateLauncherActivityState();
        if (!this.busy) this.updateLauncherHint();
      }
    }

    setStatus(text) {
      this.statusTextEl.textContent = text || "";
      this.statusEl.classList.toggle("hidden", !text);
    }

    setProgress(stateOrText) {
      if (this.debug) return;
      const text = PROGRESS_LABELS[stateOrText] || stateOrText || "";
      if (!text) { this.clearProgress(); return; }
      this.progressStatusText = text;
      this.setStatus(text);
    }

    clearProgress() {
      if (this.progressStatusText && this.statusTextEl?.textContent === this.progressStatusText) {
        this.setStatus("");
      }
      this.progressStatusText = "";
      if (this.progressEl?.isConnected) this.progressEl.remove();
      this.progressEl = null;
      this.progressTextEl = null;
    }

    resetActivityRefs() {
      this.activityEl = null;
      this.activitySummaryEl = null;
      this.activityListEl = null;
      this.activityCount = 0;
      this.lastActivityText = "";
    }

    beginActivity() {
      this.resetActivityRefs();
      this.taskPlanEl = null;
      this.taskPlan = null;
    }

    renderTaskPlan(plan) {
      if (!plan || !Array.isArray(plan.tasks)) return;
      this.taskPlan = plan;
      if (!this.taskPlanEl) {
        this.taskPlanEl = document.createElement("section");
        this.taskPlanEl.className = "msg task-plan";
        this.messagesEl.appendChild(this.taskPlanEl);
      }
      const completed = plan.tasks.filter((task) => task.status === "completed").length;
      const failed = plan.tasks.filter((task) => task.status === "failed").length;
      const statusText = plan.status === "completed"
        ? "Completado"
        : plan.status === "partial"
          ? "Completado parcialmente"
          : plan.status === "cancelled"
            ? "Cancelado"
            : `En curso · ${Math.max(1, Number(plan.current || 1))}/${plan.total}`;
      const items = plan.tasks.map((task, index) => {
        const status = task.status || "pending";
        const icon = status === "completed" ? "✓" : status === "failed" ? "!" : status === "running" ? "●" : "○";
        return `<li class="${escapeAttr(status)}"><span class="task-plan-icon">${icon}</span><span><strong>${index + 1}.</strong> ${escapeHtml(task.title || `Análisis ${index + 1}`)}</span></li>`;
      }).join("");
      const resultText = failed ? ` · ${completed} listos, ${failed} con error` : completed ? ` · ${completed} listos` : "";
      const finished = ["completed", "partial", "cancelled"].includes(plan.status);
      this.taskPlanEl.classList.toggle("collapsed", finished);
      this.taskPlanEl.innerHTML = `
        <button class="task-plan-header" type="button" aria-expanded="${finished ? "false" : "true"}">
          <span>Plan de análisis</span>
          <small>${escapeHtml(statusText + resultText)}</small>
        </button>
        <ol>${items}</ol>
      `;
      this.taskPlanEl.querySelector(".task-plan-header")?.addEventListener("click", () => {
        const collapsed = this.taskPlanEl.classList.toggle("collapsed");
        this.taskPlanEl.querySelector(".task-plan-header")
          ?.setAttribute("aria-expanded", collapsed ? "false" : "true");
      });
      this.scrollToBottom();
    }

    ensureActivityPanel() {
      if (this.debug) return null;
      if (this.activityEl) return this.activityEl;

      const details = document.createElement("details");
      details.className = "msg activity-panel";
      details.open = true;

      const summary = document.createElement("summary");
      summary.textContent = "Trabajando";
      const list = document.createElement("ol");
      list.className = "activity-list";

      details.appendChild(summary);
      details.appendChild(list);
      this.messagesEl.appendChild(details);

      this.activityEl = details;
      this.activitySummaryEl = summary;
      this.activityListEl = list;
      return details;
    }

    activityStepKey(message) {
      const text = String(message || "").toLocaleLowerCase("es");
      if (text.includes("contexto") || text.includes("dataset resuelto") || text.includes("datos y filtros")) return "context";
      if (text.includes("filtro") || text.includes("valor verificado") || text.includes("valores encontrados")) return "filters";
      if (text.includes("compar")) return "compare";
      if (text.includes("pronóstico")) return "forecast";
      if (text.includes("excel")) return "export";
      if (text.includes("gráfico") || text.includes("visualización")) return "chart";
      if (text.includes("resumen estadístico") || text.includes("conjunto completo") || text.includes("criterios")) return "summary";
      if (text.includes("consulta") || text.includes("datos obtenidos")) return "query";
      if (text.includes("dashboard") && text.includes("busc")) return "dashboard-search";
      return text.replace(/[^a-z0-9áéíóúüñ]+/gi, "-").slice(0, 80);
    }

    addActivity(message) {
      const text = String(message || "").trim();
      if (!text || text === this.lastActivityText) return;
      this.ensureActivityPanel();
      if (!this.activityListEl || !this.activitySummaryEl) return;

      const previous = this.activityListEl.querySelector("li.active");
      if (previous) previous.classList.remove("active");

      const stepKey = this.activityStepKey(text);
      let item = Array.from(this.activityListEl.children)
        .find((candidate) => candidate.dataset.stepKey === stepKey);
      if (!item) {
        item = document.createElement("li");
        item.dataset.stepKey = stepKey;
        this.activityCount += 1;
      }
      item.className = "active";
      item.textContent = text;
      this.activityListEl.appendChild(item);
      while (this.activityListEl.children.length > 6) {
        this.activityListEl.firstElementChild?.remove();
      }
      this.lastActivityText = text;
      this.activitySummaryEl.textContent = `Trabajando · ${text.replace(/[.]$/, "")}`;
      this.scrollToBottom();
    }

    collapseActivity(label = "Completado") {
      if (this.taskPlanEl) {
        this.taskPlanEl.classList.add("collapsed");
        this.taskPlanEl.querySelector(".task-plan-header")?.setAttribute("aria-expanded", "false");
      }
      if (!this.activityEl || !this.activitySummaryEl) return;
      const active = this.activityListEl?.querySelector("li.active");
      if (active) active.classList.remove("active");
      this.activityEl.open = false;
      const steps = this.activityCount === 1 ? "1 paso" : `${this.activityCount} pasos`;
      this.activitySummaryEl.textContent = `${label} · ${steps}`;
    }

    clearCharts() {
      for (const entry of this.chartInstances) {
        const chart = entry?.chart;
        if (chart && typeof chart.dispose === "function") chart.dispose();
      }
      this.chartInstances = [];
      this.pendingChartTool = false;
    }

    addMessage(role, text, markdown = false, metaText = "") {
      this.clearWelcome();
      const el = document.createElement("div");
      el.className = `msg msg-${role}`;
      if (role === "user" && metaText) {
        const meta = document.createElement("div");
        meta.className = "msg-meta";
        meta.textContent = metaText;
        this.messagesEl.appendChild(meta);
      }
      if (markdown) {
        el.innerHTML = renderMarkdown(text);
      } else {
        el.textContent = text;
      }
      if (role === "assistant") {
        const row = this.wrapAssistantMessage(el);
        this.messagesEl.appendChild(row);
        this.suggestionAnchorEl = row;
      } else if (role === "user") {
        const row = document.createElement("div");
        row.className = "msg-row-user";
        const copyButton = this.createCopyButton(() => text);
        row.appendChild(copyButton);
        row.appendChild(el);
        this.messagesEl.appendChild(row);
      } else {
        this.messagesEl.appendChild(el);
      }
      this.scrollToBottom();
      return el;
    }

    formatDuration(ms) {
      const seconds = Math.max(0, ms / 1000);
      if (seconds < 10) return `${seconds.toFixed(1)} s`;
      if (seconds < 60) return `${Math.round(seconds)} s`;
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = Math.round(seconds % 60).toString().padStart(2, "0");
      return `${minutes} min ${remainingSeconds} s`;
    }

    addTurnDuration(startedAt = this.turnStartedAt) {
      if (!startedAt || this.turnDurationEl) return;
      const elapsed = performance.now() - startedAt;
      const el = document.createElement("div");
      el.className = "turn-duration";
      el.textContent = `Respondió en ${this.formatDuration(elapsed)}`;
      this.messagesEl.appendChild(el);
      this.turnDurationEl = el;
      this.scrollToBottom();
    }

    wrapAssistantMessage(bubble, { chart = false } = {}) {
      const row = document.createElement("div");
      row.className = `msg-row msg-row-assistant${chart ? " msg-row-chart" : ""}`;
      const avatar = document.createElement("img");
      avatar.className = "msg-avatar";
      avatar.src = LOGO_URL;
      avatar.alt = "El Don con IA";
      avatar.loading = "lazy";
      row.appendChild(avatar);
      row.appendChild(bubble);
      if (!chart) {
        const copyButton = this.createCopyButton(() => bubble.innerText || bubble.textContent || "");
        copyButton.classList.add("msg-copy-assistant");
        row.appendChild(copyButton);
      }
      bubble._messageRow = row;
      return row;
    }

    clearSuggestionChips({ invalidatePending = true } = {}) {
      if (invalidatePending) this.suggestionRequestSeq += 1;
      if (this.suggestionChipsEl) {
        this.suggestionChipsEl.remove();
      }
      this.suggestionChipsEl = null;
      if (this.suggestionFloatEl) {
        this.suggestionFloatEl.classList.add("hidden");
        this.suggestionFloatEl.classList.remove("is-visible");
        this.suggestionFloatEl.classList.remove("is-docked");
        this.suggestionFloatEl.innerHTML = "";
      }
      if (this.messagesEl) {
        this.messagesEl.classList.remove("has-floating-suggestions");
        this.messagesEl.style.removeProperty("--suggestion-float-space");
      }
    }

    addSuggestionChips(items) {
      const suggestions = (Array.isArray(items) ? items : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, Math.max(1, Math.min(this.uiFeatures.suggestionsMaxItems || 3, 4)));
      const shouldStayAtBottom = this.isNearBottom();
      this.clearSuggestionChips({ invalidatePending: false });
      if (!suggestions.length || !this.suggestionFloatEl) return;

      const wrap = document.createElement("div");
      wrap.className = "suggestion-chips";
      for (const suggestion of suggestions) {
        const chip = document.createElement("button");
        chip.className = "suggestion-chip";
        chip.type = "button";
        chip.title = suggestion;
        chip.setAttribute("aria-label", suggestion);
        chip.dataset.fullText = suggestion;
        const label = document.createElement("span");
        label.className = "suggestion-chip-label";
        label.textContent = suggestion;
        chip.appendChild(label);
        chip.addEventListener("click", () => {
          if (this.busy || !this.input) return;
          this.input.value = suggestion;
          this.autoResizeInput();
          this.sendMessage();
        });
        wrap.appendChild(chip);
      }
      this.suggestionChipsEl = wrap;
      this.suggestionFloatEl.innerHTML = "";
      this.suggestionFloatEl.appendChild(wrap);
      this.updateSuggestionFloatVisibility();
      if (shouldStayAtBottom && this.suggestionFloatEl.classList.contains("is-visible")) {
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      }
    }

    async loadAnswerSuggestions(answer, context = {}) {
      if (!this.uiFeatures.answerSuggestions || !answer || answer.length < 20) return;
      const requestSeq = ++this.suggestionRequestSeq;
      const targetSessionId = context.sessionId || this.sessionId;
      try {
        const resp = await fetch(`${API_URL}/api/ui/answer-suggestions`, {
          method: "POST",
          headers: requestHeaders(),
          body: JSON.stringify({
            answer,
            user_message: context.userMessage || this.lastUserMessage || null,
            session_id: targetSessionId,
            dashboard_id: context.dashboardId || this.lastTurnDashboardId || currentDashboardId(),
            dashboard_title: context.dashboardTitle || this.lastTurnDashboardTitle || currentDashboardTitle() || null,
            page_url: window.location.href,
            mcp_url: MCP_URL || null,
            user: SUPERSET_USER || null,
          }),
        });
        if (!resp.ok || requestSeq !== this.suggestionRequestSeq || targetSessionId !== this.sessionId) return;
        const data = await resp.json();
        this.addSuggestionChips(data.suggestions);
      } catch {
        // Las sugerencias son accesorias; la respuesta principal ya está lista.
      }
    }

    addChartBubble() {
      const bubble = document.createElement("div");
      bubble.className = "msg msg-assistant msg-chart";
      const container = document.createElement("div");
      container.className = "echarts-container";
      bubble.appendChild(container);
      const row = this.wrapAssistantMessage(bubble, { chart: true });
      this.messagesEl.appendChild(row);
      this.suggestionAnchorEl = row;
      this.scrollToBottom();
      return container;
    }

    addTableBubble(tableData) {
      const columns = Array.isArray(tableData?.columns) ? tableData.columns : [];
      const rows = Array.isArray(tableData?.rows) ? tableData.rows : [];
      if (!columns.length) return;

      const bubble = document.createElement("div");
      bubble.className = "msg msg-assistant msg-chart";
      const wrapper = document.createElement("div");
      wrapper.className = "table-wrap";
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");

      for (const column of columns) {
        const th = document.createElement("th");
        th.textContent = column == null ? "" : String(column);
        headerRow.appendChild(th);
      }
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      for (const row of rows) {
        const tr = document.createElement("tr");
        const cells = Array.isArray(row) ? row : [];
        for (let index = 0; index < columns.length; index += 1) {
          const td = document.createElement("td");
          const cell = cells[index];
          td.textContent = formatTableCell(cell);
          if (typeof cell === "number") td.classList.add("align-right");
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrapper.appendChild(table);
      bubble.appendChild(wrapper);
      const row = this.wrapAssistantMessage(bubble, { chart: true });
      this.messagesEl.appendChild(row);
      this.suggestionAnchorEl = row;
      this.scrollToBottom();
    }

    async renderChartBubble(echartsOption) {
      this.clearProgress();
      const container = this.addChartBubble();
      try {
        const echarts = await ensureEcharts();
        const chart = echarts.init(container);
        const sourceOption = cloneChartOption(echartsOption);
        chart.setOption(prepareChartOption(sourceOption, this.theme), true);
        this.chartInstances.push({ chart, sourceOption });
        if (typeof ResizeObserver !== "undefined") {
          new ResizeObserver(() => chart.resize()).observe(container);
        }
        setTimeout(() => chart.resize(), 0);
      } catch (err) {
        container.innerHTML = `<div class="chart-error">${escapeHtml(err.message || "No se pudo renderizar el gráfico.")}</div>`;
      }
      this.scrollToBottom();
    }

    resizeCharts() {
      for (const entry of this.chartInstances) {
        const chart = entry?.chart;
        if (chart && typeof chart.resize === "function") chart.resize();
      }
    }

    refreshChartThemes() {
      if (!Array.isArray(this.chartInstances)) return;
      for (const entry of this.chartInstances) {
        const chart = entry?.chart;
        if (!chart || typeof chart.setOption !== "function" || !entry.sourceOption) continue;
        chart.setOption(prepareChartOption(entry.sourceOption, this.theme), true);
      }
    }

    renderChartToolResult(data) {
      let parsed;
      try {
        parsed = JSON.parse(data.output || "");
      } catch {
        this.pendingChartTool = false;
        return false;
      }
      if (!parsed || parsed.status !== "success" || !parsed.echarts_option) {
        if (parsed && parsed.status === "success" && parsed.table_data) {
          this.pendingChartTool = false;
          this.clearProgress();
          this.addTableBubble(parsed.table_data);
          return true;
        }
        this.pendingChartTool = false;
        return false;
      }
      this.pendingChartTool = false;
      this.renderChartBubble(parsed.echarts_option);
      return true;
    }

    addModelTag(model) {
      const el = document.createElement("div");
      el.className = "model-tag";
      el.textContent = model;
      this.messagesEl.appendChild(el);
      this.scrollToBottom();
    }

    addDebugEntry(label, text) {
      const el = document.createElement("div");
      el.className = "debug-entry";
      const labelEl = document.createElement("span");
      labelEl.className = "debug-label";
      labelEl.textContent = label;
      const pre = document.createElement("pre");
      pre.textContent = text;
      el.appendChild(labelEl);
      el.appendChild(pre);
      this.messagesEl.appendChild(el);
      this.scrollToBottom();
    }

    clearAssistantDraft() {
      if (!this.assistantEl) return;
      const row = this.assistantEl._messageRow;
      if (row && row.isConnected) {
        row.remove();
      } else {
        this.assistantEl.remove();
      }
      this.assistantEl = null;
      this.assistantText = "";
    }

    appendAssistantToken(text) {
      const chunk = text == null ? "" : String(text);
      if (!chunk) return;
      if (!this.assistantText) {
        this.assistantText = chunk;
        return;
      }
      if (chunk === this.assistantText) return;
      if (chunk.startsWith(this.assistantText)) {
        this.assistantText = chunk;
        return;
      }

      const maxOverlap = Math.min(this.assistantText.length, chunk.length, 1000);
      for (let size = maxOverlap; size >= 20; size -= 1) {
        if (this.assistantText.endsWith(chunk.slice(0, size))) {
          this.assistantText += chunk.slice(size);
          return;
        }
      }
      this.assistantText += chunk;
    }

    scrollToBottom() {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      this.updateSuggestionFloatVisibility();
    }

    isNearBottom(threshold = 56) {
      if (!this.messagesEl) return true;
      const distance = this.messagesEl.scrollHeight - this.messagesEl.scrollTop - this.messagesEl.clientHeight;
      return distance <= threshold;
    }

    updateSuggestionFloatVisibility() {
      if (!this.suggestionFloatEl || !this.messagesEl) return;
      const visible = Boolean(this.suggestionChipsEl);
      const docked = visible && this.isNearBottom(140);
      this.suggestionFloatEl.classList.toggle("hidden", !visible);
      this.suggestionFloatEl.classList.toggle("is-visible", visible);
      this.suggestionFloatEl.classList.toggle("is-docked", docked);
      this.messagesEl.classList.toggle("has-floating-suggestions", visible && !docked);
      if (visible && !docked) {
        const height = Math.ceil(this.suggestionFloatEl.getBoundingClientRect().height || 0);
        const bottom = Number.parseFloat(getComputedStyle(this.suggestionFloatEl).bottom) || 0;
        this.messagesEl.style.setProperty("--suggestion-float-space", `${height + bottom + 18}px`);
      } else {
        this.messagesEl.style.removeProperty("--suggestion-float-space");
      }
    }

    setBusy(busy) {
      this.busy = busy;
      const selectorsEnabled = this.customModel && this.modelOptions.length;
      this.input.disabled              = busy || this.readOnlyConversation;
      this.sendBtn.disabled            = this.readOnlyConversation && !busy;
      this.debugToggle.disabled        = busy;
      this.customModelToggle.disabled  = busy;
      this.newSessionBtn.disabled      = false;
      this.modelBackendSelect.disabled = busy || !selectorsEnabled;
      this.modelNameSelect.disabled    = busy || !selectorsEnabled;
      this.cancelBtn.classList.add("hidden");
      if (this.archiveCurrentBtn) this.archiveCurrentBtn.disabled = busy || this.readOnlyConversation;
      if (this.conversationRefreshBtn) this.conversationRefreshBtn.disabled = false;
      this.conversationNewBtn.disabled = false;
      this.topNewSessionBtn.disabled   = false;
      this.sendBtn.classList.toggle("stop", busy);
      this.sendBtn.title = busy ? "Detener respuesta" : "Enviar";
      this.sendBtn.setAttribute("aria-label", busy ? "Detener respuesta" : "Enviar");
      this.sendBtn.innerHTML = busy ? STOP_ICON : SEND_ICON;
      if (this.aiDisclaimer) {
        this.aiDisclaimer.classList.toggle("hidden", !busy);
      }
      this.applyDebugAvailability();
      this.updateLauncherActivityState();
    }

    async resetSession() {
      if (this.busy) return;
      await this.newSession();
    }

    async cancelTurn() {
      if (!this.busy) return;
      this.setProgress("canceling");
      const job = this.activeTurns.get(this.sessionId);
      if (job?.controller) job.controller.abort();
      await fetch(`${API_URL}/api/chat/cancel`, {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify({ session_id: this.sessionId }),
      }).catch(() => {});
      this.activeTurns.delete(String(this.sessionId));
      this.remoteBusySessionIds.delete(String(this.sessionId));
      this.suppressAssistantStream = false;
      this.clearAssistantDraft();
      this.setStatus("");
      this.clearProgress();
      this.setBusy(false);
      this.loadConversations().catch(() => {});
    }

    async sendMessage() {
      const text = this.input.value.trim();
      if (!text || this.busy || this.readOnlyConversation) return;
      const activeSessionIds = new Set([
        ...this.activeTurns.keys(),
        ...this.remoteBusySessionIds,
      ]);
      if (activeSessionIds.size >= this.maxConcurrentChats) {
        this.addMessage(
          "system",
          `Ya tienes ${this.maxConcurrentChats} conversaciones trabajando. Espera o cancela una para continuar.`
        );
        return;
      }
      this.input.value = "";
      this.autoResizeInput();
      this.clearWelcome();
      this.clearSuggestionChips();
      const dashboardTitle = currentDashboardTitle();
      const dashboardId = currentDashboardId();
      this.lastUserMessage = text;
      this.lastTurnDashboardId = dashboardId || "";
      this.lastTurnDashboardTitle = dashboardTitle || "";
      this.addMessage("user", text, false, this.dashboardSourceLabel(dashboardTitle, currentDashboardId()));
      this.assistantEl = null;
      this.assistantText = "";
      this.suppressAssistantStream = false;
      this.lastTurnCompleted = false;
      this.turnStartedAt = performance.now();
      this.turnDurationEl = null;
      this.beginActivity();
      const sessionId = String(this.sessionId);
      const controller = new AbortController();
      const job = {
        controller,
        state: "thinking",
        message: "Analizando tu solicitud…",
        taskPlan: null,
        startedAt: performance.now(),
        userMessage: text,
        dashboardId: dashboardId || "",
        dashboardTitle: dashboardTitle || "",
        completed: false,
      };
      this.activeTurns.set(sessionId, job);
      this.remoteBusySessionIds.add(sessionId);
      this.setBusy(true);
      this.setStatus(STATUS_LABELS.thinking);
      this.setProgress("thinking");

      try {
        const useCustomModel = this.customModel && this.modelBackend && this.modelName;
        const payload = {
          session_id: sessionId,
          message: text,
          debug: this.debug,
          custom_model: Boolean(useCustomModel),
          model_backend: useCustomModel ? this.modelBackend : null,
          model_name:    useCustomModel ? this.modelName    : null,
          page_url: window.location.href,
          dashboard_id: dashboardId,
          dashboard_title: dashboardTitle || null,
          mcp_url: MCP_URL || null,
          user: SUPERSET_USER || null,
          user_display_name: SUPERSET_DISPLAY_NAME || null,
        };
        const resp = await this.fetchChat(payload, controller);

        if (resp.status === 409 || resp.status === 429) {
          let message = resp.status === 429
            ? `Ya tienes ${this.maxConcurrentChats} conversaciones trabajando. Espera o cancela una para continuar.`
            : "Ya hay una respuesta en curso para esta sesión.";
          try {
            const data = await resp.json();
            if (data.error) message = data.error;
          } catch {}
          if (sessionId === this.sessionId) this.addMessage("system", message);
          return;
        }
        if (!resp.ok || !resp.body) {
          let message = `HTTP ${resp.status}`;
          try {
            const data = await resp.json();
            if (data.error) message = data.error;
          } catch {}
          throw new Error(message);
        }

        await this._consumeStream(resp.body, sessionId);
      } catch (err) {
        if (sessionId === this.sessionId) {
          if (err.name === "AbortError") {
            this.collapseActivity("Actividad cancelada");
          } else {
            this.clearProgress();
            this.collapseActivity("Actividad interrumpida");
            this.addSystemNotice(`Error de conexión: ${err.message}`, {
              actionLabel: "Reintentar",
              onAction: () => this.retryUserMessage(text),
            });
          }
        }
      } finally {
        this.activeTurns.delete(sessionId);
        this.remoteBusySessionIds.delete(sessionId);
        if (sessionId === this.sessionId) {
          const finishedWhileMinimized = !this.isPanelOpen();
          this.setStatus("");
          this.clearProgress();
          this.setBusy(false);
          if (finishedWhileMinimized && job.completed) this.showLauncherDoneNotification();
          this.updateModelControls();
        } else if (job.completed) {
          this.showLauncherDoneNotification();
        }
        this.loadConversations().catch(() => {});
      }
    }

    fetchChat(payload, controller) {
      return fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    }

    async _consumeStream(body, sessionId) {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let match;
        while ((match = buffer.match(/\r\n\r\n|\n\n/))) {
          const frame = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          const parsed = parseSseFrame(frame);
          if (parsed) this.handleEvent(parsed.data, sessionId);
        }
      }
    }

    handleEvent(data, sessionId = this.sessionId) {
      const job = this.activeTurns.get(String(sessionId));
      if (job) {
        if (data.type === "task_plan" && data.plan) {
          job.taskPlan = data.plan;
          if (data.plan.current && data.plan.total) {
            job.message = `Análisis ${data.plan.current}/${data.plan.total}`;
          }
        }
        else if (data.type === "status" && data.state) job.state = data.state;
        else if (data.type === "tool_call") job.state = "calling_tool";
        else if (data.type === "thinking") job.state = "thinking";
        else if (data.type === "activity") {
          job.state = "activity";
          job.message = String(data.message || "").trim() || job.message;
        }
        else if (data.type === "tool_result") job.state = "responding";
        else if (data.type === "task_result") job.state = "thinking";
        else if (data.type === "done") {
          job.state = "done";
          job.completed = true;
          if (String(sessionId) === String(this.sessionId)) {
            this.completedTurnIds.delete(String(sessionId));
          } else {
            this.completedTurnIds.add(String(sessionId));
          }
        } else if (data.type === "error") {
          job.state = "error";
        }
      }
      if (data.type !== "token") this.renderConversationList();
      if (String(sessionId) !== String(this.sessionId)) return;
      switch (data.type) {
        case "task_plan":
          this.renderTaskPlan(data.plan);
          break;
        case "task_result":
          if (data.model) this.updateHeaderModel(data.model);
          this.suppressAssistantStream = false;
          this.clearProgress();
          if (data.answer && data.answer !== this.assistantText) {
            if (!this.assistantEl) {
              this.assistantEl = this.addMessage("assistant", data.answer, true);
            } else {
              this.assistantEl.innerHTML = renderMarkdown(data.answer);
            }
          }
          this.assistantEl = null;
          this.assistantText = "";
          this.pendingChartTool = false;
          break;
        case "status":
          this.setStatus(STATUS_LABELS[data.state] || "");
          this.setProgress(data.state);
          break;
        case "token":
          this.clearProgress();
          if (containsToolMarkup(`${this.assistantText}${data.text || ""}`)) {
            this.suppressAssistantStream = true;
            this.clearAssistantDraft();
            return;
          }
          if (this.suppressAssistantStream) return;
          if (!this.assistantEl) {
            this.assistantEl = this.addMessage("assistant", "", true);
            this.assistantText = "";
          }
          this.appendAssistantToken(data.text);
          this.assistantEl.innerHTML = renderMarkdown(this.assistantText);
          this.scrollToBottom();
          break;
        case "answer_reset":
          this.suppressAssistantStream = false;
          this.clearAssistantDraft();
          this.setProgress("thinking");
          break;
        case "activity":
          this.addActivity(data.message);
          this.setProgress(data.message);
          break;
        case "thinking":
          this.setProgress("thinking");
          if (this.debug) this.addDebugEntry("Razonamiento", data.text);
          break;
        case "tool_call":
          this.suppressAssistantStream = true;
          this.clearAssistantDraft();
          this.setProgress("calling_tool");
          this.pendingChartTool = isChartOptionToolName(toolNameFromEvent(data));
          if (this.debug) {
            this.addDebugEntry(`Llamada: ${data.name}`, JSON.stringify(data.arguments, null, 2));
          }
          break;
        case "tool_result":
          if (
            data.render === "echarts"
            || isChartOptionToolName(toolNameFromEvent(data))
            || this.pendingChartTool
          ) {
            if (this.renderChartToolResult(data)) break;
          }
          this.suppressAssistantStream = false;
          this.setProgress("responding");
          if (this.debug) this.addDebugEntry(`Resultado: ${data.name}`, data.output);
          break;
        case "warning":
          this.addMessage("system", data.message);
          break;
        case "error":
          this.lastTurnCompleted = false;
          this.clearProgress();
          this.collapseActivity("Actividad interrumpida");
          this.addSystemNotice(`Error: ${data.message}`, {
            actionLabel: job?.userMessage ? "Reintentar" : "",
            onAction: job?.userMessage ? () => this.retryUserMessage(job.userMessage) : null,
          });
          break;
        case "done":
          this.lastTurnCompleted = true;
          this.suppressAssistantStream = false;
          this.setStatus("");
          this.clearProgress();
          this.collapseActivity();
          if (data.model && data.model !== "local:task-planner") {
            this.updateHeaderModel(data.model);
          }
          if (data.answer && data.answer !== this.assistantText) {
            if (!this.assistantEl) {
              this.assistantEl = this.addMessage("assistant", data.answer, true);
            } else {
              this.assistantEl.innerHTML = renderMarkdown(data.answer);
            }
            this.assistantText = data.answer;
          }
          if (this.debug && data.model) this.addModelTag(data.model);
          this.addTurnDuration(job?.startedAt);
          if (!data.skip_suggestions) {
            this.loadAnswerSuggestions(data.answer || this.assistantText, {
              sessionId,
              userMessage: job?.userMessage,
              dashboardId: job?.dashboardId,
              dashboardTitle: job?.dashboardTitle,
            }).catch(() => {});
          }
          break;
      }
    }
  }

  function init() {
    new AgentWidget();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
