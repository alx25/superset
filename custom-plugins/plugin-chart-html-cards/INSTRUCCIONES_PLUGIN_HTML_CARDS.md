# HTML Cards

Guia de uso del plugin `html_cards` para crear tarjetas HTML/CSS en Superset v6.1.0.

## Objetivo del plugin

`HTML Cards` permite renderizar resultados de un dataset como tarjetas personalizadas usando:

- HTML con Handlebars
- CSS personalizado
- aliases estables por `Display name`
- helpers de formato y logica
- diseno responsive basado en el tamano real del chart

No es un motor de JS arbitrario. El caso de uso ideal es:

- KPIs
- tarjetas resumen
- grids de cards
- bloques tipo ficha
- hover states
- tooltips simples con CSS
- layouts adaptables al dashboard

## Requisito previo: HTML_SANITIZATION

El plugin requiere que el backend tenga `HTML_SANITIZATION = False` en `superset/config.py`.
Sin esto, el HTML renderizado por el template es sanitizado por DOMPurify y el resultado es
vacio o incorrecto.

Esto ya esta configurado en la instalacion actual via el script de migracion.

---

## Donde se configura

En Explore, el chart tiene dos grupos principales:

- `Query`
- `Cards`

### Query

Soporta los modos normales de tabla:

- `Aggregate`
- `Raw records`

Campos disponibles segun el modo:

- `Group by`
- `Metrics`
- `Percentage metrics`
- `Columns`
- `Ordering`
- `Row limit`
- `Include time`
- `Show summary`
- `Filters`

### Cards

- `Customize columns`
- `Card template`
- `Card CSS`

Los editores `Card template` y `Card CSS` incluyen el boton `Open in modal` para trabajar con plantillas largas sin quedar limitado al recuadro de Explore.

## Flujo recomendado

1. Define la consulta.
2. En `Customize columns`, asigna `Display name` legibles y estables. Recuerda que se convierten a snake_case como clave en `displayRows`.
3. En `Card template`, usa `data`, `rows` o `firstRow` para nombres originales; usa `displayRows` o `firstDisplayRow` para nombres configurados.
4. En `Card CSS`, define tus clases.
5. Ajusta responsive con `layout` o `@container`.
6. Si el template accede filas por indice, usa `data.[0]`, `data.[1]`, etc.

## Tooltips y overlays

El plugin ya permite que overlays CSS salgan del contenido del chart, pero tu template no debe volver a recortarlos.

Reglas practicas:

- evita `overflow: hidden` en la tarjeta o en el contenedor inmediato del tooltip
- usa `position: relative` en la tarjeta base
- usa `position: absolute` en el tooltip o panel flotante
- sube `z-index` en hover si el overlay debe quedar por encima de otros elementos de la misma tarjeta

Ejemplo:

```css
.card {
  position: relative;
  overflow: visible;
}

.card__tooltip {
  position: absolute;
  left: 0;
  top: calc(100% + 8px);
  z-index: 20;
  opacity: 0;
  pointer-events: none;
}

.card:hover .card__tooltip {
  opacity: 1;
}
```

## Conceptos clave

### 1. `data` y `rows`

Contienen la respuesta cruda del query.

Ejemplo:

```hbs
{{#each data}}
  <div>{{this.valor}}</div>
{{/each}}
```

### 2. `displayRows`

Contiene las mismas filas, pero con claves amigables derivadas del `Display name`.

Esto evita depender de nombres tecnicos del backend como:

- `titulo_9fef7d`
- `sum__enfirme_a13b92`

Si en `Customize columns` defines:

- `titulo_9fef7d` -> `titulo`
- `sum__enfirme_a13b92` -> `valor_actual`

entonces en el template puedes usar:

```hbs
{{firstDisplayRow.titulo}}
{{firstDisplayRow.valor_actual}}
```

**Importante — transformacion `snakeCase`:**

