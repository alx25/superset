#!/bin/bash
# Script para iniciar workers de Celery para superset_test (puerto 9090)

cd /home/imercados/superset_proyecto/superset_v6
source .venv/bin/activate

# Matar workers existentes de test (si existen)
pkill -f "celery.*superset_test" 2>/dev/null

echo "🚀 Iniciando workers de Celery para superset_test..."

# Worker SQL/Async (cola: sql)
celery -A superset.tasks.celery_app:app worker \
  --pool=gevent \
  -O fair \
  -Q sql \
  -c 180 \
  --prefetch-multiplier=1 \
  --max-memory-per-child=1024000 \
  --loglevel=INFO \
  --hostname=test-async-sql@superset.irex.local \
  --logfile=/tmp/celery-test-sql.log \
  --detach

echo "✅ Worker SQL iniciado: test-async-sql@superset.irex.local"

# Worker General (cola: celery)
celery -A superset.tasks.celery_app:app worker \
  --pool=prefork \
  -O fair \
  -Q celery \
  -c 12 \
  --prefetch-multiplier=1 \
  --max-memory-per-child=512000 \
  --loglevel=INFO \
  --hostname=test-general@superset.irex.local \
  --logfile=/tmp/celery-test-general.log \
  --detach

echo "✅ Worker General iniciado: test-general@superset.irex.local"

# Verificar workers
sleep 3
celery -A superset.tasks.celery_app:app inspect active | grep -E "test-async-sql|test-general"

echo ""
echo "📊 Workers de test iniciados. Verifica en Flower: http://localhost:5555"
echo "📝 Logs:"
echo "   SQL: tail -f /tmp/celery-test-sql.log"
echo "   General: tail -f /tmp/celery-test-general.log"
