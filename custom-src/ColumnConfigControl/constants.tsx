/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { GenericDataType, t, validateNumber } from '@superset-ui/core';
import {
  ControlFormItemSpec,
  D3_FORMAT_DOCS,
  D3_FORMAT_OPTIONS,
  D3_TIME_FORMAT_DOCS,
  D3_TIME_FORMAT_OPTIONS,
} from '@superset-ui/chart-controls';
import { Icons } from '@superset-ui/core/components/Icons';
import { ColumnConfigFormLayout } from './types';

export type SharedColumnConfigProp =
  | 'alignPositiveNegative'
  | 'colorPositiveNegative'
  | 'columnWidth'
  | 'displayName'
  | 'fractionDigits'
  | 'd3NumberFormat'
  | 'd3SmallNumberFormat'
  | 'd3TimeFormat'
  | 'horizontalAlign'
  | 'truncateLongCells'
  | 'showCellBars'
  | 'visible'
  | 'customColumnName'
  | 'displayTypeIcon'
  | 'currencyFormat'
  | 'enableHtmlTemplate'
  | 'htmlTemplate'
  | 'htmlCss';

export type HtmlTemplateExample = {
  key: string;
  title: string;
  summary: string;
  note?: string;
  htmlTemplate: string;
  css: string;
};

const d3NumberFormat: ControlFormItemSpec<'Select'> = {
  allowNewOptions: true,
  controlType: 'Select',
  label: t('D3 format'),
  description: D3_FORMAT_DOCS,
  options: D3_FORMAT_OPTIONS.map(option => ({
    value: option[0],
    label: option[1],
  })),
  defaultValue: D3_FORMAT_OPTIONS[0][0],
  creatable: true,
  minWidth: '14em',
  debounceDelay: 500,
};

const d3TimeFormat: ControlFormItemSpec<'Select'> = {
  controlType: 'Select',
  label: t('D3 format'),
  description: D3_TIME_FORMAT_DOCS,
  options: D3_TIME_FORMAT_OPTIONS.map(option => ({
    value: option[0],
    label: option[1],
  })),
  defaultValue: D3_TIME_FORMAT_OPTIONS[0][0],
  creatable: true,
  minWidth: '10em',
  debounceDelay: 500,
};

const fractionDigits: ControlFormItemSpec<'Slider'> = {
  controlType: 'Slider',
  label: t('Fraction digits'),
  description: t('Number of decimal digits to round numbers to'),
  min: 0,
  step: 1,
  max: 100,
  defaultValue: 100,
};

const displayName: ControlFormItemSpec<'Input'> = {
  controlType: 'Input',
  label: t('Display name'),
  description: t(
    'Custom display name for the column header. Leave empty to use the original column name. ' +
      'Supports {{Jinja Field}} placeholders resolved from the values selected in "Jinja Fields".',
  ),
  placeholder: t('e.g. Ventas {{anio_num}}'),
  debounceDelay: 500,
};

const columnWidth: ControlFormItemSpec<'InputNumber'> = {
  controlType: 'InputNumber',
  label: t('Min Width'),
  description: t(
    "Default minimal column width in pixels, actual width may still be larger than this if other columns don't need much space",
  ),
  width: 120,
  placeholder: t('auto'),
  debounceDelay: 400,
  validators: [validateNumber],
};

const horizontalAlign: ControlFormItemSpec<'RadioButtonControl'> & {
  value?: 'left' | 'right' | 'center';
  defaultValue?: 'left' | 'right' | 'center';
} = {
  controlType: 'RadioButtonControl',
  label: t('Text align'),
  description: t('Horizontal alignment'),
  width: 130,
  debounceDelay: 50,
  defaultValue: 'left',
  options: [
    ['left', <Icons.AlignLeftOutlined iconSize="m" />],
    ['center', <Icons.AlignCenterOutlined iconSize="m" />],
    ['right', <Icons.AlignRightOutlined iconSize="m" />],
  ],
};

const showCellBars: ControlFormItemSpec<'Checkbox'> = {
  controlType: 'Checkbox',
  label: t('Show cell bars'),
  description: t('Whether to display a bar chart background in table columns'),
  defaultValue: true,
  debounceDelay: 200,
};