Las claves en `displayRows` son el `Display name` convertido a `snake_case` con `lodash.snakeCase`.
Esto significa que los espacios, guiones y mayusculas se transforman. Ejemplos:

| Display name     | templateKey (clave en displayRows) |
|------------------|------------------------------------|
| `BMP`            | `bmp`                              |
| `Kg producidos`  | `kg_producidos`                    |
| `Total Ventas`   | `total_ventas`                     |
| `fecha`          | `fecha`                            |
| `Bodegas_General`| `bodegas_general`                  |

Si en el template usas `{{firstDisplayRow.BMP}}` pero el Display name es `BMP`, debes escribir
`{{firstDisplayRow.bmp}}` (en minuscula). Para evitar esta confusion, asigna Display names que
ya sean snake_case o verifica la clave exacta con el helper `stringify`:

```hbs
<pre>{{stringify firstDisplayRow}}</pre>
```

**Alternativa sin transformacion:** usa `data` o `rows` directamente para acceder a los valores
con los nombres de columna originales tal como los devuelve el backend.

### 3. `columns`

Es metadata util para construir templates genericos.

Cada elemento de `columns` incluye:

- `key`: nombre real devuelto por el query
- `displayName`: nombre visible o alias configurado
- `templateKey`: clave segura para usar en Handlebars
- `type`: tipo generico
- `isMetric`
- `isPercentMetric`

Ejemplo:

```hbs
{{#each columns}}
  <div>{{displayName}} -> {{templateKey}}</div>
{{/each}}
```

### 4. `firstRow` y `firstDisplayRow`

Son utiles cuando la consulta devuelve una sola fila KPI.

- `firstRow`: primera fila de `data` con los nombres de columna originales del backend.
- `firstDisplayRow`: primera fila de `displayRows` con claves en snake_case del Display name.

`firstRow` es la opcion mas confiable porque no depende de la transformacion snake_case:

```hbs
<h2>{{firstRow.titulo}}</h2>
<strong>{{firstRow.valor_actual}}</strong>
```

`firstDisplayRow` funciona cuando el Display name esta configurado y los nombres son los
correctos en snake_case:

```hbs
<h2>{{firstDisplayRow.titulo}}</h2>
<strong>{{firstDisplayRow.valor_actual}}</strong>
```

### 5. Acceso por indice: `data.[N]`

Para acceder a una fila especifica por posicion usa la notacion de punto con corchetes de
Handlebars. Esto es mas confiable que el helper `lookup` para indices numericos:

```hbs
{{data.[0].fecha}}
{{data.[1].BMP}}
{{data.[3].kg}}
```

Para iterar cuatro filas especificas usando block parameters:

```hbs
{{#with data.[0] as |m1|}}
{{#with @root.data.[1] as |m2|}}
{{#with @root.data.[2] as |m3|}}
{{#with @root.data.[3] as |m4|}}

  <th>{{m1.fecha}}</th>
  <th>{{m2.fecha}}</th>
  <td>{{numberFormatD3 m1.BMP ",.2f"}}</td>

{{/with}}{{/with}}{{/with}}{{/with}}
```

**Nota:** `{{lookup rows 0}}` con indices numericos puede no funcionar correctamente en
algunas versiones. Usa `data.[N]` en su lugar.

## Contexto disponible en Handlebars

Variables raiz:

| Variable          | Descripcion                                                       |
|-------------------|-------------------------------------------------------------------|
| `data`            | Array de filas con nombres de columna originales del backend      |
| `rows`            | Igual que `data`                                                  |
| `rowCount`        | `data.length`                                                     |
| `firstRow`        | `data[0]` — primera fila con nombres originales                   |
| `displayRows`     | Array de filas con claves en snake_case del Display name          |
| `firstDisplayRow` | `displayRows[0]` — primera fila con claves Display name           |
| `columns`         | Metadata de columnas (key, displayName, templateKey, type...)     |
| `width`           | Ancho del chart en px                                             |
| `height`          | Alto del chart en px                                              |
| `layout`          | Flags de tamano calculadas                                        |
| `scopeId`         | ID unico de esta instancia del chart                              |
| `scopeSelector`   | Selector CSS de esta instancia                                    |
| `themeVars`       | Colores y tipografia del tema actual de Superset                  |

