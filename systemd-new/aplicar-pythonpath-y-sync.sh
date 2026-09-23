#!/usr/bin/env bash
# Aplica dos correcciones del 2026-09-23 (Registro de cambios, entrada 47):
#
#  A) PYTHONPATH de las unidades web y Celery: se quita "$SUPERSET_DIR/superset".
#     Con esa ruta, superset/key_value/ tapa al paquete pip `key_value` que
#     necesita fastmcp, y la extensión irex falla al cargar en esos procesos.
#     Unidades: superset_test, superset, celery, celery-beat (fuente en este
#     directorio; respaldo de las anteriores en extensions/backups/).
#  B) El pre-import de superset.views en FLASK_APP_MUTATOR (ya editado en
#     los dos configs) que corrige "Failed to sync configuration to database".
#     Toma efecto al reiniciar cada servicio.
#
# Orden: test → validación → confirmación "PRODUCCION" → producción → validación.
# Las unidades MCP no cambian; se reinicia solo el MCP de test (para validar
# B también ahí). El MCP de producción no se toca.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT=/home/imercados/superset_proyecto
PY="$ROOT/superset_v6_1_0/.venv/bin/python"
API_PATH=/extensions/irex/irex-mcp-tools/assistant/sql-lab
BK="$ROOT/extensions/backups"

step() { printf '\n== %s ==\n' "$1"; }
fail() { printf '\nABORTADO: %s\n' "$1" >&2; exit 1; }

wait_health() {  # puerto, etiqueta
  for _ in $(seq 1 90); do
    [[ $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$1/health" || true) == 200 ]] && { echo "$2: /health 200"; return 0; }
    sleep 2
  done
  fail "$2 no respondió /health a tiempo"
}

check_logs() {  # unidad
  # Cuenta SOLO desde el arranque actual de la unidad: los workers viejos
  # vuelcan su stdout con buffer ("MCP tool decorator not initialized") al
  # apagarse, un par de segundos ANTES del arranque nuevo. Y exige evidencia
  # positiva (logging sin buffer) en vez de solo ausencia de errores.
  local unit=$1 since logs workers loaded synced sync_fail
  sleep 20  # que terminen de arrancar todos los workers
  since=$(date -d "$(systemctl show "$unit" -p ActiveEnterTimestamp --value)" '+%Y-%m-%d %H:%M:%S')
  logs=$(journalctl -u "$unit" --since "$since" --no-pager)
  workers=$(grep -c 'Booting worker' <<<"$logs" || true)
  [[ $workers -gt 0 ]] || workers=1  # MCP: un solo proceso, sin gunicorn
  loaded=$(grep -c 'JwtUserBridgeMiddleware registrado' <<<"$logs" || true)
  synced=$(grep -c 'Configuration sync to database completed' <<<"$logs" || true)
  sync_fail=$(grep -c 'Failed to sync configuration' <<<"$logs" || true)
  echo "$unit (desde $since): procesos=$workers extensión completa=$loaded sync OK=$synced sync FALLA=$sync_fail"
  [[ $sync_fail == 0 && $loaded == "$workers" && $synced == "$workers" ]] \
    || fail "$unit: se esperaba extensión completa y sync OK en los $workers procesos (ver journalctl -u $unit)"
}

api_registered() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$1$API_PATH")
  [[ $code != 404 ]] || fail "API del asistente no registrada en :$1"
  echo "API del asistente en :$1 → $code"
}

install_units() {
  for u in "$@"; do
    sudo cp "$DIR/$u" "/etc/systemd/system/$u"
    echo "instalada $u ($(grep -o 'PYTHONPATH="[^"]*"' "/etc/systemd/system/$u"))"
  done
  sudo systemctl daemon-reload
}

for u in superset.service superset_test.service celery.service celery-beat.service; do
  [[ -f "$BK/$u.20260923-pre-pythonpath" ]] || fail "falta el respaldo $BK/$u.20260923-pre-pythonpath"
  grep -q 'PYTHONPATH="$SUPERSET_DIR"' "$DIR/$u" || fail "$DIR/$u no tiene el PYTHONPATH corregido"
done

step "1/5 Test: instalar unidad y reiniciar"
install_units superset_test.service
since=$(date +%s)
sudo systemctl restart superset_test.service superset_mcp_test.service
wait_health 9090 "web test"

step "2/5 Test: validar"
check_logs superset_test.service
check_logs superset_mcp_test.service
api_registered 9090
"$PY" "$ROOT/custom-extensions/irex-mcp-tools/scripts/e2e_rbac.py" --config "$ROOT/superset_config_test.py" \
  --url http://127.0.0.1:5009/mcp --humo || fail "humo MCP de test"

step "3/5 Confirmación"
echo "Test validado. Siguiente: instalar superset/celery/celery-beat de PRODUCCIÓN y reiniciarlos."
echo "El MCP de producción no se reinicia. El primer arranque sembrará THEME_DEFAULT/THEME_DARK"
echo "como temas de sistema (sin is_system_default/is_system_dark: el tema visible no cambia)."
read -r -p "Escribí PRODUCCION para continuar: " answer
[[ $answer == PRODUCCION ]] || fail "cancelado por el operador (producción sin cambios)"

step "4/5 Producción: instalar unidades y reiniciar"
install_units superset.service celery.service celery-beat.service
since=$(date +%s)
sudo systemctl restart superset.service celery.service celery-beat.service
wait_health 8088 "web prod"

step "5/5 Producción: validar"
check_logs superset.service
for u in celery celery-beat; do
  [[ $(systemctl is-active "$u.service") == active ]] || fail "$u.service no quedó activo"
  echo "$u.service: active"
done
api_registered 8088
"$PY" - <<'EOF'
import re, sqlalchemy as sa
uri = re.search(r"SQLALCHEMY_DATABASE_URI = .*?'(postgresql://[^']+)'", open('/home/imercados/.superset/superset_config.py').read()).group(1)
with sa.create_engine(uri).connect() as c:
    rows = c.execute(sa.text("select theme_name, is_system_default, is_system_dark from themes where is_system order by 1")).fetchall()
print("temas de sistema en prod:", [tuple(r) for r in rows])
EOF

cat <<EOF

Listo. Reversión, si hiciera falta:
  for u in superset.service superset_test.service celery.service celery-beat.service; do
    sudo cp "$BK/\$u.20260923-pre-pythonpath" "/etc/systemd/system/\$u"; done
  cp "$BK/superset_config.py.20260923-pre-fix-sync" /home/imercados/.superset/superset_config.py
  cp "$BK/superset_config_test.py.20260923-pre-fix-sync" "$ROOT/superset_config_test.py"
  sudo systemctl daemon-reload && sudo systemctl restart superset superset_test celery celery-beat
EOF
