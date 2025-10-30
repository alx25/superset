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
  CurrencyFormatter,
  DataRecord,
  DataRecordValue,
  GenericDataType,
  getNumberFormatter,
  isProbablyHTML,
  sanitizeHtml,
} from '@superset-ui/core';
import { DataColumnMeta } from '../types';
import DateWithFormatter from './DateWithFormatter';

/**
 * Format text for cell value.
 */
const TEMPLATE_VARIABLE_REGEX = /\{\{\s*([^}]+)\s*\}\}/g;
const CASE_TEMPLATE_REGEX = /^CASE\b/i;
const COMPARISON_CONDITION_REGEX =
  /\{\{\s*([^}]+)\s*\}\}\s*(>=|<=|!=|<>|==|=|>|<)\s*([\s\S]+)/;

function stripWrappingQuotes(raw: string) {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function getNestedValue(row: DataRecord, path: string) {
  return path
    .split('.')
    .reduce<any>((acc, key) => (acc == null ? undefined : acc?.[key]), row);
}

function getTemplateValue(
  row: DataRecord,
  column: DataColumnMeta,
  formattedValue: string,
  key: string,
) {
  if (!key) {
    return '';
  }
  if (key === 'value') {
    return formattedValue ?? '';
  }
  if (key === column.key) {
    const cellValue = row?.[column.key];
    return cellValue == null ? '' : String(cellValue);
  }
  const nested = getNestedValue(row, key);
  return nested == null ? undefined : String(nested);
}

function substituteTemplateVariables(
  template: string,
  row: DataRecord,
  column: DataColumnMeta,
  formattedValue: string,
) {
  return template.replace(TEMPLATE_VARIABLE_REGEX, (_, rawKey: string) => {
    const key = rawKey.trim();
    if (!key) {
      return '';
    }
    const value = getTemplateValue(row, column, formattedValue, key);
    return value === undefined ? '' : value;
  });
}

function coerceComparableValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  const lower = trimmed.toLowerCase();
  if (lower === 'true') {
    return true;
  }
  if (lower === 'false') {
    return false;
  }
  if (lower === 'null') {
    return null;
  }
  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric)) {
    return numeric;
  }
  return trimmed;
}

function evaluateWhenCondition(
  condition: string,
  row: DataRecord,
  column: DataColumnMeta,
  formattedValue: string,
) {
  const trimmed = condition.trim();
  if (!trimmed) {
    return false;
  }
  const comparisonMatch = trimmed.match(COMPARISON_CONDITION_REGEX);
  if (comparisonMatch) {
    const [, rawKey, operator, rawRight] = comparisonMatch;
    const leftValueRaw = getTemplateValue(
      row,
      column,
      formattedValue,
      rawKey.trim(),
    );
    if (leftValueRaw === undefined) {
      return false;
    }
    const rightResolved = resolveTemplateToken(
      rawRight,
      row,
      column,
      formattedValue,
    );
    const leftValue = coerceComparableValue(String(leftValueRaw));
    const rightValue = coerceComparableValue(String(rightResolved));
    switch (operator) {
      case '>':
        return (
          typeof leftValue === 'number' &&
          typeof rightValue === 'number' &&
          leftValue > rightValue
        );
      case '<':
        return (
          typeof leftValue === 'number' &&
          typeof rightValue === 'number' &&
          leftValue < rightValue
        );
      case '>=':
        return (
          typeof leftValue === 'number' &&
          typeof rightValue === 'number' &&
          leftValue >= rightValue
        );
      case '<=':
        return (
          typeof leftValue === 'number' &&
          typeof rightValue === 'number' &&
          leftValue <= rightValue
        );
      case '=':
      case '==':
        return leftValue === rightValue;
      case '!=':
      case '<>':
        return leftValue !== rightValue;
      default:
        return false;
    }
  }
  const resolved = resolveTemplateToken(trimmed, row, column, formattedValue);
  const normalized = resolved.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return resolved.length > 0;
}

function resolveTemplateToken(
  token: string,
  row: DataRecord,
  column: DataColumnMeta,
  formattedValue: string,
): string {
  const trimmed = token.trim();
  if (!trimmed) {
    return '';
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return stripWrappingQuotes(trimmed);
  }
  if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) {
    const inner = trimmed.slice(2, -2).trim();
    const resolved = getTemplateValue(row, column, formattedValue, inner);
    return resolved === undefined ? '' : resolved;
  }
  const direct = getTemplateValue(row, column, formattedValue, trimmed);
  if (direct !== undefined) {
    return direct;
  }
  return stripWrappingQuotes(trimmed);
}

