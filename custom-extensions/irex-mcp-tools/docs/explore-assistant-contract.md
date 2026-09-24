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

**⚠️ Acción requerida del backend antes de que esto viaje (entrada 73, 2026-09-24
— bloqueante):** la primera prueba real de este campo tumbó "Explicar" con
422 `{"detail":[{"type":"extra_forbidden","loc":["body","chart","query_context"],
"msg":"Extra inputs are not permitted",...}]}` — el modelo Pydantic (u
equivalente) que valida `chart` en el backend del chat tiene `extra="forbid"`
(o similar) y rechaza el body ENTERO al no reconocer el campo, antes de
llegar al modelo. **Se desactivó del lado de la extensión** (no se manda
todavía — `SEND_QUERY_CONTEXT_IN_REQUEST = false` en
`frontend/src/adapters/exploreAdapter.ts`) para no seguir rompiendo
"Explicar". Para reactivarlo: agregar `query_context: str | None = None` (o
el equivalente de ese framework) al modelo que valida `chart`, y avisar —
ahí se cambia esa constante a `true` y se re-despliega.

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

**Todavía no en tránsito (entrada 73, 2026-09-24) — ver el aviso ⚠️ más
abajo, junto a `chart.query_context`:** el campo está construido pero
DESACTIVADO del lado de la extensión hasta que el backend deje de
rechazarlo con 422. Hasta entonces sigue aplicando el límite de siempre:
sin `chart.query_context`, sin SQL, resultados ni `preview`.

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

## Tools MCP requeridas

El modelo solo ve las tools Explore. Las tools de SQL libre de SQL Lab y las
analíticas de dashboards quedan fuera incluso si el MCP las anuncia mediante
`call_tool`.

- `irex.get_explore_state`: obligatoria; devuelve el estado verificado descrito arriba.
- `irex.get_viz_controls` (implementada, entrada 78 de `Registro de cambios.md`,
  2026-09-24): input `{"viz_type": "table_v3"}`. Obligatoria para aceptar
  cambios de controles (`patch_form_data`) o de tipo (`change_viz_type`) —
  sin validar el nombre del control contra esto, no confiar en la
  propuesta. Devuelve:
  ```json
  {"viz_type": "table_v3", "controls": ["adhoc_filters", "column_config", "..."], "source": "specific"}
  ```
  `source` tiene DOS niveles de confianza, nunca mezclados — clave para
  decidir cuánto confiar en la lista:
  - `"specific"`: solo para los tres plugins propios (`table_v3`,
    `html_cards`, `pivot_table_rx1`) — lista EXACTA y COMPLETA, verificada
    leyendo su código fuente real. Un control que no está en esta lista NO
    existe para ese tipo — se puede rechazar la propuesta con confianza.
  - `"generic"`: para cualquier otro `viz_type` (todos los nativos de
    Superset, sin excepción todavía) — el catálogo compartido que la
    mayoría de los tipos de Superset reusa (`metrics`, `groupby`,
    `adhoc_filters`, `row_limit`, `time_range`, `x_axis`, etc.), NO
    verificado específicamente para ese tipo. Trae además un campo `note`
    explicando esto. Un control ausente de esta lista genérica NO prueba
    que no exista (podría ser un control propio de ese tipo nativo que el
    catálogo compartido no cubre) — al revés de `"specific"`, acá conviene
    ser permisivo al rechazar.
- `irex.validate_expression`: recibe `dataset_id`, `expression` y `kind` (`metric` o `column`); devuelve `valid: true`, `dataset_id` y la misma `expression` solicitada. Solo esa coincidencia exacta habilita la acción. El backend comprueba cada expresión propuesta que el modelo no haya validado ya (máximo cuatro verificaciones adicionales por turno).
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
