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

import { Component } from 'react';
import { t, safeHtmlSpan } from '@superset-ui/core';
import PropTypes from 'prop-types';
import { FaSort } from '@react-icons/all-files/fa/FaSort';
import { FaSortDown as FaSortDesc } from '@react-icons/all-files/fa/FaSortDown';
import { FaSortUp as FaSortAsc } from '@react-icons/all-files/fa/FaSortUp';
import { PivotData, flatKey } from './utilities';
import { Styles } from './Styles';
import { renderHtmlTemplate } from '../utils/formatValue';

const parseLabel = value => {
  if (typeof value === 'string') {
    if (value === 'metric') return t('metric');
    return value;
  }
  if (typeof value === 'number') {
    return value;
  }
  return String(value);
};

const stripHtmlTags = value => String(value ?? '').replace(/<[^>]+>/g, '');

const FORMULA_TOKEN_REGEX =
  /(?:\b(total|row|col|previous|next)\.)?\{\{\s*([^}]+?)\s*\}\}/g;
const FORMULA_FUNCTION_ALIASES = {
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

const tokenizeFormula = expression => {
  const tokens = [];
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

const buildFormulaExpression = expression => {
  const tokens = tokenizeFormula(expression);
  if (!tokens) {
    return null;
  }
  const output = [];
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

const rendererFormulaHelpers = {
  __IF: (cond, onTrue, onFalse) => (cond ? onTrue : onFalse),
  __OR: (...args) => args.some(Boolean),
  __AND: (...args) => args.every(Boolean),
  __NOT: value => !value,
  __ISBLANK: value =>
    value === null || value === undefined || value === '' || Number.isNaN(value),
  __ABS: value => {
    const num = Number(value);
    return Number.isFinite(num) ? Math.abs(num) : NaN;
  },
  __ROUND: (value, precision = 0) => {
    const num = Number(value);
    const prec = Number(precision);
    if (!Number.isFinite(num)) return NaN;
    const safePrec = Number.isFinite(prec) ? prec : 0;
    const factor = 10 ** safePrec;
    return Math.round(num * factor) / factor;
  },
  __MAX: (...args) => {
    const nums = args.map(Number).filter(Number.isFinite);
    return nums.length ? Math.max(...nums) : NaN;
  },
  __MIN: (...args) => {
    const nums = args.map(Number).filter(Number.isFinite);
    return nums.length ? Math.min(...nums) : NaN;
  },
  __NULLIF: (a, b = null) => (a === b ? null : a),
};

const RENDERER_HELPER_NAMES = Object.keys(rendererFormulaHelpers);
const RENDERER_HELPER_VALUES = Object.values(rendererFormulaHelpers);

const rendererCompileCache = new Map();

const compileRendererFormula = expression => {
  if (rendererCompileCache.has(expression)) {
    return rendererCompileCache.get(expression);
  }
  const paramSpecs = [];
  const paramMap = new Map();
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
      return paramMap.get(key);
    },
  );
  if (paramSpecs.length === 0) {
    rendererCompileCache.set(expression, null);
    return null;
  }
  const parsedExpression = buildFormulaExpression(tokenized);
  if (!parsedExpression) {
    rendererCompileCache.set(expression, null);
    return null;
  }
  const paramNames = paramSpecs.map((_, i) => `__p${i}`);
  try {
    // eslint-disable-next-line no-new-func
    const compiledFn = Function(
      ...paramNames,
      ...RENDERER_HELPER_NAMES,
      `"use strict"; return (${parsedExpression});`,
    );
    const result = { paramSpecs, compiledFn };
    rendererCompileCache.set(expression, result);
    return result;
  } catch {
    rendererCompileCache.set(expression, null);
    return null;
  }
};

function displayCell(value, allowRenderHtml) {
  if (allowRenderHtml && typeof value === 'string') {
    return safeHtmlSpan(value);
  }
  return parseLabel(value);
}
function displayHeaderCell(
  needToggle,
  ArrowIcon,
  onArrowClick,
  value,
  namesMapping,
  allowRenderHtml,
) {
  const name = namesMapping[value] || value;
  const parsedLabel = parseLabel(name);
  const labelContent =
    allowRenderHtml && typeof parsedLabel === 'string'
      ? safeHtmlSpan(parsedLabel)
      : parsedLabel;
  return needToggle ? (
    <span className="toggle-wrapper">
      <span
        role="button"
        tabIndex="0"
        className="toggle"
        onClick={onArrowClick}
      >
        {ArrowIcon}
      </span>
      <span className="toggle-val">{labelContent}</span>
    </span>
  ) : (
    labelContent
  );
}

function getCellColor(keys, aggValue, cellColorFormatters) {
  if (!cellColorFormatters) {
    return { backgroundColor: undefined };
  }

  let backgroundColor;
  Object.values(cellColorFormatters).forEach(cellColorFormatter => {
    if (!Array.isArray(cellColorFormatter)) {
      return;
    }
    keys.forEach(key => {
      cellColorFormatter
        .filter(formatter => formatter.column === key)
        .forEach(formatter => {
          const formatterResult = formatter.getColorFromValue(aggValue);
          if (formatterResult) {
            backgroundColor = formatterResult;
          }
        });
    });
  });

  return { backgroundColor };
}

function sortHierarchicalObject(obj, objSort, rowPartialOnTop) {
  const sortedKeys = Object.keys(obj).sort((a, b) => {
    const valA = obj[a].currentVal || 0;
    const valB = obj[b].currentVal || 0;
    if (rowPartialOnTop) {
      if (obj[a].currentVal !== undefined && obj[b].currentVal === undefined) {
        return -1;
      }
      if (obj[b].currentVal !== undefined && obj[a].currentVal === undefined) {
        return 1;
      }
    }
    return objSort === 'asc' ? valA - valB : valB - valA;
  });

  const result = new Map();
  sortedKeys.forEach(key => {
    const value = obj[key];
    if (typeof value === 'object' && !Array.isArray(value)) {
      result.set(key, sortHierarchicalObject(value, objSort, rowPartialOnTop));
    } else {
      result.set(key, value);
    }
  });
  return result;
}

function convertToArray(
  obj,
  rowEnabled,
  rowPartialOnTop,
  maxRowIndex,
  parentKeys = [],
  result = [],
  flag = false,
) {
  let updatedFlag = flag;
  const keys = Array.from(obj.keys());
  const getValue = key => obj.get(key);

  keys.forEach(key => {
    if (key === 'currentVal') {
      return;
    }
    const value = getValue(key);
    if (rowEnabled && rowPartialOnTop && parentKeys.length < maxRowIndex - 1) {
      result.push(parentKeys.length > 0 ? [...parentKeys, key] : [key]);
      updatedFlag = true;
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      convertToArray(
        value,
        rowEnabled,
        rowPartialOnTop,
        maxRowIndex,
        [...parentKeys, key],
        result,
      );
    }
    if (
      parentKeys.length >= maxRowIndex - 1 ||
      (rowEnabled && !rowPartialOnTop)
    ) {
      if (!updatedFlag) {
        result.push(parentKeys.length > 0 ? [...parentKeys, key] : [key]);
        return;
      }
    }
    if (parentKeys.length === 0 && maxRowIndex === 1) {
      result.push([key]);
    }
  });
  return result;
}

export class TableRenderer extends Component {
  constructor(props) {
    super(props);

    // We need state to record which entries are collapsed and which aren't.
    // This is an object with flat-keys indicating if the corresponding rows
    // should be collapsed.
    this.state = { collapsedRows: {}, collapsedCols: {}, sortingOrder: [] };
    this.sortCache = new Map();

    this.clickHeaderHandler = this.clickHeaderHandler.bind(this);
    this.clickHandler = this.clickHandler.bind(this);
    this.collapseAll = this.collapseAll.bind(this);
    this.expandAll = this.expandAll.bind(this);

    this.lastPivotData = null;
    this.formulaTotalsCache = new Map();
    this.metricNamesCache = null;
    this.metricNamesCacheSource = null;
  }

  getTableThemeStyle() {
    const theme = this.props.tableTheme || {};
    const style = {};
    if (theme.headerBg) {
      style['--pvt-header-bg'] = theme.headerBg;
    }
    if (theme.headerText) {
      style['--pvt-header-text'] = theme.headerText;
    }
    if (theme.rowHeaderBg) {
      style['--pvt-row-header-bg'] = theme.rowHeaderBg;
    }
    if (theme.rowHeaderText) {
      style['--pvt-row-header-text'] = theme.rowHeaderText;
    }
    if (theme.totalBg) {
      style['--pvt-total-bg'] = theme.totalBg;
    }
    if (theme.totalText) {
      style['--pvt-total-text'] = theme.totalText;
    }
    if (theme.subtotalBg) {
      style['--pvt-subtotal-bg'] = theme.subtotalBg;
    }
    if (theme.subtotalText) {
      style['--pvt-subtotal-text'] = theme.subtotalText;
    }
    if (theme.cellBg) {
      style['--pvt-cell-bg'] = theme.cellBg;
    }
    if (theme.cellText) {
      style['--pvt-cell-text'] = theme.cellText;
    }
    if (theme.borderColor) {
      style['--pvt-border-color'] = theme.borderColor;
    }
    return style;
  }

  getMetricInfo(rowKey, colKey, rowAttrs, colAttrs, metricKey) {
    const rowIdx = rowAttrs.indexOf(metricKey);
    if (rowIdx >= 0 && rowIdx < rowKey.length) {
      return { axis: 'row', index: rowIdx, value: rowKey[rowIdx] };
    }
    const colIdx = colAttrs.indexOf(metricKey);
    if (colIdx >= 0 && colIdx < colKey.length) {
      return { axis: 'col', index: colIdx, value: colKey[colIdx] };
    }
    return null;
  }

  getMetricValue(pivotData, rowKey, colKey, rowAttrs, colAttrs, metricKey, name) {
    if (!name) {
      return null;
    }
    const rowIdx = rowAttrs.indexOf(metricKey);
    if (rowIdx >= 0) {
      const nextRowKey = [...rowKey];
      if (rowIdx >= nextRowKey.length) {
        return null;
      }
      nextRowKey[rowIdx] = name;
      return pivotData.getAggregator(nextRowKey, colKey).value();
    }
    const colIdx = colAttrs.indexOf(metricKey);
    if (colIdx >= 0) {
      const nextColKey = [...colKey];
      if (colIdx >= nextColKey.length) {
        return null;
      }
      nextColKey[colIdx] = name;
      return pivotData.getAggregator(rowKey, nextColKey).value();
    }
    return null;
  }

  resetFormulaCache(pivotData) {
    if (this.lastPivotData !== pivotData) {
      this.lastPivotData = pivotData;
      this.formulaTotalsCache = new Map();
      this.formulaResultCache = new Map();
      this.metricNamesCache = null;
      this.metricNamesCacheSource = pivotData;
    }
  }

  buildScopedFilters(attrs, keys, metricKey) {
    if (!Array.isArray(attrs) || !Array.isArray(keys)) {
      return [];
    }
    const filters = [];
    const limit = Math.min(attrs.length, keys.length);
    for (let i = 0; i < limit; i += 1) {
      const attr = attrs[i];
      if (attr === metricKey) {
        continue;
      }
      filters.push([attr, keys[i]]);
    }
    return filters;
  }

  getMetricScopedTotal(
    pivotData,
    rowKey,
    colKey,
    rowAttrs,
    colAttrs,
    metricKey,
    name,
    scope,
  ) {
    if (!pivotData || !metricKey || !name) {
      return null;
    }
    this.resetFormulaCache(pivotData);
    const rowKeyPart = scope === 'col' ? '' : flatKey(rowKey || []);
    const colKeyPart = scope === 'row' ? '' : flatKey(colKey || []);
    const cacheKey = `${scope}|${name}|${rowKeyPart}|${colKeyPart}`;
    if (this.formulaTotalsCache.has(cacheKey)) {
      return this.formulaTotalsCache.get(cacheKey);
    }

    const records = pivotData?.props?.data;
    if (!Array.isArray(records) || records.length === 0) {
      this.formulaTotalsCache.set(cacheKey, null);
      return null;
    }

    const aggregator =
      typeof pivotData.aggregator === 'function'
        ? pivotData.aggregator(pivotData, [], [])
        : null;
    if (!aggregator || typeof aggregator.push !== 'function') {
      this.formulaTotalsCache.set(cacheKey, null);
      return null;
    }

    const rowFilters =
      scope === 'row'
        ? this.buildScopedFilters(rowAttrs, rowKey, metricKey)
        : [];
    const colFilters =
      scope === 'col'
        ? this.buildScopedFilters(colAttrs, colKey, metricKey)
        : [];

    records.forEach(record => {
      if (!record || record.__isFormula) {
        return;
      }
      if (record[metricKey] !== name) {
        return;
      }
      for (let i = 0; i < rowFilters.length; i += 1) {
        const [attr, value] = rowFilters[i];
        if (record[attr] !== value) {
          return;
        }
      }
      for (let i = 0; i < colFilters.length; i += 1) {
        const [attr, value] = colFilters[i];
        if (record[attr] !== value) {
          return;
        }
      }
      aggregator.push(record);
    });

    const value =
      typeof aggregator.value === 'function' ? aggregator.value() : null;
    this.formulaTotalsCache.set(cacheKey, value);
    return value;
  }

  getAdjacentRowKey(pivotData, rowKey, rowAttrs, direction) {
    // Use pivotData.rowKeys (react-pivottable PivotData property) when available
    let rowKeys = pivotData?.rowKeys;
    if (!Array.isArray(rowKeys) || rowKeys.length === 0) {
      // Fallback: extract unique row keys from raw data in order
      const records = pivotData?.props?.data;
      if (!Array.isArray(records)) return null;
      const seen = new Set();
      rowKeys = [];
      records.forEach(record => {
        const key = (rowAttrs || []).map(a => record[a]);
        const keyStr = JSON.stringify(key);
        if (!seen.has(keyStr)) {
          seen.add(keyStr);
          rowKeys.push(key);
        }
      });
    }
    if (!rowKeys || rowKeys.length === 0) return null;
    const currentIdx = rowKeys.findIndex(
      k => Array.isArray(k) && k.length === rowKey.length && k.every((v, i) => v === rowKey[i]),
    );
    if (currentIdx < 0) return null;
    const targetIdx = direction === 'previous' ? currentIdx - 1 : currentIdx + 1;
    if (targetIdx < 0 || targetIdx >= rowKeys.length) return null;
    return rowKeys[targetIdx];
  }

  evaluateFormulaExpressionCached(
    pivotData,
    rowKey,
    colKey,
    rowAttrs,
    colAttrs,
    expression,
    evaluating,
  ) {
    this.resetFormulaCache(pivotData);
    const cacheKey = `${JSON.stringify(rowKey)}|${JSON.stringify(colKey)}|${expression}`;
    if (this.formulaResultCache.has(cacheKey)) {
      return this.formulaResultCache.get(cacheKey);
    }
    if (evaluating.has(cacheKey)) {
      return null; // cycle detected
    }
    evaluating.add(cacheKey);
    const result = this.evaluateFormulaExpression(
      pivotData, rowKey, colKey, rowAttrs, colAttrs, expression, evaluating,
    );
    evaluating.delete(cacheKey);
    this.formulaResultCache.set(cacheKey, result);
    return result;
  }

  evaluateFormulaExpression(
    pivotData,
    rowKey,
    colKey,
    rowAttrs,
    colAttrs,
    expression,
    evaluating,
  ) {
    const { metricKey, formulaMetrics = [] } = this.props;
    if (!metricKey || !expression) {
      return null;
    }
    this.resetFormulaCache(pivotData);
    const activeEvaluating = evaluating || new Set();

    const compiled = compileRendererFormula(expression);
    if (!compiled) return null;

    const { paramSpecs, compiledFn } = compiled;
    const args = paramSpecs.map(({ scope, name }) => {
      if (scope === 'total' || scope === 'row' || scope === 'col') {
        const val = this.getMetricScopedTotal(
          pivotData, rowKey, colKey, rowAttrs, colAttrs, metricKey, name, scope,
        );
        const n = Number(val);
        return Number.isFinite(n) ? n : NaN;
      }
      if (scope === 'previous' || scope === 'next') {
        const adjRowKey = this.getAdjacentRowKey(pivotData, rowKey, rowAttrs, scope);
        if (adjRowKey === null) return null; // no adjacent row → null (ISBLANK-detectable)
        const adjFormula = formulaMetrics.find(m => m.label === name);
        if (adjFormula) {
          const fval = this.evaluateFormulaExpressionCached(
            pivotData, adjRowKey, colKey, rowAttrs, colAttrs, adjFormula.expression, activeEvaluating,
          );
          return fval === null ? NaN : fval;
        }
        const val = this.getMetricValue(
          pivotData, adjRowKey, colKey, rowAttrs, colAttrs, metricKey, name,
        );
        const n = Number(val);
        return Number.isFinite(n) ? n : NaN;
      }
      // Default scope: resolve formula metrics recursively, base metrics via aggregator
      const formulaForName = formulaMetrics.find(m => m.label === name);
      if (formulaForName) {
        const fval = this.evaluateFormulaExpressionCached(
          pivotData, rowKey, colKey, rowAttrs, colAttrs, formulaForName.expression, activeEvaluating,
        );
        return fval === null ? NaN : fval;
      }
      const val = this.getMetricValue(
        pivotData, rowKey, colKey, rowAttrs, colAttrs, metricKey, name,
      );
      const n = Number(val);
      return Number.isFinite(n) ? n : NaN;
    });

    try {
      const result = compiledFn(...args, ...RENDERER_HELPER_VALUES);
      if (result === null || result === undefined) return null;
      if (typeof result !== 'number' || !Number.isFinite(result)) return null;
      return result;
    } catch {
      return null;
    }
  }

  getFormulaValue(pivotData, rowKey, colKey, rowAttrs, colAttrs) {
    const { formulaMetrics = [], metricKey } = this.props;
    if (!metricKey || !formulaMetrics.length) {
      return { isFormula: false };
    }
    const metricInfo = this.getMetricInfo(
      rowKey,
      colKey,
      rowAttrs,
      colAttrs,
      metricKey,
    );
    if (!metricInfo) {
      return { isFormula: false };
    }
    const formula = formulaMetrics.find(
      metric => metric.label === metricInfo.value,
    );
    if (!formula || !formula.expression) {
      return { isFormula: false };
    }

    const value = this.evaluateFormulaExpressionCached(
      pivotData,
      rowKey,
      colKey,
      rowAttrs,
      colAttrs,
      formula.expression,
      new Set(),
    );
    return { isFormula: true, value };
  }

  getMetricNames(pivotData) {
    if (
      this.metricNamesCache &&
      this.metricNamesCacheSource === pivotData
    ) {
      return this.metricNamesCache;
    }
    this.resetFormulaCache(pivotData);
    const { metricKey } = this.props;
    const names = new Set();
    const records = pivotData?.props?.data;
    if (metricKey && Array.isArray(records)) {
      records.forEach(record => {
        const name = record?.[metricKey];
        if (name !== null && name !== undefined && name !== '') {
          names.add(String(name));
        }
      });
    }
    const list = Array.from(names.values());
    this.metricNamesCache = list;
    this.metricNamesCacheSource = pivotData;
    return list;
  }

  filterJinjaKeys(keys, attrs) {
    const { metricKey, jinjaFields = [] } = this.props;
    if (!metricKey || !Array.isArray(attrs) || !Array.isArray(keys)) {
      return keys;
    }
    if (!jinjaFields.length) {
      return keys;
    }
    const index = attrs.indexOf(metricKey);
    if (index === -1) {
      return keys;
    }
    const hidden = new Set(jinjaFields.map(name => String(name)));
    return keys.filter(key => !hidden.has(String(key[index])));
  }

  getFormulaMetricMap() {
    const map = new Map();
    const { formulaMetrics = [] } = this.props;
    formulaMetrics.forEach(metric => {
      const label = String(metric?.label || '').trim();
      const expression = String(metric?.expression || '').trim();
      if (label && expression) {
        map.set(label, expression);
      }
    });
    return map;
  }

  getMetricValueForTemplate(
    pivotData,
    rowKey,
    colKey,
    rowAttrs,
    colAttrs,
    metricName,
    formulaMap,
  ) {
    const { metricKey } = this.props;
    if (!metricKey || !metricName) {
      return null;
    }
    if (formulaMap && formulaMap.has(metricName)) {
      return this.evaluateFormulaExpression(
        pivotData,
        rowKey,
        colKey,
        rowAttrs,
        colAttrs,
        formulaMap.get(metricName),
      );
    }
    return this.getMetricValue(
      pivotData,
      rowKey,
      colKey,
      rowAttrs,
      colAttrs,
      metricKey,
      metricName,
    );
  }

  buildTemplateContext(
    pivotData,
    rowKey,
    colKey,
    rowAttrs,
    colAttrs,
    includeMetrics = true,
  ) {
    const context = {};
    const rowCount = Math.min(rowAttrs.length, rowKey.length);
    for (let i = 0; i < rowCount; i += 1) {
      context[rowAttrs[i]] = rowKey[i];
    }
    const colCount = Math.min(colAttrs.length, colKey.length);
    for (let i = 0; i < colCount; i += 1) {
      context[colAttrs[i]] = colKey[i];
    }

    if (!includeMetrics) {
      return context;
    }

    const metricNames = this.getMetricNames(pivotData);
    if (!metricNames.length) {
      return context;
    }

    const formulaMap = this.getFormulaMetricMap();
    const totals = {};
    const rowTotals = {};
    const colTotals = {};
    const { metricKey } = this.props;

    metricNames.forEach(name => {
      const value = this.getMetricValueForTemplate(
        pivotData,
        rowKey,
        colKey,
        rowAttrs,
        colAttrs,
        name,
        formulaMap,
      );
      if (value !== null && value !== undefined) {
        context[name] = value;
      }
      if (metricKey) {
        const totalValue = this.getMetricScopedTotal(
          pivotData,
          rowKey,
          colKey,
          rowAttrs,
          colAttrs,
          metricKey,
          name,
          'total',
        );
        if (totalValue !== null && totalValue !== undefined) {
          totals[name] = totalValue;
        }
        const rowTotalValue = this.getMetricScopedTotal(
          pivotData,
          rowKey,
          colKey,
          rowAttrs,
          colAttrs,
          metricKey,
          name,
          'row',
        );
        if (rowTotalValue !== null && rowTotalValue !== undefined) {
          rowTotals[name] = rowTotalValue;
        }
        const colTotalValue = this.getMetricScopedTotal(
          pivotData,
          rowKey,
          colKey,
          rowAttrs,
          colAttrs,
          metricKey,
          name,
          'col',
        );
        if (colTotalValue !== null && colTotalValue !== undefined) {
          colTotals[name] = colTotalValue;
        }
      }
    });

    context.total = totals;
    context.row = rowTotals;
    context.col = colTotals;
    return context;
  }

  formatValueWithTemplate({
    columnKey,
    rawValue,
    formattedValue,
    rowContext,
    allowRenderHtml,
    formatter,
  }) {
    const config = this.props.columnConfig?.[columnKey];
    if (
      !config?.enableHtmlTemplate ||
      typeof config.htmlTemplate !== 'string' ||
      !config.htmlTemplate.trim()
    ) {
      return formattedValue;
    }
    const rendered = renderHtmlTemplate(config.htmlTemplate, {
      row: rowContext,
      columnKey,
      rawValue,
      formattedValue: formattedValue ?? '',
      formatter,
    });
    if (allowRenderHtml === false) {
      return stripHtmlTags(rendered);
    }
    return rendered;
  }

  formatTooltipValue(attr, value) {
    const formatter = this.props.dateFormatters?.[attr];
    if (formatter) {
      return formatter(value);
    }
    if (value === null) {
      return 'NULL';
    }
    if (value === undefined) {
      return '';
    }
    return String(value);
  }

  buildAxisTooltipLines(title, attrs, keys) {
    const namesMapping = this.props.namesMapping || {};
    const lines = [];
    const limit = Math.min(attrs.length, keys.length);
    for (let i = 0; i < limit; i += 1) {
      const attr = attrs[i];
      if (attr === this.props.metricKey) {
        continue;
      }
      const label = namesMapping[attr] || attr;
      lines.push(`${label}: ${this.formatTooltipValue(attr, keys[i])}`);
    }
    return lines.length ? [title, ...lines] : [];
  }

  buildCellTooltip({
    rowKey,
    colKey,
    rowAttrs,
    colAttrs,
    metricInfo,
    formulaValue,
    rawValue,
    formattedValue,
    label,
  }) {
    if (!this.props.showCellTooltip) {
      return undefined;
    }
    const namesMapping = this.props.namesMapping || {};
    const lines = [];
    const metricName = metricInfo?.value;
    if (metricName) {
      lines.push(String(namesMapping[metricName] || metricName));
    } else if (label) {
      lines.push(label);
    }
    lines.push(`Valor: ${stripHtmlTags(formattedValue ?? '')}`);
    lines.push(`Raw: ${rawValue ?? ''}`);

    const rowLines = this.buildAxisTooltipLines(
      t('Rows'),
      rowAttrs,
      rowKey,
    );
    const colLines = this.buildAxisTooltipLines(
      t('Columns'),
      colAttrs,
      colKey,
    );
    if (rowLines.length) {
      lines.push('', ...rowLines);
    }
    if (colLines.length) {
      lines.push('', ...colLines);
    }

    if (formulaValue?.isFormula && metricName) {
      const formula = this.getFormulaMetricMap().get(metricName);
      if (formula) {
        lines.push('', t('Formula'), formula);
      }
    }
    return lines.join('\n');
  }

  getBasePivotSettings() {
    // One-time extraction of pivot settings that we'll use throughout the render.

    const { props } = this;
    const colAttrs = props.cols;
    const rowAttrs = props.rows;

    const tableOptions = {
      rowTotals: true,
      colTotals: true,
      ...props.tableOptions,
    };
    const compactRowTree =
      Boolean(tableOptions.compactRowTree) && Boolean(tableOptions.rowSubTotals);
    const rowHeaderColSpan = compactRowTree ? 1 : rowAttrs.length;
    const rowTotals = tableOptions.rowTotals || colAttrs.length === 0;
    const colTotals = tableOptions.colTotals || rowAttrs.length === 0;

    const namesMapping = props.namesMapping || {};
    const subtotalOptions = {
      arrowCollapsed: '\u25B2',
      arrowExpanded: '\u25BC',
      ...props.subtotalOptions,
    };

    const colSubtotalDisplay = {
      displayOnTop: false,
      enabled: tableOptions.colSubTotals,
      hideOnExpand: false,
      ...subtotalOptions.colSubtotalDisplay,
    };

    const rowSubtotalDisplay = {
      displayOnTop: false,
      enabled: tableOptions.rowSubTotals,
      hideOnExpand: false,
      ...subtotalOptions.rowSubtotalDisplay,
    };

    const pivotData = new PivotData(props, {
      rowEnabled: rowSubtotalDisplay.enabled,
      colEnabled: colSubtotalDisplay.enabled,
      rowPartialOnTop: rowSubtotalDisplay.displayOnTop,
      colPartialOnTop: colSubtotalDisplay.displayOnTop,
    });
    const rowKeys = pivotData.getRowKeys();
    const colKeys = pivotData.getColKeys();

    // Also pre-calculate all the callbacks for cells, etc... This is nice to have to
    // avoid re-calculations of the call-backs on cell expansions, etc...
    const cellCallbacks = {};
    const rowTotalCallbacks = {};
    const colTotalCallbacks = {};
    let grandTotalCallback = null;
    if (tableOptions.clickCallback) {
      rowKeys.forEach(rowKey => {
        const flatRowKey = flatKey(rowKey);
        if (!(flatRowKey in cellCallbacks)) {
          cellCallbacks[flatRowKey] = {};
        }
        colKeys.forEach(colKey => {
          cellCallbacks[flatRowKey][flatKey(colKey)] = this.clickHandler(
            pivotData,
            rowKey,
            colKey,
          );
        });
      });

      // Add in totals as well.
      if (rowTotals) {
        rowKeys.forEach(rowKey => {
          rowTotalCallbacks[flatKey(rowKey)] = this.clickHandler(
            pivotData,
            rowKey,
            [],
          );
        });
      }
      if (colTotals) {
        colKeys.forEach(colKey => {
          colTotalCallbacks[flatKey(colKey)] = this.clickHandler(
            pivotData,
            [],
            colKey,
          );
        });
      }
      if (rowTotals && colTotals) {
        grandTotalCallback = this.clickHandler(pivotData, [], []);
      }
    }

    return {
      pivotData,
      colAttrs,
      rowAttrs,
      colKeys,
      rowKeys,
      rowTotals,
      colTotals,
      compactRowTree,
      rowHeaderColSpan,
      arrowCollapsed: subtotalOptions.arrowCollapsed,
      arrowExpanded: subtotalOptions.arrowExpanded,
      colSubtotalDisplay,
      rowSubtotalDisplay,
      cellCallbacks,
      rowTotalCallbacks,
      colTotalCallbacks,
      grandTotalCallback,
      namesMapping,
      allowRenderHtml: props.allowRenderHtml,
    };
  }

  clickHandler(pivotData, rowValues, colValues) {
    const colAttrs = this.props.cols;
    const rowAttrs = this.props.rows;
    const value = pivotData.getAggregator(rowValues, colValues).value();
    const filters = {};
    const colLimit = Math.min(colAttrs.length, colValues.length);
    for (let i = 0; i < colLimit; i += 1) {
      const attr = colAttrs[i];
      if (colValues[i] !== null) {
        filters[attr] = colValues[i];
      }
    }
    const rowLimit = Math.min(rowAttrs.length, rowValues.length);
    for (let i = 0; i < rowLimit; i += 1) {
      const attr = rowAttrs[i];
      if (rowValues[i] !== null) {
        filters[attr] = rowValues[i];
      }
    }
    return e =>
      this.props.tableOptions.clickCallback(e, value, filters, pivotData);
  }

  clickHeaderHandler(
    pivotData,
    values,
    attrs,
    attrIdx,
    callback,
    isSubtotal = false,
    isGrandTotal = false,
  ) {
    const filters = {};
    for (let i = 0; i <= attrIdx; i += 1) {
      const attr = attrs[i];
      filters[attr] = values[i];
    }
    return e =>
      callback(
        e,
        values[attrIdx],
        filters,
        pivotData,
        isSubtotal,
        isGrandTotal,
      );
  }

  collapseAttr(rowOrCol, attrIdx, allKeys) {
    return e => {
      // Collapse an entire attribute.
      e.stopPropagation();
      const keyLen = attrIdx + 1;
      const collapsed = allKeys.filter(k => k.length === keyLen).map(flatKey);

      const updates = {};
      collapsed.forEach(k => {
        updates[k] = true;
      });

      if (rowOrCol) {
        this.setState(state => ({
          collapsedRows: { ...state.collapsedRows, ...updates },
        }));
      } else {
        this.setState(state => ({
          collapsedCols: { ...state.collapsedCols, ...updates },
        }));
      }
    };
  }

  expandAttr(rowOrCol, attrIdx, allKeys) {
    return e => {
      // Expand an entire attribute. This implicitly implies expanding all of the
      // parents as well. It's a bit inefficient but ah well...
      e.stopPropagation();
      const updates = {};
      allKeys.forEach(k => {
        for (let i = 0; i <= attrIdx; i += 1) {
          updates[flatKey(k.slice(0, i + 1))] = false;
        }
      });

      if (rowOrCol) {
        this.setState(state => ({
          collapsedRows: { ...state.collapsedRows, ...updates },
        }));
      } else {
        this.setState(state => ({
          collapsedCols: { ...state.collapsedCols, ...updates },
        }));
      }
    };
  }

  getCollapseUpdates(allKeys, attrCount, collapsed) {
    const updates = {};
    allKeys.forEach(key => {
      const maxLevel = Math.min(key.length, attrCount - 1);
      for (let i = 0; i < maxLevel; i += 1) {
        updates[flatKey(key.slice(0, i + 1))] = collapsed;
      }
    });
    return updates;
  }

  collapseAll(e) {
    e.stopPropagation();
    const {
      rowKeys,
      colKeys,
      rowAttrs,
      colAttrs,
      rowSubtotalDisplay,
      colSubtotalDisplay,
    } = this.cachedBasePivotSettings;
    this.setState(state => ({
      collapsedRows: rowSubtotalDisplay.enabled
        ? {
            ...state.collapsedRows,
            ...this.getCollapseUpdates(rowKeys, rowAttrs.length, true),
          }
        : state.collapsedRows,
      collapsedCols: colSubtotalDisplay.enabled
        ? {
            ...state.collapsedCols,
            ...this.getCollapseUpdates(colKeys, colAttrs.length, true),
          }
        : state.collapsedCols,
    }));
  }

  expandAll(e) {
    e.stopPropagation();
    const {
      rowKeys,
      colKeys,
      rowAttrs,
      colAttrs,
      rowSubtotalDisplay,
      colSubtotalDisplay,
    } = this.cachedBasePivotSettings;
    this.setState(state => ({
      collapsedRows: rowSubtotalDisplay.enabled
        ? {
            ...state.collapsedRows,
            ...this.getCollapseUpdates(rowKeys, rowAttrs.length, false),
          }
        : state.collapsedRows,
      collapsedCols: colSubtotalDisplay.enabled
        ? {
            ...state.collapsedCols,
            ...this.getCollapseUpdates(colKeys, colAttrs.length, false),
          }
        : state.collapsedCols,
    }));
  }

  toggleRowKey(flatRowKey, defaultCollapsed = false) {
    return e => {
      e.stopPropagation();
      this.setState(state => ({
        collapsedRows: {
          ...state.collapsedRows,
          [flatRowKey]: !(state.collapsedRows[flatRowKey] ?? defaultCollapsed),
        },
      }));
    };
  }

  toggleColKey(flatColKey) {
    return e => {
      e.stopPropagation();
      this.setState(state => ({
        collapsedCols: {
          ...state.collapsedCols,
          [flatColKey]: !state.collapsedCols[flatColKey],
        },
      }));
    };
  }

  calcAttrSpans(attrArr, numAttrs) {
    // Given an array of attribute values (i.e. each element is another array with
    // the value at every level), compute the spans for every attribute value at
    // every level. The return value is a nested array of the same shape. It has
    // -1's for repeated values and the span number otherwise.

    const spans = [];
    // Index of the last new value
    const li = Array(numAttrs).map(() => 0);
    let lv = Array(numAttrs).map(() => null);
    for (let i = 0; i < attrArr.length; i += 1) {
      // Keep increasing span values as long as the last keys are the same. For
      // the rest, record spans of 1. Update the indices too.
      const cv = attrArr[i];
      const ent = [];
      let depth = 0;
      const limit = Math.min(lv.length, cv.length);
      while (depth < limit && lv[depth] === cv[depth]) {
        ent.push(-1);
        spans[li[depth]][depth] += 1;
        depth += 1;
      }
      while (depth < cv.length) {
        li[depth] = i;
        ent.push(1);
        depth += 1;
      }
      spans.push(ent);
      lv = cv;
    }
    return spans;
  }

  getAggregatedData(pivotData, visibleColName, rowPartialOnTop) {
    const groups = {};
    const rows = pivotData.rowKeys;
    const rowAttrs = this.props.rows;
    const colAttrs = this.props.cols;
    rows.forEach(rowKey => {
      const formulaValue = this.getFormulaValue(
        pivotData,
        rowKey,
        visibleColName,
        rowAttrs,
        colAttrs,
      );
      const rawValue = formulaValue.isFormula
        ? formulaValue.value
        : pivotData.getAggregator(rowKey, visibleColName).value();
      const numericValue = Number(rawValue);
      const aggValue = Number.isFinite(numericValue) ? numericValue : 0;

      if (rowPartialOnTop) {
        const parent = rowKey
          .slice(0, -1)
          .reduce((acc, key) => (acc[key] ??= {}), groups);
        parent[rowKey.at(-1)] = { currentVal: aggValue };
      } else {
        rowKey.reduce((acc, key) => {
          acc[key] = acc[key] || { currentVal: 0 };
          acc[key].currentVal = aggValue;
          return acc[key];
        }, groups);
      }
    });
    return groups;
  }

  sortAndCacheData(
    groups,
    sortOrder,
    rowEnabled,
    rowPartialOnTop,
    maxRowIndex,
  ) {
    const sortedGroups = sortHierarchicalObject(
      groups,
      sortOrder,
      rowPartialOnTop,
    );
    return convertToArray(
      sortedGroups,
      rowEnabled,
      rowPartialOnTop,
      maxRowIndex,
    );
  }

  sortData(columnIndex, visibleColKeys, pivotData, maxRowIndex) {
    this.setState(state => {
      const { sortingOrder, activeSortColumn } = state;
      const newSortingOrder = [];
      let newDirection = 'asc';

      if (activeSortColumn === columnIndex) {
        newDirection = sortingOrder[columnIndex] === 'asc' ? 'desc' : 'asc';
      }

      const { rowEnabled, rowPartialOnTop } = pivotData.subtotals;
      newSortingOrder[columnIndex] = newDirection;

      const cacheKey = `${columnIndex}-${visibleColKeys.length}-${rowEnabled}-${rowPartialOnTop}-${newDirection}`;
      let newRowKeys;
      if (this.sortCache.has(cacheKey)) {
        newRowKeys = this.sortCache.get(cacheKey);
      } else {
        const groups = this.getAggregatedData(
          pivotData,
          visibleColKeys[columnIndex],
          rowPartialOnTop,
        );
        newRowKeys = this.sortAndCacheData(
          groups,
          newDirection,
          rowEnabled,
          rowPartialOnTop,
          maxRowIndex,
        );
        this.sortCache.set(cacheKey, newRowKeys);
      }

      this.cachedBasePivotSettings = {
        ...this.cachedBasePivotSettings,
        rowKeys: newRowKeys,
      };

      return {
        sortingOrder: newSortingOrder,
        activeSortColumn: columnIndex,
      };
    });
  }

  renderColHeaderRow(attrName, attrIdx, pivotSettings) {
    // Render a single row in the column header at the top of the pivot table.

    const {
      rowAttrs,
      colAttrs,
      colKeys,
      visibleColKeys,
      colAttrSpans,
      rowTotals,
      arrowExpanded,
      arrowCollapsed,
      colSubtotalDisplay,
      maxColVisible,
      pivotData,
      namesMapping,
      allowRenderHtml,
      rowHeaderColSpan,
    } = pivotSettings;
    const {
      highlightHeaderCellsOnHover,
      omittedHighlightHeaderGroups = [],
      highlightedHeaderCells,
      cellColorFormatters,
      dateFormatters,
    } = this.props.tableOptions;

    const spaceCell =
      attrIdx === 0 && rowAttrs.length !== 0 ? (
        <th
          key="padding"
          className="pvtStickyCorner"
          colSpan={rowHeaderColSpan}
          rowSpan={colAttrs.length}
          aria-hidden="true"
        />
      ) : null;

    const needToggle =
      colSubtotalDisplay.enabled && attrIdx !== colAttrs.length - 1;
    let arrowClickHandle = null;
    let subArrow = null;
    if (needToggle) {
      arrowClickHandle =
        attrIdx + 1 < maxColVisible
          ? this.collapseAttr(false, attrIdx, colKeys)
          : this.expandAttr(false, attrIdx, colKeys);
      subArrow = attrIdx + 1 < maxColVisible ? arrowExpanded : arrowCollapsed;
    }
    const attrNameCell = (
      <th key="label" className="pvtAxisLabel pvtStickyColAxisLabel">
        {displayHeaderCell(
          needToggle,
          subArrow,
          arrowClickHandle,
          attrName,
          namesMapping,
          allowRenderHtml,
        )}
      </th>
    );

    const attrValueCells = [];
    const rowIncrSpan = rowAttrs.length !== 0 ? 1 : 0;
    // Iterate through columns. Jump over duplicate values.
    let i = 0;
    while (i < visibleColKeys.length) {
      let handleContextMenu;
      const colKey = visibleColKeys[i];
      const colSpan = attrIdx < colKey.length ? colAttrSpans[i][attrIdx] : 1;
      let colLabelClass = 'pvtColLabel';
      if (attrIdx < colKey.length) {
        if (!omittedHighlightHeaderGroups.includes(colAttrs[attrIdx])) {
          if (highlightHeaderCellsOnHover) {
            colLabelClass += ' hoverable';
          }
          handleContextMenu = e =>
            this.props.onContextMenu(e, colKey, undefined, {
              [attrName]: colKey[attrIdx],
            });
        }
        if (
          highlightedHeaderCells &&
          Array.isArray(highlightedHeaderCells[colAttrs[attrIdx]]) &&
          highlightedHeaderCells[colAttrs[attrIdx]].includes(colKey[attrIdx])
        ) {
          colLabelClass += ' active';
        }

        const { maxRowVisible: maxRowIndex, maxColVisible } = pivotSettings;
        const visibleSortIcon = maxColVisible - 1 === attrIdx;
        const columnName = colKey[maxColVisible - 1];

        const rowSpan = 1 + (attrIdx === colAttrs.length - 1 ? rowIncrSpan : 0);
        const flatColKey = flatKey(colKey.slice(0, attrIdx + 1));
        const onArrowClick = needToggle ? this.toggleColKey(flatColKey) : null;
        const getSortIcon = key => {
          const { activeSortColumn, sortingOrder } = this.state;

          if (activeSortColumn !== key) {
            return (
              <FaSort
                onClick={() =>
                  this.sortData(key, visibleColKeys, pivotData, maxRowIndex)
                }
              />
            );
          }

          const SortIcon = sortingOrder[key] === 'asc' ? FaSortAsc : FaSortDesc;
          return (
            <SortIcon
              onClick={() =>
                this.sortData(key, visibleColKeys, pivotData, maxRowIndex)
              }
            />
          );
        };

        const headerCellFormattedValue =
          dateFormatters &&
          dateFormatters[attrName] &&
          typeof dateFormatters[attrName] === 'function'
            ? dateFormatters[attrName](colKey[attrIdx])
            : colKey[attrIdx];
        let headerCellValue = headerCellFormattedValue;
        const headerConfig = this.props.columnConfig?.[attrName];
        if (
          headerConfig?.enableHtmlTemplate &&
          typeof headerConfig.htmlTemplate === 'string' &&
          headerConfig.htmlTemplate.trim()
        ) {
          const headerContext = this.buildTemplateContext(
            pivotData,
            [],
            colKey,
            rowAttrs,
            colAttrs,
            false,
          );
          headerCellValue = this.formatValueWithTemplate({
            columnKey: attrName,
            rawValue: colKey[attrIdx],
            formattedValue:
              headerCellFormattedValue === null ||
              headerCellFormattedValue === undefined
                ? ''
                : String(headerCellFormattedValue),
            rowContext: headerContext,
            allowRenderHtml,
          });
        }
        const { backgroundColor } = getCellColor(
          [attrName],
          headerCellFormattedValue,
          cellColorFormatters,
        );
        attrValueCells.push(
          <th
            className={colLabelClass}
            key={`colKey-${flatColKey}`}
            colSpan={colSpan}
            rowSpan={rowSpan}
            role="columnheader button"
            style={{ backgroundColor }}
            onClick={this.clickHeaderHandler(
              pivotData,
              colKey,
              this.props.cols,
              attrIdx,
              this.props.tableOptions.clickColumnHeaderCallback,
            )}
            onContextMenu={handleContextMenu}
          >
            {displayHeaderCell(
              needToggle,
              this.state.collapsedCols[flatColKey]
                ? arrowCollapsed
                : arrowExpanded,
              onArrowClick,
              headerCellValue,
              namesMapping,
              allowRenderHtml,
            )}
            <span
              role="columnheader"
              tabIndex={0}
              onClick={e => {
                e.stopPropagation();
              }}
              aria-label={
                this.state.activeSortColumn === i
                  ? `Sorted by ${columnName} ${
                      this.state.sortingOrder[i] === 'asc'
                        ? 'ascending'
                        : 'descending'
                    }`
                  : undefined
              }
            >
              {visibleSortIcon && getSortIcon(i)}
            </span>
          </th>,
        );
      } else if (attrIdx === colKey.length) {
        const rowSpan = colAttrs.length - colKey.length + rowIncrSpan;
        attrValueCells.push(
          <th
            className={`${colLabelClass} pvtSubtotalLabel`}
            key={`colKeyBuffer-${flatKey(colKey)}`}
            colSpan={colSpan}
            rowSpan={rowSpan}
            role="columnheader button"
            onClick={this.clickHeaderHandler(
              pivotData,
              colKey,
              this.props.cols,
              attrIdx,
              this.props.tableOptions.clickColumnHeaderCallback,
              true,
            )}
          >
            {t('Subtotal')}
          </th>,
        );
      }
      // The next colSpan columns will have the same value anyway...
      i += colSpan;
    }

    const totalCell =
      attrIdx === 0 && rowTotals ? (
        <th
          key="total"
          className="pvtTotalLabel"
          rowSpan={colAttrs.length + Math.min(rowAttrs.length, 1)}
          role="columnheader button"
          onClick={this.clickHeaderHandler(
            pivotData,
            [],
            this.props.cols,
            attrIdx,
            this.props.tableOptions.clickColumnHeaderCallback,
            false,
            true,
          )}
        >
          {t('Total (%(aggregatorName)s)', {
            aggregatorName: t(this.props.aggregatorName),
          })}
        </th>
      ) : null;

    const cells = [spaceCell, attrNameCell, ...attrValueCells, totalCell];
    return <tr key={`colAttr-${attrIdx}`}>{cells}</tr>;
  }

  renderRowHeaderRow(pivotSettings) {
    // Render just the attribute names of the rows (the actual attribute values
    // will show up in the individual rows).

    const {
      rowAttrs,
      colAttrs,
      rowKeys,
      arrowCollapsed,
      arrowExpanded,
      rowSubtotalDisplay,
      maxRowVisible,
      pivotData,
      namesMapping,
      allowRenderHtml,
      compactRowTree,
      rowHeaderColSpan,
    } = pivotSettings;
    if (compactRowTree) {
      const label = rowAttrs.map(rowAttr => namesMapping[rowAttr] || rowAttr).join(' / ');
      const compactHeaderColSpan =
        rowHeaderColSpan + Math.min(colAttrs.length, 1);
      const totalHeaderCell =
        colAttrs.length === 0 ? (
          <th
            className="pvtTotalLabel"
            key="padding"
            role="columnheader button"
            onClick={this.clickHeaderHandler(
              pivotData,
              [],
              this.props.rows,
              0,
              this.props.tableOptions.clickRowHeaderCallback,
              false,
              true,
            )}
          >
            {t('Total (%(aggregatorName)s)', {
              aggregatorName: t(this.props.aggregatorName),
            })}
          </th>
        ) : null;
      return (
        <tr key="rowHdr">
          <th
            className="pvtAxisLabel pvtStickyRowAxisLabel"
            key="rowAttr-compact"
            colSpan={compactHeaderColSpan}
          >
            {displayHeaderCell(
              false,
              null,
              null,
              label,
              namesMapping,
              allowRenderHtml,
            )}
          </th>
          {totalHeaderCell}
        </tr>
      );
    }
    return (
      <tr key="rowHdr">
        {rowAttrs.map((r, i) => {
          const needLabelToggle =
            rowSubtotalDisplay.enabled && i !== rowAttrs.length - 1;
          let arrowClickHandle = null;
          let subArrow = null;
          if (needLabelToggle) {
            arrowClickHandle =
              i + 1 < maxRowVisible
                ? this.collapseAttr(true, i, rowKeys)
                : this.expandAttr(true, i, rowKeys);
            subArrow = i + 1 < maxRowVisible ? arrowExpanded : arrowCollapsed;
          }
          return (
            <th className="pvtAxisLabel" key={`rowAttr-${i}`}>
              {displayHeaderCell(
                needLabelToggle,
                subArrow,
                arrowClickHandle,
                r,
                namesMapping,
                allowRenderHtml,
              )}
            </th>
          );
        })}
        <th
          className="pvtTotalLabel"
          key="padding"
          role="columnheader button"
          onClick={this.clickHeaderHandler(
            pivotData,
            [],
            this.props.rows,
            0,
            this.props.tableOptions.clickRowHeaderCallback,
            false,
            true,
          )}
        >
          {colAttrs.length === 0
            ? t('Total (%(aggregatorName)s)', {
                aggregatorName: t(this.props.aggregatorName),
              })
            : null}
        </th>
      </tr>
    );
  }

  renderTableRow(rowKey, rowIdx, pivotSettings) {
    // Render a single row in the pivot table.

    const {
      rowAttrs,
      colAttrs,
      rowAttrSpans,
      visibleColKeys,
      pivotData,
      rowTotals,
      rowSubtotalDisplay,
      arrowExpanded,
      arrowCollapsed,
      cellCallbacks,
      rowTotalCallbacks,
      namesMapping,
      allowRenderHtml,
      compactRowTree,
      rowHeaderColSpan,
      collapsedRows,
    } = pivotSettings;

    const {
      highlightHeaderCellsOnHover,
      omittedHighlightHeaderGroups = [],
      highlightedHeaderCells,
      cellColorFormatters,
      dateFormatters,
    } = this.props.tableOptions;
    const flatRowKey = flatKey(rowKey);

    const colIncrSpan = colAttrs.length !== 0 ? 1 : 0;
    const rowHeaderContext = this.buildTemplateContext(
      pivotData,
      rowKey,
      [],
      rowAttrs,
      colAttrs,
      false,
    );
    const isCompactSubtotal = compactRowTree && rowKey.length < rowAttrs.length;
    let attrValueCells;
    let attrValuePaddingCell = null;
    if (compactRowTree) {
      const compactRowColSpan = rowHeaderColSpan + colIncrSpan;
      const i = Math.max(0, rowKey.length - 1);
      const r = rowKey[i];
      const flatRowKeyForToggle = flatKey(rowKey);
      const needRowToggle = rowSubtotalDisplay.enabled && isCompactSubtotal;
      const onArrowClick = needRowToggle
        ? this.toggleRowKey(
            flatRowKeyForToggle,
            Boolean(collapsedRows[flatRowKeyForToggle]),
          )
        : null;
      const headerCellFormattedValue =
        dateFormatters && dateFormatters[rowAttrs[i]]
          ? dateFormatters[rowAttrs[i]](r)
          : r;
      const { backgroundColor } = getCellColor(
        [rowAttrs[i]],
        headerCellFormattedValue,
        cellColorFormatters,
      );
      let headerCellValue = headerCellFormattedValue;
      const rowHeaderConfig = this.props.columnConfig?.[rowAttrs[i]];
      if (
        rowHeaderConfig?.enableHtmlTemplate &&
        typeof rowHeaderConfig.htmlTemplate === 'string' &&
        rowHeaderConfig.htmlTemplate.trim()
      ) {
        headerCellValue = this.formatValueWithTemplate({
          columnKey: rowAttrs[i],
          rawValue: r,
          formattedValue:
            headerCellFormattedValue === null ||
            headerCellFormattedValue === undefined
              ? ''
              : String(headerCellFormattedValue),
          rowContext: rowHeaderContext,
          allowRenderHtml,
        });
      }
      let valueCellClassName = isCompactSubtotal
        ? 'pvtRowLabel pvtSubtotalLabel'
        : 'pvtRowLabel';
      valueCellClassName += ' pvtStickyRowLabel';
      if (!omittedHighlightHeaderGroups.includes(rowAttrs[i])) {
        if (highlightHeaderCellsOnHover) {
          valueCellClassName += ' hoverable';
        }
      }
      if (
        highlightedHeaderCells &&
        Array.isArray(highlightedHeaderCells[rowAttrs[i]]) &&
        highlightedHeaderCells[rowAttrs[i]].includes(r)
      ) {
        valueCellClassName += ' active';
      }
      attrValueCells = [
        <th
          key="rowKeyLabel-compact"
          className={valueCellClassName}
          colSpan={compactRowColSpan}
          role="columnheader button"
          onClick={this.clickHeaderHandler(
            pivotData,
            rowKey,
            this.props.rows,
            isCompactSubtotal ? rowKey.length : i,
            this.props.tableOptions.clickRowHeaderCallback,
            isCompactSubtotal,
          )}
          onContextMenu={e =>
            this.props.onContextMenu(e, undefined, rowKey, {
              [rowAttrs[i]]: r,
            })
          }
          style={{
            backgroundColor,
            paddingLeft: `${8 + i * 18}px`,
          }}
        >
          {displayHeaderCell(
            needRowToggle,
            collapsedRows[flatRowKeyForToggle]
              ? arrowCollapsed
              : arrowExpanded,
            onArrowClick,
            headerCellValue,
            namesMapping,
            allowRenderHtml,
          )}
        </th>,
      ];
    } else {
      attrValueCells = rowKey.map((r, i) => {
      let handleContextMenu;
      let valueCellClassName = 'pvtRowLabel';
      if (i === 0) {
        valueCellClassName += ' pvtStickyRowLabel';
      }
      if (!omittedHighlightHeaderGroups.includes(rowAttrs[i])) {
        if (highlightHeaderCellsOnHover) {
          valueCellClassName += ' hoverable';
        }
        handleContextMenu = e =>
          this.props.onContextMenu(e, undefined, rowKey, {
            [rowAttrs[i]]: r,
          });
      }
      if (
        highlightedHeaderCells &&
        Array.isArray(highlightedHeaderCells[rowAttrs[i]]) &&
        highlightedHeaderCells[rowAttrs[i]].includes(r)
      ) {
        valueCellClassName += ' active';
      }
      const rowSpan = rowAttrSpans[rowIdx][i];
      if (rowSpan > 0) {
        const flatRowKey = flatKey(rowKey.slice(0, i + 1));
        const colSpan = 1 + (i === rowAttrs.length - 1 ? colIncrSpan : 0);
        const needRowToggle =
          rowSubtotalDisplay.enabled && i !== rowAttrs.length - 1;
        const onArrowClick = needRowToggle
          ? this.toggleRowKey(flatRowKey, Boolean(collapsedRows[flatRowKey]))
          : null;

        const headerCellFormattedValue =
          dateFormatters && dateFormatters[rowAttrs[i]]
            ? dateFormatters[rowAttrs[i]](r)
            : r;
        const { backgroundColor } = getCellColor(
          [rowAttrs[i]],
          headerCellFormattedValue,
          cellColorFormatters,
        );
        let headerCellValue = headerCellFormattedValue;
        const rowHeaderConfig = this.props.columnConfig?.[rowAttrs[i]];
        if (
          rowHeaderConfig?.enableHtmlTemplate &&
          typeof rowHeaderConfig.htmlTemplate === 'string' &&
          rowHeaderConfig.htmlTemplate.trim()
        ) {
          headerCellValue = this.formatValueWithTemplate({
            columnKey: rowAttrs[i],
            rawValue: r,
            formattedValue:
              headerCellFormattedValue === null ||
              headerCellFormattedValue === undefined
                ? ''
                : String(headerCellFormattedValue),
            rowContext: rowHeaderContext,
            allowRenderHtml,
          });
        }
        return (
          <th
            key={`rowKeyLabel-${i}`}
            className={valueCellClassName}
            rowSpan={rowSpan}
            colSpan={colSpan}
            role="columnheader button"
            style={{ backgroundColor }}
            onClick={this.clickHeaderHandler(
              pivotData,
              rowKey,
              this.props.rows,
              i,
              this.props.tableOptions.clickRowHeaderCallback,
            )}
            onContextMenu={handleContextMenu}
          >
            {displayHeaderCell(
              needRowToggle,
              collapsedRows[flatRowKey]
                ? arrowCollapsed
                : arrowExpanded,
              onArrowClick,
              headerCellValue,
              namesMapping,
              allowRenderHtml,
            )}
          </th>
        );
      }
      return null;
      });

      attrValuePaddingCell = rowKey.length < rowAttrs.length ? (
        <th
          className="pvtRowLabel pvtSubtotalLabel"
          key="rowKeyBuffer"
          colSpan={rowAttrs.length - rowKey.length + colIncrSpan}
          rowSpan={1}
          role="columnheader button"
          onClick={this.clickHeaderHandler(
            pivotData,
            rowKey,
            this.props.rows,
            rowKey.length,
            this.props.tableOptions.clickRowHeaderCallback,
            true,
          )}
        >
          {t('Subtotal')}
        </th>
      ) : null;
    }

    const rowClickHandlers = cellCallbacks[flatRowKey] || {};
    const valueCells = visibleColKeys.map(colKey => {
      const flatColKey = flatKey(colKey);
      const agg = pivotData.getAggregator(rowKey, colKey);
      const aggValue = agg.value();
      const formulaValue = this.getFormulaValue(
        pivotData,
        rowKey,
        colKey,
        rowAttrs,
        colAttrs,
      );
      const displayValue = formulaValue.isFormula ? formulaValue.value : aggValue;
      const formattedValue = formulaValue.isFormula
        ? displayValue === null
          ? ''
          : agg.format(displayValue)
        : agg.format(aggValue);
      let renderedValue = formattedValue;
      const metricInfo = this.getMetricInfo(
        rowKey,
        colKey,
        rowAttrs,
        colAttrs,
        this.props.metricKey,
      );
      if (metricInfo?.value) {
        const cellConfig = this.props.columnConfig?.[metricInfo.value];
        if (
          cellConfig?.enableHtmlTemplate &&
          typeof cellConfig.htmlTemplate === 'string' &&
          cellConfig.htmlTemplate.trim()
        ) {
          const cellContext = this.buildTemplateContext(
            pivotData,
            rowKey,
            colKey,
            rowAttrs,
            colAttrs,
            true,
          );
          renderedValue = this.formatValueWithTemplate({
            columnKey: metricInfo.value,
            rawValue: displayValue,
            formattedValue: formattedValue ?? '',
            rowContext: cellContext,
            allowRenderHtml,
            formatter: agg.format,
          });
        }
      }

      const keys = [...rowKey, ...colKey];
      const { backgroundColor } = getCellColor(
        keys,
        formulaValue.isFormula ? formulaValue.value : aggValue,
        cellColorFormatters,
      );

      const style = agg.isSubtotal
        ? { fontWeight: 'bold' }
        : { backgroundColor };
      const valueCellClassName = agg.isSubtotal ? 'pvtVal pvtSubtotal' : 'pvtVal';
      const tooltip = this.buildCellTooltip({
        rowKey,
        colKey,
        rowAttrs,
        colAttrs,
        metricInfo,
        formulaValue,
        rawValue: displayValue,
        formattedValue,
      });

      return (
        <td
          role="gridcell"
          className={valueCellClassName}
          key={`pvtVal-${flatColKey}`}
          onClick={rowClickHandlers[flatColKey]}
          onContextMenu={e => this.props.onContextMenu(e, colKey, rowKey)}
          style={style}
          title={tooltip}
        >
          {displayCell(renderedValue, allowRenderHtml)}
        </td>
      );
    });

    let totalCell = null;
    if (rowTotals) {
      const agg = pivotData.getAggregator(rowKey, []);
      const aggValue = agg.value();
      const formulaValue = this.getFormulaValue(
        pivotData,
        rowKey,
        [],
        rowAttrs,
        colAttrs,
      );
      const displayValue = formulaValue.isFormula ? formulaValue.value : aggValue;
      const formattedValue = formulaValue.isFormula
        ? displayValue === null
          ? ''
          : agg.format(displayValue)
        : agg.format(aggValue);
      let renderedTotalValue = formattedValue;
      const metricInfo = this.getMetricInfo(
        rowKey,
        [],
        rowAttrs,
        colAttrs,
        this.props.metricKey,
      );
      if (metricInfo?.value) {
        const totalConfig = this.props.columnConfig?.[metricInfo.value];
        if (
          totalConfig?.enableHtmlTemplate &&
          typeof totalConfig.htmlTemplate === 'string' &&
          totalConfig.htmlTemplate.trim()
        ) {
          const totalContext = this.buildTemplateContext(
            pivotData,
            rowKey,
            [],
            rowAttrs,
            colAttrs,
            true,
          );
          renderedTotalValue = this.formatValueWithTemplate({
            columnKey: metricInfo.value,
            rawValue: displayValue,
            formattedValue: formattedValue ?? '',
            rowContext: totalContext,
            allowRenderHtml,
            formatter: agg.format,
          });
        }
      }
      const tooltip = this.buildCellTooltip({
        rowKey,
        colKey: [],
        rowAttrs,
        colAttrs,
        metricInfo,
        formulaValue,
        rawValue: displayValue,
        formattedValue,
        label: t('Total'),
      });
      totalCell = (
        <td
          role="gridcell"
          key="total"
          className="pvtTotal"
          onClick={rowTotalCallbacks[flatRowKey]}
          onContextMenu={e => this.props.onContextMenu(e, undefined, rowKey)}
          title={tooltip}
        >
          {displayCell(renderedTotalValue, allowRenderHtml)}
        </td>
      );
    }

    const rowCells = [
      ...attrValueCells,
      attrValuePaddingCell,
      ...valueCells,
      totalCell,
    ];

    return <tr key={`keyRow-${flatRowKey}`}>{rowCells}</tr>;
  }

  renderTotalsRow(pivotSettings) {
    // Render the final totals rows that has the totals for all the columns.

    const {
      rowAttrs,
      colAttrs,
      visibleColKeys,
      rowTotals,
      pivotData,
      colTotalCallbacks,
      grandTotalCallback,
      rowHeaderColSpan,
    } = pivotSettings;

    const totalLabelCell = (
      <th
        key="label"
        className="pvtTotalLabel pvtRowTotalLabel"
        colSpan={rowHeaderColSpan + Math.min(colAttrs.length, 1)}
        role="columnheader button"
        onClick={this.clickHeaderHandler(
          pivotData,
          [],
          this.props.rows,
          0,
          this.props.tableOptions.clickRowHeaderCallback,
          false,
          true,
        )}
      >
        {t('Total (%(aggregatorName)s)', {
          aggregatorName: t(this.props.aggregatorName),
        })}
      </th>
    );

    const totalValueCells = visibleColKeys.map(colKey => {
      const flatColKey = flatKey(colKey);
      const agg = pivotData.getAggregator([], colKey);
      const aggValue = agg.value();
      const formulaValue = this.getFormulaValue(
        pivotData,
        [],
        colKey,
        rowAttrs,
        colAttrs,
      );
      const displayValue = formulaValue.isFormula ? formulaValue.value : aggValue;
      const formattedValue = formulaValue.isFormula
        ? displayValue === null
          ? ''
          : agg.format(displayValue)
        : agg.format(aggValue);
      let renderedTotalValue = formattedValue;
      const metricInfo = this.getMetricInfo(
        [],
        colKey,
        rowAttrs,
        colAttrs,
        this.props.metricKey,
      );
      if (metricInfo?.value) {
        const totalConfig = this.props.columnConfig?.[metricInfo.value];
        if (
          totalConfig?.enableHtmlTemplate &&
          typeof totalConfig.htmlTemplate === 'string' &&
          totalConfig.htmlTemplate.trim()
        ) {
          const totalContext = this.buildTemplateContext(
            pivotData,
            [],
            colKey,
            rowAttrs,
            colAttrs,
            true,
          );
          renderedTotalValue = this.formatValueWithTemplate({
            columnKey: metricInfo.value,
            rawValue: displayValue,
            formattedValue: formattedValue ?? '',
            rowContext: totalContext,
            allowRenderHtml: this.props.allowRenderHtml,
            formatter: agg.format,
          });
        }
      }
      const tooltip = this.buildCellTooltip({
        rowKey: [],
        colKey,
        rowAttrs,
        colAttrs,
        metricInfo,
        formulaValue,
        rawValue: displayValue,
        formattedValue,
        label: t('Total'),
      });

      return (
        <td
          role="gridcell"
          className="pvtTotal pvtRowTotal"
          key={`total-${flatColKey}`}
          onClick={colTotalCallbacks[flatColKey]}
          onContextMenu={e => this.props.onContextMenu(e, colKey, undefined)}
          style={{ padding: '5px' }}
          title={tooltip}
        >
          {displayCell(renderedTotalValue, this.props.allowRenderHtml)}
        </td>
      );
    });

    let grandTotalCell = null;
    if (rowTotals) {
      const agg = pivotData.getAggregator([], []);
      const aggValue = agg.value();
      const formattedValue = agg.format(aggValue);
      const tooltip = this.buildCellTooltip({
        rowKey: [],
        colKey: [],
        rowAttrs,
        colAttrs,
        metricInfo: null,
        formulaValue: { isFormula: false },
        rawValue: aggValue,
        formattedValue,
        label: t('Grand Total'),
      });
      grandTotalCell = (
        <td
          role="gridcell"
          key="total"
          className="pvtGrandTotal pvtRowTotal"
          onClick={grandTotalCallback}
          onContextMenu={e => this.props.onContextMenu(e, undefined, undefined)}
          title={tooltip}
        >
          {displayCell(formattedValue, this.props.allowRenderHtml)}
        </td>
      );
    }

    const totalCells = [totalLabelCell, ...totalValueCells, grandTotalCell];

    return (
      <tr key="total" className="pvtRowTotals">
        {totalCells}
      </tr>
    );
  }

  visibleKeys(keys, collapsed, numAttrs, subtotalDisplay) {
    return keys.filter(
      key =>
        // Is the key hidden by one of its parents?
        !key.some((k, j) => collapsed[flatKey(key.slice(0, j))]) &&
        // Leaf key.
        (key.length === numAttrs ||
          // Children hidden. Must show total.
          flatKey(key) in collapsed ||
          // Don't hide totals.
          !subtotalDisplay.hideOnExpand),
    );
  }

  getDefaultCollapsedRows(keys, numAttrs, subtotalDisplay) {
    if (
      !this.props.tableOptions.rowCollapseByDefault ||
      !subtotalDisplay.enabled
    ) {
      return {};
    }
    return keys.reduce((acc, key) => {
      if (key.length < numAttrs) {
        acc[flatKey(key)] = true;
      }
      return acc;
    }, {});
  }

  isDashboardEditMode() {
    return document.contains(document.querySelector('.dashboard--editing'));
  }

  renderExpandCollapseToolbar(pivotSettings) {
    const { rowSubtotalDisplay, colSubtotalDisplay } = pivotSettings;
    if (!rowSubtotalDisplay.enabled && !colSubtotalDisplay.enabled) {
      return null;
    }
    return (
      <div className="pvtToolbar">
        <button
          type="button"
          className="pvtToolbarButton"
          aria-label={t('Expand all')}
          onClick={this.expandAll}
          title={t('Expand all')}
        >
          +
        </button>
        <button
          type="button"
          className="pvtToolbarButton"
          aria-label={t('Collapse all')}
          onClick={this.collapseAll}
          title={t('Collapse all')}
        >
          -
        </button>
      </div>
    );
  }

  render() {
    if (this.cachedProps !== this.props) {
      this.cachedProps = this.props;
      this.sortCache.clear();
      this.cachedBasePivotSettings = this.getBasePivotSettings();
    }
    const {
      colAttrs,
      rowAttrs,
      rowKeys,
      colKeys,
      colTotals,
      rowSubtotalDisplay,
      colSubtotalDisplay,
      allowRenderHtml,
    } = this.cachedBasePivotSettings;
    const collapsedRows = {
      ...this.getDefaultCollapsedRows(
        rowKeys,
        rowAttrs.length,
        rowSubtotalDisplay,
      ),
      ...this.state.collapsedRows,
    };

    // Need to account for exclusions to compute the effective row
    // and column keys.
    let visibleRowKeys = this.visibleKeys(
      rowKeys,
      collapsedRows,
      rowAttrs.length,
      rowSubtotalDisplay,
    );
    let visibleColKeys = this.visibleKeys(
      colKeys,
      this.state.collapsedCols,
      colAttrs.length,
      colSubtotalDisplay,
    );
    visibleRowKeys = this.filterJinjaKeys(visibleRowKeys, rowAttrs);
    visibleColKeys = this.filterJinjaKeys(visibleColKeys, colAttrs);

    const pivotSettings = {
      visibleRowKeys,
      maxRowVisible: visibleRowKeys.length
        ? Math.max(...visibleRowKeys.map(k => k.length))
        : 0,
      visibleColKeys,
      maxColVisible: visibleColKeys.length
        ? Math.max(...visibleColKeys.map(k => k.length))
        : 0,
      rowAttrSpans: this.calcAttrSpans(visibleRowKeys, rowAttrs.length),
      colAttrSpans: this.calcAttrSpans(visibleColKeys, colAttrs.length),
      allowRenderHtml,
      collapsedRows,
      ...this.cachedBasePivotSettings,
    };

    const tableThemeStyle = this.getTableThemeStyle();
    return (
      <Styles
        isDashboardEditMode={this.isDashboardEditMode()}
        stickyHeaders={this.props.stickyHeaders}
        tableTheme={this.props.tableTheme}
        style={tableThemeStyle}
      >
        {this.renderExpandCollapseToolbar(pivotSettings)}
        <table className="pvtTable" role="grid">
          <thead>
            {colAttrs.map((c, j) =>
              this.renderColHeaderRow(c, j, pivotSettings),
            )}
            {rowAttrs.length !== 0 && this.renderRowHeaderRow(pivotSettings)}
          </thead>
          <tbody>
            {visibleRowKeys.map((r, i) =>
              this.renderTableRow(r, i, pivotSettings),
            )}
            {colTotals && this.renderTotalsRow(pivotSettings)}
          </tbody>
        </table>
      </Styles>
    );
  }
}

TableRenderer.propTypes = {
  ...PivotData.propTypes,
  tableOptions: PropTypes.object,
  onContextMenu: PropTypes.func,
  formulaMetrics: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      expression: PropTypes.string.isRequired,
    }),
  ),
  metricKey: PropTypes.string,
  columnConfig: PropTypes.object,
  showCellTooltip: PropTypes.bool,
  stickyHeaders: PropTypes.bool,
  tableTheme: PropTypes.object,
  jinjaFields: PropTypes.arrayOf(PropTypes.string),
};
TableRenderer.defaultProps = {
  ...PivotData.defaultProps,
  tableOptions: {},
  formulaMetrics: [],
  metricKey: t('Metric'),
  columnConfig: {},
  showCellTooltip: true,
  stickyHeaders: false,
  tableTheme: {},
  jinjaFields: [],
};
