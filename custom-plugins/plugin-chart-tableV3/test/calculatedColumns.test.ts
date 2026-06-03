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
});
