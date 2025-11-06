# 🚀 Guía de Actualización: Superset 4.1.4 → 5.0.0

## 📋 Resumen

Esta guía detalla el proceso para actualizar tu fork de Superset de la versión 4.1.4 a la 5.0.0, **manteniendo todos tus cambios personalizados** y con la posibilidad de **revertir si algo sale mal**.

## 🎯 Estado Actual

- **Versión actual**: 4.1.4 (fork)
- **Rama principal**: `dev`
- **Rama base**: `superset-4.1.2-fork`
- **Versión objetivo**: 5.0.0
- **Remotos configurados**:
  - `origin`: tu fork (alx25/superset)
  - `upstream`: repositorio oficial (apache/superset)

## 📊 Análisis de Personalizaciones

### Cambios Principales Identificados:

1. **Login Personalizado**: Animaciones, toggle de contraseña, estilos personalizados
2. **Reset de Contraseña**: Funcionalidad con notificaciones por email
3. **Personalización de Columnas**: HTML templates, Jinja dinámico
4. **Top N Functionality**: Control y configuración de usuario
5. **Formatos Condicionales**: Soporte de colorMode y dimensiones string
6. **Chat Button**: Botón flotante con ventana de chat y tabs
7. **QueryContextProcessor**: Mejoras en tracking de identificadores
8. **Configuración de Despliegue**: Guías dev/prod, archivos .env ejemplo
9. **Documentación**: Múltiples archivos de checkpoint y documentación

### Archivos Clave Modificados:

```
- Login/Auth: superset-frontend/src/views/auth/
- Table Plugin: superset-frontend/plugins/plugin-chart-modern-table/
- QueryContext: superset/common/query_context_processor.py
- Configuraciones: deploy/, docker-compose.dev.yml
- Documentación: DEPLOY.md, CHECKPOINT_*.md, DOCUMENTACION_*.md
```

## 🛡️ Estrategia de Actualización Segura

### Opción 1: Merge Conservador (RECOMENDADO para primera vez)

Esta estrategia crea una nueva rama de prueba, mantiene tu rama `dev` intacta como respaldo.

#### Ventajas:
- ✅ Rama `dev` permanece intacta como respaldo
- ✅ Puedes probar la actualización sin riesgo
- ✅ Fácil de revertir
- ✅ Puedes hacer múltiples intentos

#### Pasos:

```bash
# 1. Asegúrate de estar en dev y tener todo limpio
cd /home/imercados/superset_proyecto/superset
git checkout dev
git status  # Debe estar limpio

# 2. Crea una rama de respaldo (por si acaso)
git branch dev-backup-$(date +%Y%m%d)
git push origin dev-backup-$(date +%Y%m%d)

# 3. Actualiza las referencias del repositorio upstream
git fetch upstream

# 4. Crea una nueva rama para la actualización
git checkout -b dev-5.0-upgrade

# 5. Intenta el merge con la rama 5.0 de upstream
git merge upstream/5.0 --no-ff -m "Merge upstream 5.0 into dev"

# Si hay conflictos, git te lo indicará aquí
```

### Opción 2: Rebase Avanzado (para usuarios experimentados)

Esta estrategia reaplica tus commits sobre la versión 5.0.

```bash
# 1. Crea una rama de prueba
git checkout -b dev-5.0-rebase

# 2. Rebase tus cambios sobre upstream/5.0
git rebase upstream/5.0

# 3. Resuelve conflictos uno por uno según aparezcan
```

## 🔧 Resolución de Conflictos Esperados

### Conflictos Probables:

#### 1. **package.json y package-lock.json**
- **Causa**: Actualizaciones de dependencias
- **Solución**: Generalmente aceptar la versión 5.0 y luego verificar que tus dependencias personalizadas estén incluidas

#### 2. **Archivos de configuración (setup.py, pyproject.toml)**
- **Causa**: Cambios en la estructura del proyecto
- **Solución**: Revisar manualmente y fusionar los cambios

