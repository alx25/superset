# Plan de implementación — Copiloto de gráficos en Explore

## Objetivo

Extender el asistente de `irex-mcp-tools` al editor de gráficos de Superset
(Explore), como copiloto:

1. Estar presente al crear o editar un gráfico, con el mismo panel del
   asistente de SQL Lab.
2. Leer el gráfico sin guardar según el contrato del criterio de salida 1
   de la Fase 0 (último estado ejecutado, o detección de cambios
   pendientes) y conocer los controles disponibles de cada tipo de gráfico,
   incluidos los plugins propios.
3. Proponer y aplicar, con confirmación, cambios al gráfico: métricas y
   columnas del gráfico (ad-hoc), tipo de gráfico, opciones y propiedades.
4. Crear métricas guardadas y columnas calculadas en el dataset para
   reutilizarlas en el gráfico — **solo usuarios con rol Admin**.
5. Mostrar el SQL resultante, los tiempos y el resultado devuelto, con
   diagnóstico (plan de ejecución, nulos en JOINs).

La solución respeta RBAC, RLS y el acceso a datasets, se empaqueta en el
mismo `.supx` y no parchea el core de Superset.

## Instrucciones obligatorias para el agente

Antes de cambiar código:

1. Leer completos `AGENTS.md`, `CLAUDE.md`, `PLUGINS.md` y
   `PLAN_ASISTENTE_SQL_LAB.md` (este plan reutiliza sus piezas y decisiones).
2. Revisar `git status` y no alterar cambios ajenos.
3. Editar solo la fuente canónica `custom-extensions/irex-mcp-tools/`.
   **Única excepción prevista:** ocultar "El Don" en Explore se hace en
   `custom-src/login/mcp_widget.py`, que inyecta el widget (ahí vive la regla
   de SQL Lab, entrada 50). Ese archivo lo comparten test y producción por
   symlink y toma efecto al reiniciar cada servicio web.
4. TypeScript estricto, sin `any` ni imports desde `superset-frontend/src/`.
   Solo APIs públicas de `@apache-superset/core` y REST públicas de Superset.
5. Registrar fecha, archivos y explicación de cada cambio en
   `Registro de cambios.md`.
6. Probar primero en test. Producción solo con `scripts/deploy_extension.sh`
   y autorización explícita.
7. Toda REST API nueva de la extensión: vista propia (nunca el
   `class_permission_name` de una vista del host) y `csrf_exempt = False`
   (ver `assistant_api.py` y la memoria del proyecto sobre esas dos trampas).
8. Nada se aplica, guarda ni ejecuta sin confirmación explícita del usuario.

## Decisiones del usuario (2026-09-24)

1. **Solo el rol Admin puede modificar datasets desde el asistente.** Es una
   **excepción acotada** a la regla de seguridad del proyecto "no crear ni
   modificar nada en Superset desde el chat" (`irex.create_chart` sigue
   deshabilitado). Alcance de la excepción: agregar métricas guardadas y
   columnas calculadas a un dataset existente, con confirmación reforzada.
   **El rol es Admin, fijo** (no configurable). No incluye borrar ni
   modificar métricas o columnas existentes, ni cambiar el SQL del dataset,
   ni crear datasets o gráficos. Única salvedad: "Deshacer" puede quitar
   **exactamente lo que el asistente acaba de agregar** (ver Fase 7), con las
   mismas garantías que la escritura.
2. **Panel propio en Explore**, reutilizando el del asistente de SQL Lab. El
   widget de chat de dashboards ("El Don") se oculta en Explore, igual que en
   SQL Lab (entrada 50 del Registro de cambios), editando
   `custom-src/login/mcp_widget.py` (instrucción 3).
3. **Los plugins propios** (`plugin-chart-html-cards`,
   `plugin-chart-pivot-tableRx1`, `plugin-chart-tableV3`) entran desde la
   fase de cambios al gráfico (Fase 6).

## Estado inicial confirmado (investigación del 2026-09-23, código real)

**Punto de montaje del panel**
- `@apache-superset/core` 6.1 no tiene namespace `explore`. Los únicos
  puntos de montaje de vistas son `sqllab.*`.
- El frontend de las extensiones se carga en **todas** las páginas:
  `ExtensionsStartup` envuelve toda la app (`views/App.tsx`). El módulo de
  la extensión puede montar su propio panel en Explore sin un punto de
  montaje oficial.
- En `master` existen `navigation` (`getPage()`, `onDidChangePage`, con la
  página `'explore'`) y `chat.registerChat` (panel acoplable en todas las
  páginas). La documentación de `navigation` aclara que el contexto de la
  entidad (gráfico, dashboard, dataset) llega "en fases posteriores". Hoy no
  hay API pública para leer ni mover controles de Explore en vivo.

**Estado del gráfico (corregido tras la revisión del 2026-09-24)**
- Explore persiste su estado sin guardar en el servidor
  (`updateHistory` → `postFormData`/`putFormData`, debounce de 1 s) y lo
  refleja en la URL como `form_data_key`, **pero solo en estos momentos**:
  al ejecutar la consulta ("Update chart"), al volver a renderizar por un
  control que no requiere consulta, al cambiar de pestaña y al guardar
  (`ExploreViewContainer/index.tsx`: `onQuery`, `reRenderChart`,
  `useChangeEffect(tabId)`, `saveAction`).
- **Un control editado y todavía no ejecutado NO está en la key**, y el
  debounce agrega 1 s de retraso incluso cuando sí se persiste. La key
  refleja el **último estado ejecutado**, no necesariamente lo que el usuario
  ve en los controles. Cómo detectar o resolver esa diferencia es un
  criterio de salida de la Fase 0.
- REST públicas: `POST/PUT/GET/DELETE /api/v1/explore/form_data[/<key>]`,
  `GET /api/v1/explore/` (form_data + dataset + gráfico) y permalinks.
- Aplicar un cambio: escribir un form_data nuevo y recargar Explore con esa
  key (1–2 s). Si había controles editados sin ejecutar, la recarga los
  pierde: la Fase 0 define cómo evitarlo.

**Datos, SQL y tiempos (corregido tras la revisión)**
- `POST /api/v1/chart/data` **no recibe form_data sino un `query_context`**,
  que el navegador arma con el `buildQuery` específico de cada tipo de
  gráfico (`buildV1ChartDataPayload` → `getChartBuildQueryRegistry()`,
  `exploreUtils/index.ts`). Esa lógica vive en cada plugin (incluidos los
  propios) y en un registro interno del host.
- La extensión **no puede alcanzar ese registro por Module Federation**: el
  host solo comparte `react`/`react-dom`; `@superset-ui/core` no se comparte.
  Cómo obtener un `query_context` fiel desde la extensión es un criterio de
  salida de la Fase 0.
- Los gráficos **guardados** tienen su `query_context` almacenado; los que
  están sin guardar no.
- `result_type`: `query` (SQL generado, sin ejecutar), `results`, `full`,
  `samples`, etc. Devuelve `query`, `rowcount`, `sql_rowcount`,
  `is_cached`, `cached_dttm`, `applied_filters`, `rejected_filters`,
  `colnames`, `coltypes`.
- **`samples` no representa el gráfico**: anula las métricas, desactiva la
  serie temporal y lista columnas crudas (`_get_samples` en
  `common/query_actions.py`). La vista previa debe usar el `query_context`
  del gráfico con `results`/`full` y un tope de filas.
- El SQL que Superset genera para un dataset **incluye el RLS**
  (`apply_rls` en `models/helpers.py`).
- **La duración no se expone** (`QueryResult.duration` existe pero no
  viaja en la respuesta): hay que medirla en una tool propia.
