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
  GenericDataType,
  supersetTheme,
  VizType,
} from '@superset-ui/core';
import { HtmlCardsQueryFormData } from '../../src/types';
import transformProps from '../../src/plugin/transformProps';

describe('HTML Cards transformProps', () => {
  const formData: HtmlCardsQueryFormData = {
    colorScheme: 'bnbColors',
    datasource: '3__table',
    granularitySqla: 'ds',
    metric: 'sum__num',
    groupby: ['name'],
    metrics: ['titulo'],
    column_config: {
      titulo: {
        displayName: 'Valor actual',
      },
    },
    width: 500,
    height: 500,
    viz_type: VizType.HtmlCards,
  };
  const data = [
    { name: 'Hulk', titulo_9fef7d: 1, __timestamp: 599616000000 },
  ];
  const chartProps = new ChartProps<HtmlCardsQueryFormData>({
    datasource: {
      columns: [
        { column_name: 'name', type_generic: GenericDataType.String },
      ],
      verbose_map: {
        name: 'Nombre',
      },
    },
    formData,
    width: 800,
    height: 600,
    queriesData: [
      {
        data,
        colnames: ['name', 'titulo_9fef7d'],
        coltypes: [GenericDataType.String, GenericDataType.Numeric],
      },
    ],
    theme: supersetTheme,
  });

  it('should transform chart props for viz', () => {
    expect(transformProps(chartProps)).toEqual(
      expect.objectContaining({
        width: 800,
        height: 600,
        data,
        columns: [
          expect.objectContaining({
            key: 'name',
            displayName: 'name',
            templateKey: 'name',
          }),
          expect.objectContaining({
            key: 'titulo_9fef7d',
            displayName: 'Valor actual',
            templateKey: 'valor_actual',
            isMetric: true,
          }),
        ],
        displayRows: [{ name: 'Hulk', valor_actual: 1 }],
        firstDisplayRow: { name: 'Hulk', valor_actual: 1 },
        layout: expect.objectContaining({
          isCompact: true,
          isNarrow: true,
          isShort: false,
          isTiny: false,
          width: 800,
          height: 600,
        }),
      }),
    );
  });
});
