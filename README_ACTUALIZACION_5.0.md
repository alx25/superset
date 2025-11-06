# 📘 README - Actualización a Superset 5.0

## 🎯 Resumen Ejecutivo

Este paquete de documentos te guía para actualizar tu fork personalizado de Apache Superset de la versión **4.1.4 a 5.0.0**, manteniendo todas tus personalizaciones y con capacidad de revertir si algo falla.

---

## 📚 Documentos Incluidos

| Documento | Propósito | Para Quién |
|-----------|-----------|------------|
| **GUIA_ACTUALIZACION_5.0.md** | Guía completa paso a paso | Todos (LEER PRIMERO) |
| **COMANDOS_RAPIDOS_UPGRADE_5.0.md** | Comandos copy-paste listos | Usuarios técnicos |
| **PLAN_CONTINGENCIA_5.0.md** | Soluciones a problemas | Para consultar si algo falla |
| **scripts/upgrade-to-5.0.sh** | Script automatizado | Para ejecución automática |

---

## 🚀 Inicio Rápido (5 minutos)

### Opción 1: Automático (Recomendado)

```bash
cd /home/imercados/superset_proyecto/superset
./scripts/upgrade-to-5.0.sh
```

El script te guiará con un menú interactivo.

### Opción 2: Manual

```bash
# 1. Crear backup
git branch dev-backup-$(date +%Y%m%d)
git push origin dev-backup-$(date +%Y%m%d)

# 2. Actualizar upstream
git fetch upstream

# 3. Crear rama de upgrade
git checkout -b dev-5.0-upgrade

# 4. Merge
git merge upstream/5.0 --no-ff -m "Merge upstream 5.0"

# 5. Resolver conflictos (si los hay)
# ... editar archivos ...
git add .
git merge --continue

# 6. Build
cd superset-frontend
npm install
npm run build
```

---

## ⚠️ Antes de Empezar - IMPORTANTE

### ✅ Prerequisitos

- [ ] **Tiempo**: Bloquea 4-8 horas
- [ ] **Acceso**: Asegúrate de tener acceso completo al servidor
- [ ] **Ambiente**: Trabaja en desarrollo, NO en producción
- [ ] **Backup**: Planea cómo hacer backup antes de empezar
- [ ] **Rollback**: Ten un plan para volver atrás si es necesario

### 🎯 Lo Que Debes Saber

1. **Tus cambios están seguros**: La estrategia preserva todas tus personalizaciones
2. **Puedes revertir en cualquier momento**: Siempre trabajamos en una rama nueva
3. **Los conflictos son normales**: Es esperado tener algunos conflictos, hay guías para resolverlos
4. **No toques `dev` directamente**: Trabajaremos en `dev-5.0-upgrade` primero

---

## 📋 Tus Personalizaciones Identificadas

### Cambios Principales:

1. ✨ **Login Personalizado** - Animaciones, estilos custom, toggle de contraseña
2. 🔐 **Password Reset** - Funcionalidad con email notifications
3. 💬 **Chat Button** - Botón flotante con ventana de chat
4. 📊 **Personalización de Columnas** - HTML templates, Jinja dinámico
5. 🔝 **Top N Functionality** - Control de usuario para Top N
6. 🎨 **Formatos Condicionales** - ColorMode, dimensiones string
7. 🔧 **QueryContextProcessor** - Mejoras en tracking de identificadores
8. 📖 **Documentación** - Múltiples checkpoints y guías

### Archivos Clave a Vigilar:

```
superset-frontend/src/views/auth/
superset-frontend/src/components/ChatButton/
superset-frontend/plugins/plugin-chart-modern-table/
superset/common/query_context_processor.py
deploy/
DEPLOY.md, CHECKPOINT_*.md, DOCUMENTACION_*.md
```

---

## 🎬 Proceso Recomendado

### Fase 1: Preparación (30 min)

```bash
# 1. Lee la guía completa
cat GUIA_ACTUALIZACION_5.0.md

# 2. Verifica tu estado actual
git status
git branch --show-current

# 3. Crea backup
git branch dev-backup-$(date +%Y%m%d)
tar -czf ../superset-backup-$(date +%Y%m%d).tar.gz .
```

