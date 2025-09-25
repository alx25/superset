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
import { QueryMode, t } from '@superset-ui/core';
import {
  ControlPanelConfig,
  ControlStateMapping,
  sharedControls,
} from '@superset-ui/chart-controls';

function getQueryMode(controls: ControlStateMapping): QueryMode {
  const mode = controls?.query_mode?.value;
  if (mode === QueryMode.Aggregate || mode === QueryMode.Raw) {
    return mode as QueryMode;
  }
  const rawColumns = controls?.all_columns?.value;
  const hasRawColumns = Array.isArray(rawColumns) && rawColumns.length > 0;
  return hasRawColumns ? QueryMode.Raw : QueryMode.Aggregate;
}

const controlPanel: ControlPanelConfig = {
  controlPanelSections: [
    {
      label: t('Query'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'query_mode',
            config: {
              type: 'RadioButtonControl',
              label: t('Query mode'),
              default: null,
              options: [
                [QueryMode.Aggregate, t('Aggregate')],
                [QueryMode.Raw, t('Raw records')],
              ],
              mapStateToProps: ({ controls }) => ({
                value: getQueryMode(controls),
              }),
              rerender: ['all_columns', 'groupby', 'metrics'],
            },
          },
        ],
        ['groupby'],
        ['metrics'],
        [
          {
            name: 'all_columns',
            config: {
              ...sharedControls.groupby,
              label: t('Columns'),
              description: t('Columns to display'),
              multi: true,
              freeForm: true,
              commaChoosesOption: false,
              optionRenderer: (c: any) => <>{c.column_name}</>,
              valueRenderer: (c: any) => <>{c.column_name}</>,
              valueKey: 'column_name',
              allowAll: true,
              filterOption: ({ data: opt }: any, text: string) =>
                opt?.column_name &&
                opt.column_name.toLowerCase().includes(text.toLowerCase()),
              promptTextCreator: (label: any) => label,
              visibility: ({ controls }: any) =>
                getQueryMode(controls) === QueryMode.Raw,
            },
          },
        ],
        [
          {
            name: 'row_limit',
            config: {
              ...sharedControls.row_limit,
              default: 1000,
            },
          },
        ],
        ['adhoc_filters'],
      ],
    },
    {
      label: t('Options'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'page_size',
            config: {
              type: 'SelectControl',
              label: t('Page size'),
              description: t('Number of rows per page'),
              choices: [
                [10, '10'],
                [25, '25'],
                [50, '50'],
                [100, '100'],
                [200, '200'],
              ],
              default: 25,
            },
          },
        ],
        [
          {
            name: 'enable_search',
            config: {
              type: 'CheckboxControl',
              label: t('Enable search'),
              description: t('Show search box to filter table data'),
              default: true,
            },
          },
          {
            name: 'enable_sorting',
            config: {
              type: 'CheckboxControl',
              label: t('Enable sorting'),
              description: t('Allow sorting by clicking column headers'),
              default: true,
            },
          },
        ],
        [
          {
            name: 'enable_pagination',
            config: {
              type: 'CheckboxControl',
              label: t('Enable pagination'),
              description: t('Show pagination controls'),
              default: true,
            },
          },
          {
            name: 'striped_rows',
            config: {
              type: 'CheckboxControl',
              label: t('Striped rows'),
              description: t('Alternate row background colors'),
              default: true,
            },
          },
        ],
        [
          {
            name: 'show_row_numbers',
            config: {
              type: 'CheckboxControl',
              label: t('Show row numbers'),
              description: t('Display row numbers in first column'),
              default: false,
            },
          },
        ],
      ],
    },
  ],
  controlOverrides: {
    metrics: {
      validators: [],
    },
  },
  formDataOverrides: formData => ({
    ...formData,
    query_mode: getQueryMode(formData as any),
  }),
};

export default controlPanel;
