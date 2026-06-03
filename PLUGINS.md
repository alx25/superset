# Plugins personalizados irex — Guía para herramientas IA

Este documento describe la arquitectura de plugins custom de irex para Superset.
**Leerlo completo antes de modificar cualquier plugin o componente relacionado.**

---

## Repositorio de fuentes canónicas

Todos los cambios deben hacerse en estos directorios, **nunca dentro de `superset_v*/`**:

```
superset_proyecto/
├── custom-plugins/                      ← FUENTE de los 3 plugins
│   ├── plugin-chart-tableV3/
│   ├── plugin-chart-pivot-tableRx1/
│   └── plugin-chart-html-cards/
├── custom-src/                          ← FUENTE de controles y componentes React custom
│   ├── FormulaMetricControl/            (control de fórmulas del pivot-tableRx1)
│   ├── MetricOrderControl/              (control de orden de métricas del pivot-tableRx1)
│   └── ColumnConfigControl/             (5 archivos: Display name + pestaña HTML del tableV3)
├── migrate-plugins.sh                   ← script que aplica todo a un nuevo Superset
└── PLUGINS.md                           ← este archivo
```

Los directorios de `superset_v6_1_0/superset-frontend/plugins/plugin-chart-*` y
`superset_v6_1_0/superset-frontend/src/explore/components/controls/FormulaMetricControl/`
son **symlinks** que apuntan a las fuentes canónicas.
Editar en `custom-plugins/` o `custom-src/` se refleja inmediatamente, sin re-correr el script.

---

## Regla crítica: imports en archivos de custom-src/

Los archivos dentro de `custom-src/` se cargan mediante **symlinks** desde el árbol de Superset.
Webpack resuelve los imports relativos desde la ubicación **real** del archivo (en `custom-src/`),
no desde donde está el symlink. Esto rompe cualquier import relativo que asuma una posición
dentro del árbol de Superset.

**Regla: en archivos de `custom-src/`, NUNCA usar imports relativos `../` que dependan**
**de la ubicación del symlink. Usar siempre paths de módulo absolutos.**

| ❌ Incorrecto (relativo, se rompe con symlink) | ✅ Correcto (módulo absoluto) |
|-----------------------------------------------|-------------------------------|
| `import Foo from '../ControlPopover/ControlPopover'` | `import Foo from 'src/explore/components/controls/ControlPopover/ControlPopover'` |
| `import Bar from '../../utils/foo'` | `import Bar from 'src/utils/foo'` |

El prefijo `src/` funciona porque `superset-frontend/` está en el `resolve.modules` de webpack.
Los imports de paquetes (`@superset-ui/core`, etc.) no se ven afectados — solo los relativos `../`.

Esta regla **no aplica** a archivos dentro de `custom-plugins/` porque los plugins son directorios
completos con su propio árbol de imports autónomo.

### Por qué funciona: resolve.symlinks: false en webpack

El script de migración agrega `symlinks: false` al `resolve` de `webpack.config.js`. Esto indica a
webpack que resuelva rutas de módulos y loaders **desde la ubicación del symlink** (dentro de
`superset-frontend/`) y no desde la ruta real del archivo. Sin esto:
- El `babel-loader` (configurado con `include: APP_DIR`) no procesa archivos JSX fuera de `superset-frontend/`
- Los módulos npm (como `nanoid`) no se encuentran porque la búsqueda parte desde `custom-plugins/`

---

## Reglas para modificar plugins

### Al cambiar código de un plugin existente
1. Editar en `custom-plugins/<nombre-del-plugin>/src/`
2. Si el cambio agrega nuevas dependencias (`npm`), actualizar `custom-plugins/<plugin>/package.json`
3. El symlink propaga el cambio a todos los `superset_v*/` automáticamente
4. Rebuild: `cd superset_v6_1_0/superset-frontend && npm run build`

### Al cambiar FormulaMetricControl o MetricOrderControl
1. Editar en `custom-src/FormulaMetricControl/` o `custom-src/MetricOrderControl/`
2. El symlink propaga el cambio automáticamente
3. Rebuild del frontend

### Al cambiar ColumnConfigControl (Display name / pestaña HTML del tableV3)
Estos archivos son **copias** (no symlinks) porque solo se modifican 5 archivos de un directorio
de Superset que tiene muchos más. El workflow es:
1. Editar en `custom-src/ColumnConfigControl/`
2. Ejecutar el script para sincronizar:
   ```bash
   ./migrate-plugins.sh /ruta/superset_vX_Y_Z
   ```
   El script es idempotente — re-aplica solo lo que no esté ya aplicado.

### Al cambiar el estilo de las tarjetas (ListViewCard)
El archivo `ListViewCard/index.tsx` está personalizado para mostrar las tarjetas en
formato horizontal con thumbnail cuadrado a la izquierda (120×120 px):
1. Editar en `custom-src/ListViewCard/index.tsx`
2. El symlink propaga el cambio automáticamente a todos los `superset_v*/`
3. Rebuild del frontend

**Nota:** este archivo está en `packages/superset-ui-core/`, no en `src/`. Los imports
relativos (`../Skeleton`, `../Tooltip`, etc.) se resuelven desde la ubicación del symlink
dentro de `packages/`, lo cual es correcto.

