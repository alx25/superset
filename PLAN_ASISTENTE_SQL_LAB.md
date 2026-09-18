# Plan de implementación — Asistente IA integrado en SQL Lab

## Objetivo

Extender `irex-mcp-tools` para que el asistente pueda leer, crear, revisar,
corregir y, previa confirmación, ejecutar SQL desde la pestaña activa de SQL
Lab. La solución debe respetar RBAC, acceso a bases/datasets y RLS, y poder
empaquetarse como `.supx` para instalarse en versiones posteriores de Superset
sin parches al core.

## Instrucciones obligatorias para el agente

Antes de cambiar código:

1. Leer completos `AGENTS.md`, `CLAUDE.md` y `PLUGINS.md`.
2. Revisar `git status` y no alterar cambios ajenos.
3. No editar directamente una fuente dentro de `superset_v*/` una vez creada
   la fuente canónica descrita abajo.
4. Usar TypeScript estricto, sin `any`, JavaScript nuevo ni imports desde
   `superset-frontend/src/`.
5. Usar APIs y componentes públicos de `@apache-superset/core`.
6. Agregar fecha, archivos y explicación de cada cambio a
   `Registro de cambios.md`.
7. Probar primero con los servicios y configuración de test. No desplegar ni
   reiniciar producción sin autorización explícita.

## Estado inicial confirmado

- `superset_v6_1_0/irex-mcp-tools` ya es una extensión Superset con frontend,
  backend MCP y paquete `.supx`.
- El frontend solo registra un placeholder en `sqllab.panels`.
- Superset 6.1.0 expone mediante `@apache-superset/core` las APIs públicas
  `views`, `sqlLab`, `commands`, `menus`, `authentication` y `editors`.
- `sqlLab` permite obtener la pestaña activa, leer/manipular el editor, crear
  pestañas, ejecutar/cancelar consultas y escuchar éxitos o errores.
- El chat/modelo vive en un backend externo mantenido por otro agente. Este
  repositorio contiene el widget/proxy y el servidor MCP, pero no el modelo.
- El `execute_sql` MCP nativo existe, pero producción y test cargan solo tools
  con tag `irex` mediante `MCP_FACTORY_CONFIG.include_tags`.
- Las 14 tools irex registradas con `@tool` autentican al usuario, pero ninguna
  declara `class_permission_name`/`method_permission_name`. Esto debe corregirse
  cuidadosamente: autenticación, RBAC y RLS son controles distintos, y un
  cambio masivo sin auditar roles puede interrumpir el chat existente.

## Decisiones de arquitectura

Flujo objetivo:

```text
SQL Lab / panel derecho
  -> backend del chat (usuario autenticado)
  -> tools MCP irex (RBAC + acceso al objeto + RLS)
  -> propuesta estructurada de SQL
  -> diff y confirmación del usuario
  -> sqlLab.executeQuery()
  -> resultados e historial normales de SQL Lab
```

- Montar el asistente en `sqllab.rightSidebar`, punto previsto para asistentes
  y análisis, no como plugin de visualización.
- Ejecutar desde el navegador con `sqlLab.executeQuery()`. No habilitar
  `execute_sql` MCP para la primera versión.
- Separar completamente el componente visual de su adaptador de registro.
  Cuando una versión posterior incluya `chat.registerChat`, solo debe cambiar
  el adaptador; la UI y sus contratos deben continuar funcionando.
- El backend es siempre la autoridad de seguridad. Ocultar botones en React no
  se considera protección.

## Fase 0 — Spike de UX y API en test

Antes de mover directorios o cambiar permisos de producción, implementar un
spike pequeño y descartable en la ubicación actual de la extensión. Su objetivo
es validar las APIs y la experiencia, no entregar la versión final.

Alcance estricto:

1. Sustituir el placeholder por un panel mínimo en `sqllab.rightSidebar`.
2. Crear el contrato TypeScript v1 y un `sqlLabAdapter` inicial.
3. Leer código, selección y contexto de la pestaña activa.
4. Aplicar una propuesta simulada y crear una pestaña nueva.
5. Probar `executeQuery()` solo en test y con confirmación.
6. Medir el comportamiento de `getEditor()` en pestañas inactivas con timeout
   controlado: determinar si queda pendiente, resuelve al activar o falla.