- `irex.explain_query` e `irex.check_query_nulls` **aceptan SQL libre** y
  solo verifican acceso a la **base** (`can_access_database`); no verifican
  acceso al **dataset** ni aplican su RLS. Es correcto para SQL Lab (su
  contrato es SQL libre, que Superset tampoco somete a RLS), pero **no
  pueden reutilizarse tal cual en Explore** (ver Fase 4).

**Datasets**
- `PUT /api/v1/dataset/<id>` crea (sin `id`), actualiza (con `id`) y
  **BORRA toda métrica o columna que no venga en la lista**. Enviar solo lo
  nuevo eliminaría el resto y rompería los gráficos que lo usan.
- Exige ser owner del dataset o Admin (`raise_for_ownership`).
- Una lectura + fusión + escritura sin bloqueo deja una **carrera**: si otra
  escritura entra entre la lectura y la escritura, la fusión la pisa (y el
  borrado por omisión la elimina). Comparar `changed_on` antes de escribir
  no alcanza (verificar y escribir no son atómicos).
- La metadata de producción es **PostgreSQL**; la de test es **SQLite**, que
  no tiene bloqueo de fila: la prueba de concurrencia debe correr contra
  PostgreSQL.
- `master` agrega la tool MCP `update_dataset_metric` (solo edita
  existentes, no crea; `Dataset.write` + editor), `get_chart_sql` (acepta
  `form_data_key`) y `execute_chart_data`.

**Catálogo de controles**
- `get_chart_type_schema` (MCP nativo) cubre solo 7 tipos simplificados
  (`xy`, `table`, `pie`, `pivot_table`, `mixed_timeseries`, `handlebars`,
  `big_number`). No cubre los plugins propios ni el form_data real de cada
  `viz_type`: hay que construir un catálogo propio.

### Corrección del 2026-09-24: prueba real de fidelidad en Explore

La validación visual del usuario mostró `SQL/vista previa no disponible` en
cualquier gráfico editado. La comparación exacta entre el `form_data` del
historial y `chart.params` no separa cambios del usuario de transformaciones
normales de Explore. En la metadata SQLite de test se compararon 13 estados
reales de `form_data_key` con su gráfico guardado: los 13 diferían; aun
ignorando `slice_id`, `dashboards` y `dashboardId`, ninguno coincidía.
Entre los campos distintos hay controles que pueden alterar la consulta.

Por lo tanto, la afirmación anterior de que el criterio de salida 2 estaba
cerrado queda **revocada**. La igualdad exacta todavía permite reutilizar
el `query_context` guardado; la desigualdad solo significa **fidelidad no
verificada**. No se debe afirmar que el usuario hizo cambios sin guardar ni
ignorar todas las diferencias para forzar el estado `fiel`.

**Avance experimental (entrada 62):** la extensión observa únicamente el
`POST /api/v1/chart/data` que Explore ya ejecuta, conserva su body (el
`query_context` producido por el `buildQuery` del plugin) cuando responde 200
y lo reusa solo si el `form_data` del request coincide con el estado leído de
`form_data_key` tras quitar los tres campos de transporte (`force`,
`result_format`, `result_type`). Si hay `url_params` con valores, o cualquier
otra diferencia, se mantiene `fidelidad no verificada`. El observador se
instala antes del montaje de Explore y se elimina al salir de la página.

**Pendiente para cerrar la Fase 0:** validar el flujo en navegador real con
un gráfico nativo y con cada plugin propio, incluidos cambios de controles,
navegación y respuestas asíncronas. El capturador cubre la API v1; los tipos
que usen `/superset/explore_json/` permanecen no verificables. Tampoco hay
todavía vista previa/SQL en el panel: esta fase solo obtiene su contexto fiel.

### Corrección del 2026-09-24: fuente del último estado ejecutado

La prueba del usuario con el gráfico 682 mostró que el criterio de la entrada
62 seguía rechazando el `query_context`. Al ejecutar, Superset construye el
request de `/api/v1/chart/data` desde los controles normalizados
(`controlsBasedFormData`), mientras `form_data_key` persiste la forma cruda
`explore.form_data`; la igualdad entre ambas representaciones no es un
invariante. En la metadata de test del gráfico 682 también se observó que el
`slice_id` persistido en `chart.params`/`chart.query_context` era 1187,
aunque el gráfico abierto es 682, así que ese contexto guardado no sirve
como fuente para la vista actual.

La fuente del **último estado ejecutado** pasa a ser el último `POST
/api/v1/chart/data` con respuesta HTTP 200, `result_type=full` y
`result_format=json` observado para el `slice_id` abierto. Es el mismo
`query_context` que usó Superset para el gráfico mostrado. No se iguala con
el estado crudo de la URL; este último sigue siendo útil para leer controles
y detectar cambios posteriores, sin pretender que sea el payload SQL.

La validación real del gráfico 682 (`table_v3`) quedó aprobada tras el
reinicio de `superset_test.service` y una pulsación de «Actualizar gráfico»:
el panel mostró «SQL del estado ejecutado disponible (table_v3).» La Fase 0
sigue abierta hasta validar otros tipos nativos y los plugins `html-cards`
y `pivot-tableRx1`. La captura solo cubre la API v1 y no sustituye la vista
previa/SQL de fases posteriores.

## Arquitectura

Mismo patrón que el asistente de SQL Lab: **el MCP solo lee y propone; quien
aplica es el navegador del usuario (gráfico) o un endpoint de la extensión
restringido a Admin (dataset), siempre después de una confirmación.**

```text
Explore (página)
  └─ panel del asistente (módulo de la extensión, montado en /explore)
       ├─ exploreAdapter: lee form_data_key, aplica form_data (POST + recarga)
       ├─ POST /extensions/irex/irex-mcp-tools/assistant/explore  ──►  backend del chat
       │        (mismo esquema que sql-lab: sesión, CSRF, mcp_url del entorno)
       │                                                   └─► tools MCP irex de solo lectura
       └─ POST /extensions/irex/irex-mcp-tools/assistant/dataset-changes   (solo Admin)
                → lectura + fusión aditiva + escritura del dataset en el servidor
```

**Reutilización del panel de SQL Lab.** Se separa en dos capas:
- **Carcasa común** (ya existe): `PanelHeader`, `Conversation` (resumen,
  detalle, composer), `ChatMarkdown`, `sqlHighlight`, `SqlDiff`, `ui.ts`,
  `icons.tsx`, `clipboard.ts`, `Clarification`.
- **Adaptador por superficie**: `sqlLabAdapter` (existente) y un
  `exploreAdapter` nuevo, más una tarjeta de propuesta por tipo de acción.
  El contrato de cada superficie queda separado, con el mismo sobre (`source`,
  `contract_version`, `message`, `actions`, `diagnostics`).

**Montaje en Explore.** El módulo de la extensión observa la ruta (mismo
mecanismo que el ocultamiento del widget en SQL Lab: `pushState`,
`replaceState`, `popstate`) y, en `/explore`, monta el panel como dock
lateral con un botón para abrir y cerrar. Todo el montaje queda en un solo
archivo (`hosts/exploreHost.tsx`), para migrarlo a
`navigation.onDidChangePage` + `chat.registerChat` cuando upstream los
publique, sin tocar la UI.

**Seguridad por capas (resumen).**

| Capa | Gráfico (ad-hoc, sin guardar) | Dataset (métricas/columnas guardadas) |
|---|---|---|
| MCP | Solo lectura, RBAC por tool, RLS | Solo lectura (validación de expresiones) |
| Quién escribe | El navegador, con la sesión del usuario (REST públicas de Explore) | Endpoint de la extensión, en el servidor |
| Autorización | Los permisos normales de Explore del usuario | **Rol Admin (fijo) verificado en el servidor** + CSRF |
| Confirmación | Diff por control + "Aplicar" | Confirmación reforzada (escribir la palabra) |
| Deshacer | Volver al form_data anterior (key previa) | Quitar exactamente lo agregado (por id), mismas garantías |
| Diagnóstico | Solo sobre el SQL que Superset genera del gráfico (con RLS) | — |

