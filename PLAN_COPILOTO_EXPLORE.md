# Plan de implementación — Copiloto de gráficos en Explore

## Objetivo

Extender el asistente de `irex-mcp-tools` al editor de gráficos de Superset
(Explore), como copiloto:

1. Estar presente al crear o editar un gráfico, con el mismo panel del
   asistente de SQL Lab.
2. Leer el gráfico tal como está en pantalla (incluidos los cambios sin
   guardar) y conocer los controles disponibles de cada tipo de gráfico,
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
   No incluye borrar, ni cambiar el SQL del dataset, ni crear datasets o
   gráficos.
2. **Panel propio en Explore**, reutilizando el del asistente de SQL Lab. El
   widget de chat de dashboards ("El Don") se oculta en Explore, igual que en
   SQL Lab (entrada 50 del Registro de cambios).
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

**Estado del gráfico**
- Explore guarda su estado sin guardar en el servidor con debounce de 1 s
  (`updateHistory` → `postFormData`/`putFormData`) y lo refleja en la URL
  como `form_data_key`.
- REST públicas: `POST/PUT/GET/DELETE /api/v1/explore/form_data[/<key>]`,
  `GET /api/v1/explore/` (form_data + dataset + gráfico) y permalinks.
- Leer lo que el usuario ve: `GET /api/v1/explore/form_data/<key>`.
  Aplicar un cambio: escribir un form_data nuevo y recargar Explore con esa
  key (1–2 s). El gráfico queda sin guardar; guarda el usuario.

**Datos, SQL y tiempos**
- `POST /api/v1/chart/data` con `result_type`: `query` (SQL generado, sin
  ejecutar), `samples`, `results`, `full`, etc. Devuelve `query`,
  `rowcount`, `sql_rowcount`, `is_cached`, `cached_dttm`,
  `applied_filters`, `rejected_filters`, `colnames`, `coltypes`.
- **La duración no se expone** (`QueryResult.duration` existe pero no
  viaja en la respuesta): hay que medirla en una tool propia.
- Ya existen `irex.explain_query` (plan / ANALYZE) e
  `irex.check_query_nulls` (JOINs vacíos) para el diagnóstico.

**Datasets**
- `PUT /api/v1/dataset/<id>` crea (sin `id`), actualiza (con `id`) y
  **BORRA toda métrica o columna que no venga en la lista**. Enviar solo lo
  nuevo eliminaría el resto y rompería los gráficos que lo usan.
- Exige ser owner del dataset o Admin (`raise_for_ownership`).
- `master` agrega la tool MCP `update_dataset_metric` (solo edita
  existentes, no crea; `Dataset.write` + editor), `get_chart_sql` (acepta
  `form_data_key`) y `execute_chart_data`.

**Catálogo de controles**
- `get_chart_type_schema` (MCP nativo) cubre solo 7 tipos simplificados
  (`xy`, `table`, `pie`, `pivot_table`, `mixed_timeseries`, `handlebars`,
  `big_number`). No cubre los plugins propios ni el form_data real de cada
  `viz_type`: hay que construir un catálogo propio.

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
| Autorización | Los permisos normales de Explore del usuario | **Rol Admin verificado en el servidor** + CSRF |
| Confirmación | Diff por control + "Aplicar" | Confirmación reforzada (escribir la palabra) |
| Deshacer | Volver al form_data anterior (key previa) | Quitar exactamente lo agregado (por id) |

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
producción.

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
5. Catálogo de controles: probar si el registro de paneles de control del
   host (`getChartControlPanelRegistry`) es accesible desde la extensión en
   runtime. Si no, extraerlo en build desde el código de los plugins
   (nativos y propios).
6. Ocultar "El Don" en `/explore` (extender la regla de la entrada 50).

Entregable: informe con la decisión de cada punto en este documento.

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

## Fase 2 — Permisos

1. Auditoría (solo lectura, como la Fase 2 de SQL Lab): qué roles tienen
   `can_explore`/`can_read` sobre `Chart` y `Dataset` hoy, y qué usuarios
   del chat usarían el copiloto.
2. Gate de las tools MCP nuevas: definir el permiso por tool (por ejemplo
   `can_read` sobre `Chart` para leer estado y vista previa), con el mismo
   decorador que las tools actuales. Tests negativos con un usuario sin ese
   permiso.
3. **Admin para datasets.** El endpoint de dataset verifica en el servidor
   `security_manager.is_admin()` (o el rol configurado
   `IREX_DATASET_WRITE_ROLE`, por defecto `Admin`), más sesión, CSRF y
   acceso al dataset. El frontend oculta las acciones de dataset a
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

