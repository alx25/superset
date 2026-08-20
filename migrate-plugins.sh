#!/usr/bin/env bash
# migrate-plugins.sh — aplica los plugins personalizados irex a un directorio de Superset.
#
# Uso:
#   ./migrate-plugins.sh /ruta/al/nuevo/superset_vX_Y_Z
#
# Fuentes canónicas (editar aquí, NO en el repo de Superset):
#   custom-plugins/   → código fuente de los 3 plugins
#   custom-src/       → componentes React y utilidades del frontend principal
#
# Lo que hace:
#   1.  Symlinks de los 3 plugins en superset-frontend/plugins/
#   1b. resolve.symlinks: false en webpack.config.js
#   2.  Entradas en package.json
#   3.  VizType enum en @superset-ui/core
#   3b. Re-exports de compatibilidad en @superset-ui/core/index.ts
#       (t, tn, addLocaleData, css, styled, useTheme, GenericDataType
#        se movieron a @apache-superset/core en v6.1.0+)
#   4.  setupPluginsExtra.ts con el registro de los 3 plugins
#   5.  Parches en src/ para PivotTableRx1 (4 archivos)
#   6.  Symlinks de FormulaMetricControl y MetricOrderControl
#       + registro en controls/index.ts
#   7.  Archivos de ColumnConfigControl (Display name + pestaña HTML del TableV3)
#   8.  Parches del backend Python:
#       8a. charts/schemas.py
#       8b. common/query_context_processor.py
#       8c. charts/client_processing.py
#       8d. common/query_context_factory.py
#   9.  HTML_SANITIZATION = False en superset/config.py
#  10.  Pantalla de dashboards:
#       10a. Symlink FavoritesBanner.tsx → src/features/dashboards/
#       10b. Symlink DashboardTagSidebar.tsx → src/features/dashboards/
#       10c. Patch DashboardList/index.tsx (barra de favoritos + filtro por tags)
#       10d. Symlink ListViewCard/index.tsx (tarjetas horizontales con thumbnail)
#       10e. Patch CardCollection.tsx (grid responsive, 5 tarjetas por fila en desktop)
#  11.  Login personalizado Irex (Custom Login Page):
#       11a. Copiar superset/security/password_reset.py
#       11b. Copiar templates: custom_login.html, novedades.html, password/{request,reset,email_reset}.html
#       11c. Copiar estáticos: CSS, JS (incluye lottie.min.js self-hosted para cumplir CSP),
#            imágenes (irex_ss.gif, business_presentation.json, novedades/*.gif,
#            superset-logo-horiz.png, subtitulos.vtt)
#            NOTA: Presentacion Superset.mp4 (90MB) debe copiarse manualmente
#       11d. Patch superset/config.py: inyectar CustomAuthDBView + CustomSecurityManager + CUSTOM_SECURITY_MANAGER
#  12.  Restaurar API de bookmarks eliminada en v6.1.0:
#       12a. Crear superset/dashboards/bookmarks/__init__.py, schemas.py, api.py
#       12b. Agregar DASHBOARD_BOOKMARK al enum KeyValueResource en key_value/types.py
#       12c. Registrar DashboardBookmarkRestApi en initialization/__init__.py
#  13.  Pestañas en barra de filtros del dashboard (Filtros / Marcadores):
#       13a. Symlink FilterBarTabs/ → src/dashboard/components/nativeFilters/FilterBar/
#       13b. Patch Vertical.tsx: import FilterBarTabs + reemplazar scroll div

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CUSTOM_PLUGINS="$SCRIPT_DIR/custom-plugins"
CUSTOM_SRC="$SCRIPT_DIR/custom-src"