## Requerimientos para el agente del chat

Resumen consolidado para pasarle tal cual; el detalle vive en cada fase.

1. **Endpoint nuevo** `POST /api/explore-assistant` (o `sql-lab-assistant`
   extendido con `source: "superset_explore"`, a acordar en la Fase 3).
   Llega por la REST de la extensión, con los mismos headers de identidad,
   el mismo `X-Service-Secret`, SSE y `conversation_key`/`session_id` que
   SQL Lab.
2. **`mcp_url` en el body**: lo fija Superset desde el servidor
   (`MCP_WIDGET_URL`), igual que en SQL Lab desde la entrada 48. Conviene
   exigirlo en lugar de usar una URL por defecto.
3. **Contrato de respuesta Explore v1** (Fase 3): acciones estructuradas; el
   SQL, las métricas y los parámetros nunca se toman del texto libre.
4. **Tools nuevas** a llamar (Fase 4): estado del gráfico, vista previa con
   SQL/tiempos/filas, catálogo de controles y validación de expresiones.
   Antes de proponer una métrica o columna, validar su expresión con la tool.
5. Las acciones sobre el dataset solo se proponen si el contexto indica
   `user.is_admin = true`; aun así, el servidor vuelve a verificarlo.

## Fase 0 — Spike en test

Validar las incógnitas técnicas antes de construir encima. Sin cambios en
producción. **La Fase 0 no se cierra hasta cumplir los criterios de salida
1 y 2.**

Tareas:

1. Montar un panel mínimo en `/explore` desde el módulo de la extensión y
   verificar que sobrevive a la navegación interna (dashboard → Explore →
   SQL Lab → Explore) sin fugas de listeners.
2. Dock lateral: medir cómo convive con el layout de Explore (panel de
   datos, controles y gráfico) a 1366 px y 1920 px; decidir entre dock que
   achica la página y panel superpuesto.
3. Leer `form_data_key` de la URL y el form_data real vía REST, con el
   gráfico guardado y sin guardar.
4. Aplicar un form_data modificado: `POST /api/v1/explore/form_data` +
   navegación a `/explore/?form_data_key=...&slice_id=...`. Medir la
   recarga, verificar que no se pierde el vínculo con el gráfico guardado
   (`slice_id`) y que "Guardar" funciona normal después.
5. Catálogo de controles: el registro de paneles de control del host no se
   comparte por Module Federation; evaluar alternativas (extraerlo en build
   desde el código de los plugins nativos y propios, u otra vía pública).
6. Ocultar "El Don" en `/explore` (extender la regla de la entrada 50 en
   `mcp_widget.py`).

**Criterio de salida 1 — Estado visible vs. estado persistido.** Demostrar
una de estas opciones, con pruebas en el navegador:
- (a) una forma confiable de detectar desde la extensión que hay controles
  editados sin ejecutar (el gráfico "desactualizado"), sin depender del DOM
  interno de forma frágil; o
- (b) un contrato de UX explícito: el asistente trabaja sobre el **último
  estado ejecutado**, lo dice en la interfaz, y antes de leer o aplicar
  pide ejecutar ("Update chart") si detecta o no puede descartar cambios
  pendientes.
Además: **aplicar un cambio nunca pierde en silencio controles editados sin
ejecutar** (se bloquea o se advierte antes de recargar), y se espera a que
venza el debounce de 1 s antes de leer la key.

**Criterio de salida 2 — `query_context` fiel.** Demostrar cómo la
extensión obtiene, para un form_data dado (guardado y sin guardar), el mismo
`query_context` que armaría Explore, en los tipos nativos más usados **y en
los tres plugins propios**. Candidatas a evaluar:
- el `query_context` guardado del gráfico (solo si está guardado y no
  cambió);
- ejecutar el `buildQuery` del plugin en el navegador por una vía pública;
- reconstruirlo en el servidor por tipo de gráfico (como `get_chart_sql` de
  `master`) y validar su equivalencia contra el de Explore en cada tipo.
Si ninguna es fiel para un tipo, ese tipo queda con vista previa y SQL
deshabilitados (se indica en la interfaz), en lugar de mostrar un SQL que
no es el del gráfico.

Entregable: informe con la decisión de cada punto en este documento.

**Decisión final e implementación (entrada 60 del Registro de cambios,
2026-09-24) — `custom-extensions/irex-mcp-tools/frontend/src/hosts/
exploreState.ts`:**
- Criterio 1: opción (b), tal cual. El panel muestra siempre, sin excepción,
  el contrato "trabajo sobre el último estado EJECUTADO" — no se intenta la
  opción (a) (detectar ediciones sin ejecutar inspeccionando el store del
  host): es justo la vía frágil que el propio plan pedía evitar.
  `onDidChangeLocation` (nuevo en `routeObserver.ts`) cubre "esperar el
  debounce de 1s": Explore ya solo actualiza `form_data_key` en la URL
  después de ese debounce (confirmado en la entrada 56), así que reaccionar
  al cambio de URL alcanza sin timer propio (se suma igual un margen de
  400ms de por sí, `RESOLVE_DEBOUNCE_MS`, contra la carrera servidor/URL).
- Criterio 2: se reusa el `query_context` guardado SOLO cuando el
  form_data actual (leído de la `form_data_key`) es idéntico al `params`
  guardado del gráfico — para cualquier tipo, nativos y los tres plugins
  propios por igual, sin distinción. Se descartaron las otras dos
  candidatas (ejecutar `buildQuery` en el navegador; reconstruirlo en el
  servidor por tipo) por el riesgo de divergencia que señaló la revisión
  externa del plan. Cuando no es fiel, el motivo queda visible en el panel
  (`data-testid="irex-explore-fidelity"`).
- **Pendiente, no cerrable sin sesión interactiva:** la prueba end-to-end
  contra un gráfico real de cada uno de los tres plugins propios que pide
  el criterio 2. El mecanismo deja el resultado VISIBLE en el panel
  ("SQL fiel disponible"/"SQL/vista previa no disponible: <motivo>")
  precisamente para que el usuario la haga en la app real.

### Resultado parcial (2026-09-24) — tareas 1, 3, 4, 5 y 6 hechas; **Fase 0 sigue abierta**

Los criterios de salida 1 y 2 **no están cumplidos todavía** (ver abajo):
esta entrada deja evidencia y un mecanismo de base para resolverlos, pero
falta construir y probar en vivo la lógica que los cierra (eso implica leer
form_data real con avisos de estado pendiente, y una tool de vista previa —
trabajo de Fase 1/4/5, no de un spike). Lo que sí quedó **hecho, probado y
en el `.supx` de test**:

**Tarea 1 — montaje en `/explore` (código nuevo, con tests):**
- `frontend/src/hosts/routeObserver.ts`: observador de ruta reutilizable
  (antes esta lógica solo existía, duplicada, como script inline en
  `mcp_widget.py` para ocultar "El Don"). Envuelve `history.pushState`/
  `replaceState` una sola vez por proceso y escucha `popstate`. 9 tests.
- `frontend/src/hosts/exploreHost.tsx`: monta una raíz de React PROPIA
  (`ReactDOM.render`/`unmountComponentAtNode`, API de React 17) en un `div`
  fijo agregado a `document.body` al entrar a `/explore`, y la desmonta al
  salir — nunca queda un nodo ni un listener vivo fuera de Explore
  (verificado con 5 tests: montaje inicial, entrada/salida, doble
  ida-y-vuelta sin fugas, y que navegar entre gráficos dentro de `/explore`
  NO remonta). Cableado desde `index.tsx`.
