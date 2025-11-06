# 🚀 Comandos Rápidos - Actualización a Superset 5.0

## 📋 Comandos Pre-Actualización

### 1. Verificar Estado Actual
```bash
cd /home/imercados/superset_proyecto/superset
git status
git branch --show-current
```

### 2. Crear Respaldo Manual Rápido
```bash
# Respaldo de archivos (sin .git)
cd /home/imercados/superset_proyecto
tar --exclude='.git' --exclude='node_modules' --exclude='__pycache__' \
    -czf superset-backup-$(date +%Y%m%d-%H%M%S).tar.gz superset/

# Respaldo de rama en git
cd superset
git branch dev-backup-$(date +%Y%m%d)
git push origin dev-backup-$(date +%Y%m%d)
```

## 🎯 Método 1: Script Automatizado (RECOMENDADO)

```bash
cd /home/imercados/superset_proyecto/superset
./scripts/upgrade-to-5.0.sh
```

El script te guiará paso a paso con un menú interactivo.

## 🔧 Método 2: Manual (Paso a Paso)

### Paso 1: Preparación
```bash
cd /home/imercados/superset_proyecto/superset

# Asegurarse de estar en dev
git checkout dev

# Verificar que esté limpio
git status

# Crear backup
git branch dev-backup-$(date +%Y%m%d)
git push origin dev-backup-$(date +%Y%m%d)
```

### Paso 2: Actualizar Upstream
```bash
# Obtener últimos cambios
git fetch upstream

# Ver qué hay en 5.0
git log --oneline upstream/5.0 | head -20
```

### Paso 3: Crear Rama de Upgrade
```bash
# Crear y cambiar a nueva rama
git checkout -b dev-5.0-upgrade
```

### Paso 4: Intentar Merge
```bash
# Merge con upstream 5.0
git merge upstream/5.0 --no-ff -m "Merge upstream 5.0 into dev"

# Si hay conflictos, verlos:
git status
git diff --name-only --diff-filter=U
```

### Paso 5: Resolver Conflictos (si los hay)

```bash
# Ver conflictos en un archivo específico
git diff <archivo-con-conflicto>

# Opción A: Usar tu versión
git checkout --ours <archivo>

# Opción B: Usar versión de 5.0
git checkout --theirs <archivo>

# Opción C: Editar manualmente
nano <archivo>  # o code <archivo>

# Marcar como resuelto
git add <archivo>

# Repetir para todos los archivos con conflicto
# Cuando termines todos:
git merge --continue
```

### Paso 6: Instalar Dependencias Frontend
```bash
cd superset-frontend

# Limpiar instalación anterior (opcional pero recomendado)
rm -rf node_modules package-lock.json

# Instalar
npm install
```

### Paso 7: Build Frontend
```bash
cd superset-frontend
npm run build
```

### Paso 8: Instalar Dependencias Python
```bash
cd /home/imercados/superset_proyecto/superset

# Si usas virtualenv
pip install -e .

# O con requirements específicos
pip install -r requirements/base.txt
pip install -r requirements/development.txt
```

### Paso 9: Actualizar Base de Datos
```bash
# Ejecutar migraciones
superset db upgrade

# Inicializar/actualizar
superset init
```

### Paso 10: Probar la Aplicación
```bash
# Ejecutar en modo desarrollo
superset run -p 8088 --with-threads --reload --debugger
```

## 🔍 Comandos de Verificación

### Ver Diferencias
```bash
# Ver cambios entre dev y 5.0
git diff dev..upstream/5.0 --stat

# Ver archivos que cambiaron
git diff dev..upstream/5.0 --name-only

# Ver commits nuevos en 5.0
git log dev..upstream/5.0 --oneline
```

### Verificar Conflictos Potenciales
```bash
# Antes del merge, ver qué archivos podrían tener conflictos
git merge-tree $(git merge-base dev upstream/5.0) dev upstream/5.0 | grep -A 3 "changed in both"
```

### Estado Durante Merge
```bash
# Ver archivos con conflictos
git status

# Ver solo nombres de archivos con conflictos
git diff --name-only --diff-filter=U

# Contar conflictos
git diff --name-only --diff-filter=U | wc -l
```

## 🔄 Comandos de Reversión

### Abortar Merge
```bash
# Si decidiste que no quieres continuar con el merge
git merge --abort
```

### Volver a Dev Original
```bash
# Cambiar a dev (que no ha cambiado)
git checkout dev

# Eliminar rama de upgrade
git branch -D dev-5.0-upgrade
```

### Volver a Backup
```bash
# Listar backups
git branch | grep backup

# Cambiar a backup
git checkout dev-backup-YYYYMMDD

# Si quieres hacer que dev apunte al backup
git branch -f dev dev-backup-YYYYMMDD
git checkout dev
```

