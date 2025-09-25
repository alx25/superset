/* eslint-disable camelcase */
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
  GenericDataType,
  QueryMode,
  SetDataMaskHook,
} from '@superset-ui/core';
import {
  ModernTableChartProps,
  ModernTableChartTransformedProps,
  DataColumnMeta,
} from './types';

function transformColumn(
  key: string,
  colnames: string[],
  coltypes: GenericDataType[],
): DataColumnMeta {
  const index = colnames.indexOf(key);
  const dataType = coltypes?.[index] || GenericDataType.String;

  return {
    key,
    label: key,
    dataType,
    isNumeric: dataType === (GenericDataType.Numeric as any),
    isDatetime: dataType === GenericDataType.Temporal,
    config: {},
  };
}

export default function transformProps(
  chartProps: ModernTableChartProps,
): ModernTableChartTransformedProps {
  const { formData, queriesData, height, width } = chartProps;

  const {
    data: records = [],
    colnames = [],
    coltypes = [],
  } = queriesData?.[0] || {};

  const data = records as DataRecord[];

  return {
    data,
    height,
    width,
    columns: colnames.map((key: string) =>
      transformColumn(key, colnames, coltypes as GenericDataType[]),
    ),
    serverPaginationData: { loading: false, totalCount: data.length },
    isRawRecords: formData.query_mode === QueryMode.Raw,
    columnTemplates: formData.column_templates || {},
    ownCurrentState: undefined,
    setDataMask: (() => {}) as SetDataMaskHook,
    showRowNumbers: formData.show_row_numbers ?? false,
    pageSize: formData.page_size ?? 25,
    enableSearch: formData.enable_search ?? true,
    enableSorting: formData.enable_sorting ?? true,
    enablePagination: formData.enable_pagination ?? true,
    stripedRows: formData.striped_rows ?? true,
  };
}
