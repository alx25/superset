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
import { DataRecord } from '@superset-ui/core';
import { CalculatedColumnConfig } from '../types';

// ---------------------------------------------------------------------------
// Token pattern for {{ColumnName}} references (same style as Jinja fields)
// Also accepts scoped variants: col./row. (alias of the current row, kept for
// backward compatibility) and total. (the grand total row, see FormulaRowContext).
// ---------------------------------------------------------------------------
const COLUMN_REF_REGEX = /\{\{\s*([^}]+?)\s*\}\}/g;
// Matches scope.{{Name}}, capturing the scope keyword and the column name.
const SCOPED_BRACE_REGEX =
  /\b(total|col|row)\.\{\{\s*([^}]+?)\s*\}\}/g;
// Matches scope.Name (no braces) where Name is word characters (a-z, A-Z, 0-9, _).
const SCOPED_BARE_REGEX = /\b(total|col|row)\.(\w+)\b/g;
const FUNCTION_ALIAS_REGEX = /\b([A-Z_][A-Z0-9_]*)\b/g;
const COLUMN_REF_PLACEHOLDER_PREFIX = '__CALC_COLUMN_REF__';

// ---------------------------------------------------------------------------
// Safe helper functions available inside formulas
// ---------------------------------------------------------------------------
const FORMULA_HELPERS = {
  __IF: (condition: unknown, ifTrue: unknown, ifFalse: unknown) =>
    condition ? ifTrue : ifFalse,
  __OR: (...args: unknown[]) => args.some(Boolean),
  __AND: (...args: unknown[]) => args.every(Boolean),
  __NOT: (v: unknown) => !v,
  __ISBLANK: (v: unknown) => v === null || v === undefined || v === '',
  __ABS: Math.abs,
  __ROUND: (v: number, p = 0) => Math.round(v * 10 ** p) / 10 ** p,
  __MAX: Math.max,
  __MIN: Math.min,
};

const FORMULA_HELPER_NAMES = Object.keys(FORMULA_HELPERS);
const FORMULA_HELPER_VALUES = Object.values(FORMULA_HELPERS);

/**
 * Extra data made available to a formula besides the current row.
 * `total` is the grand-total row for the whole table (same values shown in
 * the footer "Total" row), regardless of grouping -- used to resolve
 * total.{{Metric}} references.
 */
export type FormulaRowContext = {
  total?: DataRecord | null;
};

type RowEvaluator = (
  row: DataRecord,
  context?: FormulaRowContext,
) => number | null;

const FORMULA_EVALUATOR_CACHE = new Map<string, RowEvaluator>();

/** Map of uppercase function aliases → internal helper names */
const FUNCTION_ALIASES: Record<string, string> = {
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

// ---------------------------------------------------------------------------
// Expression builder
// ---------------------------------------------------------------------------

/**
 * Substitute {{ColumnName}} tokens with the actual numeric value from `row`,
 * and replace known function names with their safe helper equivalents.
 * Returns a JS expression string that can be passed to `Function()`.
 */
function buildColumnKeyResolver(columnKeys: string[]) {
  const exactKeys = new Set(columnKeys);
  const caseInsensitiveKeys = new Map<string, string>();

  columnKeys.forEach(key => {
    const normalizedKey = key.toLowerCase();
    if (!caseInsensitiveKeys.has(normalizedKey)) {
      caseInsensitiveKeys.set(normalizedKey, key);
    }
  });

  return (columnName: string): string | null => {
    if (exactKeys.has(columnName)) {
      return columnName;
    }
    return caseInsensitiveKeys.get(columnName.toLowerCase()) ?? null;
  };
}

/** Map of scope keyword → JS getter function name used inside the compiled body. */
const SCOPE_GETTERS: Record<string, string> = {
  total: '__GET_TOTAL',
  col: '__GET',
  row: '__GET',
};

// Matches a single `=` that is not already part of `==`, `!=`, `<=`, `>=`.
const BARE_EQUALS_REGEX = /(?<![=!<>])=(?!=)/g;
// Splits on double-quoted string literals (keeping them as odd-indexed
// segments) so `=` inside a formula's own string values is left untouched.
const DOUBLE_QUOTED_LITERAL_REGEX = /("(?:[^"\\]|\\.)*")/g;

