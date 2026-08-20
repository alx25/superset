/* eslint-disable camelcase */
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
  ChartDataResponseResult,
  ensureIsArray,
  GenericDataType,
  getMetricLabel,
  isAdhocColumn,
  isPhysicalColumn,
  QueryFormColumn,
  QueryFormMetric,
  QueryMode,
  SMART_DATE_ID,
  t,
} from '@superset-ui/core';
import {
  ColumnOption,
  ControlConfig,
  ControlPanelConfig,
  ControlPanelsContainerProps,
  ControlStateMapping,
  D3_TIME_FORMAT_OPTIONS,
  QueryModeLabel,
  sharedControls,
  ControlPanelState,
  ControlState,
  Dataset,
  ColumnMeta,
  defineSavedMetrics,
  getStandardizedControls,
  sections,
} from '@superset-ui/chart-controls';

import { isEmpty, uniqueId } from 'lodash';
import { PAGE_SIZE_OPTIONS } from './consts';
import { ColorSchemeEnum } from './types';
import { normalizeCalculatedColumns } from './utils/calculatedColumns';

function getQueryMode(controls: ControlStateMapping): QueryMode {
  const mode = controls?.query_mode?.value;
  if (mode === QueryMode.Aggregate || mode === QueryMode.Raw) {
    return mode as QueryMode;
  }
  const rawColumns = controls?.all_columns?.value as
    | QueryFormColumn[]
    | undefined;
  const hasRawColumns = rawColumns && rawColumns.length > 0;
  return hasRawColumns ? QueryMode.Raw : QueryMode.Aggregate;
}

/**
 * Visibility check
 */
function isQueryMode(mode: QueryMode) {
  return ({ controls }: Pick<ControlPanelsContainerProps, 'controls'>) =>
    getQueryMode(controls) === mode;
}

const isAggMode = isQueryMode(QueryMode.Aggregate);
const isRawMode = isQueryMode(QueryMode.Raw);

const validateAggControlValues = (
  controls: ControlStateMapping,
  values: any[],
) => {
  const areControlsEmpty = values.every(val => ensureIsArray(val).length === 0);
  return areControlsEmpty && isAggMode({ controls })
    ? [t('Group By, Metrics or Percentage Metrics must have a value')]
    : [];
};

const queryMode: ControlConfig<'RadioButtonControl'> = {
  type: 'RadioButtonControl',
  label: t('Query mode'),
  default: null,
  options: [
    [QueryMode.Aggregate, QueryModeLabel[QueryMode.Aggregate]],
    [QueryMode.Raw, QueryModeLabel[QueryMode.Raw]],
  ],
  mapStateToProps: ({ controls }) => ({ value: getQueryMode(controls) }),
  rerender: ['all_columns', 'groupby', 'metrics', 'percent_metrics'],
};

const allColumnsControl: typeof sharedControls.groupby = {
  ...sharedControls.groupby,
  label: t('Columns'),
  description: t('Columns to display'),
  multi: true,
  freeForm: true,
  allowAll: true,
  commaChoosesOption: false,
  optionRenderer: c => <ColumnOption showType column={c} />,
  valueRenderer: c => <ColumnOption column={c} />,
  valueKey: 'column_name',
  mapStateToProps: ({ datasource, controls }, controlState) => ({
    options: datasource?.columns || [],
    queryMode: getQueryMode(controls),
    externalValidationErrors:
      isRawMode({ controls }) && ensureIsArray(controlState?.value).length === 0
        ? [t('must have a value')]
        : [],
  }),
  visibility: isRawMode,
  resetOnHide: false,
};

const percentMetricsControl: typeof sharedControls.metrics = {
  ...sharedControls.metrics,
  label: t('Percentage metrics'),
  description: t(
    'Select one or many metrics to display, that will be displayed in the percentages of total. ' +
      'Percentage metrics will be calculated only from data within the row limit. ' +
      'You can use an aggregation function on a column or write custom SQL to create a percentage metric.',
  ),
  visibility: isAggMode,
  resetOnHide: false,
  mapStateToProps: ({ datasource, controls }, controlState) => ({
    columns: datasource?.columns || [],
    savedMetrics: defineSavedMetrics(datasource),
    datasource,
    datasourceType: datasource?.type,
    queryMode: getQueryMode(controls),
    externalValidationErrors: validateAggControlValues(controls, [
      controls.groupby?.value,
      controls.metrics?.value,
      controlState?.value,
    ]),
  }),
  rerender: ['groupby', 'metrics'],
  default: [],
  validators: [],
};

// ------------------------------
// Tipos auxiliares seguros
// ------------------------------

type OptionLV = { label: string; value: string; type?: number };

type VerboseMap = Record<string, string>;

const toVerboseMap = (ds?: Dataset): VerboseMap => {
  // Si el datasource ya trae verbose_map, úsalo
  const vm = (ds as any)?.verbose_map as unknown;
  if (vm && typeof vm === 'object' && !Array.isArray(vm)) {
    return vm as VerboseMap;
  }
  // Construir desde columnas si no existe verbose_map
  const cols = (ds?.columns ?? []) as ColumnMeta[];
  return cols.reduce<VerboseMap>((acc, c) => {
    const key = (c as any).column_name ?? String(c);
    const label =
      (c as any).verbose_name ?? (c as any).column_name ?? String(c);
    acc[key] = label;
    return acc;
  }, {});
};