#### 3. **Componentes del Frontend**
- **Causa**: Refactorizaciones y cambios de API
- **Solución**: Puede requerir adaptar tu código a las nuevas APIs

#### 4. **Migraciones de Base de Datos**
- **Causa**: Nuevas migraciones en 5.0
- **Solución**: Revisar y probar en entorno de desarrollo

### Comandos para Resolver Conflictos:

```bash
# Ver archivos con conflictos
git status

# Ver el conflicto en un archivo específico
git diff <archivo>

# Aceptar tu versión (de dev)
git checkout --ours <archivo>

# Aceptar la versión de 5.0
git checkout --theirs <archivo>

# Editar manualmente para fusionar ambos
nano <archivo>  # o tu editor preferido

# Después de resolver, marcar como resuelto
git add <archivo>

# Continuar el merge
git merge --continue
```

## 🧪 Fase de Pruebas

### Antes de Comprometer la Actualización:

```bash
# 1. Verificar que el build funcione
cd superset-frontend
npm install
npm run build

# 2. Verificar dependencias de Python
cd ..
pip install -e .

# 3. Ejecutar migraciones de base de datos (en entorno de desarrollo)
superset db upgrade

# 4. Inicializar/actualizar
superset init

# 5. Ejecutar la aplicación en modo desarrollo
superset run -p 8088 --with-threads --reload --debugger
```

### Checklist de Funcionalidades Personalizadas:

- [ ] Login personalizado funciona correctamente
- [ ] Reset de contraseña funciona
- [ ] Chat button aparece y funciona
- [ ] Personalización de columnas con HTML templates funciona
- [ ] Top N functionality funciona
- [ ] Formatos condicionales en dimensiones string funcionan
- [ ] Exportación CSV con campos Jinja funciona
- [ ] QueryContextProcessor maneja identificadores correctamente

## 🔄 Plan de Reversión

### Si algo sale mal y necesitas revertir:

#### Caso 1: Aún no has hecho push

```bash
# Simplemente vuelve a dev
git checkout dev

# Elimina la rama de prueba si quieres
git branch -D dev-5.0-upgrade
```

#### Caso 2: Ya hiciste push pero quieres volver

```bash
# Vuelve a dev (que no ha cambiado)
git checkout dev

# O usa el backup
git checkout dev-backup-YYYYMMDD

# Si necesitas forzar en origin
git push origin dev --force
```

### Respaldo Completo (Extremadamente Seguro):

```bash
# Antes de empezar, crea un respaldo completo
cd /home/imercados/superset_proyecto
tar -czf superset-backup-$(date +%Y%m%d-%H%M%S).tar.gz superset/

# Para restaurar (si es necesario)
cd /home/imercados/superset_proyecto
tar -xzf superset-backup-TIMESTAMP.tar.gz
```

## 📝 Documentación de Cambios en 5.0

### Cambios Mayores Esperados:

1. **Python**: Posible actualización de versión mínima
2. **Node.js**: Posible actualización de versión mínima
3. **Dependencias**: Actualizaciones significativas de paquetes
4. **API Changes**: Posibles cambios en APIs internas
5. **Base de Datos**: Nuevas migraciones y cambios de esquema
6. **Frontend**: Posibles refactorizaciones de componentes

### Recursos Oficiales:

- Changelog 5.0: https://github.com/apache/superset/blob/5.0/CHANGELOG/5.0.0.md (o similar)
- Guía de Migración: Buscar en la documentación oficial
- Breaking Changes: Revisar el CHANGELOG

## 🎬 Pasos Sugeridos (Orden Recomendado)

### Fase 1: Preparación (Sin Riesgo)

1. ✅ Crear respaldo completo del proyecto
2. ✅ Crear rama de backup de `dev`
3. ✅ Actualizar `upstream` con `git fetch`
4. ✅ Revisar el CHANGELOG de 5.0
5. ✅ Documentar el estado actual

### Fase 2: Actualización (Rama de Prueba)