### Fase 2: Actualización (1-2 horas)

```bash
# Ejecuta el script automático
./scripts/upgrade-to-5.0.sh

# O sigue los comandos manuales en:
# COMANDOS_RAPIDOS_UPGRADE_5.0.md
```

### Fase 3: Resolución de Conflictos (1-3 horas)

Si hay conflictos (muy probable):

```bash
# Ver conflictos
git status
git diff --name-only --diff-filter=U

# Para cada archivo en conflicto:
# - Editar manualmente, O
# - Usar: git checkout --ours <archivo>  (tu versión)
# - Usar: git checkout --theirs <archivo>  (versión 5.0)

# Marcar como resuelto
git add <archivo>

# Continuar merge
git merge --continue
```

### Fase 4: Build y Pruebas (1-2 horas)

```bash
# Instalar dependencias
cd superset-frontend
npm install

# Build
npm run build

# Instalar Python deps
cd ..
pip install -e .

# Migrar DB
superset db upgrade

# Probar
superset run -p 8088
```

### Fase 5: Validación (1-2 horas)

- [ ] Login personalizado funciona
- [ ] Password reset funciona
- [ ] Chat button aparece
- [ ] Personalización de columnas funciona
- [ ] Top N functionality funciona
- [ ] Formatos condicionales funcionan
- [ ] No hay errores en consola del navegador
- [ ] No hay errores en logs del servidor

---

## 🆘 ¿Qué Hacer Si...?

### ...Hay demasiados conflictos?

→ Lee: **PLAN_CONTINGENCIA_5.0.md** - Escenario 1

### ...El build falla?

→ Lee: **PLAN_CONTINGENCIA_5.0.md** - Escenario 2

### ...Las migraciones de DB fallan?

→ Lee: **PLAN_CONTINGENCIA_5.0.md** - Escenario 3

### ...La app no inicia?

→ Lee: **PLAN_CONTINGENCIA_5.0.md** - Escenario 4

### ...Una funcionalidad personalizada no funciona?

→ Lee: **PLAN_CONTINGENCIA_5.0.md** - Escenario 5

### ...Quiero volver a como estaba?

```bash
# Simple: volver a dev (que no ha cambiado)
git checkout dev

# O usar el backup
git checkout dev-backup-YYYYMMDD

# Para revertir por completo
tar -xzf ../superset-backup-TIMESTAMP.tar.gz
```

---

## 📊 Diferencias Principales 4.1.4 → 5.0.0

### Cambios Esperados:

- 🐍 **Python**: Posible actualización a 3.9+ o 3.10+
- 📦 **Node.js**: Posible actualización a 18+
- 🔄 **Dependencias**: Muchas actualizaciones de paquetes
- 🎨 **Frontend**: Posibles refactorizaciones de componentes
- 🗄️ **Base de Datos**: Nuevas migraciones
- 🔧 **APIs**: Posibles cambios en APIs internas

### Recursos para Revisión:

```bash
# Ver changelog oficial
curl -s https://raw.githubusercontent.com/apache/superset/5.0/CHANGELOG.md | less

# Comparar versiones en GitHub
# https://github.com/apache/superset/compare/4.1.4...5.0.0
```

---

## 💡 Tips Pro

### 1. Trabaja en Horario Tranquilo
- No hagas esto cuando hay usuarios activos
- Idealmente fin de semana o fuera de horario

### 2. Documenta Todo
- Toma capturas de pantalla del estado actual
- Anota cada decisión que tomes al resolver conflictos
- Guarda logs de errores

### 3. Prueba en Ambiente de Desarrollo
- NUNCA actualices producción directamente
- Prueba todo en desarrollo primero
- Solo después de validación completa, ve a producción

### 4. Ten un Plan B
- Siempre ten los backups listos
- Saber cómo hacer rollback completo
- Tener acceso a versión anterior funcionando

### 5. No Te Apures
- Es mejor tomar 8 horas haciendo bien
- Que 2 horas y tener que hacer rollback

---

## 🔍 Verificación Post-Actualización

### Checklist Técnico:

```bash
# Versión correcta
superset version

# Build limpio
cd superset-frontend && npm run build

# Sin errores Python
python -c "from superset import app; print('OK')"

# Migraciones al día
superset db current

# App inicia
superset run -p 8088 --debugger
```

### Checklist Funcional:

- [ ] Login funciona
- [ ] Dashboards cargan
- [ ] Charts renderizan
- [ ] SQL Lab funciona
- [ ] Filtros funcionan
- [ ] Export funciona
- [ ] Todas las personalizaciones activas

---

## 📞 Recursos de Ayuda

### Documentación Oficial:
- 📖 https://superset.apache.org/docs/intro
- 🔧 https://superset.apache.org/docs/installation/upgrading-superset

### Comunidad:
- 💬 Slack: https://apache-superset.slack.com/
- 🐛 Issues: https://github.com/apache/superset/issues
- 📧 Mailing List: dev@superset.apache.org

### Tus Documentos Internos:
- 📝 `CHECKPOINT_*.md` - Tus checkpoints anteriores
- 📘 `DOCUMENTACION_*.md` - Tu documentación
- 🚀 `DEPLOY.md` - Guía de despliegue

---

## ✅ Checklist Final de Éxito

Antes de considerar la actualización completa:

- [ ] ✅ Backup completo creado y verificado
- [ ] ✅ Merge completado (con o sin conflictos resueltos)
- [ ] ✅ Build del frontend exitoso
- [ ] ✅ Dependencias Python instaladas
- [ ] ✅ Migraciones DB ejecutadas sin errores
- [ ] ✅ Aplicación inicia sin errores
- [ ] ✅ Login personalizado funciona
- [ ] ✅ Chat button funciona
- [ ] ✅ Todas funcionalidades personalizadas verificadas
- [ ] ✅ Pruebas funcionales completadas
- [ ] ✅ Performance aceptable
- [ ] ✅ Plan de rollback documentado y probado
- [ ] ✅ Documentación actualizada
- [ ] ✅ Tag de versión creado

---

## 🎯 Próximos Pasos Después de Actualizar

### 1. Integrar a `dev`

```bash
git checkout dev
git merge dev-5.0-upgrade --no-ff
git push origin dev
```

### 2. Crear Tag

```bash
git tag -a v5.0.0-custom -m "Superset 5.0.0 with custom modifications"
git push origin v5.0.0-custom
```

### 3. Actualizar Documentación

- Actualiza CHANGELOG.md con tus notas
- Documenta cambios en tus personalizaciones
- Actualiza DEPLOY.md si cambió algo

### 4. Comunicar

- Informa al equipo sobre la actualización
- Documenta cambios visibles para usuarios
- Planea training si hay cambios significativos

### 5. Monitorear

- Vigila logs las primeras 24-48 horas
- Estate atento a reportes de usuarios
- Ten el rollback plan listo por si acaso

---

## 🎉 Mensaje Final

La actualización de Superset 4.1.4 a 5.0.0 es un proceso significativo pero completamente manejable con la preparación adecuada.

### Recuerda:
- ✅ **Paciencia**: No te apresures
- ✅ **Preparación**: Los backups son tu red de seguridad
- ✅ **Pruebas**: Valida todo antes de producción
- ✅ **Documentación**: Registra tus decisiones
- ✅ **Ayuda**: Usa la comunidad si te atascas

**¡Éxito con tu actualización! 🚀**

---

## 📝 Información del Documento

- **Creado**: 2025-11-06
- **Versión**: 1.0
- **Para**: Actualización Superset 4.1.4 → 5.0.0
- **Autor**: Sistema de Asistencia IA

---

## 🔗 Links Rápidos

- [Guía Completa](./GUIA_ACTUALIZACION_5.0.md)
- [Comandos Rápidos](./COMANDOS_RAPIDOS_UPGRADE_5.0.md)
- [Plan de Contingencia](./PLAN_CONTINGENCIA_5.0.md)
- [Script Automatizado](./scripts/upgrade-to-5.0.sh)

---

**¿Listo para empezar?** → Ejecuta: `./scripts/upgrade-to-5.0.sh`