### Restaurar desde Archivo
```bash
# Si hiciste un tar.gz
cd /home/imercados/superset_proyecto
ls -lh superset-backup-*.tar.gz

# Restaurar (¡CUIDADO! Esto sobrescribirá todo)
rm -rf superset
tar -xzf superset-backup-TIMESTAMP.tar.gz
```

## 🧪 Comandos de Prueba

### Build Limpio
```bash
cd superset-frontend

# Limpiar todo
rm -rf node_modules package-lock.json build

# Reinstalar y build
npm install
npm run build
```

### Verificar Python
```bash
# Verificar versión
python --version

# Verificar instalación de superset
pip show apache-superset

# Verificar comando superset
which superset
superset version
```

### Probar Migraciones en Seco
```bash
# Ver estado actual de migraciones
superset db heads

# Ver historial de migraciones
superset db history

# Ver migración actual
superset db current
```

## 📊 Comandos de Diagnóstico

### Ver Log de Git
```bash
# Ver commits recientes
git log --oneline -20

# Ver commits con archivos cambiados
git log --stat -10

# Ver commits con diff
git log -p -5
```

### Verificar Remote
```bash
# Ver remotos configurados
git remote -v

# Ver ramas remotas
git branch -r | grep "upstream"

# Ver info de upstream/5.0
git show upstream/5.0 --stat
```

### Analizar Cambios
```bash
# Ver archivos más cambiados entre versiones
git diff --stat dev..upstream/5.0 | sort -k 2 -n -r | head -20

# Ver contribuidores en 5.0
git shortlog upstream/4.1..upstream/5.0 --summary --numbered
```

## 🎯 Comandos Post-Actualización

### Verificar Funcionalidades Personalizadas

```bash
# Buscar tus archivos personalizados
find . -name "*login*" -type f | grep -v node_modules | grep -v .git
find . -name "*chat*" -type f | grep -v node_modules | grep -v .git

# Verificar que tus archivos de config estén
ls -l deploy/*.example
ls -l CHECKPOINT*.md
ls -l DOCUMENTACION*.md
```

### Commitear y Push

```bash
# Si todo está bien, commitear
git add .
git commit -m "Successfully upgraded to Superset 5.0"

# Push de la rama de upgrade
git push origin dev-5.0-upgrade

# Si quieres hacer merge a dev
git checkout dev
git merge dev-5.0-upgrade --no-ff
git push origin dev
```

### Crear Tag

```bash
# Crear tag para esta versión
git tag -a v5.0.0-custom -m "Superset 5.0.0 with custom modifications"
git push origin v5.0.0-custom
```

## 🆘 Comandos de Emergencia

### Reset Duro (¡PELIGRO!)
```bash
# Volver dev a su estado en origin (perderás cambios locales)
git checkout dev
git fetch origin
git reset --hard origin/dev
```

### Limpiar Todo
```bash
# Limpiar archivos no rastreados
git clean -fd

# Ver qué se limpiaría (sin hacerlo)
git clean -fdn
```

### Stash de Emergencia
```bash
# Guardar cambios actuales temporalmente
git stash save "Emergency stash before merge"

# Ver stashes
git stash list

# Recuperar
git stash pop
```

## 📝 Comandos de Documentación

### Actualizar Documentación
```bash
# Crear archivo con notas de actualización
cat > UPGRADE_NOTES_5.0.md << 'EOF'
# Notas de Actualización a 5.0

## Fecha: $(date)
## Rama: $(git branch --show-current)

## Conflictos Encontrados:
- Lista aquí los conflictos

## Resoluciones Aplicadas:
- Lista aquí cómo los resolviste

## Pruebas Realizadas:
- [ ] Login personalizado
- [ ] Chat button
- [ ] etc.

EOF
```

### Ver CHANGELOG de Superset
```bash
# Ver changelog de 5.0
curl -s https://raw.githubusercontent.com/apache/superset/5.0/CHANGELOG.md | head -200
```

## 🔗 Enlaces Útiles

```bash
# Abrir documentación oficial
xdg-open https://superset.apache.org/docs/installation/upgrading-superset

# Ver release notes de 5.0
xdg-open https://github.com/apache/superset/releases/tag/5.0.0

# Ver comparación en GitHub
xdg-open https://github.com/apache/superset/compare/4.1.4...5.0.0
```

## ✅ Checklist de Comandos

Copia y pega esto para trackear tu progreso:

```bash
# [ ] Backup creado
# [ ] Rama backup en git creada
# [ ] Upstream actualizado
# [ ] Rama upgrade creada
# [ ] Merge completado o en progreso
# [ ] Conflictos resueltos
# [ ] Dependencias frontend instaladas
# [ ] Frontend compilado
# [ ] Dependencias Python instaladas
# [ ] Migraciones de DB ejecutadas
# [ ] Aplicación probada
# [ ] Funcionalidades personalizadas verificadas
# [ ] Documentación actualizada
```

---

**Tip**: Puedes ejecutar estos comandos directamente o copiarlos en un script personalizado.

**Recuerda**: Siempre verifica con `git status` antes y después de cada operación importante.