# ── Validaciones ─────────────────────────────────────────────────────────────
if [[ $# -lt 1 ]]; then
  echo "Uso: $0 /ruta/al/nuevo/superset_vX_Y_Z"
  exit 1
fi

TARGET="$1"
FRONTEND="$TARGET/superset-frontend"

[[ -d "$FRONTEND" ]] || { echo "Error: no se encontró superset-frontend en '$TARGET'"; exit 1; }
[[ -d "$CUSTOM_PLUGINS" ]] || { echo "Error: directorio custom-plugins no encontrado"; exit 1; }
[[ -d "$CUSTOM_SRC" ]] || { echo "Error: directorio custom-src no encontrado"; exit 1; }

echo "=== Migrando plugins personalizados irex a: $TARGET ==="

# ── 1. Symlinks de plugins ───────────────────────────────────────────────────
echo "[1] Enlazando plugins..."
PLUGINS_DEST="$FRONTEND/plugins"
for plugin in plugin-chart-tableV3 plugin-chart-pivot-tableRx1 plugin-chart-html-cards; do
  [[ -d "$CUSTOM_PLUGINS/$plugin" ]] || { echo "  ERROR: $plugin no encontrado en custom-plugins/"; exit 1; }
  if [[ -L "$PLUGINS_DEST/$plugin" ]]; then
    echo "  [skip] $plugin ya es symlink"
  elif [[ -d "$PLUGINS_DEST/$plugin" ]]; then
    rm -rf "$PLUGINS_DEST/$plugin"
    ln -sfn "$CUSTOM_PLUGINS/$plugin" "$PLUGINS_DEST/$plugin"
    echo "  [ok] $plugin (convertido a symlink)"
  else
    ln -sfn "$CUSTOM_PLUGINS/$plugin" "$PLUGINS_DEST/$plugin"
    echo "  [ok] $plugin"
  fi
done

# ── 1b. resolve.symlinks: false en webpack.config.js ────────────────────────
# Sin esto webpack sigue los symlinks hasta custom-plugins/ (fuera de APP_DIR)
# y el babel-loader no procesa JSX ni se resuelven módulos correctamente.
echo "[1b] Parcheando webpack.config.js (resolve.symlinks: false)..."
WEBPACK_CFG="$FRONTEND/webpack.config.js"
if grep -q "symlinks: false" "$WEBPACK_CFG" 2>/dev/null; then
  echo "  [skip] ya configurado"
else
  python3 - "$WEBPACK_CFG" <<'PYEOF'
import sys
f = sys.argv[1]; c = open(f).read()
anchor = "  resolve: {"
insert = ("  resolve: {\n"
          "    // symlinks: false so symlinked custom-plugins/ and custom-src/ resolve\n"
          "    // relative to their symlink location (inside superset-frontend/), not\n"
          "    // their real path which would be outside APP_DIR.\n"
          "    symlinks: false,")
if "symlinks: false" not in c and anchor in c:
    open(f, 'w').write(c.replace(anchor, insert, 1))
    print("  [ok] webpack.config.js: symlinks: false")
else:
    print("  [warn] webpack.config.js: patrón no encontrado, agregar manualmente")
PYEOF
fi

# ── 2. package.json ──────────────────────────────────────────────────────────
echo "[2] Actualizando package.json..."
python3 - <<PYEOF
import json
f = '$FRONTEND/package.json'
pkg = json.load(open(f))
deps = pkg.get('dependencies', {})
custom_deps = {
    '@superset-ui/plugin-chart-html-cards':      'file:./plugins/plugin-chart-html-cards',
    '@superset-ui/plugin-chart-pivot-table-rx1': 'file:./plugins/plugin-chart-pivot-tableRx1',
    '@superset-ui/plugin-chart-table-v3':        'file:./plugins/plugin-chart-tableV3',
}
added = [k for k, v in custom_deps.items() if k not in deps and (deps.update({k: v}) or True)]
if added:
    pkg['dependencies'] = dict(sorted(deps.items()))
    with open(f, 'w') as out:
        json.dump(pkg, out, indent=2, ensure_ascii=False)
        out.write('\n')
    print('  [ok] ' + ', '.join(added))
else:
    print('  [skip] ya presentes')
PYEOF

# ── 3. VizType enum ──────────────────────────────────────────────────────────
echo "[3] Actualizando VizType.ts..."
VIZTYPE_FILE="$FRONTEND/packages/superset-ui-core/src/chart/types/VizType.ts"
[[ -f "$VIZTYPE_FILE" ]] || { echo "  ERROR: VizType.ts no encontrado"; exit 1; }
python3 - <<PYEOF
with open('$VIZTYPE_FILE') as f:
    content = f.read()
insertions = {
    "Handlebars = 'handlebars',":  "  HtmlCards = 'html_cards',",
    "PivotTable = 'pivot_table_v2',": "  PivotTableRx1 = 'pivot_table_rx1',",
    "TableAgGrid = 'ag-grid-table',":  "  TableV3 = 'table_v3',",
}
changed = []
for anchor, line in insertions.items():
    if line.strip() not in content:
        content = content.replace(anchor, anchor + '\n' + line, 1)
        changed.append(line.strip().split(' = ')[0].strip())
if changed:
    open('$VIZTYPE_FILE', 'w').write(content)
    print('  [ok] ' + ', '.join(changed))
else:
    print('  [skip] ya presentes')
PYEOF

# ── 3b. Re-exports de compatibilidad en @superset-ui/core ───────────────────
echo "[3b] Re-exports en @superset-ui/core/index.ts..."
CORE_INDEX="$FRONTEND/packages/superset-ui-core/src/index.ts"
if grep -q "@apache-superset/core/translation" "$CORE_INDEX" 2>/dev/null; then
  echo "  [skip] ya presentes"
else
  cat >> "$CORE_INDEX" <<'EOF'

// Re-exports for backwards compatibility with plugins that import from @superset-ui/core
export { t, tn, addLocaleData } from '@apache-superset/core/translation';
export { css, styled, useTheme } from '@apache-superset/core/theme';
export { GenericDataType } from '@apache-superset/core/common';
EOF
  echo "  [ok] t, tn, addLocaleData, css, styled, useTheme, GenericDataType"
fi

# ── 4. setupPluginsExtra.ts ──────────────────────────────────────────────────
echo "[4] Escribiendo setupPluginsExtra.ts..."
EXTRA_FILE="$FRONTEND/src/setup/setupPluginsExtra.ts"
if grep -q "plugin-chart-table-v3" "$EXTRA_FILE" 2>/dev/null; then
  echo "  [skip] ya personalizado"
else
  cat > "$EXTRA_FILE" <<'EOF'
/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { VizType } from '@superset-ui/core';
import TableV3ChartPlugin from '@superset-ui/plugin-chart-table-v3';
import { PivotTableChartPluginRx1 } from '@superset-ui/plugin-chart-pivot-table-rx1';
import { HtmlCardsChartPlugin } from '@superset-ui/plugin-chart-html-cards';

export default function setupPluginsExtra() {
  new TableV3ChartPlugin().configure({ key: VizType.TableV3 }).register();
  new PivotTableChartPluginRx1()
    .configure({ key: VizType.PivotTableRx1 })
    .register();
  new HtmlCardsChartPlugin().configure({ key: VizType.HtmlCards }).register();
}
EOF
  echo "  [ok]"
fi

# ── 5. Parches en src/ para PivotTableRx1 ───────────────────────────────────
echo "[5] Parcheando archivos src para PivotTableRx1..."

patch_file() {
  local file="$1" search="$2" replace="$3" label="$4"
  [[ -f "$file" ]] || { echo "  [warn] no encontrado: $file"; return; }
  if grep -qF "$replace" "$file"; then
    echo "  [skip] $label"
  elif grep -qF "$search" "$file"; then
    python3 - <<PYEOF
with open('$file') as f: c = f.read()
open('$file', 'w').write(c.replace('''$search''', '''$replace''', 1))
print('  [ok] $label')
PYEOF
  else
    echo "  [warn] $label: patrón no encontrado, revisar manualmente"
  fi
}

patch_file \
  "$FRONTEND/src/explore/components/useExploreAdditionalActionsMenu/index.tsx" \
  "const VIZ_TYPES_PIVOTABLE = [VizType.PivotTable];" \
  "const VIZ_TYPES_PIVOTABLE = [VizType.PivotTable, VizType.PivotTableRx1];" \
  "useExploreAdditionalActionsMenu"

patch_file \
  "$FRONTEND/src/dashboard/components/SliceHeaderControls/index.tsx" \
  "const isPivotTable = slice.viz_type === VizType.PivotTable;" \
  "const isPivotTable =
    slice.viz_type === VizType.PivotTable ||
    slice.viz_type === VizType.PivotTableRx1;" \
  "SliceHeaderControls"

patch_file \
  "$FRONTEND/src/features/reports/ReportModal/index.tsx" \
  "const TEXT_BASED_VISUALIZATION_TYPES = [
  VizType.PivotTable,
  'table',
  VizType.PairedTTest,
];" \
  "const TEXT_BASED_VISUALIZATION_TYPES = [
  VizType.PivotTable,
  VizType.PivotTableRx1,
  'table',
  VizType.PairedTTest,
];" \
  "ReportModal"

patch_file \
  "$FRONTEND/src/features/alerts/AlertReportModal.tsx" \
  "const TEXT_BASED_VISUALIZATION_TYPES = [
  VizType.PivotTable,
  'table',
  VizType.PairedTTest,
];" \
  "const TEXT_BASED_VISUALIZATION_TYPES = [
  VizType.PivotTable,
  VizType.PivotTableRx1,
  'table',
  VizType.PairedTTest,
];" \
  "AlertReportModal"

