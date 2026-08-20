## Registro de cambios

Nota: anotar fecha y cambio realizado con los archivos afectados y que cambia o corrige.

### 2026-06-05 (6)

Cambio realizado:
Corrección completa de los dos bugs del plugin `plugin-chart-tableV3`. Esta entrada reemplaza/completa la (5).

**Bug 1 — Percentage metrics muestran 0% en filas normales con Show Summary activo**
Archivos afectados:
- `custom-plugins/plugin-chart-tableV3/src/transformProps.ts` (propagado a `superset_v6/`)

Causa raíz:
- Cuando `show_totals=true`, el backend inyecta `contribution_totals` en el post-procesado de contribución. Si hay un mismatch entre las claves del dict de totales y los nombres de columna del DataFrame principal, `contribution_totals.get(col)` retorna `None` → todas las filas quedan en 0.
- La fila de resumen ya estaba corregida (entrada 5) inyectando `%metric=1`. Las filas normales aún mostraban 0%.

Fix aplicado:
- En `transformProps.ts` (línea ~699), antes de `processDataRecords`, se computan los `%metric` client-side usando `totalQuery.data[0]` como grand total: `newRow[pctKey] = row[rawKey] / grandTotals[rawKey]`. Esto garantiza valores correctos independientemente de lo que devuelva el backend.

**Bug 2 — Sintaxis col./row. no funcionan en Calculated columns**
Archivos afectados:
- `custom-plugins/plugin-chart-tableV3/src/utils/calculatedColumns.ts` (propagado a `superset_v6/`)

Causa raíz adicional identificada:
- La regex `COL_ROW_ACCESS_REGEX = /\b(?:col|row)\.(\w+)/g` solo captura nombres con `\w+` (letras/dígitos/guión bajo). No maneja `col.{{Nombre}}` (sintaxis mixta) — dejaba `col.` como literal en el JS generado, produciendo error sintáctico.

Fix aplicado:
- Se agrega `COL_ROW_BRACE_PREFIX_REGEX = /\b(?:col|row)\.(?=\{\{)/g` que elimina el prefijo `col.`/`row.` cuando va seguido inmediatamente de `{{`. Esto normaliza `col.{{Nombre}}` → `{{Nombre}}` antes de que el paso 1 lo procese.
- Sintaxis soportadas ahora: `col.NombreSimple`, `row.NombreSimple`, `col.{{Nombre Con Espacios}}`, `row.{{Nombre Con Espacios}}`, `{{Nombre}}`.

### 2026-06-05 (5)

Cambio realizado:
Corrección parcial de bugs en `plugin-chart-tableV3` (ver entrada 6 para la versión completa).

**Bug 1 — Percentage metrics muestran 0% en el resumen (Show summary)**
Archivos afectados:
- `custom-plugins/plugin-chart-tableV3/src/transformProps.ts`

Que cambia o corrige:
- El query de totales (`buildQuery.ts`) envía `post_processing: []` al backend, eliminando la operación `contribution` que crea las columnas `%metric_name`. Por eso el row de totales llegaba al frontend sin esas columnas y el footer las mostraba vacías o con 0%.
- Fix: en `transformProps.ts`, después de obtener el raw totals, se inyectan las claves `%metric_name` con valor `1` (100 %) para cada percentage metric que no venga ya en el row. Esto es correcto porque la suma de todas las contribuciones por fila es siempre 1 (100 %).

**Bug 2 — Sintaxis col. y row. no funcionan en Calculated columns**
Archivos afectados:
- `custom-plugins/plugin-chart-tableV3/src/utils/calculatedColumns.ts`

Que cambia o corrige:
- `buildJsExpression` solo procesaba la sintaxis `{{ColumnName}}`. Las expresiones que usaban `col.NombreColumna` o `row.NombreColumna` quedaban sin sustituir y producían errores silenciosos.
- Fix: se agrega un paso de preprocesado (paso 0) con la regex `COL_ROW_ACCESS_REGEX` que normaliza `col.Name` / `row.Name` → `{{Name}}` antes de que el pipeline `{{...}}` las procese. Las columnas con espacios en el nombre siguen requiriendo la sintaxis `{{Nombre Columna}}`.

### 2026-06-05 (4)

Cambio realizado:
Se regeneraron los JSON compilados de `language_pack` para que el endpoint de idiomas no devuelva 404 en `superset_v6_1_0`.

Archivos afectados:
- `superset_v6_1_0/superset/translations/es/LC_MESSAGES/messages.json` (generado)
- `superset_v6_1_0/superset/translations/*/LC_MESSAGES/messages.json` (regenerados via `npm run build-translation`)

Que cambia o corrige:
- El endpoint `/superset/language_pack/es/` vuelve a encontrar el pack compilado de español y deja de caer en el 404 de “Language pack doesn't exist on the server”.
- Se restauraron los JSON de traducciones que consume `superset/views/core.py` al inicializar el frontend.
- Si se despliega desde fuente sin Docker, conviene ejecutar `npm run build-translation` en `superset_v6_1_0/superset-frontend` antes de arrancar `superset` para mantener estos packs presentes.

### 2026-06-05 (3)

Cambio realizado:
Marcadores aplican filtros in-place en el dashboard actual en lugar de redirigir al permalink.

Archivos afectados:
- `custom-src/FilterBarTabs/BookmarksTab.tsx` (actualizado)

Que cambia o corrige:
- Al hacer click en el nombre de un marcador, en lugar de navegar al permalink, se aplican los filtros directamente al dashboard cargado. Internamente: carga el estado guardado via `GET /api/v1/dashboard/permalink/{key}`, despacha `updateDataMask` para cada filtro del marcador y `clearDataMask` para los filtros que no estaban activos en el marcador, y opcionalmente despacha `setActiveTabs` si el marcador incluía tabs. Los charts re-fetchen automáticamente al actualizarse `state.dataMask` en Redux.
- El botón "Copy link" permanece para que el usuario pueda obtener la URL si quiere navegar manualmente.
- Se unificó la caché de detalles y payload del permalink en una sola estructura `CachedEntry` para evitar llamadas duplicadas entre "ver detalles" y "aplicar".

### 2026-06-05 (2)

Cambio realizado:
Implementación completa de la UI de marcadores en la pestaña "Bookmarks" de la barra de filtros.

Archivos afectados:
- `custom-src/FilterBarTabs/BookmarksTab.tsx` (nuevo — fuente canónica)
- `custom-src/FilterBarTabs/FilterBarTabs.tsx` (actualizado: import y uso de BookmarksTab)
- `PLUGINS.md` (sección y tabla actualizadas)

Que cambia o corrige:
- La pestaña "Bookmarks" de la barra de filtros ahora muestra la gestión completa de marcadores.
- Botón "Save current view": abre modal para nombrar y guardar el estado actual (filtros + tabs activos) via `POST /api/v1/dashboard/{id}/permalink` + `POST /api/v1/dashboard/bookmark/`.
- Lista de marcadores del dashboard actual: cada item muestra el nombre (botón que aplica los filtros), botón copiar URL, botón eliminar con confirmación (Popconfirm).
- Sección expandible por marcador: carga lazy el estado de filtros via `GET /api/v1/dashboard/permalink/{key}` y muestra nombre de filtro + valor para los filtros aplicados.
- Estado vacío con imagen cuando no hay marcadores.

### 2026-06-05

Cambio realizado:
Pestañas "Filters" / "Bookmarks" en la barra de filtros vertical del dashboard.

Archivos afectados:
- `custom-src/FilterBarTabs/FilterBarTabs.tsx` (nuevo — fuente canónica)
- `superset_v6_1_0/superset-frontend/src/dashboard/components/nativeFilters/FilterBar/FilterBarTabs/` (symlink → custom-src/FilterBarTabs/)
- `superset_v6_1_0/superset-frontend/src/dashboard/components/nativeFilters/FilterBar/Vertical.tsx` (patch)
- `migrate-plugins.sh` (paso 13 agregado)
- `PLUGINS.md` (sección y tabla actualizadas)

Que cambia o corrige:
- La barra de filtros vertical ahora muestra dos pestañas debajo del header: "Filters" (comportamiento existente) y "Bookmarks" (placeholder, se implementa en el siguiente paso).
- El componente `FilterBarTabs` reemplaza el div scrollable por un antd Tabs donde la pestaña "Filters" contiene todo el contenido original (CrossFilters + FilterControls) con el mismo área de scroll.
- Los botones Apply/Clear (actions) siguen posicionados absolutamente fuera del área de tabs, sin cambios.

### 2026-06-04

Cambio realizado:
Se deshabilito la carga de tareas de `GLOBAL_ASYNC_QUERIES` en Celery al quedar el feature flag apagado.

Archivos afectados:
- `superset_v6_1_0/superset/config.py`

Que cambia o corrige:
- Se elimina `superset.tasks.async_queries` de `CeleryConfig.imports`.
- Se eliminan las rutas `load_chart_data_into_cache` y `load_explore_json_into_cache` mientras `GLOBAL_ASYNC_QUERIES` esta desactivado.
- Corrige el error `RuntimeError: Working outside of application context` al arrancar el worker Celery.

Verificacion:
- `python -m py_compile superset/config.py`
- `timeout 15s .venv/bin/python -m celery --app=superset.tasks.celery_app:app worker --hostname=v610-test@%h --pool=solo -O fair -Q celery,sql,thumbnails,warmup --loglevel=INFO`

### 2026-06-04

Cambio realizado:
Se reemplazo el secreto temporal de `GLOBAL_ASYNC_QUERIES_JWT_SECRET` por un token seguro de mas de 32 caracteres.

Archivos afectados:
- `superset_v6_1_0/superset/config.py`

Que cambia o corrige:
- Corrige el error `AsyncQueryTokenException: Please provide a JWT secret at least 32 bytes long` al arrancar Celery con `GLOBAL_ASYNC_QUERIES` activo.
- Permite que Superset inicialice `AsyncQueryManager` durante el arranque de la app/Celery.

Verificacion:
- `.venv/bin/python -c "import superset.config; print(len(superset.config.GLOBAL_ASYNC_QUERIES_JWT_SECRET))"`
- `.venv/bin/python -m celery --app=superset.tasks.celery_app:app inspect registered`

### 2026-06-04

Cambio realizado:
Se corrigio el arranque de `superset_test` agregando el import faltante de `FixedExecutor`.

Archivos afectados:
- `superset_v6_1_0/superset/config.py`

Que cambia o corrige:
- Corrige el error `NameError: name 'FixedExecutor' is not defined` al importar `superset.config`.
- Permite usar `THUMBNAIL_EXECUTORS = [FixedExecutor("admin")]` para generar thumbnails con el usuario fijo `admin`.

Verificacion:
- `.venv/bin/python -c "import superset.config; print('ok')"`
- `python -m py_compile superset/config.py`

### 2026-06-04

Cambio realizado:
Se ajusto `THEME_DARK` en `superset_v6_1_0` para que el cambio a modo oscuro tenga fondos y textos oscuros reales.

Archivos afectados:
- `superset_v6_1_0/superset/config.py`

Que cambia o corrige:
- `THEME_DARK` deja de heredar todo `THEME_DEFAULT`, evitando arrastrar tokens claros al modo oscuro.
- Se agregan tokens explicitos de fondo/texto dark: `colorBgLayout`, `colorBgContainer`, `colorBgElevated`, `colorBgSpotlight`, `colorBorder`, `colorSplit`, `colorText`, `colorTextSecondary` y `colorTextTertiary`.
- Se conservan branding, logo, fuente y colores Irex del tema oscuro de v6.
- Se agregan overrides para `Card` y `Layout` para mejorar el contraste visual al cambiar de claro a oscuro.

Verificacion:
- `python -m py_compile superset_v6_1_0/superset/config.py`

### 2026-06-04

Cambio realizado:
Se migro el tema Irex por defecto de `superset_v6` a `superset_v6_1_0` usando los tokens de tema de Superset 6.1.0.

Archivos afectados:
- `superset_v6_1_0/superset/config.py`

