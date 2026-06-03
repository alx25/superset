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
  ChartProps,
  DataRecord,
  ensureIsArray,
  extractTimegrain,
  GenericDataType,
  getColumnLabel,
  getMetricLabel,
  getTimeFormatter,
  getTimeFormatterForGranularity,
  QueryFormMetric,
  QueryFormData,
  SMART_DATE_ID,
  TimeFormats,
} from '@superset-ui/core';
import { getColorFormatters } from '@superset-ui/chart-controls';
import { DateFormatter, FormulaMetric, PivotTableTheme, RgbColor } from '../types';

const { DATABASE_DATETIME } = TimeFormats;

function isNumeric(key: string, data: DataRecord[] = []) {
  return data.every(
    record =>
      record[key] === null ||
      record[key] === undefined ||
      typeof record[key] === 'number',
  );
}

const toRgba = (color?: RgbColor | string | null): string | undefined => {
  if (!color) {
    return undefined;
  }
  if (typeof color === 'string') {
    return color;
  }
  const toNumber = (value: unknown) => {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };
  const r = toNumber(color.r);
  const g = toNumber(color.g);
  const b = toNumber(color.b);
  const a = toNumber(color.a);
  if ([r, g, b].some(value => value === null)) {
    return undefined;
  }
  if (a === null || a === undefined || a === 1) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

function parseFormulaMetrics(raw?: string | FormulaMetric[]): FormulaMetric[] {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    const formulas: FormulaMetric[] = [];
    const seen = new Set<string>();
    raw.forEach(item => {
      if (!item || typeof item !== 'object') {
        return;
      }
      const label = String(item.label || '').trim();
      const expression = String(item.expression || '').trim();
      const d3format =
        item.d3format !== undefined ? String(item.d3format).trim() : undefined;
      const hidden = item.hidden === true;
      if (!label || !expression || seen.has(label)) {
        return;
      }
      seen.add(label);
      formulas.push({ label, expression, d3format, hidden });
    });
    return formulas;
  }
  if (typeof raw !== 'string') {
    return [];
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  const formulas: FormulaMetric[] = [];
  const seen = new Set<string>();
  const addFormula = (
    label?: string,
    expression?: string,
    d3format?: string,
  ) => {
    const cleanLabel = (label || '').trim();
    const cleanExpression = (expression || '').trim();
    if (!cleanLabel || !cleanExpression || seen.has(cleanLabel)) {
      return;
    }
    seen.add(cleanLabel);
    formulas.push({
      label: cleanLabel,
      expression: cleanExpression,
      d3format: d3format ? d3format.trim() : undefined,
    });
  };

  const tryParseJson = () => {
    if (!['{', '['].includes(trimmed[0])) {
      return false;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        parsed.forEach(item => {
          if (typeof item === 'string') {
            const [label, expr] = item.split(/[:=]/);
            addFormula(label, expr);
            return;
          }
          if (item && typeof item === 'object') {
            addFormula(
              item.label || item.name,
              item.expression || item.expr,
              item.d3format || item.format,
            );
          }
        });
      } else if (parsed && typeof parsed === 'object') {
        Object.entries(parsed).forEach(([label, expr]) => {
          if (expr && typeof expr === 'object') {
            const exprObj = expr as Record<string, any>;
            addFormula(
              label,
              exprObj.expression || exprObj.expr || '',
              exprObj.d3format || exprObj.format,
            );
            return;
          }
          addFormula(label, typeof expr === 'string' ? expr : '');
        });
      }
      return formulas.length > 0;
    } catch {
      return false;
    }
  };

  if (!tryParseJson()) {
    trimmed.split('\n').forEach(line => {
      const cleaned = line.trim();
      if (!cleaned || cleaned.startsWith('#') || cleaned.startsWith('//')) {
        return;
      }
      const match = cleaned.match(/^([^:=]+)[:=](.+)$/);
      if (!match) {
        return;
      }
      addFormula(match[1], match[2]);
    });
  }

  return formulas;
}

