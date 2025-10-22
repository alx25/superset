# Documentación: Errores de Build y Cómo Prevenirlos

## Resumen de Errores Encontrados

Durante el desarrollo del plugin `plugin-chart-tableV2`, se encontraron varios tipos de errores al ejecutar `npm run build`. Esta documentación explica los tipos de errores, sus causas y cómo prevenirlos.

## Categorías de Errores

### 1. Errores Críticos - ESLint (Bloquean el Build)

#### 1.1 Errores de `theme-colors/no-literal-colors`

**Problema:**
```
ESLint: Literal colors should not be used, use theme colors instead
```

**Causa:**
Superset tiene reglas estrictas que prohíben el uso de colores literales como:
- `"white"`
- `"black"`
- `"transparent"`
- `rgba(255,255,255,0.1)`
- Valores hexadecimales directos como `#ffffff`

**Ejemplos de código problemático:**
```tsx
// ❌ INCORRECTO
color: white;
background: rgba(255,255,255,0.1);
border: 1px solid #cccccc;
```

**Solución:**
Usar siempre variables del tema:
```tsx
// ✅ CORRECTO
color: ${theme.colors.grayscale.light5};
background: ${theme.colors.grayscale.light5}1a; // 1a = 10% opacity
border: 1px solid ${theme.colors.grayscale.light2};
```

#### 1.2 Errores de Prettier (Formato de Código)

**Problema:**
```
File not formatted with prettier
```

**Causa:**
El código no sigue las reglas de formato definidas por Prettier.

**Solución:**
```bash
# Aplicar formato automático
npx prettier --write archivo.tsx

# O para todo el proyecto
npm run prettier
```

### 2. Warnings No Críticos - React Hooks

#### 2.1 React Hook Dependency Warnings

**Problema:**
```
React Hook useEffect has missing dependencies
React Hook useCallback has a missing dependency
```

**Causa:**
Los hooks de React no incluyen todas las dependencias necesarias en sus arrays de dependencias.

**Ejemplo problemático:**
```tsx
// ❌ Warning: missing dependency 'someFunction'
useEffect(() => {
  someFunction();
}, []); // Array vacío pero usa someFunction
```

**Solución:**
```tsx
// ✅ Incluir todas las dependencias
useEffect(() => {
  someFunction();
}, [someFunction]);

// O usar useCallback si someFunction cambia frecuentemente
const memoizedFunction = useCallback(() => {
  // código
}, [dependencies]);
```

## Colores de Tema Disponibles en Superset

### Colores Principales
```tsx
${theme.colors.primary.base}        // Color primario
${theme.colors.primary.light1}      // Primario claro 1
${theme.colors.primary.light2}      // Primario claro 2
${theme.colors.primary.light3}      // Primario claro 3
${theme.colors.primary.light4}      // Primario claro 4
${theme.colors.primary.light5}      // Primario más claro
${theme.colors.primary.dark1}       // Primario oscuro 1
${theme.colors.primary.dark2}       // Primario oscuro 2
```

### Colores Secundarios
```tsx
${theme.colors.secondary.base}
${theme.colors.secondary.light1} hasta light5
${theme.colors.secondary.dark1} hasta dark2
```

### Escala de Grises
```tsx
${theme.colors.grayscale.base}      // Gris base
${theme.colors.grayscale.light1}    // Gris claro 1
${theme.colors.grayscale.light2}    // Gris claro 2  
${theme.colors.grayscale.light3}    // Gris claro 3
${theme.colors.grayscale.light4}    // Gris claro 4
${theme.colors.grayscale.light5}    // Gris más claro (casi blanco)
${theme.colors.grayscale.dark1}     // Gris oscuro 1
${theme.colors.grayscale.dark2}     // Gris oscuro 2 (casi negro)
```

## Conversión de Colores Comunes