Que cambia o corrige:
- `THEME_DEFAULT` recupera la paleta azul/verde, componentes y fuente del tema de v6.
- `THEME_DARK` recupera los overrides oscuros de v6 manteniendo `algorithm: "dark"`.
- Los fonts de v6 se pasan a `THEME_DEFAULT["token"]["fontUrls"]`, reemplazando el uso anterior de `CUSTOM_FONT_URLS`.
- El branding del logo se define en tokens (`brandAppName`, `brandLogoAlt`, `brandLogoUrl`, `brandLogoHref`) porque en 6.1.0 `APP_NAME` ya no controla el branding del frontend.

Verificacion:
- `python -m py_compile superset_v6_1_0/superset/config.py`

### 2026-06-04

Cambio realizado:
Se agrego `'unsafe-eval'` al `script-src` de `TALISMAN_CONFIG` en Superset v6.1.0 para permitir la compilacion runtime de templates Handlebars usada por `plugin-chart-html-cards`.

Archivos afectados:
- `superset_v6_1_0/superset/config.py`

Que cambia o corrige:
- La CSP productiva deja de bloquear `Handlebars.compile()` con el error de `unsafe-eval` cuando renderiza tarjetas HTML.
- `TALISMAN_DEV_CONFIG` ya tenia `'unsafe-eval'`; se verifico y no se duplico.

Verificacion:
- `rg -n "TALISMAN_CONFIG|TALISMAN_DEV_CONFIG|script-src" superset_v6_1_0/superset/config.py`

### 2026-06-04

Cambio realizado:
Correccion en `superset_v6_1_0` para filtros dependientes con `Select first filter value by default`.

Archivos afectados:
- `superset_v6_1_0/superset-frontend/src/dashboard/components/nativeFilters/dependencyGraph.ts`
- `superset_v6_1_0/superset-frontend/src/dashboard/components/nativeFilters/FilterBar/FilterControls/state.ts`
- `superset_v6_1_0/superset-frontend/src/dashboard/components/nativeFilters/FilterBar/FilterControls/state.test.ts`
- `superset_v6_1_0/superset-frontend/src/dashboard/components/nativeFilters/FilterBar/FilterControls/FilterValue.tsx`

Que cambia o corrige:
- Se restaura la guarda existente en v6 para padres `requiredFirst`: un filtro hijo no consulta opciones hasta que el filtro padre tenga valor y `extraFormData`.
- Corrige el caso ano -> mes donde el mes cargaba primero sin el filtro de ano, los graficos renderizaban con un mes incorrecto y luego quedaba pendiente presionar `Aplicar filtros`.
- La guarda se adapto al modelo de v6.1.0 con dependencias transitivas para cubrir cadenas de filtros.

Verificacion:
- `npx jest --runInBand src/dashboard/components/nativeFilters/FilterBar/FilterControls/state.test.ts`

### 2026-06-03 (actualización 20)

Mejoras al login personalizado: eliminar botón Novedades v6.0 y añadir toggle de tema claro/oscuro.

Archivos afectados:
- `custom-src/login/templates/custom_login.html`: eliminado botón "Novedades v6.0"; añadido script anti-parpadeo de tema en <head>; añadido botón #themeToggleBtn (sol/luna) en panel derecho
- `custom-src/login/static/customcss/custom_login.css`: variables CSS convertidas a modo dual claro/oscuro con tokens de Superset/antd; añadidos estilos .theme-toggle-btn y [data-theme="dark"]
- `custom-src/login/static/js_personal/custom_login.js`: añadida lógica toggleTheme() que escribe 'superset-theme-mode' en localStorage con valores 'dark'/'default' (misma clave y valores que usa Superset internamente)
- Propagado a superset_v6_1_0 y superset_v6

Qué cambia y por qué:
- Botón novedades eliminado a pedido del usuario.
- El toggle escribe localStorage['superset-theme-mode'] = 'dark'/'default' — la misma clave
  que ThemeController.ts (STORAGE_KEYS.THEME_MODE) usa para leer el tema al arrancar Superset.
  Así el cambio desde el login es persistido y Superset lo aplica automáticamente al entrar.
- Un script inline en <head> aplica data-theme="dark" antes de renderizar para evitar parpadeo
  (FOUC). También respeta la preferencia del OS si no hay valor guardado en localStorage.
- Las variables CSS del modo oscuro usan los tokens de antd dark theme:
  colorBgContainer=#1f1f1f, colorBgElevated=#262626, colorText=rgba(255,255,255,.88).

### 2026-06-03 (actualización 19)

Fix: animación Lottie del login no renderizaba en v6.1.0 por CSP.

Archivos afectados:
- `custom-src/login/templates/custom_login.html`: reemplazado CDN de lottie por versión self-hosted con nonce
- `custom-src/login/static/js_personal/lottie.min.js`: lottie-web 5.12.2 descargado (300KB)
- `superset_v6_1_0/superset/templates/appbuilder/custom_login.html`: propagado
- `superset_v6_1_0/superset/static/js_personal/lottie.min.js`: propagado
- `superset_v6/superset/templates/appbuilder/custom_login.html`: propagado (consistencia)
- `superset_v6/superset/static/js_personal/lottie.min.js`: propagado (consistencia)
- `migrate-plugins.sh`: paso 11c ahora incluye lottie.min.js

Qué cambia y por qué:
- En v6.1.0, TALISMAN_ENABLED=True activa la CSP con script-src='self'+'strict-dynamic'.
  El script externo de cdnjs.cloudflare.com era bloqueado por la política. En v6, TALISMAN_ENABLED=False
  por lo que no había problema.
- Solución: lottie.min.js se auto-hospeda en static/js_personal/ y se carga con nonce,
  igual que custom_login.js.

### 2026-06-03 (actualización 18)

Migración de "Custom Login Page Configuration (Irex)" de superset_v6 a superset_v6_1_0.
Incluye login personalizado con Jinja, recuperación de contraseñas y paso 11 en migrate-plugins.sh.

Archivos afectados:
- `superset_v6_1_0/superset/config.py`: añadido bloque Custom Login (CustomAuthDBView, CustomSecurityManager, CUSTOM_SECURITY_MANAGER)
- `superset_v6_1_0/superset/security/password_reset.py`: copiado desde v6 (PasswordResetView + PasswordResetSecurityManager)
- `superset_v6_1_0/superset/templates/appbuilder/custom_login.html`: plantilla de login personalizado
- `superset_v6_1_0/superset/templates/appbuilder/novedades.html`: modal de novedades incluido en custom_login.html
- `superset_v6_1_0/superset/templates/appbuilder/password/request.html`: formulario de solicitud de recuperación
- `superset_v6_1_0/superset/templates/appbuilder/password/reset.html`: formulario de nueva contraseña
- `superset_v6_1_0/superset/templates/appbuilder/password/email_reset.html`: plantilla HTML del correo de recuperación
- `superset_v6_1_0/superset/static/customcss/custom_login.css`: estilos del login personalizado
- `superset_v6_1_0/superset/static/customcss/password_flow.css`: estilos del flujo de recuperación de contraseña
- `superset_v6_1_0/superset/static/js_personal/custom_login.js`: JS del login (modal demo, novedades, toggle password)
- `superset_v6_1_0/superset/static/js_personal/password_reset.js`: JS del flujo de recuperación
- `custom-src/login/`: fuente canónica de todos los archivos del login (nueva carpeta)
- `superset_v6_1_0/superset/static/assets/images/irex_ss.gif`: logo animado del panel izquierdo
- `superset_v6_1_0/superset/static/assets/images/business_presentation.json`: animación Lottie del panel izquierdo
- `superset_v6_1_0/superset/static/assets/images/novedades/favoritos.gif` + `tema_oscuro.gif`: GIFs del modal de novedades
- `superset_v6_1_0/superset/static/video_superset/Presentacion Superset.mp4` + `subtitulos.vtt`: video demo
- `custom-src/login/static/`: fuente canónica de todos los assets (excepto el .mp4 de 90MB)
- `migrate-plugins.sh`: añadido paso 11 (11a–11d) para automatizar la migración del login en futuras versiones

Qué cambia y por qué:
- El login estándar de Superset 6 usa una SPA React en /login/. Se reemplaza con una vista
  Jinja servidor-lado (CustomAuthDBView) que renderiza custom_login.html con diseño Irex.
- Se añade flujo completo de recuperación de contraseña (PasswordResetView en /password/solicitar/
  y /password/restablecer/<token>/) con envío de correo SMTP firmado con itsdangerous.
- El script migrate-plugins.sh copia desde custom-src/login/ y parchea config.py automáticamente,
  de modo que migraciones a versiones futuras de Superset solo requieren correr el script.

### 2026-05-29 (actualización 17)

Documentacion del plugin html-cards actualizada (INSTRUCCIONES_PLUGIN_HTML_CARDS.md):
- Corrección de version (v6 → v6.1.0)
- Requisito previo HTML_SANITIZATION = False documentado
- Transformacion snakeCase de templateKey documentada con tabla de ejemplos
- Nueva sección de acceso por índice con data.[N] (reemplaza lookup rows N que falla)
- firstRow documentado como alternativa confiable a firstDisplayRow
- Tabla de variables raíz con descripción y guía de uso
- Sección "Problemas conocidos en v6.1.0" con workarounds

Nota de soporte: el error "Missing helper: numberFormatD3" se debe a usar el tipo de chart
incorrecto (plugin-chart-handlebars en lugar de html_cards). El plugin-chart-handlebars nativo
de Superset no tiene los helpers custom del html-cards (numberFormatD3, timeFormatD3, etc.).
Asegurarse de que el chart tenga viz_type = html_cards.

### 2026-05-29 (actualización 16)

Fix imports en `HandlebarsViewer.tsx` del plugin `plugin-chart-html-cards`.

Archivos afectados:
- `custom-plugins/plugin-chart-html-cards/src/components/Handlebars/HandlebarsViewer.tsx`

Qué cambia y por qué:
- `styled` y `t` se importaban desde `@superset-ui/core`. En v6.1.0, eso causa una
  dependencia circular (el step 3b agrega re-exports de `@apache-superset/core/*` en
  `@superset-ui/core`), haciendo que `styled` sea `undefined` al inicializar el módulo.
  Al fallar la definición de los styled-components, el módulo aborta antes de ejecutar
  los `Handlebars.registerHelper(...)`, dando "Missing helper: numberFormatD3" en runtime.
- Fix: importar `styled` desde `@apache-superset/core/theme` y `t` desde
  `@apache-superset/core/translation`, igual que el resto de plugins en v6.1.0.
- Requiere `npm run build` en `superset_v6_1_0/superset-frontend`.

### 2026-05-29 (actualización 15)

Aplicación del fix de 2026-05-14 a `superset_v6_1_0` (bug: filtro con `Select first filter value by default` no se podía dejar vacío).

Archivos afectados en `superset_v6_1_0/`:
- `superset-frontend/src/filters/components/Select/SelectFilterPlugin.tsx`:
  - Agregado `const isChangedByUser = useRef(false)` (ref faltante)
  - Agregado `isChangedByUser.current = true` en `handleChange` (marca cambio explícito del usuario)
  - Agregado `isChangedByUser.current = false` en el efecto de cambio de datos upstream
  - Agregado early return `if (isChangedByUser.current) return` en el useEffect de resync
  - Cambiado `filterState.value !== undefined` → `filterState.value != null` en la condición de resync
- `superset-frontend/src/dashboard/components/nativeFilters/FilterBar/index.tsx`:
  - Reemplazada la condición `if (appliedChanged || notInitialized)` por lógica que distingue
    filtros no inicializados (siempre actualizar) de filtros con cambio aplicado: solo actualiza
    si `isEqual(selectedValue, prevValue)` (el usuario no modificó el filtro manualmente).

Nota: este fix no se agrega a `migrate-plugins.sh` ya que puede ser corregido por Superset en versiones futuras.

### 2026-05-29 (actualización 14)

Migración de personalización de pantalla de dashboards (v6 → v6_1_0).

Archivos canónicos agregados a `custom-src/`:
- `custom-src/FavoritesBanner/FavoritesBanner.tsx` — barra horizontal de favoritos con scroll
  lateral, que aparece sobre la lista de dashboards. Muestra los dashboards marcados como
  favoritos por el usuario con tarjetas compactas.
- `custom-src/DashboardTagSidebar/DashboardTagSidebar.tsx` — barra lateral izquierda con
  filtro de dashboards por categoría (tags de tipo "custom"). En desktop se muestra por
  defecto; en móvil es un drawer colapsable.
