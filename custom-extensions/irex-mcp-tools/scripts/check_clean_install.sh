#!/usr/bin/env bash
# Instala el .supx en un Superset LIMPIO y verifica que funcione solo
# (Fase 9, "Compatibilidad": criterio "instalable en un Superset limpio").
#
# Uso:
#   scripts/check_clean_install.sh <directorio_superset> <archivo.supx>
#
# Crea un entorno descartable en un directorio temporal: metadata SQLite
# nueva, sin custom-src ni blueprints propios, solo ENABLE_EXTENSIONS y
# EXTENSIONS_PATH con este .supx. Usa el .venv del Superset indicado. No toca
# ninguna base ni servicio existente. El backend del chat no se configura a
# propósito: la API del asistente debe responder 503 explícito.
set -euo pipefail

SUPERSET_DIR="${1:?Uso: check_clean_install.sh <directorio_superset> <archivo.supx>}"
SUPX="${2:?Uso: check_clean_install.sh <directorio_superset> <archivo.supx>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d -t irex-clean-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/home" "$WORK/extensions"
cp "$SUPX" "$WORK/extensions/"
cat > "$WORK/superset_config.py" <<CFG
SECRET_KEY = "$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
SQLALCHEMY_DATABASE_URI = "sqlite:///$WORK/home/superset.db?check_same_thread=false"
FEATURE_FLAGS = {"ENABLE_EXTENSIONS": True}
EXTENSIONS_PATH = "$WORK/extensions"
CFG

export SUPERSET_CONFIG_PATH="$WORK/superset_config.py" SUPERSET_HOME="$WORK/home" PYTHONPATH="$SUPERSET_DIR"
SUPERSET="$SUPERSET_DIR/.venv/bin/superset"
pw() { python3 -c 'import secrets; print(secrets.token_urlsafe(16))'; }

echo "== Superset limpio en $WORK"
"$SUPERSET" db upgrade >/dev/null 2>&1
"$SUPERSET" init >/dev/null 2>&1
"$SUPERSET" fab create-admin --username admin --firstname a --lastname b --email admin@example.invalid --password "$(pw)" >/dev/null 2>&1
"$SUPERSET" fab create-user --role Gamma --username gamma --firstname g --lastname g --email gamma@example.invalid --password "$(pw)" >/dev/null 2>&1

echo "== Verificaciones"
"$SUPERSET_DIR/.venv/bin/python" "$HERE/_clean_install_checks.py" 2>&1 | grep -E '^(PASS|FAIL|[0-9]+/[0-9]+)'
exit "${PIPESTATUS[0]}"
