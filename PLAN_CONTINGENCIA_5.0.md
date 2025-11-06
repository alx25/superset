# 🛡️ Plan de Contingencia - Actualización Superset 5.0

## 📋 Introducción

Este documento detalla escenarios de problemas y sus soluciones durante la actualización a Superset 5.0.

---

## 🚨 Escenarios de Emergencia

### Escenario 1: Merge Tiene Demasiados Conflictos

**Síntomas:**
- Git reporta cientos de conflictos
- Resolverlos manualmente tomaría días
- No estás seguro de qué decisión tomar en cada conflicto

**Solución A: Abortar y Usar Estrategia Diferente**

```bash
# 1. Abortar el merge
git merge --abort

# 2. Intentar merge favoreciendo upstream
git merge upstream/5.0 -X theirs -m "Merge upstream 5.0 (preferring upstream)"

# 3. Revisar manualmente solo los archivos críticos personalizados
git checkout HEAD -- superset-frontend/src/views/auth/login.tsx
git checkout HEAD -- deploy/
# ... otros archivos personalizados
```

**Solución B: Cherry-pick de Personalizaciones**

```bash
# 1. Abortar merge
git merge --abort

# 2. Hacer reset a upstream/5.0
git reset --hard upstream/5.0

# 3. Cherry-pick tus commits personalizados uno por uno
git cherry-pick <commit-hash-personalización-1>
git cherry-pick <commit-hash-personalización-2>
# etc.

# 4. Resolver conflictos individuales (mucho más manejable)
```

**Solución C: Rebase Interactivo**

```bash
# 1. Abortar merge
git merge --abort

# 2. Rebase sobre 5.0
git rebase upstream/5.0

# 3. Resolver conflictos commit por commit
# Git te irá mostrando los conflictos de cada commit individualmente
```

---

### Escenario 2: Build del Frontend Falla

**Síntomas:**
- `npm run build` termina con error
- Errores de TypeScript
- Dependencias no encontradas

**Diagnóstico:**

```bash
cd superset-frontend

# Ver errores completos
npm run build 2>&1 | tee build-error.log

# Verificar versión de Node
node --version  # Debe ser >= 18

# Verificar versión de npm
npm --version
```

**Solución 1: Limpiar e Reinstalar**

```bash
cd superset-frontend

# Limpiar completamente
rm -rf node_modules package-lock.json
npm cache clean --force

# Reinstalar
npm install

# Intentar build de nuevo
npm run build
```

**Solución 2: Verificar Versiones de Node/npm**

```bash
# Verificar requisitos de Superset 5.0
cat package.json | grep -A 5 '"engines"'

# Si tu versión es antigua, actualizar Node
# Usando nvm (si está instalado):
nvm install 18
nvm use 18

# O usando apt (Ubuntu/Debian):
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Solución 3: Build Incremental**

```bash
# Si el build completo falla, intentar por partes
npm run build:dev  # Si existe
npm run type-check  # Verificar TypeScript primero
npm run lint:fix   # Corregir linting
```

**Solución 4: Usar Versión Pre-compilada**

```bash
# Si tienes acceso a una instalación funcional de 5.0
# Copiar el directorio build ya compilado
scp -r usuario@servidor-funcional:/path/to/superset/superset-frontend/build ./superset-frontend/
```

---

### Escenario 3: Migraciones de Base de Datos Fallan

**Síntomas:**
- `superset db upgrade` falla con error
- Mensajes de tabla duplicada o columna no existente
- Aplicación no inicia por schema incorrecto

**Diagnóstico:**

```bash
# Ver estado de migraciones
superset db heads
superset db current

# Ver historial
superset db history | head -30

# Ver última migración aplicada
superset db show
```

**Solución 1: Backup de DB y Retry**

```bash
# 1. Backup de la base de datos (CRÍTICO)
# Para PostgreSQL:
pg_dump -U superset_user -d superset_db > superset_db_backup_$(date +%Y%m%d).sql

# Para MySQL:
mysqldump -u superset_user -p superset_db > superset_db_backup_$(date +%Y%m%d).sql

# Para SQLite:
cp ~/.superset/superset.db ~/.superset/superset_backup_$(date +%Y%m%d).db

# 2. Intentar migración de nuevo
superset db upgrade --verbose
```

**Solución 2: Downgrado y Re-upgrade**

```bash
# Hacer downgrade a versión anterior conocida
superset db downgrade <revision-anterior>

# Verificar estado
superset db current

# Intentar upgrade de nuevo
superset db upgrade
```

**Solución 3: Migración Manual**

```bash
# Si una migración específica falla, puedes saltarla (PELIGROSO)
# Solo como último recurso

# Conectar a la DB y marcar la migración como aplicada
# EJEMPLO para PostgreSQL:
psql -U superset_user -d superset_db

# Verificar tabla de migraciones
SELECT * FROM alembic_version;

# Actualizar manualmente (solo si entiendes las consecuencias)
UPDATE alembic_version SET version_num = '<nueva-revision>';
```

**Solución 4: Recrear DB desde Cero (Solo en Desarrollo)**

```bash
# ⚠️ SOLO EN DESARROLLO - PERDERÁS TODOS LOS DATOS ⚠️