const resolveJinjaTemplate = (
  template: string,
  jinjaValues: Record<string, any>,
): string => {
  if (!template || typeof template !== 'string') {
    return template;
  }

  return template.replace(/\{\{([^}]+)\}\}/g, (match, expression) => {
    const trimmedExpression = String(expression).trim();
    if (Object.prototype.hasOwnProperty.call(jinjaValues, trimmedExpression)) {
      const value = jinjaValues[trimmedExpression];
      if (value === null || value === undefined) {
        return 'NULL';
      }
      if (typeof value === 'number') {
        return value.toLocaleString();
      }
      return String(value);
    }
    return match;
  });
};

const extractJinjaValues = (
  records: Record<string, any>[],
  fieldLabels: string[],
): Record<string, any> => {
  const firstRecord = records?.[0];
  if (!firstRecord || !fieldLabels.length) {
    return {};
  }

  return fieldLabels.reduce<Record<string, any>>((acc, fieldLabel) => {
    if (Object.prototype.hasOwnProperty.call(firstRecord, fieldLabel)) {
      acc[fieldLabel] = firstRecord[fieldLabel];
    }
    return acc;
  }, {});
};

const getJinjaValuesFromExplore = (
  explore: any,
  queryResponse?: ChartDataResponseResult,
): Record<string, any> => {
  const records = Array.isArray(queryResponse?.data)
    ? (queryResponse?.data as Record<string, any>[])
    : [];
  const fieldLabels = ensureIsArray(
    explore?.controls?.jinja_fields?.value ?? explore?.form_data?.jinja_fields,
  )
    .map(getMetricLabel)
    .filter(Boolean);

  return extractJinjaValues(records, fieldLabels);
};

const getHiddenColumnOrderKeys = (explore: any): Set<string> =>
  new Set(
    ensureIsArray(
      explore?.controls?.jinja_fields?.value ?? explore?.form_data?.jinja_fields,
    )
      .map(getMetricLabel)
      .map(item => String(item ?? '').trim())
      .filter(Boolean),
  );

const getSelectedColumnKey = (column?: QueryFormColumn | null): string => {
  if (!column) {
    return '';
  }
  if (typeof column === 'string') {
    return column;
  }
  if (isPhysicalColumn(column)) {
    return column;
  }
  if (isAdhocColumn(column)) {
    return column.label ?? '';
  }
  return String(
    (column as any).column_name ??
      (column as any).name ??
      (column as any).label ??
      '',
  );
};

const getSelectedColumnLabel = (
  column: QueryFormColumn,
  verboseMap: VerboseMap,
): string => {
  if (isAdhocColumn(column)) {
    return column.label ?? column.sqlExpression ?? '';
  }
  const key = getSelectedColumnKey(column);
  return verboseMap[key] ?? key;
};

const getRowGroupingChoices = (
  state: ControlPanelState,
): [string, string][] => {
  const { datasource, controls } = state;
  const formData = (state as any).form_data ?? {};
  const verboseMap = toVerboseMap(datasource as Dataset | undefined);
  const selectedColumns = ensureIsArray(
    getQueryMode(controls) === QueryMode.Raw
      ? (controls?.all_columns?.value ?? formData.all_columns)
      : (controls?.groupby?.value ?? formData.groupby),
  ) as QueryFormColumn[];

  const seen = new Set<string>();
  return selectedColumns
    .map(column => {
      const key = getSelectedColumnKey(column);
      if (!key || seen.has(key)) {
        return null;
      }
      seen.add(key);
      return [key, getSelectedColumnLabel(column, verboseMap)] as [
        string,
        string,
      ];
    })
    .filter(Boolean) as [string, string][];
};

const getTopMetricChoices = (state: ControlPanelState): [string, string][] => {
  const { datasource, controls } = state;
  const formData = (state as any).form_data ?? {};
  const verboseMap = toVerboseMap(datasource as Dataset | undefined);
  const columnConfig = (formData.column_config ?? {}) as Record<
    string,
    { displayName?: string }
  >;
  const selectedMetrics = ensureIsArray(
    controls?.metrics?.value ?? formData.metrics,
  ) as QueryFormMetric[];
  const seen = new Set<string>();

  return selectedMetrics
    .map(metric => {
      const key = getMetricLabel(metric);
      if (!key || seen.has(key)) {
        return null;
      }
      seen.add(key);
      return [
        key,
        columnConfig[key]?.displayName ?? verboseMap[key] ?? key,
      ] as [string, string];
    })
    .filter(Boolean) as [string, string][];
};

const getDatasourceColumnType = (
  datasource: Dataset | undefined,
  key: string,
): GenericDataType => {
  const matchedColumn = (datasource?.columns || []).find((column: any) => {
    const columnKey =
      column?.column_name ?? column?.name ?? column?.verbose_name;
    return String(columnKey ?? '') === key;
  }) as ColumnMeta | undefined;
  const rawType =
    (matchedColumn as any)?.type_generic ?? (matchedColumn as any)?.typeGeneric;
  return typeof rawType === 'number'
    ? (rawType as GenericDataType)
    : GenericDataType.String;
};

