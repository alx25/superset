# Compatibilidad

## Versión objetivo actual

| Componente | Versión |
|---|---|
| Apache Superset | 6.1.0 (rama `prod-6`, directorio `superset_v6_1_0/`) |
| `@apache-superset/core` | 0.1.0-rc3 |
| Node.js | v18.19.1 |
| npm | 10.2.4 |
| Python (backend) | 3.11 (venv de `superset_v6_1_0/.venv`) |

## Resultado de pruebas (2026-09-18)

- **Backend**: 112 tests (`pytest`) pasan sobre las 14 tools registradas con `@tool`
  en `backend/src/irex/irex_mcp_tools/`.
- **Frontend**: `npx tsc --noEmit` sin errores (TypeScript estricto, sin `any`);
  `npm run build` (webpack, modo producción) genera el bundle vía Module Federation.
- **End-to-end (spike Fase 0 de `PLAN_ASISTENTE_SQL_LAB.md`)**: panel del asistente
  SQL Lab probado en navegador real contra `superset_test.service` (puerto 9090):
  lectura de contexto de pestaña activa, propuesta simulada, aplicar sobre
  selección/documento, crear pestaña, ejecutar con confirmación
  (`sqlLab.executeQuery()`) y diagnóstico de `getEditor()` en pestañas inactivas.

## Limitación conocida: `superset-extensions build`/`bundle`

El CLI oficial (`superset-extensions-cli`, comando `superset-extensions`) exige
`npm >= 10.8.2`. Este entorno tiene `npm 10.2.4`, por lo que `build` y `bundle`
fallan con `❌ npm version 10.2.4 is lower than the required 10.8.2` antes de
llegar a compilar nada — no es un problema del código de la extensión.

**Mitigación**: `scripts/build-extension.sh` no depende de ese CLI. Compila con
`tsc`/`webpack` directamente y arma el `.supx` reconstruyéndolo desde cero con
`scripts/package_supx.py` (manifest.json generado desde `extension.json` + el
hash real de `remoteEntry` detectado en `frontend/dist/`, más todo
`backend/src/irex/irex_mcp_tools/*.py` y `frontend/dist/*.js`). El resultado es
equivalente al que produciría el CLI oficial — mismas rutas internas
(`backend/src/...`, `frontend/dist/...`), mismo `manifest.json`.

Si en algún momento se actualiza npm del sistema a >= 10.8.2 (fuera del alcance
de este proyecto — afecta a todo el sistema, no solo a esta extensión), vale la
pena revalidar si `superset-extensions build`/`bundle` puede reemplazar a
`package_supx.py`; hasta entonces, el script manual es la vía soportada.

## Hallazgo de infraestructura: permisos FAB no se sincronizan solos

El `AppBuilder` de Superset se instancia con `update_perms=False`
(`superset/extensions/__init__.py:130`), así que el servidor web (gunicorn)
**nunca** crea automáticamente los permission_views de vistas/APIs nuevas al
arrancar. Cualquier entorno (test o producción) que instale una versión de
esta extensión con una superficie de permisos nueva necesita correr
`superset init` (con el `SUPERSET_CONFIG_PATH` correspondiente) al menos una
vez para que los permisos existan y puedan asignarse a roles. Ver el hallazgo
completo en la Fase 0 de `PLAN_ASISTENTE_SQL_LAB.md`.

## Qué cambia al migrar a una versión nueva de Superset

1. Copiar/symlinkear esta fuente (`custom-extensions/irex-mcp-tools/`) — no
   hace falta recrearla, es independiente de la versión de Superset.
2. Correr `scripts/build-extension.sh <ruta_superset_nuevo> <destino.supx>`.
   El paso 1 del script falla rápido si `@apache-superset/core` no está en la
   ruta esperada dentro del Superset objetivo.
3. Si `tsc`/`webpack` fallan por cambios en los tipos públicos de `sqlLab`,
   `editors`, `views` o `components`: solo debería requerir ajustar
   `frontend/src/adapters/sqlLabAdapter.ts` (el único módulo que conoce esas
   APIs) — el contrato (`contracts/assistant.ts`) y la UI
   (`assistant/SqlLabAssistantPanel.tsx`) no deberían necesitar cambios.
4. Actualizar esta tabla con la nueva versión de Superset y de
   `@apache-superset/core`, y volver a correr la batería de pruebas.

## Verificación de compatibilidad (2026-09-23)