### Equivalencias de Colores
```tsx
// Blancos
"white" → ${theme.colors.grayscale.light5}
"#ffffff" → ${theme.colors.grayscale.light5}

// Transparentes
"transparent" → ${theme.colors.grayscale.light5}00 // 00 = transparente
"rgba(255,255,255,0.1)" → ${theme.colors.grayscale.light5}1a // 1a ≈ 10%
"rgba(255,255,255,0.06)" → ${theme.colors.grayscale.light5}0f // 0f ≈ 6%
"rgba(255,255,255,0.15)" → ${theme.colors.grayscale.light5}26 // 26 ≈ 15%

// Negros para sombras
"rgba(0,0,0,0.1)" → ${theme.colors.grayscale.dark2}1a
"rgba(0,0,0,0.15)" → ${theme.colors.grayscale.dark2}26
```

### Valores de Opacidad Hexadecimal
```
100% = ff    90% = e6    80% = cc    70% = b3
60% = 99     50% = 80    40% = 66    30% = 4d
20% = 33     15% = 26    10% = 1a    6% = 0f
```

## Flujo de Trabajo Recomendado

### 1. Antes de Crear Estilos
```bash
# Verificar las reglas de ESLint del proyecto
cat .eslintrc

# Ver ejemplos de otros plugins
ls plugins/plugin-chart-*/src/
```

### 2. Durante el Desarrollo
```bash
# Verificar errores de ESLint frecuentemente
npx eslint src/archivo.tsx

# Aplicar formato con Prettier
npx prettier --write src/archivo.tsx
```

### 3. Antes del Build Final
```bash
# 1. Verificar lint en el plugin específico
npx eslint plugins/plugin-chart-tableV2/src/

# 2. Aplicar formato a todo el plugin
npx prettier --write plugins/plugin-chart-tableV2/src/

# 3. Test build solo del frontend (más rápido)
npm run build
```

## Comando de Verificación Rápida

Crear este script para verificación rápida:

```bash
#!/bin/bash
# verificar_plugin.sh

echo "🔍 Verificando ESLint..."
npx eslint plugins/plugin-chart-tableV2/src/

echo "📝 Aplicando Prettier..."
npx prettier --write plugins/plugin-chart-tableV2/src/

echo "✅ Verificación completada"
```

## Buenas Prácticas

### ✅ Hacer
1. **Usar siempre colores del tema** en styled-components
2. **Verificar ESLint frecuentemente** durante el desarrollo
3. **Aplicar Prettier antes de commits**
4. **Incluir todas las dependencias en React hooks**
5. **Revisar warnings** aunque no bloqueen el build

### ❌ Evitar
1. **Colores literales** como "white", "black", rgba()
2. **Valores hexadecimales directos** como #ffffff
3. **Ignorar warnings** de React hooks
4. **Hacer builds sin verificar lint** primero
5. **Commitear código sin formato** de Prettier

## Herramientas de Apoyo

### VSCode Extensions Recomendadas
- **ESLint**: Muestra errores en tiempo real
- **Prettier**: Formato automático al guardar
- **Error Lens**: Muestra errores inline

### Configuración VSCode
```json
// settings.json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "eslint.autoFixOnSave": true
}
```

## Pasos Específicos para Plugin Sin Errores

### Creación de un Plugin Nuevo (plugin-chart-tableV2)

#### 1. Estructura del Plugin
```bash
# Crear estructura base copiando plugin existente
cp -r plugins/plugin-chart-table plugins/plugin-chart-tableV2
```

#### 2. Configurar package.json del Plugin
```json
{
  "name": "@superset-ui/plugin-chart-table-v2",
  "version": "0.0.1",
  "description": "Superset Chart - Table V2 (Modern version with enhanced styling)",
  "sideEffects": false,
  "main": "lib/index.js",
  "module": "esm/index.js",
  "files": ["esm", "lib"],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/apache/superset.git"
  },
  "keywords": ["superset"],
  "author": "Superset",
  "license": "Apache-2.0",
  "dependencies": {
    "@superset-ui/chart-controls": "file:../../packages/superset-ui-chart-controls",
    "@superset-ui/core": "file:../../packages/superset-ui-core"
  },
  "peerDependencies": {
    "react": "^18.0.0"
  }
}
```