**Cuando usar `data`/`firstRow` vs `displayRows`/`firstDisplayRow`:**

- Usa `data` o `firstRow` cuando los nombres de columna ya son legibles o cuando quieres acceder
  exactamente con el nombre devuelto por el query.
- Usa `displayRows` o `firstDisplayRow` cuando definiste `Display name` en `Customize columns` y
  quieres usar esos alias estables. Recuerda que la clave es `snakeCase(displayName)`.

Ejemplo de acceso a filas por indice (confiable):

```hbs
{{data.[0].fecha}}   {{! primera fila }}
{{data.[1].ventas}}  {{! segunda fila }}
```

### `layout`

Flags calculadas por tamano del chart:

- `layout.width`
- `layout.height`
- `layout.isNarrow`
- `layout.isTiny`
- `layout.isShort`
- `layout.isCompact`

Ejemplo:

```hbs
<article class="card {{#if layout.isCompact}}card--compact{{/if}}">
  ...
</article>
```

### `scopeId` y `scopeSelector`

Cada instancia del chart recibe un scope unico.

No necesitas usarlo manualmente en la mayoria de los casos, porque el `Card CSS` se encapsula automaticamente para esa instancia del chart.

Puede servir si quieres imprimirlo o depurar:

```hbs
<small>{{scopeSelector}}</small>
```

### `themeVars`

Expose un subconjunto del tema actual de Superset dentro del template:

- `themeVars.colorPrimary`
- `themeVars.colorPrimaryBg`
- `themeVars.colorBgContainer`
- `themeVars.colorBgElevated`
- `themeVars.colorBorder`
- `themeVars.colorText`
- `themeVars.colorTextSecondary`
- `themeVars.colorSuccess`
- `themeVars.colorWarning`
- `themeVars.colorError`
- `themeVars.borderRadius`
- `themeVars.fontFamily`
- `themeVars.fontSize`
- `themeVars.fontSizeSM`

Ademas, estos mismos valores se inyectan como CSS variables en el contenedor del chart.

## CSS variables del theme

Disponibles en el CSS del chart:

- `--html-cards-theme-color-primary`
- `--html-cards-theme-color-primary-bg`
- `--html-cards-theme-color-bg-container`
- `--html-cards-theme-color-bg-elevated`
- `--html-cards-theme-color-border`
- `--html-cards-theme-color-text`
- `--html-cards-theme-color-text-secondary`
- `--html-cards-theme-color-success`
- `--html-cards-theme-color-warning`
- `--html-cards-theme-color-error`
- `--html-cards-theme-border-radius`
- `--html-cards-theme-font-family`
- `--html-cards-theme-font-size`
- `--html-cards-theme-font-size-sm`

Ejemplo:

```css
.card {
  background: var(--html-cards-theme-color-bg-container);
  color: var(--html-cards-theme-color-text);
  border: 1px solid var(--html-cards-theme-color-border);
  border-radius: var(--html-cards-theme-border-radius);
  font-family: var(--html-cards-theme-font-family);
}
```

## Helpers disponibles

### Helpers propios del plugin

- `dateFormat`
- `stringify`
- `formatNumber`
- `numberFormatD3`
- `timeFormatD3`
- `coalesce`
- `pluck`
- `hasValue`
- `parseJson`
- `sum`

### Helpers adicionales

Tambien estan registrados:

- `just-handlebars-helpers`
- `handlebars-group-by`

Esto te da helpers extra de logica, arrays, strings y utilidades ya disponibles en runtime.

### Helpers nativos de Handlebars que tambien puedes usar

Ademas de los helpers registrados por el plugin, Handlebars ya trae sus propios bloques y utilidades base:

- `#if`
- `#unless`
- `#each`
- `#with`
- `lookup`