- `custom-src/patch_dashboard_list.py` — script Python que parchea
  `src/pages/DashboardList/index.tsx` para integrar los dos componentes anteriores.

- `custom-src/ListViewCard/index.tsx` — tarjetas en layout horizontal (thumbnail
  cuadrado 120×120 a la izquierda, body con título/descripción/acciones a la derecha).

Archivos resultantes en `superset_v6_1_0/`:
- `superset-frontend/src/features/dashboards/FavoritesBanner.tsx` ← symlink a custom-src
- `superset-frontend/src/features/dashboards/DashboardTagSidebar.tsx` ← symlink a custom-src
- `superset-frontend/packages/superset-ui-core/src/components/ListViewCard/index.tsx` ← symlink a custom-src (layout horizontal, thumbnail cuadrado izquierda)
- `superset-frontend/src/pages/DashboardList/index.tsx` — parcheado con 5 cambios:
    A. Imports de useHistory, useLocation, FavoritesBanner, DashboardTagSidebar
    B. Styled components PageLayout, ListArea, ToggleSidebarButton
    C. Estado showTagSidebar + callbacks getCurrentTagId y handleTagSelect
    D. Variable subMenuName con botón de toggle de sidebar
    E. Render: envuelve ListView con PageLayout/ListArea, agrega DashboardTagSidebar arriba
       y FavoritesBanner sobre la lista
- `superset-frontend/src/components/ListView/CardCollection.tsx` — grid cambiado de
  `repeat(auto-fit, 300px)` a `repeat(auto-fill, minmax(340px, 1fr))` con breakpoints
  responsive (≤1800px→300px, ≤1400px→280px, ≤1200px→240px): da 5 tarjetas/fila en
  pantallas típicas de escritorio en lugar de 6.

`migrate-plugins.sh` actualizado con paso 10 (10a, 10b, 10c).
`PLUGINS.md` actualizado con las nuevas reglas de workflow para estos componentes.

### 2026-05-28 (actualización 13)

Cambio realizado:
Fix de 2 bugs en el export CSV/Excel de Formula metrics del pivot_table_rx1.

Bug 1 — Sort rows by no se respetaba en el CSV/Excel:
  pivot_df (que usa pd.DataFrame.pivot_table) ordena el índice alfabéticamente,
  destruyendo el orden definido por "Sort rows by". Fix: antes de llamar a pivot_df
  se captura el orden original de los valores únicos del índice de fila tal como
  viene del DB, y después del pivot se restaura ese orden con df.loc[reindex].

Bug 2 — Fórmula con dependencia de otra oculta salía vacía:
  _get_pivot_rx1_export_formulas filtraba las fórmulas ocultas (hidden=True), pero
  otras fórmulas podían depender de ellas (ej: 80_20 usa {{peso}} y peso estaba oculta).
  Fix: ahora se computan TODAS las fórmulas (visibles + ocultas) en _apply_pivot_rx1_formulas.
  Las ocultas se agregan a excluded_columns → se eliminan del CSV antes de devolver el resultado.
  En pivot_table_rx1 solo se incluyen las visibles como métricas del pivot.

Archivos afectados:
- `superset_v6_1_0/superset/charts/client_processing.py` — pivot_table_rx1 con restauración de orden
- `superset_v6_1_0/superset/common/query_context_processor.py` — _get_pivot_rx1_export_formulas
  ahora devuelve todas las fórmulas + lista de etiquetas a excluir (ocultas + jinja fields)

### 2026-05-28 (actualización 12)

Cambio realizado:
Fix definitivo del export CSV/Excel de Formula metrics en pivot_table_rx1.

Causa raíz encontrada con logs: get_data sí añadía las columnas de fórmulas al DataFrame
y las serializaba en el CSV. Pero apply_client_processing (para result_type=post_processed)
re-leía ese CSV como DataFrame y lo re-pivoteaba con pivot_table_v2, que solo pivotea las
métricas de form_data["metrics"] — ignorando completamente las columnas de fórmulas.

Archivos afectados:
- `superset_v6_1_0/superset/charts/client_processing.py`
  — Nueva función pivot_table_rx1(): idéntica a pivot_table_v2() pero agrega las formula
    metrics visibles (metricFormulas no hidden que existan como columna en el df) a la
    lista de métricas antes de llamar a pivot_df().
  — post_processors: "pivot_table_rx1" ahora apunta a pivot_table_rx1 (antes a pivot_table_v2)

- `superset_v6_1_0/superset/common/query_context_processor.py`
  — _irex_log, _evaluate_pivot_formula_for_row, _apply_pivot_rx1_formulas,
    _get_pivot_rx1_export_formulas: métodos de soporte (algunos temporales de debug)

Script migrate-plugins.sh actualizado: paso 8c reescrito con el post-processor correcto.

### 2026-05-28 (actualización 11)

Cambio realizado:
Segunda iteración del fix de exports CSV/Excel para Formula metrics del pivot-tableRx1.
En lugar de depender de extras.calculated_columns_export (cadena de serialización compleja
y propensa a fallos), ahora el backend lee metricFormulas y jinja_fields directamente
desde form_data, que siempre está disponible en el QueryContext.

Archivo afectado:
- `superset_v6_1_0/superset/common/query_context_processor.py`
  — `_SCOPED_REF_RE`: regex de clase para detectar referencias con scope
  — `_get_pivot_rx1_export_formulas()`: nuevo método que lee form_data.metricFormulas,
    filtra ocultas y fórmulas con scope, y también devuelve los jinja fields a excluir
  — `get_data`: usa _get_pivot_rx1_export_formulas() en lugar de extras para pivot_table_rx1

### 2026-05-28 (actualización 10)

Cambio realizado:
Fix del bug que impedía ver las fórmulas de Formula metrics en los exports CSV/Excel.

Causa raíz: en `get_data` de `query_context_processor.py`, el `verbose_map` (que renombra
columnas de nombres internos de BD a nombres visibles como "Venta") se aplicaba AL FINAL,
DESPUÉS de computar las fórmulas. Las fórmulas como `{{Venta}}/{{Plan}}` buscaban la columna
"Venta" en el dataframe, pero en ese punto aún se llamaba "sum__ventas" (nombre interno),
por lo que no encontraban nada y devolvían null.

Archivo afectado:
- `superset_v6_1_0/superset/common/query_context_processor.py`
  — `get_data`: `verbose_map` ahora se aplica PRIMERO (renombra todas las columnas a sus
    nombres visibles), y LUEGO se computan las fórmulas, se excluyen columnas y se aplican
    los `column_display_names`. De esta forma `{{Venta}}` siempre encuentra la columna
    correcta independientemente del nombre interno usado por la BD.

### 2026-05-28 (actualización 9)

Cambio realizado:
Fix de exports CSV/Excel en plugin pivot-tableRx1: las formula metrics visibles (no auxiliares)
ahora se incluyen en el export. Los Jinja fields se excluyen del export automáticamente.

Archivo afectado:
- `custom-plugins/plugin-chart-pivot-tableRx1/src/plugin/buildQuery.ts`
  — exportableFormulas: formula metrics visibles y sin referencias con scope (total./row./col./
    previous./next.) se envían como extras.calculated_columns_export al backend.
    El backend ya tiene el evaluador (_evaluate_export_formula) que las computa sobre
    los datos planos antes de serializar a CSV/Excel.
  — jinjaFieldLabels: los Jinja fields se envían como extras.excluded_columns para que
    no aparezcan en el export (son métricas auxiliares de la BD).

Notas técnicas:
- Las fórmulas con referencias de scope (total.{{X}}, row.{{X}}, etc.) NO se incluyen en
  el export porque dependen de la estructura pivoteada que no existe en los datos planos.
  Se excluyen con SCOPED_REF_PATTERN antes de enviarlas al backend.
- El mecanismo calculated_columns_export ya existía en query_context_processor.py (agregado
  para el plugin tableV3), se reutiliza aquí sin cambios de backend.

### 2026-05-28 (actualización 8)

Cambio realizado:
Nueva funcionalidad "Auxiliar (no mostrar en tabla)" en Formula metrics (Jinja-like) del
plugin pivot-tableRx1. Permite usar una fórmula como variable intermedia en otras fórmulas
sin que aparezca como columna en la tabla ni en exports CSV/Excel.
También corregido el problema de symlinks con webpack (resolve.symlinks: false).

Archivos afectados:
- `custom-plugins/plugin-chart-pivot-tableRx1/src/types.ts`
  — hidden?: boolean agregado a FormulaMetric
- `custom-plugins/plugin-chart-pivot-tableRx1/src/plugin/controlPanel.tsx`
  — hidden en MetricFormulaItem, normalizeMetricFormulasValue preserva hidden,
    buildMetricOrderOptions filtra métricas ocultas (no aparecen en Metric order)
- `custom-plugins/plugin-chart-pivot-tableRx1/src/plugin/transformProps.ts`
  — parseFormulaMetrics preserva el campo hidden
- `custom-plugins/plugin-chart-pivot-tableRx1/src/PivotTableChart.tsx`
  — normalizedFormulaMetrics preserva hidden
  — visibleFormulaMetricNames = solo las no ocultas
  — metricNames y unpivotedData usan visibleFormulaMetricNames (ocultas no se renderizan)
  — formulaMetricNames (todas, incluidas ocultas) sigue usándose para excluir de jinjaFields
- `custom-src/FormulaMetricControl/index.tsx`
  — hidden en props, state y defaultProps
  — Checkbox "Auxiliar (no mostrar en tabla)" en el popover
  — textSummary muestra "[aux]" como prefijo cuando hidden=true
  — onSave envía hidden al onChange
- `superset_v6_1_0/superset-frontend/webpack.config.js`
  — resolve.symlinks: false para que babel-loader y módulos npm se resuelvan
    correctamente con plugins/controles en directorios symlinkeados

Scripts/docs actualizados:
- `migrate-plugins.sh` — paso 1b: parchea webpack.config.js
- `PLUGINS.md` — documenta resolve.symlinks: false

### 2026-05-28 (actualización 7)

Cambio realizado:
Documentación de previous.{{}} y next.{{}} en FormulaMetricControl del plugin pivot-tableRx1.
También corregido un bug de path relativo en el symlink del control.

Archivos afectados:
- `custom-src/FormulaMetricControl/index.tsx`
  - Intellisense: agregados previous.{{Metric}} y next.{{Metric}} en getKeywords()
  - Tooltip del campo Formula: menciona previous y next como scopes disponibles
  - Ejemplos en el popover: agregado "{{Venta}} - previous.{{Venta}}" y línea "Scopes"
  - Modal de ayuda: sección Scopes con previous y next documentados con ejemplos
  - Fix: import de ControlPopover cambiado de relativo '../...' a absoluto
    'src/explore/components/controls/ControlPopover/ControlPopover' para que funcione
    correctamente cuando el archivo se carga desde el symlink en custom-src/.

### 2026-05-28 (actualización 6)

Cambio realizado:
Reestructuración de la arquitectura de plugins para evitar duplicación de lógica.
Conversión de copias a symlinks para plugins y controles custom.
Reescritura completa del script de migración con todos los pasos acumulados.
Creación de PLUGINS.md con instrucciones para herramientas IA.

Cambios estructurales:
- Los directorios plugin-chart-tableV3, plugin-chart-pivot-tableRx1, plugin-chart-html-cards
  dentro de superset_v6_1_0/superset-frontend/plugins/ ahora son SYMLINKS a custom-plugins/.
- FormulaMetricControl y MetricOrderControl dentro de
  superset_v6_1_0/superset-frontend/src/explore/components/controls/ son SYMLINKS a custom-src/.
- ColumnConfigControl sigue siendo una copia (5 archivos individuales dentro de un directorio
  de Superset, no se puede symlink completo).

Archivos creados/modificados:
- `migrate-plugins.sh` — reescrito completo con 9 pasos (incluye HTML_SANITIZATION y symlinks)
- `PLUGINS.md` — guía de arquitectura y workflow para herramientas IA
- `CLAUDE.md` — referencia a PLUGINS.md
- `AGENTS.md` — referencia a PLUGINS.md

### 2026-05-28 (actualización 5)