7. No agregar tools MCP, no alterar RBAC y no desplegar en producción.

Criterio de salida: demostración funcional y decisión explícita de continuar.
El código reusable se conservará; cualquier instrumentación temporal se elimina.

### Resultado del spike (2026-09-18)

Ejecutado en `superset_test.service`/`superset_mcp_test.service` (puerto 9090),
usuario `admin`. Criterio de salida cumplido: demostración funcional
confirmada — contexto de pestaña activa, propuesta simulada, aplicar sobre
selección/documento, crear pestaña de ejemplo, ejecutar con confirmación y
diagnóstico de pestañas inactivas probados en el navegador real.

Código del spike (se conserva como base de la Fase 4/5, no se elimina):

- `irex-mcp-tools/frontend/src/contracts/assistant.ts` — contrato v1.
- `irex-mcp-tools/frontend/src/adapters/sqlLabAdapter.ts` — único módulo que
  toca `@apache-superset/core` (`sqlLab`, `editors`).
- `irex-mcp-tools/frontend/src/assistant/SqlLabAssistantPanel.tsx` — panel.
- `irex-mcp-tools/frontend/src/index.tsx` — registra el panel en
  `sqllab.rightSidebar` (reemplazó el placeholder en `sqllab.panels`).

**Hallazgo 1 — el `.supx` de producción nunca tuvo el frontend embebido.**
El manifest dentro de `extensions/irex-mcp-tools-0.1.0.supx` ya referenciaba
un `remoteEntry` (`frontend.remoteEntry` en el manifest), pero el zip no
contenía ningún archivo bajo `frontend/dist/`. El procedimiento documentado en
`CLAUDE.md` (`zip -u ... backend/src/...`) nunca cubrió el frontend. Esto
implica que el placeholder original (`<p>Irex MCP Tools</p>` en
`sqllab.panels`) nunca se ejecutó en un navegador real — el equipo no lo
detectó porque el fallo es silencioso a nivel de arranque de Superset (el
404 solo aparece en devtools al abrir SQL Lab). El spike arma el `.supx`
completo con `manifest.json` + `backend/src/...` + `frontend/dist/...`
reconstruyendo el zip desde cero (no `zip -u`), replicando lo que hará
`scripts/build-extension.sh` en la Fase 1.

**Hallazgo 2 — `EXTENSIONS_PATH` era el mismo directorio en test y
producción.** Corregido para el spike: `superset_config_test.py` ahora
apunta a `/home/imercados/superset_proyecto/extensions_test/` (antes
compartía `extensions/` con `superset_config.py` de producción). Sin este
cambio, cualquier `.supx` de prueba habría quedado listo para desplegarse
sin querer en el próximo reinicio de `superset.service`. Pendiente: decidir
si este aislamiento se vuelve permanente y se documenta en `CLAUDE.md`/
`PLUGINS.md`, o si se revierte al cerrar el spike.

**Hallazgo 3 — bloqueante encontrado y resuelto: 403 en `/api/v1/extensions/`
incluso para el usuario `admin` (rol Admin).** Causa raíz: el `AppBuilder` de
Superset se instancia con `update_perms=False`
(`superset/extensions/__init__.py:130`), así que el servidor web nunca crea
automáticamente los permisos FAB de vistas/APIs nuevas al arrancar. El
permiso real que exige `ExtensionsRestApi.get_list` es
`can_get_list on ExtensionsRestApi` — distinto de `can_read on Extensions`
(que pertenece a `ExtensionsView`, un blueprint separado, y sí existía en la
base de test). Ese permiso nunca se había sincronizado en la DB de test.
Se resolvió corriendo `superset init` con
`SUPERSET_CONFIG_PATH=superset_config_test.py` — comando idempotente que
solo agrega permission_views faltantes y los asigna a los roles base
(Admin, Alpha, Gamma, sql_lab); no toca producción (bases de datos
separadas: Postgres en prod, SQLite propio en test). **Implicación para la
Fase 2:** cualquier tool/endpoint nuevo con `class_permission_name`/
`method_permission_name` nuevo requerirá correr `superset init` en el
entorno correspondiente antes de que el permiso exista para asignar a un
rol — agregar este paso a los checklists de deploy de la Fase 2 y la Fase 10.

