"""Conversión de tools del MCP a los formatos de Ollama/Gemini, y helpers de MCP."""

import re

TOOL_NAME_RE = re.compile(r"^[a-zA-Z0-9_-]+$")

IREX_TOOL_PREFIX = "extensions.irex.irex-mcp-tools.irex."
ALLOWED_IREX_TOOL_NAMES = frozenset({
    f"{IREX_TOOL_PREFIX}get_query_context",
    f"{IREX_TOOL_PREFIX}query_dataset",
    f"{IREX_TOOL_PREFIX}query_dataset_sql",
    f"{IREX_TOOL_PREFIX}compare_periods",
    f"{IREX_TOOL_PREFIX}export_to_excel",
    f"{IREX_TOOL_PREFIX}chart_option",
    f"{IREX_TOOL_PREFIX}list_column_values",
    f"{IREX_TOOL_PREFIX}get_applied_filters",
    f"{IREX_TOOL_PREFIX}get_dashboard_dataset_context",
    f"{IREX_TOOL_PREFIX}search_dashboards",
    f"{IREX_TOOL_PREFIX}forecast",
})
ALLOWED_LLM_PROXY_NAMES = frozenset({"call_tool"})
COMPARE_PERIODS_TOOL_NAME = f"{IREX_TOOL_PREFIX}compare_periods"
QUERY_DATASET_SQL_TOOL_NAME = f"{IREX_TOOL_PREFIX}query_dataset_sql"


def is_allowed_irex_tool_name(name: str) -> bool:
    return str(name) in ALLOWED_IREX_TOOL_NAMES


def filter_allowed_mcp_tools(mcp_tools) -> list:
    """Reduce el inventario del LLM a Irex read-only mas el proxy controlado."""
    return [
        tool for tool in mcp_tools
        if str(tool.name) in ALLOWED_LLM_PROXY_NAMES
        or is_allowed_irex_tool_name(str(tool.name))
    ]

STRICT_CALL_TOOL_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {
            "type": "string",
            "description": "Nombre exacto de una herramienta Irex autorizada. No usar call_tool ni herramientas nativas de Superset.",
            "enum": sorted(ALLOWED_IREX_TOOL_NAMES),
            "minLength": 1,
        },
        "arguments": {
            "type": "object",
            "description": (
                "Argumentos de la herramienta Irex real usando {\"request\": {...}}."
            ),
            "properties": {
                "request": {
                    "type": "object",
                    "additionalProperties": True,
                }
            },
            "additionalProperties": True,
        },
    },
    "required": ["name", "arguments"],
    "additionalProperties": False,
}


def _tool_description(tool) -> str:
    description = tool.description or ""
    if str(tool.name) != "call_tool":
        return description
    guard = (
        " Requiere SIEMPRE name y arguments. Ejemplo: "
        "{\"name\":\"extensions.irex.irex-mcp-tools.irex.query_dataset\","
        "\"arguments\":{\"request\":{...}}}. Nunca usar argumentos vacíos."
    )
    return (description + guard).strip()


def _tool_input_schema(tool):
    if str(tool.name) == "call_tool":
        return STRICT_CALL_TOOL_SCHEMA
    return tool.inputSchema or {"type": "object", "properties": {}}

try:
    from google.genai import types as genai_types
except ImportError:  # pragma: no cover - opcional, solo si hay GOOGLE_API_KEY
    genai_types = None


def mcp_tools_to_ollama(mcp_tools) -> list[dict]:
    """Convierte la lista de tools del MCP al esquema de tools de Ollama."""
    tools = []
    for t in filter_allowed_mcp_tools(mcp_tools):
        if not TOOL_NAME_RE.fullmatch(t.name):
            continue
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": _tool_description(t),
                    # El inputSchema del MCP ya es JSON Schema, que es justo
                    # lo que Ollama espera en "parameters".
                    "parameters": _tool_input_schema(t),
                },
            }
        )
    return tools


def mcp_tools_to_gemini(mcp_tools) -> list["genai_types.Tool"]:
    """Convierte la lista de tools del MCP a Tool/FunctionDeclaration de Gemini.

    `parameters_json_schema` acepta el JSON Schema tal cual (el mismo
    `inputSchema` que ya usamos para Ollama), sin necesidad de traducirlo al
    `Schema` propio de Gemini.
    """
    declarations = []
    for t in filter_allowed_mcp_tools(mcp_tools):
        if not TOOL_NAME_RE.fullmatch(t.name):
            continue
        declarations.append(
            genai_types.FunctionDeclaration(
                name=t.name,
                description=_tool_description(t),
                parameters_json_schema=_tool_input_schema(t),
            )
        )
    return [genai_types.Tool(function_declarations=declarations)]


def _truncate(value: str, max_chars: int) -> str:
    value = value.strip()
    if len(value) <= max_chars:
        return value
    return value[:max_chars].rstrip() + "..."