Cambio realizado:
Fix del error React #130 en plugin-chart-pivot-tableRx1. Los controles FormulaMetricControl y
MetricOrderControl no existían en v6.1.0, causando que el componente se resolviera como `undefined`.

Archivos creados en superset_v6_1_0:
- `superset_v6_1_0/superset-frontend/src/explore/components/controls/FormulaMetricControl/index.tsx`
- `superset_v6_1_0/superset-frontend/src/explore/components/controls/MetricOrderControl/index.tsx`

Archivos modificados en superset_v6_1_0:
- `superset_v6_1_0/superset-frontend/src/explore/components/controls/index.ts` — imports y exports
  de FormulaMetricControl y MetricOrderControl agregados al mapa de controles.

Archivos creados en custom-src/:
- `custom-src/FormulaMetricControl/index.tsx`
- `custom-src/MetricOrderControl/index.tsx`

Script migrate-plugins.sh actualizado: paso 6b.

### 2026-05-28 (actualización 4)

Cambio realizado:
Fix de pivot-tableRx1 en v6.1.0: Jinja fields, Formula metrics y Metric order no funcionaban porque
el backend no reconocía el viz_type "pivot_table_rx1" en dos lugares críticos.

Archivos afectados en superset_v6_1_0:
- `superset_v6_1_0/superset/charts/client_processing.py` — agregado "pivot_table_rx1": pivot_table_v2
  al dict post_processors. Sin esto el servidor no aplicaba la operación de pivoteo y devolvía
  datos planos en vez de la estructura de tabla pivoteada que el frontend espera.
- `superset_v6_1_0/superset/common/query_context_factory.py` — extendido el check de viz_type
  para incluir "pivot_table_rx1" junto a "pivot_table_v2" en la inyección de currency_code_column.

Nota: Jinja fields, formula metrics y metric order son procesamiento 100% frontend
(transformProps.ts + PivotTableChart.tsx). El único backend necesario es el pivoteo del dataframe,
que ahora sí se aplica al Rx1.

Script migrate-plugins.sh actualizado: pasos 7c y 7d en la sección de backend Python.

### 2026-05-28 (actualización 3)

Cambio realizado:
Fix del error "Unknown field" en v6.1.0 para los campos Jinja (column_display_names, excluded_columns,
calculated_columns_export, column_export_order) del plugin TableV3. El backend de v6.1.0 no conocía
estos campos en la validación Marshmallow ni tenía la lógica de procesamiento para exports.

Archivos afectados en superset_v6_1_0:
- `superset_v6_1_0/superset/charts/schemas.py` — 4 campos nuevos agregados a ChartDataExtrasSchema
- `superset_v6_1_0/superset/common/query_context_processor.py` — imports ast/numpy, 3 helpers
  (_evaluate_export_formula, _apply_export_calculated_columns, _apply_export_column_order) y
  método get_data extendido con la lógica completa de procesamiento de columnas custom

Script migrate-plugins.sh actualizado: agrega paso 7 (parches de backend Python).

### 2026-05-28 (actualización 2)

Cambio realizado:
Corrección de imports rotos en v6.1.0: t, tn, addLocaleData, css, styled, useTheme, GenericDataType se movieron
de @superset-ui/core a @apache-superset/core en v6.1.0. Se agregaron re-exports en @superset-ui/core/index.ts
para mantener compatibilidad sin tocar los plugins. También se restauró el "Customize columns" del TableV3
(Display name + pestaña HTML con htmlTemplate y htmlCss) copiando 5 archivos de ColumnConfigControl desde v6.

Archivos afectados en superset_v6_1_0:
- `superset_v6_1_0/superset-frontend/packages/superset-ui-core/src/index.ts` — re-exports de compatibilidad
- `superset_v6_1_0/superset-frontend/src/explore/components/controls/ColumnConfigControl/constants.tsx` — Display name + HTML tab + HTML_TEMPLATE_EXAMPLES + HTML_TEMPLATE_AI_PROMPT
- `superset_v6_1_0/superset-frontend/src/explore/components/controls/ColumnConfigControl/ColumnConfigPopover.tsx` — HtmlTemplateHelpPanel
- `superset_v6_1_0/superset-frontend/src/explore/components/controls/ColumnConfigControl/types.ts` — tipos SharedColumnConfigProp actualizados
- `superset_v6_1_0/superset-frontend/src/explore/components/controls/ColumnConfigControl/ControlForm/controls.ts` — TextAreaControl agregado
- `superset_v6_1_0/superset-frontend/src/explore/components/controls/ColumnConfigControl/ControlForm/index.tsx` — imports

Archivos creados en el proyecto raíz:
- `custom-src/ColumnConfigControl/` — copia de los 5 archivos para uso del script de migración

Script migrate-plugins.sh actualizado: agrega paso 3b (re-exports) y paso 6 (ColumnConfigControl).

### 2026-05-28

Cambio realizado:
Migración de plugins personalizados irex (tableV3, pivot-tableRx1, html-cards) a superset_v6_1_0.
Creación de script reutilizable `migrate-plugins.sh` para automatizar migraciones futuras.

Archivos creados/afectados en superset_v6_1_0:
- `superset_v6_1_0/superset-frontend/plugins/plugin-chart-tableV3/` (copiado)
- `superset_v6_1_0/superset-frontend/plugins/plugin-chart-pivot-tableRx1/` (copiado)
- `superset_v6_1_0/superset-frontend/plugins/plugin-chart-html-cards/` (copiado)
- `superset_v6_1_0/superset-frontend/package.json` — agregadas 3 entradas file: para los plugins personalizados
- `superset_v6_1_0/superset-frontend/packages/superset-ui-core/src/chart/types/VizType.ts` — agregados HtmlCards, PivotTableRx1, TableV3 al enum
- `superset_v6_1_0/superset-frontend/src/setup/setupPluginsExtra.ts` — registro de los 3 plugins (reemplaza el patrón de modificar MainPreset.ts)
- `superset_v6_1_0/superset-frontend/src/explore/components/useExploreAdditionalActionsMenu/index.tsx` — agrega VizType.PivotTableRx1 a VIZ_TYPES_PIVOTABLE
- `superset_v6_1_0/superset-frontend/src/dashboard/components/SliceHeaderControls/index.tsx` — agrega VizType.PivotTableRx1 a isPivotTable
- `superset_v6_1_0/superset-frontend/src/features/reports/ReportModal/index.tsx` — agrega VizType.PivotTableRx1 a TEXT_BASED_VISUALIZATION_TYPES
- `superset_v6_1_0/superset-frontend/src/features/alerts/AlertReportModal.tsx` — agrega VizType.PivotTableRx1 a TEXT_BASED_VISUALIZATION_TYPES

Archivos creados en el proyecto raíz:
- `custom-plugins/` — directorio con los 3 plugins fuera del repo de Superset (fuente canónica para futuras migraciones)
- `migrate-plugins.sh` — script que automatiza todos los pasos anteriores para cualquier versión futura de Superset

Que cambia o corrige:
- Los plugins personalizados quedan disponibles en v6.1.0 sin modificar MainPreset.ts (se usa setupPluginsExtra.ts en su lugar).
- Para migrar a futuras versiones: copiar nuevo repo Superset y ejecutar `./migrate-plugins.sh /ruta/superset_vX_Y_Z`.

Pendiente:
- Ejecutar `npm install` en superset_v6_1_0/superset-frontend para instalar las dependencias nuevas.
- Verificar que los 3 plugins aparecen en el selector de visualizaciones tras el build.

### 2026-05-14

Cambio realizado:
Correccion del bug en filtros de dashboard con la opcion `Select first filter value by default` activa que impedía dejar el filtro vacío.

Archivos afectados:
- `superset_v6/superset-frontend/src/filters/components/Select/SelectFilterPlugin.tsx`
- `superset_v6/superset-frontend/src/dashboard/components/nativeFilters/FilterBar/index.tsx`

Que cambia o corrige:
- En `SelectFilterPlugin.tsx`: el segundo `useEffect` tenía una condición de salida anticipada defectuosa. La condición `isChangedByUser.current && filterState.value && ...` fallaba cuando el usuario borraba el filtro porque `filterState.value = null` (falsy), y el early-return nunca se disparaba. Se simplificó a `if (isChangedByUser.current) return;` para respetar cualquier cambio explícito del usuario, incluyendo borrar el campo.
- En `SelectFilterPlugin.tsx`: la condición principal del mismo `useEffect` usaba `filterState.value !== undefined`, que también pasa para `null`. Se corrigió a `filterState.value != null` para tratar tanto `null` (filtro borrado) como `undefined` (nunca asignado) como estado vacío y no re-seleccionar en esos casos.
- En `FilterBar/index.tsx`: el efecto `setDataMaskSelected(() => dataMaskApplied)` reemplazaba completamente todo el estado de filtros seleccionados cada vez que cambiaba `dataMaskApplied`. Los filtros con `defaultToFirstItem: true` tienen `requiredFirst: true`, lo que provoca un `dispatch` automático a Redux al inicializarse, cambiando `dataMaskApplied` y disparando el efecto que sobreescribía el filtro que el usuario acababa de borrar. Se reemplazó por un merge inteligente que solo actualiza un filtro cuando su valor seleccionado coincide con el valor aplicado previo, preservando los cambios pendientes del usuario.

Verificacion:
- Sin pruebas automatizadas específicas para este bug. Requiere verificacion manual en dashboard con filtro `Select first filter value by default` activo: abrir dashboard, confirmar que el primer valor se selecciona, borrar el filtro con la X, confirmar que queda vacío.

### 2026-05-08

Cambio realizado:
Restauracion de encabezados verticales fijos en Pivot Table Rx1.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/react-pivottable/Styles.js`

Que cambia o corrige:
- Los encabezados superiores vuelven a quedar fijos siempre, como era el comportamiento original.
- La opcion `Sticky headers` queda limitada a fijar horizontalmente la primera columna/cuadrante.

Verificacion:
- `node -e "... @babel/parser ... Styles.js ..."` parse OK.
- `git diff --check`
- `npm test -- --runTestsByPath plugins/plugin-chart-pivot-tableRx1/test/plugin/transformProps.test.ts plugins/plugin-chart-pivot-tableRx1/test/plugin/buildQuery.test.ts plugins/plugin-chart-pivot-tableRx1/test/index.test.ts`

### 2026-05-08

Cambio realizado:
Correccion de desplazamiento del cuadrante de filas en Pivot Table Rx1 con `Sticky headers`.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/react-pivottable/Styles.js`
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/react-pivottable/TableRenderers.jsx`

Que cambia o corrige:
- El encabezado compacto de filas (`division / nombre_tc / nombre_tipo_gasto / responsable_cc`) ahora queda fijo horizontalmente al activar `Sticky headers`.
- Se agrega una clase sticky especifica para ese cuadrante superior izquierdo.

Verificacion:
- `node -e "... @babel/parser ... Styles.js TableRenderers.jsx ..."` parse OK.
- `git diff --check`
- `npm test -- --runTestsByPath plugins/plugin-chart-pivot-tableRx1/test/plugin/transformProps.test.ts plugins/plugin-chart-pivot-tableRx1/test/plugin/buildQuery.test.ts plugins/plugin-chart-pivot-tableRx1/test/index.test.ts`

### 2026-05-08

Cambio realizado:
Botones globales de expandir/colapsar y sticky opcional en Pivot Table Rx1.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/types.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/plugin/controlPanel.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/plugin/transformProps.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/PivotTableChart.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/react-pivottable/TableRenderers.jsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/react-pivottable/Styles.js`
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/test/plugin/transformProps.test.ts`

Que cambia o corrige:
- Se agrega una toolbar minimalista con botones `+` y `-` cuando hay subtotales de filas o columnas.
- Los botones actualizan todos los grupos colapsables visibles de filas y columnas, respetando `Collapse rows by default`.
- Se agrega el control `Sticky headers`, apagado por defecto.
- Al activar `Sticky headers`, se fijan encabezados superiores, primera columna de encabezados de fila y etiqueta de total de columnas.
- Se marcan y fijan explicitamente los nombres de ejes de columnas (`Métrica`, `ano`, `mes_id`, etc.) para que no desaparezcan con scroll horizontal.
- Se agrega prueba para validar el valor por defecto y el encendido de `Sticky headers`.

Verificacion:
- `git diff --check`
- `npm test -- --runTestsByPath plugins/plugin-chart-pivot-tableRx1/test/plugin/transformProps.test.ts plugins/plugin-chart-pivot-tableRx1/test/plugin/buildQuery.test.ts plugins/plugin-chart-pivot-tableRx1/test/index.test.ts`

### 2026-05-08

Cambio realizado:
Tooltip enriquecido para celdas de Pivot Table Rx1.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/types.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/plugin/controlPanel.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/plugin/transformProps.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/PivotTableChart.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/react-pivottable/TableRenderers.jsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/test/plugin/transformProps.test.ts`