**Hallazgo 4 — el central del punto 6: `tab.getEditor()` en una pestaña que
no es la activa NO se resuelve nunca (no es una demora, es indefinido).**
Con 3 pestañas abiertas (2 inactivas + la creada por el spike), el probe con
timeout de 1500 ms dio `timeout` a los ~1504 ms para ambas pestañas
inactivas, sin excepción ni resolución tardía observada. Conclusión: el
adaptador **debe asumir siempre un timeout explícito** al leer el editor de
una pestaña no activa (ya implementado en `probeInactiveTabEditors`/
`getCurrentTabOrThrow`, que solo opera sobre la pestaña activa), y el
contexto de pestañas inactivas para la Fase 5/6 **debe salir de un cache
poblado la última vez que esa pestaña estuvo activa** (tal como ya preveía
esta fase), nunca de una lectura en caliente. No vale la pena intentar
`Promise.race` con timeouts cortos en el flujo real — el costo es alto
(siempre se espera el timeout completo) para un resultado que ya sabemos
que será negativo.

**Hallazgo incidental (no bloqueante, preexistente, no introducido por el
spike):** `superset.service` y `superset_test.service` registran en cada
arranque `Failed to sync configuration to database: cannot import name
'BaseCommand' from partially initialized module 'superset.commands.base'
(circular import)`, desde antes del 2026-09-16 (confirmado en logs de
producción previos a este spike). Solo afecta el seed de temas y listeners
de tagging (`sync_config_to_db` en `superset/app.py`), no los permisos FAB
ni la carga de extensiones. Queda fuera del alcance de este plan pero vale
la pena reportarlo aparte.

**Decisión (2026-09-18):** se avanza a la Fase 1. El aislamiento
`extensions_test/` se vuelve permanente (documentado en `CLAUDE.md`/
`PLUGINS.md` como parte de la Fase 1).

## Fase 1 — Fuente canónica y build portable

Crear esta fuente canónica fuera de cualquier versión de Superset:

```text
custom-extensions/irex-mcp-tools/
├── extension.json
├── frontend/
├── backend/
├── tests/
├── docs/
└── scripts/
```

Pasos:

1. Copiar y validar el proyecto actual; no eliminar el original hasta verificar
   que el nuevo paquete es equivalente.
2. Sustituir luego `superset_v6_1_0/irex-mcp-tools` por un symlink a la fuente
   canónica si el flujo de desarrollo lo necesita.
3. Documentar la nueva ubicación en `PLUGINS.md` y `CLAUDE.md`.
4. Crear `scripts/build-extension.sh` que reciba el directorio del Superset
   objetivo y:
   - compruebe las APIs públicas requeridas;
   - compile contra los tipos de esa versión;
   - ejecute tests;
   - genere desde cero el `.supx`;
   - valide `manifest.json` y las rutas internas del ZIP;
   - copie el artefacto a `extensions/` solo tras una compilación exitosa.
5. Mantener temporalmente el procedimiento de `CLAUDE.md`: cualquier ZIP debe
   construirse desde la raíz de la extensión y contener rutas `backend/src/...`.
6. Evitar `zip -u` como mecanismo final porque puede conservar archivos
   obsoletos. El artefacto reproducible debe reconstruirse completo.

Entregables de portabilidad:

- `COMPATIBILITY.md` con versión Superset, versión de
  `@apache-superset/core` y resultado de pruebas.
- Plantilla de configuración sin secretos.
- Comando de build y comando de smoke test.
- Un único `.supx` como artefacto instalable; ningún parche manual al core.

### Resultado de la Fase 1 (2026-09-18)

