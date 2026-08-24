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
import { QueryMode } from '@superset-ui/core';
import { HtmlCardsQueryFormData } from '../../src/types';
import buildQuery from '../../src/plugin/buildQuery';

describe('HTML Cards buildQuery', () => {
  const formData: HtmlCardsQueryFormData = {
    datasource: '5__table',
    granularitySqla: 'ds',
    groupby: ['foo'],
    viz_type: 'my_chart',
    width: 500,
    height: 500,
  };

  it('should build groupby with series in form data', () => {
    const queryContext = buildQuery(formData);
    const [query] = queryContext.queries;
    expect(query.columns).toEqual(['foo']);
  });

  it('drops a stale groupby in Raw records mode, even with an adhoc-column entry', () => {
    const rawFormData: HtmlCardsQueryFormData = {
      ...formData,
      query_mode: QueryMode.Raw,
      groupby: [
        {
          expressionType: 'SQL',
          label: 'num_semana',
          sqlExpression: 'COALESCE(ss, ss_orden)',
        } as any,
        'signing_desc',
      ],
      all_columns: ['signing_desc', 'desc_irex'],
    };

    const queryContext = buildQuery(rawFormData);
    const [query] = queryContext.queries;
    expect(query.columns).toEqual(['signing_desc', 'desc_irex']);
  });
});