# ── 6. Symlinks de controles custom + registro ───────────────────────────────
echo "[6] Enlazando controles custom (FormulaMetricControl, MetricOrderControl)..."
CONTROLS_DEST="$FRONTEND/src/explore/components/controls"

for ctrl in FormulaMetricControl MetricOrderControl; do
  [[ -d "$CUSTOM_SRC/$ctrl" ]] || { echo "  ERROR: $ctrl no encontrado en custom-src/"; exit 1; }
  if [[ -L "$CONTROLS_DEST/$ctrl" ]]; then
    echo "  [skip] $ctrl ya es symlink"
  elif [[ -d "$CONTROLS_DEST/$ctrl" ]]; then
    rm -rf "$CONTROLS_DEST/$ctrl"
    ln -sfn "$CUSTOM_SRC/$ctrl" "$CONTROLS_DEST/$ctrl"
    echo "  [ok] $ctrl (convertido a symlink)"
  else
    ln -sfn "$CUSTOM_SRC/$ctrl" "$CONTROLS_DEST/$ctrl"
    echo "  [ok] $ctrl"
  fi
done

CONTROLS_INDEX="$CONTROLS_DEST/index.ts"
if grep -q "FormulaMetricControl" "$CONTROLS_INDEX" 2>/dev/null; then
  echo "  [skip] controls/index.ts ya registrado"
else
  python3 - "$CONTROLS_INDEX" <<'PYEOF'
import sys
f = sys.argv[1]
c = open(f).read()
c = c.replace(
    "import HiddenControl from './HiddenControl';",
    "import FormulaMetricControl from './FormulaMetricControl';\nimport HiddenControl from './HiddenControl';\nimport MetricOrderControl from './MetricOrderControl';",
    1
)
c = c.replace(
    "  ...sharedControlComponents,",
    "  FormulaMetricControl,\n  MetricOrderControl,\n  ...sharedControlComponents,",
    1
)
open(f, 'w').write(c)
print("  [ok] controls/index.ts actualizado")
PYEOF
fi

# ── 7. ColumnConfigControl (Display name + pestaña HTML del TableV3) ─────────
echo "[7] Copiando ColumnConfigControl personalizado..."
CC_SRC="$CUSTOM_SRC/ColumnConfigControl"
CC_DEST="$FRONTEND/src/explore/components/controls/ColumnConfigControl"

[[ -d "$CC_SRC" ]] || { echo "  ERROR: custom-src/ColumnConfigControl no encontrado"; exit 1; }

for file in "constants.tsx" "ColumnConfigPopover.tsx" "types.ts" \
            "ControlForm/controls.ts" "ControlForm/index.tsx"; do
  src="$CC_SRC/$file"
  dest="$CC_DEST/$file"
  [[ -f "$src" ]] || { echo "  [warn] no encontrado: $src"; continue; }
  cp "$src" "$dest" && echo "  [ok] $file"
done

# ── 8. Parches del backend Python ────────────────────────────────────────────
echo "[8] Parcheando backend Python..."

SCHEMAS_FILE="$TARGET/superset/charts/schemas.py"
QCP_FILE="$TARGET/superset/common/query_context_processor.py"
CLIENT_PROC="$TARGET/superset/charts/client_processing.py"
FACTORY="$TARGET/superset/common/query_context_factory.py"

# 8a. schemas.py
if grep -q "column_display_names" "$SCHEMAS_FILE" 2>/dev/null; then
  echo "  [skip] 8a schemas.py"
else
  python3 - "$SCHEMAS_FILE" <<'PYEOF'
import sys
f = sys.argv[1]
c = open(f).read()
fields = '''    column_display_names = fields.Dict(
        keys=fields.String(), values=fields.String(),
        metadata={"description": "Custom display names for columns in CSV/Excel exports."},
        allow_none=True,
    )
    excluded_columns = fields.List(
        fields.String(),
        metadata={"description": "Columns excluded from CSV/Excel exports (e.g. jinja fields)."},
        allow_none=True,
    )
    calculated_columns_export = fields.List(
        fields.Dict(keys=fields.String(), values=fields.Raw()),
        metadata={"description": "Calculated columns computed during CSV/Excel export."},
        allow_none=True,
    )
    column_export_order = fields.List(
        fields.String(),
        metadata={"description": "Preferred column order for CSV/Excel exports."},
        allow_none=True,
    )
'''
anchor = '\nclass AnnotationLayerSchema(Schema):'
if anchor in c:
    open(f, 'w').write(c.replace(anchor, '\n' + fields + anchor, 1))
    print('  [ok] 8a schemas.py')
else:
    print('  [warn] 8a schemas.py: punto de inserción no encontrado')
PYEOF
fi

# 8b. query_context_processor.py
if grep -q "_get_pivot_rx1_export_formulas" "$QCP_FILE" 2>/dev/null; then
  echo "  [skip] 8b query_context_processor.py"
else
  python3 "$SCRIPT_DIR/custom-src/patch_8b_qcp.py" "$QCP_FILE"
fi
# 8c. client_processing.py
if grep -q '"pivot_table_rx1": pivot_table_rx1' "$CLIENT_PROC" 2>/dev/null; then
  echo "  [skip] 8c client_processing.py"
else
  python3 "$SCRIPT_DIR/custom-src/patch_8c_client.py" "$CLIENT_PROC"
fi
# 8d. query_context_factory.py
if grep -q '"pivot_table_rx1"' "$FACTORY" 2>/dev/null; then
  echo "  [skip] 8d query_context_factory.py"
else
  python3 - "$FACTORY" <<'PYEOF'
import sys
f = sys.argv[1]; c = open(f).read()
old = 'if form_data.get("viz_type") != "pivot_table_v2":'
new = 'if form_data.get("viz_type") not in ("pivot_table_v2", "pivot_table_rx1"):'
if old in c:
    open(f, 'w').write(c.replace(old, new, 1))
    print('  [ok] 8d query_context_factory.py')
else:
    print('  [warn] 8d query_context_factory.py: patrón no encontrado')
PYEOF
fi