- **Hallazgo no anticipado por el plan — el panel de SQL Lab no sirve de
  modelo aquí:** `theme.useTheme()` (que usa toda la carcasa compartida) es
  literalmente el `useTheme()` de Emotion — lee `React.Context`, así que
  SOLO funciona dentro del árbol de React que tiene un `<ThemeProvider>`
  ancestro. El panel de SQL Lab lo hereda porque `sqllab.rightSidebar` lo
  monta DENTRO del árbol del host; una raíz separada (sin punto de montaje
  en Explore) no hereda nada, sin importar que `@apache-superset/core` se
  resuelva en runtime contra el mismo `window.superset` que usa el host
  (`externalsType: "window"` en `webpack.config.js`) — Module Federation no
  crea ninguna relación de árbol de React entre bundles.
- **Solución, verificada contra la app de test real:**
  `frontend/src/hosts/themeBridge.ts`. `document.getElementById('app')
  .dataset.bootstrap` trae `common.theme.{default,dark}` (`{algorithm,
  token}`, `algorithm` serializado como string `"default"`/`"dark"`) —
  **confirmado idéntico en `/explore/`, `/sqllab/` y `/superset/welcome/`**
  (no es específico de SQL Lab, es el bootstrap genérico de cualquier
  página autenticada). `themeNs.Theme.fromConfig(cfg)` (la misma clase
  pública, vía `window.superset`) sabe deserializar ese formato y calcula
  los tokens con el `antd` compartido como singleton — mismo resultado que
  `useTheme()` dentro del árbol del host, sin reimplementar el algoritmo. El
  modo claro/oscuro se lee de `localStorage['superset-theme-mode']` (con
  `prefers-color-scheme` para `'system'`), y `ThemeAgentBridge.tsx`
  (customización propia del proyecto, ya usada para "El Don") dispara
  `window` `CustomEvent('superset-agent:theme-change')` en cada cambio —
  se usa solo como disparador para recalcular, no se consume su `detail`
  (trae un subconjunto reducido de tokens, insuficiente para los
  componentes que reutiliza este panel). 11 tests; sin verificación visual
  con navegador real (queda pendiente, igual que la Fase 0 en general).
- Dock actual: `position: fixed` superpuesto (380px, borde y sombra),
  **no reduce el espacio real de Explore**. Es la opción simple entre las
  dos que preveía la tarea 2; un dock que reserve espacio de verdad (como
  "El Don") queda para la Fase 1, después de auditar en un navegador real
  el layout de Explore a 1366px/1920px — no verificable de forma headless
  sin una sesión interactiva autenticada.

**Tarea 6 — ocultar "El Don" en Explore:** `mcp_widget.py` (regla de la
entrada 50, extendida): `/^\/sqllab(\/|$)/` → `/^\/(sqllab|explore)(\/|$)/`.
Verificado en dos niveles: (a) extraído el snippet inyectado real desde una
respuesta HTTP real de `/explore/` contra la app de test — 8 casos de
navegación con el código real (`pushState`/`replaceState`/`popstate`,
incluida una ruta trampa `/exploreX/` que NO debe ocultarse) — 8/8; (b) no
afecta a SQL Lab (mismo patrón, sin cambios ahí).

**Tareas 3 y 4 — `form_data` real, con un hallazgo importante sobre
`tab_id`:** contra la app de test real (`POST`/`GET`/`PUT`
`/api/v1/explore/form_data`, con RBAC de verdad —
`GetFormDataCommand`/`UpdateFormDataCommand` llaman
`security_manager`/`check_access` sobre el dataset o el gráfico, no son
solo caché):
- `GET` respeta el acceso al dataset (un usuario sin acceso al datasource
  del form_data recibe 403, verificado).
- **`PUT /form_data/<key>` genera una key NUEVA en cada llamada si no se
  manda `tab_id` — no actualiza "en el lugar".** `UpdateFormDataCommand`
  cachea `(sesión, tab_id, datasource, chart) → key`; sin `tab_id` (o con
  `tab_id=0`) siempre llama a `random_key()`. Con el `tab_id` real de la
  pestaña (el mismo `sessionStorage['tab_id']` que ya usa el propio
  Explore — `useTabId()`, un contador por pestaña con `BroadcastChannel`
  para no colisionar entre pestañas), `PUT` SÍ reutiliza la misma key en
  llamadas sucesivas — verificado con 3 `PUT` seguidos con el mismo
  `tab_id` (misma key todas) y un `PUT` con `tab_id` distinto (key nueva,
  no pisa la otra pestaña). **Consecuencia para el adaptador de Explore
  (Fase 1): tiene que leer y mandar el `tab_id` real de
  `sessionStorage`, igual que el propio Explore, para no generar una key
  huérfana en cada escritura, desincronizada del ciclo de autoguardado
  (`updateHistory`, debounce 1s) que Explore sigue haciendo en paralelo.**
  Ningún dato de esto estaba en la investigación previa del plan.
- El body de la request SIEMPRE devuelve el `key` real a usar (nunca
  asumir que es el mismo que se mandó): coincide con lo que el plan ya
  preveía ("escribir un form_data nuevo y recargar con esa key"), ahora
  con evidencia de POR QUÉ hace falta ese cuidado.

**Tarea 5 — catálogo de controles, evidencia que endurece la Fase 0/6:**
- Confirmado (código): `shared` de Module Federation del host solo incluye
  `react`/`react-dom`/`antd` — `@superset-ui/core` (donde vive
  `getChartBuildQueryRegistry()`) NO se comparte; `window.superset` (el
  surface de `@apache-superset/core` que SÍ es external) tampoco lo expone.
  No hay ningún otro global de depuración con el registro. Vía de acceso al
  registro real del host: **no existe**, para ningún tipo de gráfico.
- **`chart.query_context` guardado es fiel, pero solo hasta el último
  "Guardar":** confirmado en `saveModalActions.ts` — al guardar, el
  frontend llama al mismo `buildV1ChartDataPayload` que usa
  `/api/v1/chart/data` y lo manda como `query_context` en el propio
  request de guardado. Es la fuente MÁS barata y de MAYOR fidelidad para
  el caso "gráfico guardado, sin ediciones pendientes".
- **Los tres plugins propios definen su propio `buildQuery.ts`** (51 líneas
  en `html-cards`, 122 en `pivot-tableRx1`, 392 en `tableV3`) — ninguno usa
  el builder genérico por defecto. Descarta cualquier reconstrucción
  server-side "genérica" para ellos.
- **`master` (aún sin publicar) ya se topó con este mismo problema:**
  `superset/mcp_service/chart/tool/get_chart_sql.py` +
  `chart_helpers.py` (1139 líneas) reconstruyen `query_context` en Python
  por tipo de gráfico — pero **solo para tipos nativos de Superset**
  (treemap, gantt, deck_gl, big_number, mixed_timeseries…); no puede ni
  podrá cubrir plugins de terceros como los propios. Su propia lógica de
  resolución (`_resolve_effective_form_data`) confirma el mismo criterio
  del criterio de salida 1: sin `form_data_key` explícito, confía
  ciegamente en el `query_context` guardado (sin chequeo de frescura
  aparte); CON `form_data_key`, nunca reusa el guardado — siempre
  reconstruye desde form_data. Valida que "pedir `form_data_key` siempre
  que pueda haber ediciones sin guardar" es el patrón correcto, no una
  ocurrencia nuestra.
- **Recomendación para cerrar el criterio de salida 2 (a implementar en
  Fase 1/4, no en este spike):** para gráficos guardados sin ediciones
  pendientes (form_data actual == `chart.params`), usar el
  `query_context` guardado — fidelidad total, cero reimplementación, sirve
  para los tres plugins propios sin trabajo extra. Para ediciones
  pendientes en tipos NATIVOS, evaluar puntualmente si conviene portar
  una versión acotada de la lógica de `master` (con el riesgo de
  divergencia ya señalado). Para ediciones pendientes en los tres plugins
  propios, no hay atajo: es el trabajo real de la Fase 6, con tests
  contra cada `buildQuery.ts`. Hasta entonces, la vista previa/SQL de un
  gráfico con ediciones sin guardar en un plugin propio debe responder
  "no puedo generar el SQL fiel para esto todavía" en vez de adivinar.

