# Contrato del asistente de SQL Lab — v1

Documento de entrega para el agente que mantiene el backend externo del
chat. Define el JSON que el panel del asistente (`sqllab.rightSidebar`)
envía como contexto, y el JSON de respuesta que el backend debe devolver.
No es un documento de arquitectura interna — es el contrato de wire.

## Versionado

Todo request y response lleva `contract_version`. Este documento describe
la versión `1`. Un cambio incompatible (agregar un campo requerido, cambiar
el tipo de uno existente, quitar una acción) sube el número; el panel
rechaza cualquier `contract_version` que no reconozca en vez de intentar
interpretarlo parcialmente.

## Transporte (estado actual)

Desde 2026-09-23 (Fase 6, portabilidad) el panel llama a la REST API
propia de la extensión (`backend/.../assistant_api.py`):

```
POST /extensions/irex/irex-mcp-tools/assistant/sql-lab
Content-Type: application/json
Accept: text/event-stream
X-CSRFToken: <token de la sesión de Superset>

<request del contrato, ver abajo>
```

Si esa ruta responde 404 (no registrada), el panel reintenta una sola vez
por el proxy genérico viejo `POST /api/chat-widget/api/sql-lab-assistant`
(`custom-src/login/mcp_widget.py`), que sigue existiendo para el widget de
dashboards.

Cualquiera de las dos rutas reenvía a
`<CHAT_WIDGET_API_URL>/api/sql-lab-assistant` con el mismo body y estos
headers, que siempre salen de la sesión del servidor y nunca del navegador:

- `X-Service-Secret` — secreto server-to-server (`CHAT_BACKEND_SECRET`)
- `X-Superset-User` — username del usuario autenticado
- `X-Superset-User-Email`, `X-Superset-User-Display-Name`

La ruta nueva además fija en el body `"mcp_url": "<MCP_WIDGET_URL del
entorno>"` (el mismo campo que manda el widget de dashboards), pisando
cualquier valor del navegador. Así cada entorno de Superset enruta a su
propio MCP: producción `…:5008`, test `…:5009`. El backend debe usarlo
(`mcp_url_source: "request"`).

Diferencia de la ruta nueva: del navegador solo reenvía `Content-Type` y
`Accept`. No reenvía `Cookie`, `User-Agent` ni ningún otro header, cosa
que el proxy viejo sí hacía. Antes de reenviar exige sesión válida, token
CSRF, `can_read` sobre `SQLLab` y el rol `CHAT_WIDGET_REQUIRED_ROLE`.

**No hay autenticación nueva que implementar en el chat para esto** — es
el mismo mecanismo que ya usan los endpoints existentes del widget. El
navegador nunca ve `CHAT_WIDGET_API_URL` ni ningún secreto; la identidad
viaja por la sesión de Flask ya autenticada, no por un JWT que maneje el
panel.

### Respuesta: SSE o JSON plano

El panel manda `Accept: text/event-stream` y sabe leer ambos formatos según
el `Content-Type` de la respuesta:

- `Content-Type: text/event-stream` → se procesa como stream de eventos
  (ver "Eventos SSE" más abajo). Es el formato preferido — permite emitir
  progreso intermedio mientras se arma la propuesta.
- Cualquier otro `Content-Type` → se procesa como el JSON plano de
  "Response" de siempre (fallback, por si el backend en un entorno puntual
  todavía no tiene el soporte SSE desplegado).

No hace falta implementar los dos a la vez para no romper nada: si el
backend solo devuelve JSON plano, el panel sigue funcionando (sin progreso
intermedio, solo con el resultado final).

## Formato de campos: `snake_case` en el wire

El JSON que viaja por HTTP usa `snake_case` (`contract_version`,
`selected_sql`, etc.), igual que el resto de las tools MCP de este
proyecto. El código TypeScript del panel (`frontend/src/contracts/assistant.ts`)
usa `camelCase` internamente (`contractVersion`, `selectedSql`) — es el
adaptador hacia el backend del chat (`chatBackendAdapter.ts`, Fase 6) el
que convierte entre ambos formatos. El backend del chat solo necesita
manejar `snake_case`.

## Request — contexto hacia el agente