Ejemplos:

```hbs
{{#if rowCount}}...{{/if}}
{{#each displayRows}}...{{/each}}
{{lookup firstDisplayRow "valor_actual"}}
```

## Detalle de helpers

### `dateFormat`

Formatea fechas con `dayjs`.

```hbs
{{dateFormat fecha format="YYYY-MM-DD"}}
```

### `stringify`

Convierte objetos a JSON.

```hbs
<pre>{{stringify firstDisplayRow}}</pre>
```

### `formatNumber`

Formatea numeros con `toLocaleString`.

```hbs
{{formatNumber valor_actual}}
{{formatNumber valor_actual "es-ES"}}
```

### `numberFormatD3`

Usa los formateadores nativos de Superset.

```hbs
{{numberFormatD3 ventas "$,.2f"}}
{{numberFormatD3 avance_pct ".1%"}}
{{numberFormatD3 unidades ",.0f"}}
```

### `timeFormatD3`

Usa los time formatters nativos de Superset.

```hbs
{{timeFormatD3 fecha "%Y-%m"}}
{{timeFormatD3 fecha "%d/%m/%Y"}}
```

### `coalesce`

Devuelve el primer valor no vacio.

```hbs
{{coalesce titulo nombre "Sin titulo"}}
```

### `pluck`

Extrae una propiedad de todos los elementos de un array.

```hbs
{{pluck rows "ventas"}}
{{sum (pluck rows "ventas")}}
```

### `hasValue`

Evalua si el valor existe y considera `0` como valido.

```hbs
{{#if (hasValue variacion_pct)}}
  {{variacion_pct}}%
{{/if}}
```

### `parseJson`

Convierte un string JSON a objeto.

```hbs
{{#with (parseJson payload_json)}}
  <span>{{status}}</span>
{{/with}}
```

### `sum`

Suma numeros directos o todos los valores de un array.

Ejemplos:

```hbs
{{sum 10 20}}
{{sum 10 20 5}}
{{sum (pluck rows "ventas")}}
```

## Helpers adicionales mas utiles de `just-handlebars-helpers`

La libreria auxiliar ya registrada trae varios helpers, pero es importante usar los nombres exactos.

### Logica y comparacion

- `eq`
- `eqw`
- `neq`
- `neqw`
- `lt`
- `lte`
- `gt`
- `gte`
- `not`
- `ifx`
- `and`
- `or`
- `includes`
- `empty`
- `count`

Ejemplos:

```hbs
{{#if (gt firstDisplayRow.avance_pct 100)}}Excelente{{else}}A mejorar{{/if}}
{{#if (and (hasValue firstDisplayRow.meta) (gt firstDisplayRow.meta 0))}}...{{/if}}
```

### Strings

- `lowercase`
- `uppercase`
- `capitalizeFirst`
- `capitalizeEach`
- `concat`
- `join`
- `excerpt`
- `sanitize`
- `newLineToBr`

Ejemplos:

```hbs
{{uppercase firstDisplayRow.estado}}
{{concat firstDisplayRow.titulo " - " firstDisplayRow.subtitulo}}
```

### Arrays

- `first`
- `last`
- `count`
- `join`

Ejemplos:

```hbs
{{first displayRows}}
{{count displayRows}}
```

### Matematicos

Estos nombres son importantes porque no siguen los aliases “humanos” mas comunes:

- `sum`
- `difference`
- `multiplication`
- `division`
- `remainder`
- `ceil`
- `floor`
- `abs`

Ejemplos:

```hbs
{{sum 10 20}}
{{sum (pluck rows "ventas")}}
{{difference firstDisplayRow.valor_actual firstDisplayRow.meta}}
{{multiplication firstDisplayRow.valor_actual 1.15}}
{{division firstDisplayRow.valor_actual firstDisplayRow.meta}}
{{abs firstDisplayRow.variacion}}
```

## Errores comunes con helpers

### `Missing helper: "divide"`

