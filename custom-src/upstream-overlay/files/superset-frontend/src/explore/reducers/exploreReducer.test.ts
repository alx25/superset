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

import exploreReducer, { ExploreState } from './exploreReducer';
import { setControlValue, setStashFormData } from '../actions/exploreActions';
import { QueryFormData } from '@superset-ui/core';

test('reset hiddenFormData on SET_STASH_FORM_DATA', () => {
  const initialState: ExploreState = {
    form_data: { a: 3, c: 4 } as unknown as QueryFormData,
    controls: {},
  };
  const action = setStashFormData(true, ['a', 'c']) as Parameters<
    typeof exploreReducer
  >[1];
  const newState = exploreReducer(initialState, action);
  expect(newState.form_data).toEqual({});
  expect(newState.hiddenFormData).toEqual({ a: 3, c: 4 });
  const restoreAction = setStashFormData(false, ['c']) as Parameters<
    typeof exploreReducer
  >[1];
  const newState2 = exploreReducer(newState, restoreAction);
  expect(newState2.form_data).toEqual({ c: 4 });
  expect(newState2.hiddenFormData).toEqual({ a: 3 });
});

test('skips updates when the field is already updated on SET_STASH_FORM_DATA', () => {
  const initialState: ExploreState = {
    form_data: { a: 3, c: 4 } as unknown as QueryFormData,
    hiddenFormData: { b: 2 } as unknown as Partial<QueryFormData>,
    controls: {},
  };
  const restoreAction = setStashFormData(false, ['c', 'd']) as Parameters<
    typeof exploreReducer
  >[1];
  const newState = exploreReducer(initialState, restoreAction);
  expect(newState).toBe(initialState);
});

test('keeps column_order in sync when calculated columns change labels', () => {
  const initialState = {
    form_data: {
      viz_type: 'table',
      calculated_columns: [
        {
          key: 'calc_ratio',
          label: 'ratio',
          expression: '{{sum__num}} / {{sum__denom}}',
        },
      ],
      column_order: ['sum__num', 'ratio', 'name'],
      column_config: {
        ratio: {
          displayName: 'Ratio visible',
        },
      },
    },
    controls: {
      viz_type: { value: 'table' },
      calculated_columns: {
        value: [
          {
            key: 'calc_ratio',
            label: 'ratio',
            expression: '{{sum__num}} / {{sum__denom}}',
          },
        ],
        rerender: ['column_config', 'column_order'],
        renderTrigger: true,
      },
      column_order: {
        value: ['sum__num', 'ratio', 'name'],
        mapStateToProps: (state: any) => ({
          options: [
            { value: 'sum__num', label: 'sum__num' },
            ...(state.controls?.calculated_columns?.value ?? []).map(
              (item: any) => ({ value: item.label, label: item.label }),
            ),
            { value: 'name', label: 'name' },
          ],
        }),
      },
      column_config: {
        value: {
          ratio: {
            displayName: 'Ratio visible',
          },
        },
      },
    },
  } as unknown as ExploreState;

  const newState = exploreReducer(
    initialState,
    setControlValue('calculated_columns', [
      {
        key: 'calc_ratio',
        label: 'ratio nuevo',
        expression: '{{sum__num}} / {{sum__denom}}',
      },
    ]) as Parameters<typeof exploreReducer>[1],
  );

  expect((newState.form_data as any).column_order).toEqual([
    'sum__num',
    'ratio nuevo',
    'name',
  ]);
  expect((newState.controls.column_order as any).value).toEqual([
    'sum__num',
    'ratio nuevo',
    'name',
  ]);
  expect((newState.form_data as any).column_config).toEqual({
    'ratio nuevo': {
      displayName: 'Ratio visible',
    },
  });
});

test('deduplicates column_order when a calculated column rename collides with an existing entry', () => {
  const initialState = {
    form_data: {
      viz_type: 'table',
      calculated_columns: [
        {
          key: 'calc_ratio',
          label: 'ratio',
          expression: '{{sum__num}} / {{sum__denom}}',
        },
      ],
      column_order: ['sum__num', 'ratio', 'ratio nuevo', 'name'],
      column_config: {},
    },
    controls: {
      viz_type: { value: 'table' },
      calculated_columns: {
        value: [
          {
            key: 'calc_ratio',
            label: 'ratio',
            expression: '{{sum__num}} / {{sum__denom}}',
          },
        ],
        rerender: ['column_config', 'column_order'],
        renderTrigger: true,
      },
      column_order: {
        value: ['sum__num', 'ratio', 'ratio nuevo', 'name'],
        mapStateToProps: (state: any) => ({
          options: [
            { value: 'sum__num', label: 'sum__num' },
            ...(state.controls?.calculated_columns?.value ?? []).map(
              (item: any) => ({ value: item.label, label: item.label }),
            ),
            { value: 'name', label: 'name' },
          ],
        }),
      },
      column_config: { value: {} },
    },
  } as unknown as ExploreState;

  const newState = exploreReducer(
    initialState,
    setControlValue('calculated_columns', [
      {
        key: 'calc_ratio',
        label: 'ratio nuevo',
        expression: '{{sum__num}} / {{sum__denom}}',
      },
    ]) as Parameters<typeof exploreReducer>[1],
  );

  expect((newState.form_data as any).column_order).toEqual([
    'sum__num',
    'ratio nuevo',
    'name',
  ]);
  expect((newState.controls.column_order as any).value).toEqual([
    'sum__num',
    'ratio nuevo',
    'name',
  ]);
});
