<!--
Licensed to the Apache Software Foundation (ASF) under one
or more contributor license agreements.  See the NOTICE file
distributed with this work for additional information
regarding copyright ownership.  The ASF licenses this file
to you under the Apache License, Version 2.0 (the
"License"); you may not use this file except in compliance
with the License.  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an
"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied.  See the License for the
specific language governing permissions and limitations
under the License.
-->

## @superset-ui/plugin-chart-pivot-table-rx1

[![Version](https://img.shields.io/npm/v/@superset-ui/plugin-chart-pivot-table-rx1.svg?style=flat)](https://www.npmjs.com/package/@superset-ui/plugin-chart-pivot-table-rx1)
[![Libraries.io](https://img.shields.io/librariesio/release/npm/%40superset-ui%2Fplugin-chart-pivot-table-rx1?style=flat)](https://libraries.io/npm/@superset-ui%2Fplugin-chart-pivot-table-rx1)

This plugin provides Pivot Table Rx1 for Superset.

If you change the logic of this plugin, please update
[`pivot_table_v2`](https://github.com/apache/superset/blob/master/superset/charts/client_processing.py).

### Usage

Configure `key`, which can be any `string`, and register the plugin. This `key` will be used to
lookup this chart throughout the app.

```js
import { PivotTableChartPluginRx1 } from '@superset-ui/plugin-chart-pivot-table-rx1';

new PivotTableChartPluginRx1().configure({ key: 'pivot_table_rx1' }).register();
```

Then use it via `SuperChart`. See
[storybook](https://apache-superset.github.io/superset-ui/?selectedKind=plugin-chart-pivot-table)
for more details.

```js
<SuperChart
  chartType="pivot_table_rx1"
  width={600}
  height={600}
  formData={...}
  queriesData={[{
    data: {...},
  }]}
/>
```

### Formula metrics (Jinja-like)

You can define derived metrics using `{{Metric}}` placeholders. The expression
is evaluated on the client using the already aggregated values, so totals use
the ratio of totals instead of summing row ratios.

In the **Formula metrics (Jinja-like)** control:
1. Click **Add**.
2. Set **Label**, **Formula** and optional **D3 format**.
3. Use autocomplete in the formula editor to insert `{{Metric}}` and `total./row./col.` variants.

Example:

```
Label: test
Formula: {{Venta}}/{{Plan}}
D3 format: .2%
```

You can also reference totals:

```
Label: peso
Formula: {{Venta}}/total.{{Venta}}
D3 format: .2%
```

Available scopes: `total.{{Metric}}`, `row.{{Metric}}`, `col.{{Metric}}`.

Supported functions: `IF`, `OR`, `AND`, `NOT`, `ISBLANK`, `ABS`, `ROUND`, `MAX`, `MIN`.

Example:

```
Label: peso_cond
Formula: IF(OR({{Kg Rech.}} = 0, {{Kg Rech.}} = ""), "", {{Kg Rech.}}/total.{{Kg Rech.}})
D3 format: .2%
```

You can open the **View all functions** modal from the formula editor for a full list and examples.

### Jinja fields

Use **Jinja fields** to add extra metrics/columns that are *not rendered in the table*.
They are only available for use in **Formula metrics (Jinja-like)**.

Example:

- Jinja fields: `Total Budget`
- Formula metric: `{{Venta}}/{{Total Budget}}`

### Metric order

Use **Metric order** (Data tab) to reorder base metrics and formula metrics together.
Drag items to define the exact column order in the pivot.

Conditional formatting:
- Formula metrics now appear in the conditional formatting list.
- Enable **Solid conditional colors** to use solid colors instead of heatmap opacity.

Note: keep `test` out of the SQL `metrics` list. Only include the base metrics
(`Venta`, `Plan`) so the formula is computed from their totals.

### Customize columns (HTML templates)

In the **Customize** tab, use **Customize columns** to apply HTML templates to
rows, columns, and metrics. This lets you render badges, status pills, and
conditional colors using a Jinja-like syntax.

How it works:
- Enable **HTML render** for the column you want to customize.
- Add an **HTML template**.
- Templates support:
  - `{{ value }}` (formatted value) and `{{ raw_value }}` (raw value).
  - `{{ ColumnName }}` to reference other columns or metrics.
  - Totals with `{{ total.Metric }}`, `{{ row.Metric }}`, `{{ col.Metric }}`.
  - `{% set var = ... %}` for formulas (same functions as formula metrics).
  - `CASE WHEN ... THEN ... ELSE ... END`.

Example:

```
{% set variable = Plan - 1/Real - 2 %}

CASE
  WHEN {{variable}} = '' THEN
    <span style="padding:2px 6px; border-radius:8px; background:#ECEFF1; color:#37474F;">—</span>
  WHEN {{variable}} > 0 THEN
    <span style="padding:2px 6px; border-radius:8px; background:#E8F5E9; color:#1B5E20; font-weight:600;">{{variable}}</span>
  ELSE
    <span style="padding:2px 6px; border-radius:8px; background:#FFEBEE; color:#B71C1C; font-weight:600;">{{variable}}</span>
END
```

Notes:
- For formulas, prefer `{% set ... %}` or `{{ ... }}` with expressions.
- Rendering depends on **Render columns in HTML format** being enabled.

### Table theme (colors)

In the **Customize** tab you can personalize the table look:
- **Header background / text color**
- **Dimension (row header) background / text color**
- **Totals background / text color**
- **Body cell background / text color**
- **Table border color**

These colors override the default theme only when set.
Use **Enable custom table theme** to quickly restore the default (transparent) look.
Each color picker has a clear icon to restore just that section to the original theme.

### File structure generated

```
├── package.json
├── README.md
├── tsconfig.json
├── src
│   ├── PivotTableChart.tsx
│   ├── images
│   │   └── thumbnail.png
│   ├── index.ts
│   ├── plugin
│   │   ├── buildQuery.ts
│   │   ├── controlPanel.ts
│   │   ├── index.ts
│   │   └── transformProps.ts
│   ├── utils
│   │   └── formatValue.ts
│   └── types.ts
├── test
│   └── index.test.ts
└── types
    └── external.d.ts
```