Este error no viene de los datos. Significa que el template usa un helper que no existe con ese nombre.

En este plugin:

- `divide` no existe
- `multiply` no existe
- `add` no existe
- `subtract` no existe

Debes usar los nombres reales registrados:

- `division`
- `multiplication`
- `sum`
- `difference`
- `pluck`

Tabla de conversion rapida:

- `divide` -> `division`
- `multiply` -> `multiplication`
- `add` -> `sum`
- `subtract` -> `difference`

Ejemplo correcto:

```hbs
{{division firstDisplayRow.valor_actual firstDisplayRow.meta}}
```

Ejemplo incorrecto:

```hbs
{{divide firstDisplayRow.valor_actual firstDisplayRow.meta}}
```

### `Missing helper` en general

Si ves un mensaje como:

```text
Missing helper: "algo"
```

revisa:

1. si el helper existe realmente con ese nombre
2. si el helper viene de Handlebars base o del plugin
3. si no estas usando un nombre inventado por otra libreria o por ejemplos de internet

Cuando tengas duda, usa temporalmente un template simple y prueba helper por helper.

## Como nombrar campos para tarjetas KPI

No es obligatorio, pero este set funciona muy bien para tarjetas tipo KPI:

- `titulo`
- `subtitulo`
- `estado`
- `estado_clase`
- `valor_actual`
- `meta`
- `variacion`
- `variacion_pct`
- `variacion_negativa`
- `avance_pct`

Ejemplo de una sola fila KPI:

```sql
SELECT
  'Executive KPI Summary' AS titulo,
  'Current vs Target Overview' AS subtitulo,
  CASE
    WHEN SUM(actual) >= SUM(meta) THEN 'ON TRACK'
    ELSE 'BELOW EXPECTATION'
  END AS estado,
  CASE
    WHEN SUM(actual) >= SUM(meta) THEN 'active'
    ELSE 'warning'
  END AS estado_clase,
  SUM(actual) AS valor_actual,
  SUM(meta) AS meta,
  SUM(actual) - SUM(meta) AS variacion,
  ROUND((SUM(actual) - SUM(meta)) * 100.0 / NULLIF(SUM(meta), 0), 1) AS variacion_pct,
  CASE WHEN SUM(actual) - SUM(meta) < 0 THEN true ELSE false END AS variacion_negativa,
  LEAST(100, ROUND(SUM(actual) * 100.0 / NULLIF(SUM(meta), 0), 1)) AS avance_pct
FROM tu_tabla;
```

## Ejemplo 1: tarjeta KPI simple

```hbs
<article class="kpi-mini">
  <header class="kpi-mini__header">
    <h3 class="kpi-mini__title">{{firstDisplayRow.titulo}}</h3>
    <span class="kpi-mini__status kpi-mini__status--{{coalesce firstDisplayRow.estado_clase "active"}}"></span>
  </header>

  <div class="kpi-mini__main">
    <span class="kpi-mini__label">ACTUAL</span>
    <strong class="kpi-mini__value">
      {{numberFormatD3 firstDisplayRow.valor_actual "$,.0f"}}
    </strong>
  </div>

  <footer class="kpi-mini__footer">
    <div class="kpi-mini__meta">
      <span class="kpi-mini__target">
        Meta: <strong>{{numberFormatD3 firstDisplayRow.meta "$,.0f"}}</strong>
      </span>
      <span class="kpi-mini__variance {{#if firstDisplayRow.variacion_negativa}}kpi-mini__variance--negative{{/if}}">
        {{numberFormatD3 firstDisplayRow.variacion_pct ".1f"}}%
      </span>
    </div>

    <div class="kpi-mini__progress">
      <div class="kpi-mini__progress-fill" style="width: {{coalesce firstDisplayRow.avance_pct 0}}%;"></div>
    </div>
  </footer>
</article>
```