Que cambia o corrige:
- Se agrega el control `Show enriched cell tooltip`.
- Las celdas de datos, totales de fila, totales de columna y gran total muestran tooltip con valor formateado, valor raw, contexto de filas/columnas y formula cuando aplica.
- El tooltip se puede desactivar desde el panel de configuracion.
- Se agrega prueba para validar el valor por defecto y el apagado del tooltip.

Verificacion:
- `git diff --check`
- `npm test -- --runTestsByPath plugins/plugin-chart-pivot-tableRx1/test/plugin/transformProps.test.ts plugins/plugin-chart-pivot-tableRx1/test/plugin/buildQuery.test.ts plugins/plugin-chart-pivot-tableRx1/test/index.test.ts`

### 2026-05-07

Cambio realizado:
Resaltado de fila completa al pasar el mouse en Pivot Table Rx1.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/react-pivottable/Styles.js`

Que cambia o corrige:
- Al hacer hover sobre una fila del cuerpo de la tabla, se resaltan todas sus celdas: encabezados de fila, subtotales y valores.
- Se excluye la fila final de totales para conservar su comportamiento visual fijo.

Verificacion:
- `node -e "... @babel/parser ... Styles.js ..."` parse OK.
- `git diff --check`
- `npm test -- --runTestsByPath plugins/plugin-chart-pivot-tableRx1/test/plugin/transformProps.test.ts plugins/plugin-chart-pivot-tableRx1/test/plugin/buildQuery.test.ts plugins/plugin-chart-pivot-tableRx1/test/index.test.ts`

### 2026-05-07

Cambio realizado:
Correccion de alineacion en `Compact row tree` de Pivot Table Rx1.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/react-pivottable/TableRenderers.jsx`

Que cambia o corrige:
- En vista compacta ya no se reserva la columna extra `Métrica` cuando existen columnas (`colAttrs`).
- Evita que los valores se corran una columna y que la ultima quede vacia.
- El header compacto y las filas de datos ahora cubren tambien la columna auxiliar del eje `Métrica`, manteniendo alineadas las metricas visibles.

Verificacion:
- `node -e "... @babel/parser ... TableRenderers.jsx ..."` parse OK.
- `git diff --check`
- `npm test -- --runTestsByPath plugins/plugin-chart-pivot-tableRx1/test/plugin/transformProps.test.ts plugins/plugin-chart-pivot-tableRx1/test/plugin/buildQuery.test.ts plugins/plugin-chart-pivot-tableRx1/test/index.test.ts`

### 2026-04-24

Cambio realizado:
Ajuste de la configuracion de runtime de `superset.service` para que las miniaturas se capturen cuando el dashboard termina de cargar.

Archivos afectados:
- `/home/imercados/.superset/superset_config.py`

Que cambia o corrige:
- Se cambia `SCREENSHOT_PLAYWRIGHT_WAIT_EVENT` de `domcontentloaded` a `networkidle`.
- Con Playwright, esto evita capturas demasiado tempranas que dejaban miniaturas vacias o incompletas en dashboards con carga lenta.
- Se deshabilita `SCREENSHOT_TILED_ENABLED` para evitar que charts extremadamente altos entren en captura por mosaico y agoten el soft time limit de Celery.
- El ajuste se aplica al archivo que realmente usa `superset.service`, no al perfil de Docker.

Verificacion:
- Pendiente de recargar `superset.service` y volver a validar una miniatura.

### 2026-04-17

Cambio realizado:
Correccion final del tipado de `scopeCss.ts` en `plugin-chart-html-cards` para compatibilidad total con `postcss-selector-parser` durante `npm run build-dev`.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/utils/scopeCss.ts`

Que cambia o corrige:
- `cloneScopeNodes` ahora devuelve `Selector['nodes']` en lugar del tipo amplio `Node[]`.
- Esto corrige el error de compilacion donde `Selector.prepend()` rechazaba nodos con tipo potencial `Selector`.
- Se mantiene intacta la logica de scoping CSS; el ajuste es estrictamente de compatibilidad de tipos.

Verificacion:
- `cd superset_v6/superset-frontend && npm run build-dev`
- `cd superset_v6/superset-frontend && npx jest --runInBand plugins/plugin-chart-html-cards/test/plugin/styleControl.test.ts plugins/plugin-chart-html-cards/test/plugin/transformProps.test.ts plugins/plugin-chart-html-cards/test/HtmlCards.test.tsx plugins/plugin-chart-html-cards/test/components/CodeEditor.test.tsx`

### 2026-04-17

Cambio realizado:
Correccion de errores de tipado y fixtures en `plugin-chart-html-cards` para que `npm run build-dev` y las pruebas del plugin vuelvan a compilar sin errores de TypeScript.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/plugin/transformProps.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/types.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/utils/templateContext.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/utils/scopeCss.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/test/HtmlCards.test.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/test/components/CodeEditor.test.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/test/plugin/styleControl.test.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/test/plugin/transformProps.test.ts`

Que cambia o corrige:
- `transformProps` ahora consume `rawFormData` tipado como `HtmlCardsQueryFormData`, evitando el choque con `formData` camelCase generico de `ChartProps`.
- El plugin deja de tipar sus datos como `TimeseriesDataRecord` y pasa a usar `DataRecord`, que corresponde mejor a tarjetas HTML y elimina la obligacion artificial de `__timestamp`.
- `templateContext` ahora construye `displayRows` con `DataRecord` y mantiene los aliases sin exigir estructura de serie temporal.
- `scopeCss` corrige incompatibilidades de tipos con `postcss` y `postcss-selector-parser`.
- Los tests del plugin ahora usan `formData` valido con `datasource`, fixtures de datos acordes al contrato real y casts explicitos para los `ControlSetItem`.
- Se corrige el fixture de metricas del test de `transformProps` para usar una metrica guardada valida por tipo.

Verificacion:
- `cd superset_v6/superset-frontend && npx jest --runInBand plugins/plugin-chart-html-cards/test/plugin/styleControl.test.ts plugins/plugin-chart-html-cards/test/plugin/transformProps.test.ts plugins/plugin-chart-html-cards/test/HtmlCards.test.tsx plugins/plugin-chart-html-cards/test/components/CodeEditor.test.tsx`
- `cd superset_v6/superset-frontend && npm run build-dev`

### 2026-04-17

Cambio realizado:
Correccion del comportamiento de overlays en `plugin-chart-html-cards` para que tooltips y paneles flotantes no queden recortados dentro del chart en dashboards, y mejora de usabilidad en Explore agregando apertura en modal para los editores `Card template` y `Card CSS`.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/HtmlCards.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/components/Handlebars/HandlebarsViewer.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/components/CodeEditor/CodeEditor.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/plugin/controls/handlebarTemplate.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/plugin/controls/style.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/test/HtmlCards.test.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/test/components/CodeEditor.test.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/test/components/HandlebarsViewer.test.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/test/plugin/styleControl.test.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/INSTRUCCIONES_PLUGIN_HTML_CARDS.md`

Que cambia o corrige:
- El wrapper del chart y el contenedor HTML dejan de usar `overflow: hidden`, permitiendo que tooltips y overlays CSS salgan del area visible del chart.
- El root del chart y la tarjeta base del ejemplo inicial elevan `z-index` en hover para reducir conflictos visuales con componentes vecinos del dashboard.
- El CSS inicial del plugin deja de recortar tarjetas y grids por defecto, manteniendo el recorte solo donde si aplica, como la barra de progreso.
- Los editores de `Card template` y `Card CSS` ahora muestran un boton `Open in modal` para editar contenido largo en una ventana amplia dentro de Explore.
- Se documenta en la guia del plugin el uso del modal y las reglas practicas para tooltips y overlays.
- Se agregan regresiones para el modal del editor y se actualizan las pruebas del CSS por defecto.

Verificacion:
- `cd superset_v6/superset-frontend && npx jest --runInBand plugins/plugin-chart-html-cards/test/components/CodeEditor.test.tsx plugins/plugin-chart-html-cards/test/components/HandlebarsViewer.test.ts plugins/plugin-chart-html-cards/test/plugin/styleControl.test.ts plugins/plugin-chart-html-cards/test/HtmlCards.test.tsx`
- `cd superset_v6/superset-frontend && npm run build-dev`

### 2026-04-16

Cambio realizado:
Ampliacion del runtime de helpers de `plugin-chart-html-cards` para soportar `pluck` y extender `sum` con soporte para arrays, manteniendo compatibilidad con la suma de numeros directos en templates Handlebars.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/components/Handlebars/HandlebarsViewer.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/plugin/controls/handlebarTemplate.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/test/components/HandlebarsViewer.test.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/INSTRUCCIONES_PLUGIN_HTML_CARDS.md`

Que cambia o corrige:
- Se agrega el helper `pluck` para extraer una propiedad de todos los elementos de un array y usarla en subexpresiones como `{{sum (pluck rows "ventas")}}`.
- Se sobreescribe `sum` para que soporte tanto `{{sum 10 20}}` como `{{sum (pluck rows "ventas")}}`, sin romper el uso previo con numeros.
- Se actualiza el tooltip de helpers del editor del plugin para mostrar `pluck` y el nuevo comportamiento de `sum`.
- Se amplia la guia del plugin con ejemplos y documentacion especifica de ambos helpers.
- Se agrega una regresion para validar el uso combinado de `pluck` y `sum` dentro del renderer.

Verificacion:
- `npx jest --runInBand plugins/plugin-chart-html-cards/test/components/HandlebarsViewer.test.ts`
- `npm run build-dev`

### 2026-04-16

Cambio realizado:
Ampliacion de la guia `INSTRUCCIONES_PLUGIN_HTML_CARDS.md` para documentar los nombres exactos de helpers disponibles en runtime, incluyendo helpers nativos de Handlebars, helpers utiles de `just-handlebars-helpers` y una seccion de errores comunes con `Missing helper`.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/INSTRUCCIONES_PLUGIN_HTML_CARDS.md`

Que cambia o corrige:
- Se documentan los helpers nativos de Handlebars que tambien pueden usarse en los templates (`#if`, `#each`, `#with`, `lookup`, etc.).
- Se listan por nombre exacto los helpers adicionales mas utiles de `just-handlebars-helpers`, separados por categorias: logica, strings, arrays y matematicos.
- Se aclara explicitamente que helpers como `divide`, `multiply`, `add` y `subtract` no existen con esos nombres en el plugin, y se documentan sus equivalentes reales (`division`, `multiplication`, `sum`, `difference`).
- Se agrega una seccion de errores comunes para que el usuario pueda diagnosticar rapidamente mensajes como `Missing helper: "divide"`.

### 2026-04-16

Cambio realizado:
Correccion del renderer de `plugin-chart-html-cards` para evitar errores `TypeError: Right-hand side of 'instanceof' is not callable` al capturar errores de templates o helpers de Handlebars.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/components/Handlebars/HandlebarsViewer.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/test/components/HandlebarsViewer.test.ts`

Que cambia o corrige:
- Se renombra el componente styled `Error` a `ErrorContainer` para no pisar el constructor global `Error`.
- Las validaciones y throws del renderer ahora usan `globalThis.Error`, evitando colisiones con nombres locales.
- Esto corrige el caso donde un helper o template fallaba y el chart mostraba `Data error` con el mensaje `Right-hand side of 'instanceof' is not callable`.
- Se agrega una regresion para validar que los errores de helpers se rendericen como texto en el chart en lugar de romper el renderer.

Verificacion:
- `npx jest --runInBand plugins/plugin-chart-html-cards/test/components/HandlebarsViewer.test.ts`
- `npm run build-dev`

### 2026-04-16

Cambio realizado:
Mejora funcional de `plugin-chart-html-cards` para encapsular automaticamente el CSS por instancia del chart, exponer formateadores nativos de Superset como helpers de Handlebars e inyectar variables CSS del theme actual en el contenedor de las tarjetas.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/INSTRUCCIONES_PLUGIN_HTML_CARDS.md`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/package.json`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/HtmlCards.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/types.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/components/Handlebars/HandlebarsViewer.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/plugin/controls/handlebarTemplate.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/utils/scopeCss.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/test/HtmlCards.test.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/test/components/HandlebarsViewer.test.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/test/utils/scopeCss.test.ts`
- `superset_v6/superset-frontend/package-lock.json`

