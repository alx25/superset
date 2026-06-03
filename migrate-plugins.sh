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