```css
.kpi-mini {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 18px;
  border-radius: calc(var(--html-cards-theme-border-radius) + 6px);
  background: linear-gradient(
    145deg,
    var(--html-cards-theme-color-bg-container) 0%,
    var(--html-cards-theme-color-bg-elevated) 100%
  );
  border: 1px solid var(--html-cards-theme-color-border);
  color: var(--html-cards-theme-color-text);
  font-family: var(--html-cards-theme-font-family);
  overflow: hidden;
}

.kpi-mini__header,
.kpi-mini__meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.kpi-mini__title,
.kpi-mini__value,
.kpi-mini__target {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kpi-mini__value {
  color: var(--html-cards-theme-color-primary);
  font-size: clamp(14px, 10cqi, 32px);
  font-weight: 800;
}

.kpi-mini__status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.kpi-mini__status--active {
  background: var(--html-cards-theme-color-primary);
}

.kpi-mini__status--warning {
  background: var(--html-cards-theme-color-warning);
}

.kpi-mini__status--danger {
  background: var(--html-cards-theme-color-error);
}

.kpi-mini__progress {
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: color-mix(
    in srgb,
    var(--html-cards-theme-color-border) 75%,
    transparent
  );
  overflow: hidden;
}

.kpi-mini__progress-fill {
  height: 100%;
  max-width: 100%;
  background: var(--html-cards-theme-color-primary);
}
```

## Ejemplo 2: grid generico de cards

Sirve cuando no conoces aun los nombres exactos de las columnas.

```hbs
<section class="cards-grid">
  {{#if rowCount}}
    {{#each displayRows}}
      <article class="card">
        <h3>{{coalesce titulo (lookup this (lookup (lookup @root.columns 0) "templateKey")) "Card"}}</h3>
        {{#if (lookup @root.columns 1)}}
          <p>
            {{lookup (lookup @root.columns 1) "displayName"}}:
            <strong>{{lookup this (lookup (lookup @root.columns 1) "templateKey")}}</strong>
          </p>
        {{/if}}
      </article>
    {{/each}}
  {{else}}
    <div class="card card--empty">Sin datos</div>
  {{/if}}
</section>
```

```css
.cards-grid {
  display: grid;
  width: 100%;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.card {
  padding: 14px;
  border-radius: var(--html-cards-theme-border-radius);
  background: var(--html-cards-theme-color-bg-container);
  border: 1px solid var(--html-cards-theme-color-border);
}
```

## Ejemplo 3: debug rapido del contexto

```hbs
<h4>Contexto</h4>
<pre>{{stringify firstDisplayRow}}</pre>
<pre>{{stringify columns}}</pre>
<pre>{{stringify layout}}</pre>
```

Esto es util cuando un dataset nuevo no renderiza como esperabas.

## CSS encapsulado por instancia

El `Card CSS` ahora se scopea automaticamente a la instancia actual del chart.

Eso significa que si escribes:

```css
.title {
  color: red;
}
```

el plugin lo reescribe internamente para afectar solo esa tarjeta, no todo el dashboard.

### Que si se preserva

- selectores normales
- listas de selectores
- `@media`
- `@container`
- `@supports`
- `@keyframes`

### Que debes evitar

- depender de estilos globales de `body`, `html` o `:root`
- asumir que una clase del template afectara otros charts

## Responsive real en dashboard

El plugin usa el tamano real del contenedor del chart en dashboard.

El wrapper expone:

- `container-type: size`
- `container-name: html-cards-chart`

Por eso puedes usar:

```css
@container html-cards-chart (max-width: 720px) {
  .cards-grid {
    grid-template-columns: 1fr;
  }
}
```

Y tambien:

```hbs
{{#if layout.isCompact}}
  <article class="card card--compact">
{{else}}
  <article class="card">
{{/if}}
```

## Recomendaciones de modelado

### Si quieres una sola tarjeta KPI

- haz que el query devuelva una sola fila
- usa `firstDisplayRow`

### Si quieres varias tarjetas

- devuelve varias filas
- usa `{{#each displayRows}}`

