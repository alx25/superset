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
import { getColumnConfigColumns } from '../../src/plugin/controlPanel';

describe('HTML Cards controlPanel', () => {
  it('builds logical column config options from selected fields', () => {
    expect(
      getColumnConfigColumns({
        controls: {
          query_mode: { value: 'aggregate' },
          groupby: { value: ['area_comercial_nombre'] },
          metrics: { value: [{ label: 'titulo' }, { label: 'meta' }] },
        },
        form_data: {},
        datasource: {
          columns: [
            {
              column_name: 'area_comercial_nombre',
              type_generic: GenericDataType.String,
            },
          ],
        },
      }),
    ).toEqual({
      colnames: ['area_comercial_nombre', 'titulo', 'meta'],
      coltypes: [
        GenericDataType.String,
        GenericDataType.Numeric,
        GenericDataType.Numeric,
      ],
    });
  });

  it('uses raw mode columns for display name configuration', () => {
    expect(
      getColumnConfigColumns({
        controls: {
          query_mode: { value: 'raw' },
          all_columns: { value: ['cliente', 'segmento'] },
        },
        form_data: {},
        datasource: {
          columns: [
            { column_name: 'cliente', type_generic: GenericDataType.String },
            { column_name: 'segmento', type_generic: GenericDataType.String },
          ],
        },
      }),
    ).toEqual({
      colnames: ['cliente', 'segmento'],
      coltypes: [GenericDataType.String, GenericDataType.String],
    });
  });
});
