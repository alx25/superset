"""Pronóstico estadístico calculado por código (tendencia + estacionalidad),
independiente de cualquier columna 'forecast' cargada manualmente en las
tablas. Usa regresión lineal (numpy) + ajuste estacional mensual simple
(promedio de residuos por mes) — sin dependencias extra (no requiere
statsmodels/sklearn, que no están en el venv de Superset).
"""

from datetime import datetime, timezone
from typing import Any, Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field
from superset_core.mcp.decorators import tool

from .query_dataset import (
    DatasetFilter,
    _parse_filter,
    _parse_metric,
    _remap_rows_to_raw_metrics,
)


class ForecastRequest(BaseModel):
    dataset_id: int = Field(..., description="ID del dataset de Superset")
    metric: str = Field(
        ...,
        description="Métrica histórica a proyectar, formato 'AGREGADO(columna)' "
        "ej. 'SUM(sell_in)'. NO usar la columna 'forecast' precargada — esta "
        "tool calcula su propio pronóstico a partir de los valores reales.",
    )
    date_column: str = Field(
        ...,
        description="Columna de fecha histórica, ej. 'fecha_id'. Debe ser una "
        "columna de tipo fecha/datetime real del dataset.",
    )
    granularity: Literal["month", "year"] = Field(
        "month",
        description="Granularidad del pronóstico. 'month' permite detectar "
        "estacionalidad si hay >= 24 meses de historia; 'year' es solo "
        "tendencia.",
    )
    periods_ahead: int = Field(
        3, ge=1, le=24, description="Cantidad de periodos futuros a proyectar."
    )
    group_by: str | None = Field(
        None,
        description="Si se especifica, calcula un pronóstico INDEPENDIENTE "
        "por cada valor distinto de esta columna (ej. pronóstico por "
        "marca/producto/responsable).",
    )
    filters: list[DatasetFilter] = Field(default_factory=list)
    row_limit: int = Field(
        5000,
        ge=1,
        le=20000,
        description="Máximo de filas históricas a traer para calcular el "
        "pronóstico (no confundir con periods_ahead).",
    )
    title: str | None = None


def _aggregate_by_period(
    rows: list[dict[str, Any]], date_col: str, metric: str, freq: str
) -> pd.Series:
    """Agrupa filas en una serie temporal continua (sin huecos) por periodo."""
    if not rows:
        return pd.Series(dtype=float)

    df = pd.DataFrame(rows)
    df[date_col] = pd.to_datetime(df[date_col])
    df["__period"] = df[date_col].dt.to_period(freq)
    agg = df.groupby("__period")[metric].sum().sort_index()

    if len(agg) > 1:
        full_index = pd.period_range(agg.index.min(), agg.index.max(), freq=freq)
        agg = agg.reindex(full_index, fill_value=0)

    # Descartar periodos que todavía no terminaron (ej. filas de
    # planificación pre-cargadas para meses futuros con valor 0) — no son
    # historial real y contaminarían la tendencia/estacionalidad.
    now = pd.Timestamp.now()
    agg = agg[agg.index.to_timestamp(how="end") <= now]

    return agg


def _fit_and_forecast(
    agg: pd.Series, periods_ahead: int, granularity: str
) -> dict[str, Any]:
    """Tendencia lineal + estacionalidad mensual (si hay suficiente historia)."""
    n = len(agg)
    t = np.arange(n)
    y = agg.values.astype(float)

    coeffs = np.polyfit(t, y, 1) if n >= 2 else np.array([0.0, float(y[0]) if n else 0.0])
    trend = np.polyval(coeffs, t)

    cycle = 12 if granularity == "month" else 1
    method = "tendencia_lineal"
    seasonal_avg = np.zeros(cycle)

    if granularity == "month" and n >= 24:
        residual = y - trend
        season_idx = t % cycle
        for m in range(cycle):
            mask = season_idx == m
            if np.any(mask):
                seasonal_avg[m] = residual[mask].mean()
        seasonal_avg -= seasonal_avg.mean()
        method = "tendencia_lineal_con_estacionalidad"

    fitted = trend + (seasonal_avg[t % cycle] if method != "tendencia_lineal" else 0)
    residual_std = float(np.std(y - fitted)) if n > 2 else 0.0

    future_t = np.arange(n, n + periods_ahead)
    future_trend = np.polyval(coeffs, future_t)
    if method == "tendencia_lineal_con_estacionalidad":
        future_values = future_trend + seasonal_avg[future_t % cycle]
    else:
        future_values = future_trend

    future_values = np.maximum(future_values, 0)
    freq = agg.index.freqstr if n else ("M" if granularity == "month" else "Y")
    last_period = agg.index[-1] if n else pd.Period(datetime.now(), freq=freq)
    future_periods = pd.period_range(last_period + 1, periods=periods_ahead, freq=freq)

    return {
        "method": method,
        "historical_periods": n,
        "residual_std": round(residual_std, 2),
        "future_periods": future_periods,
        "future_values": future_values,
    }


def _build_series_result(
    label: str, agg: pd.Series, fit: dict[str, Any]
) -> dict[str, Any]:
    """Combina histórico + pronóstico en filas {period, actual, forecast}."""
    rows: list[dict[str, Any]] = []
    for period, value in agg.items():
        rows.append({"period": str(period), "actual": round(float(value)), "forecast": None})

    # Punto puente para que la línea de pronóstico arranque sin salto visual.
    if rows:
        rows[-1]["forecast"] = rows[-1]["actual"]

    for period, value in zip(fit["future_periods"], fit["future_values"]):
        rows.append({"period": str(period), "actual": None, "forecast": round(float(value))})

    return {
        "label": label,
        "method": fit["method"],
        "historical_periods": fit["historical_periods"],
        "residual_std": fit["residual_std"],
        "data": rows,
    }