def _format_keys(all_keys: list, max_keys: int = 25) -> str:
    """Lista los primeros max_keys nombres de parametro. Si hay mas, lo indica
    explicitamente en vez de cortar en silencio — un LLM que lea esta lista sin
    ese aviso asume que esta completa y nunca usa los parametros restantes
    (bug real: export_to_excel paso de 12 a 22 campos y los 10 nuevos quedaban
    invisibles para el modelo, que terminaba diciendole al usuario que la
    funcionalidad no existia)."""
    keys = ", ".join(str(key) for key in all_keys[:max_keys])
    remaining = len(all_keys) - max_keys
    if remaining > 0:
        keys += f", ... (+{remaining} mas — ver el JSON Schema completo de la tool)"
    return keys


def _schema_keys(schema) -> str:
    if not isinstance(schema, dict):
        return ""
    properties = schema.get("properties")
    if isinstance(properties, dict) and properties:
        if set(properties) == {"request"}:
            request_schema = properties.get("request")
            if isinstance(request_schema, dict):
                request_properties = request_schema.get("properties")
                if isinstance(request_properties, dict) and request_properties:
                    keys = _format_keys(list(request_properties))
                    return f"request.{{{keys}}}"
        return _format_keys(list(properties))
    return ""


def _find_property_schema(schema, property_name: str):
    if not isinstance(schema, dict):
        return None
    properties = schema.get("properties")
    if isinstance(properties, dict) and property_name in properties:
        return properties[property_name]
    if isinstance(properties, dict):
        for child in properties.values():
            found = _find_property_schema(child, property_name)
            if found is not None:
                return found
    for key in ("items", "oneOf", "anyOf", "allOf"):
        child = schema.get(key)
        if isinstance(child, dict):
            found = _find_property_schema(child, property_name)
            if found is not None:
                return found
        if isinstance(child, list):
            for item in child:
                found = _find_property_schema(item, property_name)
                if found is not None:
                    return found
    return None


def _schema_enum_values(schema) -> list[str]:
    if not isinstance(schema, dict):
        return []
    values = []
    enum_values = schema.get("enum")
    if isinstance(enum_values, list):
        values.extend(str(item) for item in enum_values if item is not None)
    const_value = schema.get("const")
    if const_value is not None:
        values.append(str(const_value))
    for key in ("oneOf", "anyOf", "allOf"):
        children = schema.get(key)
        if isinstance(children, list):
            for child in children:
                values.extend(_schema_enum_values(child))
    seen = set()
    return [value for value in values if not (value in seen or seen.add(value))]


def chart_type_values_from_tools(mcp_tools) -> list[str]:
    """Extrae los chart_type soportados desde el JSON Schema real del MCP."""
    values = []
    for tool in mcp_tools:
        name = str(tool.name)
        if not (name.endswith("irex.chart_option") or name.endswith(".chart_option")):
            continue
        chart_type_schema = _find_property_schema(tool.inputSchema, "chart_type")
        values.extend(_schema_enum_values(chart_type_schema))
    seen = set()
    return [value for value in values if not (value in seen or seen.add(value))]


def chart_types_list_answer(mcp_tools) -> str:
    """Respuesta local para tipos soportados por irex.chart_option."""
    values = chart_type_values_from_tools(mcp_tools)
    if not values:
        chart_tools = [
            f"`{tool.name}`"
            for tool in mcp_tools
            if str(tool.name).endswith("irex.chart_option") or str(tool.name).endswith(".chart_option")
        ]
        if chart_tools:
            return (
                "Encontré la tool de gráficos "
                + ", ".join(chart_tools)
                + ", pero su schema no expone una lista `enum` de `chart_type`. "
                "Puedo usar el tipo que me indiques y, si no está soportado, te devolveré el error concreto del MCP."
            )
        return "No encontré una tool `chart_option` disponible en esta sesión MCP."

    labels = {
        "bar": "Barras",
        "line": "Línea",
        "area": "Área",
        "pie": "Pastel / dona",
        "donut": "Dona",
        "scatter": "Dispersión",
        "table": "Tabla",
        "pivot": "Tabla cruzada / pivot",
        "heatmap": "Mapa de calor",
        "treemap": "Treemap",
        "funnel": "Embudo",
        "radar": "Radar",
        "gauge": "Indicador / gauge",
        "pareto": "Pareto",
        "boxplot": "Boxplot",
        "histogram": "Histograma",
    }
    rows = ["Estos son los `chart_type` que expone `irex.chart_option` en esta sesión MCP:\n"]
    for value in values:
        label = labels.get(value, value.replace("_", " ").title())
        rows.append(f"- **{label}** (`{value}`)")
    rows.append("\nPuedo renderizarlos inline en el chat cuando la tool devuelva `echarts_option` o `table_data`.")
    return "\n".join(rows)