Completada. Fuente canónica creada en `custom-extensions/irex-mcp-tools/`
(mismo patrón que `custom-plugins/`/`custom-src/`, ver `PLUGINS.md`).
`superset_v6_1_0/irex-mcp-tools` es ahora un symlink a esa fuente — verificado
que `npx tsc --noEmit`, `npm run build` y el flujo de deploy documentado en
`CLAUDE.md` siguen funcionando igual a través del symlink (las herramientas
de archivos son transparentes a symlinks de directorio).

**Entregables:**

- `scripts/build-extension.sh` — orquesta: verifica que
  `@apache-superset/core` existe en el Superset objetivo → `tsc --noEmit` →
  `py_compile` de los 18 archivos backend → `pytest` (112 tests, usando el
  `.venv` del Superset objetivo, no el PATH del shell) → `npm run build` →
  empaqueta y valida el `.supx`. Solo copia al destino si los 6 pasos
  terminan sin error.
- `scripts/package_supx.py` — arma el `.supx` reconstruyéndolo desde cero
  (nunca `zip -u`): detecta el `remoteEntry.*.js` real generado por webpack,
  genera `manifest.json` desde `extension.json`, valida que todas las rutas
  internas sigan el patrón que espera
  `superset/extensions/utils.py` (`FRONTEND_REGEX`/`BACKEND_REGEX`) y que el
  `remoteEntry` referenciado en el manifest exista realmente en el zip —
  ataca directamente el Hallazgo 1 de la Fase 0 (el `.supx` de producción
  nunca había tenido el frontend embebido).
- `scripts/smoke_test.py` — el comando de "smoke test" pedido en los
  entregables: carga el `.supx` en un app context real de Superset
  (`discover_and_load_extensions`) y confirma que el manifest, el
  `remoteEntry` y el conteo de archivos backend son consistentes, sin
  necesitar levantar el servidor ni el navegador.
- `COMPATIBILITY.md` — versión de Superset/`@apache-superset/core`,
  resultado de pruebas (112 tests backend + build frontend + spike
  end-to-end), la limitación de `superset-extensions build/bundle` (exige
  npm ≥ 10.8.2; este entorno tiene 10.2.4) y el hallazgo de `update_perms`.
- **Plantilla de configuración sin secretos: no aplica.** `irex-mcp-tools`
  no lee ningún secreto propio — `MCP_JWT_SECRET`, `CHAT_BACKEND_SECRET`,
  etc. viven en `superset_config.py`/`superset_config_test.py` del host, no
  en la extensión. No hay nada que templar.
- `PLUGINS.md` y `CLAUDE.md` (raíz) actualizados: nueva sección "Al cambiar
  irex-mcp-tools" y "Fuente canónica de irex-mcp-tools" respectivamente,
  documentando el symlink, el build reproducible y el aislamiento permanente
  de `extensions_test/`.

**Validado end-to-end:** `build-extension.sh` corrido contra
`superset_v6_1_0` con destino `extensions_test/irex-mcp-tools-0.1.0.supx`
(112 tests OK, build OK, `.supx` validado) y `smoke_test.py` confirmó la
carga limpia del artefacto generado por el pipeline nuevo — reemplaza al
`.supx` armado a mano durante el spike sin cambiar su contenido efectivo
(mismas rutas internas, mismo manifest). Confirmado por el usuario en el
navegador tras reiniciar `superset_test.service`/`superset_mcp_test.service`:
el panel sigue funcionando igual con el artefacto generado por el pipeline
reproducible. `superset_v6_1_0/irex-mcp-tools.pre-symlink-backup/` (respaldo
temporal previo al symlink) eliminado tras la confirmación. **Fase 1
cerrada.**

## Fase 2 — Modelo de permisos

### Regla principal

Un usuario sin acceso a SQL Lab no puede usar desde el chat ninguna herramienta
que inspeccione esquemas, consulte, derive, grafique o exporte datos mediante el
flujo SQL. Esto debe cumplirse aunque invoque MCP directamente.

### Permisos por capacidad

