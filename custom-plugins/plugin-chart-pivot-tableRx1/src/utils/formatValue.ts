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
import { DataRecord, DataRecordValue } from '@superset-ui/core';

type LocalVars = {
  raw: Record<string, string>;
  formatted: Record<string, string>;
};

export type TemplateContext = {
  row: DataRecord;
  columnKey: string;
  rawValue: DataRecordValue;
  formattedValue: string;
  formatter?: (value: number) => string;
};

const TEMPLATE_VARIABLE_REGEX = /\{\{\s*([^}]+)\s*\}\}/g;
const CASE_TEMPLATE_REGEX = /^CASE\b/i;
const COMPARISON_CONDITION_REGEX =
  /\{\{\s*([^}]+)\s*\}\}\s*(>=|<=|!=|<>|==|=|>|<)\s*([\s\S]+)/;
const SET_STATEMENT_REGEX =
  /\{%\s*set\s+([a-zA-Z_][\w]*)\s*=\s*([\s\S]*?)\s*%\}/gi;
const SCOPED_TEMPLATE_REGEX =
  /\b(total|row|col)\s*\.\s*\{\{\s*([^}]+?)\s*\}\}/gi;
const SCOPED_VALUE_REGEX =
  /\b(total|row|col)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\b/g;

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
  TRUE: 'true',
  FALSE: 'false',
  NULL: 'null',
  NAN: 'NaN',
};

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

function normalizeTemplate(template: string) {
  if (!template) {
    return template;
  }
  return template.replace(SCOPED_TEMPLATE_REGEX, (_match, rawScope, rawKey) => {
    const scope = String(rawScope || '').trim();
    const key = String(rawKey || '').trim();
    if (!scope || !key) {
      return _match;
    }
    return `{{${scope}.${key}}}`;
  });
}

function getNestedValue(row: DataRecord, path: string) {
  return path
    .split('.')
    .reduce<any>((acc, key) => (acc == null ? undefined : acc?.[key]), row);
}

function resolveContextValue(row: DataRecord, key: string) {
  if (!key) {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(row, key)) {
    return row[key];
  }
  const nested = getNestedValue(row, key);
  return nested === undefined ? undefined : nested;
}

function toNumeric(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function resolveNumericValue(
  key: string,
  context: TemplateContext,
  localVars?: LocalVars,
) {
  const trimmed = key.trim();
  if (!trimmed) {
    return null;
  }
  if (localVars && Object.prototype.hasOwnProperty.call(localVars.raw, trimmed)) {
    return toNumeric(localVars.raw[trimmed]);
  }
  if (
    trimmed === 'value' ||
    trimmed === 'raw_value' ||
    trimmed === context.columnKey
  ) {
    return toNumeric(context.rawValue);
  }
  const fromRow = resolveContextValue(context.row, trimmed);
  return toNumeric(fromRow);
}

function tokenizeFormula(expression: string) {
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
      const match = expression
        .slice(idx)
        .match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
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
}

function evaluateExpression(
  expression: string,
  context: TemplateContext,
  localVars?: LocalVars,
) {
  const trimmed = expression.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = normalizeTemplate(trimmed);
  let prepared = normalized.replace(TEMPLATE_VARIABLE_REGEX, (_match, rawKey) => {
    const key = String(rawKey || '').trim();
    const numeric = resolveNumericValue(key, context, localVars);
    return Number.isFinite(numeric as number) ? String(numeric) : 'NaN';
  });
  prepared = prepared.replace(SCOPED_VALUE_REGEX, (_match, rawScope, rawKey) => {
    const scope = String(rawScope || '').trim();
    const key = String(rawKey || '').trim();
    const numeric = resolveNumericValue(`${scope}.${key}`, context, localVars);
    return Number.isFinite(numeric as number) ? String(numeric) : 'NaN';
  });
  const tokens = tokenizeFormula(prepared);
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
      const numeric = resolveNumericValue(token.value, context, localVars);
      output.push(Number.isFinite(numeric as number) ? String(numeric) : 'NaN');
      continue;
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

  const parsedExpression = output.join(' ');
  try {
    const helpers = {
      __IF: (cond: any, onTrue: any, onFalse: any) => (cond ? onTrue : onFalse),
      __OR: (...args: any[]) => args.some(Boolean),
      __AND: (...args: any[]) => args.every(Boolean),
      __NOT: (value: any) => !value,
      __ISBLANK: (value: any) =>
        value === null ||
        value === undefined ||
        value === '' ||
        Number.isNaN(value),
      __ABS: (value: any) => {
        const num = Number(value);
        return Number.isFinite(num) ? Math.abs(num) : NaN;
      },
      __ROUND: (value: any, precision: any = 0) => {
        const num = Number(value);
        const prec = Number(precision);
        if (!Number.isFinite(num)) {
          return NaN;
        }
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
    };
    // eslint-disable-next-line no-new-func
    const result = Function(
      '__IF',
      '__OR',
      '__AND',
      '__NOT',
      '__ISBLANK',
      '__ABS',
      '__ROUND',
      '__MAX',
      '__MIN',
      '"use strict"; return (' + parsedExpression + ');',
    )(
      helpers.__IF,
      helpers.__OR,
      helpers.__AND,
      helpers.__NOT,
      helpers.__ISBLANK,
      helpers.__ABS,
      helpers.__ROUND,
      helpers.__MAX,
      helpers.__MIN,
    );
    if (result === undefined || result === null) {
      return null;
    }
    if (typeof result === 'number' && !Number.isFinite(result)) {
      return null;
    }
    return result;
  } catch {
    return null;
  }
}

function resolveTemplateToken(
  token: string,
  context: TemplateContext,
  localVars?: LocalVars,
  preferFormatted?: boolean,
): string {
  const trimmed = token.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed === 'value') {
    return context.formattedValue ?? '';
  }
  if (trimmed === 'raw_value') {
    return context.rawValue == null ? '' : String(context.rawValue);
  }
  if (trimmed === context.columnKey) {
    return preferFormatted
      ? context.formattedValue ?? ''
      : context.rawValue == null
        ? ''
        : String(context.rawValue);
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return stripWrappingQuotes(trimmed);
  }

  if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) {
    const inner = trimmed.slice(2, -2).trim();
    return resolveTemplateToken(inner, context, localVars, preferFormatted);
  }

  if (localVars && Object.prototype.hasOwnProperty.call(localVars.raw, trimmed)) {
    return preferFormatted
      ? localVars.formatted[trimmed] ?? localVars.raw[trimmed] ?? ''
      : localVars.raw[trimmed] ?? '';
  }

  const contextValue = resolveContextValue(context.row, trimmed);
  if (contextValue !== undefined) {
    if (contextValue === null) {
      return '';
    }
    if (preferFormatted && typeof contextValue === 'number' && context.formatter) {
      return context.formatter(contextValue);
    }
    return String(contextValue);
  }

  const evaluated = evaluateExpression(trimmed, context, localVars);
  if (evaluated !== null && evaluated !== undefined) {
    if (typeof evaluated === 'number') {
      if (preferFormatted && context.formatter) {
        return context.formatter(evaluated);
      }
      return String(evaluated);
    }
    if (typeof evaluated === 'boolean') {
      return evaluated ? 'true' : 'false';
    }
    return String(evaluated);
  }

  const looksLikeFormula =
    /[+*/()-]/.test(trimmed) || TEMPLATE_VARIABLE_REGEX.test(trimmed);
  TEMPLATE_VARIABLE_REGEX.lastIndex = 0;
  return looksLikeFormula ? '' : stripWrappingQuotes(trimmed);
}