### Al cambiar FavoritesBanner o DashboardTagSidebar (pantalla de dashboards)
Son archivos individuales con symlinks en `src/features/dashboards/`:
1. Editar en `custom-src/FavoritesBanner/FavoritesBanner.tsx` o `custom-src/DashboardTagSidebar/DashboardTagSidebar.tsx`
2. El symlink propaga el cambio automáticamente
3. Rebuild del frontend

**Regla de imports:** estos archivos usan `src/` como prefijo para imports absolutos
(ej. `import Tag from 'src/types/TagType'`). No usar imports relativos `../`.

### Al cambiar la integración de DashboardTagSidebar/FavoritesBanner en DashboardList
Los cambios de integración están en `custom-src/patch_dashboard_list.py`.
Este script parchea `src/pages/DashboardList/index.tsx` mediante reemplazos de texto.
Si en una versión nueva de Superset el archivo cambió demasiado, el script emite `[warn]`
y hay que actualizar los anchors del script manualmente.

---

## Agregar una nueva funcionalidad

Si la nueva feature requiere cambios que van **más allá del código del plugin** (nuevo tipo de
control, nuevo campo en el schema del backend, nueva constante VizType, etc.), hay que actualizar
`migrate-plugins.sh` para que el siguiente Superset también reciba ese cambio.

**Checklist cuando se agrega algo nuevo:**

| Tipo de cambio | Fuente canónica | Agregar a migrate-plugins.sh |
|---------------|----------------|------------------------------|
| Código del plugin (TypeScript) | `custom-plugins/<plugin>/src/` | No (symlink) |
| Nuevo control React custom | `custom-src/<ControlName>/` | Sí — paso 6 |
| Archivos de ColumnConfigControl | `custom-src/ColumnConfigControl/` | Sí — paso 7 |
| Nuevo VizType enum | `custom-src/ColumnConfigControl/` (se aplica por el script) | Sí — paso 3 |
| Nuevo campo en schema backend | `superset/charts/schemas.py` | Sí — paso 8a |
| Nueva lógica en query_context_processor | `superset/common/query_context_processor.py` | Sí — paso 8b |
| Nuevo viz_type en client_processing | `superset/charts/client_processing.py` | Sí — paso 8c |
| Registro de nuevo control en controls/index.ts | automático con symlink | Sí — paso 6 |
| FavoritesBanner (barra de favoritos) | `custom-src/FavoritesBanner/FavoritesBanner.tsx` | Sí — paso 10a |
| DashboardTagSidebar (filtro por tags) | `custom-src/DashboardTagSidebar/DashboardTagSidebar.tsx` | Sí — paso 10b |
| Integración en DashboardList/index.tsx | `custom-src/patch_dashboard_list.py` | Sí — paso 10c |
| ListViewCard (tarjetas horizontales) | `custom-src/ListViewCard/index.tsx` | Sí — paso 10d |

---

## Cómo migrar a una nueva versión de Superset

```bash
# 1. Descargar/extraer el nuevo Superset en superset_proyecto/
# 2. Ejecutar el script
./migrate-plugins.sh /home/imercados/superset_proyecto/superset_vX_Y_Z

# 3. Instalar dependencias y compilar
cd superset_vX_Y_Z/superset-frontend
npm install
npm run build

# 4. Reiniciar el backend
superset run -p 9050 -h 0.0.0.0 --with-threads --reload --debugger
```

El script avisa con `[warn]` cuando un parche no puede aplicarse automáticamente
(porque el código de Superset cambió demasiado). En ese caso revisar manualmente
comparando con la versión anterior.

---

## Los 3 plugins custom

### plugin-chart-tableV3
Tabla avanzada. Extiende el plugin oficial `plugin-chart-table` con:
- **Display name** por columna (campo `displayName` en ColumnConfigControl)
- **Pestaña HTML** por columna: `enableHtmlTemplate`, `htmlTemplate`, `htmlCss`
- Jinja fields / excluded_columns (requiere campos en backend schemas.py)

Backend afectado: `superset/charts/schemas.py`, `superset/common/query_context_processor.py`

### plugin-chart-pivot-tableRx1
Tabla pivote extendida. Extiende `plugin-chart-pivot-table` con:
- **Jinja fields**: métricas auxiliares ocultas usadas como variables en fórmulas
- **Formula metrics (Jinja-like)**: métricas calculadas en el frontend a partir de otras
- **Metric order**: reordenamiento drag-and-drop de métricas y fórmulas
- Sticky headers, tooltips de celda, compactRowTree

Backend afectado: `superset/charts/client_processing.py` (registro `pivot_table_rx1`),
`superset/common/query_context_factory.py`

### plugin-chart-html-cards
Visualización de tarjetas HTML con Handlebars.
- Requiere `HTML_SANITIZATION = False` en `superset/config.py`

---

## Archivos del backend modificados en superset_v6_1_0/

Estos archivos son editados **in-place** en el repo de Superset por el script.
Si hay duda de qué cambió, buscar los comentarios en el Registro de cambios.md.

| Archivo | Cambio |
|---------|--------|
| `superset/config.py` | `HTML_SANITIZATION = False` |
| `superset/charts/schemas.py` | 4 campos en `ChartDataExtrasSchema` |
| `superset/charts/client_processing.py` | `"pivot_table_rx1": pivot_table_v2` |
| `superset/common/query_context_processor.py` | helpers + `get_data` extendido |
| `superset/common/query_context_factory.py` | check de `pivot_table_rx1` |
