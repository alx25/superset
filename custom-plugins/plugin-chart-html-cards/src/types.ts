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
  QueryFormColumn,
  QueryFormData,
  QueryFormMetric,
  QueryMode,
  TimeGranularity,
} from '@superset-ui/core';

export interface HtmlCardsStylesProps {
  height: number;
  width: number;
}

export interface HtmlCardsColumnConfig {
  displayName?: string;
}

export interface HtmlCardsTemplateColumn {
  key: string;
  displayName: string;
  templateKey: string;
  type?: GenericDataType;
  isMetric: boolean;
  isPercentMetric: boolean;
}

export interface HtmlCardsTemplateLayout {
  width: number;
  height: number;
  isNarrow: boolean;
  isTiny: boolean;
  isShort: boolean;
  isCompact: boolean;
}

export interface HtmlCardsThemeVars {
  colorPrimary: string;
  colorPrimaryBg: string;
  colorBgContainer: string;
  colorBgElevated: string;
  colorBorder: string;
  colorText: string;
  colorTextSecondary: string;
  colorSuccess: string;
  colorWarning: string;
  colorError: string;
  borderRadius: number;
  fontFamily: string;
  fontSize: number;
  fontSizeSM: number;
}

interface HtmlCardsCustomizeProps {
  handlebarsTemplate?: string;
  styleTemplate?: string;
  handlebars_template?: string;
  style_template?: string;
}

export type HtmlCardsQueryFormData = QueryFormData &
  HtmlCardsStylesProps &
  HtmlCardsCustomizeProps & {
    align_pn?: boolean;
    color_pn?: boolean;
    include_time?: boolean;
    include_search?: boolean;
    query_mode?: QueryMode;
    page_length?: string | number | null; // null means auto-paginate
    metrics?: QueryFormMetric[] | null;
    percent_metrics?: QueryFormMetric[] | null;
    columnConfig?: Record<string, HtmlCardsColumnConfig>;
    column_config?: Record<string, HtmlCardsColumnConfig>;
    timeseries_limit_metric?: QueryFormMetric[] | QueryFormMetric | null;
    groupby?: QueryFormMetric[] | null;
    all_columns?: QueryFormColumn[] | null;
    allColumns?: QueryFormColumn[] | null;
    order_desc?: boolean;
    table_timestamp_format?: string;
    granularitySqla?: string;
    queryMode?: QueryMode;
    time_grain_sqla?: TimeGranularity;
  };

export type HtmlCardsProps = HtmlCardsStylesProps &
  HtmlCardsCustomizeProps & {
    columns: HtmlCardsTemplateColumn[];
    data: DataRecord[];
    displayRows: DataRecord[];
    // add typing here for the props you pass in from transformProps.ts!
    firstDisplayRow: DataRecord | null;
    formData: HtmlCardsQueryFormData;
    layout: HtmlCardsTemplateLayout;
    scopeId?: string;
    scopeSelector?: string;
    themeVars?: HtmlCardsThemeVars;
  };

export type HandlebarsStylesProps = HtmlCardsStylesProps;
export type HandlebarsQueryFormData = HtmlCardsQueryFormData;
export type HandlebarsProps = HtmlCardsProps;