function substituteTemplateVariables(
  template: string,
  context: TemplateContext,
  localVars?: LocalVars,
) {
  return template.replace(TEMPLATE_VARIABLE_REGEX, (_match, rawKey: string) => {
    const key = rawKey.trim();
    if (!key) {
      return '';
    }
    return resolveTemplateToken(key, context, localVars, true);
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
  context: TemplateContext,
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
    const leftValueRaw = resolveTemplateToken(
      leftKey,
      context,
      localVars,
      false,
    );
    if (leftValueRaw === undefined) {
      return false;
    }
    const rightResolved = resolveTemplateToken(
      rawRight,
      context,
      localVars,
      false,
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
  const resolved = resolveTemplateToken(trimmed, context, localVars, false);
  const normalized = resolved.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return resolved.length > 0;
}

function extractLocalVariables(template: string, context: TemplateContext) {
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
        const evaluated = evaluateExpression(expression, context, localVars);
        if (evaluated !== null && evaluated !== undefined) {
          if (typeof evaluated === 'number') {
            localVars.raw[name] = String(evaluated);
            localVars.formatted[name] = context.formatter
              ? context.formatter(evaluated)
              : String(evaluated);
          } else if (typeof evaluated === 'boolean') {
            localVars.raw[name] = evaluated ? 'true' : 'false';
            localVars.formatted[name] = localVars.raw[name];
          } else {
            localVars.raw[name] = String(evaluated);
            localVars.formatted[name] = String(evaluated);
          }
        } else {
          const rawResolved = resolveTemplateToken(
            expression,
            context,
            localVars,
            false,
          );
          const formattedResolved = resolveTemplateToken(
            expression,
            context,
            localVars,
            true,
          );
          const looksLikeFormula =
            /[+*/()-]/.test(expression) ||
            TEMPLATE_VARIABLE_REGEX.test(expression);
          TEMPLATE_VARIABLE_REGEX.lastIndex = 0;
          const normalizedExpression = expression.trim();
          if (
            looksLikeFormula &&
            rawResolved === normalizedExpression &&
            formattedResolved === normalizedExpression
          ) {
            localVars.raw[name] = '';
            localVars.formatted[name] = '';
          } else {
            localVars.raw[name] = rawResolved ?? '';
            localVars.formatted[name] = formattedResolved ?? rawResolved ?? '';
          }
        }
      }
      return '';
    },
  );
  return { template: cleanedTemplate, localVars };
}

function renderCaseTemplate(
  template: string,
  context: TemplateContext,
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
    ? resolveTemplateToken(expressionRaw, context, localVars, false)
    : '';

  const caseRegex = /WHEN\s+([\s\S]+?)\s+THEN\s+([\s\S]+?)(?=WHEN\s+|$)/gi;
  let match = caseRegex.exec(remainder);
  while (match) {
    if (hasExpression) {
      const whenValue = resolveTemplateToken(
        match[1],
        context,
        localVars,
        false,
      );
      if (whenValue === expressionValue) {
        return stripWrappingQuotes(match[2]);
      }
    } else if (evaluateWhenCondition(match[1], context, localVars)) {
      return stripWrappingQuotes(match[2]);
    }
    match = caseRegex.exec(remainder);
  }

  if (elseBlock) {
    return stripWrappingQuotes(elseBlock);
  }

  return '';
}

export function renderHtmlTemplate(template: string, context: TemplateContext) {
  if (!template) {
    return '';
  }
  const normalized = normalizeTemplate(template);
  const { template: cleanedTemplate, localVars } = extractLocalVariables(
    normalized,
    context,
  );
  const caseResult = renderCaseTemplate(
    cleanedTemplate,
    context,
    localVars,
  );
  const templateToRender =
    caseResult !== null
      ? caseResult
      : cleanedTemplate.trim().length
        ? cleanedTemplate
        : '';
  return substituteTemplateVariables(templateToRender, context, localVars);
}
