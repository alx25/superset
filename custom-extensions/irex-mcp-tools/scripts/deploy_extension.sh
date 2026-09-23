#!/usr/bin/env bash
# Despliegue de irex-mcp-tools con compuertas (nació en la Fase 10 de
# PLAN_ASISTENTE_SQL_LAB.md como deploy_fase10.sh; generalizado 2026-09-23).
#
# Uso (desde cualquier directorio, con un usuario que tenga sudo), después de
# `build-extension.sh` hacia extensions_test/:
#   custom-extensions/irex-mcp-tools/scripts/deploy_extension.sh
#
# Etapas (cada una aborta el script si falla):
#   1. Reinicia test y espera a que web (9090) y MCP (5009) respondan.
#   2. Valida test en vivo: e2e_rbac completo, API nueva registrada (no 404),
#      check_deploy_config.
#   3. Verifica que dist/ sea idéntico a lo validado en extensions_test/.
#   4. PIDE CONFIRMACIÓN antes de tocar producción.
#   5. Copia el .supx a extensions/ (+ copia fuente), valida config de prod.
#   6. Reinicia producción y espera web (8088) y MCP (5008).
#   7. Valida producción: e2e_rbac --humo, API nueva, permisos sin cambios.
# Cada ejecución respalda el .supx de producción vigente y toma una foto de
# los permisos en extensions/backups/*.<fecha-hora>, justo antes de instalar.
set -euo pipefail

ROOT=/home/imercados/superset_proyecto
PY="$ROOT/superset_v6_1_0/.venv/bin/python"
SCRIPTS="$ROOT/custom-extensions/irex-mcp-tools/scripts"
CANDIDATE="$ROOT/custom-extensions/irex-mcp-tools/dist/irex-mcp-tools-0.1.0.supx"
TEST_SUPX="$ROOT/extensions_test/irex-mcp-tools-0.1.0.supx"
PROD_SUPX="$ROOT/extensions/irex-mcp-tools-0.1.0.supx"
SOURCE_COPY="$ROOT/custom-extensions/irex-mcp-tools/irex-mcp-tools-0.1.0.supx"
TS=$(date +%Y%m%d-%H%M%S)
BACKUP="$ROOT/extensions/backups/irex-mcp-tools-0.1.0.supx.$TS"
PERMS_BEFORE="$ROOT/extensions/backups/prod_perms.$TS.txt"
PROD_CONFIG=/home/imercados/.superset/superset_config.py
API_PATH=/extensions/irex/irex-mcp-tools/assistant/sql-lab

step() { printf '\n== %s ==\n' "$1"; }
fail() { printf '\nABORTADO: %s\n' "$1" >&2; exit 1; }

wait_http() {  # url, códigos aceptados (regex), etiqueta
  local url=$1 ok=$2 label=$3 code
  for _ in $(seq 1 90); do
    code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$url" || true)
    if [[ $code =~ ^($ok)$ ]]; then echo "$label: $code"; return 0; fi
    sleep 2
  done
  fail "$label no respondió a tiempo (último código: ${code:-ninguno})"
}

api_registered() {  # puerto; sin sesión debe dar 400/401, nunca 404
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$1$API_PATH")
  [[ $code != 404 ]] || fail "la API nueva no está registrada en :$1 (404)"
  echo "API nueva en :$1 → $code (registrada)"
}

PERMS_QUERY="select v.name, p.name, r.name from ab_permission_view_role pvr
  join ab_permission_view pv on pv.id=pvr.permission_view_id join ab_permission p on p.id=pv.permission_id
  join ab_view_menu v on v.id=pv.view_menu_id join ab_role r on r.id=pvr.role_id"
prod_perms() {  # imprime una asignación rol-permiso por línea (solo lectura)
  "$PY" - "$PROD_CONFIG" "$PERMS_QUERY" <<'PYEOF'
import re, sys, sqlalchemy as sa
uri = re.search(r"SQLALCHEMY_DATABASE_URI = .*?'(postgresql://[^']+)'", open(sys.argv[1]).read()).group(1)
with sa.create_engine(uri).connect() as c:
    for row in c.execute(sa.text(sys.argv[2])):
        print("|".join(row))
PYEOF
}