const FORMULA_TOKEN_REGEX =
  /(?:\b(total|row|col|previous|next)\.)?\{\{\s*([^}]+?)\s*\}\}/g;
const FORMULA_FUNCTION_ALIASES: Record<string, string> = {
  IF: '__IF',
  OR: '__OR',
  AND: '__AND',
  NOT: '__NOT',
  ISBLANK: '__ISBLANK',
  ABS: '__ABS',
  ROUND: '__ROUND',
  MAX: '__MAX',
  MIN: '__MIN',
  NULLIF: '__NULLIF',
  TRUE: 'true',
  FALSE: 'false',
  NULL: 'null',
  NAN: 'NaN',
};

const tokenizeFormula = (expression: string) => {
  const tokens: Array<{ type: string; value: string }> = [];
  let idx = 0;
  while (idx < expression.length) {
    const char = expression[idx];
    if (/\s/.test(char)) {
      idx += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      let end = idx + 1;
      let escaped = false;
      while (end < expression.length) {
        const nextChar = expression[end];
        if (escaped) {
          escaped = false;
          end += 1;
          continue;
        }
        if (nextChar === '\\') {
          escaped = true;
          end += 1;
          continue;
        }
        if (nextChar === quote) {
          end += 1;
          break;
        }
        end += 1;
      }
      if (expression[end - 1] !== quote) {
        return null;
      }
      tokens.push({ type: 'string', value: expression.slice(idx, end) });
      idx = end;
      continue;
    }
    if (/\d/.test(char) || (char === '.' && /\d/.test(expression[idx + 1]))) {
      const match = expression.slice(idx).match(
        /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
      );
      if (!match) {
        return null;
      }
      tokens.push({ type: 'number', value: match[0] });
      idx += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const match = expression.slice(idx).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (!match) {
        return null;
      }
      tokens.push({ type: 'identifier', value: match[0] });
      idx += match[0].length;
      continue;
    }

    const three = expression.slice(idx, idx + 3);
    if (three === '===') {
      tokens.push({ type: 'operator', value: three });
      idx += 3;
      continue;
    }
    const two = expression.slice(idx, idx + 2);
    if (['>=', '<=', '!=', '<>', '=='].includes(two)) {
      tokens.push({ type: 'operator', value: two });
      idx += 2;
      continue;
    }
    if (['+', '-', '*', '/', '(', ')', ',', '>', '<', '='].includes(char)) {
      tokens.push({ type: 'operator', value: char });
      idx += 1;
      continue;
    }
    return null;
  }
  return tokens;
};

const buildFormulaExpression = (expression: string) => {
  const tokens = tokenizeFormula(expression);
  if (!tokens) {
    return null;
  }
  const output: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === 'identifier') {
      const upper = token.value.toUpperCase();
      if (FORMULA_FUNCTION_ALIASES[upper]) {
        output.push(FORMULA_FUNCTION_ALIASES[upper]);
        continue;
      }
      if (/^__p\d+$/.test(token.value)) {
        output.push(token.value);
        continue;
      }
      return null;
    }
    if (token.type === 'operator') {
      switch (token.value) {
        case '=':
        case '==':
          output.push('===');
          break;
        case '!=':
        case '<>':
          output.push('!==');
          break;
        default:
          output.push(token.value);
      }
      continue;
    }
    output.push(token.value);
  }
  return output.join(' ');
};

const makeGroupKey = (values: any[]) =>
  values.map(value => String(value ?? '')).join('\u0000');

const buildMetricTotals = (
  data: DataRecord[],
  metricNames: string[],
) => {
  const totals: Record<string, number> = {};
  metricNames.forEach(name => {
    totals[name] = 0;
  });
  data.forEach(record => {
    metricNames.forEach(name => {
      const value = Number(record[name]);
      if (Number.isFinite(value)) {
        totals[name] += value;
      }
    });
  });
  return totals;
};

