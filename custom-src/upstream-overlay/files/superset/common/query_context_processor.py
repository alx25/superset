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

import ast
import logging
import re
from typing import Any, cast, ClassVar, Sequence, TYPE_CHECKING

import numpy as np

import pandas as pd
from flask import current_app
from flask_babel import gettext as _

from superset.common.chart_data import ChartDataResultFormat
from superset.common.db_query_status import QueryStatus
from superset.common.query_actions import get_query_results
from superset.common.utils.query_cache_manager import QueryCacheManager
from superset.common.utils.time_range_utils import get_since_until_from_time_range
from superset.constants import CACHE_DISABLED_TIMEOUT, CacheRegion
from superset.daos.annotation_layer import AnnotationLayerDAO
from superset.daos.chart import ChartDAO
from superset.exceptions import (
    QueryObjectValidationError,
    SupersetException,
)
from superset.explorables.base import Explorable
from superset.extensions import cache_manager, security_manager
from superset.models.helpers import QueryResult
from superset.superset_typing import AdhocColumn, AdhocMetric
from superset.utils import csv, excel
from superset.utils.cache import generate_cache_key, set_and_log_cache
from superset.utils.core import (
    DatasourceType,
    DTTM_ALIAS,
    error_msg_from_exception,
    GenericDataType,
    get_column_names_from_columns,
    get_column_names_from_metrics,
    is_adhoc_column,
    is_adhoc_metric,
)
from superset.utils.pandas_postprocessing.utils import unescape_separator
from superset.views.utils import get_viz
from superset.viz import viz_types

if TYPE_CHECKING:
    from superset.common.query_context import QueryContext
    from superset.common.query_object import QueryObject

logger = logging.getLogger(__name__)