# ── 9. HTML_SANITIZATION = False ─────────────────────────────────────────────
echo "[9] Verificando HTML_SANITIZATION en config.py..."
CONFIG_FILE="$TARGET/superset/config.py"
if grep -q "^HTML_SANITIZATION = False" "$CONFIG_FILE" 2>/dev/null; then
  echo "  [skip] ya está en False"
elif grep -q "^HTML_SANITIZATION" "$CONFIG_FILE" 2>/dev/null; then
  python3 - "$CONFIG_FILE" <<'PYEOF'
import sys, re
f = sys.argv[1]; c = open(f).read()
c = re.sub(r'^HTML_SANITIZATION\s*=.*$', 'HTML_SANITIZATION = False', c, flags=re.MULTILINE)
open(f, 'w').write(c)
print('  [ok] HTML_SANITIZATION = False')
PYEOF
else
  echo "HTML_SANITIZATION = False" >> "$CONFIG_FILE"
  echo "  [ok] HTML_SANITIZATION = False (agregado al final)"
fi

# ── 10. Pantalla de dashboards: FavoritesBanner, DashboardTagSidebar ─────────
echo "[10] Pantalla de dashboards: barra de favoritos y filtro por categorías..."
FEATURES_DASHBOARDS="$FRONTEND/src/features/dashboards"

# 10a. Symlink FavoritesBanner.tsx
FB_SRC="$CUSTOM_SRC/FavoritesBanner/FavoritesBanner.tsx"
FB_DEST="$FEATURES_DASHBOARDS/FavoritesBanner.tsx"
[[ -f "$FB_SRC" ]] || { echo "  ERROR: FavoritesBanner.tsx no encontrado en custom-src/"; exit 1; }
if [[ -L "$FB_DEST" ]]; then
  echo "  [skip] FavoritesBanner.tsx ya es symlink"
elif [[ -f "$FB_DEST" ]]; then
  echo "  [warn] FavoritesBanner.tsx ya existe (no es symlink), verificar manualmente"
else
  ln -sfn "$FB_SRC" "$FB_DEST"
  echo "  [ok] FavoritesBanner.tsx"
fi

# 10b. Symlink DashboardTagSidebar.tsx
TSB_SRC="$CUSTOM_SRC/DashboardTagSidebar/DashboardTagSidebar.tsx"
TSB_DEST="$FEATURES_DASHBOARDS/DashboardTagSidebar.tsx"
[[ -f "$TSB_SRC" ]] || { echo "  ERROR: DashboardTagSidebar.tsx no encontrado en custom-src/"; exit 1; }
if [[ -L "$TSB_DEST" ]]; then
  echo "  [skip] DashboardTagSidebar.tsx ya es symlink"
elif [[ -f "$TSB_DEST" ]]; then
  echo "  [warn] DashboardTagSidebar.tsx ya existe (no es symlink), verificar manualmente"
else
  ln -sfn "$TSB_SRC" "$TSB_DEST"
  echo "  [ok] DashboardTagSidebar.tsx"
fi

# 10c. Patch DashboardList/index.tsx
DL_FILE="$FRONTEND/src/pages/DashboardList/index.tsx"
[[ -f "$DL_FILE" ]] || { echo "  [warn] DashboardList/index.tsx no encontrado"; }
[[ -f "$DL_FILE" ]] && python3 "$SCRIPT_DIR/custom-src/patch_dashboard_list.py" "$DL_FILE"

# 10d. Symlink ListViewCard/index.tsx (tarjetas horizontales)
LVC_SRC="$CUSTOM_SRC/ListViewCard/index.tsx"
LVC_DEST="$FRONTEND/packages/superset-ui-core/src/components/ListViewCard/index.tsx"
[[ -f "$LVC_SRC" ]] || { echo "  ERROR: ListViewCard/index.tsx no encontrado en custom-src/"; exit 1; }
if [[ -L "$LVC_DEST" ]]; then
  echo "  [skip] ListViewCard/index.tsx ya es symlink"
elif [[ -f "$LVC_DEST" ]]; then
  ln -sfn "$LVC_SRC" "$LVC_DEST"
  echo "  [ok] ListViewCard/index.tsx (reemplazado con symlink)"
else
  echo "  [warn] ListViewCard/index.tsx no encontrado en destino"
fi

# 10e. Patch CardCollection.tsx (grid responsive, 5 columnas en desktop)
CC_FILE="$FRONTEND/src/components/ListView/CardCollection.tsx"
if grep -q "minmax(340px, 1fr)" "$CC_FILE" 2>/dev/null; then
  echo "  [skip] CardCollection.tsx ya parcheado"
elif [[ -f "$CC_FILE" ]]; then
  python3 - "$CC_FILE" <<'PYEOF'
import sys
f = sys.argv[1]
with open(f) as fh:
    c = fh.read()

OLD = (
    "    grid-gap: ${theme.sizeUnit * 12}px ${theme.sizeUnit * 4}px;\n"
    "    grid-template-columns: repeat(auto-fit, 300px);\n"
    "    margin-top: ${theme.sizeUnit * -6}px;\n"
    "    padding: ${\n"
    "      showThumbnails\n"
    "        ? `${theme.sizeUnit * 8 + 3}px ${theme.sizeUnit * 20}px`\n"
    "        : `${theme.sizeUnit * 8 + 1}px ${theme.sizeUnit * 20}px`\n"
    "    };"
)
NEW = (
    "    grid-gap: ${theme.sizeUnit * 4}px ${theme.sizeUnit * 3}px;\n"
    "    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));\n"
    "    margin-top: ${theme.sizeUnit * 2}px;\n"
    "    padding: ${\n"
    "      showThumbnails\n"
    "        ? `${theme.sizeUnit * 4}px ${theme.sizeUnit * 4}px`\n"
    "        : `${theme.sizeUnit * 4}px ${theme.sizeUnit * 4}px`\n"
    "    };\n"
    "\n"
    "    @media (max-width: 1800px) {\n"
    "      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));\n"
    "    }\n"
    "\n"
    "    @media (max-width: 1400px) {\n"
    "      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));\n"
    "    }\n"
    "\n"
    "    @media (max-width: 1200px) {\n"
    "      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));\n"
    "      grid-gap: ${theme.sizeUnit * 3}px ${theme.sizeUnit * 2}px;\n"
    "      padding: ${\n"
    "        showThumbnails\n"
    "          ? `${theme.sizeUnit * 3}px ${theme.sizeUnit * 3}px`\n"
    "          : `${theme.sizeUnit * 3}px ${theme.sizeUnit * 3}px`\n"
    "      };\n"
    "    }"
)

