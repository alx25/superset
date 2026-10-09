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
"""Núcleo de capacidades temporales para el copiloto de Explore.

Pedido del usuario (2026-10-09): que el modelo sepa cómo agrupar una columna
temporal usando lo que Superset y el motor REALMENTE soportan, sin que nadie
mantenga un diccionario propio de funciones SQL por base de datos.

- `query_capabilities`: identidad de la base (sin URI ni credenciales) y las
  granularidades que declara el `db_engine_spec` de Superset — la MISMA lista
  que ofrece el selector "Time grain" de Explore (incluye
  `TIME_GRAIN_ADDONS`/`TIME_GRAIN_ADDON_EXPRESSIONS` y descuenta
  `TIME_GRAIN_DENYLIST` de la config).
- `resolve_temporal_expression`: arma la expresión con el mecanismo nativo
  (`TableColumn.get_timestamp_expression` → `db_engine_spec.get_timestamp_expr`,
  el mismo camino que usa Superset al construir la consulta de un gráfico).
  El SQL lo genera Superset; acá solo se decide si se puede pedir y se le da
  forma a la respuesta. La expresión queda GENERADA, nunca ejecutada: para
  comprobarla está `irex.validate_expression`.

Las funciones no importan Superset: el wrapper de la tool les pasa el
dataset, la base y una función `compile_expression` ya ligada al dialecto.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from .sql_schema_structure import classify_error

RESOLUTION_METHOD = "TableColumn.get_timestamp_expression -> db_engine_spec.get_timestamp_expr"


def time_grain_entries(engine_spec: Any) -> list[dict[str, Any]]:
    """Granularidades del motor, en el orden que les da Superset. Se omite la
    entrada `duration=None` ("sin granularidad"): no es una granularidad."""
    entries = []
    for grain in engine_spec.get_time_grains():
        if not grain.duration:
            continue
        # En PostgreSQL `duration` es un `TimeGrain` (StrEnum): se normaliza a
        # su valor ("P1D") para que el id sea siempre un string plano.
        entries.append({"id": str(getattr(grain.duration, "value", grain.duration)), "label": str(grain.label)})
    return entries


def _sqlglot_dialect(engine: str | None) -> str | None:
    try:
        from superset.sql.parse import SQLGLOT_DIALECTS
    except Exception:  # noqa: BLE001 - solo informativo
        return None
    dialect = SQLGLOT_DIALECTS.get(engine or "")
    return getattr(dialect, "value", None) or None


def query_capabilities(database: Any) -> dict[str, Any]:
    """Sección `query_capabilities` de `get_dataset_catalog`. Nunca lanza: si
    algo falla devuelve `status` + `detail`, y el catálogo sigue saliendo."""
    try:
        spec = database.db_engine_spec
        grains = time_grain_entries(spec)
        result: dict[str, Any] = {
            "status": "ok" if grains else "unsupported",
            "database": {"id": database.id, "name": database.database_name},
            "engine": spec.engine,
            "engine_name": getattr(spec, "engine_name", None),
            "backend": database.backend,
            "sqlglot_dialect": _sqlglot_dialect(spec.engine),
            "time_grains": grains,
            "source": "db_engine_spec.get_time_grains",
        }
        if not grains:
            result["detail"] = "El motor no declara granularidades temporales en Superset."
        return result
    except Exception as exc:  # noqa: BLE001
        status, detail = classify_error(exc)
        return {"status": status, "detail": detail, "time_grains": []}


def _status(status: str, detail: str, **extra: Any) -> dict[str, Any]:
    return {"status": status, "detail": detail, "resolution": _resolution(False), **extra}


def _resolution(generated: bool) -> dict[str, Any]:
    return {
        "generated": generated,
        "executed": False,
        "validated": False,
        "method": RESOLUTION_METHOD if generated else None,
    }


def resolve_temporal_expression(
    *,
    verified: Mapping[str, Any],
    dataset: Any,
    column_name: str,
    time_grain: str,
    compile_expression: Callable[[Any, str], str],
) -> dict[str, Any]:
    """Resuelve la expresión de `column_name` agrupada por `time_grain`.

    `verified` es la salida de `verified_explore_state` (acceso a Explore,
    al gráfico y al dataset ya comprobados). Devuelve siempre un dict con
    `status`; los errores esperables (columna inexistente, no temporal,
    granularidad no admitida, motor sin soporte) son estados, no excepciones.
    """
    base = {
        "form_data_key": verified["form_data_key"],
        "slice_id": verified["slice_id"],
        "state_kind": verified["state_kind"],
        "dataset": {
            "id": dataset.id,
            "name": getattr(dataset, "table_name", None),
            "schema": getattr(dataset, "schema", None),
            "database_id": getattr(dataset.database, "id", None),
        },
    }
    spec = dataset.database.db_engine_spec
    base["engine"] = spec.engine

    column = next(
        (
            col
            for col in dataset.columns
            if col.column_name == column_name and col.is_active is not False
        ),
        None,
    )
    if column is None:
        return _status(
            "column_not_found",
            f"El dataset no tiene una columna activa llamada {column_name!r} (el nombre es exacto, "
            "sensible a mayúsculas: ver irex.get_dataset_catalog).",
            **base,
        )

    column_info = {
        "name": column.column_name,
        "type": column.type,
        "is_temporal": bool(column.is_dttm),
        "is_calculated": bool(column.expression),
    }
    if column.expression:
        column_info["expression"] = column.expression
    if column.python_date_format:
        column_info["python_date_format"] = column.python_date_format
    base["column"] = column_info

    if not column.is_dttm:
        return _status(
            "column_not_temporal",
            "La columna no está marcada como temporal en el dataset (is_dttm); Superset no le aplica "
            "granularidad. Elegir una columna temporal del catálogo o marcarla temporal en el dataset.",
            **base,
        )

    try:
        grains = time_grain_entries(spec)
    except Exception as exc:  # noqa: BLE001
        status, detail = classify_error(exc)
        return _status(status, detail, **base)
    if not grains:
        return _status("unsupported", "El motor no declara granularidades temporales en Superset.", **base)
    grain = next((g for g in grains if g["id"] == time_grain), None)
    if grain is None:
        return _status(
            "time_grain_not_supported",
            f"{time_grain!r} no es una granularidad admitida por este motor.",
            supported_time_grains=grains,
            **base,
        )
    base["time_grain"] = grain

    try:
        expression = compile_expression(column, time_grain)
    except NotImplementedError as exc:
        return _status("unsupported", str(exc)[:200] or "Granularidad sin implementación en el motor.", **base)
    except Exception as exc:  # noqa: BLE001
        status, detail = classify_error(exc)
        return _status(status, detail, **base)

    return {
        "status": "generated",
        "detail": "Expresión generada por Superset para este motor; todavía no se ejecutó ni se validó.",
        "resolution": _resolution(True),
        "expression": expression,
        "next_step": {
            "tool": "irex.validate_expression",
            "arguments": {"dataset_id": dataset.id, "expression": expression, "kind": "column"},
        },
        **base,
    }