# 1. Eliminar DB actual
superset db reset

# 2. Crear DB nueva
superset db upgrade

# 3. Inicializar
superset init
```

---

### Escenario 4: Aplicación No Inicia

**Síntomas:**
- `superset run` falla inmediatamente
- Errores de importación de Python
- Errores de configuración

**Diagnóstico:**

```bash
# Ejecutar con debug máximo
superset run -p 8088 --debugger --reload

# Ver logs detallados
tail -f /var/log/superset/superset.log  # O donde estén tus logs

# Verificar instalación
pip show apache-superset

# Verificar configuración
python -c "from superset import config; print(config)"
```

**Solución 1: Reinstalar Superset**

```bash
# Desinstalar
pip uninstall apache-superset

# Limpiar cache
pip cache purge

# Reinstalar desde setup.py
pip install -e .

# O desde requirements
pip install -r requirements/base.txt
```

**Solución 2: Verificar Dependencias Python**

```bash
# Verificar conflictos
pip check

# Ver dependencias rotas
pip list --broken

# Reinstalar dependencias específicas
pip install --force-reinstall <paquete-problemático>
```

**Solución 3: Verificar Configuración**

```bash
# Verificar superset_config.py
python -c "
import sys
sys.path.insert(0, '/home/imercados/superset_proyecto/superset')
try:
    from superset_config import *
    print('Config OK')
except Exception as e:
    print(f'Config Error: {e}')
"

# Verificar variables de entorno
env | grep SUPERSET

# Usar configuración mínima de prueba
export SUPERSET_CONFIG_PATH=/path/to/minimal_config.py
```

---

### Escenario 5: Funcionalidad Personalizada No Funciona

**Síntomas:**
- Login personalizado no aparece
- Chat button desapareció
- Personalización de columnas no funciona

**Diagnóstico:**

```bash
# Verificar que tus archivos personalizados estén presentes
find . -name "*login*" | grep -v node_modules
find . -name "*chat*" | grep -v node_modules

# Verificar que los archivos se compilaron
ls -lh superset-frontend/build/

# Verificar en el navegador
# Abrir DevTools > Console y buscar errores JavaScript
```

**Solución 1: Verificar Merge de Archivos**

```bash
# Ver si tus archivos se mergearon correctamente
git log --follow -- superset-frontend/src/views/auth/login.tsx

# Ver diferencias con tu versión
git diff dev-backup-YYYYMMDD -- superset-frontend/src/views/auth/login.tsx
```

**Solución 2: Cherry-pick de Archivos Específicos**

```bash
# Si los archivos se perdieron, recuperar de backup
git checkout dev-backup-YYYYMMDD -- superset-frontend/src/views/auth/login.tsx
git checkout dev-backup-YYYYMMDD -- superset-frontend/src/components/ChatButton/

# Recompilar
cd superset-frontend
npm run build
```

**Solución 3: Verificar APIs Changed**

```bash
# Buscar en changelog si las APIs que usas cambiaron
grep -i "breaking" CHANGELOG/5.0.0.md

# Buscar tu código personalizado
grep -r "tuFunciónPersonalizada" superset-frontend/src/

# Adaptar a nuevas APIs según sea necesario
```

---

### Escenario 6: Performance Degradado Post-Actualización

**Síntomas:**
- Aplicación muy lenta después de actualizar
- Consultas tardan mucho
- Frontend se congela

**Diagnóstico:**

```bash
# Verificar uso de recursos
top -u superset_user

# Verificar logs de consultas lentas
grep "SLOW" /var/log/superset/superset.log

# Verificar cache
redis-cli info stats  # Si usas Redis

# Verificar DB
# PostgreSQL:
psql -U superset_user -d superset_db -c "SELECT * FROM pg_stat_activity;"
```

**Solución 1: Limpiar Cache**

```bash
# Limpiar cache de Superset
superset cache clear

# Limpiar Redis (si aplica)
redis-cli FLUSHALL

# Reiniciar aplicación
systemctl restart superset  # o como esté configurado
```

**Solución 2: Reconstruir Índices de DB**

```bash
# PostgreSQL
psql -U superset_user -d superset_db -c "REINDEX DATABASE superset_db;"

# MySQL
mysqlcheck -u superset_user -p --optimize superset_db
```

**Solución 3: Verificar Configuración de Cache**

```bash
# Editar superset_config.py
# Verificar configuración de cache

# Ejemplo de configuración óptima:
CACHE_CONFIG = {
    'CACHE_TYPE': 'RedisCache',
    'CACHE_DEFAULT_TIMEOUT': 300,
    'CACHE_KEY_PREFIX': 'superset_',
    'CACHE_REDIS_URL': 'redis://localhost:6379/0'
}
```

---

### Escenario 7: No Puedo Hacer Rollback

**Síntomas:**
- Algo salió mal y quieres volver a 4.1.4
- Pero no funciona el rollback
- Los datos están mezclados

**Solución 1: Rollback Completo**

```bash
# 1. Detener Superset
systemctl stop superset

