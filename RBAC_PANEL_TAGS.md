# Filtrado RBAC para Panel de Tags

## Fecha
7 de noviembre de 2025

## Problema
El panel de tags mostraba "No tags available" por dos razones:
1. El endpoint `/api/v1/tag/get_objects/` no estaba aplicando filtros RBAC
2. Los dashboards sin permisos se incluían en los resultados, pero luego no se mostraban en la lista

## Solución Implementada

### Backend: Filtrado por Permisos RBAC

#### Archivo: `superset/daos/tag.py`

**Modificación en `get_tagged_objects_for_tags()`:**

Se agregó filtrado por permisos usando `SupersetSecurityManager` para respetar `DASHBOARD_RBAC`:

```python
from superset.security.manager import SupersetSecurityManager

@staticmethod
def get_tagged_objects_for_tags(
    tags: Optional[list[str]] = None, 
    obj_types: Optional[list[str]] = None
) -> list[dict[str, Any]]:
    security_manager = SupersetSecurityManager(appbuilder=None)
    
    # Para dashboards
    for obj in dashboards:
        try:
            if security_manager.can_access_dashboard(obj):
                results.append({...})
        except Exception as ex:
            logger.warning(f"Error checking dashboard permissions: {ex}")
            continue
    
    # Para charts
    for obj in charts:
        try:
            if security_manager.can_access_chart(obj):
                results.append({...})
        except Exception as ex:
            logger.warning(f"Error checking chart permissions: {ex}")
            continue
```

**Cambios clave:**

1. **Instancia de SecurityManager**: Se crea una instancia del gestor de seguridad
2. **Verificación por objeto**: En lugar de incluir todos los dashboards/charts, se verifica uno por uno
3. **can_access_dashboard()**: Método que verifica:
   - Si `DASHBOARD_RBAC = True`: verifica ownership o permisos de rol
   - Si `DASHBOARD_RBAC = False`: permite acceso si tiene permiso general
4. **can_access_chart()**: Similarmente para charts
5. **Manejo de errores**: Si falla la verificación, no se incluye el objeto (seguro por defecto)

### Frontend: Manejo Robusto de Respuestas

#### Archivo: `superset-frontend/src/features/dashboards/DashboardTagSidebar.tsx`

**Mejoras en el fetch de tags:**

```typescript
const response = await fetch('/api/v1/tag/get_objects/?types=dashboard');

if (!response.ok) {
  throw new Error(`HTTP error! status: ${response.status}`);
}

const data = await response.json();

if (data.result && Array.isArray(data.result)) {
  data.result.forEach((item: any) => {
    // Cada item es un dashboard con sus tags
    if (item.tags && Array.isArray(item.tags)) {
      item.tags.forEach((tag: Tag) => {
        // Solo tags custom
        if (tag.type === 'custom' && tag.id !== undefined) {
          // Agrupar y contar
        }
      });
    }
  });
}
```

**Cambios clave:**

1. **Validación de respuesta HTTP**: Verifica `response.ok` antes de parsear JSON
2. **Validación de estructura**: Verifica que `data.result` existe y es un array
3. **Validación de tags**: Verifica que cada item tiene tags y que es un array
4. **Filtrado de tipo**: Solo incluye tags de tipo 'custom'
5. **Validación de ID**: Verifica que `tag.id !== undefined` antes de usar

## Funcionamiento del RBAC

### Cuando `DASHBOARD_RBAC = True` (en config.py)

El sistema verifica:

1. **Ownership**: ¿Es el usuario dueño del dashboard?
2. **Roles con permisos**: ¿El rol del usuario tiene permisos específicos sobre este dashboard?
3. **Permisos de datasource**: ¿El usuario tiene acceso a las fuentes de datos del dashboard?

### Cuando `DASHBOARD_RBAC = False`

El sistema verifica:

1. **Permisos generales**: ¿El usuario tiene permiso `can_read` en `Dashboard`?
2. Sin restricciones por ownership o roles específicos

## Flujo Completo

```
1. Usuario abre lista de dashboards
   ↓
2. Panel de tags se hace visible
   ↓
3. Frontend llama: GET /api/v1/tag/get_objects/?types=dashboard
   ↓
4. Backend (tags/api.py):
   - Llama a TagDAO.get_tagged_objects_for_tags(['dashboard'])
   ↓
5. TagDAO.get_tagged_objects_for_tags():
   - Query: obtiene todos los dashboards con tags
   - Para cada dashboard:
     a. security_manager.can_access_dashboard(obj)
     b. Si True: incluir en results
     c. Si False: omitir
   - Retorna solo dashboards accesibles
   ↓
6. Frontend:
   - Recibe lista de dashboards filtrados
   - Agrupa por tag_id
   - Cuenta dashboards por tag
   - Muestra solo tags que tienen ≥1 dashboard accesible
```

## Casos de Uso

### Caso 1: Usuario con acceso limitado
- Usuario: "analista"
- Rol: "Analyst"
- Dashboards visibles: 5 de 50 totales
- Tags en el sistema: 15
- **Resultado**: Panel muestra solo 3 tags (las que corresponden a esos 5 dashboards)

### Caso 2: Usuario administrador
- Usuario: "admin"
- Rol: "Admin"
- Dashboards visibles: 50 de 50 (todos)
- Tags en el sistema: 15
- **Resultado**: Panel muestra las 15 tags

### Caso 3: Usuario sin acceso a dashboards
- Usuario: "guest"
- Rol: "Public"
- Dashboards visibles: 0
- **Resultado**: Panel muestra "No tags available"

## Seguridad

### Principios aplicados:

1. **Fail-safe**: Si hay error verificando permisos, NO se incluye el objeto
2. **Sin información sensible**: Usuario no sabe qué dashboards existen si no tiene acceso
3. **Consistencia**: Las tags mostradas siempre corresponden a dashboards visibles en la lista
4. **No bypass**: Imposible acceder a un dashboard a través de una tag si no tiene permisos

### Logging:

```python
logger.warning(f"Error checking dashboard permissions: {ex}")
```

Si hay errores verificando permisos, se loguean pero NO se exponen al usuario.

## Testing

### Pruebas recomendadas:

1. **Con DASHBOARD_RBAC = True**:
   - Usuario owner ve sus tags
   - Usuario sin ownership no ve tags de dashboards ajenos
   - Admin ve todas las tags

2. **Con DASHBOARD_RBAC = False**:
   - Usuario con permiso `can_read` ve todas las tags
   - Usuario sin permiso no ve tags

3. **Sincronización**:
   - Seleccionar tag desde panel → lista se filtra correctamente
   - Seleccionar tag desde filtro header → panel muestra tag seleccionada
   - Tags mostradas siempre tienen dashboards visibles

4. **Casos edge**:
   - Dashboards sin tags → no afectan conteo
   - Tags sin dashboards accesibles → no aparecen en panel
   - Cambio de permisos → refrescar panel muestra tags actualizadas

## Notas Técnicas

- El filtrado ocurre en el backend (más seguro)
- No se envían datos sensibles al frontend
- El frontend solo recibe objetos que el usuario puede ver
- La lógica es consistente con el resto de Superset (DashboardList, ChartList, etc.)

## Archivos Modificados

1. `superset/daos/tag.py` - Agregado filtrado RBAC
2. `superset-frontend/src/features/dashboards/DashboardTagSidebar.tsx` - Mejorado manejo de respuestas