Que cambia o corrige:
- El `Card CSS` del plugin ya no se inyecta crudo: ahora se scopea automaticamente al chart actual usando un selector unico por instancia, evitando fugas de estilos hacia otros charts o pantallas de Superset.
- El scoping se hace con `postcss` y respeta reglas anidadas como `@container`, `@media` y `@keyframes`.
- Se agregan los helpers `numberFormatD3` y `timeFormatD3` para que los templates usen los formateadores nativos de Superset en numeros y fechas.
- El chart ahora expone `scopeId`, `scopeSelector` y `themeVars` en el contexto del template.
- El contenedor del chart inyecta variables CSS derivadas del theme actual de Superset (`--html-cards-theme-*`) para que las tarjetas puedan verse nativas sin hardcodear colores o tipografias.
- Se amplia la guia `INSTRUCCIONES_PLUGIN_HTML_CARDS.md` con helpers, variables de theme, scoping CSS, ejemplos KPI y patrones de uso recomendados.
- Se agregan regresiones para el scoping de CSS, los nuevos formatters y la presencia de variables CSS de theme en el wrapper del chart.

Verificacion:
- `npm install`
- `npx jest --runInBand plugins/plugin-chart-html-cards/test/HtmlCards.test.tsx plugins/plugin-chart-html-cards/test/components/HandlebarsViewer.test.ts plugins/plugin-chart-html-cards/test/plugin/controlPanel.test.ts plugins/plugin-chart-html-cards/test/plugin/styleControl.test.ts plugins/plugin-chart-html-cards/test/plugin/transformProps.test.ts plugins/plugin-chart-html-cards/test/plugin/buildQuery.test.ts plugins/plugin-chart-html-cards/test/index.test.ts plugins/plugin-chart-html-cards/test/utils/scopeCss.test.ts`
- `npm run build-dev`

### 2026-04-16

Cambio realizado:
Se agrega documentacion funcional para `plugin-chart-html-cards` con una guia practica de campos, formatos, helpers de Handlebars, estructura de contexto de template y ejemplos listos para crear tarjetas HTML/CSS.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/INSTRUCCIONES_PLUGIN_HTML_CARDS.md`

Que cambia o corrige:
- Se documentan los controles de `Query` y `Cards` disponibles en el chart `html_cards`.
- Se detalla el contexto completo que recibe Handlebars (`rows`, `data`, `rowCount`, `columns`, `displayRows`, `layout`, etc.).
- Se explica la estructura de `columns` (`key`, `displayName`, `templateKey`, tipos y flags de metricas).
- Se listan los helpers disponibles (`dateFormat`, `stringify`, `formatNumber`, `coalesce`, `hasValue`, `parseJson`) y su uso.
- Se agregan recomendaciones de diseno de templates con `displayRows` + `templateKey`, manejo de fallbacks y consideraciones de sanitizacion HTML.
- Se incluye un mini ejemplo completo (template + CSS) como punto de partida para nuevas tarjetas.

### 2026-04-16

Cambio realizado:
Creacion del nuevo plugin `HTML Cards` para Superset v6, orientado a tarjetas HTML/CSS con interaccion por hover. Antes de empezar se creo el tag `prod-6-pre-html-cards-2026-04-16` en GitHub sobre el repo `alx25/superset-v6-irex` para congelar la base previa a los cambios.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/package.json`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/README.md`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/index.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/HtmlCards.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/types.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/components/CodeEditor/CodeEditor.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/components/Handlebars/HandlebarsViewer.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/plugin/index.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/plugin/controlPanel.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/plugin/controls/handlebarTemplate.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/plugin/controls/style.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/utils/normalizeRenderedTemplate.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/utils/templateContext.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/test/HtmlCards.test.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/test/index.test.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/test/components/HandlebarsViewer.test.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/test/plugin/buildQuery.test.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/test/plugin/controlPanel.test.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/test/plugin/styleControl.test.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/test/plugin/transformProps.test.ts`
- `superset_v6/superset-frontend/package.json`
- `superset_v6/superset-frontend/package-lock.json`
- `superset_v6/superset-frontend/packages/superset-ui-core/src/chart/types/VizType.ts`
- `superset_v6/superset-frontend/src/visualizations/presets/MainPreset.js`

Que cambia o corrige:
- Se agrega el nuevo chart `html_cards` y se registra en `VizType` y `MainPreset`.
- Se integra el paquete local `@superset-ui/plugin-chart-html-cards` al workspace del frontend.
- El chart nuevo reutiliza la base del plugin Handlebars, pero expone un contexto pensado para tarjetas: `rows`, `data`, `rowCount`, `width`, `height` y `firstRow`.
- Se incluye un template por defecto con grid responsive, tarjeta frontal y capa de detalles visible en hover.
- Se incluye CSS por defecto para hover, cambio visual y detalle expandido, cubriendo el caso de uso de tooltip/interactividad ligera sin JS arbitrario.
- Se corrige la lectura del control de CSS para usar `style_template` en lugar de reciclar el valor del template HTML.
- Se corrige el renderer de `html_cards` para normalizar la indentacion del HTML generado antes de pasarlo por `SafeMarkdown`, evitando que un template indentado se renderice como bloque de codigo en lugar de HTML.
- Se corrige nuevamente el renderer de `html_cards` para dejar de usar `SafeMarkdown` y renderizar el resultado como HTML real con `dangerouslySetInnerHTML`, aplicando saneamiento solo cuando `HTML_SANITIZATION` esta activo. Esto corrige el caso en que el plugin seguia mostrando el codigo fuente HTML en pantalla.
- Se corrige la aplicacion del CSS del plugin para que exista un `default` real en `styleTemplate`, y el renderer acepte tanto `camelCase` como `snake_case` (`styleTemplate` / `style_template`, `handlebarsTemplate` / `handlebars_template`) al componer la tarjeta.
- Se desactiva el worker de Ace en el editor local del plugin `html_cards`, corrigiendo el error en la pestana `Personalizar` que intentaba cargar `worker-css.js` y rompia el panel de CSS.
- Se agrega soporte de `Display name` en `html_cards` mediante `column_config`, reutilizando `ColumnConfigControl` con una configuracion simplificada para alias visibles de columnas y metricas.
- Se agrega un contexto de template mas estable y amigable para Handlebars: `columns`, `displayRows`, `firstDisplayRow` y `layout`. Esto permite referenciar metricas por alias estables aunque el backend devuelva nombres como `titulo_9fef7d`.
- Se mejora el default template para usar `columns.displayName` y `templateKey` en lugar de depender de las claves crudas de la respuesta SQL.
- Se reemplaza el ejemplo inicial por defecto del plugin para usar como base una tarjeta compacta tipo `kpi-mini`, inspirada en el tile KPI validado por el usuario. El template inicial ahora prioriza campos como `titulo`, `subtitulo`, `estado`, `valor_actual`, `meta`, `variacion_pct` y `avance_pct`, pero mantiene fallbacks genericos usando `columns` y `displayRows`.
- Se mejora el comportamiento responsive del plugin usando `container-type` y `@container` queries, para que el layout se adapte al ancho real del chart dentro del dashboard en vez del viewport completo.
- Se ajusta el wrapper del chart para trabajar como contenedor de tamano fijo del dashboard (`container-type: size`, `overflow: hidden`, `height: 100%` en el render HTML) y se compacta el CSS por defecto segun ancho y alto del recuadro. Esto evita barras de scroll por defecto y hace que las tarjetas llenen mejor el espacio disponible del dashboard.
- Se actualiza el workspace con `npm install` para generar el symlink del paquete, instalar las dependencias locales del plugin nuevo y sincronizar `package-lock.json`.
- Verificado con `npx jest --runInBand plugins/plugin-chart-html-cards/test/index.test.ts plugins/plugin-chart-html-cards/test/plugin/buildQuery.test.ts plugins/plugin-chart-html-cards/test/plugin/transformProps.test.ts`.
- Verificado adicionalmente con `npx jest --runInBand plugins/plugin-chart-html-cards/test/components/HandlebarsViewer.test.ts plugins/plugin-chart-html-cards/test/plugin/transformProps.test.ts plugins/plugin-chart-html-cards/test/plugin/buildQuery.test.ts plugins/plugin-chart-html-cards/test/index.test.ts`.
- Verificado adicionalmente con `npx jest --runInBand plugins/plugin-chart-html-cards/test/HtmlCards.test.tsx plugins/plugin-chart-html-cards/test/components/HandlebarsViewer.test.ts plugins/plugin-chart-html-cards/test/plugin/styleControl.test.ts plugins/plugin-chart-html-cards/test/plugin/transformProps.test.ts plugins/plugin-chart-html-cards/test/plugin/buildQuery.test.ts plugins/plugin-chart-html-cards/test/index.test.ts`.
- Verificado adicionalmente con `npx jest --runInBand plugins/plugin-chart-html-cards/test/HtmlCards.test.tsx plugins/plugin-chart-html-cards/test/components/HandlebarsViewer.test.ts plugins/plugin-chart-html-cards/test/plugin/controlPanel.test.ts plugins/plugin-chart-html-cards/test/plugin/styleControl.test.ts plugins/plugin-chart-html-cards/test/plugin/transformProps.test.ts plugins/plugin-chart-html-cards/test/plugin/buildQuery.test.ts plugins/plugin-chart-html-cards/test/index.test.ts`.
- Verificado con `npm run build-dev` en `superset_v6/superset-frontend`.

### 2026-04-16