if OLD in c:
    with open(f, 'w') as fh:
        fh.write(c.replace(OLD, NEW, 1))
    print('  [ok] CardCollection.tsx: grid responsive (5 tarjetas/fila en desktop)')
else:
    print('  [warn] CardCollection.tsx: patrón no encontrado, verificar manualmente')
PYEOF
else
  echo "  [warn] CardCollection.tsx no encontrado"
fi

# ── 11. Login personalizado Irex ─────────────────────────────────────────────
echo "[11] Login personalizado Irex..."

BACKEND="$TARGET/superset"
TEMPLATES="$BACKEND/templates/appbuilder"
STATIC="$BACKEND/static"
SECURITY_SRC="$SCRIPT_DIR/custom-src/login"

# 11a. password_reset.py
PR_SRC="$SECURITY_SRC/password_reset.py"
PR_DEST="$BACKEND/security/password_reset.py"
if [[ ! -f "$PR_SRC" ]]; then
  echo "  ERROR: custom-src/login/password_reset.py no encontrado"; exit 1
fi
if [[ -f "$PR_DEST" ]] && cmp -s "$PR_SRC" "$PR_DEST"; then
  echo "  [skip] password_reset.py ya está actualizado"
else
  cp "$PR_SRC" "$PR_DEST"
  echo "  [ok] superset/security/password_reset.py"
fi

# 11b. Templates
mkdir -p "$TEMPLATES/password" "$TEMPLATES/general/model"
for tpl in custom_login.html novedades.html; do
  SRC="$SECURITY_SRC/templates/$tpl"
  DEST="$TEMPLATES/$tpl"
  if [[ ! -f "$SRC" ]]; then
    echo "  ERROR: custom-src/login/templates/$tpl no encontrado"; exit 1
  fi
  if [[ -f "$DEST" ]] && cmp -s "$SRC" "$DEST"; then
    echo "  [skip] $tpl ya está actualizado"
  else
    cp "$SRC" "$DEST"
    echo "  [ok] templates/appbuilder/$tpl"
  fi
done
for tpl in request.html reset.html email_reset.html; do
  SRC="$SECURITY_SRC/templates/password/$tpl"
  DEST="$TEMPLATES/password/$tpl"
  if [[ ! -f "$SRC" ]]; then
    echo "  ERROR: custom-src/login/templates/password/$tpl no encontrado"; exit 1
  fi
  if [[ -f "$DEST" ]] && cmp -s "$SRC" "$DEST"; then
    echo "  [skip] password/$tpl ya está actualizado"
  else
    cp "$SRC" "$DEST"
    echo "  [ok] templates/appbuilder/password/$tpl"
  fi
done
SRC="$SECURITY_SRC/templates/general/model/message.html"
DEST="$TEMPLATES/general/model/message.html"
if [[ ! -f "$SRC" ]]; then
  echo "  ERROR: custom-src/login/templates/general/model/message.html no encontrado"; exit 1
fi
if [[ -f "$DEST" ]] && cmp -s "$SRC" "$DEST"; then
  echo "  [skip] general/model/message.html ya está actualizado"
else
  cp "$SRC" "$DEST"
  echo "  [ok] templates/appbuilder/general/model/message.html"
fi

# 11c. Archivos estáticos: CSS, JS, imágenes y animaciones
mkdir -p "$STATIC/customcss" "$STATIC/js_personal" \
         "$STATIC/assets/images/novedades" "$STATIC/video_superset"

for css_file in custom_login.css password_flow.css; do
  SRC="$SECURITY_SRC/static/customcss/$css_file"
  DEST="$STATIC/customcss/$css_file"
  if [[ ! -f "$SRC" ]]; then
    echo "  ERROR: custom-src/login/static/customcss/$css_file no encontrado"; exit 1
  fi
  if [[ -f "$DEST" ]] && cmp -s "$SRC" "$DEST"; then
    echo "  [skip] $css_file ya está actualizado"
  else
    cp "$SRC" "$DEST"
    echo "  [ok] static/customcss/$css_file"
  fi
done

for js_file in lottie.min.js custom_login.js password_reset.js; do
  SRC="$SECURITY_SRC/static/js_personal/$js_file"
  DEST="$STATIC/js_personal/$js_file"
  if [[ ! -f "$SRC" ]]; then
    echo "  ERROR: custom-src/login/static/js_personal/$js_file no encontrado"; exit 1
  fi
  if [[ -f "$DEST" ]] && cmp -s "$SRC" "$DEST"; then
    echo "  [skip] $js_file ya está actualizado"
  else
    cp "$SRC" "$DEST"
    echo "  [ok] static/js_personal/$js_file"
  fi
done

# Imágenes y animaciones (irex_ss.gif, business_presentation.json, novedades/*.gif)
for img_file in irex_ss.gif business_presentation.json superset-logo-horiz.png favicon.png; do
  SRC="$SECURITY_SRC/static/assets/images/$img_file"
  DEST="$STATIC/assets/images/$img_file"
  if [[ ! -f "$SRC" ]]; then
    echo "  [warn] $img_file no encontrado en custom-src/login/static/assets/images/"
    continue
  fi
  if [[ -f "$DEST" ]] && cmp -s "$SRC" "$DEST"; then
    echo "  [skip] $img_file ya está actualizado"
  else
    cp "$SRC" "$DEST"
    echo "  [ok] static/assets/images/$img_file"
  fi
done

for nov_file in tema_oscuro.gif favoritos.gif; do
  SRC="$SECURITY_SRC/static/assets/images/novedades/$nov_file"
  DEST="$STATIC/assets/images/novedades/$nov_file"
  if [[ ! -f "$SRC" ]]; then
    echo "  [warn] novedades/$nov_file no encontrado en custom-src/login/"
    continue
  fi
  if [[ -f "$DEST" ]] && cmp -s "$SRC" "$DEST"; then
    echo "  [skip] novedades/$nov_file ya está actualizado"
  else
    cp "$SRC" "$DEST"
    echo "  [ok] static/assets/images/novedades/$nov_file"
  fi
done

# VTT de subtítulos (el .mp4 es demasiado grande para custom-src; copiar manualmente)
SRC="$SECURITY_SRC/static/video_superset/subtitulos.vtt"
DEST="$STATIC/video_superset/subtitulos.vtt"
if [[ -f "$SRC" ]]; then
  if [[ -f "$DEST" ]] && cmp -s "$SRC" "$DEST"; then
    echo "  [skip] subtitulos.vtt ya está actualizado"
  else
    cp "$SRC" "$DEST"
    echo "  [ok] static/video_superset/subtitulos.vtt"
  fi