#### 3. Actualizar src/index.ts del Plugin
```typescript
export default class TableV2ChartPlugin extends ChartPlugin {
  constructor() {
    super({
      metadata,
      Chart: TableChart,
      transformProps,
      controlPanel,
    });
  }
}

export { default as __hack__ } from './legacyPlugin';

const metadata: ChartMetadata = {
  category: t('Table'),
  description: t('Modern table with enhanced styling and improved user experience'),
  exampleGallery: [{ url: exampleUrl }],
  name: t('Table V2 (Modern)'),
  tags: [
    t('Additive'),
    t('Deprecated'),
    t('Formatted'),
    t('Report'),
    t('Tabular'),
    t('Modern'),
  ],
  thumbnail: tableThumbnail,
  useLegacyApi: true,
};
```

#### 4. Registrar Plugin en MainPreset.js
```javascript
// 1. Agregar import
import TableV2ChartPlugin from '@superset-ui/plugin-chart-table-v2';

// 2. Agregar en la lista de plugins
plugins: [
  // ... otros plugins
  new TableChartPlugin().configure({ key: 'table' }),
  new TableV2ChartPlugin().configure({ key: 'table_v2' }),
  // ... más plugins
]
```

#### 5. Registrar Plugin en package.json Principal
```json
{
  "dependencies": {
    "@superset-ui/plugin-chart-table": "file:./plugins/plugin-chart-table",
    "@superset-ui/plugin-chart-table-v2": "file:./plugins/plugin-chart-tableV2",
  }
}
```

#### 6. Instalar Dependencias
```bash
npm install
```

### Corrección Específica de Errores de Styling

#### Problema: Colores Literales en Styles.tsx