function renderCaseTemplate(
  template: string,
  row: DataRecord,
  column: DataColumnMeta,
  formattedValue: string,
) {
  const trimmed = template.trim();
  if (!CASE_TEMPLATE_REGEX.test(trimmed)) {
    return null;
  }
  const body = trimmed.replace(/^CASE\b/i, '').trim();
  const endIndex = body.toUpperCase().lastIndexOf('END');
  if (endIndex === -1) {
    return null;
  }
  const withoutEnd = body.slice(0, endIndex).trim();
  const firstWhenIndex = withoutEnd.toUpperCase().indexOf('WHEN');
  if (firstWhenIndex === -1) {
    return null;
  }
  const expressionRaw = withoutEnd.slice(0, firstWhenIndex).trim();
  let remainder = withoutEnd.slice(firstWhenIndex).trim();

  let elseBlock: string | undefined;
  const elseIndex = remainder.toUpperCase().lastIndexOf('ELSE');
  if (elseIndex !== -1) {
    elseBlock = remainder.slice(elseIndex + 4).trim();
    remainder = remainder.slice(0, elseIndex).trim();
  }

  const hasExpression = Boolean(expressionRaw);
  const expressionValue = hasExpression
    ? resolveTemplateToken(expressionRaw, row, column, formattedValue)
    : '';

  const caseRegex = /WHEN\s+([\s\S]+?)\s+THEN\s+([\s\S]+?)(?=WHEN\s+|$)/gi;
  let match = caseRegex.exec(remainder);
  while (match) {
    if (hasExpression) {
      const whenValue = resolveTemplateToken(
        match[1],
        row,
        column,
        formattedValue,
      );
      if (whenValue === expressionValue) {
        return stripWrappingQuotes(match[2]);
      }
    } else if (evaluateWhenCondition(match[1], row, column, formattedValue)) {
      return stripWrappingQuotes(match[2]);
    }
    match = caseRegex.exec(remainder);
  }

  if (elseBlock) {
    return stripWrappingQuotes(elseBlock);
  }

  return '';
}

function renderHtmlTemplate(
  template: string,
  row: DataRecord,
  column: DataColumnMeta,
  formattedValue: string,
) {
  if (!template) {
    return '';
  }
  const caseResult = renderCaseTemplate(template, row, column, formattedValue);
  const templateToRender =
    caseResult !== null ? caseResult : template.trim().length ? template : '';
  return substituteTemplateVariables(
    templateToRender,
    row,
    column,
    formattedValue,
  );
}

function formatValue(
  formatter: DataColumnMeta['formatter'],
  value: DataRecordValue,
): [boolean, string] {
  // render undefined as empty string
  if (value === undefined) {
    return [false, ''];
  }
  // render null as `N/A`
  if (
    value === null ||
    // null values in temporal columns are wrapped in a Date object, so make sure we
    // handle them here too
    (value instanceof DateWithFormatter && value.input === null)
  ) {
    return [false, 'N/A'];
  }
  if (formatter) {
    return [false, formatter(value as number)];
  }
  if (typeof value === 'string') {
    return isProbablyHTML(value) ? [true, sanitizeHtml(value)] : [false, value];
  }
  return [false, value.toString()];
}

export function formatColumnValue(
  column: DataColumnMeta,
  value: DataRecordValue,
  row?: DataRecord,
): [boolean, string] {
  const { dataType, formatter, config = {} } = column;
  const isNumber = dataType === GenericDataType.Numeric;
  const smallNumberFormatter =
    config.d3SmallNumberFormat === undefined
      ? formatter
      : config.currencyFormat
        ? new CurrencyFormatter({
            d3Format: config.d3SmallNumberFormat,
            currency: config.currencyFormat,
          })
        : getNumberFormatter(config.d3SmallNumberFormat);
  const baseResult = formatValue(
    isNumber && typeof value === 'number' && Math.abs(value) < 1
      ? smallNumberFormatter
      : formatter,
    value,
  );
  if (
    config.enableHtmlTemplate &&
    typeof config.htmlTemplate === 'string' &&
    config.htmlTemplate.trim() &&
    row
  ) {
    const rendered = renderHtmlTemplate(
      config.htmlTemplate,
      row,
      column,
      baseResult[1],
    );
    return [true, sanitizeHtml(rendered)];
  }
  return baseResult;
}