fi
if [[ ! -f "$STATIC/video_superset/Presentacion Superset.mp4" ]]; then
  echo "  [warn] video_superset/Presentacion Superset.mp4 no encontrado."
  echo "         Copiar manualmente desde superset_v6/superset/static/video_superset/"
fi

# 11d. Patch config.py: inyectar CustomSecurityManager
CONFIG_FILE="$BACKEND/config.py"
if grep -q "CustomSecurityManager" "$CONFIG_FILE" 2>/dev/null; then
  echo "  [skip] config.py ya tiene CustomSecurityManager"
else
  python3 - "$CONFIG_FILE" <<'PYEOF'
import sys, re

f = sys.argv[1]
with open(f) as fh:
    c = fh.read()

INJECTION = '''
# =============================================================================
# Custom Login Page Configuration (Irex)
# =============================================================================
from flask import flash, g, redirect, request
from flask_appbuilder import expose
from flask_appbuilder.security.forms import LoginForm_db
from flask_appbuilder.security.views import AuthDBView
from flask_appbuilder.utils.base import get_safe_redirect
from flask_babel import lazy_gettext as _
from flask_login import login_user

from superset.security.password_reset import PasswordResetSecurityManager


class CustomAuthDBView(AuthDBView):
    """Custom login view using server-side Jinja template."""

    @expose("/login/", methods=["GET", "POST"])
    def login(self):
        if g.user is not None and g.user.is_authenticated:
            return redirect(self.appbuilder.get_url_for_index)

        form = LoginForm_db()
        next_url = get_safe_redirect(
            request.args.get("next", "") or request.form.get("next", "")
        )
        if form.validate_on_submit():
            user = self.appbuilder.sm.auth_user_db(
                form.username.data, form.password.data
            )
            if user:
                login_user(user, remember=False)
                return redirect(next_url)
            flash(_("Usuario o contraseña incorrectos."), "danger")
            return redirect(self.appbuilder.get_url_for_login_with(next_url))
        return self.render_template(
            "appbuilder/custom_login.html", title=_("Iniciar Sesión"), form=form
        )


class CustomSecurityManager(PasswordResetSecurityManager):
    """Custom security manager with password reset functionality."""

    authdbview = CustomAuthDBView

    def register_views(self) -> None:  # type: ignore[override]
        """Register security views without React SPA login (/login).

        Superset 6 registers `SupersetAuthView` (SPA) on `/login/`. To force
        custom server-side login (Jinja) with `AuthDBView`, we use the base
        FAB view registration and then add password reset flow, plus cleanup
        of duplicate views.
        """
        from superset.security.manager import SupersetSecurityManager

        # Skip SupersetSecurityManager.register_views (registers SupersetAuthView)
        # Call grandparent\'s register_views to register FAB views
        super(SupersetSecurityManager, self).register_views()

        # Register password reset view
        view = self.password_reset_view_class()
        self.password_reset_view = self.appbuilder.add_view_no_menu(view)

        # Remove duplicate views that have /list/ routes (FAB old-style)
        # Keep only the new-style routes (/users/, /roles/, /groups/)
        for view in list(self.appbuilder.baseviews):
            if isinstance(view, self.rolemodelview.__class__) and getattr(
                view, "route_base", None
            ) in ["/roles", "/users", "/groups", "/registrations"]:
                self.appbuilder.baseviews.remove(view)

        # Remove duplicate menu items from Security menu
        security_menu = next(
            (m for m in self.appbuilder.menu.get_list() if m.name == "Security"), None
        )
        if security_menu:
            for item in list(security_menu.childs):
                if item.name in [
                    "List Roles",
                    "List Users",
                    "List Groups",
                    "User Registrations",
                ]:
                    security_menu.childs.remove(item)


CUSTOM_SECURITY_MANAGER = CustomSecurityManager
# =============================================================================
'''

# Replace bare CUSTOM_SECURITY_MANAGER = None with full block
c = re.sub(
    r'^CUSTOM_SECURITY_MANAGER\s*=\s*None\s*$',
    INJECTION.strip(),
    c,
    flags=re.MULTILINE
)

with open(f, 'w') as fh:
    fh.write(c)
print('  [ok] config.py: CustomSecurityManager inyectado')
PYEOF
fi

# ── 12. Restaurar API de bookmarks (eliminada en v6.1.0) ─────────────────────
echo "[12] Restaurando API de bookmarks de dashboard..."
BOOKMARKS_SRC="$SCRIPT_DIR/custom-src/bookmarks"
BOOKMARKS_DIR="$TARGET/superset/dashboards/bookmarks"

[[ -d "$BOOKMARKS_SRC" ]] || { echo "  ERROR: custom-src/bookmarks no encontrado"; exit 1; }
mkdir -p "$BOOKMARKS_DIR"

# 12a. Copiar archivos del módulo desde custom-src/bookmarks/
for bk_file in __init__.py schemas.py api.py; do
  SRC="$BOOKMARKS_SRC/$bk_file"
  DEST="$BOOKMARKS_DIR/$bk_file"
  [[ -f "$SRC" ]] || { echo "  ERROR: custom-src/bookmarks/$bk_file no encontrado"; exit 1; }
  if [[ -f "$DEST" ]] && cmp -s "$SRC" "$DEST"; then
    echo "  [skip] bookmarks/$bk_file ya está actualizado"
  else
    cp "$SRC" "$DEST"
    echo "  [ok] bookmarks/$bk_file"
  fi
done

# 12b. Agregar DASHBOARD_BOOKMARK al enum KeyValueResource
KV_TYPES="$TARGET/superset/key_value/types.py"
if grep -q "DASHBOARD_BOOKMARK" "$KV_TYPES" 2>/dev/null; then
  echo "  [skip] 12b DASHBOARD_BOOKMARK ya en KeyValueResource"
else
  python3 - "$KV_TYPES" <<'PYEOF'
import sys
f = sys.argv[1]
c = open(f).read()
old = "class KeyValueResource(StrEnum):\n    APP = \"app\"\n    DASHBOARD_PERMALINK"
new = "class KeyValueResource(StrEnum):\n    APP = \"app\"\n    DASHBOARD_BOOKMARK = \"dashboard_bookmark\"\n    DASHBOARD_PERMALINK"
if old in c:
    open(f, 'w').write(c.replace(old, new, 1))
    print("  [ok] 12b DASHBOARD_BOOKMARK agregado a KeyValueResource")
else:
    print("  [warn] 12b key_value/types.py: patrón no encontrado, agregar manualmente")
