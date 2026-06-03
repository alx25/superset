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
  DataRecord,
  Datasource,
  ensureIsArray,
  GenericDataType,
  getColumnLabel,
  getMetricLabel,
  QueryMode,
  QueryFormColumn,
  QueryFormMetric,
} from '@superset-ui/core';
import { snakeCase } from 'lodash';
import {
  HtmlCardsColumnConfig,
  HtmlCardsQueryFormData,
  HtmlCardsTemplateColumn,
  HtmlCardsTemplateLayout,
} from '../types';

type SelectedColumn = {
  key: string;
  type: GenericDataType;
  isMetric: boolean;
  isPercentMetric: boolean;
};

type BuildTemplateContextArgs = {
  colnames?: string[];
  coltypes?: GenericDataType[];
  data: DataRecord[];
  datasource?: Datasource;
  formData: HtmlCardsQueryFormData;
  height: number;
  width: number;
};

type HtmlCardsTemplateContext = {
  columns: HtmlCardsTemplateColumn[];
  displayRows: DataRecord[];
  firstDisplayRow: DataRecord | null;
  layout: HtmlCardsTemplateLayout;
};

function getDatasourceType(
  datasource: Datasource | undefined,
  columnName: string,
): GenericDataType {
  const columns = ensureIsArray((datasource?.columns ?? []) as any[]);
  const matchingColumn = columns.find(
    column =>
      column?.columnName === columnName || column?.column_name === columnName,
  );
  const rawType = matchingColumn?.typeGeneric ?? matchingColumn?.type_generic;
  return typeof rawType === 'number' ? rawType : GenericDataType.String;
}

function pushSelectedColumn(
  target: SelectedColumn[],
  seen: Set<string>,
  key: string,
  type: GenericDataType,
  options?: Partial<Pick<SelectedColumn, 'isMetric' | 'isPercentMetric'>>,
) {
  const cleanKey = String(key || '').trim();
  if (!cleanKey || seen.has(cleanKey)) {
    return;
  }
  seen.add(cleanKey);
  target.push({
    key: cleanKey,
    type,
    isMetric: Boolean(options?.isMetric),
    isPercentMetric: Boolean(options?.isPercentMetric),
  });
}

export function getSelectedColumns(
  formData: HtmlCardsQueryFormData,
  datasource?: Datasource,
) {
  const selectedColumns: SelectedColumn[] = [];
  const seen = new Set<string>();
  const queryMode = formData.queryMode ?? formData.query_mode;

  if (queryMode === QueryMode.Raw) {
    ensureIsArray(formData.allColumns ?? formData.all_columns).forEach(
      (column: QueryFormColumn) => {
        const key = getColumnLabel(column);
        if (key) {
          pushSelectedColumn(
            selectedColumns,
            seen,
            key,
            getDatasourceType(datasource, key),
          );
        }
      },
    );
    return selectedColumns;
  }

  ensureIsArray(formData.groupby).forEach((column: QueryFormColumn) => {
    const key = getColumnLabel(column);
    if (key) {
      pushSelectedColumn(
        selectedColumns,
        seen,
        key,
        getDatasourceType(datasource, key),
      );
    }
  });

  ensureIsArray(formData.metrics).forEach((metric: QueryFormMetric) => {
    const key = String(getMetricLabel(metric) || '').trim();
    if (key) {
      pushSelectedColumn(selectedColumns, seen, key, GenericDataType.Numeric, {
        isMetric: true,
      });
    }
  });

  ensureIsArray(formData.percentMetrics ?? formData.percent_metrics).forEach(
    (metric: QueryFormMetric) => {
      const key = String(getMetricLabel(metric) || '').trim();
      if (key) {
        pushSelectedColumn(selectedColumns, seen, key, GenericDataType.Numeric, {
          isMetric: true,
          isPercentMetric: true,
        });
      }
    },
  );

  return selectedColumns;
}