const resolveColumnOrderLabel = (
  key: string,
  columnConfig: Record<string, { displayName?: string }>,
  verboseMap: VerboseMap,
  jinjaValues: Record<string, any>,
  fallbackLabel?: string,
) => {
  const configuredLabel = columnConfig[key]?.displayName;
  if (configuredLabel) {
    return resolveJinjaTemplate(configuredLabel, jinjaValues);
  }

  if (fallbackLabel) {
    return resolveJinjaTemplate(fallbackLabel, jinjaValues);
  }

  if (key.startsWith('%')) {
    const baseKey = key.slice(1);
    if (verboseMap[baseKey]) {
      return `%${verboseMap[baseKey]}`;
    }
  }

  return resolveJinjaTemplate(verboseMap[key] ?? key, jinjaValues);
};

const getVisibleColumnOrderBaseOptions = (
  explore: any,
  datasource: Dataset | undefined,
  columnConfig: Record<string, { displayName?: string }>,
  verboseMap: VerboseMap,
  jinjaValues: Record<string, any>,
  hiddenColumnKeys: Set<string>,
): OptionLV[] => {
  const controls = explore?.controls ?? {};
  const formData = explore?.form_data ?? {};
  const queryMode = getQueryMode(controls);
  const optionsByKey = new Map<string, OptionLV>();

  const addOption = (option: OptionLV | null) => {
    const key = String(option?.value ?? '').trim();
    if (!key || hiddenColumnKeys.has(key) || optionsByKey.has(key)) {
      return;
    }
    optionsByKey.set(key, {
      ...option,
      value: key,
      label: String(option?.label ?? key),
    });
  };

  const selectedColumns = ensureIsArray(
    queryMode === QueryMode.Raw
      ? controls?.all_columns?.value ?? formData.all_columns
      : controls?.groupby?.value ?? formData.groupby,
  ) as QueryFormColumn[];

  selectedColumns.forEach(column => {
    const key = getSelectedColumnKey(column);
    if (!key) {
      return;
    }
    addOption({
      value: key,
      label: resolveColumnOrderLabel(
        key,
        columnConfig,
        verboseMap,
        jinjaValues,
        getSelectedColumnLabel(column, verboseMap),
      ),
      type: getDatasourceColumnType(datasource, key),
    });
  });

  if (queryMode === QueryMode.Aggregate) {
    const selectedMetrics = ensureIsArray(
      controls?.metrics?.value ?? formData.metrics,
    ) as QueryFormMetric[];
    selectedMetrics.forEach(metric => {
      const key = getMetricLabel(metric);
      if (!key) {
        return;
      }
      addOption({
        value: key,
        label: resolveColumnOrderLabel(
          key,
          columnConfig,
          verboseMap,
          jinjaValues,
        ),
        type: GenericDataType.Numeric,
      });
    });

    const selectedPercentMetrics = ensureIsArray(
      controls?.percent_metrics?.value ?? formData.percent_metrics,
    ) as QueryFormMetric[];
    selectedPercentMetrics.forEach(metric => {
      const baseKey = getMetricLabel(metric);
      const key = baseKey ? `%${baseKey}` : '';
      if (!key) {
        return;
      }
      addOption({
        value: key,
        label: resolveColumnOrderLabel(
          key,
          columnConfig,
          verboseMap,
          jinjaValues,
        ),
        type: GenericDataType.Numeric,
      });
    });
  }

  return Array.from(optionsByKey.values());
};

const generateComparisonColumns = (colname: string) => [
  `${t('Main')} ${colname}`,
  `# ${colname}`,
  `△ ${colname}`,
  `% ${colname}`,
];

const generateComparisonColumnTypes = (count: number) =>
  Array(count).fill(GenericDataType.Numeric);

export const getColumnOrderOptions = (explore: any, chart?: any): OptionLV[] => {
  const timeComparisonActive = !isEmpty(explore?.controls?.time_compare?.value);
  const queryResponse = chart?.queriesResponse?.[0] as
    | ChartDataResponseResult
    | undefined;
  const datasource = explore?.datasource as Dataset | undefined;
  const verboseMap = toVerboseMap(datasource);
  const columnConfig = (explore?.controls?.column_config?.value ??
    explore?.form_data?.column_config ??
    {}) as Record<string, { displayName?: string }>;
  const jinjaValues = getJinjaValuesFromExplore(explore, queryResponse);
  const hiddenColumnKeys = getHiddenColumnOrderKeys(explore);
  const visibleBaseOptions = getVisibleColumnOrderBaseOptions(
    explore,
    datasource,
    columnConfig,
    verboseMap,
    jinjaValues,
    hiddenColumnKeys,
  );
  const visibleBaseOptionsByKey = new Map(
    visibleBaseOptions.map(option => [option.value, option]),
  );

  const responseColnames = Array.isArray(queryResponse?.colnames)
    ? [...(queryResponse?.colnames ?? [])]
    : [];
  const responseColtypes = Array.isArray(queryResponse?.coltypes)
    ? ([...(queryResponse?.coltypes ?? [])] as GenericDataType[])
    : [];
  const orderedBaseOptions: OptionLV[] = [];
  const seen = new Set<string>();

  responseColnames.forEach((colname, index) => {
    const key = String(colname ?? '').trim();
    const option = visibleBaseOptionsByKey.get(key);
    if (!key || !option || seen.has(key)) {
      return;
    }
    seen.add(key);
    orderedBaseOptions.push({
      ...option,
      type: responseColtypes[index] ?? option.type ?? GenericDataType.String,
    });
  });

  visibleBaseOptions.forEach(option => {
    if (seen.has(option.value)) {
      return;
    }
    seen.add(option.value);
    orderedBaseOptions.push(option);
  });

  const options = timeComparisonActive
    ? orderedBaseOptions.flatMap(option => {
        if (option.type === GenericDataType.Numeric) {
          return [
            {
              value: `${t('Main')} ${option.value}`,
              label: `${t('Main')} ${option.label}`,
              type: GenericDataType.Numeric,
            },
            {
              value: `# ${option.value}`,
              label: `# ${option.label}`,
              type: GenericDataType.Numeric,
            },
            {
              value: `△ ${option.value}`,
              label: `△ ${option.label}`,
              type: GenericDataType.Numeric,
            },
            {
              value: `% ${option.value}`,
              label: `% ${option.label}`,
              type: GenericDataType.Numeric,
            },
          ] as OptionLV[];
        }
        return [option];
      })
    : [...orderedBaseOptions];

  const calcColItems = normalizeCalculatedColumns(
    explore?.controls?.calculated_columns?.value ??
      explore?.form_data?.calculated_columns,
  );

  calcColItems.forEach(item => {
    const key = String(item.label ?? '').trim();
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    options.push({
      value: key,
      label: resolveJinjaTemplate(
        columnConfig[key]?.displayName ?? key,
        jinjaValues,
      ),
      type: GenericDataType.Numeric,
    });
  });

  return options;
};