**Verificación de todo lo anterior:** `npx tsc --noEmit` estricto, 129
tests de frontend (25 nuevos: 9 + 11 + 5), 223 tests de backend (sin
cambios — cifra corregida: turnos anteriores de esta conversación citaron
"264" de memoria sin volver a verificar; `git status` limpio confirma que
223 es el número real del código en el repo), `build-extension.sh`
completo sobre `extensions_test/`. Sin verificación visual en navegador
(no hay sesión interactiva disponible en esta sesión) — pendiente antes de
dar por cerrada la Fase 0.

**Pendiente para cerrar la Fase 0 (no hecho en esta entrada):**
1. Verificación visual real (navegador) del dock y del tema derivado, en
   claro/oscuro, a 1366px y 1920px.
2. Construir y probar en vivo el aviso de "hay cambios sin ejecutar" (o
   documentar formalmente la opción (b) del criterio de salida 1 como la
   elegida) — la mecánica de `tab_id` ya está resuelta, falta la UX.
3. Una prueba end-to-end de la ruta recomendada del criterio de salida 2
   (`query_context` guardado) contra un gráfico real de cada uno de los
   tres plugins propios.

**Bugs reales encontrados con el spike en vivo, fuera de esta lista
(entradas 57 y 58 del Registro de cambios, 2026-09-24, dos rondas de
capturas del usuario):**
1. (Entrada 57) El overlay del dock usaba `position: fixed; top: 0`,
   tapando la cabecera propia de Explore ("Guardar", "...") y la barra
   global de Superset. Primer intento de fix: medir en runtime el borde
   inferior de `#main-menu`/`.header-with-actions` y apoyar el dock debajo.
2. (Entrada 58) Insuficiente — el dock, aunque ya no tapaba las barras,
   seguía siendo un overlay superpuesto al lienzo del gráfico y a sus
   controles. El usuario pidió explícitamente que reserve espacio real,
   "similar a como lo hace el widget del chat", y que sea redimensionable.
   Reemplazado el mecanismo entero: ahora `exploreHost.tsx` envuelve `#app`
   en una fila flex y agrega el dock como HERMANO con ancho propio (mismo
   patrón, con los mismos nombres de pieza, que `setupDock`/
   `setupDockResize` de `custom-src/login/mcp_widget.py`), con handle de
   resize (mínimo 380px, máximo 50vw, ancho persistido en `localStorage`).
   `measureReservedTop()`/`useReservedTop()` de la entrada 57 quedaron
   eliminados — ya no aplican, el dock nunca comparte espacio con nada que
   haya que medir.

El usuario confirmó visualmente que este mecanismo ya funciona (dock
incrustado, no superpuesto) y pidió un último detalle (entrada 59 del
Registro de cambios): botón para plegar/desplegar el panel. Implementado —
botón circular sobre el handle de resize, plegado a `width:0` sin perder el
ancho elegido, estado persistido en `localStorage`. Sigue pendiente que el
usuario confirme visualmente este detalle puntual; la tarea 2 de arriba
(auditoría de layout a 1366/1920px, claro/oscuro) sigue abierta en general.

## Fase 1 — Carcasa común del panel

1. Separar la carcasa (componentes existentes) de la lógica de SQL Lab
   (`SqlLabAssistantPanel`) sin cambiar su comportamiento: los 104 tests de
   frontend actuales deben seguir pasando sin modificarse.
2. Interfaz de adaptador de superficie: leer contexto, aplicar acción,
   deshacer, eventos de cambio.
3. Montaje: `sqllab.rightSidebar` (sin cambios) y `hosts/exploreHost.tsx`
   (nuevo, Fase 0).
4. Encabezado y modos por superficie. En Explore: "Explicar", "Mejorar
   gráfico", "Métricas"; el control segmentado se reutiliza.

### Avance de Fase 1 (2026-09-24, entrada 64)

Se creó `frontend/src/adapters/exploreAdapter.ts` como frontera de lectura
para Explore: entrega por separado `form_data_key`/`form_data` persistidos y
`query_context` de la ejecución observada, y avisa por separado cambios de
URL y capturas del gráfico. El indicador del dock usa la lectura ligera para
no repetir peticiones REST en cada actualización. El encabezado común acepta
título y subtítulo por superficie: Explore dice «Asistente de gráficos» y no
muestra «Limpiar» hasta que exista una conversación; SQL Lab conserva su
encabezado y su sesión. El paquete está compilado en `extensions_test/`.

Quedan pendientes de la Fase 1 la interfaz de acciones/deshacer, los modos de
Explore y el panel de conversación. La Fase 0 todavía requiere validación
visual de los tipos que figuran arriba; esta entrega no la declara cerrada.

### Avance de Fase 1 (2026-09-24, entrada 70) — el panel ya se conecta al chat

El usuario confirmó con una captura que el dock solo mostraba diagnóstico,
sin forma de escribirle al asistente ("¿aún no puedo interactuar con el
chat?"). Se construyó `assistant/ExploreAssistantPanel.tsx` (orquestación:
lee contexto, arma y manda el pedido, muestra respuesta/aclaraciones/
diagnósticos, "Nueva sesión") y `assistant/ExploreConversation.tsx`
(composer + los 3 modos de Explore: "Explicar"/"Mejorar gráfico"/
"Métricas"). **Decisión sobre el punto 1 de esta fase:** no se generalizó
`SqlLabAssistantPanel.tsx`/`Conversation.tsx` para cubrir ambos casos —
`Conversation.tsx` está atado a los 4 modos de SQL Lab y a diagnósticos con
`line`/`column` (posición en SQL), que no tienen sentido para los
diagnósticos de Explore (apuntan a un `control` del formulario). Se
reusaron sin tocarlas las piezas realmente genéricas (`WorkingIndicator`,
`UserTurn`, `EarlierTurns`, exportadas de forma aditiva) y se escribió
`ExploreConversation.tsx` aparte, mismo lenguaje visual. Los 189 tests
previos de SQL Lab/Explore siguen pasando sin tocarse (solo 1 aserción de
`exploreHost.test.tsx` se actualizó a propósito: "Nueva sesión" ahora SÍ
debe aparecer).

Acciones (`patch_form_data`, `add_adhoc_metric`, etc.) se describen en una
tarjeta de solo lectura, sin botón "Aplicar" — aplicar de verdad exige
validar catálogo y key vigente inmediatamente antes (contrato v1), y hoy
`irex.get_viz_controls`/`irex.validate_expression` no existen todavía, así
que el backend descarta esas acciones de la respuesta de cualquier forma.
Sigue pendiente de esta fase: interfaz de deshacer (no aplica todavía,
nada se puede aplicar) y la extracción real de una carcasa COMPARTIDA
entre SQL Lab y Explore (por ahora son dos árboles de componentes
paralelos, no uno solo parametrizado — más simple y seguro hoy, pero es
duplicación real que convendría revisar si diverge mucho más).

## Fase 2 — Permisos

1. Auditoría (solo lectura, como la Fase 2 de SQL Lab): qué roles tienen
   `can_explore`/`can_read` sobre `Chart` y `Dataset` hoy, y qué usuarios
   del chat usarían el copiloto.
2. Gate de las tools MCP nuevas: definir el permiso por tool (por ejemplo
   `can_read` sobre `Chart` para leer estado y vista previa), con el mismo
   decorador que las tools actuales. Tests negativos con un usuario sin ese
   permiso.