const alignPositiveNegative: ControlFormItemSpec<'Checkbox'> = {
  controlType: 'Checkbox',
  label: t('Align +/-'),
  description: t(
    'Whether to align positive and negative values in cell bar chart at 0',
  ),
  defaultValue: false,
  debounceDelay: 200,
};

const colorPositiveNegative: ControlFormItemSpec<'Checkbox'> = {
  controlType: 'Checkbox',
  label: t('Color +/-'),
  description: t(
    'Whether to colorize numeric values by if they are positive or negative',
  ),
  defaultValue: false,
  debounceDelay: 200,
};

const customColumnName: ControlFormItemSpec<'Input'> = {
  controlType: 'Input',
  label: t('Display column name'),
  description: t('Custom column name (leave blank for default)'),
  debounceDelay: 200,
};

const displayTypeIcon: ControlFormItemSpec<'Checkbox'> = {
  controlType: 'Checkbox',
  label: t('Display type icon'),
  description: t('Whether to display the type icon (#, Δ, %)'),
  defaultValue: true,
  debounceDelay: 200,
};

const truncateLongCells: ControlFormItemSpec<'Checkbox'> = {
  controlType: 'Checkbox',
  label: t('Truncate Cells'),
  description: t('Truncate long cells to the "min width" set above'),
  defaultValue: false,
  debounceDelay: 400,
};

const currencyFormat: ControlFormItemSpec<'CurrencyControl'> = {
  controlType: 'CurrencyControl',
  label: t('Currency format'),
  description: t(
    'Customize chart metrics or columns with currency symbols as prefixes or suffixes. Choose a symbol from dropdown or type your own.',
  ),
  debounceDelay: 200,
};

const enableHtmlTemplate: ControlFormItemSpec<'Checkbox'> = {
  controlType: 'Checkbox',
  label: t('HTML render'),
  description: t(
    'Render this column using a custom HTML template defined below. The underlying data remains unchanged for downloads.',
  ),
  defaultValue: false,
  debounceDelay: 200,
};

const htmlTemplate: ControlFormItemSpec<'TextAreaControl'> = {
  controlType: 'TextAreaControl',
  label: t('HTML template'),
  description: t(
    'Supports simple CASE logic and variables such as {{ value }} (formatted) or {{ raw_value }} (raw) alongside other columns like {{ column_name }}. See the examples and AI prompt below for ready-to-use patterns.',
  ),
  placeholder:
    '<span style="display:inline-flex;align-items:center;gap:4px;">{{ value }}</span>',
  debounceDelay: 500,
  // Extra props supported by TextAreaControl (not typed in ControlFormItemSpec)
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  language: 'html',
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  minLines: 6,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  maxLines: 40,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  offerEditInModal: true,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  textAreaStyles: {
    resize: 'vertical',
  },
};

const htmlCss: ControlFormItemSpec<'TextAreaControl'> = {
  controlType: 'TextAreaControl',
  label: t('CSS'),
  description: t(
    'Scoped CSS applied to the HTML template in this cell. Use selectors that target elements created by your HTML template, for example .pill { background: #E8F5E9; color: #1B5E20; }. Example CSS snippets are available below in the HTML tab.',
  ),
  placeholder:
    '.pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  padding: 2px 6px;\n  border-radius: 999px;\n  font-weight: 600;\n}',
  debounceDelay: 500,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  language: 'css',
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  minLines: 6,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  maxLines: 40,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  offerEditInModal: true,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  textAreaStyles: {
    resize: 'vertical',
  },
};

const visible: ControlFormItemSpec<'Checkbox'> = {
  controlType: 'Checkbox',
  label: t('Display column in the chart'),
  description: t('Whether to display in the chart'),
  defaultValue: true,
  debounceDelay: 200,
};

