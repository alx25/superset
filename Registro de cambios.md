## Registro de cambios

Nota: anotar fecha y cambio realizado con los archivos afectados y que cambia o corrige.

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
