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
  applyCalculatedColumns,
  compileFormulaEvaluator,
  evaluateFormula,
} from '../src/utils/calculatedColumns';

describe('calculatedColumns', () => {
  it('keeps the same formula semantics after compiling evaluators', () => {
    const expression =
      'ROUND(IF(ISBLANK({{sum__denom}}), NULL, {{SUM__NUM}} / {{sum__denom}}), 2)';
    const columnKeys = ['sum__num', 'sum__denom'];
    const evaluator = compileFormulaEvaluator(expression, columnKeys);

    expect(
      evaluator({
        sum__num: 10,
        sum__denom: 4,
      }),
    ).toBe(evaluateFormula(expression, { sum__num: 10, sum__denom: 4 }, columnKeys));

    expect(
      evaluator({
        sum__num: 10,
        sum__denom: null,
      }),
    ).toBe(evaluateFormula(expression, { sum__num: 10, sum__denom: null }, columnKeys));

    expect(
      evaluator({
        sum__num: 10,
        sum__denom: 0,
      }),
    ).toBeNull();
  });

  it('reuses the compiled evaluator for the same expression and column set', () => {
    const originalFunction = global.Function;
    const functionSpy = jest.fn(function MockFunction(this: unknown, ...args: any[]) {
      return originalFunction(...args);
    });

    (global as any).Function = functionSpy as unknown as FunctionConstructor;

    try {
      const expression = '{{sum__num}} + 1.23456789';
      const columnKeys = ['sum__num'];
      const evaluatorA = compileFormulaEvaluator(expression, columnKeys);
      const evaluatorB = compileFormulaEvaluator(expression, columnKeys);

      expect(evaluatorA({ sum__num: 1 })).toBeCloseTo(2.23456789);
      expect(evaluatorB({ sum__num: 2 })).toBeCloseTo(3.23456789);
      expect(functionSpy).toHaveBeenCalledTimes(1);
    } finally {
      (global as any).Function = originalFunction;
    }
  });

  it('applies precompiled evaluators across all rows without changing results', () => {
    const result = applyCalculatedColumns(
      [
        { sum__num: 50, sum__denom: 100, delta: -4 },
        { sum__num: 30, sum__denom: 0, delta: 3 },
      ],
      [
        {
          label: 'ratio',
          expression: '{{sum__num}} / {{sum__denom}}',
        },
        {
          label: 'abs_delta',
          expression: 'ABS({{delta}})',
        },
      ] as any,
      ['sum__num', 'sum__denom', 'delta'],
    );

    expect(result).toEqual([
      { sum__num: 50, sum__denom: 100, delta: -4, ratio: 0.5, abs_delta: 4 },
      {
        sum__num: 30,
        sum__denom: 0,
        delta: 3,
        ratio: null,
        abs_delta: 3,
      },
    ]);
  });

  it('resolves total.{{Column}} against the provided total context', () => {
    const expression = '{{Venta}}/total.{{Venta}}';
    const columnKeys = ['Venta'];
    const evaluator = compileFormulaEvaluator(expression, columnKeys);

    expect(evaluator({ Venta: 25 }, { total: { Venta: 100 } })).toBe(0.25);
    // Without a total in context the formula must not throw -- it resolves
    // to null instead of crashing the whole evaluator.
    expect(evaluator({ Venta: 25 })).toBeNull();
  });

  it('resolves total.Column (without braces) the same way as total.{{Column}}', () => {
    const evaluator = compileFormulaEvaluator(
      'ROUND({{Venta}}/total.Venta, 4)',
      ['Venta'],
    );
    expect(evaluator({ Venta: 1 }, { total: { Venta: 3 } })).toBeCloseTo(
      0.3333,
    );
  });

  it('keeps col./row. behaving as aliases of the current row (unchanged)', () => {
    const evaluator = compileFormulaEvaluator(
      '{{Venta}} - row.Venta + col.{{Venta}}',
      ['Venta'],
    );
    expect(evaluator({ Venta: 10 })).toBe(10);
  });

  it('propagates total context through evaluateFormula and applyCalculatedColumns', () => {
    expect(
      evaluateFormula('{{Venta}}/total.{{Venta}}', { Venta: 10 }, ['Venta'], {
        total: { Venta: 40 },
      }),
    ).toBe(0.25);

    const rows = applyCalculatedColumns(
      [{ Venta: 10 }, { Venta: 30 }],
      [{ label: 'share', expression: '{{Venta}}/total.{{Venta}}' }] as any,
      ['Venta'],
      { total: { Venta: 40 } },
    );
    expect(rows).toEqual([
      { Venta: 10, share: 0.25 },
      { Venta: 30, share: 0.75 },
    ]);
  });

  it('treats a bare `=` as comparison, not JS assignment', () => {
    // Excel/Jinja-style `=` (as documented in the formula help modal) is not
    // valid JS comparison syntax and used to throw a SyntaxError, silently
    // turning the whole formula into a permanent null-evaluator.
    const evaluator = compileFormulaEvaluator('IF({{Venta}} = 0, 1, 2)', [
      'Venta',
    ]);
    expect(evaluator({ Venta: 5 })).toBe(2);
    expect(evaluator({ Venta: 0 })).toBe(1);
  });

  it('leaves ==, !=, <=, >= untouched by the `=` normalization', () => {
    expect(
      compileFormulaEvaluator('IF({{Venta}} == 0, 1, 2)', ['Venta'])({
        Venta: 0,
      }),
    ).toBe(1);
    expect(
      compileFormulaEvaluator('IF({{Venta}} != 0, 1, 2)', ['Venta'])({
        Venta: 0,
      }),
    ).toBe(2);
    expect(
      compileFormulaEvaluator('IF({{Venta}} <= 5, 1, 2)', ['Venta'])({
        Venta: 5,
      }),
    ).toBe(1);
    expect(
      compileFormulaEvaluator('IF({{Venta}} >= 5, 1, 2)', ['Venta'])({
        Venta: 5,
      }),
    ).toBe(1);
  });

  it('does not rewrite `=` inside a double-quoted string literal', () => {
    const evaluator = compileFormulaEvaluator('IF({{Venta}} = 0, "a=b", 2)', [
      'Venta',
    ]);
    // Number("a=b") is NaN, proving the literal was left untouched.
    expect(evaluator({ Venta: 0 })).toBeNull();
  });

  it('lets a formula reference an earlier calculated column by {{label}}', () => {
    const rows = applyCalculatedColumns(
      [{ Venta: 25 }, { Venta: 75 }],
      [
        { label: 'var venta', expression: '{{Venta}}/total.{{Venta}}' },
        { label: 'otra', expression: '{{var venta}}/total.{{var venta}}' },
      ] as any,
      ['Venta'],
      // enrichedTotal: "var venta" evaluated on the total row is Venta/Venta = 1.
      { total: { Venta: 100, 'var venta': 1 } },
    );

    expect(rows).toEqual([
      { Venta: 25, 'var venta': 0.25, otra: 0.25 },
      { Venta: 75, 'var venta': 0.75, otra: 0.75 },
    ]);
  });

  it('does not let a formula reference a calculated column defined after it', () => {
    // Order in the "Calculated columns" list is the evaluation order --
    // referencing one defined later resolves to null (not a crash), same as
    // referencing any other unknown column.
    const rows = applyCalculatedColumns(
      [{ Venta: 10 }],
      [
        { label: 'otra', expression: '{{var venta}} + 1' },
        { label: 'var venta', expression: '{{Venta}}' },
      ] as any,
      ['Venta'],
    );

    expect(rows).toEqual([{ Venta: 10, otra: 1, 'var venta': 10 }]);
  });
});