| Capacidad | Permiso FAB mínimo | Comprobación adicional |
|---|---|---|
| Ver/usar el asistente de SQL Lab | `can_read` en `SQLLab` | usuario autenticado |
| Crear o revisar texto SQL | `can_read` en `SQLLab` | ninguna consulta automática |
| Inspeccionar esquema | `can_execute_sql_query` en `SQLLab` | acceso a la base |
| Consultar/ejecutar/exportar datos | `can_execute_sql_query` en `SQLLab` | base/dataset + RLS |
| Guardar consulta | `can_write` en `SavedQuery` | propietario/acceso |
| Crear dataset, chart o dashboard | permiso propio del recurso | acceso a las fuentes |

Los controles se combinan con `AND`. El permiso global de SQL Lab no concede
acceso a todas las bases o datasets.

### Auditoría previa obligatoria

No modificar en bloque los decoradores hasta completar esta auditoría:

1. Confirmar que `auth_bridge.py` resuelve el claim JWT `sub` al usuario real.
   `MCP_JWT_ISSUER` identifica al emisor, no determina un rol único: los
   permisos efectivos provienen de los roles/grupos de cada usuario resuelto.
2. Identificar los usuarios habilitados por `CHAT_WIDGET_REQUIRED_ROLE` y
   listar sus roles FAB efectivos.
3. Comprobar cuáles poseen `can_read` y `can_execute_sql_query` en `SQLLab`.
4. Construir una matriz de las 14 tools: datos que exponen, operación realizada,
   permiso global, permiso de objeto y si aplican RLS.
5. Definir qué funciones del chat seguirán disponibles sin SQL Lab. Las tools
   capaces de consultar, derivar, graficar o exportar datos quedan bloqueadas.
6. Probar el cambio con usuarios representativos en test antes de modificar
   roles o configuración de producción.
7. Coordinar el contrato de errores `permission_denied` con el agente que
   mantiene el backend del chat para evitar reintentos o mensajes engañosos.

La auditoría es de solo lectura. Cualquier alta de permisos a roles existentes
es un cambio de seguridad separado que requiere autorización. Conforme al
requisito del proyecto, los usuarios sin SQL Lab deben perder acceso a las
capacidades de datos, pero el despliegue debe ser deliberado y comunicado.

### Decoradores MCP

Toda tool que ejecute o derive datos debe declarar explícitamente:

```python
@tool(
    ...,
    class_permission_name="SQLLab",
    method_permission_name="execute_sql_query",
)
```

Inventariar las 14 tools irex antes de modificar. Como mínimo revisar:

- `query_dataset`
- `query_dataset_sql`
- `compare_periods`
- `rank_partitions`
- `forecast`
- `list_column_values`
- `export_to_excel`
- `chart_option`
- cualquier nueva tool de esquema o ejecución

El inventario debe incluir también `business_context`, `create_chart`,
`dashboard_dataset_context`, `dashboard_filters`, `query_context` y
`search_dashboards`, aunque finalmente usen permisos distintos a SQL Lab.

Las tools puramente informativas deben usar el permiso de su recurso, pero no
pueden constituir una ruta alternativa para obtener datos.

### Defensa en profundidad

1. Frontend: no registrar/mostrar acciones si falta `can_read` de SQL Lab.
2. REST API de la extensión: validar nuevamente al usuario y el permiso.
3. MCP: aplicar `class_permission_name` y `method_permission_name` por tool.
4. Tool: verificar acceso a la base/dataset/chart concreto y conservar RLS.
5. JWT: resolver al usuario real de Superset; un `sub` desconocido debe fallar,
   nunca caer a `MCP_DEV_USERNAME`/admin.
6. Chat externo: no confiar en permisos enviados por el navegador.
7. Producción: `MCP_RBAC_ENABLED` debe permanecer activo.

## Fase 3 — Contratos versionados

Crear tipos compartidos en `frontend/src/contracts/assistant.ts`. No usar
estructuras libres ni parsear SQL desde texto Markdown del modelo.

