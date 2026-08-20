#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICES=(superset.service celery.service celery-beat.service flower.service superset_mcp.service superset_mcp_test.service)

echo "=== Desplegando servicios de producción ==="
echo ""

# Verificar que todos los archivos existen antes de hacer cambios
for svc in "${SERVICES[@]}"; do
    if [[ ! -f "$SCRIPT_DIR/$svc" ]]; then
        echo "ERROR: No se encuentra $SCRIPT_DIR/$svc"
        exit 1
    fi
done

# Verificar que los archivos de entorno existen
for env_file in \
    "/home/imercados/superset_proyecto/.env_superset" \
    "/home/imercados/superset_proyecto/.env_superset_mcp" \
    "/home/imercados/superset_proyecto/.env_superset_mcp_test"; do
    if [[ ! -f "$env_file" ]]; then
        echo "ERROR: No se encuentra $env_file"
        exit 1
    fi
done

# Copiar los servicios
for svc in "${SERVICES[@]}"; do
    echo "  Copiando $svc → /etc/systemd/system/$svc"
    sudo cp "$SCRIPT_DIR/$svc" "/etc/systemd/system/$svc"
done

echo ""
echo "  Recargando systemd..."
sudo systemctl daemon-reload

echo ""
echo "=== Reiniciando servicios ==="
for svc in "${SERVICES[@]}"; do
    svc_name="${svc%.service}"
    echo "  Reiniciando $svc_name..."
    sudo systemctl restart "$svc_name" || echo "  [warn] $svc_name no pudo reiniciarse (puede no estar habilitado aún)"
done

echo ""
echo "=== Estado final ==="
for svc in "${SERVICES[@]}"; do
    svc_name="${svc%.service}"
    status=$(systemctl is-active "$svc_name" 2>/dev/null || echo "unknown")
    if [[ "$status" == "active" ]]; then
        echo "  ✓ $svc_name: $status"
    else
        echo "  ✗ $svc_name: $status"
    fi
done

echo ""
echo "Listo."
echo "  Logs prod MCP:  journalctl -u superset_mcp -f"
echo "  Logs test MCP:  journalctl -u superset_mcp_test -f"