class QueryContextProcessor:
    """
    The query context contains the query object and additional fields necessary
    to retrieve the data payload for a given viz.
    """

    _query_context: QueryContext
    _qc_datasource: Explorable

    def __init__(self, query_context: QueryContext):
        self._query_context = query_context
        self._qc_datasource = query_context.datasource

    cache_type: ClassVar[str] = "df"
    enforce_numerical_metrics: ClassVar[bool] = True

    def get_df_payload(
        self, query_obj: QueryObject, force_cached: bool | None = False
    ) -> dict[str, Any]:
        """Handles caching around the df payload retrieval"""
        if query_obj:
            # Always validate the query object before generating cache key
            # This ensures sanitize_clause() is called and extras are normalized
            query_obj.validate()

        cache_key = self.query_cache_key(query_obj)
        timeout = self.get_cache_timeout()
        force_query = self._query_context.force or timeout == CACHE_DISABLED_TIMEOUT
        cache = QueryCacheManager.get(
            key=cache_key,
            region=CacheRegion.DATA,
            force_query=force_query,
            force_cached=force_cached,
        )

        # If cache is loaded but missing applied_filter_columns and query has filters,
        # treat as cache miss to ensure fresh query with proper applied_filter_columns
        if (
            query_obj
            and cache_key
            and cache.is_loaded
            and not cache.applied_filter_columns
            and query_obj.filter
            and len(query_obj.filter) > 0
        ):
            cache.is_loaded = False

        if query_obj and cache_key and not cache.is_loaded:
            try:
                if invalid_columns := [
                    col
                    for col in get_column_names_from_columns(query_obj.columns)
                    + get_column_names_from_metrics(query_obj.metrics or [])
                    if (
                        col not in self._qc_datasource.column_names
                        and col != DTTM_ALIAS
                    )
                ]:
                    raise QueryObjectValidationError(
                        _(
                            "Columns missing in dataset: %(invalid_columns)s",
                            invalid_columns=invalid_columns,
                        )
                    )

                query_result = self.get_query_result(query_obj)
                annotation_data = self.get_annotation_data(query_obj)
                cache.set_query_result(
                    key=cache_key,
                    query_result=query_result,
                    annotation_data=annotation_data,
                    force_query=force_query,
                    timeout=self.get_cache_timeout(),
                    datasource_uid=self._qc_datasource.uid,
                    region=CacheRegion.DATA,
                )
            except QueryObjectValidationError as ex:
                cache.error_message = str(ex)
                cache.status = QueryStatus.FAILED

        # the N-dimensional DataFrame has converted into flat DataFrame
        # by `flatten operator`, "comma" in the column is escaped by `escape_separator`
        # the result DataFrame columns should be unescaped
        label_map = {
            unescape_separator(col): [
                unescape_separator(col) for col in re.split(r"(?<!\\),\s", col)
            ]
            for col in cache.df.columns.values
        }
        label_map.update(
            {
                column_name: [
                    (
                        str(query_obj.columns[idx])
                        if not is_adhoc_column(query_obj.columns[idx])
                        else cast(AdhocColumn, query_obj.columns[idx])["sqlExpression"]
                    ),
                ]
                for idx, column_name in enumerate(query_obj.column_names)
            }
        )
        label_map.update(
            {
                metric_name: [
                    (
                        str(query_obj.metrics[idx])
                        if not is_adhoc_metric(query_obj.metrics[idx])
                        else (
                            str(
                                cast(AdhocMetric, query_obj.metrics[idx])[
                                    "sqlExpression"
                                ]
                            )
                            if cast(AdhocMetric, query_obj.metrics[idx])[
                                "expressionType"
                            ]
                            == "SQL"
                            else metric_name
                        )
                    ),
                ]
                for idx, metric_name in enumerate(query_obj.metric_names)
                if query_obj and query_obj.metrics
            }
        )
        cache.df.columns = [unescape_separator(col) for col in cache.df.columns.values]

        return {
            "cache_key": cache_key,
            "cached_dttm": cache.cache_dttm,
            "queried_dttm": cache.queried_dttm,
            "cache_timeout": self.get_cache_timeout(),
            "df": cache.df,
            "applied_template_filters": cache.applied_template_filters,
            "applied_filter_columns": cache.applied_filter_columns,
            "rejected_filter_columns": cache.rejected_filter_columns,
            "annotation_data": cache.annotation_data,
            "error": cache.error_message,
            "is_cached": cache.is_cached,
            "query": cache.query,
            "status": cache.status,
            "stacktrace": cache.stacktrace,
            "rowcount": len(cache.df.index),
            "sql_rowcount": cache.sql_rowcount,
            "from_dttm": query_obj.from_dttm,
            "to_dttm": query_obj.to_dttm,
            "label_map": label_map,
        }

    def query_cache_key(self, query_obj: QueryObject, **kwargs: Any) -> str | None:
        """
        Returns a QueryObject cache key for objects in self.queries
        """
        datasource = self._qc_datasource
        extra_cache_keys = datasource.get_extra_cache_keys(query_obj.to_dict())

        cache_key = (
            query_obj.cache_key(
                datasource=datasource.uid,
                extra_cache_keys=extra_cache_keys,
                rls=security_manager.get_rls_cache_key(datasource),
                changed_on=datasource.changed_on,
                **kwargs,
            )
            if query_obj
            else None
        )
        return cache_key

    def get_query_result(self, query_object: QueryObject) -> QueryResult:
        """
        Returns a pandas dataframe based on the query object.

        This method delegates to the datasource's get_query_result method,
        which handles query execution, normalization, time offsets, and
        post-processing.
        """
        return self._qc_datasource.get_query_result(query_object)

    @staticmethod
    def _export_is_blank(value: Any) -> bool:
        if value is None:
            return True
        if isinstance(value, float) and np.isnan(value):
            return True
        if isinstance(value, str) and value.strip() == "":
            return True
        return False

    @staticmethod
    def _export_round(value: Any, digits: int = 0) -> float:
        try:
            return round(float(value), int(digits))
        except Exception:  # noqa: BLE001
            return float("nan")

    @staticmethod
    def _validate_formula_ast(tree: ast.Expression) -> None:
        allowed_nodes = {
            ast.Expression, ast.BoolOp, ast.BinOp, ast.UnaryOp,
            ast.Compare, ast.Call, ast.Constant, ast.Name,
            ast.Load, ast.Add, ast.Sub, ast.Mult, ast.Div,
            ast.Mod, ast.Pow, ast.USub, ast.UAdd, ast.Not,
            ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE,
            ast.And, ast.Or, ast.IfExp, ast.Tuple, ast.List,
            ast.Subscript, ast.Index, ast.Slice,
        }
        for node in ast.walk(tree):
            if type(node) not in allowed_nodes:
                raise ValueError(f"Disallowed AST node: {type(node).__name__}")

    @staticmethod
    def _build_formula_expression(expression: str, row: dict[str, Any]) -> str:
        logical_map = {
            r"\bOR\b": "__OR",
            r"\bAND\b": "__AND",
            r"\bNOT\b": "__NOT",
            r"\bIF\b": "__IF",
            r"\bISBLANK\b": "__ISBLANK",
            r"\bABS\b": "__ABS",
            r"\bROUND\b": "__ROUND",
            r"\bMAX\b": "__MAX",
            r"\bMIN\b": "__MIN",
        }
        result = expression
        for pattern, replacement in logical_map.items():
            result = re.sub(pattern, replacement, result)
        for col_name, col_value in row.items():
            if isinstance(col_value, str):
                escaped = col_value.replace("\\", "\\\\").replace("'", "\\'")
                result = result.replace(f"{{{{{col_name}}}}}", f"'{escaped}'")
            elif col_value is None:
                result = result.replace(f"{{{{{col_name}}}}}", "None")
            elif isinstance(col_value, float) and np.isnan(col_value):
                result = result.replace(f"{{{{{col_name}}}}}", "NaN")
            else:
                result = result.replace(f"{{{{{col_name}}}}}", str(col_value))
        return result

    @classmethod
    def _evaluate_export_formula(
        cls, expression: str, row: dict[str, Any]
    ) -> float | None:
        try:
            compiled_expression = cls._build_formula_expression(expression, row)
            tree = ast.parse(compiled_expression, mode="eval")
            cls._validate_formula_ast(tree)
            result = eval(  # noqa: S307
                compile(tree, "<table-export-formula>", "eval"),
                {"__builtins__": {}},
                {
                    "__IF": lambda condition, if_true, if_false: (
                        if_true if condition else if_false
                    ),
                    "__OR": lambda *args: any(args),
                    "__AND": lambda *args: all(args),
                    "__NOT": lambda value: not value,
                    "__ISBLANK": cls._export_is_blank,
                    "__ABS": abs,
                    "__ROUND": cls._export_round,
                    "__MAX": max,
                    "__MIN": min,
                    "True": True,
                    "False": False,
                    "None": None,
                    "NaN": np.nan,
                },
            )
            if result is None:
                return None
            numeric_result = float(result)
            if not np.isfinite(numeric_result):
                return None
            return numeric_result
        except Exception:  # noqa: BLE001
            return None

    @classmethod
    def _apply_export_calculated_columns(
        cls,
        df: pd.DataFrame,
        coltypes: list[GenericDataType],
        calculated_columns: list[dict[str, Any]],
    ) -> tuple[pd.DataFrame, list[GenericDataType]]:
        if not calculated_columns:
            return df, coltypes
        result_df = df.copy()
        result_coltypes = list(coltypes)
        seen = set(result_df.columns)
        for item in calculated_columns:
            label = str(item.get("label", "")).strip()
            expression = str(item.get("expression", "")).strip()
            if not label or not expression or label in seen:
                continue
            result_df[label] = result_df.apply(
                lambda row, expr=expression: cls._evaluate_export_formula(
                    expr, row.to_dict()
                ),
                axis=1,
            )
            seen.add(label)
            result_coltypes.append(GenericDataType.NUMERIC)
        return result_df, result_coltypes

    @staticmethod
    def _apply_export_column_order(
        df: pd.DataFrame,
        coltypes: list[GenericDataType],
        preferred_order: list[str],
    ) -> tuple[pd.DataFrame, list[GenericDataType]]:
        if not preferred_order:
            return df, coltypes
        current_columns = list(df.columns)
        seen: set[str] = set()
        ordered_columns: list[str] = []
        for column in preferred_order:
            if column in df.columns and column not in seen:
                seen.add(column)
                ordered_columns.append(column)
        ordered_columns.extend(
            [column for column in current_columns if column not in seen]
        )
        coltype_by_column = {
            column: coltypes[index]
            for index, column in enumerate(current_columns)
            if index < len(coltypes)
        }
        ordered_coltypes = [
            coltype_by_column.get(column, GenericDataType.STRING)
            for column in ordered_columns
        ]
        return df.loc[:, ordered_columns], ordered_coltypes

    _SCOPED_REF_RE = re.compile(
        r"\b(?:total|row|col|previous|next)\.\{\{", re.IGNORECASE
    )

    @staticmethod
    def _evaluate_pivot_formula_for_row(
        expression: str,
        row_dict: dict[str, Any],
        col_totals: dict[str, float],
        prev_values: dict[str, Any],
    ) -> float | None:
        """Evaluate one formula row by row for the flat CSV export.

        Scope mapping for flat (non-pivoted) data:
          col.{{X}}, row.{{X}}, total.{{X}} → sum of column X across all rows.
          previous.{{X}}                    → value of X in previous row (0 if first).
          next.{{X}}                        → NaN (not computable in single pass).
          {{X}}                             → current row value (raw or formula).
        """
        # 1. Replace scoped references
        _SCOPE_RE = re.compile(
            r"\b(col|row|total|previous|next)\.\{\{([^}]+)\}\}"
        )

        def _replace_scope(m: re.Match[str]) -> str:
            scope, name = m.group(1), m.group(2).strip()
            if scope in ("col", "row", "total"):
                val = col_totals.get(name)
            elif scope == "previous":
                # Treat missing/first-row as 0 so cumulative formulas start correctly
                val = prev_values.get(name, 0)
            else:
                return "NaN"
            if val is None:
                return "0"
            try:
                f = float(val)
                return "NaN" if not np.isfinite(f) else str(f)
            except Exception:  # noqa: BLE001
                return "NaN"

        expr = _SCOPE_RE.sub(_replace_scope, expression)

        # 2. Replace plain {{col}} references (longest names first to avoid partials)
        for col_name, val in sorted(row_dict.items(), key=lambda kv: -len(kv[0])):
            placeholder = "{{" + col_name + "}}"
            if placeholder not in expr:
                continue
            if val is None:
                expr = expr.replace(placeholder, "None")
            elif isinstance(val, float) and np.isnan(val):
                expr = expr.replace(placeholder, "NaN")
            elif isinstance(val, str):
                escaped = val.replace("\\", "\\\\").replace("'", "\\'")
                expr = expr.replace(placeholder, f"'{escaped}'")
            else:
                expr = expr.replace(placeholder, str(val))

        # 3. Evaluate
        try:
            tree = ast.parse(expr, mode="eval")
            result = eval(  # noqa: S307
                compile(tree, "<pivot-export-formula>", "eval"),
                {"__builtins__": {}},
                {
                    "NaN": np.nan,
                    "None": None,
                    "True": True,
                    "False": False,
                    "__IF": lambda c, t, f: t if c else f,
                    "__OR": lambda *a: any(a),
                    "__AND": lambda *a: all(a),
                    "__NOT": lambda v: not v,
                    "__ISBLANK": lambda v: v is None or (isinstance(v, float) and np.isnan(v)) or str(v).strip() == "",
                    "__ABS": abs,
                    "__ROUND": round,
                    "__MAX": max,
                    "__MIN": min,
                },
            )
            if result is None:
                return None
            r = float(result)
            return None if not np.isfinite(r) else r
        except Exception:  # noqa: BLE001
            return None

    def _apply_pivot_rx1_formulas(
        self, df: pd.DataFrame, coltypes: list[GenericDataType], formulas: list[dict[str, Any]]
    ) -> tuple[pd.DataFrame, list[GenericDataType]]:
        """Compute formula metrics row-by-row on flat data, with full scope support.

        Formulas are evaluated in declaration order so later formulas can reference
        earlier ones (e.g. '80_20' can reference 'peso' which is defined first).
        """
        if not formulas or df.empty:
            return df, coltypes

        result_df = df.copy()
        result_ct = list(coltypes)

        # Pre-compute column totals for col./row./total. scopes
        col_totals: dict[str, float] = {}
        for col in result_df.columns:
            try:
                col_totals[col] = float(result_df[col].sum())
            except Exception:  # noqa: BLE001
                col_totals[col] = float("nan")

        # Compute each formula in declaration order
        for formula in formulas:
            label = formula["label"]
            expression = formula["expression"]
            values: list[float | None] = []
            prev_row_values: dict[str, Any] = {}

            for i, row in result_df.iterrows():
                row_dict = row.to_dict()
                val = self._evaluate_pivot_formula_for_row(
                    expression, row_dict, col_totals, prev_row_values
                )
                values.append(val)

                # Build previous-row context for next iteration:
                # includes raw columns AND all formula values computed so far
                prev_row_values = {**row_dict, label: val}

            result_df[label] = values
            # Update col_totals so a subsequent formula can use col.{{label}}
            try:
                col_totals[label] = float(result_df[label].sum())
            except Exception:  # noqa: BLE001
                col_totals[label] = float("nan")
            result_ct.append(GenericDataType.NUMERIC)

        return result_df, result_ct

    def _get_pivot_rx1_export_formulas(
        self,
    ) -> tuple[list[dict[str, Any]], list[str]]:
        """Return (formulas, jinja_field_labels) for pivot_table_rx1 CSV/Excel export."""
        form_data = self._query_context.form_data or {}
        viz_type = form_data.get("viz_type")
        if viz_type != "pivot_table_rx1":
            return [], []

        import json as _json

        def _parse_list(raw: Any) -> list:
            if isinstance(raw, list):
                return raw
            if isinstance(raw, str):
                try:
                    parsed = _json.loads(raw)
                    return parsed if isinstance(parsed, list) else []
                except Exception:  # noqa: BLE001
                    return []
            return []

        # ALL formulas (visible + hidden) are computed so hidden ones can be
        # referenced by dependent formulas (e.g. hidden 'peso' needed by '80_20').
        # Hidden formula labels are collected separately to exclude from the output.
        formulas: list[dict[str, Any]] = []
        hidden_labels: list[str] = []
        for item in _parse_list(form_data.get("metricFormulas")):
            if not isinstance(item, dict):
                continue
            label = str(item.get("label") or "").strip()
            expression = str(item.get("expression") or "").strip()
            if not label or not expression:
                continue
            formulas.append({"label": label, "expression": expression})
            if item.get("hidden"):
                hidden_labels.append(label)

        # Jinja fields + hidden formula columns → exclude from export output
        exclude_labels: list[str] = list(hidden_labels)
        for item in _parse_list(
            form_data.get("jinjaFields") or form_data.get("jinja_fields")
        ):
            if isinstance(item, str):
                label = item.strip()
            elif isinstance(item, dict):
                label = str(item.get("label") or item.get("metric_name") or "").strip()
            else:
                continue
            if label and label not in exclude_labels:
                exclude_labels.append(label)

        return formulas, exclude_labels

    def get_data(
        self, df: pd.DataFrame, coltypes: list[GenericDataType]
    ) -> str | list[dict[str, Any]]:
        if self._query_context.result_format in ChartDataResultFormat.table_like():
            df = df.copy()
            include_index = not isinstance(df.index, pd.RangeIndex)
            verbose_map = self._qc_datasource.data.get("verbose_map", {})

            column_display_names: dict[str, str] = {}
            excluded_columns: list[str] = []
            calculated_columns_export: list[dict[str, Any]] = []
            column_export_order: list[str] = []
            for query in self._query_context.queries:
                if hasattr(query, "extras") and query.extras:
                    column_display_names = query.extras.get("column_display_names", {})
                    excluded_columns = query.extras.get("excluded_columns", [])
                    calculated_columns_export = query.extras.get(
                        "calculated_columns_export", []
                    )
                    column_export_order = query.extras.get("column_export_order", [])
                    if (
                        column_display_names
                        or excluded_columns
                        or calculated_columns_export
                        or column_export_order
                    ):
                        break

            # Apply verbose_map first so formula expressions and excluded_columns
            # can reference column labels as the user sees them (e.g. "Venta")
            # rather than the raw DB column names (e.g. "sum__ventas").
            if verbose_map:
                df.columns = [verbose_map.get(c, c) for c in df.columns]

            columns = list(df.columns)

            # For pivot_table_rx1: read formula metrics and jinja fields directly
            # from form_data. This is more reliable than passing them through extras,
            # since form_data is always available on the QueryContext.
            pivot_formulas, pivot_jinja_excl = self._get_pivot_rx1_export_formulas()
            if pivot_jinja_excl and not excluded_columns:
                excluded_columns = pivot_jinja_excl

            # pivot_table_rx1: use specialized evaluator with full scope support
            if pivot_formulas:
                df, coltypes = self._apply_pivot_rx1_formulas(df, coltypes, pivot_formulas)
                columns = list(df.columns)
            elif calculated_columns_export:
                df, coltypes = self._apply_export_calculated_columns(
                    df, coltypes, calculated_columns_export
                )
                columns = list(df.columns)

            if column_display_names and not df.empty:
                first_row = df.iloc[0].to_dict()
                processed_display_names: dict[str, str] = {}
                for col_name, display_name in column_display_names.items():
                    if not display_name or not isinstance(display_name, str):
                        processed_display_names[col_name] = display_name
                        continue

                    def replace_jinja(match: re.Match[str]) -> str:
                        expression = match.group(1).strip()
                        if expression in first_row:
                            value = first_row[expression]
                            if value is None:
                                return "NULL"
                            return str(value)
                        return match.group(0)

                    processed_display_names[col_name] = re.sub(
                        r"\{\{([^}]+)\}\}", replace_jinja, display_name
                    )
                column_display_names = processed_display_names

            if excluded_columns:
                df = df.drop(
                    columns=[col for col in excluded_columns if col in df.columns],
                    errors="ignore",
                )
                columns = list(df.columns)

            if column_export_order:
                df, coltypes = self._apply_export_column_order(
                    df, coltypes, column_export_order
                )
                columns = list(df.columns)

            # Apply column_display_names on top of already-renamed columns
            if column_display_names:
                df.columns = [
                    column_display_names.get(column, column) for column in columns
                ]

            result = None
            if self._query_context.result_format == ChartDataResultFormat.CSV:
                result = csv.df_to_escaped_csv(
                    df, index=include_index, **current_app.config["CSV_EXPORT"]
                )
            elif self._query_context.result_format == ChartDataResultFormat.XLSX:
                excel.apply_column_types(df, coltypes)
                result = excel.df_to_excel(
                    df, index=include_index, **current_app.config["EXCEL_EXPORT"]
                )
            return result or ""

        return df.to_dict(orient="records")

    def _prepare_contribution_totals(self) -> tuple[list[int], int | None]:
        """
        Identify contribution queries and normalize the totals query so cache keys
        align with cached results.
        """
        queries_needing_totals: list[int] = []
        totals_idx: int | None = None

        for i, query in enumerate(self._query_context.queries):
            needs_totals = any(
                pp.get("operation") == "contribution"
                for pp in getattr(query, "post_processing", []) or []
            )

            if needs_totals:
                queries_needing_totals.append(i)

            is_totals_query = (
                not query.columns and query.metrics and not query.post_processing
            )
            if is_totals_query and totals_idx is None:
                totals_idx = i

        if queries_needing_totals and totals_idx is not None:
            totals_query = self._query_context.queries[totals_idx]
            totals_query.row_limit = None

        return queries_needing_totals, totals_idx

    def ensure_totals_available(
        self,
        queries_needing_totals: Sequence[int] | None = None,
        totals_idx: int | None = None,
    ) -> None:
        if queries_needing_totals is None or totals_idx is None:
            queries_needing_totals, totals_idx = self._prepare_contribution_totals()

        if not queries_needing_totals or totals_idx is None:
            return

        totals_query = self._query_context.queries[totals_idx]

        result = self._query_context.get_query_result(totals_query)
        df = result.df

        totals = {
            col: df[col].sum() for col in df.columns if df[col].dtype.kind in "biufc"
        }

        for idx in queries_needing_totals:
            query = self._query_context.queries[idx]
            if hasattr(query, "post_processing") and query.post_processing:
                for pp in query.post_processing:
                    if pp.get("operation") == "contribution":
                        pp["options"]["contribution_totals"] = totals

    def get_payload(
        self,
        cache_query_context: bool | None = False,
        force_cached: bool = False,
    ) -> dict[str, Any]:
        """Returns the query results with both metadata and data"""

        queries_needing_totals, totals_idx = self._prepare_contribution_totals()

        # Skip ensure_totals_available when force_cached=True
        # This prevents recalculating contribution_totals from cached results
        if not force_cached:
            self.ensure_totals_available(queries_needing_totals, totals_idx)

            # Update cache_values to reflect modifications made by
            # ensure_totals_available()
            # This ensures cache keys are generated from the actual query state
            # We merge the original query dict with the updated query dict to preserve
            # any fields that might not be in to_dict() but were in the original request
            self._query_context.cache_values["queries"] = [
                {**cached_query, **query.to_dict()}
                for cached_query, query in zip(
                    self._query_context.cache_values["queries"],
                    self._query_context.queries,
                    strict=True,
                )
            ]

        query_results = [
            get_query_results(
                query_obj.result_type or self._query_context.result_type,
                self._query_context,
                query_obj,
                force_cached,
            )
            for query_obj in self._query_context.queries
        ]

        return_value = {"queries": query_results}

        if cache_query_context:
            cache_key = self.cache_key()
            set_and_log_cache(
                cache_manager.cache,
                cache_key,
                {
                    "data": {
                        # setting form_data into query context cache value as well
                        # so that it can be used to reconstruct form_data field
                        # for query context object when reading from cache
                        "form_data": self._query_context.form_data,
                        **self._query_context.cache_values,
                    },
                },
                self.get_cache_timeout(),
            )
            return_value["cache_key"] = cache_key  # type: ignore

        return return_value

    def get_cache_timeout(self) -> int:
        if cache_timeout_rv := self._query_context.get_cache_timeout():
            return cache_timeout_rv
        if (
            data_cache_timeout := current_app.config["DATA_CACHE_CONFIG"].get(
                "CACHE_DEFAULT_TIMEOUT"
            )
        ) is not None:
            return data_cache_timeout
        return current_app.config["CACHE_DEFAULT_TIMEOUT"]

    def cache_key(self, **extra: Any) -> str:
        """
        The QueryContext cache key is made out of the key/values from
        self.cached_values, plus any other key/values in `extra`. It includes only data
        required to rehydrate a QueryContext object.
        """
        key_prefix = "qc-"
        cache_dict = self._query_context.cache_values.copy()
        cache_dict.update(extra)

        return generate_cache_key(cache_dict, key_prefix)

    def get_annotation_data(self, query_obj: QueryObject) -> dict[str, Any]:
        annotation_data: dict[str, Any] = self.get_native_annotation_data(query_obj)
        for annotation_layer in [
            layer
            for layer in query_obj.annotation_layers
            if layer["sourceType"] in ("line", "table")
        ]:
            name = annotation_layer["name"]
            annotation_data[name] = self.get_viz_annotation_data(
                annotation_layer, self._query_context.force
            )
        return annotation_data

    @staticmethod
    def get_native_annotation_data(query_obj: QueryObject) -> dict[str, Any]:
        annotation_data = {}
        annotation_layers = [
            layer
            for layer in query_obj.annotation_layers
            if layer["sourceType"] == "NATIVE"
        ]
        layer_ids = [layer["value"] for layer in annotation_layers]
        layer_objects = {
            layer_object.id: layer_object
            for layer_object in AnnotationLayerDAO.find_by_ids(layer_ids)
        }

        # annotations
        for layer in annotation_layers:
            layer_id = layer["value"]
            layer_name = layer["name"]
            columns = [
                "start_dttm",
                "end_dttm",
                "short_descr",
                "long_descr",
                "json_metadata",
            ]
            layer_object = layer_objects[layer_id]
            records = [
                {column: getattr(annotation, column) for column in columns}
                for annotation in layer_object.annotation
            ]
            result = {"columns": columns, "records": records}
            annotation_data[layer_name] = result
        return annotation_data

    @staticmethod
    def get_viz_annotation_data(  # noqa: C901
        annotation_layer: dict[str, Any], force: bool
    ) -> dict[str, Any]:
        # pylint: disable=import-outside-toplevel
        from superset.commands.chart.data.get_data_command import ChartDataCommand

        if not (chart := ChartDAO.find_by_id(annotation_layer["value"])):
            raise QueryObjectValidationError(
                _(
                    f"""Chart with ID {annotation_layer["value"]} (referenced by
                    annotation layer '{annotation_layer["name"]}') was not found.
                    Please verify that the chart exists and is accessible."""
                )
            )

        try:
            if chart.viz_type in viz_types:
                if not chart.datasource:
                    raise QueryObjectValidationError(
                        _(
                            f"""The dataset for chart ID {chart.id} (referenced by
                            annotation layer '{annotation_layer["name"]}') was
                            not found. Please check that the dataset exists and
                            is accessible."""
                        )
                    )

                form_data = chart.form_data.copy()
                form_data.update(annotation_layer.get("overrides", {}))

                payload = get_viz(
                    datasource_type=chart.datasource.type,
                    datasource_id=chart.datasource.id,
                    form_data=form_data,
                    force=force,
                ).get_payload()

                return payload["data"]

            if not (query_context := chart.get_query_context()):
                raise QueryObjectValidationError(
                    _(
                        f"""The query context for chart ID {chart.id} (referenced
                        by annotation layer '{annotation_layer["name"]}') was not found.
                        Please ensure the chart is properly configured and has a valid
                        query context."""
                    )
                )

            if overrides := annotation_layer.get("overrides"):
                if time_grain_sqla := overrides.get("time_grain_sqla"):
                    for query_object in query_context.queries:
                        query_object.extras["time_grain_sqla"] = time_grain_sqla

                if time_range := overrides.get("time_range"):
                    from_dttm, to_dttm = get_since_until_from_time_range(time_range)

                    for query_object in query_context.queries:
                        query_object.from_dttm = from_dttm
                        query_object.to_dttm = to_dttm

            query_context.force = force
            command = ChartDataCommand(query_context)
            command.validate()
            payload = command.run()
            return {"records": payload["queries"][0]["data"]}
        except SupersetException as ex:
            raise QueryObjectValidationError(error_msg_from_exception(ex)) from ex

    def raise_for_access(self) -> None:
        """
        Raise an exception if the user cannot access the resource.

        :raises SupersetSecurityException: If the user cannot access the resource
        """
        for query in self._query_context.queries:
            query.validate()

        if self._qc_datasource.type == DatasourceType.QUERY:
            security_manager.raise_for_access(query=self._qc_datasource)
        else:
            security_manager.raise_for_access(query_context=self._query_context)