/**
 * Formulas are written with Excel/Jinja-style comparisons (`{{Venta}} = 0`),
 * but the expression is compiled with JS `Function()`, where a bare `=` is
 * assignment, not comparison, and throws a SyntaxError that gets swallowed
 * (the whole formula silently evaluates to null forever). Rewrite bare `=`
 * to `==`, skipping content inside double-quoted string literals.
 */
function normalizeComparisonOperators(expression: string): string {
  return expression
    .split(DOUBLE_QUOTED_LITERAL_REGEX)
    .map((segment, index) =>
      index % 2 === 1 ? segment : segment.replace(BARE_EQUALS_REGEX, '=='),
    )
    .join('');
}

function buildJsExpression(
  expression: string,
  columnKeys: string[],
): string | null {
  const resolveColumnKey = buildColumnKeyResolver(columnKeys);
  const columnRefReplacements: string[] = [];
  let resolved = normalizeComparisonOperators(expression);

  const pushReplacement = (jsCode: string) => {
    const placeholderIndex = columnRefReplacements.length;
    columnRefReplacements.push(jsCode);
    return `${COLUMN_REF_PLACEHOLDER_PREFIX}${placeholderIndex}__`;
  };

  const getterFor = (scope: string, key: string | null) =>
    key ? `${SCOPE_GETTERS[scope]}(${JSON.stringify(key)})` : 'null';

  // 1. Replace scope.{{Name}} references (total.{{Venta}}, col.{{Venta}}, ...)
  // before the generic {{Name}} pass, so the scope prefix is not left behind.
  resolved = resolved.replace(
    SCOPED_BRACE_REGEX,
    (_match, scope: string, colName: string) => {
      const key = resolveColumnKey(colName.trim());
      return pushReplacement(getterFor(scope, key));
    },
  );

  // 2. Replace scope.Name references without braces (total.Venta, col.Venta, ...).
  resolved = resolved.replace(
    SCOPED_BARE_REGEX,
    (match, scope: string, colName: string) => {
      const key = resolveColumnKey(colName);
      if (!key) return match;
      return pushReplacement(getterFor(scope, key));
    },
  );

  // 3. Replace remaining plain {{ColumnName}} with a placeholder so alias
  // replacement does not touch quoted column names such as __GET("IF").
  resolved = resolved.replace(COLUMN_REF_REGEX, (_match, colName: string) => {
    const trimmed = colName.trim();
    const key = resolveColumnKey(trimmed);
    return pushReplacement(getterFor('row', key));
  });

  // 4. Replace function aliases (e.g. IF → __IF)
  resolved = resolved.replace(FUNCTION_ALIAS_REGEX, (match: string) =>
    FUNCTION_ALIASES[match] !== undefined ? FUNCTION_ALIASES[match] : match,
  );

  // 5. Restore resolved column getters.
  columnRefReplacements.forEach((replacement, index) => {
    const placeholder = `${COLUMN_REF_PLACEHOLDER_PREFIX}${index}__`;
    resolved = resolved.split(placeholder).join(replacement);
  });

  return resolved;
}

function normalizeFormulaResult(result: unknown): number | null {
  if (result === null || result === undefined) return null;
  const num = Number(result);
  return Number.isFinite(num) ? num : null;
}

function buildFormulaCacheKey(expression: string, columnKeys: string[]) {
  return `${expression}\u0000${columnKeys.join('\u0001')}`;
}