const processComparisonColumns = (
  columns: OptionLV[],
  suffix: string,
): OptionLV[] =>
  columns
    .map(col => {
      if (!col.label.includes(suffix)) {
        return [
          {
            label: `${t('Main')} ${col.label}`,
            value: `${t('Main')} ${col.value}`,
          },
          { label: `# ${col.label}`, value: `# ${col.value}` },
          { label: `△ ${col.label}`, value: `△ ${col.value}` },
          { label: `% ${col.label}`, value: `% ${col.value}` },
        ] as OptionLV[];
      }
      return [] as OptionLV[];
    })
    .flat();

const config: ControlPanelConfig = {
  controlPanelSections: [
    {
      label: t('Query'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'query_mode',
            config: queryMode,
          },
        ],
        [
          {
            name: 'groupby',
            override: {
              visibility: isAggMode,
              resetOnHide: false,
              mapStateToProps: (
                state: ControlPanelState,
                controlState: ControlState,
              ) => {
                const { controls } = state;
                const originalMapStateToProps =
                  sharedControls?.groupby?.mapStateToProps;
                const newState =
                  originalMapStateToProps?.(state, controlState) ?? {};
                newState.externalValidationErrors = validateAggControlValues(
                  controls,
                  [
                    controls.metrics?.value,
                    controls.percent_metrics?.value,
                    controlState.value,
                  ],
                );

                return newState;
              },
              rerender: ['metrics', 'percent_metrics'],
            },
          },
        ],
        [
          {
            name: 'time_grain_sqla',
            config: {
              ...sharedControls.time_grain_sqla,
              visibility: ({ controls }) => {
                const options = ensureIsArray(controls?.groupby?.options);
                const dttmLookup: Record<string, boolean> = Object.fromEntries(
                  options.map((option: any) => [
                    option.column_name,
                    !!option.is_dttm,
                  ]),
                );

                return ensureIsArray(controls?.groupby.value)
                  .map(selection => {
                    if (isAdhocColumn(selection)) {
                      return true;
                    }
                    if (isPhysicalColumn(selection)) {
                      return Boolean(dttmLookup[selection]);
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
            override: {
              validators: [],
              visibility: isAggMode,
              resetOnHide: false,
              mapStateToProps: (
                { controls, datasource, form_data }: ControlPanelState,
                controlState: ControlState,
              ) => {
                // Evita acceso inseguro a columns[0]
                const cols = Array.isArray((datasource as Dataset)?.columns)
                  ? ((datasource as Dataset).columns as ColumnMeta[])
                  : [];
                const supportsFilterable =
                  cols.length > 0 && 'filterable' in cols[0];

                return {
                  columns: supportsFilterable
                    ? cols.filter((c: any) => c.filterable)
                    : cols,
                  savedMetrics: defineSavedMetrics(datasource),
                  // current active adhoc metrics
                  selectedMetrics:
                    (form_data as any).metrics ||
                    ((form_data as any).metric
                      ? [(form_data as any).metric]
                      : []),
                  datasource,
                  externalValidationErrors: validateAggControlValues(controls, [
                    controls.groupby?.value,
                    controls.percent_metrics?.value,
                    controlState.value,
                  ]),
                };
              },
              rerender: ['groupby', 'percent_metrics'],
            },
          },
          {
            name: 'all_columns',
            config: allColumnsControl,
          },
        ],
        [
          {
            name: 'percent_metrics',
            config: percentMetricsControl,
          },
        ],
        [
          {
            name: 'jinja_fields',
            config: {
              type: 'DndMetricSelect',
              label: t('Jinja Fields'),
              description: t(
                'Select metrics/columns that will be available for use in display name templates ' +
                  '(e.g., {{MAX(year)}}). These fields will not be displayed in the table but ' +
                  'their values can be used in column display names.',
              ),
              multi: true,
              default: [],
              visibility: isAggMode,
              resetOnHide: false,
              mapStateToProps: ({ datasource, controls }) => ({
                columns: datasource?.columns || [],
                savedMetrics: defineSavedMetrics(datasource),
                datasource,
                datasourceType: datasource?.type,
                queryMode: getQueryMode(controls),
                // No validation errors for jinja fields as they are optional
                externalValidationErrors: [],
              }),
              validators: [],
            },
          },
        ],
        [
          {
            name: 'calculated_columns',
            config: {
              type: 'CollectionControl',
              controlName: 'FormulaMetricControl',
              label: t('Calculated columns (Jinja-like)'),
              renderTrigger: true,
              tabOverride: 'data',
              default: [],
              rerender: ['column_config', 'column_order'],
              itemGenerator: () => ({
                key: uniqueId('calc_col_'),
                label: '',
                expression: '',
                d3format: '',
              }),
              description: t(
                'Define new columns computed in the browser using {{ColumnName}} placeholders. ' +
                  'Supports arithmetic (+, -, *, /), IF(), ABS(), ROUND(), MAX(), MIN(). ' +
                  'Optionally set a D3 number format.',
              ),
              mapStateToProps: (explore: any) => {
                const baseMetrics = ensureIsArray(
                  explore?.controls?.metrics?.value ??
                    explore?.form_data?.metrics,
                ) as QueryFormMetric[];
                const jinjaFields = ensureIsArray(
                  explore?.controls?.jinja_fields?.value ??
                    explore?.form_data?.jinja_fields,
                ) as QueryFormMetric[];
                const metricNames = [...baseMetrics, ...jinjaFields]
                  .map(m =>
                    typeof m === 'string' ? m : ((m as any)?.label ?? ''),
                  )
                  .filter(Boolean);
                const colNames = (explore?.datasource?.columns || [])
                  .map((c: any) => c?.column_name ?? c?.name ?? '')
                  .filter(Boolean);
                return {
                  value: explore?.controls?.calculated_columns?.value ?? [],
                  // NOTE: do not name this prop `columns` — exploreReducer's
                  // UPDATE_FORM_DATA_BY_DATASOURCE treats any control whose
                  // state has a `columns` key as a column-selecting control
                  // and revalidates its value against the datasource on every
                  // dataset edit, wiping out calculated_columns entirely since
                  // its items ({key, label, expression}) never match a real
                  // column/metric shape.
                  datasourceColumns: explore?.datasource?.columns || [],
                  metrics: [...new Set([...metricNames, ...colNames])].map(
                    name => ({ label: name }),
                  ),
                };
              },
            },
          },
        ],
        [
          {
            name: 'column_order',
            config: {
              type: 'MetricOrderControl',
              label: t('Column order'),
              renderTrigger: true,
              rerender: [
                'query_mode',
                'groupby',
                'all_columns',
                'metrics',
                'percent_metrics',
                'column_config',
                'calculated_columns',
                'time_compare',
              ],
              default: [],
              tabOverride: 'data',
              description: t(
                'Drag to reorder table fields, including calculated columns.',
              ),
              shouldMapStateToProps() {
                return true;
              },
              mapStateToProps: (explore: any, _: any, chart: any) => ({
                options: getColumnOrderOptions(explore, chart),
              }),
            },
          },
        ],
        ['adhoc_filters'],
        [
          {
            name: 'timeseries_limit_metric',
            override: {
              visibility: isAggMode,
              resetOnHide: false,
            },
          },
          {
            name: 'order_by_cols',
            config: {
              type: 'SelectControl',
              label: t('Ordering'),
              description: t('Order results by selected columns'),
              multi: true,
              default: [],
              mapStateToProps: ({ datasource }) => ({
                choices: (datasource as any)?.hasOwnProperty('order_by_choices')
                  ? (datasource as Dataset)?.order_by_choices
                  : (datasource as Dataset)?.columns || [],
              }),
              visibility: isRawMode,
              resetOnHide: false,
            },
          },
        ],
        [
          {
            name: 'server_pagination',
            config: {
              type: 'CheckboxControl',
              label: t('Server pagination'),
              description: t(
                'Enable server side pagination of results (experimental feature)',
              ),
              default: false,
            },
          },
        ],
        [
          {
            name: 'row_limit',
            override: {
              default: 1000,
              visibility: ({ controls }: ControlPanelsContainerProps) =>
                !controls?.server_pagination?.value,
            },
          },
          {
            name: 'server_page_length',
            config: {
              type: 'SelectControl',
              freeForm: true,
              label: t('Server Page Length'),
              default: 10,
              choices: PAGE_SIZE_OPTIONS,
              description: t('Rows per page, 0 means no pagination'),
              visibility: ({ controls }: ControlPanelsContainerProps) =>
                Boolean(controls?.server_pagination?.value),
            },
          },
        ],
        [
          {
            name: 'order_desc',
            config: {
              type: 'CheckboxControl',
              label: t('Sort descending'),
              default: true,
              description: t(
                'If enabled, this control sorts the results/values descending, otherwise it sorts the results ascending.',
              ),
              visibility: isAggMode,
              resetOnHide: false,
            },
          },
        ],
        [
          {
            name: 'show_totals',
            config: {
              type: 'CheckboxControl',
              label: t('Show summary'),
              default: false,
              description: t(
                'Show total aggregations of selected metrics. Note that row limit does not apply to the result.',
              ),
              visibility: isAggMode,
              resetOnHide: false,
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
            name: 'table_timestamp_format',
            config: {
              type: 'SelectControl',
              freeForm: true,
              label: t('Timestamp format'),
              default: SMART_DATE_ID,
              renderTrigger: true,
              clearable: false,
              choices: D3_TIME_FORMAT_OPTIONS,
              description: t('D3 time format for datetime columns'),
            },
          },
        ],
        [
          {
            name: 'page_length',
            config: {
              type: 'SelectControl',
              freeForm: true,
              renderTrigger: true,
              label: t('Page length'),
              default: null,
              choices: PAGE_SIZE_OPTIONS,
              description: t('Rows per page, 0 means no pagination'),
              visibility: ({ controls }: ControlPanelsContainerProps) =>
                !controls?.server_pagination?.value,
            },
          },
          null,
        ],
        [
          {
            name: 'include_search',
            config: {
              type: 'CheckboxControl',
              label: t('Search box'),
              renderTrigger: true,
              default: false,
              description: t('Whether to include a client-side search box'),
            },
          },
        ],
        [
          {
            name: 'allow_rearrange_columns',
            config: {
              type: 'CheckboxControl',
              label: t('Allow columns to be rearranged'),
              renderTrigger: true,
              default: false,
              description: t(
                "Allow end user to drag-and-drop column headers to rearrange them. Note their changes won't persist for the next time they open the chart.",
              ),
              visibility: ({ controls }) =>
                isEmpty(controls?.time_compare?.value),
            },
          },
        ],
        [
          {
            name: 'sticky_columns',
            config: {
              type: 'SelectControl',
              label: t('Columnas fijas (primeras N)'),
              renderTrigger: true,
              default: 0,
              choices: [
                [0, t('Ninguna')],
                [1, '1'],
                [2, '2'],
                [3, '3'],
              ],
              description: t(
                'Fija las primeras N columnas de la tabla (máximo 3). Si es mayor a 0, se ignora "Columna fija" en Customize columns.',
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
              description: t('Render data in HTML format if applicable.'),
            },
          },
        ],
        [
          {
            name: 'show_row_numbers',
            config: {
              type: 'CheckboxControl',
              label: t('Show row numbers'),
              renderTrigger: true,
              default: false,
              description: t(
                'Add a column with row numbers to help identify and reference specific rows in the table.',
              ),
            },
          },
        ],
        [
          {
            name: 'enable_row_grouping',
            config: {
              type: 'CheckboxControl',
              label: t('Enable row grouping'),
              renderTrigger: true,
              default: false,
              description: t(
                'Group table rows by a dimension column. Click the group header to expand or collapse each group.',
              ),
            },
          },
        ],
        [
          {
            name: 'row_grouping_column',
            config: {
              type: 'SelectControl',
              label: t('Group by column'),
              renderTrigger: true,
              rerender: ['query_mode', 'groupby', 'all_columns'],
              shouldMapStateToProps() {
                return true;
              },
              default: null,
              freeForm: false,
              clearable: true,
              description: t(
                'Select one of the displayed dimension/column fields to use for grouping rows.',
              ),
              visibility: ({ controls }) =>
                Boolean(controls?.enable_row_grouping?.value),
              mapStateToProps: state => {
                const choices = getRowGroupingChoices(state);
                const currentValue = state.controls?.row_grouping_column
                  ?.value as string | null | undefined;
                const nextState: Record<string, any> = {
                  choices,
                  placeholder:
                    choices.length > 0
                      ? t('Select a displayed field')
                      : t('Add a dimension/column first'),
                };
                if (
                  currentValue &&
                  !choices.some(([value]) => value === currentValue)
                ) {
                  nextState.value = null;
                }
                return nextState;
              },
            },
          },
        ],
        [
          {
            name: 'show_row_group_totals',
            config: {
              type: 'CheckboxControl',
              label: t('Show group subtotals'),
              renderTrigger: true,
              default: false,
              description: t(
                'Show subtotal values inside each group header using numeric metric columns.',
              ),
              visibility: ({ controls }) =>
                Boolean(controls?.enable_row_grouping?.value) &&
                Boolean(controls?.row_grouping_column?.value),
            },
          },
        ],
        [
          {
            name: 'allow_row_grouping_change',
            config: {
              type: 'CheckboxControl',
              label: t('Allow grouping changes'),
              renderTrigger: true,
              default: false,
              description: t(
                'Show a "Group by" selector in the table so viewers can switch the grouping column among the available dimension fields.',
              ),
              visibility: ({ controls }) =>
                Boolean(controls?.enable_row_grouping?.value) &&
                Boolean(controls?.row_grouping_column?.value),
            },
          },
        ],
        [
          {
            name: 'row_grouping_default_collapsed',
            config: {
              type: 'CheckboxControl',
              label: t('Collapse groups by default'),
              renderTrigger: true,
              default: false,
              description: t(
                'When enabled, grouped rows start collapsed. Otherwise they remain expanded by default.',
              ),
              visibility: ({ controls }) =>
                Boolean(controls?.enable_row_grouping?.value) &&
                Boolean(controls?.row_grouping_column?.value),
            },
          },
        ],
        [
          {
            name: 'row_grouping_compact_view',
            config: {
              type: 'CheckboxControl',
              label: t('Compact grouped view'),
              renderTrigger: true,
              default: false,
              description: t(
                'Hide the grouped column from the table and show its value only in the group header row.',
              ),
              visibility: ({ controls }) =>
                Boolean(controls?.enable_row_grouping?.value) &&
                Boolean(controls?.row_grouping_column?.value),
            },
          },
        ],
        [
          {
            name: 'show_top',
            config: {
              type: 'CheckboxControl',
              label: t('Enable Top N'),
              renderTrigger: true,
              default: false,
              description: t(
                'Show only top N rows and group remaining data as "Others" with aggregated values.',
              ),
            },
          },
        ],
        [
          {
            name: 'top_metric',
            config: {
              type: 'SelectControl',
              label: t('Top N Metric'),
              renderTrigger: true,
              default: null,
              freeForm: false,
              clearable: false,
              description: t(
                'Select the metric to use for Top N ranking (highest values first).',
              ),
              visibility: ({ controls }) => Boolean(controls?.show_top?.value),
              resetOnHide: false,
              shouldMapStateToProps() {
                return true;
              },
              mapStateToProps: state => {
                const choices = getTopMetricChoices(state);
                const currentValue = state.controls?.top_metric?.value;
                const currentKey = currentValue
                  ? getMetricLabel(currentValue as QueryFormMetric)
                  : undefined;
                const firstChoice = choices[0]?.[0] ?? null;
                const nextValue =
                  currentKey && choices.some(([value]) => value === currentKey)
                    ? currentKey
                    : firstChoice;

                return {
                  choices,
                  value: nextValue,
                  placeholder:
                    choices.length > 0
                      ? t('Select a visible metric')
                      : t('Add a metric first'),
                };
              },
            },
          },
        ],
        [
          {
            name: 'top_count',
            config: {
              type: 'SelectControl',
              label: t('Top N Count'),
              renderTrigger: true,
              default: 10,
              choices: [
                [5, '5'],
                [10, '10'],
                [20, '20'],
                [50, '50'],
                [100, '100'],
                [0, t('All (no limit)')],
              ],
              description: t(
                'Number of top rows to display. Remaining rows will be grouped as "Others".',
              ),
              visibility: ({ controls }) => Boolean(controls?.show_top?.value),
            },
          },
        ],
        [
          {
            name: 'top_show_in_chart',
            config: {
              type: 'CheckboxControl',
              label: t('Ver top N en el control del graficos'),
              renderTrigger: true,
              default: false,
              description: t(
                'Display the Top N count selector inside the table so viewers can adjust it. The value set above is used as the initial default.',
              ),
              visibility: ({ controls }) => Boolean(controls?.show_top?.value),
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
              width: 400,
              height: 320,
              renderTrigger: true,
              shouldMapStateToProps() {
                return true;
              },
              mapStateToProps(explore, _, chart) {
                const timeComparisonActive = !isEmpty(
                  explore?.controls?.time_compare?.value,
                );
                const queryResponse = chart?.queriesResponse?.[0] as
                  | ChartDataResponseResult
                  | undefined;
                const datasource = explore?.datasource as Dataset | undefined;

                const responseColnames = Array.isArray(queryResponse?.colnames)
                  ? [...(queryResponse?.colnames ?? [])]
                  : [];
                const responseColtypes = Array.isArray(queryResponse?.coltypes)
                  ? ([...(queryResponse?.coltypes ?? [])] as GenericDataType[])
                  : [];

                let colnames = responseColnames;
                let coltypes = responseColtypes;

                if (!colnames.length || colnames.length !== coltypes.length) {
                  const datasetColumns = Array.isArray(datasource?.columns)
                    ? (datasource?.columns as ColumnMeta[])
                    : [];

                  const fallbackNames: string[] = [];
                  const fallbackTypes: GenericDataType[] = [];

                  datasetColumns.forEach(column => {
                    const name =
                      (column as any)?.column_name ??
                      (column as any)?.verbose_name ??
                      (column as any)?.name;
                    if (name) {
                      fallbackNames.push(String(name));
                      const rawType =
                        (column as any)?.type_generic ??
                        (column as any)?.typeGeneric;
                      fallbackTypes.push(
                        typeof rawType === 'number'
                          ? (rawType as GenericDataType)
                          : GenericDataType.String,
                      );
                    }
                  });

                  if (fallbackNames.length) {
                    colnames = fallbackNames;
                    coltypes = fallbackTypes;
                  }
                }

                if (timeComparisonActive && colnames.length) {
                  const expandedNames: string[] = [];
                  const expandedTypes: GenericDataType[] = [];

                  colnames.forEach((colname, index) => {
                    const currentType =
                      coltypes[index] ?? GenericDataType.String;
                    if (currentType === GenericDataType.Numeric) {
                      expandedNames.push(...generateComparisonColumns(colname));
                      expandedTypes.push(...generateComparisonColumnTypes(4));
                    } else {
                      expandedNames.push(colname);
                      expandedTypes.push(currentType);
                    }
                  });

                  colnames = expandedNames;
                  coltypes = expandedTypes;
                }

                // Append calculated columns so they appear in Customize columns
                const calcColItems = ensureIsArray(
                  explore?.controls?.calculated_columns?.value ?? [],
                ) as Array<{ label?: string }>;
                const newCalcNames = calcColItems
                  .map(c => String(c?.label ?? '').trim())
                  .filter(name => Boolean(name) && !colnames.includes(name));
                if (newCalcNames.length) {
                  colnames = [...colnames, ...newCalcNames];
                  coltypes = [
                    ...coltypes,
                    ...newCalcNames.map(() => GenericDataType.Numeric),
                  ];
                }

                const normalizedTypes = colnames.map(
                  (_, index) => coltypes[index] ?? GenericDataType.String,
                );

                return {
                  queryResponse,
                  columnsPropsObject: {
                    colnames,
                    coltypes: normalizedTypes,
                  },
                };
              },
            },
          },
        ],
      ],
    },
    {
      label: t('Visual formatting'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'show_cell_bars',
            config: {
              type: 'CheckboxControl',
              label: t('Show cell bars'),
              renderTrigger: true,
              default: true,
              description: t(
                'Whether to display a bar chart background in table columns',
              ),
            },
          },
        ],
        [
          {
            name: 'align_pn',
            config: {
              type: 'CheckboxControl',
              label: t('Align +/-'),
              renderTrigger: true,
              default: false,
              description: t(
                'Whether to align background charts with both positive and negative values at 0',
              ),
            },
          },
        ],
        [
          {
            name: 'color_pn',
            config: {
              type: 'CheckboxControl',
              label: t('Add colors to cell bars for +/-'),
              renderTrigger: true,
              default: true,
              description: t(
                'Whether to colorize numeric values by whether they are positive or negative',
              ),
            },
          },
        ],
        [
          {
            name: 'comparison_color_enabled',
            config: {
              type: 'CheckboxControl',
              label: t('Basic conditional formatting'),
              renderTrigger: true,
              visibility: ({ controls }) =>
                !isEmpty(controls?.time_compare?.value),
              default: false,
              description: t(
                'This will be applied to the whole table. Arrows (↑ and ↓) will be added to ' +
                  'main columns for increase and decrease. Basic conditional formatting can be ' +
                  'overwritten by conditional formatting below.',
              ),
            },
          },
        ],
        [
          {
            name: 'comparison_color_scheme',
            config: {
              type: 'SelectControl',
              label: t('Color type'),
              default: ColorSchemeEnum.Green,
              renderTrigger: true,
              choices: [
                [ColorSchemeEnum.Green, 'Green for increase, red for decrease'],
                [ColorSchemeEnum.Red, 'Red for increase, green for decrease'],
              ],
              visibility: ({ controls }) =>
                !isEmpty(controls?.time_compare?.value) &&
                Boolean(controls?.comparison_color_enabled?.value),
              description: t(
                'Adds color to the chart symbols based on the positive or ' +
                  'negative change from the comparison value.',
              ),
            },
          },
        ],
        [
          {
            name: 'conditional_formatting',
            config: {
              type: 'ConditionalFormattingControl',
              renderTrigger: true,
              label: t('Custom Conditional Formatting'),
              extraColorChoices: [
                {
                  value: ColorSchemeEnum.Green,
                  label: t('Green for increase, red for decrease'),
                },
                {
                  value: ColorSchemeEnum.Red,
                  label: t('Red for increase, green for decrease'),
                },
              ],
              description: t(
                'Apply conditional color formatting to numeric and dimension (string) columns',
              ),
              shouldMapStateToProps() {
                return true;
              },
              mapStateToProps(explore, _, chart) {
                // Construir SIEMPRE un diccionario seguro (Record<string,string>)
                const vm: VerboseMap = toVerboseMap(
                  explore?.datasource as Dataset | undefined,
                );

                const chartStatus = chart?.chartStatus;
                const { colnames, coltypes } =
                  chart?.queriesResponse?.[0] ?? {};
                const numericColumns: OptionLV[] =
                  Array.isArray(colnames) && Array.isArray(coltypes)
                    ? colnames
                        .map((colname: string, index: number) => ({
                          value: colname,
                          label: vm[colname] ?? colname,
                          // attach type metadata so the popover can decide which operators to show
                          type: coltypes[index],
                        }))
                        .filter((c: any) => c.type === GenericDataType.Numeric)
                    : [];

                // also expose string (dimension) columns so conditional formatting can target them
                const stringColumns: OptionLV[] =
                  Array.isArray(colnames) && Array.isArray(coltypes)
                    ? colnames
                        .map((colname: string, index: number) => ({
                          value: colname,
                          label: vm[colname] ?? colname,
                          type: coltypes[index],
                        }))
                        .filter((c: any) => c.type === GenericDataType.String)
                    : [];

                // Merge numeric and string columns. When using time_compare, only numeric columns
                // are relevant for comparison; otherwise allow both numeric and string columns.
                const baseColumns = [...numericColumns, ...stringColumns];

                const columnOptions = explore?.controls?.time_compare?.value
                  ? processComparisonColumns(
                      // comparisons only make sense for numeric columns
                      numericColumns || [],
                      ensureIsArray(
                        explore?.controls?.time_compare?.value,
                      )[0]?.toString() || '',
                    )
                  : baseColumns;

                return {
                  removeIrrelevantConditions: chartStatus === 'success',
                  columnOptions,
                  verboseMap: vm,
                } as any;
              },
            },
          },
        ],
      ],
    },
    {
      ...sections.timeComparisonControls({
        multi: false,
        showCalculationType: false,
        showFullChoices: false,
      }),
      visibility: isAggMode,
    },
  ],
  formDataOverrides: formData => ({
    ...formData,
    metrics: getStandardizedControls().popAllMetrics(),
    groupby: getStandardizedControls().popAllColumns(),
  }),
};

export default config;