export const HTML_TEMPLATE_EXAMPLES: HtmlTemplateExample[] = [
  {
    key: 'positive-negative-badge',
    title: 'Positive / negative badge',
    summary:
      'Self-contained example that only uses the current cell value via {{ raw_value }} and {{ value }}.',
    htmlTemplate: `{% set variable = raw_value %}
{% set display = value %}

CASE
  WHEN {{variable}} = '' THEN
    <span class="status-badge badge-empty">
      <span class="badge-icon">—</span>
      Sin dato
    </span>
  WHEN {{variable}} > 0 THEN
    <span class="status-badge badge-positive">
      <span class="badge-icon">▲</span>
      {{display}}
    </span>
  ELSE
    <span class="status-badge badge-negative">
      <span class="badge-icon">▼</span>
      {{display}}
    </span>
END`,
    css: `.status-badge {
  padding: 4px 12px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-family: inherit;
  border: 1px solid transparent;
}

.badge-icon {
  font-size: 11px;
  line-height: 1;
}

.badge-empty {
  background: #eceff1;
  color: #455a64;
  border-color: #cfd8dc;
}

.badge-positive {
  background: #e8f5e9;
  color: #1b5e20;
  font-weight: 600;
  border-color: #c8e6c9;
}

.badge-negative {
  background: #ffebee;
  color: #b71c1c;
  font-weight: 600;
  border-color: #ffcdd2;
}`,
  },
  {
    key: 'threshold-badge',
    title: 'Threshold status',
    summary:
      'Maps the current value into OK, warning, and critical states using simple numeric thresholds.',
    note: 'Replace the threshold numbers with values that match your KPI.',
    htmlTemplate: `{% set score = raw_value %}

CASE
  WHEN {{score}} = '' THEN
    <span class="kpi kpi-empty">Sin dato</span>
  WHEN {{score}} >= 80 THEN
    <span class="kpi kpi-ok">{{value}}</span>
  WHEN {{score}} >= 50 THEN
    <span class="kpi kpi-warn">{{value}}</span>
  ELSE
    <span class="kpi kpi-bad">{{value}}</span>
END`,
    css: `.kpi {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  display: inline-block;
  font-family: inherit;
}

.kpi-empty {
  background: #eceff1;
  color: #546e7a;
}

.kpi-ok {
  background: #e8f5e9;
  color: #1b5e20;
}

.kpi-warn {
  background: #fff8e1;
  color: #8d6e63;
}

.kpi-bad {
  background: #ffebee;
  color: #b71c1c;
}`,
  },
  {
    key: 'inventory-badge',
    title: 'Inventory / stock status',
    summary:
      'Useful for numeric stock columns: out of stock, low stock, and healthy stock.',
    note: 'Works with the current cell only. Adjust the cutoff `10` to your own low-stock threshold.',
    htmlTemplate: `{% set stock = raw_value %}

CASE
  WHEN {{stock}} = '' THEN
    <span class="stock stock-empty">Sin dato</span>
  WHEN {{stock}} <= 0 THEN
    <span class="stock stock-out">● Agotado</span>
  WHEN {{stock}} <= 10 THEN
    <span class="stock stock-low">● Bajo {{value}}</span>
  ELSE
    <span class="stock stock-ok">● Disponible {{value}}</span>
END`,
    css: `.stock {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 10px;
  border: 1px solid transparent;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
}

.stock-empty {
  background: #eceff1;
  color: #546e7a;
  border-color: #cfd8dc;
}

.stock-out {
  background: #ffebee;
  color: #b71c1c;
  border-color: #ffcdd2;
}

.stock-low {
  background: #fff8e1;
  color: #8d6e63;
  border-color: #ffe082;
}

.stock-ok {
  background: #e3f2fd;
  color: #1565c0;
  border-color: #bbdefb;
}`,
  },
];