export function compileFormulaEvaluator(
  expression: string,
  columnKeys: string[],
): RowEvaluator {
  if (!expression?.trim()) {
    return () => null;
  }

  const cacheKey = buildFormulaCacheKey(expression, columnKeys);
  const cachedEvaluator = FORMULA_EVALUATOR_CACHE.get(cacheKey);
  if (cachedEvaluator) {
    return cachedEvaluator;
  }

  const jsExpr = buildJsExpression(expression, columnKeys);
  if (!jsExpr) {
    const nullEvaluator = () => null;
    FORMULA_EVALUATOR_CACHE.set(cacheKey, nullEvaluator);
    return nullEvaluator;
  }

  try {
    // Build a reusable row evaluator with only the safe helpers in scope.
    // eslint-disable-next-line no-new-func
    const createEvaluator = new Function(
      ...FORMULA_HELPER_NAMES,
      `"use strict"; return function __CALCULATED(row, total) {
        const __TO_NUM = value => {
          if (value === null || value === undefined) return null;
          const num = Number(value);
          return Number.isNaN(num) ? null : num;
        };
        const __GET = key => __TO_NUM(row ? row[key] : undefined);
        const __GET_TOTAL = key => __TO_NUM(total ? total[key] : undefined);
        return (${jsExpr});
      };`,
    ) as (
      ...helpers: unknown[]
    ) => (row: DataRecord, total?: DataRecord | null) => unknown;

    const rowEvaluator = createEvaluator(...FORMULA_HELPER_VALUES);
    const compiledEvaluator: RowEvaluator = (row, context) => {
      try {
        return normalizeFormulaResult(
          rowEvaluator(row, context?.total ?? null),
        );
      } catch {
        return null;
      }
    };

    FORMULA_EVALUATOR_CACHE.set(cacheKey, compiledEvaluator);
    return compiledEvaluator;
  } catch {
    const nullEvaluator = () => null;
    FORMULA_EVALUATOR_CACHE.set(cacheKey, nullEvaluator);
    return nullEvaluator;
  }
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate a formula expression against a single data row.
 * Column values are referenced with {{ColumnName}} syntax.
 * Returns `null` on any error (division by zero, invalid expression, etc.)
 */
export function evaluateFormula(
  expression: string,
  row: DataRecord,
  columnKeys: string[],
  context?: FormulaRowContext,
): number | null {
  return compileFormulaEvaluator(expression, columnKeys)(row, context);
}

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

/**
 * Normalise the raw value coming from the CollectionControl (array of items
 * with shape { key, label, expression, d3format }).
 * Filters out incomplete entries.
 */
export function normalizeCalculatedColumns(
  raw: unknown,
): CalculatedColumnConfig[] {
  if (!raw) return [];
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const result: CalculatedColumnConfig[] = [];

  raw.forEach((item: unknown) => {
    if (!item || typeof item !== 'object') return;
    const obj = item as Record<string, unknown>;
    const label = String(obj.label ?? '').trim();
    const expression = String(obj.expression ?? '').trim();
    const d3format = obj.d3format ? String(obj.d3format).trim() : undefined;

    if (!label || !expression || seen.has(label)) return;
    seen.add(label);
    result.push({ key: String(obj.key ?? ''), label, expression, d3format });
  });

  return result;
}

// ---------------------------------------------------------------------------
// Data application
// ---------------------------------------------------------------------------

/**
 * Apply calculated column definitions to every row of the dataset.
 * Returns a new array with the computed columns appended to each record.
 */
export function applyCalculatedColumns(
  data: DataRecord[],
  calcCols: CalculatedColumnConfig[],
  existingColumnKeys: string[],
  context?: FormulaRowContext,
): DataRecord[] {
  if (!calcCols.length) return data;

  // Column keys include every other calculated column's label too, so a
  // formula can reference an earlier one (e.g. {{var venta}}) -- earlier
  // meaning defined above it in the "Calculated columns" list, since each
  // formula is evaluated against the accumulated row below.
  const allKeys = Array.from(
    new Set([...existingColumnKeys, ...calcCols.map(({ label }) => label)]),
  );
  const compiledColumns = calcCols.map(({ label, expression }) => ({
    label,
    evaluator: compileFormulaEvaluator(expression, allKeys),
  }));

  return data.map(row => {
    const newRow: DataRecord = { ...row };
    compiledColumns.forEach(({ label, evaluator }) => {
      newRow[label] = evaluator(newRow, context);
    });
    return newRow;
  });
}
