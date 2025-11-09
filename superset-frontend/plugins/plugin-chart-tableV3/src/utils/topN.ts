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
import { DataColumnMeta } from '../types';

/**
 * Determine if a metric is likely a ratio/percentage that should be recalculated
 * rather than summed. Extracted so both client and transform layers reuse logic.
 */
export function isRatioMetric(columnKey: string, data: DataRecord[]): boolean {
  const key = columnKey.toLowerCase();

  const ratioIndicators = [
    '/',
    'ratio',
    'rate',
    'percent',
    '%',
    'vs',
    'per',
    'margin',
    'efficiency',
    'conversion',
    'yield',
  ];

  if (ratioIndicators.some(indicator => key.includes(indicator))) {
    return true;
  }

  const numericValues = data
    .map(row => Number(row[columnKey]))
    .filter(val => !Number.isNaN(val) && val !== 0);

  if (numericValues.length === 0) {
    return false;
  }

  const max = Math.max(...numericValues);
  const avg =
    numericValues.reduce((accumulator, value) => accumulator + value, 0) /
    numericValues.length;

  return max < 100 && avg < 10;
}

function findComponentColumns(
  ratioColumnKey: string,
  columns: DataColumnMeta[],
): string[] {
  const separators = ['/', ' vs ', ' vs. ', ' / ', '_vs_', '-vs-'];
  const columnKeys = columns.map(col => col.key);

  for (const separator of separators) {
    if (ratioColumnKey.includes(separator)) {
      const parts = ratioColumnKey.split(separator);
      if (parts.length === 2) {
        const [part1, part2] = parts.map(part => part.trim());
        const match1 = columnKeys.find(key =>
          key.toLowerCase().includes(part1.toLowerCase()),
        );
        const match2 = columnKeys.find(key =>
          key.toLowerCase().includes(part2.toLowerCase()),
        );

        if (match1 && match2) {
          return [match1, match2];
        }
      }
    }
  }

  return [];
}

function calculateRatioAggregate(
  columnKey: string,
  data: DataRecord[],
  columns: DataColumnMeta[],
): number {
  const componentColumns = findComponentColumns(columnKey, columns);

  if (componentColumns.length === 2) {
    const [numeratorKey, denominatorKey] = componentColumns;

    const numeratorSum = data.reduce(
      (sum, row) => sum + (Number(row[numeratorKey]) || 0),
      0,
    );

    const denominatorSum = data.reduce(
      (sum, row) => sum + (Number(row[denominatorKey]) || 0),
      0,
    );

    return denominatorSum === 0 ? 0 : numeratorSum / denominatorSum;
  }

  const values = data.map(row => Number(row[columnKey]) || 0);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Build a Top N slice of the provided dataset.
 * The implementation mirrors the original transform-layer logic to keep
 * behavior consistent between server-provided defaults and client overrides.
 */
export function processTopData(
  data: DataRecord[],
  columns: DataColumnMeta[],
  topMetric: string,
  topCount: number,
): DataRecord[] {
  if (!data?.length || !topMetric || topCount === 0) {
    return data;
  }

  if (data.length <= topCount) {
    return data;
  }

  const sortedData = [...data].sort((a, b) => {
    const aVal = Number(a[topMetric]) || 0;
    const bVal = Number(b[topMetric]) || 0;
    return bVal - aVal;
  });

  const topRows = sortedData.slice(0, topCount);
  const remainingRows = sortedData.slice(topCount);

  if (remainingRows.length === 0) {
    return topRows;
  }

  const othersRow: DataRecord = {};

  columns.forEach(column => {
    const { key, isMetric, isNumeric } = column;

    if (key === '#') {
      return;
    }

    const remainingValues = remainingRows
      .map(row => row[key])
      .filter(val => val !== null && val !== undefined);

    if (remainingValues.length === 0) {
      othersRow[key] = null;
      return;
    }

    if (!isMetric && !isNumeric) {
      othersRow[key] = 'OTROS';
      return;
    }

    const isLikelyRatio = isRatioMetric(key, remainingRows);

    if (isLikelyRatio) {
      othersRow[key] = calculateRatioAggregate(key, remainingRows, columns);
    } else {
      othersRow[key] = remainingValues.reduce((sum: number, val) => {
        const numericValue = Number(val) || 0;
        return sum + numericValue;
      }, 0);
    }
  });

  return [...topRows, othersRow];
}