Cambio realizado:
Correccion del ejemplo inicial de `HTML Cards` para que tambien renderice datasets genericos, incluyendo consultas con campos distintos a los KPI esperados, menos columnas de las previstas o valores numericos en `0`.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/components/Handlebars/HandlebarsViewer.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/src/plugin/controls/handlebarTemplate.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-html-cards/test/HtmlCards.test.tsx`

Que cambia o corrige:
- Se agregan los helpers de Handlebars `coalesce` y `hasValue` para que el template por defecto pueda resolver campos opcionales y tratar `0` como valor valido en lugar de ocultarlo.
- El ejemplo inicial del plugin deja de depender rigidamente de los campos `titulo`, `valor_actual`, `meta` y `variacion_pct`, y ahora usa fallbacks genericos basados en `columns` y `displayRows`.
- Se corrige el caso donde un dataset nuevo no mostraba nada porque el template esperaba tres columnas especificas o evaluaba `0` como falso.
- Se agrega una regresion que valida el render del starter template con datasets sin campos KPI dedicados.

Verificacion:
- `npx jest --runInBand plugins/plugin-chart-html-cards/test/HtmlCards.test.tsx plugins/plugin-chart-html-cards/test/components/HandlebarsViewer.test.ts plugins/plugin-chart-html-cards/test/plugin/controlPanel.test.ts plugins/plugin-chart-html-cards/test/plugin/styleControl.test.ts plugins/plugin-chart-html-cards/test/plugin/transformProps.test.ts plugins/plugin-chart-html-cards/test/plugin/buildQuery.test.ts plugins/plugin-chart-html-cards/test/index.test.ts`
- `npm run build-dev`

### 2026-03-26B

Cambio realizado:
Integracion de 3 fixes importantes de UI para dashboards y tabla:

1. PR #36528 - fix(tab): Fix tabs in column not clickable
2. PR #37210 - fix: add droppable area to tab empty state
3. PR #36891 - fix(plugin-chart-table): remove column misalignment when no scrollbars are present

Archivos afectados:
- superset_v6/superset-frontend/src/dashboard/components/DashboardBuilder/DashboardBuilder.tsx
- superset_v6/superset-frontend/src/dashboard/components/gridComponents/Tab/Tab.jsx
- superset_v6/superset-frontend/src/dashboard/components/gridComponents/Tab/Tab.test.tsx
- superset_v6/superset-frontend/plugins/plugin-chart-table/src/DataTable/hooks/useSticky.tsx

Que cambia o corrige:
- Corrige el problema de tabs dentro de columnas que no respondian al click en modo dashboard.
- Mejora la experiencia en tabs vacios agregando area droppable para facilitar drag and drop.
- Corrige desalineacion de columnas en Table chart cuando no hay scrollbars.
- Los 3 cherry-picks entraron limpios sin conflictos en prod-6-irex-snapshot.

### 2026-03-26

Cambio realizado:
Integracion masiva de 9 fixes criticos desde rama origin/6.0 (6.0.1):

1. PR #37553 - CVE-2025-68428 (jspdf security vulnerability)
2. PR #36550 - Security: enforce datasource access control
3. PR #37284 - ECharts tooltip restoration after drill menu
4. PR #37017 - Native filters: Boolean FALSE value handling
5. PR #36422 - SQLLab: Jinja SQL error icon fix
6. PR #36819 - TableChart: cell bars rendering with NULL values
7. PR #37452 - Dashboard: virtual rendering performance
8. PR #37407 - Chart: cross-filter on bar charts without dimensions
9. PR #36686 - Dashboard: prevent table chart infinite reload loop

Archivos afectados:
Multiple (frontend packages, configs, backends):
- superset-frontend/package.json, package-lock.json (jspdf 4.0.0 update)
- superset/views/datasource/utils.py (access control)
- superset-frontend/src/components/Chart/ChartContextMenu/*.tsx (ECharts)
- superset-frontend/src/filters/components/Select/SelectFilterPlugin.tsx (Boolean)
- superset/commands/databases/validate_sql.py (Jinja validation)
- superset-frontend/plugins/plugin-chart-table/* (cell bars with NULL)
- superset/views/base.py, config.py, charts logic (dashboard virtual rendering)
- superset-frontend/plugins/plugin-chart-echarts/* (cross-filter bars)
- superset-frontend/src/dashboard/components/Dashboard.tsx (infinite reload)

Que cambia o corrige:
- Todos los cherry-picks fueron limpios sin conflictos de merge
- Se integran 9 arreglos criticos de 6.0.1 a la rama prod-6-irex-snapshot
- Mejoras de seguridad, performance y correccion de bugs en componentes Frontend clave
- No incluye PR #37018 (Tabs infinite rerenders) porque el usuario ya tiene un fix personalizado aplicado
- Estado anterior: prod-6-irex-snapshot tenia solo 1 commit (PR #36858) adelante del remote
- Estado actual: prod-6-irex-snapshot tiene 10 commits adelante del remote (todos cherry-picked limpios)


### 2026-03-26A

Cambio realizado:
Integracion del fix de SQL Lab para evitar errores 404 al colapsar/expandir preview del esquema de tabla cuando la metadata no esta inicializada.

Archivos afectados:

Que cambia o corrige:

### 2026-03-25

Cambio realizado:
Correccion del cierre inesperado de modales/popovers al seleccionar sugerencias del autocomplete con el mouse en editores SQL embebidos.

Archivos afectados:
- `superset_v6/superset-frontend/packages/superset-ui-core/src/components/AsyncAceEditor/index.tsx`
- `superset_v6/superset-frontend/packages/superset-ui-core/src/components/AsyncAceEditor/AsyncAceEditor.test.tsx`

Que cambia o corrige:
- Se ajusto `AsyncAceEditor` para usar siempre una referencia interna del editor, incluso cuando el componente consumidor no pasa `ref`.
- Se aseguro que el popup `.ace_autocomplete` se reubique dentro del contenedor correcto del editor.
- Esto evita que el click sobre una sugerencia del autocomplete sea interpretado como click externo, lo que antes cerraba el modal o popover y hacia perder lo escrito.
- Se agrego una prueba de regresion para validar el caso en que `SQLEditor` se usa sin `forwarded ref`.

### 2026-03-25

Cambio realizado:
Levantamiento de dependencias e integraciones del plugin personalizado `plugin-chart-tableV3` para facilitar una futura migracion a una version mayor de Superset. Se reviso el codigo actual y tambien los commits relacionados.

Archivos afectados:
Frontend fuera de `plugin-chart-tableV3`:
- `superset_v6/superset-frontend/packages/superset-ui-core/src/chart/types/VizType.ts`
- `superset_v6/superset-frontend/src/visualizations/presets/MainPreset.js`
- `superset_v6/superset-frontend/package.json`
- `superset_v6/superset-frontend/package-lock.json`
- `superset_v6/superset-frontend/packages/superset-ui-core/src/components/AsyncAceEditor/index.tsx`
- `superset_v6/superset-frontend/packages/superset-ui-core/types/ace-builds.d.ts`
- `superset_v6/superset-frontend/src/explore/components/controls/FormulaMetricControl/index.tsx`
- `superset_v6/superset-frontend/src/explore/reducers/exploreReducer.js`
- `superset_v6/superset-frontend/src/explore/components/controls/ColumnConfigControl/constants.tsx`
- `superset_v6/superset-frontend/webpack.config.js`

Backend fuera de `plugin-chart-tableV3`:
- `superset_v6/superset/charts/schemas.py`
- `superset_v6/superset/common/query_context_processor.py`
- `superset_v6/tests/unit_tests/common/test_query_context_processor.py`

Que cambia o corrige:
- `VizType.ts`, `MainPreset.js` y `package.json` son la integracion base del chart en Superset. Definen `table_v3`, registran `TableV3ChartPlugin` y enlazan el paquete local `@superset-ui/plugin-chart-table-v3`. Estos puntos aparecen en el snapshot base `2d1587525b`.
- `package-lock.json` refleja esa integracion de workspace. No es la fuente principal de logica, pero al migrar se debe regenerar y validar que el plugin siga resolviendo como paquete local.
- `AsyncAceEditor/index.tsx` y `types/ace-builds.d.ts` fueron tocados en el commit `6f4fc3b1a4` para soportar el editor de formulas de `Calculated columns`, cargando workers de Ace y sus tipados.
- `FormulaMetricControl/index.tsx` fue tocado en `633c36fb1d` para soportar labels con placeholders tipo Jinja en `Calculated columns`.
- `exploreReducer.js` fue tocado en `633c36fb1d` y en cambios posteriores del branch para mantener sincronizados `calculated_columns`, `column_config` y `column_order` cuando cambia el label o el orden de columnas calculadas.
- `ColumnConfigControl/constants.tsx` fue tocado en `fb08742019` para agregar ayuda y prompt especifico del plugin en `Customize columns -> HTML`. Es una personalizacion de UI auxiliar, no un punto central del render del chart, pero si conviene portarla si quieres conservar esa ayuda.
- `webpack.config.js` fue tocado en `633c36fb1d` y es un archivo a revisar en la migracion porque el plugin depende de compatibilidad de build con Ace y con el frontend personalizado.
- `schemas.py`, `query_context_processor.py` y `test_query_context_processor.py` fueron tocados en `fdc79732ba` para soportar exportaciones CSV/XLSX con `calculated_columns_export` y `column_export_order`. Aqui se calculan columnas exportadas, se aplican display names con Jinja, se excluyen columnas auxiliares y se respeta el orden final de exportacion.
- No se encontraron referencias backend directas a `table_v3` fuera de ese flujo de exportacion. La mayor parte de la logica funcional del chart vive dentro del frontend y del propio plugin.
- Los commits `352ab07019` y `11fdef916f` agregan comportamiento al chart, pero solo tocan archivos dentro de `plugin-chart-tableV3`, no fuera de esa carpeta.

Commits revisados:
- `2d1587525b` Initial Superset v6 project snapshot
- `6f4fc3b1a4` feat: add row grouping and calculated columns support to TableChart
- `352ab07019` feat: add support for dynamic row grouping changes in TableChart with new controls and calculated columns
- `11fdef916f` feat: enhance TableChart with improved top metric handling and row grouping options
- `fdc79732ba` feat: add support for exporting calculated columns and column order in TableChart
- `633c36fb1d` feat: enhance TableChart with Jinja template support for calculated columns and improved footer display
- `fb08742019` feat: add HTML template and CSS support in ColumnConfig with examples and help panel

### 2026-03-25

Cambio realizado:
Correccion del problema en `Column order` de `plugin-chart-tableV3` donde aparecian entradas duplicadas de `Calculated columns (Jinja-like)` y no se podian reordenar correctamente.

Archivos afectados:
- `superset_v6/superset-frontend/src/explore/components/controls/MetricOrderControl/index.tsx`
- `superset_v6/superset-frontend/src/explore/components/controls/MetricOrderControl/MetricOrderControl.test.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-tableV3/src/controlPanel.tsx`
- `superset_v6/superset-frontend/src/explore/reducers/exploreReducer.js`
- `superset_v6/superset-frontend/src/explore/reducers/exploreReducer.test.js`

Que cambia o corrige:
- `MetricOrderControl` ahora deduplica valores repetidos en `column_order` y sanea automaticamente estados viejos o contaminados antes de renderizar el control.
- El `labelMap` del control conserva la primera etiqueta valida por columna, evitando inconsistencias visuales cuando llegan opciones repetidas.
- `plugin-chart-tableV3/src/controlPanel.tsx` ahora normaliza `calculated_columns` con la misma logica que usa el chart antes de construir las opciones de `Column order`, para no listar formulas incompletas o repetidas.
- `exploreReducer.js` ahora deduplica `column_order` despues de renombrar `Calculated columns`, evitando que queden entradas duplicadas si el estado previo ya tenia repeticiones.
- Se agregaron regresiones para validar el saneamiento de duplicados tanto en el control visual como en el reducer.

Verificacion:
- `npx jest --runInBand src/explore/components/controls/MetricOrderControl/MetricOrderControl.test.tsx`
- `npx jest --runInBand src/explore/reducers/exploreReducer.test.js`
- `npm run build-dev`

### 2026-03-25

Cambio realizado:
Correccion para que `Column order` de `plugin-chart-tableV3` no muestre los campos definidos en `Jinja Fields`.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-tableV3/src/controlPanel.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-tableV3/test/controlPanel.test.ts`

Que cambia o corrige:
- `Column order` ahora excluye los `Jinja Fields` de la lista de columnas ordenables, aunque sigan estando disponibles internamente para resolver labels con Jinja.
- El filtrado se hace antes de expandir columnas por `time_compare`, asi que tampoco aparecen variantes `Main`, `#`, `△` o `%` de un `Jinja Field` numerico.
- Se agrego una regresion para validar que un `Jinja Field` presente en `queryResponse.colnames` no se renderice como opcion en `Column order`.

Verificacion:
- `npx jest --runInBand plugins/plugin-chart-tableV3/test/controlPanel.test.ts`
- `npm run build-dev`

### 2026-03-25

Cambio realizado:
Ajuste visual adicional de los subtotales en `plugin-chart-tableV3` para devolver el recuadro a la etiqueta `Subtotal` y resaltar los valores con negrita y borde inferior del color del tema.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-tableV3/src/Styles.tsx`

Que cambia o corrige:
- La palabra `Subtotal` vuelve a mostrarse como badge con recuadro dentro del encabezado del grupo.
- Los importes de subtotal siguen sin caja completa, pero ahora quedan en negrita y con un borde inferior del color del tema para destacarlos.
- El ajuste mantiene intacta la logica de agrupacion y solo modifica la presentacion visual.

Verificacion:
- `npm run build-dev`

### 2026-03-25

Cambio realizado:
Correccion adicional del subtotal agrupado en `plugin-chart-tableV3` para evitar que el nombre del grupo y los montos se monten visualmente entre si.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-tableV3/src/Styles.tsx`

Que cambia o corrige:
- El contenedor del nombre del subtotal ahora recorta correctamente el texto largo con `ellipsis` dentro de la celda del grupo.
- Las celdas de montos de subtotal ahora recortan su contenido horizontalmente para que no invada la columna del nombre.
- El wrapper HTML de subtotal tambien queda limitado al ancho de su celda, evitando que badges o spans internos se desborden sobre columnas vecinas.

