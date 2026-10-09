# Configuración del servidor (`superset_config.py`)

`superset_config.template.py` es la config real de producción de este proyecto
(`/home/imercados/.superset/superset_config.py`), generada sin secretos ni datos
propios del servidor: esos valores se leen de variables de entorno
(`superset.env.example`). Si falta un secreto, Superset no arranca: nunca usa un
valor por defecto conocido.

También incluye los valores que en el servidor original estaban dentro de
`superset/config.py` (núcleo) y que la config de producción no redefine
(`FAB_INDEX_VIEW` que redirige a la lista de dashboards, `MCP_DEV_USERNAME`).
Así un servidor nuevo usa el `superset/config.py` de Superset más los parches de
`migrate-plugins.sh`, y todo lo propio del entorno vive en esta config.

## Servidor nuevo
Manual completo: `INSTALACION_SERVIDOR_NUEVO.md` (raíz del repo). Resumen:

1. `./migrate-plugins.sh /ruta/superset_vX_Y_Z` (debe terminar sin `[error]`).
2. Copiar `superset_config.template.py` a la ruta de `SUPERSET_CONFIG_PATH`.
3. Crear `.env_superset` y `.env_superset_mcp` a partir de `superset.env.example`
   (ver las secciones del archivo); los usan como `EnvironmentFile=` las unidades de
   `systemd-new/`.
4. Copiar `extensions/irex-mcp-tools-0.1.0.supx` a `IREX_EXTENSIONS_PATH`.
5. Frontend: `npm install`, `npm run build-translation`, `npm run build`.
6. `superset db upgrade`, `superset init`, reiniciar servicios.

## Mantener la plantilla al día
Cada vez que cambie la config de producción:

    python3 config-templates/build_template.py \
        /home/imercados/.superset/superset_config.py \
        superset_v6_1_0/superset/config.py

El generador falla si después de transformar queda algún secreto conocido en el
texto. Para un secreto o dato de servidor nuevo, agregarlo a `SECRETS` o
`SERVER_VALUES` en `build_template.py` y a `superset.env.example`.

Verificado el 2026-10-09: cargando la plantilla con las variables de entorno
tomadas de producción, las 357 variables de config dan el mismo valor que la
config de producción (solo cambian identidades de objetos: codecs, caches,
lambdas), más `FAB_INDEX_VIEW` y `MCP_DEV_USERNAME` del núcleo.

## Limitación conocida
`custom-extensions/irex-mcp-tools/scripts/e2e_rbac.py` lee `MCP_JWT_SECRET`
como literal del archivo de config; en un servidor con esta plantilla hay que
pasarle una config con el literal o adaptar el script para leer la variable de
entorno.
