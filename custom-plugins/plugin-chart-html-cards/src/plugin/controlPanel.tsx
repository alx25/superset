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
  ControlPanelConfig,
  Dataset,
  getStandardizedControls,
} from '@superset-ui/chart-controls';
import { GenericDataType, t } from '@superset-ui/core';
import { allColumnsControlSetItem } from './controls/columns';
import { groupByControlSetItem } from './controls/groupBy';
import { handlebarsTemplateControlSetItem } from './controls/handlebarTemplate';
import { includeTimeControlSetItem } from './controls/includeTime';
import {
  rowLimitControlSetItem,
  timeSeriesLimitMetricControlSetItem,
} from './controls/limits';
import {
  metricsControlSetItem,
  percentMetricsControlSetItem,
  showTotalsControlSetItem,
} from './controls/metrics';
import {
  orderByControlSetItem,
  orderDescendingControlSetItem,
} from './controls/orderBy';
import { queryModeControlSetItem } from './controls/queryMode';
import { styleControlSetItem } from './controls/style';
import { HtmlCardsQueryFormData } from '../types';
import { getSelectedColumns } from '../utils/templateContext';

const DISPLAY_NAME_ONLY_COLUMN_CONFIG_LAYOUT = {
  [GenericDataType.Numeric]: [['displayName']],
  [GenericDataType.String]: [['displayName']],
  [GenericDataType.Temporal]: [['displayName']],
  [GenericDataType.Boolean]: [['displayName']],
};

export function getColumnConfigColumns(explore: any) {
  const datasource = explore?.datasource as Dataset | undefined;
  const controls = explore?.controls ?? {};
  const formData = {
    ...explore?.form_data,
    query_mode:
      controls?.query_mode?.value ?? explore?.form_data?.query_mode ?? null,
    queryMode:
      controls?.query_mode?.value ?? explore?.form_data?.queryMode ?? null,
    groupby: controls?.groupby?.value ?? explore?.form_data?.groupby,
    metrics: controls?.metrics?.value ?? explore?.form_data?.metrics,
    percent_metrics:
      controls?.percent_metrics?.value ?? explore?.form_data?.percent_metrics,
    percentMetrics:
      controls?.percent_metrics?.value ?? explore?.form_data?.percentMetrics,
    all_columns:
      controls?.all_columns?.value ?? explore?.form_data?.all_columns,
    allColumns: controls?.all_columns?.value ?? explore?.form_data?.allColumns,
  } as HtmlCardsQueryFormData;

  const selectedColumns = getSelectedColumns(formData, datasource as any);
  return {
    colnames: selectedColumns.map(column => column.key),
    coltypes: selectedColumns.map(column => column.type),
  };
}

const config: ControlPanelConfig = {
  controlPanelSections: [
    {
      label: t('Query'),
      expanded: true,
      controlSetRows: [
        [queryModeControlSetItem],
        [groupByControlSetItem],
        [metricsControlSetItem, allColumnsControlSetItem],
        [percentMetricsControlSetItem],
        [timeSeriesLimitMetricControlSetItem, orderByControlSetItem],
        [orderDescendingControlSetItem],
        [rowLimitControlSetItem],
        [includeTimeControlSetItem],
        [showTotalsControlSetItem],
        ['adhoc_filters'],
      ],
    },
    {
      label: t('Cards'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'column_config',
            config: {
              type: 'ColumnConfigControl',
              label: t('Customize columns'),
              description: t(
                'Set a display name for each selected column or metric so templates can use stable aliases.',
              ),
              width: 400,
              height: 320,
              renderTrigger: true,
              configFormLayout: DISPLAY_NAME_ONLY_COLUMN_CONFIG_LAYOUT,
              shouldMapStateToProps() {
                return true;
              },
              mapStateToProps(explore) {
                return {
                  columnsPropsObject: getColumnConfigColumns(explore),
                };
              },
            },
          },
        ],
        [handlebarsTemplateControlSetItem],
        [styleControlSetItem],
      ],
    },
  ],
  formDataOverrides: formData => ({
    ...formData,
    groupby: getStandardizedControls().popAllColumns(),
    metrics: getStandardizedControls().popAllMetrics(),
  }),
};

export default config;