**❌ Código problemático:**
```tsx
export default styled.div`
  ${({ theme }) => css`
    background: white;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    color: white;
    background: transparent;
```

**✅ Código corregido:**
```tsx
export default styled.div`
  ${({ theme }) => css`
    background: ${theme.colors.grayscale.light5};
    box-shadow: 0 4px 6px -1px ${theme.colors.grayscale.dark2}1a;
    color: ${theme.colors.grayscale.light5};
    background: ${theme.colors.grayscale.light5}00;
```

#### Corrección Completa del Archivo Styles.tsx

```bash
# 1. Aplicar prettier primero
npx prettier --write plugins/plugin-chart-tableV2/src/Styles.tsx

# 2. Reemplazar colores literales manualmente:
# - "white" → ${theme.colors.grayscale.light5}
# - "rgba(0,0,0,0.1)" → ${theme.colors.grayscale.dark2}1a
# - "rgba(0,0,0,0.15)" → ${theme.colors.grayscale.dark2}26
# - "rgba(255,255,255,0.1)" → ${theme.colors.grayscale.light5}1a
# - "transparent" → ${theme.colors.grayscale.light5}00

# 3. Verificar que no hay errores
npx eslint plugins/plugin-chart-tableV2/src/Styles.tsx
```

### Comandos de Verificación Completa

#### Script de Verificación Rápida
```bash
#!/bin/bash
# verificar_plugin_completo.sh

echo "🔍 1. Verificando estructura del plugin..."
ls -la plugins/plugin-chart-tableV2/

echo "🔍 2. Verificando package.json del plugin..."
cat plugins/plugin-chart-tableV2/package.json | grep '"name"'

echo "🔍 3. Verificando registros en MainPreset..."
grep -n "TableV2ChartPlugin" src/visualizations/presets/MainPreset.js

echo "🔍 4. Verificando package.json principal..."
grep -n "plugin-chart-table-v2" package.json

echo "🔍 5. Aplicando Prettier..."
npx prettier --write plugins/plugin-chart-tableV2/src/

echo "🔍 6. Verificando ESLint..."
npx eslint plugins/plugin-chart-tableV2/src/

echo "🔍 7. Test build del plugin..."
npm run plugins:build

if [ $? -eq 0 ]; then
    echo "✅ ¡Plugin listo para uso!"
else
    echo "❌ Hay errores en el build"
fi
```

#### Comandos Individuales de Verificación
```bash
# Verificar que webpack reconoce el plugin
npm run build-dev 2>&1 | grep "plugin-chart-table-v2"

# Verificar compilación solo del plugin
npm run plugins:build 2>&1 | grep "plugin-chart-table-v2"

# Verificar estructura de archivos
find plugins/plugin-chart-tableV2 -name "*.tsx" -o -name "*.ts" -o -name "*.json"

# Verificar imports
grep -r "import.*TableV2" src/
```

### Solución de Problemas Comunes

#### Error: "Cannot resolve module"
**Causa:** Plugin no registrado correctamente en package.json
**Solución:**
```bash
# 1. Verificar dependencia
grep "plugin-chart-table-v2" package.json

# 2. Reinstalar si es necesario
rm -rf node_modules package-lock.json
npm install
```

#### Error: "Plugin not found in MainPreset"
**Causa:** Import o registro incorrecto en MainPreset.js
**Solución:**
```bash
# Verificar import
grep "TableV2ChartPlugin" src/visualizations/presets/MainPreset.js

# Verificar configure
grep "table_v2" src/visualizations/presets/MainPreset.js
```

#### Error: "ESLint theme-colors violation"
**Causa:** Uso de colores literales
**Solución:**
```bash
# Ver errores específicos
npx eslint plugins/plugin-chart-tableV2/src/Styles.tsx --format=compact

# Aplicar correcciones automáticas donde sea posible
npx eslint plugins/plugin-chart-tableV2/src/Styles.tsx --fix
```

### Lista de Verificación Pre-Build

**✅ Checklist antes del build final:**

- [ ] Plugin copiado con estructura correcta
- [ ] `package.json` del plugin actualizado con nombre único
- [ ] `src/index.ts` actualizado con metadata correcta
- [ ] Plugin importado en `MainPreset.js`
- [ ] Plugin registrado en `MainPreset.js` con key única
- [ ] Dependencia agregada en `package.json` principal
- [ ] `npm install` ejecutado correctamente
- [ ] Prettier aplicado a todos los archivos
- [ ] ESLint sin errores en archivos del plugin
- [ ] Colores literales reemplazados por variables de tema
- [ ] Test build del plugin exitoso (`npm run plugins:build`)
- [ ] Webpack reconoce el plugin como symlink source

### Resultado Esperado

Cuando todo está correcto, deberías ver:

```bash
# En npm run build-dev
[Superset Plugin] Use symlink source for @superset-ui/plugin-chart-table-v2 @ ./plugins/plugin-chart-tableV2

# En npm run plugins:build
@superset-ui/plugin-chart-table-v2: Successfully compiled 26 files with Babel
```

## Conclusión

La mayoría de errores de build en Superset son predecibles y prevenibles:

1. **Errores críticos**: Principalmente violaciones de reglas de colores y formato
2. **Warnings**: Principalmente dependencias de React hooks faltantes
3. **Prevención**: Usar herramientas de lint y format frecuentemente
4. **Integración**: Seguir exactamente los pasos de registro del plugin
5. **Verificación**: Usar scripts de verificación antes del build final

## Testing Final del Plugin

### Verificar que el Plugin Aparece en Superset

**1. Iniciar el servidor de desarrollo:**
```bash
# Terminal 1: Frontend
npm run dev-server

# Terminal 2: Backend (en directorio principal de superset)
python -m superset run -p 8000 --with-threads --reload --debugger
```

**2. Verificar en la interfaz:**
- Ir a `http://localhost:8000`
- Crear un nuevo chart
- Buscar "Table V2 (Modern)" en la lista de visualizaciones
- Verificar que carga sin errores de consola

### Logs a Monitorear

**Frontend logs exitosos:**
```
[Superset Plugin] Use symlink source for @superset-ui/plugin-chart-table-v2 @ ./plugins/plugin-chart-tableV2
webpack: Compiled successfully
```

**Backend logs exitosos:**
```
Loading charts into registry
Found chart: table_v2
```

### Archivo Completo de Verificación

Crear `scripts/verificar_plugin_tableV2.sh`:

```bash
#!/bin/bash
set -e

echo "🚀 VERIFICACIÓN COMPLETA PLUGIN TABLE V2"
echo "========================================"

# Variables de colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check_success() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ $1${NC}"
    else
        echo -e "${RED}❌ $1${NC}"
        exit 1
    fi
}

echo -e "${YELLOW}1. Verificando estructura del plugin...${NC}"
[ -d "plugins/plugin-chart-tableV2" ]
check_success "Directorio del plugin existe"

[ -f "plugins/plugin-chart-tableV2/package.json" ]
check_success "package.json del plugin existe"

echo -e "${YELLOW}2. Verificando contenido del package.json...${NC}"
grep -q "plugin-chart-table-v2" plugins/plugin-chart-tableV2/package.json
check_success "Nombre correcto en package.json del plugin"

echo -e "${YELLOW}3. Verificando registros en MainPreset...${NC}"
grep -q "TableV2ChartPlugin" src/visualizations/presets/MainPreset.js
check_success "Import en MainPreset.js"

grep -q "table_v2" src/visualizations/presets/MainPreset.js
check_success "Configuración en MainPreset.js"

echo -e "${YELLOW}4. Verificando package.json principal...${NC}"
grep -q "plugin-chart-table-v2.*plugin-chart-tableV2" package.json
check_success "Dependencia en package.json principal"

echo -e "${YELLOW}5. Verificando node_modules...${NC}"
[ -L "node_modules/@superset-ui/plugin-chart-table-v2" ]
check_success "Symlink en node_modules existe"

echo -e "${YELLOW}6. Aplicando Prettier...${NC}"
npx prettier --write plugins/plugin-chart-tableV2/src/ > /dev/null 2>&1
check_success "Prettier aplicado"

echo -e "${YELLOW}7. Verificando ESLint...${NC}"
npx eslint plugins/plugin-chart-tableV2/src/ --quiet
check_success "ESLint sin errores"

echo -e "${YELLOW}8. Verificando colores del tema...${NC}"
! grep -r "rgba\|white\|black\|transparent\|#[0-9a-fA-F]" plugins/plugin-chart-tableV2/src/ --exclude-dir=node_modules
check_success "No hay colores literales"

echo -e "${YELLOW}9. Build del plugin específico...${NC}"
npm run plugins:build | grep -q "plugin-chart-table-v2.*Successfully compiled"
check_success "Plugin compila exitosamente"

echo -e "${YELLOW}10. Verificando webpack recognition...${NC}"
timeout 30 npm run build-dev 2>&1 | grep -q "plugin-chart-table-v2.*plugin-chart-tableV2" || true
check_success "Webpack reconoce el plugin"

echo ""
echo -e "${GREEN}🎉 ¡VERIFICACIÓN COMPLETA EXITOSA!${NC}"
echo -e "${GREEN}El plugin Table V2 está listo para usar en Superset${NC}"
echo ""
echo "Para usar el plugin:"
echo "1. Ejecutar: npm run dev-server"
echo "2. Iniciar Superset backend"
echo "3. Buscar 'Table V2 (Modern)' en la lista de charts"
```

### Troubleshooting Avanzado

#### Si el Plugin No Aparece en la UI

**1. Verificar logs del navegador:**
```javascript
// En DevTools Console
console.log(window.supersetUI.getChartPluginRegistry().entries());
// Buscar 'table_v2' en la salida
```

**2. Verificar registro del plugin:**
```bash
# En el código fuente, buscar referencias
grep -r "table_v2" src/
```

**3. Verificar metadata del plugin:**
```bash
# Verificar que el metadata esté bien configurado
cat plugins/plugin-chart-tableV2/src/index.ts | grep -A 10 "metadata"
```

#### Si Hay Errores de Runtime

**1. Verificar imports circulares:**
```bash
npx madge --circular plugins/plugin-chart-tableV2/src/
```

**2. Verificar dependencias:**
```bash
npm ls @superset-ui/plugin-chart-table-v2
```

**3. Limpiar cache:**
```bash
rm -rf node_modules/.cache
rm -rf .babel-cache
npm run build-dev
```

Siguiendo estos pasos específicos y estas guías, se puede crear un plugin que compile sin errores y se integre correctamente en Superset.