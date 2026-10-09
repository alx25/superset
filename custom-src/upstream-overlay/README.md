# Overlay de archivos de Superset

Archivos de Superset que irex modifica y que no tienen un paso de parche propio
en `migrate-plugins.sh` (lista en `FILES`). Se instalan como copia completa
(`files/<ruta>`) en el paso 19, pero solo si el archivo del destino es
exactamente el original de la versión registrada en `manifest.json`
(`superset_version`, `upstream_sha256`). Si el destino ya es la copia, no hace
nada; si es otra cosa (otra versión de Superset o un cambio local), el paso
falla y el script termina con error: hay que portar el cambio a mano.

## Mantenimiento
- Cambiar uno de estos archivos en `superset_v6_1_0` y regenerar:
  `python3 custom-src/upstream-overlay/overlay.py build superset_v6_1_0 6.1.0`
- Agregar un archivo nuevo: sumarlo a `FILES` y regenerar.
- Verificar un árbol: `python3 custom-src/upstream-overlay/overlay.py check <superset_dir>`
- Migrar a otra versión de Superset: el paso 19 va a fallar en cada archivo
  cuyo original cambió; portar el cambio, actualizar el árbol y regenerar con el
  tag nuevo.