export const HTML_TEMPLATE_AI_PROMPT = `Quiero un formato compatible con plugin-chart-tableV3 de Superset, en Customize columns -> HTML.

Devuelveme exactamente:
1. Un bloque HTML template
2. Un bloque CSS
3. Una explicacion corta

Reglas obligatorias:

- El HTML template NO soporta Jinja completo.
- Si soporta:
  - {{ value }}
  - {{ raw_value }}
  - {{ nombre_columna_real }}
  - {% set variable = nombre_columna_real %}
  - {% set display = value %}
  - CASE ... WHEN ... THEN ... ELSE ... END
- En los WHEN usa solo comparaciones simples, por ejemplo:
  - {{x}} = ''
  - {{x}} > 0
  - {{x}} >= 80
  - {{x}} >= {{otra_columna}}
- NO uses:
  - SUM(), AVG(), COUNT(), MIN(), MAX()
  - OR, AND, IS NULL, IN
  - comentarios {# ... #}
  - macros o filtros Jinja
- En el CSS si puedes usar:
  - clases
  - selectores descendentes
  - multiples selectores separados por coma
  - @keyframes
  - animation
- Evita depender de SVG; usa mejor caracteres como ▲, ▼, ●, —.
- Usa font-family: inherit.
- El resultado debe verse bien en tema claro y oscuro.

Datos para construir el formato:
- Nombre real de la columna: [AQUI]
- Que representa: [AQUI]
- Reglas visuales:
  - vacio: [AQUI]
  - positivo / bueno: [AQUI]
  - negativo / malo: [AQUI]
  - umbrales: [AQUI]

Si una idea no es compatible con este plugin, reemplazala por la alternativa mas cercana que si funcione.

Antes de dar la version final, valida mentalmente que el template cumpla estas reglas.`;
/**
 * All configurable column formatting properties.
 */
export const SHARED_COLUMN_CONFIG_PROPS = {
  displayName,
  d3NumberFormat,
  d3SmallNumberFormat: {
    ...d3NumberFormat,
    label: t('Small number format'),
    description: t(
      'D3 number format for numbers between -1.0 and 1.0, ' +
        'useful when you want to have different significant digits for small and large numbers',
    ),
  },
  d3TimeFormat,
  fractionDigits,
  columnWidth,
  customColumnName,
  displayTypeIcon,
  truncateLongCells,
  horizontalAlign,
  showCellBars,
  alignPositiveNegative,
  colorPositiveNegative,
  currencyFormat,
  enableHtmlTemplate,
  htmlTemplate,
  htmlCss,
  visible,
};

export const DEFAULT_CONFIG_FORM_LAYOUT: ColumnConfigFormLayout = {
  [GenericDataType.String]: [
    {
      tab: t('Display'),
      children: [
        ['displayName'],
        [
          'columnWidth',
          { name: 'horizontalAlign', override: { defaultValue: 'left' } },
        ],
        ['truncateLongCells'],
      ],
    },
    {
      tab: t('HTML'),
      children: [['enableHtmlTemplate'], ['htmlTemplate'], ['htmlCss']],
    },
  ],
  [GenericDataType.Numeric]: [
    {
      tab: t('Display'),
      children: [
        ['displayName'],
        [
          'columnWidth',
          { name: 'horizontalAlign', override: { defaultValue: 'right' } },
        ],
        ['showCellBars'],
        ['alignPositiveNegative'],
        ['colorPositiveNegative'],
      ],
    },
    {
      tab: t('Number formatting'),
      children: [
        ['d3NumberFormat'],
        ['d3SmallNumberFormat'],
        ['currencyFormat'],
      ],
    },
    {
      tab: t('HTML'),
      children: [['enableHtmlTemplate'], ['htmlTemplate'], ['htmlCss']],
    },
  ],
  [GenericDataType.Temporal]: [
    {
      tab: t('Display'),
      children: [
        ['displayName'],
        [
          'columnWidth',
          { name: 'horizontalAlign', override: { defaultValue: 'left' } },
        ],
        ['d3TimeFormat'],
      ],
    },
    {
      tab: t('HTML'),
      children: [['enableHtmlTemplate'], ['htmlTemplate'], ['htmlCss']],
    },
  ],
  [GenericDataType.Boolean]: [
    {
      tab: t('Display'),
      children: [
        ['displayName'],
        [
          'columnWidth',
          { name: 'horizontalAlign', override: { defaultValue: 'left' } },
        ],
      ],
    },
    {
      tab: t('HTML'),
      children: [['enableHtmlTemplate'], ['htmlTemplate'], ['htmlCss']],
    },
  ],
};