const buildGroupTotals = (
  data: DataRecord[],
  groupCols: string[],
  metricNames: string[],
) => {
  const totals = new Map<string, Record<string, number>>();
  data.forEach(record => {
    const key = makeGroupKey(groupCols.map(col => record[col]));
    let entry = totals.get(key);
    if (!entry) {
      entry = {};
      metricNames.forEach(name => {
        entry![name] = 0;
      });
      totals.set(key, entry);
    }
    metricNames.forEach(name => {
      const value = Number(record[name]);
      if (Number.isFinite(value)) {
        entry![name] += value;
      }
    });
  });
  return totals;
};

type FormulaParamSpec = { scope: string; name: string };
type CompiledFormula = {
  paramSpecs: FormulaParamSpec[];
  compiledFn: (...args: any[]) => any;
};

const formulaHelpers = {
  __IF: (cond: any, onTrue: any, onFalse: any) => (cond ? onTrue : onFalse),
  __OR: (...args: any[]) => args.some(Boolean),
  __AND: (...args: any[]) => args.every(Boolean),
  __NOT: (value: any) => !value,
  __ISBLANK: (value: any) =>
    value === null || value === undefined || value === '' || Number.isNaN(value),
  __ABS: (value: any) => {
    const num = Number(value);
    return Number.isFinite(num) ? Math.abs(num) : NaN;
  },
  __ROUND: (value: any, precision: any = 0) => {
    const num = Number(value);
    const prec = Number(precision);
    if (!Number.isFinite(num)) return NaN;
    const safePrec = Number.isFinite(prec) ? prec : 0;
    const factor = 10 ** safePrec;
    return Math.round(num * factor) / factor;
  },
  __MAX: (...args: any[]) => {
    const nums = args.map(Number).filter(Number.isFinite);
    return nums.length ? Math.max(...nums) : NaN;
  },
  __MIN: (...args: any[]) => {
    const nums = args.map(Number).filter(Number.isFinite);
    return nums.length ? Math.min(...nums) : NaN;
  },
  __NULLIF: (a: any, b: any = null) => (a === b ? null : a),
};

const HELPER_PARAM_NAMES = Object.keys(formulaHelpers);
const HELPER_PARAM_VALUES = Object.values(formulaHelpers);

const formulaCompileCache = new Map<string, CompiledFormula | null>();

const compileFormula = (expression: string): CompiledFormula | null => {
  if (formulaCompileCache.has(expression)) {
    return formulaCompileCache.get(expression)!;
  }
  const paramSpecs: FormulaParamSpec[] = [];
  const paramMap = new Map<string, string>();
  const tokenized = expression.replace(
    FORMULA_TOKEN_REGEX,
    (_, rawScope, rawName) => {
      const scope = String(rawScope || '').trim().toLowerCase();
      const name = String(rawName || '').trim();
      const key = `${scope}|${name}`;
      if (!paramMap.has(key)) {
        const paramName = `__p${paramSpecs.length}`;
        paramMap.set(key, paramName);
        paramSpecs.push({ scope, name });
      }
      return paramMap.get(key)!;
    },
  );
  if (paramSpecs.length === 0) {
    formulaCompileCache.set(expression, null);
    return null;
  }
  const parsedExpression = buildFormulaExpression(tokenized);
  if (!parsedExpression) {
    formulaCompileCache.set(expression, null);
    return null;
  }
  const paramNames = paramSpecs.map((_, i) => `__p${i}`);
  try {
    // eslint-disable-next-line no-new-func
    const compiledFn = Function(
      ...paramNames,
      ...HELPER_PARAM_NAMES,
      `"use strict"; return (${parsedExpression});`,
    ) as (...args: any[]) => any;
    const result: CompiledFormula = { paramSpecs, compiledFn };
    formulaCompileCache.set(expression, result);
    return result;
  } catch {
    formulaCompileCache.set(expression, null);
    return null;
  }
};