## Fase 4 — Tools MCP (solo lectura)

Todas con tag `irex`, RBAC por tool, RLS, límites estrictos y sin exponer
credenciales. Paso 6 de `CLAUDE.md`: agregarlas a `always_visible`.

1. `irex.get_explore_state` — form_data de una key o de un gráfico
   guardado, más el resumen del dataset (métricas y columnas con tipo y
   expresión).
2. `irex.preview_chart` — dado un form_data: SQL generado
   (`result_type=query`), ejecución acotada (`samples`, tope de filas),
   `rowcount`, `is_cached`, filtros aplicados y rechazados, **duración
   medida** y error. Nunca devuelve más de N filas al modelo (mismo
   principio que `check_query_nulls`).
3. `irex.get_viz_controls` — catálogo de controles por `viz_type` (nombre,
   tipo, valores válidos, por defecto, descripción), incluidos los tres
   plugins propios. Fuente: la decidida en la Fase 0.
4. `irex.validate_expression` — prueba una expresión de métrica o columna
   contra el dataset con una consulta acotada, sin guardar nada. La usan el
   backend del chat antes de proponer y el endpoint de dataset antes de
   escribir.
5. Reutilizar `irex.explain_query` e `irex.check_query_nulls` sobre el SQL
   de `preview_chart`.

## Fase 5 — Nivel 1: lectura y diagnóstico

1. Modo "Explicar": qué muestra el gráfico, de dónde salen los datos, qué
   filtros aplica, por qué un valor da lo que da.
2. Tarjeta "SQL y rendimiento": SQL con resaltado, duración, filas, caché,
   filtros rechazados, y botón para ver el plan (`explain_query`).
3. Diagnósticos: JOINs vacíos, filtros que no aplican, métricas con nulos.

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

Endpoint `POST /extensions/irex/irex-mcp-tools/assistant/dataset-changes`,
en el servidor:

1. Verifica Admin, sesión, CSRF y acceso al dataset.
2. Solo acepta **agregar** métricas y columnas calculadas (nunca borra ni
   modifica las existentes en esta versión). Rechaza nombres que ya
   existen.
3. Valida cada expresión con una consulta acotada antes de escribir.
4. **Lectura + fusión + escritura en el servidor**: lee la lista completa,
   agrega, y guarda con el comando de Superset (`UpdateDatasetCommand`).
   Concurrencia optimista: si el dataset cambió desde que se leyó
   (`changed_on`), rechaza y pide reintentar.
5. Test obligatorio: **después de guardar, todas las métricas y columnas
   previas siguen existiendo sin cambios.**
6. Devuelve los ids creados para "Deshacer" (quitar exactamente eso).
7. Registro de auditoría: quién, cuándo, dataset y qué se agregó.

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

1. Fase 0 (spike) y decisión de cada incógnita.
2. Fase 1 (carcasa común) sin romper SQL Lab.
3. Fases 2–4 (permisos, contrato, tools) — en paralelo el agente del chat
   implementa su endpoint.
4. Fase 5 (valor inmediato, riesgo bajo).
5. Fase 6 (cambios al gráfico, con plugins).
6. Fase 7 (dataset, Admin).
7. Fases 8–9.

## Criterios de aceptación

- El panel aparece en Explore (crear y editar) con la misma experiencia que
  en SQL Lab, y "El Don" no aparece ahí.
- El asistente describe con exactitud el gráfico en pantalla, incluidos los
  cambios sin guardar.
- Muestra el SQL resultante, la duración, las filas y los filtros
  rechazados.
- Aplica cambios al gráfico solo tras confirmación, con diff por control y
  deshacer, en los tipos nativos y en los tres plugins propios.
- Un no-Admin no puede modificar un dataset por ninguna vía (UI, REST
  directa, MCP).
- Agregar una métrica o columna al dataset nunca modifica ni borra las
  existentes.
- SQL Lab sigue funcionando igual (sus tests sin cambios).
- Todo se empaqueta en el `.supx`, sin parches al core; documentación y
  `Registro de cambios.md` al día.

## Fuera del alcance inicial

- Guardar el gráfico desde el asistente (lo guarda el usuario).
- Borrar o modificar métricas y columnas existentes del dataset, cambiar su
  SQL, crear datasets o gráficos nuevos.
- Manipular controles de Explore en vivo sin recarga (no hay API pública).
- Automatizar la pantalla por DOM (clics o escritura sobre controles).
- Escrituras autónomas o desde el MCP.