Verificacion:
- `npm run build-dev`

### 2026-03-25

Cambio realizado:
Refuerzo de negrita en subtotales y resumen HTML de `plugin-chart-tableV3` mediante inyeccion inline sobre el markup renderizado, para que el enfasis no dependa solo del CSS.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-tableV3/src/TableChart.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-tableV3/test/TableChart.test.tsx`

Que cambia o corrige:
- Los subtotales y el resumen que vienen como HTML ahora reciben `font-weight: 700 !important` directamente dentro del markup renderizado.
- Si la plantilla HTML trae estilos propios, el subtotal/resumen sigue forzando la negrita sobre los elementos renderizados.
- Se agrego una regresion para cubrir el caso de subtotales agrupados con HTML y `font-weight` previo menor.

Verificacion:
- `npm run build-dev`
- `npx jest --runInBand plugins/plugin-chart-tableV3/test/TableChart.test.tsx -t "forces bold font weight inside HTML subtotal values"` bloqueado por un problema preexistente del workspace: `Cannot find module 'cheerio/lib/utils'` desde `enzyme`

### 2026-03-25

Cambio realizado:
Ajuste visual final de subtotales en `plugin-chart-tableV3` para resaltarlos mas sin usar recuadro ni negrita.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-tableV3/src/Styles.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-tableV3/src/TableChart.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-tableV3/test/TableChart.test.tsx`

Que cambia o corrige:
- Se retiro el intento de forzar `font-weight` inline dentro del HTML de subtotal/resumen.
- Los subtotales ahora destacan por una linea inferior mas fuerte con el color principal del tema, un tamano de fuente apenas mayor y un leve espaciado entre caracteres.
- El ajuste mantiene intactos los colores semanticos rojo/verde y evita usar caja completa o negrita.
- La regresion de `TableChart` se actualizo para validar que los subtotales HTML sigan renderizando dentro del wrapper correcto.

Verificacion:
- `npm run build-dev`
- `npx jest --runInBand plugins/plugin-chart-tableV3/test/TableChart.test.tsx -t "renders HTML subtotal values inside the summary wrapper"` bloqueado por un problema preexistente del workspace: `Cannot find module 'cheerio/lib/utils'` desde `enzyme`

### 2026-03-25

Cambio realizado:
Correccion visual para que la fila de subtotal agrupado no quede transparente cuando se activan columnas fijas en `plugin-chart-tableV3`.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-tableV3/src/TableChart.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-tableV3/src/Styles.tsx`

Que cambia o corrige:
- Las celdas sticky de la fila de subtotal agrupado ahora reciben un fondo solido igual al de la propia fila agrupada.
- Se evita que el contenido de otras columnas se traslape visualmente por detras al desplazar horizontalmente con `sticky columns`.
- El ajuste se aplica tanto en el estilo inline de la celda sticky como en una regla CSS especifica para las filas `dt-group-header-row`.

Verificacion:
- `npm run build-dev`

### 2026-03-25

Cambio realizado:
Ajuste visual para que los subtotales y resumen con formato HTML en `plugin-chart-tableV3` respeten la negrita aunque el contenido se renderice con `dangerouslySetInnerHTML`.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-tableV3/src/Styles.tsx`

Que cambia o corrige:
- El wrapper `.dt-group-row-summary-html` ahora fuerza `font-weight` fuerte para los valores de subtotal/resumen renderizados como HTML.
- Los nodos hijos del HTML tambien heredan la negrita, evitando que spans internos con color rojo/verde pierdan el enfasis visual.
- Se conserva el color y el resto del formato HTML; solo se refuerza el peso tipografico.

Verificacion:
- `npm run build-dev`

### 2026-03-25

Cambio realizado:
Ajuste visual de los subtotales en `plugin-chart-tableV3` para que ya no se muestren dentro de recuadros y los valores queden resaltados en negrita.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-tableV3/src/Styles.tsx`

Que cambia o corrige:
- Los valores numericos de subtotal en filas agrupadas ya no renderizan con borde, fondo ni efecto de caja.
- La etiqueta `Subtotal` del encabezado de grupo tambien deja de mostrarse como badge con recuadro y pasa a verse como texto simple.
- Se mantiene el enfasis visual de los importes de subtotal usando negrita.

Verificacion:
- `npm run build-dev`

### 2026-03-25

Cambio realizado:
Correccion adicional para que `Column order` de `plugin-chart-tableV3` no siga mostrando columnas fantasma del dataset cuando el `column_order` guardado ya venia contaminado con valores viejos.

Archivos afectados:
- `superset_v6/superset-frontend/src/explore/components/controls/MetricOrderControl/index.tsx`
- `superset_v6/superset-frontend/src/explore/components/controls/MetricOrderControl/MetricOrderControl.test.tsx`

Que cambia o corrige:
- `MetricOrderControl` ahora cruza el valor actual de `column_order` contra las opciones validas generadas por el plugin y elimina cualquier campo guardado que ya no exista en la tabla.
- Esto corrige el caso donde `Column order` seguia mostrando todas las columnas del dataset aunque `controlPanel.tsx` ya solo estuviera entregando los campos visibles.
- El control mantiene el orden real de columnas validas y solo agrega las faltantes que sigan siendo parte de la tabla actual.
- Se agrego una regresion para cubrir especificamente la limpieza de columnas fantasma persistidas en configuraciones viejas.

Verificacion:
- `npx jest --runInBand src/explore/components/controls/MetricOrderControl/MetricOrderControl.test.tsx`
- `npx jest --runInBand plugins/plugin-chart-tableV3/test/controlPanel.test.ts`
- `npm run build-dev`

### 2026-05-07

Cambio realizado:
Nuevas opciones tipo Matrix de Power BI para filas en `plugin-chart-pivot-tableRx1`.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/plugin/controlPanel.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/plugin/transformProps.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/PivotTableChart.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/react-pivottable/TableRenderers.jsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/types.ts`
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/test/plugin/transformProps.test.ts`

Que cambia o corrige:
- Se agregan controles `Collapse rows by default` y `Compact row tree`, visibles cuando `Show rows subtotal` esta activo.
- `Collapse rows by default` inicia los grupos de filas colapsados, manteniendo la capacidad de expandir con las flechas.
- `Compact row tree` muestra los campos de fila en una sola columna con indentacion tipo arbol.
- Se ajusta el test de `transformProps` para cubrir las nuevas opciones y aceptar los campos actuales extra de Rx1.

Verificacion:
- `node -e "... @babel/parser ... TableRenderers.jsx ..."` parse OK.
- `git diff --check`
- `npm test -- --runTestsByPath plugins/plugin-chart-pivot-tableRx1/test/plugin/transformProps.test.ts plugins/plugin-chart-pivot-tableRx1/test/plugin/buildQuery.test.ts plugins/plugin-chart-pivot-tableRx1/test/index.test.ts`

### 2026-05-07

Cambio realizado:
Correccion del ordenamiento interactivo de Pivot Table Rx1 para columnas de `Formula metrics (Jinja-like)`.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/react-pivottable/TableRenderers.jsx`

Que cambia o corrige:
- El sorting de columnas ahora usa el valor evaluado por `getFormulaValue` cuando la columna/fila corresponde a una formula metric.
- Antes el sorting tomaba el valor agregado base de `pivotData`, que para filas de formula era `0`, por eso no cambiaba el orden.

Verificacion:
- `node -e "... @babel/parser ... TableRenderers.jsx ..."` parse OK.
- `git diff --check`
- `npm test -- --runTestsByPath packages/superset-ui-core/test/time-format/TimeFormatter.test.ts`

### 2026-05-07

Cambio realizado:
Port parcial de mejoras recientes de Pivot Table a `plugin-chart-pivot-tableRx1`.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/react-pivottable/TableRenderers.jsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/package.json`
- `superset_v6/superset-frontend/package-lock.json`
- `superset_v6/superset-frontend/packages/superset-ui-core/src/time-format/TimeFormatter.ts`
- `superset_v6/superset-frontend/packages/superset-ui-core/src/time-format/utils/stringifyTimeInput.ts`
- `superset_v6/superset-frontend/packages/superset-ui-core/test/time-format/TimeFormatter.test.ts`

Que cambia o corrige:
- Se agrega ordenamiento interactivo en columnas de Pivot Table Rx1 basado en el PR upstream #36050.
- Se agrega soporte de formato condicional sobre headers de filas/columnas cuando las reglas aplican a valores string, compatible con la estructura custom de Rx1.
- Se corrige el formateo de fechas cuando Pivot Table recibe timestamps como string numerico, evitando encabezados `NaN`.
- Se agrega `@react-icons/all-files` como peer dependency del plugin Rx1 para los iconos de ordenamiento.
- Se agregan pruebas de `TimeFormatter` para string numerico e ISO date string.

Verificacion:
- `node -e "... @babel/parser ... TableRenderers.jsx ..."` parse OK.
- `git diff --check`
- `npm test -- --runTestsByPath packages/superset-ui-core/test/time-format/TimeFormatter.test.ts`
- `npm test -- --runTestsByPath plugins/plugin-chart-pivot-tableRx1/test/plugin/transformProps.test.ts plugins/plugin-chart-pivot-tableRx1/test/plugin/buildQuery.test.ts plugins/plugin-chart-pivot-tableRx1/test/index.test.ts` falla solo en `transformProps.test.ts` por expectativa desactualizada que no contempla campos ya devueltos por Rx1.

### 2026-03-25

Cambio realizado:
Correccion para que el orden definido en `Column order` de `plugin-chart-tableV3` no se pierda al guardar el chart, tanto para columnas normales como calculadas.

Archivos afectados:
- `superset_v6/superset-frontend/src/explore/components/controls/MetricOrderControl/index.tsx`
- `superset_v6/superset-frontend/src/explore/components/controls/MetricOrderControl/MetricOrderControl.test.tsx`
- `superset_v6/superset-frontend/src/explore/actions/saveModalActions.test.ts`

Que cambia o corrige:
- `MetricOrderControl` ya no descarta valores actuales de `column_order` cuando `options` llega temporalmente incompleto durante rerenders del panel.
- Esto evita que el control “autolimpie” el orden guardado y termine perdiendo métricas, columnas normales o `Calculated columns` antes de persistir el chart.
- El mapa de labels sigue usando el label visible de `options` cuando existe y solo usa el valor crudo como fallback cuando todavia no hay metadata suficiente.
- Se agrego una regresion del control para cubrir el caso donde el valor actual contiene columnas que todavia no aparecen en `options`.
- Se agrego una prueba del save flow para validar que `column_order` quede incluido en `params` al guardar.

Verificacion:
- `npx jest --runInBand src/explore/components/controls/MetricOrderControl/MetricOrderControl.test.tsx`
- `npx jest --runInBand src/explore/actions/saveModalActions.test.ts -t "column_order"`
- `npm run build-dev`

### 2026-03-25

Cambio realizado:
Correccion para que `Column order` de `plugin-chart-tableV3` solo muestre campos que realmente pueden verse en la tabla.

Archivos afectados:
- `superset_v6/superset-frontend/plugins/plugin-chart-tableV3/src/controlPanel.tsx`
- `superset_v6/superset-frontend/plugins/plugin-chart-tableV3/test/controlPanel.test.ts`

Que cambia o corrige:
- `Column order` ya no usa como fallback todas las columnas del dataset cuando falta o cambia el `queryResponse`.
- Ahora la lista se construye a partir de los campos realmente visibles del chart: `groupby` o `all_columns`, `metrics`, `percent_metrics` y `Calculated columns`.
- El `queryResponse` solo se usa para respetar el orden/tipo real cuando existe, pero no para introducir campos auxiliares o columnas que no forman parte de la tabla visible.
- Se mantiene la exclusion de `Jinja Fields` y tambien se filtran columnas auxiliares presentes en el response pero no seleccionadas para mostrarse.
- Se agregaron regresiones para cubrir tres casos: exclusion de `Jinja Fields`, exclusion de campos extra del query y fallback correcto cuando no hay `queryResponse`.

Verificacion:
- `npx jest --runInBand plugins/plugin-chart-tableV3/test/controlPanel.test.ts`
- `npm run build-dev`
