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
import memoizeOne from 'memoize-one';
import { addAlpha, DataRecord } from '@superset-ui/core';
import {
  ColorFormatters,
  Comparator,
  ConditionalFormattingConfig,
  MultipleValueComparators,
} from '../types';

export const round = (num: number, precision = 0) =>
  Number(`${Math.round(Number(`${num}e+${precision}`))}e-${precision}`);

const MIN_OPACITY_BOUNDED = 0.05;
const MIN_OPACITY_UNBOUNDED = 0;
const MAX_OPACITY = 1;
export const getOpacity = (
  value: number,
  cutoffPoint: number,
  extremeValue: number,
  minOpacity = MIN_OPACITY_BOUNDED,
  maxOpacity = MAX_OPACITY,
) => {
  if (extremeValue === cutoffPoint) {
    return maxOpacity;
  }
  return Math.min(
    maxOpacity,
    round(
      Math.abs(
        ((maxOpacity - minOpacity) / (extremeValue - cutoffPoint)) *
          (value - cutoffPoint),
      ) + minOpacity,
      2,
    ),
  );
};

export const getColorFunction = (
  {
    operator,
    targetValue,
    targetValueLeft,
    targetValueRight,
    colorScheme,
  }: ConditionalFormattingConfig,
  columnValues: any[],
  alpha?: boolean,
) => {
  let minOpacity = MIN_OPACITY_BOUNDED;
  const maxOpacity = MAX_OPACITY;
  let comparatorFunction: (
    value: any,
    allValues: any[],
  ) => false | { cutoffValue: number; extremeValue: number };
  if (operator === undefined || colorScheme === undefined) {
    return () => undefined;
  }
  if (
    MultipleValueComparators.includes(operator) &&
    (targetValueLeft === undefined || targetValueRight === undefined)
  ) {
    return () => undefined;
  }
  if (
    operator !== Comparator.None &&
    !MultipleValueComparators.includes(operator) &&
    targetValue === undefined
  ) {
    return () => undefined;
  }
  // detect whether the column is numeric
  const isNumericColumn = columnValues.every(v => typeof v === 'number');

  // if column is not numeric, only allow Equal, NotEqual, Like, or None
  const numericOnlyOperators = [
    Comparator.GreaterThan,
    Comparator.LessThan,
    Comparator.GreaterOrEqual,
    Comparator.LessOrEqual,
    Comparator.Between,
    Comparator.BetweenOrEqual,
    Comparator.BetweenOrLeftEqual,
    Comparator.BetweenOrRightEqual,
  ];
  if (!isNumericColumn && numericOnlyOperators.includes(operator!)) {
    return () => undefined;
  }
  switch (operator) {
    case Comparator.None:
      if (!isNumericColumn) {
        // None comparator not meaningful for non-numeric columns
        return () => undefined;
      }
      minOpacity = MIN_OPACITY_UNBOUNDED;
      comparatorFunction = (value: number, allValues: number[]) => {
        const nums = allValues.map(Number);
        const cutoffValue = Math.min(...nums);
        const extremeValue = Math.max(...nums);
        return value >= cutoffValue && value <= extremeValue
          ? { cutoffValue, extremeValue }
          : false;
      };
      break;
    case Comparator.GreaterThan:
      comparatorFunction = (value: number, allValues: number[]) => {
        if (value > Number(targetValue as number)) {
          return {
            cutoffValue: Number(targetValue as number),
            extremeValue: Math.max(...(allValues as number[])),
          };
        }
        return false;
      };
      break;
    case Comparator.LessThan:
      comparatorFunction = (value: number, allValues: number[]) => {
        if (value < Number(targetValue as number)) {
          return {
            cutoffValue: Number(targetValue as number),
            extremeValue: Math.min(...(allValues as number[])),
          };
        }
        return false;
      };
      break;
    case Comparator.GreaterOrEqual:
      comparatorFunction = (value: number, allValues: number[]) => {
        if (value >= Number(targetValue as number)) {
          return {
            cutoffValue: Number(targetValue as number),
            extremeValue: Math.max(...(allValues as number[])),
          };
        }
        return false;
      };
      break;
    case Comparator.LessOrEqual:
      comparatorFunction = (value: number, allValues: number[]) => {
        if (value <= Number(targetValue as number)) {
          return {
            cutoffValue: Number(targetValue as number),
            extremeValue: Math.min(...(allValues as number[])),
          };
        }
        return false;
      };
      break;
    case Comparator.Equal:
      if (isNumericColumn) {
        comparatorFunction = (value: number) => {
          if (value === Number(targetValue as number)) {
            return {
              cutoffValue: Number(targetValue as number),
              extremeValue: Number(targetValue as number),
            };
          }
          return false;
        };
      } else {
        comparatorFunction = (value: string) => {
          if (String(value) === String(targetValue)) {
            return { cutoffValue: 1, extremeValue: 1 };
          }
          return false;
        };
      }
      break;
    case Comparator.NotEqual:
      if (isNumericColumn) {
        comparatorFunction = (value: number, allValues: number[]) => {
          if (value === Number(targetValue as number)) {
            return false;
          }
          const max = Math.max(...(allValues as number[]));
          const min = Math.min(...(allValues as number[]));
          const t = Number(targetValue as number);
          let extremeValueCandidate: number;
          if (Math.abs(t - min) > Math.abs(max - t)) {
            extremeValueCandidate = min;
          } else {
            extremeValueCandidate = max;
          }
          return {
            cutoffValue: t,
            extremeValue: extremeValueCandidate,
          };
        };
      } else {
        comparatorFunction = (value: string) => {
          if (String(value) === String(targetValue)) {
            return false;
          }
          return { cutoffValue: 1, extremeValue: 1 };
        };
      }
      break;
    case Comparator.Like:
      comparatorFunction = (value: any) => {
        if (value == null) return false;
        const pattern = String(targetValue || '');
        // escape regex special chars except % and _
        const escaped = pattern.replace(/([.+^${}()|[\\]\\])/g, '\\$1');
        // convert SQL LIKE wildcards: % -> .* , _ -> .
        const regexStr = `^${escaped.replace(/%/g, '.*').replace(/_/g, '.')}$`;
        const re = new RegExp(regexStr, 'i');
        return re.test(String(value))
          ? {
              cutoffValue: 1,
              extremeValue: 1,
            }
          : false;
      };
      break;
    case Comparator.Between:
      comparatorFunction = (value: number) => {
        if (
          value > Number(targetValueLeft as number) &&
          value < Number(targetValueRight as number)
        ) {
          return {
            cutoffValue: Number(targetValueLeft as number),
            extremeValue: Number(targetValueRight as number),
          };
        }
        return false;
      };
      break;
    case Comparator.BetweenOrEqual:
      comparatorFunction = (value: number) => {
        if (
          value >= Number(targetValueLeft as number) &&
          value <= Number(targetValueRight as number)
        ) {
          return {
            cutoffValue: Number(targetValueLeft as number),
            extremeValue: Number(targetValueRight as number),
          };
        }
        return false;
      };
      break;
    case Comparator.BetweenOrLeftEqual:
      comparatorFunction = (value: number) => {
        if (
          value >= Number(targetValueLeft as number) &&
          value < Number(targetValueRight as number)
        ) {
          return {
            cutoffValue: Number(targetValueLeft as number),
            extremeValue: Number(targetValueRight as number),
          };
        }
        return false;
      };
      break;
    case Comparator.BetweenOrRightEqual:
      comparatorFunction = (value: number) => {
        if (
          value > Number(targetValueLeft as number) &&
          value <= Number(targetValueRight as number)
        ) {
          return {
            cutoffValue: Number(targetValueLeft as number),
            extremeValue: Number(targetValueRight as number),
          };
        }
        return false;
      };
      break;
    default:
      comparatorFunction = () => false;
      break;
  }

  return (value: any) => {
    const compareResult = comparatorFunction(value, columnValues);
    if (compareResult === false) return undefined;
    const { cutoffValue, extremeValue } = compareResult;
    // if value is numeric, compute opacity based on magnitude
    if (typeof value === 'number') {
      if (alpha === undefined || alpha) {
        return addAlpha(
          colorScheme,
          getOpacity(value, cutoffValue, extremeValue, minOpacity, maxOpacity),
        );
      }
      return colorScheme;
    }
    // non-numeric values: return solid color (use alpha if requested)
    if (alpha === undefined || alpha) {
      return addAlpha(colorScheme, maxOpacity);
    }
    return colorScheme;
  };
};

export const getColorFormatters = memoizeOne(
  (
    columnConfig: ConditionalFormattingConfig[] | undefined,
    data: DataRecord[],
    alpha?: boolean,
  ) =>
    columnConfig?.reduce(
      (acc: ColorFormatters, config: ConditionalFormattingConfig) => {
        if (
          config?.column !== undefined &&
          (config?.operator === Comparator.None ||
            (config?.operator !== undefined &&
              (MultipleValueComparators.includes(config?.operator)
                ? config?.targetValueLeft !== undefined &&
                  config?.targetValueRight !== undefined
                : config?.targetValue !== undefined)))
        ) {
          acc.push({
            column: config?.column,
            getColorFromValue: getColorFunction(
              config,
              data.map(row => row[config.column!] as any),
              alpha,
            ),
          });
        }
        return acc;
      },
      [],
    ) ?? [],
);
