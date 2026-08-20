#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICES=(superset.service celery.service celery-beat.service flower.service)

echo "=== Desplegando servicios de producción ==="
echo ""

# Verificar que todos los archivos existen antes de hacer cambios
for svc in "${SERVICES[@]}"; do
    if [[ ! -f "$SCRIPT_DIR/$svc" ]]; then
        echo "ERROR: No se encuentra $SCRIPT_DIR/$svc"
        exit 1
    fi
done

# Verificar que el archivo .env_superset existe
ENV_FILE="/home/imercados/superset_proyecto/.env_superset"
if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: No se encuentra $ENV_FILE"
    exit 1
fi

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
    sudo systemctl restart "$svc_name"
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
echo "Listo. Para ver logs: journalctl -u superset -f"
