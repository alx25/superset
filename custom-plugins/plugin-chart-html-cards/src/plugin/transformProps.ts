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
import { ChartProps, DataRecord } from '@superset-ui/core';
import { HtmlCardsQueryFormData } from '../types';
import { buildTemplateContext } from '../utils/templateContext';

export default function transformProps(
  chartProps: ChartProps<HtmlCardsQueryFormData>,
) {
  const { width, height, datasource, rawFormData, queriesData } = chartProps;
  const data = queriesData[0].data as DataRecord[];
  const { columns, displayRows, firstDisplayRow, layout } =
    buildTemplateContext({
      colnames: queriesData[0]?.colnames,
      coltypes: queriesData[0]?.coltypes,
      data,
      datasource,
      formData: rawFormData,
      height,
      width,
    });

  return {
    columns,
    displayRows,
    firstDisplayRow,
    width,
    height,
    data,
    formData: rawFormData,
    layout,
  };
}
