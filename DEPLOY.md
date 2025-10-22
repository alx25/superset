## Despliegue y flujo Dev/Prod en tu fork

Este documento explica cómo ejecutar Superset desde tu fork tanto en desarrollo (dev) como en producción (prod), sin necesidad de Docker. También incluye una opción opcional con Docker Compose para dependencias (PostgreSQL/Redis).

Resumen del flujo de ramas recomendado en tu fork:
- prod: refleja exactamente lo que está desplegado en producción.
- dev: integra cambios en curso validados en un entorno de desarrollo.
- feature/*: ramas cortas por funcionalidad. Se fusionan a dev mediante PR.

Promoción a producción:
1) Trabajar en feature/* → PR a dev → validar en entorno dev.
2) PR de dev → prod → crear tag de release → desplegar a producción.

Nota: Todos los PRs son internos en tu fork (alx25/superset). No se envía nada al repositorio upstream (apache/superset) salvo que lo elijas explícitamente.

---

## Requisitos
- Python 3.10 o 3.11 (recomendado)
- Node.js 18.x (para construir el frontend)
- Base de datos (PostgreSQL/MySQL) y Redis (recomendado para caché/colas)

Opcional (para dependencias en dev): Docker + Docker Compose.

---

## Variables de entorno y configuración

1) Copia alguno de los ejemplos a un archivo .env local y ajústalo:
   - `deploy/.env.dev.example` → `.env.dev`
   - `deploy/.env.prod.example` → `.env.prod`

2) Configuración de Superset por archivo:
   - Puedes usar un `superset_config.py` personalizado y referenciarlo con la variable `SUPERSET_CONFIG_PATH`.
   - Ejemplo de plantilla: `deploy/superset_config.py.example`.

---

## Desarrollo (sin Docker)

1) Crear entorno virtual e instalar backend desde el código del fork (editable):
```
python -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -e .
```

2) Construir el frontend (usa Node 18):
```
cd superset-frontend
npm ci
npm run build
cd ..
```

3) Inicializar Superset (BD + cuenta admin):
```
export $(grep -v '^#' deploy/.env.dev | xargs)  # opcional, si usas .env
superset fab create-admin \
  --username admin --firstname Admin --lastname User \
  --email admin@example.com --password admin

superset db upgrade
superset init
```

4) Ejecutar el servidor de desarrollo (simple):
```
superset run -h 0.0.0.0 -p 8088 --with-threads
```

Recomendado para desarrollo:
- Base de datos local (Postgres) y Redis. Puedes correrlos con Docker Compose (ver más abajo) o usar servicios ya instalados.

---

## Producción (sin Docker)

1) Asegura variables de entorno seguras (por ejemplo, `SECRET_KEY`, `SQLALCHEMY_DATABASE_URI`, `CACHE_CONFIG`, etc.). Puedes partir de `deploy/.env.prod.example`.

2) Instala e inicializa como en desarrollo (venv + build frontend), pero ejecuta el servidor con Gunicorn o un servicio systemd:
```
# Ejemplo con Gunicorn (4 workers, ajusta según CPU)
gunicorn "superset.app:create_app()" -b 0.0.0.0:8088 -w 4 --timeout 120
```

3) Ejecuta migraciones y `superset init` en cada despliegue:
```
superset db upgrade
superset init
```

4) Coloca Superset detrás de un proxy (Nginx/Traefik) con TLS.

Buenas prácticas de prod:
- Usa una BD administrada o bien respaldos periódicos de tu metastore.
- Redis para caché y Celery (si habilitas tareas asíncronas).
- Logs persistentes y monitoreo.

---

## Opcional: Docker Compose para dependencias (dev)

Archivo: `deploy/docker-compose.dev.yml`.
Inicia Postgres y Redis para desarrollo local. Luego ejecutas Superset desde tu venv, apuntando a estas dependencias vía variables de entorno.

Comandos típicos:
```
cd deploy
docker compose -f docker-compose.dev.yml up -d
# Exporta variables apuntando a estos contenedores (ver .env.dev.example)
```

Para parar:
```
docker compose -f docker-compose.dev.yml down
```

---

## Flujo de trabajo Git

Ramas:
- feature/nombre-cambio → PR → dev
- dev (entorno de staging) → PR → prod (despliegue producción)

Promover a prod:
1) Abrir PR interno (base: `prod`, compare: `dev`).
2) Al aprobar, fusionar y crear tag (por ejemplo, `v0.1.0-alx`).
3) Desplegar desde el tag o desde la rama `prod`.

Estrategias:
- Protege `prod` para exigir PR + checks.
- CI/CD para construir y validar (build frontend, lint/tests, etc.).

---

## Preguntas frecuentes

¿Es necesario Docker?
- No. Puedes operar completamente con entorno virtual (venv) y `pip`. Docker ayuda a estandarizar dependencias y aislar servicios, pero no es obligatorio.

¿Cómo veo mis cambios en dev sin afectar producción?
- Fusiona tus features a `dev` y ejecuta en un entorno separado (otra BD/Redis/puertos). Producción sigue en `prod` sin cambios.

¿Cómo paso mis cambios a producción?
- Abre PR de `dev` a `prod`, valida, crea tag y despliega. Así mantienes trazabilidad y rollback sencillo.

---

## Archivos de apoyo
- `deploy/.env.dev.example` y `deploy/.env.prod.example`: plantillas de variables.
- `deploy/superset_config.py.example`: ejemplo de configuración avanzada.
- `deploy/docker-compose.dev.yml`: dependencias para dev.

Si necesitas, se pueden añadir workflows de GitHub Actions para automatizar build/test y despliegues.
