#!/usr/bin/env bash
# Build reproducible de irex-mcp-tools contra una versión concreta de Superset.
#
# Uso:
#   scripts/build-extension.sh <ruta_directorio_superset> [ruta_supx_destino]
#
# Ejemplo (entorno de test, sin tocar producción):
#   scripts/build-extension.sh \
#     /home/imercados/superset_proyecto/superset_v6_1_0 \
#     /home/imercados/superset_proyecto/extensions_test/irex-mcp-tools-0.1.0.supx
#
# Si se omite el destino, el .supx queda en dist/irex-mcp-tools-0.1.0.supx
# dentro de esta fuente canónica y no se copia a ningún lado — el operador
# decide explícitamente cuándo promoverlo a extensions/ (producción) o
# extensions_test/ (test), tal como exige CLAUDE.md.
set -euo pipefail

SUPERSET_DIR="${1:?Uso: build-extension.sh <ruta_directorio_superset> [ruta_supx_destino]}"
DEST_SUPX="${2:-}"

EXT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$EXT_ROOT/frontend"
BACKEND_DIR="$EXT_ROOT/backend"
BUILD_OUT="$EXT_ROOT/dist/irex-mcp-tools-0.1.0.supx"

echo "== 1/6 Verificar API pública requerida (@apache-superset/core) =="
if [ ! -d "$SUPERSET_DIR/superset-frontend/packages/superset-core" ]; then
  echo "ERROR: no se encontró superset-core en $SUPERSET_DIR" >&2
  exit 1
fi

echo "== 2/6 Compilar TypeScript (validación de tipos, strict) =="
(cd "$FRONTEND_DIR" && npx tsc --noEmit -p tsconfig.json)

echo "== 3/6 Verificar sintaxis del backend Python =="
python3 -c "
import py_compile, pathlib, sys
backend_src = pathlib.Path('$BACKEND_DIR/src')
files = list(backend_src.rglob('*.py'))
if not files:
    sys.exit(f'No se encontraron .py en {backend_src}')
for f in files:
    py_compile.compile(str(f), doraise=True)
print(f'py_compile OK ({len(files)} archivos)')
"

echo "== 4/6 Tests backend =="
PYTEST_BIN="$SUPERSET_DIR/.venv/bin/pytest"
if [ -x "$PYTEST_BIN" ]; then
  (cd "$BACKEND_DIR" && "$PYTEST_BIN" tests/ -q)
elif command -v pytest >/dev/null 2>&1; then
  (cd "$BACKEND_DIR" && pytest tests/ -q)
else
  echo "AVISO: no se encontró pytest ni en $SUPERSET_DIR/.venv ni en PATH —" >&2
  echo "       se omiten los tests backend." >&2
fi

echo "== 5/6 Compilar frontend (webpack, modo producción) =="
NPM_VERSION="$(npm --version)"
if ! printf '%s\n10.8.2\n' "$NPM_VERSION" | sort -V -C 2>/dev/null; then
  echo "AVISO: npm $NPM_VERSION < 10.8.2 requerido por 'superset-extensions'." >&2
  echo "       Este script empaqueta el .supx manualmente (package_supx.py)" >&2
  echo "       en vez de depender de 'superset-extensions build/bundle'." >&2
fi
(cd "$FRONTEND_DIR" && rm -rf dist && npm run build)

echo "== 6/6 Empaquetar y validar .supx (reconstruido desde cero) =="
python3 "$EXT_ROOT/scripts/package_supx.py" "$BUILD_OUT"

if [ -n "$DEST_SUPX" ]; then
  cp "$BUILD_OUT" "$DEST_SUPX"
  echo "Copiado a destino: $DEST_SUPX"
else
  echo "Sin destino especificado. Artefacto listo en: $BUILD_OUT"
  echo "Copialo manualmente a extensions/ (producción) o extensions_test/ (test)."
fi
