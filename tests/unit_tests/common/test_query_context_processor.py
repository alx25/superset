# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
from __future__ import annotations

from unittest.mock import Mock

import pandas as pd

from superset.common.chart_data import ChartDataResultFormat, ChartDataResultType
from superset.common.query_context import QueryContext
from superset.utils.core import GenericDataType


def _build_query_context(
    *, form_data: dict | None, verbose_map: dict[str, str] | None
) -> QueryContext:
    datasource = Mock()
    datasource.data = {"verbose_map": verbose_map or {}}
    datasource.cache_timeout = None
    datasource.database = Mock()
    datasource.database.cache_timeout = None

    return QueryContext(
        datasource=datasource,
        queries=[],
        slice_=None,
        form_data=form_data,
        result_type=ChartDataResultType.FULL,
        result_format=ChartDataResultFormat.CSV,
        force=False,
        cache_values={},
    )


def test_get_data_applies_display_name_for_csv_exports() -> None:
    df = pd.DataFrame({"sum__sales": [123], "other": [456]})
    form_data = {
        "column_config": {
            "sum__sales": {"displayName": "Ventas"},
        }
    }
    query_context = _build_query_context(
        form_data=form_data,
        verbose_map={"other": "Other Verbose"},
    )

    result = query_context.get_data(
        df.copy(),
        [GenericDataType.NUMERIC, GenericDataType.NUMERIC],
    )

    header = result.splitlines()[0]
    assert header == "Ventas,Other Verbose"


def test_get_data_resolves_jinja_placeholders_in_display_name() -> None:
    df = pd.DataFrame({"sum__sales": [321]})
    form_data = {
        "column_config": {
            "sum__sales": {"displayName": "Ventas {{ sum__sales }}"},
        }
    }
    query_context = _build_query_context(form_data=form_data, verbose_map=None)

    result = query_context.get_data(
        df.copy(),
        [GenericDataType.NUMERIC],
    )

    header = result.splitlines()[0]
    assert header == "Ventas 321"


def test_get_data_omits_jinja_fields_in_export() -> None:
    df = pd.DataFrame({"jinja_metric": [10], "regular_metric": [20]})
    form_data = {"jinja_fields": ["jinja_metric"]}
    query_context = _build_query_context(form_data=form_data, verbose_map=None)

    result = query_context.get_data(
        df.copy(),
        [GenericDataType.NUMERIC, GenericDataType.NUMERIC],
    )

    header = result.splitlines()[0]
    assert header == "regular_metric"


def test_get_data_omits_jinja_fields_matching_verbose_labels() -> None:
    df = pd.DataFrame({"raw_metric": [11], "other": [22]})
    form_data = {"jinja_fields": ["Ventas"]}
    query_context = _build_query_context(
        form_data=form_data, verbose_map={"raw_metric": "Ventas", "other": "Other"}
    )

    result = query_context.get_data(
        df.copy(),
        [GenericDataType.NUMERIC, GenericDataType.NUMERIC],
    )

    header = result.splitlines()[0]
    assert header == "Other"