def _build_forecast_chart(
    results: list[dict[str, Any]], title: str | None
) -> dict[str, Any]:
    all_periods = sorted({row["period"] for res in results for row in res["data"]})
    series: list[dict[str, Any]] = []
    for res in results:
        lookup_actual = {r["period"]: r["actual"] for r in res["data"]}
        lookup_forecast = {r["period"]: r["forecast"] for r in res["data"]}
        prefix = f"{res['label']} — " if res["label"] else ""
        series.append(
            {
                "name": f"{prefix}Real",
                "type": "line",
                "data": [lookup_actual.get(p) for p in all_periods],
                "label": {"show": True, "position": "top"},
            }
        )
        series.append(
            {
                "name": f"{prefix}Pronóstico",
                "type": "line",
                "lineStyle": {"type": "dashed"},
                "data": [lookup_forecast.get(p) for p in all_periods],
                "label": {"show": True, "position": "top"},
            }
        )
    return {
        "title": {"text": title} if title else None,
        "tooltip": {"trigger": "axis"},
        "legend": {},
        "xAxis": {"type": "category", "data": all_periods},
        "yAxis": {"type": "value"},
        "series": series,
    }


@tool(
    name="irex.forecast",
    description=(
        "Calcula un PRONÓSTICO ESTADÍSTICO (tendencia lineal + estacionalidad "
        "mensual si hay >= 24 meses de historia) a partir de los valores "
        "HISTÓRICOS REALES de un dataset. NO usa ninguna columna 'forecast' "
        "precargada/manual en las tablas — el cálculo lo hace este código. "
        "Usar cuando el usuario pida proyectar, pronosticar o estimar valores "
        "futuros (ej. 'cuánto vamos a vender los próximos 3 meses', "
        "'proyección de PNS para el resto del año'). Si pide explícitamente "
        "el forecast ya cargado/planificado en el sistema, usar "
        "irex.query_dataset con la columna 'forecast' en su lugar — son cosas "
        "distintas, no confundir. Devuelve 'echarts_option' (línea sólida "
        "Real + línea punteada Pronóstico) y los datos crudos en 'series'."
    ),
    tags=["irex", "forecast", "pronostico", "proyeccion", "estadistica"],
)
def forecast(request: ForecastRequest) -> dict[str, Any]:
    from superset.commands.chart.data.get_data_command import ChartDataCommand
    from superset.common.query_context_factory import QueryContextFactory

    dims = [request.date_column]
    if request.group_by:
        dims.append(request.group_by)

    factory = QueryContextFactory()
    query_context = factory.create(
        datasource={"id": request.dataset_id, "type": "table"},
        queries=[
            {
                "filters": [_parse_filter(f) for f in request.filters],
                "columns": dims,
                "metrics": [_parse_metric(request.metric)],
                "row_limit": request.row_limit,
            }
        ],
        form_data={
            "datasource": f"{request.dataset_id}__table",
            "viz_type": "table",
        },
    )
    command = ChartDataCommand(query_context)
    command.validate()
    result = command.run()
    query_result = (result or {}).get("queries", [{}])[0]

    if query_result.get("error"):
        return {
            "status": "error",
            "error": query_result["error"],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    rows = query_result.get("data") or []
    if not rows:
        return {
            "status": "error",
            "error": "No hay datos históricos para los filtros dados.",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    _remap_rows_to_raw_metrics(rows, [request.metric])

    freq = "M" if request.granularity == "month" else "Y"
    metric_label = request.metric

    if request.group_by:
        groups = sorted(
            {
                r.get(request.group_by)
                for r in rows
                if r.get(request.group_by) is not None
            },
            key=str,
        )
        if len(groups) > 15:
            return {
                "status": "error",
                "error": (
                    f"'{request.group_by}' tiene {len(groups)} valores "
                    "distintos — demasiados para pronosticar todos a la vez "
                    "(la respuesta sería enorme). Agregá un filtro para "
                    "acotar a 15 o menos (ej. top N por volumen), o quitá "
                    "group_by para un pronóstico agregado general."
                ),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        series_results = []
        for g in groups:
            g_rows = [r for r in rows if r.get(request.group_by) == g]
            agg = _aggregate_by_period(g_rows, request.date_column, metric_label, freq)
            if agg.empty:
                continue
            fit = _fit_and_forecast(agg, request.periods_ahead, request.granularity)
            series_results.append(_build_series_result(str(g), agg, fit))
    else:
        agg = _aggregate_by_period(rows, request.date_column, metric_label, freq)
        fit = _fit_and_forecast(agg, request.periods_ahead, request.granularity)
        series_results = [_build_series_result("", agg, fit)]

    if not series_results:
        return {
            "status": "error",
            "error": "No se pudo calcular el pronóstico con los datos disponibles.",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    chart = _build_forecast_chart(series_results, request.title)

    # El echarts_option ya tiene el historial completo para graficar — en
    # 'series' (detalle crudo para que el LLM cite números) alcanza con los
    # últimos puntos reales + todo el pronóstico, así no se infla la
    # respuesta cuando hay group_by con varios valores.
    trimmed_results = []
    for res in series_results:
        actual_rows = [r for r in res["data"] if r["actual"] is not None]
        forecast_rows = [r for r in res["data"] if r["actual"] is None]
        trimmed_results.append(
            {
                **res,
                "data": actual_rows[-6:] + forecast_rows,
            }
        )

    return {
        "status": "success",
        "echarts_option": chart,
        "series": trimmed_results,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
