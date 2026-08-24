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
  buildQueryContext,
  normalizeOrderBy,
  QueryFormData,
  QueryMode,
} from '@superset-ui/core';

export default function buildQuery(formData: QueryFormData) {
  // `groupby` belongs to Aggregate mode only. In Raw records mode it's
  // unused (getSelectedColumns reads `all_columns` instead — see
  // utils/templateContext.ts), but a chart saved while in Aggregate mode
  // and later switched to Raw keeps its stale `groupby` in the saved
  // params. Sending that stale value to the backend regardless of mode
  // can crash Superset's core query builder when a groupby entry is an
  // adhoc/calculated column (a plain object) instead of a column name,
  // since that code path only expects raw filter/groupby column names.
  // Dropping it here for Raw mode is safe (it's dead data either way)
  // and prevents that crash regardless of what's stored in the DB.
  const queryMode =
    (formData as { query_mode?: QueryMode; queryMode?: QueryMode })
      .query_mode ??
    (formData as { query_mode?: QueryMode; queryMode?: QueryMode })
      .queryMode;
  const sanitizedFormData =
    queryMode === QueryMode.Raw ? { ...formData, groupby: [] } : formData;

  return buildQueryContext(sanitizedFormData, baseQueryObject => [
    {
      ...baseQueryObject,
      orderby: normalizeOrderBy(baseQueryObject).orderby,
    },
  ]);
}