PYEOF
fi

# 12c. Registrar DashboardBookmarkRestApi en initialization/__init__.py
INIT_FILE="$TARGET/superset/initialization/__init__.py"
if grep -q "DashboardBookmarkRestApi" "$INIT_FILE" 2>/dev/null; then
  echo "  [skip] 12c DashboardBookmarkRestApi ya registrado"
else
  python3 - "$INIT_FILE" <<'PYEOF'
import sys
f = sys.argv[1]
c = open(f).read()
# Agregar import
old_import = "        from superset.dashboards.api import DashboardRestApi\n        from superset.dashboards.filter_state.api import DashboardFilterStateRestApi"
new_import = "        from superset.dashboards.api import DashboardRestApi\n        from superset.dashboards.bookmarks.api import DashboardBookmarkRestApi\n        from superset.dashboards.filter_state.api import DashboardFilterStateRestApi"
# Agregar registro add_api
old_api = "        appbuilder.add_api(DashboardFilterStateRestApi)"
new_api = "        appbuilder.add_api(DashboardBookmarkRestApi)\n        appbuilder.add_api(DashboardFilterStateRestApi)"
if old_import in c and old_api in c:
    c = c.replace(old_import, new_import, 1).replace(old_api, new_api, 1)
    open(f, 'w').write(c)
    print("  [ok] 12c DashboardBookmarkRestApi registrado en initialization/__init__.py")
else:
    print("  [warn] 12c initialization/__init__.py: patrones no encontrados, agregar manualmente")
PYEOF
fi

# ── 13. Pestañas en barra de filtros (Filtros / Marcadores) ──────────────────
echo "[13] Pestañas Filtros/Marcadores en barra de filtros..."
FILTERBAR_DIR="$FRONTEND/src/dashboard/components/nativeFilters/FilterBar"
FILTERBAR_TABS_SRC="$CUSTOM_SRC/FilterBarTabs"
FILTERBAR_TABS_DEST="$FILTERBAR_DIR/FilterBarTabs"
VERTICAL_FILE="$FILTERBAR_DIR/Vertical.tsx"

[[ -d "$FILTERBAR_TABS_SRC" ]] || { echo "  ERROR: custom-src/FilterBarTabs no encontrado"; exit 1; }
[[ -f "$VERTICAL_FILE" ]] || { echo "  ERROR: FilterBar/Vertical.tsx no encontrado"; exit 1; }

# 13a. Symlink FilterBarTabs/
if [[ -L "$FILTERBAR_TABS_DEST" ]]; then
  echo "  [skip] FilterBarTabs ya es symlink"
elif [[ -d "$FILTERBAR_TABS_DEST" ]]; then
  rm -rf "$FILTERBAR_TABS_DEST"
  ln -sfn "$FILTERBAR_TABS_SRC" "$FILTERBAR_TABS_DEST"
  echo "  [ok] FilterBarTabs (convertido a symlink)"
else
  ln -sfn "$FILTERBAR_TABS_SRC" "$FILTERBAR_TABS_DEST"
  echo "  [ok] FilterBarTabs"
fi

# 13b. Patch Vertical.tsx: import + reemplazar scroll div
if grep -q "FilterBarTabs" "$VERTICAL_FILE" 2>/dev/null; then
  echo "  [skip] 13b Vertical.tsx ya parcheado"
else
  python3 - "$VERTICAL_FILE" <<'PYEOF'
import sys
f = sys.argv[1]
c = open(f).read()

old_import = "import crossFiltersSelector from './CrossFilters/selectors';"
new_import = (
    "import crossFiltersSelector from './CrossFilters/selectors';\n"
    "import FilterBarTabs from './FilterBarTabs/FilterBarTabs';"
)

old_content = (
    "          ) : (\n"
    "            <div css={tabPaneStyle} onScroll={onScroll}>\n"
    "              <>\n"
    "                <CrossFiltersVertical hideHeader={hasOnlyOneSectionType} />\n"
    "                {filterControls}\n"
    "              </>\n"
    "            </div>\n"
    "          )}"
)
new_content = (
    "          ) : (\n"
    "            <FilterBarTabs height={height} onScroll={onScroll}>\n"
    "              <CrossFiltersVertical hideHeader={hasOnlyOneSectionType} />\n"
    "              {filterControls}\n"
    "            </FilterBarTabs>\n"
    "          )}"
)

if old_import in c and old_content in c:
    c = c.replace(old_import, new_import, 1).replace(old_content, new_content, 1)
    open(f, 'w').write(c)
    print("  [ok] 13b Vertical.tsx parcheado")
else:
    print("  [warn] 13b Vertical.tsx: patrones no encontrados, verificar manualmente")
PYEOF
fi

echo "[14] MCP: campo 'description' en filtros nativos de get_dashboard_info..."
MCP_DASHBOARD_SCHEMAS="$TARGET/superset/mcp_service/dashboard/schemas.py"

if [[ ! -f "$MCP_DASHBOARD_SCHEMAS" ]]; then
  echo "  [warn] 14 no encontrado: $MCP_DASHBOARD_SCHEMAS (¿esta versión no tiene MCP service?)"
elif grep -q 'description=f.get("description")' "$MCP_DASHBOARD_SCHEMAS" 2>/dev/null; then
  echo "  [skip] 14 ya parcheado"
else
  python3 - "$MCP_DASHBOARD_SCHEMAS" <<'PYEOF'
import sys
f = sys.argv[1]
c = open(f).read()

old_field = '''    id: str | None = Field(None, description="Filter ID")
    name: str | None = Field(None, description="Filter display name")
    filter_type: str | None = Field('''
new_field = '''    id: str | None = Field(None, description="Filter ID")
    name: str | None = Field(None, description="Filter display name")
    description: str | None = Field(
        None,
        description=(
            "Descripción configurada por el creador del filtro (ej. "
            "explicación de códigos de valores como 'Cjs=Cajas, Col=Colones'). "
            "None si el filtro no tiene descripción configurada."
        ),
    )
    filter_type: str | None = Field('''

old_construct = '''        summaries.append(
            NativeFilterSummary(
                id=f.get("id"),
                name=f.get("name"),
                filter_type=f.get("filterType"),
                targets=targets,
                default_value=default_value,
            )
        )'''
new_construct = '''        summaries.append(
            NativeFilterSummary(
                id=f.get("id"),
                name=f.get("name"),
                description=f.get("description"),
                filter_type=f.get("filterType"),
                targets=targets,
                default_value=default_value,
            )
        )'''