const evaluateFormula = (
  expression: string,
  record: DataRecord,
  rowKey: string,
  colKey: string,
  totals: Record<string, number>,
  rowTotals: Map<string, Record<string, number>>,
  colTotals: Map<string, Record<string, number>>,
  previousRecord: DataRecord | null = null,
  nextRecord: DataRecord | null = null,
) => {
  const compiled = compileFormula(expression);
  if (!compiled) return null;
  const { paramSpecs, compiledFn } = compiled;
  const args = paramSpecs.map(({ scope, name }) => {
    let value: any;
    if (scope === 'total') {
      value = totals?.[name];
    } else if (scope === 'row') {
      value = rowTotals.get(rowKey)?.[name];
    } else if (scope === 'col') {
      value = colTotals.get(colKey)?.[name];
    } else if (scope === 'previous') {
      if (previousRecord === null) return null;
      value = previousRecord[name];
    } else if (scope === 'next') {
      if (nextRecord === null) return null;
      value = nextRecord[name];
    } else {
      value = record?.[name];
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : NaN;
  });
  try {
    const result = compiledFn(...args, ...HELPER_PARAM_VALUES);
    if (result === null || result === undefined) return null;
    if (typeof result !== 'number' || !Number.isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
};

export default function transformProps(chartProps: ChartProps<QueryFormData>) {
  /**
   * This function is called after a successful response has been
   * received from the chart data endpoint, and is used to transform
   * the incoming data prior to being sent to the Visualization.
   *
   * The transformProps function is also quite useful to return
   * additional/modified props to your data viz component. The formData
   * can also be accessed from your PivotTableChart.tsx file, but
   * doing supplying custom props here is often handy for integrating third
   * party libraries that rely on specific props.
   *
   * A description of properties in `chartProps`:
   * - `height`, `width`: the height/width of the DOM element in which
   *   the chart is located
   * - `formData`: the chart data request payload that was sent to the
   *   backend.
   * - `queriesData`: the chart data response payload that was received
   *   from the backend. Some notable properties of `queriesData`:
   *   - `data`: an array with data, each row with an object mapping
   *     the column/alias to its value. Example:
   *     `[{ col1: 'abc', metric1: 10 }, { col1: 'xyz', metric1: 20 }]`
   *   - `rowcount`: the number of rows in `data`
   *   - `query`: the query that was issued.
   *
   * Please note: the transformProps function gets cached when the
   * application loads. When making changes to the `transformProps`
   * function during development with hot reloading, changes won't
   * be seen until restarting the development server.
   */
  const {
    width,
    height,
    queriesData,
    formData,
    rawFormData,
    hooks: { setDataMask = () => {}, onContextMenu },
    filterState,
    datasource: { verboseMap = {}, columnFormats = {}, currencyFormats = {} },
    emitCrossFilters,
    theme,
  } = chartProps;
  const { data, colnames, coltypes } = queriesData[0];
  const {
    groupbyRows,
    groupbyColumns,
    metrics,
    tableRenderer,
    colOrder,
    rowOrder,
    aggregateFunction,
    transposePivot,
    combineMetric,
    rowSubtotalPosition,
    colSubtotalPosition,
    colTotals,
    colSubTotals,
    rowTotals,
    rowSubTotals,
    rowCollapseByDefault,
    compactRowTree,
    valueFormat,
    dateFormat,
    metricsLayout,
    conditionalFormatting,
    conditionalFormattingSolid,
    timeGrainSqla,
    currencyFormat,
    allowRenderHtml,
    showCellTooltip,
    stickyHeaders,
    columnConfig,
    metricFormulas,
    metricOrder,
    tableThemeHeaderBg,
    tableThemeHeaderText,
    tableThemeRowHeaderBg,
    tableThemeRowHeaderText,
    tableThemeTotalBg,
    tableThemeTotalText,
    tableThemeSubtotalBg,
    tableThemeSubtotalText,
    tableThemeCellBg,
    tableThemeCellText,
    tableThemeBorderColor,
    tableThemeEnabled,
    jinjaFields,
  } = formData;
  const rawThemeData = rawFormData as Record<string, any>;
  const rawJinjaFields = rawThemeData?.jinja_fields;
  const resolvedJinjaFields = ensureIsArray(
    jinjaFields ?? rawJinjaFields,
  ) as QueryFormMetric[];
  const resolvedThemeEnabled =
    tableThemeEnabled ?? rawThemeData?.table_theme_enabled ?? true;
  const resolvedConditionalFormattingSolid =
    conditionalFormattingSolid ??
    rawThemeData?.conditional_formatting_solid;
  const resolvedThemeHeaderBg =
    tableThemeHeaderBg ?? rawThemeData?.table_theme_header_bg;
  const resolvedThemeHeaderText =
    tableThemeHeaderText ?? rawThemeData?.table_theme_header_text;
  const resolvedThemeRowHeaderBg =
    tableThemeRowHeaderBg ?? rawThemeData?.table_theme_row_header_bg;
  const resolvedThemeRowHeaderText =
    tableThemeRowHeaderText ?? rawThemeData?.table_theme_row_header_text;
  const resolvedThemeTotalBg =
    tableThemeTotalBg ?? rawThemeData?.table_theme_total_bg;
  const resolvedThemeTotalText =
    tableThemeTotalText ?? rawThemeData?.table_theme_total_text;
  const resolvedThemeSubtotalBg =
    tableThemeSubtotalBg ?? rawThemeData?.table_theme_subtotal_bg;
  const resolvedThemeSubtotalText =
    tableThemeSubtotalText ?? rawThemeData?.table_theme_subtotal_text;
  const resolvedThemeCellBg =
    tableThemeCellBg ?? rawThemeData?.table_theme_cell_bg;
  const resolvedThemeCellText =
    tableThemeCellText ?? rawThemeData?.table_theme_cell_text;
  const resolvedThemeBorderColor =
    tableThemeBorderColor ?? rawThemeData?.table_theme_border_color;
  const resolvedShowCellTooltip =
    showCellTooltip ?? rawThemeData?.show_cell_tooltip ?? true;
  const resolvedStickyHeaders =
    stickyHeaders ?? rawThemeData?.sticky_headers ?? false;
  const { selectedFilters } = filterState;
  const granularity = extractTimegrain(rawFormData);

  const dateFormatters = colnames
    .filter(
      (colname: string, index: number) =>
        coltypes[index] === GenericDataType.Temporal,
    )
    .reduce(
      (
        acc: Record<string, DateFormatter | undefined>,
        temporalColname: string,
      ) => {
        let formatter: DateFormatter | undefined;
        if (dateFormat === SMART_DATE_ID) {
          if (granularity) {
            // time column use formats based on granularity
            formatter = getTimeFormatterForGranularity(granularity);
          } else if (isNumeric(temporalColname, data)) {
            formatter = getTimeFormatter(DATABASE_DATETIME);
          } else {
            // if no column-specific format, print cell as is
            formatter = String;
          }
        } else if (dateFormat) {
          formatter = getTimeFormatter(dateFormat);
        }
        if (formatter) {
          acc[temporalColname] = formatter;
        }
        return acc;
      },
      {},
    );
  const formulaMetrics = parseFormulaMetrics(metricFormulas);
  const baseMetricNames = (metrics || [])
    .map((metric: QueryFormMetric) =>
      typeof metric === 'string' ? metric : metric.label,
    )
    .filter(Boolean) as string[];
  const jinjaFieldNames = resolvedJinjaFields
    .map(metric => getMetricLabel(metric))
    .filter(Boolean) as string[];
  const metricNamesForTotals = Array.from(
    new Set([...baseMetricNames, ...jinjaFieldNames]),
  );
  const baseMetricSet = new Set(baseMetricNames);
  const formulaMetricsForFormatting = formulaMetrics.filter(
    metric => !baseMetricSet.has(metric.label),
  );
  const rowGroupCols = (
    transposePivot ? groupbyColumns : groupbyRows
  )?.map(getColumnLabel) || [];
  const colGroupCols = (
    transposePivot ? groupbyRows : groupbyColumns
  )?.map(getColumnLabel) || [];
  const totals = buildMetricTotals(data, metricNamesForTotals);
  const rowTotalsMap = buildGroupTotals(data, rowGroupCols, metricNamesForTotals);
  const colTotalsMap = buildGroupTotals(data, colGroupCols, metricNamesForTotals);
  let dataWithFormulas: DataRecord[] = data;
  if (formulaMetricsForFormatting.length > 0) {
    const processedData: DataRecord[] = [];
    for (let i = 0; i < data.length; i += 1) {
      const record = data[i] as DataRecord;
      const rowKey = makeGroupKey(
        rowGroupCols.map((col: string) => record[col]),
      );
      const colKey = makeGroupKey(
        colGroupCols.map((col: string) => record[col]),
      );
      const computed: DataRecord = { ...record };
      const prevComputed: DataRecord | null =
        i > 0 ? processedData[i - 1] : null;
      const nextRaw: DataRecord | null =
        i < data.length - 1 ? (data[i + 1] as DataRecord) : null;
      formulaMetricsForFormatting.forEach(metric => {
        const value = evaluateFormula(
          metric.expression,
          computed,
          rowKey,
          colKey,
          totals,
          rowTotalsMap,
          colTotalsMap,
          prevComputed,
          nextRaw,
        );
        computed[metric.label] = value;
      });
      processedData.push(computed);
    }
    dataWithFormulas = processedData;
  }
  const metricColorFormatters = getColorFormatters(
    conditionalFormatting,
    dataWithFormulas,
    theme,
    !resolvedConditionalFormattingSolid,
  );
  const tableTheme: PivotTableTheme = resolvedThemeEnabled
    ? {
        headerBg: toRgba(resolvedThemeHeaderBg),
        headerText: toRgba(resolvedThemeHeaderText),
        rowHeaderBg: toRgba(resolvedThemeRowHeaderBg),
        rowHeaderText: toRgba(resolvedThemeRowHeaderText),
        totalBg: toRgba(resolvedThemeTotalBg),
        totalText: toRgba(resolvedThemeTotalText),
        subtotalBg: toRgba(resolvedThemeSubtotalBg),
        subtotalText: toRgba(resolvedThemeSubtotalText),
        cellBg: toRgba(resolvedThemeCellBg),
        cellText: toRgba(resolvedThemeCellText),
        borderColor: toRgba(resolvedThemeBorderColor),
      }
    : {};

  return {
    width,
    height,
    data,
    groupbyRows,
    groupbyColumns,
    metrics,
    tableRenderer,
    colOrder,
    rowOrder,
    aggregateFunction,
    transposePivot,
    combineMetric,
    rowSubtotalPosition,
    colSubtotalPosition,
    colTotals,
    colSubTotals,
    rowTotals,
    rowSubTotals,
    rowCollapseByDefault,
    compactRowTree,
    valueFormat,
    currencyFormat,
    emitCrossFilters,
    setDataMask,
    selectedFilters,
    verboseMap,
    columnFormats,
    currencyFormats,
    metricsLayout,
    metricColorFormatters,
    dateFormatters,
    onContextMenu,
    timeGrainSqla,
    allowRenderHtml,
    showCellTooltip: resolvedShowCellTooltip,
    stickyHeaders: resolvedStickyHeaders,
    columnConfig,
    metricOrder,
    formulaMetrics,
    tableTheme,
    jinjaFields: jinjaFieldNames,
  };
}