6. ✅ Crear rama `dev-5.0-upgrade`
7. ✅ Intentar merge con `upstream/5.0`
8. ✅ Resolver conflictos sistemáticamente
9. ✅ Hacer commit del merge

### Fase 3: Validación (Crítico)

10. ✅ Instalar dependencias del frontend
11. ✅ Build del frontend
12. ✅ Instalar dependencias de Python
13. ✅ Ejecutar migraciones de DB (en dev)
14. ✅ Probar la aplicación
15. ✅ Verificar todas las funcionalidades personalizadas

### Fase 4: Integración (Si todo funciona)

16. ✅ Hacer merge de `dev-5.0-upgrade` a `dev`
17. ✅ Push a `origin/dev`
18. ✅ Actualizar documentación
19. ✅ Crear tag de versión `v5.0.0-custom`

### Fase 5: Despliegue (Producción)

20. ✅ Probar en ambiente de staging
21. ✅ Planificar ventana de mantenimiento
22. ✅ Desplegar a producción
23. ✅ Monitorear logs y errores

## 🆘 Problemas Comunes y Soluciones

### Problema 1: Conflictos Masivos

**Síntoma**: Demasiados conflictos para resolver manualmente

**Solución**:
```bash
# Abortar el merge
git merge --abort

# Intentar estrategia de merge diferente
git merge upstream/5.0 -X ours  # Prefiere tus cambios
# o
git merge upstream/5.0 -X theirs  # Prefiere cambios de 5.0
```

### Problema 2: Build Falla

**Síntoma**: `npm run build` falla

**Solución**:
```bash
# Limpiar node_modules
cd superset-frontend
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Problema 3: Migraciones de DB Fallan

**Síntoma**: `superset db upgrade` falla

**Solución**:
```bash
# Ver el estado de las migraciones
superset db heads

# Revisar logs para identificar el problema
# Posiblemente necesites ajustar configuración o datos
```

### Problema 4: Funcionalidad Personalizada Rota

**Síntoma**: Tu código personalizado no funciona

**Solución**:
1. Revisar los logs de la aplicación
2. Verificar si las APIs que usas han cambiado
3. Consultar el CHANGELOG de 5.0 para breaking changes
4. Adaptar tu código a las nuevas APIs

## 📞 Soporte y Recursos

### Documentación:

- Superset Oficial: https://superset.apache.org/docs/intro
- GitHub Issues: https://github.com/apache/superset/issues
- Slack Community: https://apache-superset.slack.com/

### Archivos Importantes en tu Proyecto:

- `CHANGELOG.md`: Historial de cambios
- `UPDATING.md`: Guía de actualización oficial
- Tus checkpoints: `CHECKPOINT_*.md`
- Tu documentación: `DOCUMENTACION_*.md`

## ✅ Checklist Final

Antes de considerar la actualización completa:

- [ ] Respaldo completo creado
- [ ] Rama de backup creada y pusheada
- [ ] Merge exitoso en rama de prueba
- [ ] Build del frontend exitoso
- [ ] Dependencias Python instaladas
- [ ] Migraciones de DB ejecutadas sin errores
- [ ] Aplicación inicia sin errores
- [ ] Login personalizado funciona
- [ ] Todas las funcionalidades personalizadas verificadas
- [ ] Pruebas en ambiente de desarrollo completas
- [ ] Documentación actualizada
- [ ] Plan de rollback documentado y probado

## 🎉 Conclusión

La actualización de 4.1.4 a 5.0.0 es un proceso significativo pero manejable si se hace de forma sistemática. La clave es:

1. **Nunca** trabajar directamente en `dev` al principio
2. **Siempre** tener respaldos
3. **Probar** exhaustivamente antes de comprometer
4. **Documentar** todos los cambios y problemas encontrados
5. **Tener** un plan de reversión claro

Con esta estrategia, puedes actualizar de forma segura manteniendo todos tus cambios personalizados.

---

**Creado**: 2025-11-06
**Versión**: 1.0
**Autor**: Sistema de Asistencia