### Herramientas

| Script | Qué hace | Toca algo existente |
|---|---|---|
| `scripts/check_host_compat.py <fuente_superset>` | Análisis estático contra el código de cualquier versión: los símbolos internos `superset.*` que usa el backend (descubiertos leyendo `backend/src`), si cada import está a nivel de módulo (rompe la carga de todas las tools) o dentro de una función (rompe esa tool), los parámetros de `@tool`/`@api`, los 25 símbolos de `@apache-superset/core` que usa el panel, `sqllab.rightSidebar`, el gancho de `auth_bridge` y el texto `Permission denied:` | No |
| `scripts/check_clean_install.sh <superset> <.supx>` | Levanta un Superset limpio descartable (SQLite nueva, sin `custom-src`, solo `ENABLE_EXTENSIONS` + `EXTENSIONS_PATH`) y verifica carga del backend, 17 tools, API, `remoteEntry` servido, 503 sin backend de chat configurado, 403 para Gamma y que SQL Lab abra | No (directorio temporal que se borra al terminar) |
| `scripts/check_deploy_config.py` | Config + `.supx` antes de desplegar (ver Fase 10) | No |

Frontend contra una versión puntual de `@apache-superset/core`: tsconfig
temporal con `"paths": {"@apache-superset/core": ["<paquete>/lib/index.d.ts"]}`
y `npx tsc -p <ese tsconfig>`.

### Resultados

| Objetivo | Resultado |
|---|---|
| Superset 6.1.0 (host actual, core `0.1.0-rc3`) | `check_host_compat`: compatible, 27/27 símbolos internos, 25/25 del frontend. `check_clean_install`: 10/10 |
| `@apache-superset/core` 0.1.0 final (npm) | `.d.ts` idénticos a rc3 en todos los módulos que usa el panel; `tsc` estricto OK contra las dos. El `package-lock.json` ya resuelve 0.1.0 final |
| `apache-superset-core` 0.1.0 (PyPI) | `mcp/decorators.py`, `rest_api/decorators.py` y `rest_api/api.py` idénticos a rc3 |
| Superset `master` (`c0c688d`, 2026-09-23; todavía sin release posterior a 6.1.0) | `check_host_compat`: **compatible, 0 bloqueantes**. `tsc` contra las fuentes TS de master: 0 errores en la extensión |

### Qué cambia en `master` y cómo afecta

- `superset.mcp_service.chart.schemas.parse_chart_config` ya no existe. Solo
  lo usa `create_chart`, dentro de la función y con la tool deshabilitada por
  diseño (`exclude_tags: guardar`), así que no afecta la carga.
- El host resuelve el usuario del JWT de forma nativa y falla cerrado ante un
  usuario inexistente. `auth_bridge` queda redundante pero inofensivo: master
  importa `get_user_from_request` por nombre en `server.py`/`middleware.py`
  (el parche no los alcanza), pero ya deja `g.user` resuelto y el reemplazo
  de `auth_bridge` lo respeta primero.
  **Riesgo a vigilar:** el resolver de master prioriza
  `preferred_username` → `username` → `email` → `sub`. El JWT del widget
  (`custom-src/login/mcp_widget.py`) solo trae `sub` como identidad; si
  alguien agrega `email` o `username`, el usuario se resolvería mal y el chat
  fallaría. Queda anotado en ese archivo.
- Los errores de tool llegan como `ToolError` (`isError: true`, prefijo
  `Error calling tool …`). `Permission denied: …` se conserva textual, así
  que la detección del chat por subcadena sigue funcionando.
- `RestApi` sigue exento de CSRF por defecto y `@api` sigue sincronizando
  permisos: `csrf_exempt = False` y la vista propia de `assistant_api.py`
  siguen siendo necesarios.
- Existe la API `chat` (`registerChat`, modos `floating`/`panel`), que el
  plan anticipaba. No está en el `@apache-superset/core` 0.1.0 publicado.
  Cuando se publique, solo cambia el registro en `frontend/src/index.tsx`.
- Flask-AppBuilder pasa de 5.0.2 a 5.2.3.

### Sin cubrir

"Abrir el panel, leer/aplicar/ejecutar SQL y confirmar resultados" en una
versión nueva requiere un frontend de Superset compilado de esa versión; no
hay release posterior a 6.1.0. En 6.1.0 lo cubren los 63 tests de frontend
y las pruebas manuales en el navegador.