### Si el backend cambia nombres tecnicos

- define `Display name` en `Customize columns`
- consume `displayRows`

### Si puede haber `0`

- usa `hasValue`
- no uses solo `#if campo` cuando `0` debe ser valido

Ejemplo correcto:

```hbs
{{#if (hasValue firstDisplayRow.variacion_pct)}}
  {{firstDisplayRow.variacion_pct}}%
{{/if}}
```

## Nombres de formData aceptados

El plugin acepta estas variantes:

- `handlebarsTemplate`
- `handlebars_template`
- `styleTemplate`
- `style_template`
- `columnConfig`
- `column_config`
- `allColumns`
- `all_columns`
- `queryMode`
- `query_mode`

## Limitaciones actuales

- No ejecuta JavaScript arbitrario del usuario.
- El HTML se sanitiza si `HTML_SANITIZATION` esta activo — debe estar en `False` para que el plugin funcione.
- El CSS se scopea al chart, pero sigue siendo CSS escrito por el usuario; conviene mantenerlo simple.
- Si el contenido no cabe fisicamente en un recuadro muy pequeno, debes compactar el diseno o recortar detalle.

## Problemas conocidos en v6.1.0

### `lookup` con indices numericos no funciona

`{{lookup rows 0}}` y `{{lookup displayRows 3}}` con numeros pueden retornar `undefined`.

**Workaround:** usa la notacion de punto de Handlebars:

```hbs
{{data.[0].campo}}   {{! en lugar de (lookup rows 0) }}
{{data.[3].campo}}   {{! en lugar de (lookup rows 3) }}
```

Para block `#with` sobre una fila especifica:

```hbs
{{#with data.[0] as |m|}}
  {{m.fecha}} — {{m.BMP}}
{{/with}}
```

### `Missing helper: "numberFormatD3"` — causa mas comun: tipo de chart incorrecto

Superset tambien tiene un plugin nativo llamado `plugin-chart-handlebars` (tipo `handlebars`).
Ese plugin NO tiene `numberFormatD3`, `timeFormatD3`, `hasValue`, `pluck`, `sum` ni los demas
helpers custom. Si ves ese error, lo primero que debes verificar es el tipo de chart.

**Verificar en Explore:** la URL al editar el chart debe contener `viz_type=html_cards`. Si dice
`viz_type=handlebars`, cambia el tipo de visualizacion a `HTML Cards` (html_cards).

Si el tipo ya es correcto y el error persiste:

1. Fuerza un rebuild completo: `npm run build` en `superset_v6_1_0/superset-frontend`.
2. Reinicia el servicio Superset.

Si el error persiste, usa `formatNumber` como alternativa para formatos basicos:

```hbs
{{formatNumber ventas "es-CR"}}  {{! usa toLocaleString }}
```

### `displayRows.length` puede aparecer vacio en el diagnostico

El contexto `displayRows` es funcional pero `{{displayRows.length}}` puede mostrarse vacio
en algunos casos. Usa `{{rowCount}}` o `{{data.length}}` para verificar cuantas filas hay.

## Checklist antes de guardar

- Confirmar que `HTML_SANITIZATION = False` esta en `superset/config.py`.
- Confirmar que el query devuelve filas (usar `{{rowCount}}` o `{{data.length}}` en el template para verificar).
- Si usas `Display name` en columnas, recordar que el templateKey es `snakeCase(displayName)`.
- Usar `firstRow` para acceso a la primera fila con nombres originales del backend.
- Usar `data.[N]` para acceso por indice, no `lookup rows N`.
- Usar `hasValue` para numeros que pueden ser `0`.
- Usar `numberFormatD3` y `timeFormatD3` para alinearte con los formatos nativos de Superset.
- Si `numberFormatD3` da "Missing helper", verificar que el tipo del chart sea `html_cards` y hacer rebuild.
- Usar variables CSS del theme en lugar de colores hardcodeados.
- Probar responsive con distintos tamanos del chart en dashboard.