Contexto mínimo hacia el agente:

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
    "cursor": {"line": 0, "column": 0}
  }
}
```

Respuesta admitida:

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

Acciones permitidas inicialmente:

- `propose_sql`
- `replace_selection`
- `replace_document`
- `insert_sql`
- `create_tab`
- `suggest_execution`

`suggest_execution` nunca ejecuta por sí misma. Solo presenta una acción que
el usuario debe confirmar.

Crear `docs/sql-lab-assistant-contract.md` como documento de entrega para el
agente que mantiene el backend externo del chat.

## Fase 4 — Adaptador público de SQL Lab

Crear `frontend/src/adapters/sqlLabAdapter.ts`. Debe ser el único módulo que
conozca la API host y usar exclusivamente `@apache-superset/core`:

- `sqlLab.getCurrentTab()` y `sqlLab.getTabs()`;
- `tab.getEditor()`;
- `getValue()`, `getSelectedText()` y `getCursorPosition()`;
- `insertText()`, `setValue()` y `setAnnotations()`;
- `sqlLab.createTab()` y `sqlLab.setActiveTab()`;
- `sqlLab.executeQuery()` y `sqlLab.cancelQuery()`;
- eventos de cambio de pestaña, ejecución, éxito y error.

Limitación conocida: Superset solo monta el editor de la pestaña activa. No
esperar indefinidamente por `getEditor()` de una pestaña inactiva ni cambiarla
silenciosamente. La primera versión enviará el código de la pestaña activa y
solo metadatos de las demás. Se puede mantener un cache por pestaña visitada.

## Fase 5 — Interfaz del asistente

Estructura sugerida:

```text
frontend/src/
├── index.tsx
├── assistant/
│   ├── SqlLabAssistantPanel.tsx
│   ├── Conversation.tsx
│   ├── SqlDiff.tsx
│   └── Diagnostics.tsx
├── adapters/
│   ├── sqlLabAdapter.ts
│   └── chatBackendAdapter.ts
└── contracts/
    └── assistant.ts
