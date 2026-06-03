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
const SET_STATEMENT_REGEX =
  /\{%\s*set\s+([a-zA-Z_][\w]*)\s*=\s*([\s\S]*?)\s*%\}/gi;

type LocalVars = {
  raw: Record<string, string>;
  formatted: Record<string, string>;
};

function hashString(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function splitTopLevelCssBlocks(cssText: string) {
  const blocks: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < cssText.length; i += 1) {
    const char = cssText[i];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        blocks.push(cssText.slice(start, i + 1));
        start = i + 1;
      }
    }
  }

  return blocks.map(block => block.trim()).filter(Boolean);
}

function scopeCssBlocks(cssText: string, scopeSelector: string): string {
  const cssWithoutComments = cssText.replace(/\/\*[\s\S]*?\*\//g, ' ');

  return splitTopLevelCssBlocks(cssWithoutComments)
    .map(block => {
      const openBraceIndex = block.indexOf('{');
      const closeBraceIndex = block.lastIndexOf('}');

      if (openBraceIndex === -1 || closeBraceIndex === -1) {
        return '';
      }

      const selector = block.slice(0, openBraceIndex).trim();
      const body = block.slice(openBraceIndex + 1, closeBraceIndex).trim();

      if (!selector || !body) {
        return '';
      }

      if (/^@keyframes\b/i.test(selector)) {
        return `${selector} { ${body} }`;
      }

      if (/^@(media|supports|container|layer)\b/i.test(selector)) {
        return `${selector} { ${scopeCssBlocks(body, scopeSelector)} }`;
      }

      if (selector.startsWith('@')) {
        return `${selector} { ${body} }`;
      }

      const scopedSelectors = selector
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .map(item => `${scopeSelector} ${item}`)
        .join(', ');

      return scopedSelectors ? `${scopedSelectors} { ${body} }` : '';
    })
    .filter(Boolean)
    .join('\n');
}

export function getHtmlTemplateScopeClass(column: DataColumnMeta) {
  return `dt-html-template-scope-${hashString(
    `${column.key}::${column.config?.htmlCss ?? ''}`,
  )}`;
}

export function getScopedHtmlTemplateCss(column: DataColumnMeta) {
  const cssText = column.config?.htmlCss;
  if (
    !column.config?.enableHtmlTemplate ||
    typeof cssText !== 'string' ||
    !cssText.trim()
  ) {
    return undefined;
  }

  return scopeCssBlocks(cssText, `.${getHtmlTemplateScopeClass(column)}`);
}

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

function getLocalOrRowValue(
  key: string,
  row: DataRecord,
  column: DataColumnMeta,
  formattedValue: string,
  localVars?: LocalVars,
  useFormatted?: boolean,
) {
  if (localVars && Object.prototype.hasOwnProperty.call(localVars.raw, key)) {
    return useFormatted
      ? (localVars.formatted[key] ?? localVars.raw[key])
      : localVars.raw[key];
  }
  return getTemplateValue(row, column, formattedValue, key);
}

function substituteTemplateVariables(
  template: string,
  row: DataRecord,
  column: DataColumnMeta,
  formattedValue: string,
  localVars?: LocalVars,
) {
  return template.replace(TEMPLATE_VARIABLE_REGEX, (_, rawKey: string) => {
    const key = rawKey.trim();
    if (!key) {
      return '';
    }
    if (key === 'value') {
      return formattedValue ?? '';
    }
    if (key === 'raw_value') {
      const rawColumnValue = getTemplateValue(
        row,
        column,
        formattedValue,
        column.key,
      );
      return rawColumnValue === undefined ? '' : rawColumnValue;
    }
    if (key === column.key) {
      return formattedValue ?? '';
    }
    if (localVars && Object.prototype.hasOwnProperty.call(localVars.raw, key)) {
      return localVars.formatted[key] ?? localVars.raw[key] ?? '';
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
  localVars?: LocalVars,
) {
  const trimmed = condition.trim();
  if (!trimmed) {
    return false;
  }
  const comparisonMatch = trimmed.match(COMPARISON_CONDITION_REGEX);
  if (comparisonMatch) {
    const [, rawKey, operator, rawRight] = comparisonMatch;
    const leftKey = rawKey.trim();
    const leftValueRaw = getLocalOrRowValue(
      leftKey,
      row,
      column,
      formattedValue,
      localVars,
    );
    if (leftValueRaw === undefined) {
      return false;
    }
    const rightResolved = resolveTemplateToken(
      rawRight,
      row,
      column,
      formattedValue,
      localVars,
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
  const resolved = resolveTemplateToken(
    trimmed,
    row,
    column,
    formattedValue,
    localVars,
  );
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
  localVars?: LocalVars,
  preferFormattedColumnKey?: boolean,
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
  if (
    localVars &&
    Object.prototype.hasOwnProperty.call(localVars.raw, trimmed)
  ) {
    return preferFormattedColumnKey
      ? (localVars.formatted[trimmed] ?? localVars.raw[trimmed] ?? '')
      : (localVars.raw[trimmed] ?? '');
  }
  if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) {
    const inner = trimmed.slice(2, -2).trim();
    if (
      localVars &&
      Object.prototype.hasOwnProperty.call(localVars.raw, inner)
    ) {
      return preferFormattedColumnKey
        ? (localVars.formatted[inner] ?? localVars.raw[inner] ?? '')
        : (localVars.raw[inner] ?? '');
    }
    const resolved = getTemplateValue(row, column, formattedValue, inner);
    return resolved === undefined ? '' : resolved;
  }
  if (preferFormattedColumnKey && trimmed === column.key) {
    return formattedValue ?? '';
  }
  const direct = getTemplateValue(row, column, formattedValue, trimmed);
  if (direct !== undefined) {
    return direct;
  }
  return stripWrappingQuotes(trimmed);
}

function extractLocalVariables(
  template: string,
  row: DataRecord,
  column: DataColumnMeta,
  formattedValue: string,
): { template: string; localVars: LocalVars } {
  const localVars: LocalVars = { raw: {}, formatted: {} };
  if (!template) {
    return { template, localVars };
  }
  const cleanedTemplate = template.replace(
    SET_STATEMENT_REGEX,
    (_match, rawName: string, rawExpression: string) => {
      const name = String(rawName).trim();
      const expression = String(rawExpression).trim();
      if (name) {
        const rawResolved = resolveTemplateToken(
          expression,
          row,
          column,
          formattedValue,
          localVars,
          false,
        );
        const formattedResolved = resolveTemplateToken(
          expression,
          row,
          column,
          formattedValue,
          localVars,
          true,
        );
        localVars.raw[name] = rawResolved ?? '';
        localVars.formatted[name] = formattedResolved ?? rawResolved ?? '';
      }
      return '';
    },
  );
  return { template: cleanedTemplate, localVars };
}

function renderCaseTemplate(
  template: string,
  row: DataRecord,
  column: DataColumnMeta,
  formattedValue: string,
  localVars?: LocalVars,
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
    ? resolveTemplateToken(
        expressionRaw,
        row,
        column,
        formattedValue,
        localVars,
        false,
      )
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
        localVars,
        false,
      );
      if (whenValue === expressionValue) {
        return stripWrappingQuotes(match[2]);
      }
    } else if (
      evaluateWhenCondition(match[1], row, column, formattedValue, localVars)
    ) {
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
  const { template: cleanedTemplate, localVars } = extractLocalVariables(
    template,
    row,
    column,
    formattedValue,
  );
  const caseResult = renderCaseTemplate(
    cleanedTemplate,
    row,
    column,
    formattedValue,
    localVars,
  );
  const templateToRender =
    caseResult !== null
      ? caseResult
      : cleanedTemplate.trim().length
        ? cleanedTemplate
        : '';
  return substituteTemplateVariables(
    templateToRender,
    row,
    column,
    formattedValue,
    localVars,
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
