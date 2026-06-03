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
  AdhocColumn,
  buildQueryContext,
  ensureIsArray,
  getMetricLabel,
  isPhysicalColumn,
  QueryFormColumn,
  QueryFormOrderBy,
  removeDuplicates,
} from '@superset-ui/core';
import { PivotTableQueryFormData } from '../types';

// Matches scoped references: total.{{X}}, row.{{X}}, col.{{X}}, previous.{{X}}, next.{{X}}
const SCOPED_REF_PATTERN = /\b(?:total|row|col|previous|next)\.\{\{/;

export default function buildQuery(formData: PivotTableQueryFormData) {
  const { groupbyColumns = [], groupbyRows = [], extra_form_data } = formData;
  const jinjaFields = ensureIsArray(
    (formData as any).jinjaFields || (formData as any).jinja_fields,
  );
  const time_grain_sqla =
    extra_form_data?.time_grain_sqla || formData.time_grain_sqla;

  // Formula metrics visible in the table that can be computed on flat data for export.
  // Scoped formulas (total./row./col./previous./next.) are excluded since they depend
  // on the pivot structure and cannot be resolved on the flat DB result.
  const rawFormulas = ensureIsArray((formData as any).metricFormulas);
  const exportableFormulas = rawFormulas
    .filter(
      (f: any) =>
        f &&
        !f.hidden &&
        typeof f.label === 'string' &&
        f.label.trim() &&
        typeof f.expression === 'string' &&
        f.expression.trim() &&
        !SCOPED_REF_PATTERN.test(f.expression),
    )
    .map((f: any) => ({ label: f.label.trim(), expression: f.expression.trim() }));

  // Jinja fields are auxiliary metrics sent to the DB but should not appear in exports.
  const jinjaFieldLabels = jinjaFields.map((m: any) =>
    typeof m === 'string' ? m : (m?.label ?? ''),
  ).filter(Boolean) as string[];

  // TODO: add deduping of AdhocColumns
  const columns = Array.from(
    new Set([
      ...ensureIsArray<QueryFormColumn>(groupbyColumns),
      ...ensureIsArray<QueryFormColumn>(groupbyRows),
    ]),
  ).map(col => {
    if (
      isPhysicalColumn(col) &&
      time_grain_sqla &&
      (formData?.temporal_columns_lookup?.[col] ||
        formData.granularity_sqla === col)
    ) {
      return {
        timeGrain: time_grain_sqla,
        columnType: 'BASE_AXIS',
        sqlExpression: col,
        label: col,
        expressionType: 'SQL',
      } as AdhocColumn;
    }
    return col;
  });

  return buildQueryContext(formData, baseQueryObject => {
    const { series_limit_metric, metrics: baseMetrics, order_desc } =
      baseQueryObject;
    let orderBy: QueryFormOrderBy[] | undefined;
    let metrics = baseMetrics || [];
    if (jinjaFields.length > 0) {
      metrics = removeDuplicates(metrics.concat(jinjaFields), getMetricLabel);
    }
    if (series_limit_metric) {
      orderBy = [[series_limit_metric, !order_desc]];
    } else if (Array.isArray(metrics) && metrics[0]) {
      orderBy = [[metrics[0], !order_desc]];
    }
    const extraOverrides: Record<string, any> = {};
    if (exportableFormulas.length > 0) {
      extraOverrides.calculated_columns_export = exportableFormulas;
    }
    if (jinjaFieldLabels.length > 0) {
      extraOverrides.excluded_columns = jinjaFieldLabels;
    }

    return [
      {
        ...baseQueryObject,
        metrics,
        orderby: orderBy,
        columns,
        extras: {
          ...baseQueryObject.extras,
          ...extraOverrides,
        },
      },
    ];
  });
}