3. **Admin para datasets (rol fijo).** El endpoint de dataset verifica en
   el servidor que el usuario tiene el rol Admin
   (`security_manager.is_admin()`), más sesión, CSRF y acceso al dataset.
   No hay rol configurable. El frontend oculta las acciones de dataset a
   no-Admin, pero **eso no es la protección**.
4. Registrar la excepción a la regla de seguridad del proyecto en la
   memoria y en `CLAUDE.md`/`AGENTS.md` si corresponde.

## Fase 3 — Contrato Explore v1

Documento de entrega `docs/explore-assistant-contract.md`, con el mismo
sobre que el de SQL Lab.

Contexto hacia el backend (mínimo):

```json
{
  "contract_version": 1,
  "source": "superset_explore",
  "mode": "improve_chart",
  "user_message": "...",
  "conversation_key": "uuid",
  "user": { "is_admin": true },
  "chart": {
    "slice_id": 123,
    "form_data_key": "abc",
    "viz_type": "echarts_timeseries_bar",
    "datasource": { "id": 11, "type": "table" }
  },
  "form_data": { "...": "estado actual, sin campos voluminosos" },
  "dataset": { "id": 11, "metrics": ["..."], "columns": ["..."] }
}
```

Acciones admitidas inicialmente:

| Acción | Efecto | Quién aplica |
|---|---|---|
| `patch_form_data` | Lista de operaciones sobre controles (`set`, `add`, `remove`), validadas contra el catálogo | Navegador |
| `add_adhoc_metric` / `add_adhoc_column` | Métrica o columna del gráfico (SQL o simple) | Navegador |
| `change_viz_type` | Cambia el tipo y remapea controles compatibles | Navegador |
| `add_dataset_metric` | Métrica guardada en el dataset | Endpoint Admin |
| `add_calculated_column` | Columna calculada en el dataset | Endpoint Admin |
| `preview` | Pide una vista previa (sin aplicar nada) | Navegador → tool |

Reglas: nada se aplica solo; las operaciones sobre controles inexistentes
en el catálogo se rechazan en el frontend; las expresiones deben venir
validadas (Fase 4).

### Avance de Fases 2 y 3 (2026-09-24, entrada 65)

El usuario incorporó el contrato del backend de chat en
`custom-extensions/irex-mcp-tools/docs/explore-assistant-contract.md`. La
extensión ya tiene tipos y validación del sobre Explore v1; el adaptador
construye el body solo con `form_data_key`, `form_data` y `query_context`
fieles, y toma el datasource de este último. El código no envía el body ni
habilita acciones todavía.

Auditoría de permisos de la metadata SQLite usada con `superset_config_test.py`
(`~/.superset/superset.db`, lectura solamente): Admin, Alpha, Gamma y Solo PNS
tienen `can_read` sobre Chart y Dataset. Admin, Alpha y Gamma tienen
`can_explore` sobre Superset; Solo PNS no. El rol `acceso chat` no otorga
ninguno de esos permisos por sí solo y tiene 1 usuario asignado en esta
metadata. La entrada web propuesta para Explore exige sesión, rol del chat,
`can_explore` y lectura de Chart/Dataset; cada tool MCP deberá además
comprobar acceso real al dataset. Admin para escrituras de dataset sigue
siendo una verificación del servidor y de la tool, nunca del body del
navegador. No se creó endpoint de escritura ni se habilitó chat.

**Bloqueo del proxy:** la revisión automática rechazó añadir el endpoint
`/assistant/explore` que reenviaría identidad y `form_data` a
`CHAT_WIDGET_API_URL` porque ese destino no está autorizado explícitamente
para ese payload. La operación rechazada no dejó cambios parciales. El
contrato local y las pruebas no hacen peticiones de red. Para conectar el
transporte hace falta autorización explícita de ese envío al backend de chat
configurado en test; producción requiere su propia autorización de despliegue.
`irex.get_explore_state` sigue pendiente, así que el backend del chat devolvería
503 incluso tras conectar el proxy.

### Integración autorizada en test (2026-09-24, entrada 66)

El usuario autorizó explícitamente que el proxy de test envíe identidad,
rol Admin verificado y `form_data` a `CHAT_WIDGET_API_URL`. Se añadió
`POST /extensions/irex/irex-mcp-tools/assistant/explore` en la vista propia
de la extensión (`csrf_exempt=False`), que reenvía SSE/JSON al endpoint fijo
`/api/explore-assistant`. Antes del relay exige sesión, rol del chat,
`can_explore` en Superset, lectura de Chart y Dataset y acceso real al
dataset declarado. El proxy sustituye cualquier `X-Superset-Is-Admin`,
`user.is_admin` o `mcp_url` enviados por el navegador por valores de la
sesión/configuración de Superset. Si falta `MCP_WIDGET_URL`, responde 503.
El transporte frontend usa únicamente esta REST; un 404 no cae al proxy
legacy. El panel aún no envía pedidos: falta `irex.get_explore_state` y la
validación restante de Fase 0.

La autorización cubre la integración y el paquete **de test**. Build 7/7
aprobado (188 tests frontend, 229 backend). El paquete está en
`extensions_test/`. El usuario reinició `superset_test.service`: la ruta
respondió 400 sin CSRF a POST, 405 a GET y una ruta inexistente 404;
`/health` respondió 200. Falta una prueba autenticada y `irex.get_explore_state`.
No se cambia ni reinicia producción. El proxy bloqueado en la
entrada 65 se implementó ahora con esta autorización; las tools MCP de la
Fase 4 siguen pendientes.

## Fase 4 — Tools MCP (solo lectura)

Todas con tag `irex`, RBAC por tool, RLS, límites estrictos y sin exponer
credenciales. Paso 6 de `CLAUDE.md`: agregarlas a `always_visible`.

1. `irex.get_explore_state` — form_data de una key o de un gráfico guardado,
   más el resumen del dataset (métricas y columnas con tipo y expresión).
   Informa si el estado corresponde al último ejecutado (criterio de salida
   1 de la Fase 0).
2. `irex.preview_chart` — dado el `query_context` fiel del gráfico (criterio
   de salida 2): SQL generado (`result_type=query`), ejecución acotada con
   `results` (nunca `samples`) y tope de filas, `rowcount`, `is_cached`,
   filtros aplicados y rechazados, **duración medida** y error. Verifica
   acceso al **dataset** del gráfico (no solo a la base) y pasa por el
   pipeline de datos de Superset, que aplica RLS. Nunca devuelve más de N
   filas al modelo.
3. `irex.get_viz_controls` — catálogo de controles por `viz_type` (nombre,
   tipo, valores válidos, por defecto, descripción), incluidos los tres
   plugins propios. Fuente: la decidida en la Fase 0.
4. `irex.validate_expression` — prueba una expresión de métrica o columna
   sobre el dataset **a través del pipeline de datos** (como una métrica o
   columna ad-hoc, con RLS y verificación de acceso al dataset), con tope de
   filas y sin guardar nada.
5. **Diagnóstico ligado al gráfico (puerta antes de habilitar la Fase 5).**
   Versiones de `explain_query` y `check_query_nulls` que **no aceptan SQL
   libre**: reciben el gráfico (form_data o `query_context`), generan el SQL
   en el servidor con el pipeline de Superset (que incluye el RLS del
   usuario), verifican acceso al dataset y diagnostican ese SQL. Las tools
   actuales de SQL libre no se exponen al copiloto de Explore. Tests: un
   usuario con RLS obtiene un plan y un perfil de nulos que respetan su
   filtro; un usuario sin acceso al dataset es rechazado aunque tenga acceso
   a la base.

### Avance de Fase 4 (2026-09-24, entrada 67)

