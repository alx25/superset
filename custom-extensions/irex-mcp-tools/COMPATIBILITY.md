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
