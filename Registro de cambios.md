## Registro de cambios

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
