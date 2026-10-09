# Instalación de Superset Irex en un servidor nuevo

Este manual instala, sobre un Superset 6.1.0 **oficial y limpio**, todas las
personalizaciones del proyecto: los 3 plugins, los cambios del frontend y del
backend, el login Irex, la API de marcadores, el widget de chat, el servicio
MCP y la extensión `irex-mcp-tools`.

Todo sale de este repositorio (`superset_proyecto`). La carpeta
`superset_v6_1_0` de este servidor **no se copia**: es el resultado de aplicar
el script y sirve de referencia, no de instalación.

Las rutas usan el usuario `imercados` y `/home/imercados/superset_proyecto`,
igual que el servidor original. Si en el servidor nuevo son otras, hay que
cambiarlas también en las unidades de `systemd-new/`.

---

## 0. Antes de empezar: comprobar el repositorio (en el servidor original)

Antes de llevar el repositorio a otro servidor, confirmar que el script
reproduce todo lo que hay en uso:

```bash
cd /home/imercados/superset_proyecto
tools/verify_clean_install.sh
```

Tiene que terminar en `== OK`. Si falla, hay cambios en `superset_v6_1_0` que
el script todavía no instala: resolverlo antes (ver `PLUGINS.md`, sección
"Instalación completa en un servidor nuevo"). Después, commitear y hacer push.

---

## 1. Requisitos del sistema

| Componente | Versión | Para qué |
|---|---|---|
| Ubuntu / Debian | 22.04+ | |
| Python | 3.11 | backend de Superset |
| Node.js | 22.x (`package.json` pide `^22.22.0`) | compilar el frontend |
| PostgreSQL | 14+ | base de metadatos de Superset |
| Redis | 6+ | caché, Celery, límites de tasa |
| nginx | | proxy hacia el puerto 8088 |
| git, build-essential, libpq-dev, libsasl2-dev, libldap2-dev | | dependencias de compilación de paquetes de Python |

Para Node se recomienda `nvm`:

```bash
nvm install 22 && nvm use 22
```

---

## 2. Código

```bash
cd /home/imercados
git clone https://github.com/alx25/superset.git superset_proyecto   # este repo, SIN --recursive
cd superset_proyecto

# El repo trae superset_v6_1_0 como referencia a otro repo (queda una carpeta
# vacía al clonar): se reemplaza por el Superset 6.1.0 oficial y limpio.
rmdir superset_v6_1_0 2>/dev/null || true
git clone --branch 6.1.0 --depth 1 https://github.com/apache/superset.git superset_v6_1_0
```

---

## 3. Entorno de Python

```bash
cd /home/imercados/superset_proyecto/superset_v6_1_0
python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements/base.txt -e . -r ../requirements-irex.txt
playwright install --with-deps chromium     # capturas, thumbnails y reportes
```

`requirements-irex.txt` suma lo que el proyecto usa y Superset no instala por
defecto: `fastmcp` (sin esto el servicio MCP no arranca), los drivers de
ClickHouse y SQL Server, `playwright`, `gevent` y `flower`.

---

## 4. Aplicar las personalizaciones

```bash
cd /home/imercados/superset_proyecto
./migrate-plugins.sh /home/imercados/superset_proyecto/superset_v6_1_0
```

El script tiene que terminar con `=== Migración completada ===` y código de
salida 0. Si muestra `=== Migración INCOMPLETA ===`, buscar las líneas
`[error]`. La causa más común es que el Superset no es exactamente el 6.1.0
oficial: el paso 19 (overlay) solo copia sobre el original exacto. Avisos
esperables:

- `[warn] video_superset/Presentacion Superset.mp4 no encontrado`: ver el paso 9.
- `[pendiente] sin pybabel`: el `.venv` no existía al correr el script; ver el paso 6.

Para confirmar el resultado en cualquier momento:

```bash
python3 custom-src/upstream-overlay/overlay.py check superset_v6_1_0
```

---

## 5. Frontend

```bash
cd /home/imercados/superset_proyecto/superset_v6_1_0/superset-frontend
nvm use 22
npm install
npm run build-translation
npm run build
```

`npm run build` tarda varios minutos y necesita mucha memoria (el script usa
8 GB de heap de Node). Deja los archivos en `superset/static/assets/`.

---

## 6. Traducciones del backend

Si el paso 4 marcó `[pendiente] sin pybabel`:

```bash
cd /home/imercados/superset_proyecto/superset_v6_1_0
.venv/bin/pybabel compile -d superset/translations -l es
```

---

## 7. Configuración

### 7.1 `superset_config.py`

```bash
mkdir -p /home/imercados/.superset
cp /home/imercados/superset_proyecto/config-templates/superset_config.template.py \
   /home/imercados/.superset/superset_config.py
```

La plantilla es la config de producción del servidor original, sin secretos
ni datos propios del servidor. No hay que editarla: todo lo que cambia entre
servidores se lee de variables de entorno.

### 7.2 Archivos de entorno

Crear `.env_superset` y `.env_superset_mcp` a partir de
`config-templates/superset.env.example`, siguiendo las secciones del archivo:

```bash
cd /home/imercados/superset_proyecto
cp config-templates/superset.env.example .env_superset
cp config-templates/superset.env.example .env_superset_mcp
chmod 600 .env_superset .env_superset_mcp
```

Completar los valores:

- **Secretos nuevos**, distintos de los del servidor original. Generarlos con
  `python3 -c 'import secrets; print(secrets.token_urlsafe(48))'`.
- **`IREX_MCP_JWT_SECRET` e `IREX_CHAT_BACKEND_SECRET`** deben coincidir con los
  que use el backend del chat: coordinarlos con quien lo administra.
- **`SUPERSET_DB_URI`**: la base del paso 8.
- **IPs y URLs** de este servidor y del backend del chat.

Si falta una variable obligatoria, Superset no arranca y el log dice cuál
falta: `Falta la variable de entorno ...`.

### 7.3 Extensión MCP

```bash
mkdir -p /home/imercados/superset_proyecto/extensions
# el .supx está versionado en extensions/ de este repo
ls /home/imercados/superset_proyecto/extensions/irex-mcp-tools-0.1.0.supx
```

`IREX_EXTENSIONS_PATH` tiene que apuntar a esa carpeta.

---

## 8. Base de metadatos

```bash
sudo -u postgres psql -c "CREATE USER superset WITH PASSWORD 'CLAVE';"
sudo -u postgres psql -c "CREATE DATABASE superset OWNER superset;"

cd /home/imercados/superset_proyecto/superset_v6_1_0
set -a; . ../.env_superset; set +a
.venv/bin/superset db upgrade
.venv/bin/superset fab create-admin
.venv/bin/superset init
```

Para llevar los dashboards, gráficos, usuarios y conexiones del servidor
original, restaurar un `pg_dump` de su base de metadatos en lugar de partir de
una base vacía, y correr `superset db upgrade` después. Las conexiones a bases
de datos guardan su contraseña cifrada con `SECRET_KEY`. Si se usa un
`SECRET_KEY` nuevo, hay que volver a cargar esas contraseñas o rotar la clave
con `superset re-encrypt-secrets`.

---

## 9. Video del login

El video de presentación del login (90 MB) no está en el repositorio. Copiarlo
del servidor original:

```bash
scp servidor-original:/home/imercados/superset_proyecto/superset_v6_1_0/superset/static/video_superset/"Presentacion Superset.mp4" \
    /home/imercados/superset_proyecto/superset_v6_1_0/superset/static/video_superset/
```

Sin el video, el login funciona igual pero no lo muestra.

---

## 10. Servicios

```bash
cd /home/imercados/superset_proyecto/systemd-new
./deploy-services.sh
```

Copia las unidades a `/etc/systemd/system/`, las habilita para el arranque y
las reinicia: `superset` (8088), `celery`, `celery-async`, `celery-beat`,
`flower` y `superset_mcp` (5008). `superset_mcp_test` se despliega solo si
existe `.env_superset_mcp_test`.

Logs:

```bash
journalctl -u superset -f
journalctl -u superset_mcp -f
```

---

## 11. nginx

```bash
sudo cp /home/imercados/superset_proyecto/config-templates/nginx-superset.conf.example \
        /etc/nginx/sites-available/superset.conf
sudo sed -i 's/SERVER_NAME/IP_O_DOMINIO/' /etc/nginx/sites-available/superset.conf
sudo ln -s /etc/nginx/sites-available/superset.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Para HTTPS, agregar un bloque `listen 443 ssl` con los certificados del
servidor; el `location /` es el mismo.

---

## 12. Verificación

1. `curl -f http://localhost:8088/health` devuelve `OK`.
2. La página de login muestra el diseño Irex. Al entrar, redirige a la lista de
   dashboards en vista de tarjetas.
3. En un gráfico nuevo aparecen los tipos de los 3 plugins (HTML Cards, Pivot
   Table Rx1, Table V3).
4. El servicio MCP responde:
   `journalctl -u superset_mcp -n 50` debe mostrar
   `Irex MCP Tools extension registered`.
5. El widget de chat aparece en un dashboard (requiere el backend del chat
   configurado con los mismos secretos).

---

## Actualizar un servidor ya instalado

1. En el servidor original: `tools/verify_clean_install.sh` en OK, commit y push.
2. En el servidor destino: `git pull` en `superset_proyecto` y volver a clonar
   `superset_v6_1_0` limpio (o descartar sus cambios con `git checkout .` y
   `git clean -fd`, conservando `.venv/` y `superset-frontend/node_modules/`).
3. Repetir los pasos 4, 5 y 6. Si cambió la config de producción en el servidor
   original, regenerar la plantilla allá
   (`config-templates/build_template.py`, ver su README) y repetir el paso 7.1.
4. Reemplazar el `.supx` si cambió y reiniciar los servicios.

## Problemas conocidos

- `custom-extensions/irex-mcp-tools/scripts/e2e_rbac.py` lee `MCP_JWT_SECRET`
  como texto del archivo de config. Con la plantilla, el secreto está en el
  entorno: hay que adaptar el script o pasarle una config con el valor.
- El script está armado para Superset **6.1.0**. Para otra versión, el paso 19
  falla en cada archivo cuyo original cambió; ver
  `custom-src/upstream-overlay/README.md`.