Se implementó `irex.get_explore_state` como primera tool MCP de solo lectura.
Lee la caché `form_data_key` bajo identidad MCP, exige `can_read Chart`,
`can_explore`, `can_read Dataset` y el `check_access` nativo al dataset y
al gráfico. Devuelve `slice_id` del `chart_id` cacheado, no del posible
`slice_id` obsoleto dentro de `form_data` (caso real 682/1187), y `is_admin`
del `security_manager` del usuario. Informa `state_kind=last_persisted`:
la caché no demuestra ejecución. La prueba de permisos, estado vencido,
JSON inválido, tipo de datasource y el caso de ID obsoleto pasó.

El agente del backend informó que ya acepta `last_persisted` para lectura
y reserva SQL, resultados y preview hasta verificar independientemente el
`query_context` ejecutado. El adaptador de la extensión ya puede construir
la solicitud de lectura desde `form_data` persistido sin exigir SQL capturado. El build 7/7 pasó (188 frontend, 237 backend) y el `.supx` de test contiene
la tool registrada. El usuario reinició `superset_mcp_test.service` y el
journal confirmó `irex.get_explore_state` como tool protegida; falta invocarla
con una sesión autorizada y confirmar integración real con el backend de chat.
No se habilita el chat del panel hasta completar las otras tools y pruebas
de RLS.

**Actualización — el chat del panel SÍ se habilitó (entrada 70) y se probó
en vivo (entrada 71):** modo "Explicar" contra un gráfico guardado funcionó
de punta a punta (el modelo llamó a `get_explore_state` y respondió bien).
"Mejorar gráfico" con un gráfico sin guardar falló del lado del backend del
chat (su verificación previa no maneja `slice_id: null` — reportado, no es
un bug de esta extensión).

### Avance de Fase 4 (2026-09-24, entrada 72) — `irex.explain_chart`/`irex.preview_chart`

Implementadas las dos tools que le faltaban al punto 2 de esta fase (el
punto 5 usa una variante de estas mismas, ver abajo). Mismo pipeline real
que ya usa `irex.chart_option` en producción
(`QueryContextFactory`/`ChartDataCommand`) — el `query_context` no se
reconstruye ni se adivina: es el que capturó el navegador al observar la
ejecución real (`exploreQueryCapture.ts`), y la "verificación independiente"
que pedía la revisión externa del plan es la RE-EJECUCIÓN misma
(`ChartDataCommand.validate()` → `raise_for_access()`, mismo RLS/RBAC que
cualquier ejecución real) — no un chequeo de forma aparte.

- `irex.explain_chart`: `result_type=query` — SQL generado, sin ejecutar
  contra la base (ni siquiera EXPLAIN). Cubre la mitad "SQL" del punto 2 de
  arriba (`rowcount`/duración/caché quedan para cuando se necesiten, no
  están en esta entrega).
- `irex.preview_chart`: `result_type=full`, `row_limit` acotado (1-5000,
  nunca mayor al que ya traía el `query_context` capturado) — resultado
  real, nunca `samples`.
- Se extendió el contrato (`docs/explore-assistant-contract.md`,
  `chart.query_context` en el body) para que el `query_context` capturado
  por el navegador llegue hasta el modelo, que se lo pasa tal cual a estas
  dos tools — sin este campo no había nada que verificar.
- El punto 5 de esta fase (diagnóstico ligado al gráfico, `explain_query`/
  `check_query_nulls` sin SQL libre) queda cubierto en el mismo espíritu por
  `explain_chart` (ya genera el SQL del gráfico con RLS), pero **sigue sin
  existir un equivalente de `check_query_nulls`** (perfil de nulos en
  JOINs) — pendiente.
- Sigue pendiente `irex.get_viz_controls` (punto 3) y `irex.validate_expression`
  (punto 4) — sin esas dos, "Mejorar gráfico"/"Métricas" no pueden proponer
  acciones válidas (`ExploreActionCard` del panel ya está listo para
  mostrarlas, solo falta que el backend las pueda construir y validar).

### Avance de Fase 4 (2026-09-24, entrada 78) — `irex.get_viz_controls`

Implementada. El usuario preguntó si, dado que la mayoría de los tipos de
gráfico comparten controles, se podía hacer algo genérico en vez de un
catálogo completo por tipo (lo que parecía una tarea enorme: los
`controlPanel.tsx` de los 3 plugins propios son código React/TS ejecutable
con lógica dinámica, no configuración parseable — 1567+1156+139 líneas).
Confirmado que sí: Superset mismo ya reusa un registro de "controles
compartidos" (`@superset-ui/chart-controls`, `sharedControls.tsx`) en la
mayoría de sus tipos nativos — verificado leyendo el `controlPanel.tsx` real
de `mixed_timeseries`. Diseño de dos niveles, nunca mezclados:
- `source: "specific"` — solo `table_v3`/`html_cards`/`pivot_table_rx1`:
  lista EXACTA (41/15/47 controles), extraída leyendo el código fuente real
  de cada uno.
- `source: "generic"` — cualquier otro `viz_type` (todos los nativos, sin
  excepción por ahora): el catálogo `sharedControls` de Superset (47
  nombres), marcado explícitamente como no verificado para ese tipo.