function findSelectedColumn(
  columnName: string,
  selectedColumns: SelectedColumn[],
): SelectedColumn | undefined {
  const directMatch = selectedColumns.find(column => column.key === columnName);
  if (directMatch) {
    return directMatch;
  }

  const prefixedMetricMatches = selectedColumns
    .filter(
      column =>
        column.isMetric &&
        (columnName.startsWith(`${column.key}_`) ||
          columnName === `%${column.key}` ||
          columnName.startsWith(`%${column.key}_`)),
    )
    .sort((a, b) => b.key.length - a.key.length);

  return prefixedMetricMatches[0];
}

function findColumnConfig(
  columnName: string,
  columnConfig: Record<string, HtmlCardsColumnConfig>,
  selectedColumn?: SelectedColumn,
) {
  if (columnConfig[columnName]) {
    return columnConfig[columnName];
  }

  if (selectedColumn?.key && columnConfig[selectedColumn.key]) {
    return columnConfig[selectedColumn.key];
  }

  const matchingConfigKey = Object.keys(columnConfig)
    .filter(
      key =>
        key &&
        (columnName.startsWith(`${key}_`) ||
          columnName === `%${key}` ||
          columnName.startsWith(`%${key}_`)),
    )
    .sort((a, b) => b.length - a.length)[0];

  return matchingConfigKey ? columnConfig[matchingConfigKey] : undefined;
}

function toTemplateKey(
  label: string,
  fallback: string,
  usedKeys: Set<string>,
): string {
  const base =
    snakeCase(String(label || '').trim()) ||
    snakeCase(String(fallback || '').trim()) ||
    'field';

  let templateKey = base;
  let suffix = 2;
  while (usedKeys.has(templateKey)) {
    templateKey = `${base}_${suffix}`;
    suffix += 1;
  }
  usedKeys.add(templateKey);
  return templateKey;
}

export function buildTemplateContext({
  colnames,
  coltypes,
  data,
  datasource,
  formData,
  height,
  width,
}: BuildTemplateContextArgs): HtmlCardsTemplateContext {
  const records = ensureIsArray(data);
  const selectedColumns = getSelectedColumns(formData, datasource);
  const resolvedColnames =
    colnames && colnames.length
      ? colnames
      : records[0]
        ? Object.keys(records[0])
        : selectedColumns.map(column => column.key);
  const rawColumnConfig = (formData.columnConfig ??
    formData.column_config ??
    {}) as Record<string, HtmlCardsColumnConfig>;
  const usedTemplateKeys = new Set<string>();

  const columns = resolvedColnames.map((columnName, index) => {
    const selectedColumn = findSelectedColumn(columnName, selectedColumns);
    const columnType =
      coltypes?.[index] ??
      selectedColumn?.type ??
      getDatasourceType(datasource, columnName);
    const config = findColumnConfig(columnName, rawColumnConfig, selectedColumn);
    const displayName =
      String(config?.displayName || '').trim() ||
      selectedColumn?.key ||
      datasource?.verboseMap?.[columnName] ||
      columnName;

    return {
      key: columnName,
      displayName,
      templateKey: toTemplateKey(displayName, columnName, usedTemplateKeys),
      type: columnType,
      isMetric: selectedColumn?.isMetric ?? columnType === GenericDataType.Numeric,
      isPercentMetric: Boolean(selectedColumn?.isPercentMetric),
    } as HtmlCardsTemplateColumn;
  });

  const displayRows = records.map(record =>
    columns.reduce<DataRecord>((acc, column) => {
      acc[column.templateKey] = record?.[column.key];
      return acc;
    }, {} as DataRecord),
  );

  return {
    columns,
    displayRows,
    firstDisplayRow: displayRows[0] ?? null,
    layout: {
      width,
      height,
      isNarrow: width < 900,
      isTiny: width < 560,
      isShort: height < 420,
      isCompact: width < 900 || height < 420,
    },
  };
}
