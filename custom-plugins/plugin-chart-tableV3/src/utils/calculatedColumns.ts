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
// ---------------------------------------------------------------------------
const COLUMN_REF_REGEX = /\{\{\s*([^}]+?)\s*\}\}/g;
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
const FORMULA_EVALUATOR_CACHE = new Map<string, (row: DataRecord) => number | null>();

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

function buildJsExpression(
  expression: string,
  columnKeys: string[],
): string | null {
  const resolveColumnKey = buildColumnKeyResolver(columnKeys);
  const columnRefReplacements: string[] = [];
  let resolved = expression;

  // 1. Replace {{ColumnName}} with a placeholder so alias replacement does not
  // touch quoted column names such as __GET("IF").
  resolved = resolved.replace(COLUMN_REF_REGEX, (_match, colName: string) => {
    const trimmed = colName.trim();
    const key = resolveColumnKey(trimmed);
    const placeholderIndex = columnRefReplacements.length;

    columnRefReplacements.push(key ? `__GET(${JSON.stringify(key)})` : 'null');
    return `${COLUMN_REF_PLACEHOLDER_PREFIX}${placeholderIndex}__`;
  });

  // 2. Replace function aliases (e.g. IF → __IF)
  resolved = resolved.replace(FUNCTION_ALIAS_REGEX, (match: string) =>
    FUNCTION_ALIASES[match] !== undefined ? FUNCTION_ALIASES[match] : match,
  );

  // 3. Restore resolved column getters.
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
): (row: DataRecord) => number | null {
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
      `"use strict"; return function __CALCULATED(row) {
        const __GET = key => {
          const value = row[key];
          if (value === null || value === undefined) return null;
          const num = Number(value);
          return Number.isNaN(num) ? null : num;
        };
        return (${jsExpr});
      };`,
    ) as (...helpers: unknown[]) => (row: DataRecord) => unknown;

    const rowEvaluator = createEvaluator(...FORMULA_HELPER_VALUES);
    const compiledEvaluator = (row: DataRecord): number | null => {
      try {
        return normalizeFormulaResult(rowEvaluator(row));
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
): number | null {
  return compileFormulaEvaluator(expression, columnKeys)(row);
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
): DataRecord[] {
  if (!calcCols.length) return data;

  const compiledColumns = calcCols.map(({ label, expression }) => ({
    label,
    evaluator: compileFormulaEvaluator(expression, existingColumnKeys),
  }));

  return data.map(row => {
    const newRow: DataRecord = { ...row };
    compiledColumns.forEach(({ label, evaluator }) => {
      newRow[label] = evaluator(row);
    });
    return newRow;
  });
}
