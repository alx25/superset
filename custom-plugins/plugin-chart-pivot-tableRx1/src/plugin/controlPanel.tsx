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
import {
  ControlPanelConfig,
  D3_TIME_FORMAT_OPTIONS,
  Dataset,
  getStandardizedControls,
  sharedControls,
} from '@superset-ui/chart-controls';
import {
  ensureIsArray,
  GenericDataType,
  getColumnLabel,
  isAdhocColumn,
  isPhysicalColumn,
  QueryFormMetric,
  SMART_DATE_ID,
  t,
} from '@superset-ui/core';
import { nanoid } from 'nanoid';
import { MetricsLayoutEnum } from '../types';

type MetricFormulaItem = {
  key?: string;
  label?: string;
  expression?: string;
  d3format?: string;
  hidden?: boolean;
};

const getMetricLabel = (metric: QueryFormMetric) =>
  typeof metric === 'string' ? metric : metric.label;

const buildMetricOrderOptions = (
  metrics: QueryFormMetric[],
  formulaMetrics: MetricFormulaItem[],
) => {
  const options: Array<{ value: string; label: string }> = [];
  const seen = new Set<string>();
  metrics.forEach(metric => {
    const label = String(getMetricLabel(metric) || '').trim();
    if (!label || seen.has(label)) {
      return;
    }
    seen.add(label);
    options.push({ value: label, label });
  });
  formulaMetrics.forEach(metric => {
    const label = String(metric.label || '').trim();
    if (!label || seen.has(label) || metric.hidden) {
      return;
    }
    seen.add(label);
    options.push({ value: label, label });
  });
  return options;
};

const validateMetricsOrJinjaFormula = (value: unknown, state?: any) => {
  const metricsCount = ensureIsArray(value).length;
  if (metricsCount > 0) {
    return false;
  }
  const jinjaCount = Number(state?.jinjaFieldsCount || 0);
  const formulaCount = Number(state?.formulaMetricsCount || 0);
  if (jinjaCount > 0 && formulaCount > 0) {
    return false;
  }
  return t(
    'Add at least one metric, or both a Jinja field and a formula metric.',
  );
};

const normalizeMetricFormulasValue = (value: unknown): MetricFormulaItem[] => {
  const addKeys = (items: MetricFormulaItem[]) =>
    items
      .map(item => ({
        key: item.key || nanoid(11),
        label: item.label || '',
        expression: item.expression || '',
        d3format: item.d3format || '',
        hidden: item.hidden ?? false,
      }))
      .filter(item => item.label || item.expression || item.d3format);

  if (Array.isArray(value)) {
    return addKeys(value as MetricFormulaItem[]);
  }
  if (!value) {
    return [];
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, any>;
    if (
      'label' in obj ||
      'expression' in obj ||
      'expr' in obj ||
      'd3format' in obj ||
      'format' in obj
    ) {
      return addKeys([
        {
          label: obj.label || '',
          expression: obj.expression || obj.expr || '',
          d3format: obj.d3format || obj.format || '',
        },
      ]);
    }
    return addKeys(
      Object.entries(obj).map(([label, expr]) => {
        if (expr && typeof expr === 'object') {
          const exprObj = expr as Record<string, any>;
          return {
            label,
            expression: exprObj.expression || exprObj.expr || '',
            d3format: exprObj.d3format || exprObj.format || '',
          };
        }
        return { label, expression: String(expr || '') };
      }),
    );
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return addKeys(parsed as MetricFormulaItem[]);
        }
        if (parsed && typeof parsed === 'object') {
          return addKeys(
            Object.entries(parsed).map(([label, expr]) => {
              if (expr && typeof expr === 'object') {
                const exprObj = expr as Record<string, any>;
                return {
                  label,
                  expression: exprObj.expression || exprObj.expr || '',
                  d3format: exprObj.d3format || exprObj.format || '',
                };
              }
              return { label, expression: String(expr || '') };
            }),
          );
        }
      } catch {
        // fall through to line parser
      }
    }
    const lines = trimmed.split('\n');
    const parsedLines = lines
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && !line.startsWith('//'))
      .map(line => {
        const match = line.match(/^([^:=]+)[:=](.+)$/);
        if (!match) {
          return null;
        }
        return {
          label: match[1].trim(),
          expression: match[2].trim(),
        };
      })
      .filter(Boolean) as MetricFormulaItem[];
    return addKeys(parsedLines);
  }
  return [];
};

