from datetime import datetime, timezone
from typing import Any

from flask import current_app
from pydantic import BaseModel, Field
from superset_core.mcp.decorators import tool

# IDs por entorno — leídos de la config de Superset (distinta en
# superset_config_test.py vs el config de producción) para que esta misma
# extensión funcione en ambos sin tocar código. Los valores por defecto
# corresponden al entorno de TEST.
_DEFAULT_VENTAS_PEDIDOS_DATASET_ID = 130
_DEFAULT_VENTAS_PEDIDOS_DATABASE_ID = 3
_DEFAULT_PNS_DATASET_ID = 74
_DEFAULT_PNS_DATABASE_ID = 3
_DATABASE_NAME = "ClickHouse Connet 192(docker)"

_DOMAIN_NAMES = ["ventas", "pedidos", "pns"]

_RLS_WARNING = (
    "Este dataset tiene row-level security vía Jinja (current_user_id() contra "
    "la tabla 'permisos'). ESE FILTRO SOLO FUNCIONA al consultar vía las tools "
    "irex que pasan por el contexto del dataset — TODAS estas son rutas "
    "permitidas y respetan RLS: irex.query_dataset, irex.chart_option, "
    "irex.query_dataset_sql, irex.rank_partitions, irex.compare_periods, "
    "irex.export_to_excel, irex.forecast e irex.list_column_values. Las de "
    "análisis SQL (query_dataset_sql, export_to_excel en modo SQL) traen cada "
    "fuente vía el dataset con RLS aplicado y solo ejecutan SQL local de "
    "lectura sobre esos resultados ya filtrados. LO PROHIBIDO es SQL directo "
    "contra la base, SQL Lab o cualquier ruta fuera de estas tools: "
    "current_user_id() no se resuelve fuera del contexto del dataset "
    "y la condición de permisos quedaría en false, devolviendo 0 filas o error. "
    "Para preguntas de datos simples (sumas, conteos, agrupaciones, filtros) "
    "usar SIEMPRE irex.query_dataset — devuelve solo las filas, sin overhead. "
    "Para CUALQUIER pedido de gráfico/visualización ('gráfico', 'visualizar', "
    "'graficar en el tiempo', 'comparar X por Y') usar SIEMPRE irex.chart_option "
    "— devuelve un spec de Apache ECharts que se renderiza directo en el chat, "
    "sin guardar nada en Superset. "
    "Para cruzar dos o más consultas del mismo dataset o de datasets distintos "
    "(Pareto + cobertura, anti-joins tipo 'clientes sin venta de X', brechas "
    "entre métricas) usar irex.query_dataset_sql con 'extra_tables' — la "
    "fuente principal 'data' debe quedar AMPLIA (sin el filtro de la dimensión "
    "que se analiza) y ese filtro va SOLO en la extra_table. "
    "Ver 'query_template' para un ejemplo de payload ya armado — copiar y "
    "solo ajustar metrics/groupby/filters según la pregunta del usuario."
)

# Tools irex que consultan vía el contexto del dataset (ChartDataCommand /
# QueryContextFactory) y por lo tanto aplican el RLS Jinja. El backend del chat
# construye su allowlist por fuente desde business_rules.allowed_query_tools;
# el texto de _RLS_WARNING queda como respaldo legible (y fallback de parseo).
_ALLOWED_QUERY_TOOLS = [
    "irex.query_dataset",
    "irex.chart_option",
    "irex.query_dataset_sql",
    "irex.rank_partitions",
    "irex.compare_periods",
    "irex.export_to_excel",
    "irex.forecast",
    "irex.list_column_values",
]

_ACUMULO_RULE = (
    "PATRÓN ACUMULADO — para un acumulado de un período (ej. enero-junio), "
    "filtrar por RANGO usando la columna temporal del dataset: si es una "
    "columna de fecha ('fecha_id' u otra), usar >= primer día del período Y "
    "<= último día del período; si el dataset expone un número de mes "
    "('mes_id'), usar >= mes inicial Y <= mes final. El acumulado es la SUMA "
    "de las filas de todo ese rango — sumar el metric normalmente sobre esas "
    "filas (sin agrupar por mes si se quiere el total único del período). "
    "Ejemplo acumulado enero-junio con columna de fecha: "
    "filters=[{'column':'fecha_id','op':'>=','value':'2026-01-01'}, "
    "{'column':'fecha_id','op':'<=','value':'2026-06-30'}], "
    "metrics=['SUM(metric)']. "
    "Ejemplo equivalente con columna de mes: "
    "filters=[{'column':'mes_id','op':'>=','value':1}, "
    "{'column':'mes_id','op':'<=','value':6}]. "
    "NO usar columnas tipo 'bandera'/'flag' que parezcan traer un total ya "
    "pre-calculado (valores como 'Acumula'/'No acumula') — sumar siempre las "
    "filas del rango, nunca depender de un valor especial que diga "
    "representar el acumulado ya resuelto."
)