def mcp_tools_inventory_prompt(mcp_tools) -> str:
    """Contexto textual con la allowlist efectiva de tools para el LLM."""
    lines = [
        "## Herramientas MCP disponibles en esta conexion",
        "Esta es la allowlist efectiva del chat. No existen otras herramientas autorizadas.",
        "Usa nombres exactos mediante call_tool. Nunca intentes descubrir ni invocar herramientas fuera de esta lista.",
    ]

    def priority(tool) -> tuple[int, str]:
        name = str(tool.name)
        if "irex-mcp-tools.irex.get_query_context" in name:
            return (0, name)
        if "irex-mcp-tools.irex.business_context" in name:
            return (1, name)
        if "irex-mcp-tools.irex.get_dashboard_dataset_context" in name:
            return (2, name)
        if "irex-mcp-tools.irex.get_applied_filters" in name:
            return (3, name)
        if "irex-mcp-tools.irex.list_column_values" in name:
            return (4, name)
        if "irex-mcp-tools.irex.query_dataset_sql" in name:
            return (7, name)
        if "irex-mcp-tools.irex.query_dataset" in name:
            return (5, name)
        if "irex-mcp-tools.irex.compare_periods" in name:
            return (6, name)
        if "irex-mcp-tools.irex.export_to_excel" in name:
            return (8, name)
        if "irex-mcp-tools.irex.chart_option" in name:
            return (9, name)
        return (9, name)

    allowed_tools = filter_allowed_mcp_tools(mcp_tools)
    visible_tools = [tool for tool in allowed_tools if str(tool.name) != "call_tool"]
    for tool in sorted(visible_tools, key=priority):
        name = str(tool.name)
        description = _truncate(tool.description or "", 110)
        input_keys = _schema_keys(tool.inputSchema)
        invalid_note = "" if TOOL_NAME_RE.fullmatch(name) else " [usar via call_tool]"
        detail = f"- `{name}`{invalid_note}"
        if description:
            detail += f": {description}"
        if input_keys:
            detail += f" Parametros: {input_keys}."
        if name.endswith("irex.chart_option") or name.endswith(".chart_option"):
            chart_types = chart_type_values_from_tools([tool])
            if chart_types:
                detail += " chart_type soportados: " + ", ".join(chart_types) + "."
        lines.append(detail)
    if not any(str(tool.name) == COMPARE_PERIODS_TOOL_NAME for tool in visible_tools):
        lines.append(
            f"- `{COMPARE_PERIODS_TOOL_NAME}` [usar via call_tool]: "
            "Compara métricas entre dos períodos, calcula variación porcentual en el servidor "
            "y evita dos query_dataset separados. Parametros: "
            "request.{dataset_id, metrics, groupby, period_a_filters, "
            "period_b_filters, min_variation_pct}."
        )
    return "\n".join(lines)


def mcp_tools_list_answer(mcp_tools) -> str:
    """Respuesta Markdown para pedidos explicitos de listar herramientas."""
    rows = [
        "| Tool MCP | Uso | Parametros principales |",
        "|---|---|---|",
    ]
    allowed_tools = filter_allowed_mcp_tools(mcp_tools)
    visible_tools = [tool for tool in allowed_tools if str(tool.name) != "call_tool"]
    for tool in visible_tools:
        name = str(tool.name)
        description = _truncate(tool.description or "", 120).replace("|", "\\|")
        input_keys = _schema_keys(tool.inputSchema).replace("|", "\\|")
        rows.append(f"| `{name}` | {description or '-'} | {input_keys or '-'} |")
    if not any(str(tool.name) == COMPARE_PERIODS_TOOL_NAME for tool in visible_tools):
        rows.append(
            f"| `{COMPARE_PERIODS_TOOL_NAME}` | Compara métricas entre dos períodos y calcula variación % server-side. | "
            "request.{dataset_id, metrics, groupby, period_a_filters, period_b_filters, min_variation_pct} |"
        )
    return "Estas son las tools disponibles que devolvio el MCP para esta sesion:\n\n" + "\n".join(rows)


def extract_text(mcp_result) -> str:
    """Aplana el contenido de una respuesta MCP a texto para el LLM."""
    parts = []
    for block in mcp_result.content:
        # Los bloques de texto tienen .text; otros tipos los serializamos.
        text = getattr(block, "text", None)
        parts.append(text if text is not None else str(block))
    return "\n".join(parts) if parts else "(sin contenido)"


async def check_health(session) -> str:
    """Hace un health_check directo contra el MCP (sin pasar por el LLM).

    Sirve como comprobación de conectividad al iniciar la sesión y evita
    que el LLM gaste un turno llamando a health_check para un simple saludo
    (ver SYSTEM_PROMPT).
    """
    try:
        result = await session.call_tool("health_check", {})
        return extract_text(result)
    except Exception as exc:  # noqa: BLE001
        return f"ERROR al ejecutar health_check: {exc}"
