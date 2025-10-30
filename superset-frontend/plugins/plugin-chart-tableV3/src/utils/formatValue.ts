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

function getNestedValue(row: DataRecord, path: string) {
  return path
    .split('.')
    .reduce<any>((acc, key) => (acc == null ? undefined : acc?.[key]), row);
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
  return template.replace(TEMPLATE_VARIABLE_REGEX, (_, rawKey: string) => {
    const key = rawKey.trim();
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
    return nested == null ? '' : String(nested);
  });
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