_DEFAULT_FILTERS_RULE = (
    "IMPORTANTE — 'default_filters': estos filtros se deben incluir SIEMPRE "
    "en la consulta (irex.query_dataset/irex.chart_option), salvo que: "
    "(a) el usuario pida explícitamente otro valor para esa columna (ej. "
    "'dame esto en dólares' -> usar medida=Dol en vez del default), o "
    "(b) el usuario esté navegando dentro de un dashboard de Superset que ya "
    "tenga un filtro nativo activo para esa misma columna — en ese caso usar "
    "el valor del filtro del dashboard, no el default de aquí. "
    "La columna 'medida' (valores típicos: Cjs, Col, Dol, Kg) aparece en casi "
    "todos los datasets/dashboards de la empresa y SIEMPRE debe filtrarse "
    "explícitamente con alguno de estos criterios — nunca dejarla sin filtrar."
)


def _build_domain_contexts() -> dict[str, dict[str, Any]]:
    """Arma DOMAIN_CONTEXTS con los dataset_id/database_id del entorno actual.

    Configurables vía superset_config.py:
      IREX_VENTAS_PEDIDOS_DATASET_ID / IREX_VENTAS_PEDIDOS_DATABASE_ID
      IREX_PNS_DATASET_ID / IREX_PNS_DATABASE_ID
    """
    vp_dataset_id = current_app.config.get(
        "IREX_VENTAS_PEDIDOS_DATASET_ID", _DEFAULT_VENTAS_PEDIDOS_DATASET_ID
    )
    vp_database_id = current_app.config.get(
        "IREX_VENTAS_PEDIDOS_DATABASE_ID", _DEFAULT_VENTAS_PEDIDOS_DATABASE_ID
    )
    pns_dataset_id = current_app.config.get(
        "IREX_PNS_DATASET_ID", _DEFAULT_PNS_DATASET_ID
    )
    pns_database_id = current_app.config.get(
        "IREX_PNS_DATABASE_ID", _DEFAULT_PNS_DATABASE_ID
    )

    return {
        "ventas": {
            "dataset_id": vp_dataset_id,
            "dataset_name": "Resumen Comercial Ventas-Pedidos-Forecast (con permisos)",
            "database_id": vp_database_id,
            "database_name": _DATABASE_NAME,
            "is_virtual": True,
            "key_columns": [
                "fecha_id",
                "vendedor_nombre",
                "cliente_id",
                "nombre_cliente",
                "empresa_nombre",
                "pais_nombre",
                "canal_nombre",
                "area_comercial_nombre",
                "producto_id",
                "producto_nombre",
                "marca_nombre",
                "familia_nombre",
                "segmento_nombre",
                "clasificacion_abc",
                "medida",
                "sell_in",
                "planv",
                "enfirme",
                "forecast",
                "pns",
                "cuota",
            ],
            "key_metrics": ["count"],
            "default_filters": [
                {"column": "medida", "op": "==", "value": "Cjs"},
            ],
            "allowed_query_tools": _ALLOWED_QUERY_TOOLS,
            "notes": (
                f"{_RLS_WARNING} {_DEFAULT_FILTERS_RULE} "
                "Usar 'sell_in' para ventas directas. NO tiene 'sell_out' (ventas "
                "indirectas) — esa columna no existe en este dataset; si el usuario "
                "pide sell_out, indicar que no está disponible en el entorno actual. "
                "'forecast' y 'planv' son proyección y plan; 'enfirme' es demanda "
                "en firme; 'pns' = Pedidos No Satisfechos (productos pedidos por un "
                "cliente que no se despacharon). 'fecha_id' es la columna temporal."
            ),
            "query_template": {
                "tool": "irex.query_dataset",
                "description": (
                    "Ejemplo: ventas (sell_in) agrupadas por país, este mes, con "
                    "el default_filter de medida='Cjs' ya incluido. Reemplazar "
                    "'metrics'/'groupby'/filtro de fecha según la pregunta. "
                    "Cambiar 'pais_nombre' por cualquier otra columna de "
                    "key_columns para agrupar distinto (ej. marca_nombre, "
                    "vendedor_nombre)."
                ),
                "request": {
                    "dataset_id": vp_dataset_id,
                    "metrics": ["SUM(sell_in)"],
                    "groupby": ["pais_nombre"],
                    "filters": [
                        {
                            "column": "fecha_id",
                            "op": ">=",
                            "value": "<primer_dia_del_mes_actual_YYYY-MM-DD>",
                        },
                        {"column": "medida", "op": "==", "value": "Cjs"},
                    ],
                    "row_limit": 100,
                },
            },
            "acumulado_pattern": _ACUMULO_RULE,
            "example_questions": [
                "¿Cuánto vendimos este mes?",
                "¿Cuál es el forecast vs plan por marca?",
                "Top 10 clientes por sell_in",
            ],
        },
        "pedidos": {
            "dataset_id": vp_dataset_id,
            "dataset_name": "Resumen Comercial Ventas-Pedidos-Forecast (con permisos)",
            "database_id": vp_database_id,
            "database_name": _DATABASE_NAME,
            "is_virtual": True,
            "key_columns": [
                "fecha_id",
                "cliente_id",
                "nombre_cliente",
                "empresa_nombre",
                "pais_nombre",
                "canal_nombre",
                "producto_id",
                "producto_nombre",
                "marca_nombre",
                "familia_nombre",
                "segmento_nombre",
                "area_comercial_nombre",
                "medida",
                "pedido",
                "pns",
            ],
            "key_metrics": ["count"],
            "default_filters": [
                {"column": "medida", "op": "==", "value": "Cjs"},
            ],
            "allowed_query_tools": _ALLOWED_QUERY_TOOLS,
            "notes": (
                f"{_RLS_WARNING} {_DEFAULT_FILTERS_RULE} "
                "La columna 'pedido' es CANTIDAD PEDIDA AGREGADA por cliente, "
                "producto y mes (suma de cantidad_pedida) — NO es un ID de pedido "
                "individual ni incluye estado/fecha de entrega de una orden "
                "específica. Para ese nivel de detalle (pedido por pedido, con "
                "estado e inventario_afectado) no hay un dataset disponible "
                "actualmente; avisar al usuario si pide ese nivel de detalle. "
                "'pns' = Pedidos No Satisfechos (cantidad pedida que no se "
                "despachó)."
            ),
            "query_template": {
                "tool": "irex.query_dataset",
                "description": (
                    "Ejemplo: cantidad pedida (suma de 'pedido') agrupada por "
                    "país, este mes, con el default_filter de medida='Cjs' ya "
                    "incluido. Reemplazar 'metrics'/'groupby'/filtro de fecha "
                    "según la pregunta. Cambiar 'pais_nombre' por otra columna "
                    "de key_columns para agrupar distinto (ej. producto_nombre, "
                    "marca_nombre)."
                ),
                "request": {
                    "dataset_id": vp_dataset_id,
                    "metrics": ["SUM(pedido)"],
                    "groupby": ["pais_nombre"],
                    "filters": [
                        {
                            "column": "fecha_id",
                            "op": ">=",
                            "value": "<primer_dia_del_mes_actual_YYYY-MM-DD>",
                        },
                        {"column": "medida", "op": "==", "value": "Cjs"},
                    ],
                    "row_limit": 100,
                },
            },
            "acumulado_pattern": _ACUMULO_RULE,
            "example_questions": [
                "¿Cuántas unidades se pidieron este mes por producto?",
                "¿Qué clientes tienen más Pedidos No Satisfechos (pns)?",
            ],
        },
        "pns": {
            "dataset_id": pns_dataset_id,
            "dataset_name": "Base PNS V3",
            "database_id": pns_database_id,
            "database_name": _DATABASE_NAME,
            "is_virtual": True,
            "key_columns": [
                "fecha_id",
                "responsable_nombre",
                "jefe_marca",
                "area_comercial_nombre",
                "empresa_nombre",
                "pais_nombre",
                "producto_nombre",
                "marca_nombre",
                "familia_nombre",
                "segmento_nombre",
                "clasificacion_abc",
                "causa_nombre",
                "medida",
                "afecta_indicador",
                "pns",
                "pns_cjs",
                "pns_col",
                "sell_in",
                "nivel_servicio",
            ],
            "key_metrics": ["count"],
            "default_filters": [
                {"column": "afecta_indicador", "op": "==", "value": "Si"},
                {"column": "medida", "op": "==", "value": "Cjs"},
                {
                    "column": "empresa_nombre",
                    "op": "==",
                    "value": "1-Irex de Costa Rica S.A.-Colones",
                },
            ],
            "allowed_query_tools": _ALLOWED_QUERY_TOOLS,
            "notes": (
                f"{_RLS_WARNING} {_DEFAULT_FILTERS_RULE} "
                "PNS = Pedidos No Satisfechos: cantidad que un cliente pidió y NO "
                "se le despachó. 'afecta_indicador'=Si filtra los casos que SÍ "
                "cuentan para el indicador oficial de nivel de servicio (excluye "
                "causas que no son responsabilidad de la empresa, ej. cliente "
                "canceló) — sin este filtro el número de PNS queda inflado e "
                "incorrecto. 'pns_cjs'/'pns_col' son el mismo PNS ya separado por "
                "unidad de medida (cajas/colones) — si 'medida' ya está filtrada, "
                "usar la columna 'pns' genérica, no pns_cjs/pns_col. "
                "'causa_nombre' explica el motivo del incumplimiento. "
                "'nivel_servicio' es el % de cumplimiento (no PNS en sí)."
            ),
            "query_template": {
                "tool": "irex.query_dataset",
                "description": (
                    "Ejemplo: PNS agrupado por causa, este mes, con los 3 "
                    "default_filters ya incluidos (afecta_indicador, medida, "
                    "empresa_nombre). Reemplazar 'metrics'/'groupby'/filtro de "
                    "fecha según la pregunta."
                ),
                "request": {
                    "dataset_id": pns_dataset_id,
                    "metrics": ["SUM(pns)"],
                    "groupby": ["causa_nombre"],
                    "filters": [
                        {
                            "column": "fecha_id",
                            "op": ">=",
                            "value": "<primer_dia_del_mes_actual_YYYY-MM-DD>",
                        },
                        {"column": "afecta_indicador", "op": "==", "value": "Si"},
                        {"column": "medida", "op": "==", "value": "Cjs"},
                        {
                            "column": "empresa_nombre",
                            "op": "==",
                            "value": "1-Irex de Costa Rica S.A.-Colones",
                        },
                    ],
                    "row_limit": 100,
                },
            },
            "example_questions": [
                "¿Cuál es el PNS de este mes por causa?",
                "¿Qué marcas tienen más Pedidos No Satisfechos?",
                "¿Cuál es el nivel de servicio por área comercial?",
            ],
        },
    }