# 2. Restaurar código a versión anterior
cd /home/imercados/superset_proyecto/superset
git checkout dev-backup-YYYYMMDD

# 3. Restaurar base de datos
# PostgreSQL:
psql -U superset_user -d superset_db < superset_db_backup_YYYYMMDD.sql

# MySQL:
mysql -u superset_user -p superset_db < superset_db_backup_YYYYMMDD.sql

# SQLite:
cp ~/.superset/superset_backup_YYYYMMDD.db ~/.superset/superset.db

# 4. Reinstalar dependencias de versión anterior
pip install -e .

# 5. Reconstruir frontend de versión anterior
cd superset-frontend
rm -rf node_modules
npm install
npm run build

# 6. Reiniciar
cd ..
superset run -p 8088
```

**Solución 2: Rollback Solo de DB**

```bash
# Si el código está bien pero la DB tiene problemas

# Ver migraciones disponibles
superset db history

# Hacer downgrade a versión específica
superset db downgrade <revision-4.1.4>

# Verificar
superset db current
```

**Solución 3: Usar Respaldo Completo**

```bash
# Si hiciste el tar.gz completo
cd /home/imercados/superset_proyecto

# Mover actual a lado
mv superset superset-failed-upgrade-$(date +%Y%m%d)

# Restaurar backup
tar -xzf superset-backup-TIMESTAMP.tar.gz

# Verificar
cd superset
git status
git branch --show-current
```

---

## 📊 Matriz de Decisiones

| Problema | Severidad | Tiempo de Resolución | Solución Recomendada |
|----------|-----------|---------------------|----------------------|
| Demasiados conflictos en merge | Alta | 2-4 horas | Cherry-pick de personalizaciones |
| Build frontend falla | Media | 30-60 min | Limpiar e reinstalar node_modules |
| Migraciones DB fallan | Alta | 1-2 horas | Backup + retry con verbose |
| App no inicia | Alta | 1-2 horas | Reinstalar dependencias Python |
| Funcionalidad personalizada rota | Media | 2-4 horas | Verificar merge + adaptar APIs |
| Performance degradado | Media | 1-3 horas | Limpiar cache + verificar config |
| Necesito rollback completo | Crítica | 30-60 min | Restaurar desde backup |

---

## ✅ Checklist de Preparación para Contingencias

Antes de empezar la actualización, asegúrate de tener:

- [ ] **Backup completo de archivos** (tar.gz)
- [ ] **Backup de base de datos** (dump SQL)
- [ ] **Rama de backup en Git** (pusheada a origin)
- [ ] **Lista de archivos personalizados** documentada
- [ ] **Capturas de pantalla** de funcionalidades personalizadas
- [ ] **Configuración actual** documentada (superset_config.py, .env)
- [ ] **Versiones de dependencias** documentadas (pip freeze, npm list)
- [ ] **Acceso a servidor/ambiente** de pruebas
- [ ] **Ventana de tiempo** suficiente (4-8 horas)
- [ ] **Plan de comunicación** si afecta a usuarios

---

## 🆘 Contactos de Emergencia

### Recursos Comunitarios:

- **Slack de Superset**: https://apache-superset.slack.com/
- **GitHub Issues**: https://github.com/apache/superset/issues
- **Stack Overflow**: Tag `apache-superset`
- **Mailing List**: dev@superset.apache.org

### Documentación Oficial:

- Guía de Actualización: https://superset.apache.org/docs/installation/upgrading-superset
- Troubleshooting: https://superset.apache.org/docs/miscellaneous/issue-codes
- FAQ: https://superset.apache.org/docs/faq

---

## 📝 Plantilla de Reporte de Incidente

Si algo sale mal, documenta con esta plantilla:

```markdown
# Incidente - Actualización a Superset 5.0

## Información Básica
- **Fecha/Hora**: YYYY-MM-DD HH:MM
- **Severidad**: [Baja/Media/Alta/Crítica]
- **Estado**: [En Progreso/Resuelto/Escalado]

## Descripción del Problema
[Describe qué salió mal]

## Síntomas Observados
- Síntoma 1
- Síntoma 2

## Pasos que Causaron el Problema
1. Paso 1
2. Paso 2

## Logs de Error
```
[Pega logs relevantes aquí]
```

## Intentos de Solución
1. Intento 1: [Describe qué hiciste] - Resultado: [Exitoso/Fallido]
2. Intento 2: [Describe qué hiciste] - Resultado: [Exitoso/Fallido]

## Solución Final
[Cómo se resolvió finalmente]

## Lecciones Aprendidas
- Lección 1
- Lección 2

## Acciones Preventivas
- Acción 1 para evitar en el futuro
- Acción 2 para evitar en el futuro
```

---

## 🎯 Regla de Oro

> **"Si tienes duda, NO hagas push. Si algo se ve raro, NO sigas adelante. Siempre es mejor tomarse tiempo extra para verificar que tener que hacer rollback completo en producción."**

---

**Última actualización**: 2025-11-06
**Versión del documento**: 1.0