step "1/7 Reiniciar test"
sudo systemctl restart superset_test.service superset_mcp_test.service
wait_http http://127.0.0.1:9090/health '200|405' "web test"
wait_http http://127.0.0.1:5009/mcp '401' "MCP test"

step "2/7 Validar test en vivo"
api_registered 9090
"$PY" "$SCRIPTS/e2e_rbac.py" --config "$ROOT/superset_config_test.py" --url http://127.0.0.1:5009/mcp || fail "e2e de test"
"$PY" "$SCRIPTS/check_deploy_config.py" --config "$ROOT/superset_config_test.py" --supx "$TEST_SUPX" || fail "config de test"

step "3/7 Candidato idéntico a lo validado en test"
cmp -s "$CANDIDATE" "$TEST_SUPX" || fail "dist/ difiere de extensions_test/ — reconstruir y revalidar"
echo "OK: $(sha256sum "$CANDIDATE" | cut -c1-16)"

step "4/7 Confirmación"
echo "Test validado. Siguiente paso: reemplazar el .supx de PRODUCCIÓN y reiniciar"
echo "superset.service y superset_mcp.service (los usuarios del chat notarán el reinicio)."
read -r -p "¿Promover a producción? Escribí PRODUCCION para continuar: " answer
[[ $answer == PRODUCCION ]] || fail "cancelado por el operador (producción sin cambios)"

step "5/7 Instalar en producción"
mkdir -p "$ROOT/extensions/backups"
cp -p "$PROD_SUPX" "$BACKUP"
prod_perms | sort > "$PERMS_BEFORE"
echo "respaldo: $BACKUP ($(wc -l < "$PERMS_BEFORE") permisos en la foto)"
cp "$CANDIDATE" "$PROD_SUPX"
cp "$CANDIDATE" "$SOURCE_COPY"
"$PY" "$SCRIPTS/check_deploy_config.py" --config "$PROD_CONFIG" --supx "$PROD_SUPX" || {
  cp "$BACKUP" "$PROD_SUPX"; fail "config de prod no valida con el .supx nuevo — se restauró el anterior (sin reiniciar)"; }

step "6/7 Reiniciar producción"
sudo systemctl restart superset.service superset_mcp.service
wait_http http://127.0.0.1:8088/health '200|405' "web prod"
wait_http http://127.0.0.1:5008/mcp '401' "MCP prod"

step "7/7 Validar producción"
api_registered 8088
"$PY" "$SCRIPTS/e2e_rbac.py" --config "$PROD_CONFIG" --url http://127.0.0.1:5008/mcp --humo --clickhouse-db 16 --postgres-db 3 \
  || echo "ATENCIÓN: el humo de producción falló — revisar arriba y considerar la reversión."
prod_perms | sort > "$PERMS_BEFORE.after"
lost=$(comm -23 "$PERMS_BEFORE" "$PERMS_BEFORE.after"); gained=$(comm -13 "$PERMS_BEFORE" "$PERMS_BEFORE.after")
echo "Permisos de prod: $(wc -l < "$PERMS_BEFORE") antes, $(wc -l < "$PERMS_BEFORE.after") después"
[[ -z $lost ]] || sed 's/^/  PERDIDO: /' <<<"$lost"
[[ -z $gained ]] || sed 's/^/  NUEVO:   /' <<<"$gained"
[[ -z $lost && -z $gained ]] && echo "  sin cambios en asignaciones rol-permiso" || echo "  ATENCIÓN: hubo cambios"

cat <<EOF

Despliegue terminado. Probar el panel en el navegador (Ctrl+Shift+R en SQL Lab).
Reversión, si hiciera falta:
  cp "$BACKUP" "$PROD_SUPX"
  sudo systemctl restart superset.service superset_mcp.service
EOF
