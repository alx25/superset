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
