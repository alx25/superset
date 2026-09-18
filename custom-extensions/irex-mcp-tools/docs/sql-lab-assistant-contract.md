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

El panel llama al proxy same-origin que ya expone
`custom-src/login/mcp_widget.py` (`chat_widget_api_proxy`), el mismo que
usa el widget de chat de dashboards hoy:

```
POST /api/chat-widget/api/sql-lab-assistant
Content-Type: application/json

<request del contrato, ver abajo>
```

Superset reenvía esa request a `<CHAT_WIDGET_API_URL>/api/sql-lab-assistant`
en el backend real, agregando automáticamente (el panel no los maneja):

- `X-Service-Secret` — secreto server-to-server (`CHAT_BACKEND_SECRET`)
- `X-Superset-User` — username del usuario autenticado
- `X-Superset-User-Email`, `X-Superset-User-Display-Name`

**No hay autenticación nueva que implementar en el chat para esto** — es
el mismo mecanismo que ya usan los endpoints existentes del widget. El
navegador nunca ve `CHAT_WIDGET_API_URL` ni ningún secreto; la identidad
viaja por la sesión de Flask ya autenticada, no por un JWT que maneje el
panel. Si el backend del chat todavía no tiene una ruta `/api/sql-lab-assistant`,
es la única pieza nueva pendiente de implementar ahí — el proxy y la
identidad ya funcionan sin cambios.

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