```json
{
  "contract_version": 1,
  "source": "superset_sqllab",
  "conversation_key": "b2f1e6b0-....",
  "tab": {
    "id": "tab-id",
    "title": "Consulta",
    "database_id": 1,
    "catalog": null,
    "schema": "public"
  },
  "editor": {
    "sql": "SELECT ...",
    "selected_sql": "",
    "cursor": { "line": 0, "column": 0 }
  }
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `contract_version` | `1` | Literal, no incrementar sin coordinar |
| `source` | `"superset_sqllab"` | Fijo — distingue este origen de otros futuros |
| `conversation_key` | string | Generado y persistido por el panel entre turnos de una misma conversación (UUID o similar); se rotó agregado 2026-09-21 junto con `session_id` — ver "Sesiones y `conversation_key`" más abajo |
| `tab.id` | string | Id de la pestaña activa en SQL Lab |
| `tab.title` | string | Título visible de la pestaña |
| `tab.database_id` | number | Base de datos de la pestaña |
| `tab.catalog` | string \| null | `null` si la base no usa catálogos (ej. no-Trino) |
| `tab.schema` | string \| null | `null` si no hay schema seleccionado |
| `editor.sql` | string | Contenido completo del editor de la pestaña activa |
| `editor.selected_sql` | string | Texto seleccionado; `""` si no hay selección |
| `editor.cursor.line` / `.column` | number | Cero-indexado |

**Limitación conocida (ver Fase 0/4 del plan):** solo se envía el contexto
de la pestaña **activa**. `tab.getEditor()` de una pestaña inactiva nunca
se resuelve (confirmado empíricamente, timeout indefinido) — el backend no
debe esperar contexto de otras pestañas abiertas.

## Response — acciones admitidas

```json
{
  "contract_version": 1,
  "message": "Explicación breve",
  "session_id": "sqllab-9f2c...",
  "actions": [
    {
      "type": "propose_sql",
      "target": "selection",
      "sql": "SELECT ...",
      "title": "Corregir consulta"
    }
  ],
  "diagnostics": [
    {
      "line": 3,
      "column": 8,
      "severity": "warning",
      "message": "Posible división por cero"
    }
  ]
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `contract_version` | `1` | Debe coincidir con el del request |
| `message` | string | Texto explicativo mostrado en la conversación del panel |
| `session_id` | string, opcional | Id canónico de la conversación (ver "Sesiones y `conversation_key`") — el panel lo muestra en el encabezado y lo usa para cruzar `/api/logs/sessions/<session_id>`. Ausente = el panel simplemente no muestra nada, no es un error |
| `actions` | array | Ver tipos abajo; puede ser `[]` (respuesta solo conversacional) |
| `diagnostics` | array | Anotaciones a mostrar en el editor (`severity`: `error`\|`warning`\|`info`) |

### Tipos de `action` (unión discriminada por `type`)

| `type` | Campos propios | Efecto en el panel |
|---|---|---|
| `propose_sql` | `target` (`"selection"`\|`"document"`\|`"newTab"`), `sql`, `title` | Muestra un diff; el usuario decide Aplicar/Nueva pestaña/Ejecutar/Descartar |
| `replace_selection` | `sql`, `title?` | Reemplaza la selección actual en el editor |
| `replace_document` | `sql`, `title?` | Reemplaza todo el contenido del editor |
| `insert_sql` | `sql`, `title?` | Inserta en la posición del cursor |
| `create_tab` | `sql`, `title?` | Crea una pestaña nueva con ese SQL |
| `suggest_execution` | `sql`, `reason?` | **Nunca ejecuta por sí sola** — solo presenta el botón de confirmación |

`title` es opcional en `replace_selection`/`replace_document`/`insert_sql`
(extensión aditiva, 2026-09-18): si se incluye, el panel lo muestra como
encabezado de la tarjeta de la propuesta en vez de un texto genérico
("Reemplazar documento", etc.). Un `target` extra en el JSON de estas 3
acciones (redundante con el propio `type`) se ignora sin error — no hace
falta omitirlo si es más simple generarlo así del lado del backend.

**Regla no negociable:** el backend no debe parsear SQL desde texto libre
(Markdown, bloques de código en `message`, etc.) — todo SQL que el panel
vaya a aplicar o poder ejecutar tiene que venir en el campo `sql` de una
`action` tipada. `message` es solo para texto explicativo, nunca se
interpreta como fuente de SQL ejecutable.

## Aclaraciones con opciones (agregado 2026-09-21)

Cuando una decisión de negocio bloquea la propuesta (mismo patrón que ya
usa el widget principal del chat), la respuesta trae:

```json
{
  "contract_version": 1,
  "message": "Necesito confirmar una definición que cambia el resultado.",
  "suggestion_kind": "clarification",
  "clarification_reason": "material_business_ambiguity",
  "clarification_questions": [
    {
      "id": "correction_scope",
      "axis": "definition",
      "text": "¿Aplico la corrección a toda la consulta activa?",
      "options": ["A toda la consulta", "Solo a la selección"]
    }
  ],
  "skip_suggestions": false,
  "suggestions": ["A toda la consulta", "Solo a la selección"],
  "actions": [],
  "diagnostics": []
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `suggestion_kind` | `"clarification"` | El panel solo renderiza botones si vale exactamente esto |
| `clarification_reason` | string, opcional | Categoría interna del backend — el panel no lo muestra |
| `clarification_questions` | array, 1–3 items | Cada una: `id`, `axis?` (no se muestra), `text`, `options` (2–6 strings). **El panel renderiza los botones desde acá, nunca desde `suggestions`** |
| `skip_suggestions` / `suggestions` | — | Campo plano legado de otro consumidor — **el panel lo ignora por completo** |

Una sola opción por pregunta. Si `options` no incluye ya un "Otro: especificar",
el panel lo agrega con un input de texto libre. El botón "Continuar" se
habilita recién cuando todas las preguntas tienen respuesta.

**Respuesta del usuario:** se manda como el siguiente `user_message`
normal (mismo `conversation_key`, sin campo de selección aparte ni ids de
opción):
- Una sola pregunta → el texto de la opción elegida, tal cual.
- Varias preguntas → numerado y separado por `; `, ej.:
  `"1. A toda la consulta; 2. Sí, calcularlo así"`.

## Eventos SSE (cuando `Content-Type: text/event-stream`)

Formato SSE estándar — cada evento es un bloque `event: <tipo>` +
`data: <JSON>` terminado en línea vacía. El panel es un consumidor SSE
genérico: ignora sin error cualquier campo (`id:`, `retry:`) o tipo de
evento que no reconozca, para no romper si se agregan eventos nuevos.

| `event` | `data` | Efecto en el panel |
|---|---|---|
| `session` | `{ "session_id": "..." }` | El primero en llegar, antes que cualquier `status`. Muestra el id en el encabezado sin esperar a que termine el pedido |
| `status` | `{ "state": "thinking" \| "calling_tool" \| "responding" }` | Etiqueta genérica en la burbuja de progreso ("Analizando…", "Consultando…", "Preparando propuesta…") |
| `activity` | `{ "message": "texto" }` | Se muestra tal cual en la burbuja de progreso — son los pasos reales ("Obteniendo el plan de ejecución.", etc.) |
| `done` | `{ "sql_lab_response": {...}, "session_id"?: "...", "answer"?: "...", "model"?: "..." }` | Cierra el stream. `sql_lab_response` es el mismo objeto de "Response" de arriba (con `session_id`/campos de aclaración adentro o como hermanos del propio `done` — el panel acepta cualquiera de las dos ubicaciones para ambos). `answer`/`model` se ignoran del lado de SQL Lab (son para el consumidor del widget principal) |
| `error` | `{ "message": "texto" }` | Cierra el stream y muestra el error — mismo tratamiento que un error HTTP |

**No se exponen `tool_call`/`tool_result` crudos por este canal** — podrían
traer SQL, argumentos o resultados sensibles. El panel ni los espera ni
sabría procesarlos.

## Sesiones y `conversation_key` (agregado 2026-09-21)

`sql-lab-assistant` mantiene memoria de conversación del lado del backend
(`SessionStore`, Redis, rehidratación completa de historial y resultados de
tools). La clave interna original era determinista —
`sqllab-<sha256(usuario + tab.id)>` — sin ningún campo que el panel pudiera
mandar para pedir "empezar de cero" en la misma pestaña: el botón "Nueva
sesión" del panel solo vaciaba el historial visible, pero el siguiente
turno rehidrataba igual la conversación anterior.

`conversation_key` resuelve esto: el panel lo genera (UUID) una vez al
montarse, lo persiste en todos los turnos de esa conversación, y lo rota
(genera uno nuevo) al tocar "Nueva sesión". El backend lo incorpora a su
clave opaca junto con usuario + `tab.id` — al rotarlo, el turno siguiente
no puede recuperar el contexto anterior, que igual queda preservado (no se
borra) para auditoría y logs vía `session_id`.

**No confundir `conversation_key` con `session_id`:** `conversation_key` lo
genera el panel y solo sirve para que el backend arme su clave interna
(el panel nunca lo muestra ni lo usa para nada más); `session_id` lo define
el backend como identidad canónica de esa conversación y es lo que el
panel muestra en el encabezado y lo que sirve para
`/api/logs/sessions/<session_id>`.

No se reutiliza `/api/chat/reset` para esto — ese endpoint es del prompt
del widget principal y además borra la conversación persistida, que acá
se quiere conservar para auditoría.

## Errores — ver también "Requerimientos para el agente del chat" en el plan

Si el backend del chat termina invocando una tool MCP que el usuario no
tiene permiso de usar (RBAC de la Fase 2), la tool devuelve un error de
texto libre con el patrón `Permission denied: <permiso> on <vista> for
user <usuario> (tool: <nombre_tool>)`. No es parte de este contrato de
`actions`/`diagnostics` — es un error de la llamada MCP subyacente. El
chat debe distinguirlo (buscar el prefijo `"Permission denied:"`), no
reintentar, y no proponerlo como si fuera una `action` del contrato.

## Fuera de alcance de este contrato

- Ejecución real del SQL: ocurre en el navegador vía `sqlLab.executeQuery()`
  (Fase 8), nunca la decide ni la dispara el backend del chat directamente.
- Resultados de la consulta: el panel no reenvía filas completas al backend
  — ver Fase 8 ("no enviar resultados completos al modelo").
- Contexto de esquema (tablas/columnas disponibles): fuera de este
  contrato salvo que la Fase 7 (`irex.get_sql_schema_context`) resulte
  necesaria; en ese caso será una tool MCP aparte, no un campo de este
  JSON.