const mergeMetricLists = (
  metrics: QueryFormMetric[],
  extras: QueryFormMetric[],
) => {
  const seen = new Set<string>();
  const merged: QueryFormMetric[] = [];
  [...ensureIsArray(metrics), ...ensureIsArray(extras)].forEach(metric => {
    const label = String(getMetricLabel(metric) || '').trim();
    if (!label || seen.has(label)) {
      return;
    }
    seen.add(label);
    merged.push(metric);
  });
  return merged;
};

const HTML_COLUMN_CONFIG_LAYOUT = {
  [GenericDataType.Numeric]: [
    { tab: t('HTML'), children: [['enableHtmlTemplate'], ['htmlTemplate']] },
  ],
  [GenericDataType.String]: [
    { tab: t('HTML'), children: [['enableHtmlTemplate'], ['htmlTemplate']] },
  ],
  [GenericDataType.Temporal]: [
    { tab: t('HTML'), children: [['enableHtmlTemplate'], ['htmlTemplate']] },
  ],
  [GenericDataType.Boolean]: [
    { tab: t('HTML'), children: [['enableHtmlTemplate'], ['htmlTemplate']] },
  ],
} as any;

const buildColumnTypeMap = (datasource?: Dataset) => {
  const map: Record<string, GenericDataType> = {};
  const columns = Array.isArray(datasource?.columns) ? datasource?.columns : [];
  columns.forEach((column: any) => {
    const name =
      column?.column_name ?? column?.verbose_name ?? column?.name ?? '';
    if (!name) {
      return;
    }
    const rawType = column?.type_generic ?? column?.typeGeneric;
    map[String(name)] =
      typeof rawType === 'number' ? rawType : GenericDataType.String;
  });
  return map;
};