if old_field in c and old_construct in c:
    c = c.replace(old_field, new_field, 1).replace(old_construct, new_construct, 1)
    open(f, 'w').write(c)
    print("  [ok] 14 schemas.py (dashboard) parcheado")
else:
    print("  [warn] 14 schemas.py: patrones no encontrados, verificar manualmente")
PYEOF
fi

# ── 15. exploreReducer.ts: sincronizar calculated_columns con column_config/column_order ──
echo "[15] Parcheando exploreReducer.ts (sync de Calculated columns al renombrar)..."
EXPLORE_REDUCER="$FRONTEND/src/explore/reducers/exploreReducer.ts"

if [[ ! -f "$EXPLORE_REDUCER" ]]; then
  echo "  [warn] 15 no encontrado: $EXPLORE_REDUCER"
elif grep -q "old_calculated_columns_data" "$EXPLORE_REDUCER" 2>/dev/null; then
  echo "  [skip] 15 ya parcheado"
else
  python3 - "$EXPLORE_REDUCER" <<'PYEOF'
import sys
f = sys.argv[1]
c = open(f).read()

old_interface = '''interface MetricItem {
  label?: string;
}'''
new_interface = '''interface MetricItem {
  label?: string;
}

interface CalculatedColumnItem {
  key?: string;
  label?: string;
}'''

old_sync_anchor = '''        new_form_data.column_config = new_column_config;
      }

      // Use the processed control config (with overrides and everything)
      // if `controlName` does not exist in current controls,'''
new_sync_block = '''        new_form_data.column_config = new_column_config;
      }

      // if the controlName is calculated_columns, and a column's label was
      // renamed, need to update column_config and column_order as well so
      // the renamed calculated column keeps its previous config/position
      // instead of losing them (they're keyed by label, not by the stable
      // item key).
      const old_calculated_columns_data = (
        state.form_data as { calculated_columns?: CalculatedColumnItem[] }
      ).calculated_columns;
      let new_column_order: string[] | undefined;
      if (
        controlName === 'calculated_columns' &&
        Array.isArray(old_calculated_columns_data) &&
        new_column_config
      ) {
        const oldCalculatedColumnsByKey = new Map(
          old_calculated_columns_data.map(item => [
            item?.key ?? item?.label,
            item,
          ]),
        );
        new_column_order = Array.isArray(
          (state.form_data as { column_order?: string[] }).column_order,
        )
          ? [...(state.form_data as { column_order?: string[] }).column_order!]
          : undefined;

        (value as CalculatedColumnItem[]).forEach(item => {
          const stableKey = item?.key ?? item?.label;
          const oldItem = oldCalculatedColumnsByKey.get(stableKey);
          const oldLabel = oldItem?.label;
          const newLabel = item?.label;

          if (
            oldLabel &&
            newLabel &&
            oldLabel !== newLabel &&
            new_column_config![oldLabel]
          ) {
            new_column_config![newLabel] = new_column_config![oldLabel];
            delete new_column_config![oldLabel];
          }

          if (
            oldLabel &&
            newLabel &&
            oldLabel !== newLabel &&
            new_column_order
          ) {
            new_column_order = new_column_order.map(column =>
              column === oldLabel ? newLabel : column,
            );
          }
        });

        new_form_data.column_config = new_column_config;
        if (new_column_order) {
          new_form_data.column_order = [...new Set(new_column_order)];
        }
      }

      // Use the processed control config (with overrides and everything)
      // if `controlName` does not exist in current controls,'''

old_newstate = '''      const newState = {
        ...state,
        controls: {
          ...state.controls,
          ...(controlConfig && { [controlName]: control }),
          ...(controlName === 'metrics' && { column_config }),
        },
      };

      const rerenderedControls: Record<string, ExtendedControlState> = {};
      if (Array.isArray(control.rerender)) {
        control.rerender.forEach((rerenderControlName: string) => {
          const rerenderControl = (
            newState.controls as Record<string, ControlState>
          )[rerenderControlName];
          rerenderedControls[rerenderControlName] = {
            ...getControlStateFromControlConfig(
              rerenderControl as Parameters<
                typeof getControlStateFromControlConfig
              >[0],
              newState as Parameters<
                typeof getControlStateFromControlConfig
              >[1],
              rerenderControl?.value,
            ),
          } as ExtendedControlState;
        });
      }'''
new_newstate = '''      const newState = {
        ...state,
        controls: {
          ...state.controls,
          ...(controlConfig && { [controlName]: control }),
          ...(['metrics', 'calculated_columns'].includes(controlName) && {
            column_config,
          }),
        },
      };

      // column_order is rebuilt in-place above (renamed labels) rather than
      // through the normal control revalidation flow, so the rerender step
      // must use the corrected value instead of the stale one already in
      // `newState.controls.column_order.value`.
      const rerenderedValueOverrides: Record<string, unknown> = {};
      if (controlName === 'calculated_columns' && new_column_order) {
        rerenderedValueOverrides.column_order = new_form_data.column_order;
      }

      const rerenderedControls: Record<string, ExtendedControlState> = {};
      if (Array.isArray(control.rerender)) {
        control.rerender.forEach((rerenderControlName: string) => {
          const rerenderControl = (
            newState.controls as Record<string, ControlState>
          )[rerenderControlName];
          rerenderedControls[rerenderControlName] = {
            ...getControlStateFromControlConfig(
              rerenderControl as Parameters<
                typeof getControlStateFromControlConfig
              >[0],
              newState as Parameters<
                typeof getControlStateFromControlConfig
              >[1],
              rerenderedValueOverrides[rerenderControlName] ??
                rerenderControl?.value,
            ),
          } as ExtendedControlState;
        });
      }'''

if old_interface in c and old_sync_anchor in c and old_newstate in c:
    c = c.replace(old_interface, new_interface, 1)
    c = c.replace(old_sync_anchor, new_sync_block, 1)
    c = c.replace(old_newstate, new_newstate, 1)
    open(f, 'w').write(c)
    print("  [ok] 15 exploreReducer.ts parcheado")
else:
    print("  [warn] 15 exploreReducer.ts: patrones no encontrados, verificar manualmente")
PYEOF
fi

echo ""
echo "=== Migración completada ==="
echo ""
echo "Próximos pasos:"
echo "  cd $FRONTEND"
echo "  npm install"
echo "  npm run build   (o para debug: npm run dev-server)"
echo ""
echo "  Backend: reiniciar Superset para aplicar cambios Python"
echo "  Debug:   superset run -p 9050 -h 0.0.0.0 --with-threads --reload --debugger"
