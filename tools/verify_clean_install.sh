#!/usr/bin/env bash
# Prueba de punta a punta: exporta el tag oficial de Superset a un directorio
# temporal, le corre migrate-plugins.sh y compara el resultado contra el árbol
# de referencia (superset_v6_1_0). Correrla después de cualquier cambio en el
# árbol, en custom-*/ o en migrate-plugins.sh.
#
# Uso: tools/verify_clean_install.sh [arbol_referencia] [tag]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REF="${1:-$ROOT/superset_v6_1_0}"
TAG="${2:-6.1.0}"
WORK="$(mktemp -d -t superset-clean-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

echo "== Exportando Superset $TAG limpio en $WORK"
git -C "$REF" archive "$TAG" | tar -x -C "$WORK"
echo "== migrate-plugins.sh"
if ! "$ROOT/migrate-plugins.sh" "$WORK" > "$WORK/.migrate.log" 2>&1; then
  grep -E "\[error\]|ERROR|INCOMPLETA" "$WORK/.migrate.log" || tail -20 "$WORK/.migrate.log"
  echo "== FALLA: migrate-plugins.sh terminó con error"; exit 1
fi
grep -E "\[warn\]|\[pendiente\]" "$WORK/.migrate.log" || true
echo "== Overlay"
python3 "$ROOT/custom-src/upstream-overlay/overlay.py" check "$WORK" > /dev/null
echo "== Comparación contra $REF"
python3 "$ROOT/tools/compare_customized_tree.py" "$REF" "$WORK" "$TAG"
echo "== OK: un Superset $TAG limpio + migrate-plugins.sh reproduce el árbol de referencia"
