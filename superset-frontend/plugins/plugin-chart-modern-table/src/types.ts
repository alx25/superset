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
  ChartProps,
  DataRecord,
  GenericDataType,
  QueryFormData,
  SetDataMaskHook,
  QueryMode,
} from '@superset-ui/core';

export interface DataColumnMeta {
  key: string;
  label: string;
  dataType: GenericDataType;
  isNumeric: boolean;
  isDatetime: boolean;
  config: Record<string, any>;
}

export interface ModernTableChartFormData extends QueryFormData {
  query_mode?: QueryMode;
  groupby?: any[];
  metrics?: any[];
  all_columns?: any[];
  column_templates?: Record<string, string>;
  row_limit?: number;
  table_timestamp_format?: string;
  page_size?: number;
  enable_search?: boolean;
  enable_sorting?: boolean;
  enable_pagination?: boolean;
  striped_rows?: boolean;
  show_row_numbers?: boolean;
}

export interface ModernTableChartProps extends ChartProps {
  formData: ModernTableChartFormData;
}

export interface ModernTableChartTransformedProps {
  data: DataRecord[];
  columns: DataColumnMeta[];
  height: number;
  width: number;
  serverPaginationData: {
    loading: boolean;
    totalCount: number;
  };
  isRawRecords: boolean;
  columnTemplates: Record<string, string>;
  ownCurrentState?: any;
  setDataMask: SetDataMaskHook;
  showRowNumbers: boolean;
  pageSize?: number;
  enableSearch?: boolean;
  enableSorting?: boolean;
  enablePagination?: boolean;
  stripedRows?: boolean;
}