class BusinessContextRequest(BaseModel):
    domain: str = Field(
        ...,
        description=(
            "Dominio de negocio a consultar. Valores disponibles: "
            + ", ".join(_DOMAIN_NAMES)
        ),
    )


@tool(
    name="irex.business_context",
    description=(
        "FALLBACK — usar solo si irex.get_query_context no fue llamado o no "
        "devolvió 'business_rules'. En condiciones normales, get_query_context "
        "con 'domain' ya incluye esta información en su respuesta. "
        "Devuelve el contexto de negocio (dataset_id, columnas clave, "
        "métricas, filtros por defecto y reglas) para 'ventas', 'pedidos' "
        "o 'pns'. Incluye 'query_template' listo para irex.query_dataset y "
        "el aviso de RLS con la lista de tools irex permitidas para consultar."
    ),
    tags=["irex", "negocio", "ventas", "pedidos", "pns", "glosario", "contexto"],
)
def business_context(request: BusinessContextRequest) -> dict[str, Any]:
    return get_business_context_data(request.domain)


def get_business_context_data(domain: str) -> dict[str, Any]:
    """Lógica reusable de irex.business_context — usada también por
    irex.get_query_context para consolidar varias llamadas en una."""
    domain = domain.strip().lower()
    contexts = _build_domain_contexts()
    ctx = contexts.get(domain)
    if ctx is None:
        return {
            "status": "not_found",
            "available_domains": _DOMAIN_NAMES,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    return {
        "status": "success",
        "domain": domain,
        "context": ctx,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