```

Registrar el panel mediante un adaptador pequeño en `sqllab.rightSidebar`.
Ofrecer cuatro flujos:

1. Crear SQL.
2. Revisar consulta completa.
3. Revisar selección.
4. Explicar/corregir el último error.

Cada propuesta debe mostrar explicación, diff, advertencias y botones
`Aplicar`, `Nueva pestaña`, `Ejecutar` y `Descartar`. Usar componentes de
`@apache-superset/core/components` y tokens del tema, sin CSS global.

## Fase 6 — Integración con el chat

Primera iteración:

- reutilizar el backend, conversaciones y modelo existentes;
- llamar mediante el proxy same-origin actual;
- pasar contexto SQL Lab como campo estructurado;
- mantener identidad mediante el JWT emitido por Superset.

Portabilidad posterior:

- mover el proxy específico del asistente a una REST API de la extensión,
  registrada con `superset_core.rest_api` bajo
  `/extensions/irex/irex-mcp-tools/assistant/...`;
- conservar temporalmente las rutas antiguas como capa de compatibilidad;
- leer URLs y secretos solo desde configuración/entorno del servidor;
- nunca incluir secretos MCP, del modelo o del chat en el bundle JavaScript.

## Fase 7 — Contexto de esquema opcional

Implementar `irex.get_sql_schema_context` solo si las pruebas de generación
demuestran que el contexto actual no basta.

Requisitos:

- solo lectura y tag `irex`;
- permiso `can_execute_sql_query` en `SQLLab`;
- acceso comprobado a `database_id`;
- filtros por catálogo, esquema, tabla o búsqueda;
- límites estrictos de tablas/columnas;
- no devolver credenciales, URI SQLAlchemy ni configuración sensible;
- aislar imports internos inevitables en `backend/.../compat/`;
- importar el módulo en `entrypoint.py`;
- agregar el nombre completo a `MCP_TOOL_SEARCH_CONFIG.always_visible`, como
  exige `CLAUDE.md` para toda tool nueva;
- pruebas unitarias de permiso, acceso por base y serialización.

## Fase 8 — Aplicación y ejecución segura

- Mostrar el diff antes de cambiar el editor.
- Preferir reemplazar la selección con `insertText()`; ofrecer pestaña nueva
  para conservar la consulta original.
- Ejecutar exactamente el SQL confirmado mediante `sqlLab.executeQuery()`.
- Aplicar un límite conservador.
- Primera versión asistida: `SELECT`, `WITH` y `EXPLAIN`.
- Detectar DDL/DML con el parser de Superset/dialecto, no solo regex.
- DDL/DML requiere confirmación reforzada y capacidades/permisos de la base.
- No enviar resultados completos al modelo: columnas, error y muestra limitada.
- Permitir cancelar y relacionar eventos por `queryId`.
- No crear un ciclo autónomo de corrección/ejecución en la primera versión.

## Fase 9 — Pruebas

### Frontend

- contexto de pestaña activa y selección;
- cambio/cierre de pestaña;
- diff y aplicación sobre selección/documento;
- creación de pestaña;
- confirmación obligatoria antes de ejecutar;
- anotaciones, éxito, error y cancelación;
- panel ausente o bloqueado sin `can_read SQLLab`;
- contratos malformados rechazados.

Usar Jest y React Testing Library.

### Backend/MCP

- usuario con SQL Lab y base permitida: acceso;
- usuario con SQL Lab pero sin acceso a la base: denegado;
- usuario con dashboards pero sin SQL Lab: todas las tools de consulta del
  asistente son denegadas desde MCP;
- usuario JWT inexistente: denegado sin fallback a admin;
- dos usuarios con RLS distinto: resultados diferentes y correctos;
- endpoint REST directo sin permiso: 403;
- `MCP_RBAC_ENABLED=False` en una configuración marcada como producción:
  validación/alerta de despliegue;
- límites de contexto y de resultados.

### Compatibilidad

Para cada versión objetivo:

1. Compilar contra su `@apache-superset/core`.
2. Instalar el `.supx` en un entorno limpio.
3. Verificar manifest y carga del frontend/backend.
4. Abrir el panel derecho.
5. Leer, aplicar y ejecutar SQL.
6. Confirmar resultados en el panel normal de SQL Lab.
7. Repetir los casos RBAC negativos.

## Fase 10 — Build y despliegue

1. Ejecutar tests y build desde la fuente canónica.
2. Verificar el contenido del `.supx` antes de copiarlo.
3. Instalar primero en `EXTENSIONS_PATH` del entorno test.
4. Reiniciar los servicios web y MCP de test correspondientes.
5. Verificar logs y realizar prueba end-to-end con un usuario permitido y uno
   sin SQL Lab.
6. Preparar reporte de resultados y pedir autorización antes de producción.
7. En producción, reiniciar `superset.service` y
   `superset_mcp.service`; Superset no corre en Docker.

## Orden recomendado

1. Spike en test: contrato, adaptador y panel derecho mínimo.
2. Validar UX y comportamiento real de pestañas/editor.
3. Crear fuente canónica y build reproducible.
4. Auditar usuarios, roles y las 14 tools irex sin cambiar permisos.
5. Definir el contrato con el backend externo.
6. Aplicar RBAC por categoría en test y adaptar errores del chat.
7. Completar panel, diff, aplicación y ejecución confirmada.
8. Implementar la tool opcional de esquema si resulta necesaria.
9. Ejecutar tests de permisos, compatibilidad y validación end-to-end.
10. Desplegar en producción solo con autorización y plan de reversión.

## Criterios de aceptación

- El usuario puede crear/revisar SQL de la pestaña activa y ver un diff.
- Puede aplicar en selección, documento o pestaña nueva.
- Solo una confirmación explícita ejecuta la propuesta.
- La consulta aparece en resultados/historial normal de SQL Lab.
- Un usuario sin SQL Lab no puede usar las tools equivalentes desde chat,
  REST ni MCP directo.
- Tener SQL Lab no evita controles de base, dataset o RLS.
- No hay imports frontend internos ni parches al core.
- El build genera un `.supx` reproducible e instalable en un Superset limpio.
- La versión siguiente requiere, como máximo, adaptar la capa host y actualizar
  dependencias/tipos; no reescribir el asistente.
- Tests, documentación y `Registro de cambios.md` quedan actualizados.

## Fuera del alcance inicial

- Ejecución autónoma sin confirmación.
- Lectura silenciosa del código de todas las pestañas inactivas.
- Reemplazar el editor Ace/Monaco completo.
- Habilitar globalmente el `execute_sql` MCP nativo.
- Permitir DDL/DML automático.