No incluye tipo/valores válidos/default/descripción por control — solo
nombres, suficiente para el uso inmediato del contrato ("¿existe este
control para este tipo?"). Sigue pendiente `irex.validate_expression`
(punto 4) — sin ella, aunque el nombre de un control exista, no se puede
validar una expresión de métrica/columna nueva contra el dataset.

**⚠️ Regresión encontrada y corregida (entrada 73, 2026-09-24):** la primera
prueba real de `chart.query_context` rompió "Explicar" — el backend del
chat valida `chart` con un modelo que no acepta campos extra (422
`extra_forbidden`, tumba la solicitud entera antes de llegar al modelo).
Se desactivó el envío del lado de la extensión (`SEND_QUERY_CONTEXT_IN_REQUEST
= false` en `exploreAdapter.ts`) — "Explicar" vuelve a funcionar como en la
entrada 71. Las tools quedan construidas y listas; falta que el backend del
chat agregue el campo a su schema y avise para reactivar el envío (aviso ⚠️
detallado en `docs/explore-assistant-contract.md`).

## Fase 5 — Nivel 1: lectura y diagnóstico

1. Modo "Explicar": qué muestra el gráfico, de dónde salen los datos, qué
   filtros aplica, por qué un valor da lo que da.
2. Tarjeta "SQL y rendimiento": SQL con resaltado, duración, filas, caché,
   filtros rechazados, y botón para ver el plan con la tool de diagnóstico
   **ligada al gráfico** (Fase 4, punto 5). Si el tipo de gráfico no tiene
   `query_context` fiel (Fase 0), la tarjeta lo indica y no muestra SQL.
3. Diagnósticos: JOINs vacíos, filtros que no aplican, métricas con nulos,
   siempre sobre el SQL generado por Superset para el gráfico.

## Fase 6 — Nivel 2: cambios al gráfico (sin guardar)

1. Diff por control (antes → después) en la tarjeta de propuesta, con los
   nombres visibles de los controles del catálogo.
2. Aplicar: form_data nuevo (`POST /api/v1/explore/form_data`) y recarga de
   Explore con esa key. Se conserva la key previa para "Deshacer".
3. Métricas y columnas ad-hoc, tipo de gráfico, opciones y propiedades.
4. **Plugins propios desde esta fase**: `html-cards`, `pivot-tableRx1`,
   `tableV3`, con tests de un cambio real sobre cada uno.
5. El gráfico nunca se guarda desde el asistente: guarda el usuario con el
   botón normal de Superset.

## Fase 7 — Nivel 3: dataset (solo Admin)

**Puerta:** no se habilita en producción hasta cumplir los puntos 4 y 5 con
sus pruebas.

Endpoint `POST /extensions/irex/irex-mcp-tools/assistant/dataset-changes`,
en el servidor:

1. Verifica el rol **Admin** (fijo), sesión, CSRF y acceso al dataset.
2. Solo acepta **agregar** métricas y columnas calculadas (nunca borra ni
   modifica las existentes). Rechaza nombres que ya existen.
3. Valida cada expresión con `irex.validate_expression` (pipeline de datos,
   con RLS) antes de escribir.
4. **Escritura atómica, sin carrera.** En una sola transacción:
   - bloquear la fila del dataset (`SELECT … FOR UPDATE` en PostgreSQL)
     antes de leer las listas actuales;
   - fusionar (existentes + nuevas) y escribir con el comando de Superset;
   - comprobación atómica adicional contra el valor leído (`changed_on`)
     dentro de la misma transacción: si no coincide, abortar y pedir
     reintentar.
   Comparar `changed_on` antes de escribir, fuera de la transacción, **no
   alcanza** y no se acepta.
5. **Pruebas obligatorias:**
   - después de guardar, todas las métricas y columnas previas siguen
     existiendo sin cambios;
   - **dos escrituras concurrentes** sobre el mismo dataset (dos agregados
     distintos lanzados a la vez): ambas terminan presentes o una se rechaza
     con "reintentar"; nunca se pierde una ni se borra nada previo.
   Estas pruebas corren contra **PostgreSQL** (la metadata de test es
   SQLite, sin bloqueo de fila): definir en esta fase la base de pruebas
   (instancia o base aparte en el servidor PostgreSQL, con autorización).
6. **Deshacer acotado:** quitar exactamente los ids que esta misma operación
   agregó, con las mismas garantías (Admin, CSRF, bloqueo, transacción), y
   solo si ningún gráfico guardado los usa todavía (si alguno los usa, se
   rechaza y se explica). Es la única forma de borrado permitida.
7. Registro de auditoría: quién, cuándo, dataset y qué se agregó o quitó.

En el panel: confirmación reforzada (escribir `AGREGAR`), aviso de que
afecta a todos los que usan el dataset, y después de agregar, ofrecer usarla
en el gráfico actual (una acción de Nivel 2).

## Fase 8 — Pruebas

- Frontend (Jest): adaptador de Explore, diff por control, aplicar y
  deshacer, acciones de dataset ocultas a no-Admin, contratos malformados.
- Backend: las tools nuevas (permisos, RLS, límites, que la duración y el
  SQL vengan bien); endpoint de dataset (no-Admin → 403, sin CSRF → 400,
  concurrencia, expresión inválida rechazada, **nunca borra nada**).
- E2E contra test (`scripts/e2e_rbac.py` extendido): usuario sin permiso,
  usuario no-Admin intentando escribir un dataset.
- Visual: capturas con los tokens reales en claro y oscuro (mismo método
  que la entrada 49).
- Compatibilidad: `scripts/check_host_compat.py` extendido con los
  símbolos nuevos.

## Fase 9 — Despliegue

`scripts/build-extension.sh` → test → `scripts/check_deploy_config.py` →
`scripts/deploy_extension.sh` (con confirmación "PRODUCCION"). Actualizar
`always_visible` en los dos configs antes de promover.

## Fase 10 — Migración a APIs oficiales (cuando upstream las publique)

- Montaje: `hosts/exploreHost.tsx` → `chat.registerChat` +
  `navigation.onDidChangePage`.
- Aplicar cambios en vivo, sin recarga, si se publica un namespace de
  Explore con acceso al estado del gráfico.
- Revisar si `update_dataset_metric`/`get_chart_sql` nativas reemplazan a
  alguna tool propia.

## Orden recomendado

1. **Fase 0** hasta cumplir los criterios de salida 1 (estado visible) y 2
   (`query_context` fiel).
2. Fase 1 (carcasa común) sin romper SQL Lab.
3. Fases 2–4 (permisos, contrato, tools). En paralelo el agente del chat
   implementa su endpoint.
4. **Puerta de diagnóstico:** el diagnóstico ligado al gráfico (Fase 4,
   punto 5) con sus tests de RLS, antes de habilitar la tarjeta de
   rendimiento de la Fase 5.
5. Fase 5 (lectura y diagnóstico).
6. Fase 6 (cambios al gráfico, con plugins).
7. **Puerta de escritura:** escritura atómica y prueba de concurrencia en
   PostgreSQL (Fase 7, puntos 4 y 5), antes de habilitar la Fase 7.
8. Fase 7 (dataset, Admin).
9. Fases 8–9.

## Criterios de aceptación

- El panel aparece en Explore (crear y editar) con la misma experiencia que
  en SQL Lab, y "El Don" no aparece ahí.
- El asistente describe con exactitud el gráfico según el contrato del
  criterio de salida 1 (último estado ejecutado, o detección de cambios
  pendientes), y nunca pierde en silencio controles editados sin ejecutar.
- El SQL, la duración y los datos que muestra son los del gráfico
  (`query_context` fiel), no aproximaciones; los tipos sin `query_context`
  fiel lo indican en lugar de mostrar datos incorrectos.
- Los diagnósticos respetan el RLS del usuario y exigen acceso al dataset.
- Muestra el SQL resultante, la duración, las filas y los filtros
  rechazados.
- Aplica cambios al gráfico solo tras confirmación, con diff por control y
  deshacer, en los tipos nativos y en los tres plugins propios.
- Un no-Admin no puede modificar un dataset por ninguna vía (UI, REST
  directa, MCP).
- Agregar una métrica o columna al dataset nunca modifica ni borra las
  existentes, ni siquiera con dos escrituras concurrentes (probado en
  PostgreSQL).
- SQL Lab sigue funcionando igual (sus tests sin cambios).
- Todo se empaqueta en el `.supx`, sin parches al core; documentación y
  `Registro de cambios.md` al día.

## Fuera del alcance inicial

- Guardar el gráfico desde el asistente (lo guarda el usuario).
- Borrar o modificar métricas y columnas existentes del dataset (salvo
  "Deshacer" acotado de la Fase 7), cambiar su SQL, crear datasets o
  gráficos nuevos.
- Un rol configurable para escribir datasets: es Admin, fijo.
- Reutilizar en Explore las tools de SQL libre (`explain_query`,
  `check_query_nulls`).
- Manipular controles de Explore en vivo sin recarga (no hay API pública).
- Automatizar la pantalla por DOM (clics o escritura sobre controles).
- Escrituras autónomas o desde el MCP.

## Revisiones del plan

- **2026-09-24 — revisión externa, 4 puntos + alcance (todos verificados en
  el código antes de incorporarlos):**
  1. `form_data_key` refleja el último estado ejecutado, no los controles
     editados sin ejecutar (+ debounce de 1 s) → criterio de salida 1 de la
     Fase 0.
  2. `/api/v1/chart/data` necesita un `query_context` que arma el
     `buildQuery` de cada plugin en el navegador; el registro no se comparte
     con la extensión; `samples` anula métricas y filtro temporal → criterio
     de salida 2 de la Fase 0 y vista previa con `results`.
  3. `explain_query`/`check_query_nulls` aceptan SQL libre y solo verifican
     acceso a la base → diagnóstico ligado al gráfico, con RLS y acceso al
     dataset (Fase 4, punto 5), como puerta de la Fase 5.
  4. Comparar `changed_on` antes de escribir deja una carrera → bloqueo de
     fila + comprobación atómica en la misma transacción y prueba de dos
     escrituras concurrentes en PostgreSQL, como puerta de la Fase 7.
  - Alcance: rol Admin fijo; "Deshacer" del dataset como única forma de
    borrado permitida y acotada; ocultar "El Don" edita
    `custom-src/login/mcp_widget.py` como excepción explícita a la regla de
    editar solo la extensión.