const config: ControlPanelConfig = {
  onInit: controlState => {
    if (!controlState.metricFormulas) {
      return controlState;
    }
    return {
      ...controlState,
      metricFormulas: {
        ...controlState.metricFormulas,
        value: normalizeMetricFormulasValue(
          controlState.metricFormulas.value,
        ),
      },
    };
  },
  controlPanelSections: [
    {
      label: t('Query'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'groupbyColumns',
            config: {
              ...sharedControls.groupby,
              label: t('Columns'),
              description: t('Columns to group by on the columns'),
            },
          },
        ],
        [
          {
            name: 'groupbyRows',
            config: {
              ...sharedControls.groupby,
              label: t('Rows'),
              description: t('Columns to group by on the rows'),
            },
          },
        ],
        [
          {
            name: 'time_grain_sqla',
            config: {
              ...sharedControls.time_grain_sqla,
              visibility: ({ controls }) => {
                const dttmLookup = Object.fromEntries(
                  ensureIsArray(controls?.groupbyColumns?.options).map(
                    option => [option.column_name, option.is_dttm],
                  ),
                );

                return [
                  ...ensureIsArray(controls?.groupbyColumns.value),
                  ...ensureIsArray(controls?.groupbyRows.value),
                ]
                  .map(selection => {
                    if (isAdhocColumn(selection)) {
                      return true;
                    }
                    if (isPhysicalColumn(selection)) {
                      return !!dttmLookup[selection];
                    }
                    return false;
                  })
                  .some(Boolean);
              },
            },
          },
          'temporal_columns_lookup',
        ],
        [
          {
            name: 'metrics',
            config: {
              ...sharedControls.metrics,
              validators: [validateMetricsOrJinjaFormula],
              validationDependancies: ['jinja_fields', 'metricFormulas'],
              rerender: ['conditional_formatting', 'metricOrder'],
              shouldMapStateToProps() {
                return true;
              },
              mapStateToProps: (state: any, controlState: any, chartState: any) => {
                const base =
                  sharedControls.metrics.mapStateToProps?.(
                    state,
                    controlState,
                    chartState,
                  ) || {};
                const jinjaRaw =
                  state?.controls?.jinja_fields?.value ??
                  state?.form_data?.jinja_fields ??
                  state?.form_data?.jinjaFields;
                const formulaRaw =
                  state?.controls?.metricFormulas?.value ??
                  state?.form_data?.metricFormulas;
                return {
                  ...base,
                  jinjaFieldsCount: ensureIsArray(jinjaRaw).length,
                  formulaMetricsCount:
                    normalizeMetricFormulasValue(formulaRaw).length,
                };
              },
            },
          },
        ],
        [
          {
            name: 'jinja_fields',
            config: {
              ...sharedControls.metrics,
              label: t('Jinja fields'),
              description: t(
                'Metrics/columns available for Formula metrics. These fields will not be rendered in the table.',
              ),
              default: [],
              validators: [],
              renderTrigger: true,
              rerender: ['metricFormulas'],
            },
          },
        ],
        [
          {
            name: 'metricsLayout',
            config: {
              type: 'RadioButtonControl',
              renderTrigger: true,
              label: t('Apply metrics on'),
              default: MetricsLayoutEnum.COLUMNS,
              options: [
                [MetricsLayoutEnum.COLUMNS, t('Columns')],
                [MetricsLayoutEnum.ROWS, t('Rows')],
              ],
              description: t(
                'Use metrics as a top level group for columns or for rows',
              ),
            },
          },
        ],
        [
          {
            name: 'metricFormulas',
            config: {
              type: 'CollectionControl',
              controlName: 'FormulaMetricControl',
              label: t('Formula metrics (Jinja-like)'),
              renderTrigger: true,
              default: [],
              tabOverride: 'data',
              rerender: ['conditional_formatting', 'metricOrder'],
              itemGenerator: () => ({
                key: nanoid(11),
                label: '',
                expression: '',
                d3format: '',
              }),
              description: t(
                'Define derived metrics using {{Metric}} placeholders. ' +
                  'Each item includes label, formula and optional D3 format.',
              ),
              mapStateToProps: (explore: any) => {
                const rawValue =
                  explore?.controls?.metricFormulas?.value ??
                  explore?.form_data?.metricFormulas;
                const rawJinja =
                  explore?.controls?.jinja_fields?.value ??
                  explore?.controls?.jinjaFields?.value ??
                  explore?.form_data?.jinja_fields ??
                  explore?.form_data?.jinjaFields;
                const jinjaFields = ensureIsArray(rawJinja) as QueryFormMetric[];
                const baseMetrics = ensureIsArray(
                  explore?.controls?.metrics?.value ??
                    explore?.form_data?.metrics,
                ) as QueryFormMetric[];
                return {
                  value: normalizeMetricFormulasValue(rawValue),
                  columns: explore?.datasource?.columns || [],
                  metrics: mergeMetricLists(baseMetrics, jinjaFields),
                };
              },
            },
          },
        ],
        [
          {
            name: 'metricOrder',
            config: {
              type: 'MetricOrderControl',
              label: t('Metric order'),
              renderTrigger: true,
              rerender: ['metrics', 'metricFormulas'],
              default: [],
              tabOverride: 'data',
              description: t(
                'Drag to reorder metrics and formula metrics together.',
              ),
              shouldMapStateToProps() {
                return true;
              },
              mapStateToProps: (explore: any) => {
                const metrics = ensureIsArray(
                  explore?.controls?.metrics?.value ??
                    explore?.form_data?.metrics,
                ) as QueryFormMetric[];
                const rawFormulas =
                  explore?.controls?.metricFormulas?.value ??
                  explore?.form_data?.metricFormulas;
                const formulaMetrics = normalizeMetricFormulasValue(rawFormulas);
                return {
                  options: buildMetricOrderOptions(metrics, formulaMetrics),
                };
              },
            },
          },
        ],
        ['adhoc_filters'],
        ['series_limit'],
        [
          {
            name: 'row_limit',
            config: {
              ...sharedControls.row_limit,
              label: t('Cell limit'),
              description: t('Limits the number of cells that get retrieved.'),
            },
          },
        ],
        // TODO(kgabryje): add series_columns control after control panel is redesigned to avoid clutter
        [
          {
            name: 'series_limit_metric',
            config: {
              ...sharedControls.series_limit_metric,
              description: t(
                'Metric used to define how the top series are sorted if a series or cell limit is present. ' +
                  'If undefined reverts to the first metric (where appropriate).',
              ),
            },
          },
        ],
        [
          {
            name: 'order_desc',
            config: {
              type: 'CheckboxControl',
              label: t('Sort Descending'),
              default: true,
              description: t('Whether to sort descending or ascending'),
            },
          },
        ],
      ],
    },
    {
      label: t('Options'),
      expanded: true,
      tabOverride: 'data',
      controlSetRows: [
        [
          {
            name: 'aggregateFunction',
            config: {
              type: 'SelectControl',
              label: t('Aggregation function'),
              clearable: false,
              choices: [
                ['Count', t('Count')],
                ['Count Unique Values', t('Count Unique Values')],
                ['List Unique Values', t('List Unique Values')],
                ['Sum', t('Sum')],
                ['Average', t('Average')],
                ['Median', t('Median')],
                ['Sample Variance', t('Sample Variance')],
                ['Sample Standard Deviation', t('Sample Standard Deviation')],
                ['Minimum', t('Minimum')],
                ['Maximum', t('Maximum')],
                ['First', t('First')],
                ['Last', t('Last')],
                ['Sum as Fraction of Total', t('Sum as Fraction of Total')],
                ['Sum as Fraction of Rows', t('Sum as Fraction of Rows')],
                ['Sum as Fraction of Columns', t('Sum as Fraction of Columns')],
                ['Count as Fraction of Total', t('Count as Fraction of Total')],
                ['Count as Fraction of Rows', t('Count as Fraction of Rows')],
                [
                  'Count as Fraction of Columns',
                  t('Count as Fraction of Columns'),
                ],
              ],
              default: 'Sum',
              description: t(
                'Aggregate function to apply when pivoting and computing the total rows and columns',
              ),
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'rowTotals',
            config: {
              type: 'CheckboxControl',
              label: t('Show rows total'),
              default: false,
              renderTrigger: true,
              description: t('Display row level total'),
            },
          },
        ],
        [
          {
            name: 'rowSubTotals',
            config: {
              type: 'CheckboxControl',
              label: t('Show rows subtotal'),
              default: false,
              renderTrigger: true,
              description: t('Display row level subtotal'),
            },
          },
        ],
        [
          {
            name: 'rowCollapseByDefault',
            config: {
              type: 'CheckboxControl',
              label: t('Collapse rows by default'),
              default: false,
              renderTrigger: true,
              description: t(
                'Start row subtotal groups collapsed so users can expand them.',
              ),
              visibility: ({ controls }) => Boolean(controls?.rowSubTotals?.value),
            },
          },
        ],
        [
          {
            name: 'compactRowTree',
            config: {
              type: 'CheckboxControl',
              label: t('Compact row tree'),
              default: false,
              renderTrigger: true,
              description: t(
                'Display row fields in a single expandable tree column.',
              ),
              visibility: ({ controls }) => Boolean(controls?.rowSubTotals?.value),
            },
          },
        ],
        [
          {
            name: 'colTotals',
            config: {
              type: 'CheckboxControl',
              label: t('Show columns total'),
              default: false,
              renderTrigger: true,
              description: t('Display column level total'),
            },
          },
        ],
        [
          {
            name: 'colSubTotals',
            config: {
              type: 'CheckboxControl',
              label: t('Show columns subtotal'),
              default: false,
              renderTrigger: true,
              description: t('Display column level subtotal'),
            },
          },
        ],
        [
          {
            name: 'transposePivot',
            config: {
              type: 'CheckboxControl',
              label: t('Transpose pivot'),
              default: false,
              description: t('Swap rows and columns'),
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'combineMetric',
            config: {
              type: 'CheckboxControl',
              label: t('Combine metrics'),
              default: false,
              description: t(
                'Display metrics side by side within each column, as ' +
                  'opposed to each column being displayed side by side for each metric.',
              ),
              renderTrigger: true,
            },
          },
        ],
      ],
    },
    {
      label: t('Options'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'valueFormat',
            config: {
              ...sharedControls.y_axis_format,
              label: t('Value format'),
            },
          },
        ],
        ['currency_format'],
        [
          {
            name: 'date_format',
            config: {
              type: 'SelectControl',
              freeForm: true,
              label: t('Date format'),
              default: SMART_DATE_ID,
              renderTrigger: true,
              choices: D3_TIME_FORMAT_OPTIONS,
              description: t('D3 time format for datetime columns'),
            },
          },
        ],
        [
          {
            name: 'rowOrder',
            config: {
              type: 'SelectControl',
              label: t('Sort rows by'),
              default: 'key_a_to_z',
              choices: [
                // [value, label]
                ['key_a_to_z', t('key a-z')],
                ['key_z_to_a', t('key z-a')],
                ['value_a_to_z', t('value ascending')],
                ['value_z_to_a', t('value descending')],
              ],
              renderTrigger: true,
              description: (
                <>
                  <div>{t('Change order of rows.')}</div>
                  <div>{t('Available sorting modes:')}</div>
                  <ul>
                    <li>{t('By key: use row names as sorting key')}</li>
                    <li>{t('By value: use metric values as sorting key')}</li>
                  </ul>
                </>
              ),
            },
          },
        ],
        [
          {
            name: 'colOrder',
            config: {
              type: 'SelectControl',
              label: t('Sort columns by'),
              default: 'key_a_to_z',
              choices: [
                // [value, label]
                ['key_a_to_z', t('key a-z')],
                ['key_z_to_a', t('key z-a')],
                ['value_a_to_z', t('value ascending')],
                ['value_z_to_a', t('value descending')],
              ],
              renderTrigger: true,
              description: (
                <>
                  <div>{t('Change order of columns.')}</div>
                  <div>{t('Available sorting modes:')}</div>
                  <ul>
                    <li>{t('By key: use column names as sorting key')}</li>
                    <li>{t('By value: use metric values as sorting key')}</li>
                  </ul>
                </>
              ),
            },
          },
        ],
        [
          {
            name: 'rowSubtotalPosition',
            config: {
              type: 'SelectControl',
              label: t('Rows subtotal position'),
              default: false,
              choices: [
                // [value, label]
                [true, t('Top')],
                [false, t('Bottom')],
              ],
              renderTrigger: true,
              description: t('Position of row level subtotal'),
            },
          },
        ],
        [
          {
            name: 'colSubtotalPosition',
            config: {
              type: 'SelectControl',
              label: t('Columns subtotal position'),
              default: false,
              choices: [
                // [value, label]
                [true, t('Left')],
                [false, t('Right')],
              ],
              renderTrigger: true,
              description: t('Position of column level subtotal'),
            },
          },
        ],
        [
          {
            name: 'conditional_formatting',
            config: {
              type: 'ConditionalFormattingControl',
              renderTrigger: true,
              label: t('Conditional formatting'),
              description: t('Apply conditional color formatting to metrics'),
              mapStateToProps(explore, _, chart) {
                const values =
                  (explore?.controls?.metrics?.value as QueryFormMetric[]) ??
                  [];
                const rawFormulaMetrics =
                  explore?.controls?.metricFormulas?.value ??
                  explore?.form_data?.metricFormulas;
                const formulaMetrics = normalizeMetricFormulasValue(
                  rawFormulaMetrics,
                );
                const verboseMap = explore?.datasource?.hasOwnProperty(
                  'verbose_map',
                )
                  ? (explore?.datasource as Dataset)?.verbose_map
                  : (explore?.datasource?.columns ?? {});
                const chartStatus = chart?.chartStatus;
                const metricColumn = values.map(value => {
                  if (typeof value === 'string') {
                    return {
                      value,
                      label: Array.isArray(verboseMap)
                        ? value
                        : verboseMap[value],
                    };
                  }
                  return { value: value.label, label: value.label };
                });
                const seen = new Set(metricColumn.map(item => item.value));
                formulaMetrics.forEach(metric => {
                  const label = String(metric.label || '').trim();
                  if (!label || seen.has(label)) {
                    return;
                  }
                  seen.add(label);
                  metricColumn.push({ value: label, label });
                });
                return {
                  removeIrrelevantConditions: chartStatus === 'success',
                  columnOptions: metricColumn,
                  verboseMap,
                };
              },
            },
          },
        ],
        [
          {
            name: 'conditional_formatting_solid',
            config: {
              type: 'CheckboxControl',
              label: t('Solid conditional colors'),
              renderTrigger: true,
              default: false,
              description: t(
                'When enabled, conditional formatting uses solid colors instead of heatmap opacity.',
              ),
            },
          },
        ],
        [
          {
            name: 'allow_render_html',
            config: {
              type: 'CheckboxControl',
              label: t('Render columns in HTML format'),
              renderTrigger: true,
              default: true,
              description: t(
                'Renders table cells as HTML when applicable. For example, HTML <a> tags will be rendered as hyperlinks.',
              ),
            },
          },
        ],
        [
          {
            name: 'show_cell_tooltip',
            config: {
              type: 'CheckboxControl',
              label: t('Show enriched cell tooltip'),
              renderTrigger: true,
              default: true,
              description: t(
                'Show metric, raw value, row, column and formula details when hovering table cells.',
              ),
            },
          },
        ],
        [
          {
            name: 'sticky_headers',
            config: {
              type: 'CheckboxControl',
              label: t('Sticky headers'),
              renderTrigger: true,
              default: false,
              description: t(
                'Keep column headers, row headers and total labels visible while scrolling.',
              ),
            },
          },
        ],
        [
          {
            name: 'table_theme_enabled',
            config: {
              type: 'CheckboxControl',
              label: t('Enable custom table theme'),
              renderTrigger: true,
              default: true,
              description: t(
                'Disable to restore the default (transparent) table theme.',
              ),
            },
          },
        ],
        [
          {
            name: 'table_theme_header_bg',
            config: {
              type: 'ColorPickerControl',
              label: t('Header background'),
              renderTrigger: true,
              default: null,
              allowClear: true,
              description: t('Background color for header cells.'),
              visibility: ({ controls }) =>
                controls?.table_theme_enabled?.value !== false,
            },
          },
          {
            name: 'table_theme_header_text',
            config: {
              type: 'ColorPickerControl',
              label: t('Header text color'),
              renderTrigger: true,
              default: null,
              allowClear: true,
              description: t('Text color for header cells.'),
              visibility: ({ controls }) =>
                controls?.table_theme_enabled?.value !== false,
            },
          },
        ],
        [
          {
            name: 'table_theme_row_header_bg',
            config: {
              type: 'ColorPickerControl',
              label: t('Dimension background'),
              renderTrigger: true,
              default: null,
              allowClear: true,
              description: t('Background color for row/dimension headers.'),
              visibility: ({ controls }) =>
                controls?.table_theme_enabled?.value !== false,
            },
          },
          {
            name: 'table_theme_row_header_text',
            config: {
              type: 'ColorPickerControl',
              label: t('Dimension text color'),
              renderTrigger: true,
              default: null,
              allowClear: true,
              description: t('Text color for row/dimension headers.'),
              visibility: ({ controls }) =>
                controls?.table_theme_enabled?.value !== false,
            },
          },
        ],
        [
          {
            name: 'table_theme_total_bg',
            config: {
              type: 'ColorPickerControl',
              label: t('Totals background'),
              renderTrigger: true,
              default: null,
              allowClear: true,
              description: t('Background color for total rows/columns.'),
              visibility: ({ controls }) =>
                controls?.table_theme_enabled?.value !== false,
            },
          },
          {
            name: 'table_theme_total_text',
            config: {
              type: 'ColorPickerControl',
              label: t('Totals text color'),
              renderTrigger: true,
              default: null,
              allowClear: true,
              description: t('Text color for total rows/columns.'),
              visibility: ({ controls }) =>
                controls?.table_theme_enabled?.value !== false,
            },
          },
        ],
        [
          {
            name: 'table_theme_subtotal_bg',
            config: {
              type: 'ColorPickerControl',
              label: t('Subtotals background'),
              renderTrigger: true,
              default: null,
              allowClear: true,
              description: t('Background color for subtotal rows/columns.'),
              visibility: ({ controls }) =>
                controls?.table_theme_enabled?.value !== false,
            },
          },
          {
            name: 'table_theme_subtotal_text',
            config: {
              type: 'ColorPickerControl',
              label: t('Subtotals text color'),
              renderTrigger: true,
              default: null,
              allowClear: true,
              description: t('Text color for subtotal rows/columns.'),
              visibility: ({ controls }) =>
                controls?.table_theme_enabled?.value !== false,
            },
          },
        ],
        [
          {
            name: 'table_theme_cell_bg',
            config: {
              type: 'ColorPickerControl',
              label: t('Body cell background'),
              renderTrigger: true,
              default: null,
              allowClear: true,
              description: t('Background color for body cells.'),
              visibility: ({ controls }) =>
                controls?.table_theme_enabled?.value !== false,
            },
          },
          {
            name: 'table_theme_cell_text',
            config: {
              type: 'ColorPickerControl',
              label: t('Body cell text color'),
              renderTrigger: true,
              default: null,
              allowClear: true,
              description: t('Text color for body cells.'),
              visibility: ({ controls }) =>
                controls?.table_theme_enabled?.value !== false,
            },
          },
        ],
        [
          {
            name: 'table_theme_border_color',
            config: {
              type: 'ColorPickerControl',
              label: t('Table border color'),
              renderTrigger: true,
              default: null,
              allowClear: true,
              description: t('Border color for table grid lines.'),
              visibility: ({ controls }) =>
                controls?.table_theme_enabled?.value !== false,
            },
          },
        ],
        [
          {
            name: 'column_config',
            config: {
              type: 'ColumnConfigControl',
              label: t('Customize columns'),
              description: t('Further customize how to display each column'),
              width: 420,
              height: 360,
              renderTrigger: true,
              configFormLayout: HTML_COLUMN_CONFIG_LAYOUT,
              shouldMapStateToProps() {
                return true;
              },
              mapStateToProps(explore) {
                const datasource = explore?.datasource as Dataset | undefined;
                const typeMap = buildColumnTypeMap(datasource);

                const groupbyRows = ensureIsArray(
                  explore?.controls?.groupbyRows?.value ??
                    explore?.form_data?.groupbyRows,
                )
                  .map(getColumnLabel)
                  .filter(Boolean);
                const groupbyColumns = ensureIsArray(
                  explore?.controls?.groupbyColumns?.value ??
                    explore?.form_data?.groupbyColumns,
                )
                  .map(getColumnLabel)
                  .filter(Boolean);

                const metrics = ensureIsArray(
                  explore?.controls?.metrics?.value ??
                    explore?.form_data?.metrics,
                );
                const metricLabels = metrics
                  .map((metric: QueryFormMetric) =>
                    typeof metric === 'string' ? metric : metric.label,
                  )
                  .filter(Boolean) as string[];

                const rawFormulaMetrics =
                  explore?.controls?.metricFormulas?.value ??
                  explore?.form_data?.metricFormulas;
                const formulaMetrics = normalizeMetricFormulasValue(
                  rawFormulaMetrics,
                );
                const formulaLabels = formulaMetrics
                  .map(metric => metric.label)
                  .filter(Boolean) as string[];

                const colnames: string[] = [];
                const coltypes: GenericDataType[] = [];
                const seen = new Set<string>();

                const pushColumn = (name: string, type?: GenericDataType) => {
                  const clean = String(name || '').trim();
                  if (!clean || seen.has(clean)) {
                    return;
                  }
                  seen.add(clean);
                  colnames.push(clean);
                  coltypes.push(type ?? GenericDataType.String);
                };

                groupbyRows.forEach(name => pushColumn(name, typeMap[name]));
                groupbyColumns.forEach(name => pushColumn(name, typeMap[name]));
                metricLabels.forEach(name =>
                  pushColumn(name, GenericDataType.Numeric),
                );
                formulaLabels.forEach(name =>
                  pushColumn(name, GenericDataType.Numeric),
                );

                return {
                  columnsPropsObject: {
                    colnames,
                    coltypes,
                  },
                };
              },
            },
          },
        ],
      ],
    },
  ],
  formDataOverrides: formData => {
    const groupbyColumns = getStandardizedControls().controls.columns.filter(
      col => !ensureIsArray(formData.groupbyRows).includes(col),
    );
    getStandardizedControls().controls.columns =
      getStandardizedControls().controls.columns.filter(
        col => !groupbyColumns.includes(col),
      );
    return {
      ...formData,
      metricFormulas: normalizeMetricFormulasValue(formData.metricFormulas),
      metrics: getStandardizedControls().popAllMetrics(),
      groupbyColumns,
    };
  },
};

export default config;
