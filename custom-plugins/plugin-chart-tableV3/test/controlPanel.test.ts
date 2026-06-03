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
import { GenericDataType } from '@superset-ui/core';
import { getColumnOrderOptions } from '../src/controlPanel';

describe('plugin-chart-table controlPanel', () => {
  it('excludes jinja fields from column order options, including time comparison variants', () => {
    const options = getColumnOrderOptions(
      {
        controls: {
          query_mode: { value: 'aggregate' },
          groupby: { value: ['name'] },
          metrics: { value: ['sum__num'] },
          time_compare: { value: ['1 year ago'] },
          jinja_fields: { value: ['jinja_metric'] },
          column_config: { value: {} },
          calculated_columns: { value: [] },
        },
        form_data: {},
        datasource: {
          columns: [],
          verbose_map: {},
        },
      },
      {
        queriesResponse: [
          {
            colnames: ['name', 'sum__num', 'jinja_metric'],
            coltypes: [
              GenericDataType.String,
              GenericDataType.Numeric,
              GenericDataType.Numeric,
            ],
            data: [
              {
                name: 'Team A',
                sum__num: 10,
                jinja_metric: 25,
              },
            ],
          },
        ],
      },
    );

    expect(options.map(option => option.value)).toEqual([
      'name',
      'Main sum__num',
      '# sum__num',
      '△ sum__num',
      '% sum__num',
    ]);
  });

  it('shows only columns that are actually visible in the table', () => {
    const options = getColumnOrderOptions(
      {
        controls: {
          query_mode: { value: 'aggregate' },
          groupby: { value: ['name'] },
          metrics: { value: ['sum__num'] },
          percent_metrics: { value: ['pct_nice'] },
          jinja_fields: { value: ['jinja_metric'] },
          column_config: { value: {} },
          calculated_columns: { value: [] },
        },
        form_data: {},
        datasource: {
          columns: [
            { column_name: 'name', type_generic: GenericDataType.String },
            { column_name: 'hidden_dataset_col', type_generic: GenericDataType.String },
          ],
          verbose_map: {},
        },
      },
      {
        queriesResponse: [
          {
            colnames: [
              'name',
              'sum__num',
              '%pct_nice',
              'jinja_metric',
              'helper_metric',
            ],
            coltypes: [
              GenericDataType.String,
              GenericDataType.Numeric,
              GenericDataType.Numeric,
              GenericDataType.Numeric,
              GenericDataType.Numeric,
            ],
            data: [
              {
                name: 'Team A',
                sum__num: 10,
                '%pct_nice': 0.5,
                jinja_metric: 25,
                helper_metric: 99,
              },
            ],
          },
        ],
      },
    );

    expect(options.map(option => option.value)).toEqual([
      'name',
      'sum__num',
      '%pct_nice',
    ]);
  });

  it('falls back to selected fields instead of all dataset columns when there is no query response', () => {
    const options = getColumnOrderOptions({
      controls: {
        query_mode: { value: 'raw' },
        all_columns: { value: ['name'] },
        column_config: { value: {} },
        calculated_columns: { value: [] },
      },
      form_data: {},
      datasource: {
        columns: [
          { column_name: 'name', type_generic: GenericDataType.String },
          { column_name: 'hidden_dataset_col', type_generic: GenericDataType.String },
        ],
        verbose_map: {},
      },
    });

    expect(options.map(option => option.value)).toEqual(['name']);
  });
});
