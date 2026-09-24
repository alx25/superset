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
"""Pruebas de la verificación del query_context capturado por el navegador
contra el estado de Explore ya verificado por `irex.get_explore_state`."""

import json

import pytest

from irex.irex_mcp_tools.explore_query_context_core import (
    capped_queries,
    parse_query_context,
    verify_query_context_matches_state,
)


def raw_query_context(**overrides):
    base = {
        "datasource": {"id": 11, "type": "table"},
        "result_type": "full",
        "result_format": "json",
        "queries": [{"metrics": ["count"], "row_limit": 5000}],
        "form_data": {"viz_type": "table_v3", "slice_id": 682},
    }
    base.update(overrides)
    return json.dumps(base)


def verified_state(**overrides):
    base = {
        "form_data_key": "key-1",
        "slice_id": 682,
        "datasource": {"id": 11, "type": "table"},
        "form_data": {"viz_type": "table_v3"},
        "state_kind": "last_persisted",
        "user": {"is_admin": False},
    }
    base.update(overrides)
    return base


class TestParseQueryContext:
    def test_json_valido_pasa(self):
        parsed = parse_query_context(raw_query_context())
        assert parsed["datasource"] == {"id": 11, "type": "table"}
        assert parsed["queries"][0]["metrics"] == ["count"]

    def test_json_invalido_rechazado(self):
        with pytest.raises(ValueError, match="no es JSON válido"):
            parse_query_context("{not valid json")

    def test_no_objeto_rechazado(self):
        with pytest.raises(ValueError, match="debe ser un objeto"):
            parse_query_context("[1, 2, 3]")

    @pytest.mark.parametrize(
        "overrides,expected",
        [
            ({"datasource": "not-a-dict"}, "sin datasource"),
            ({"queries": []}, "sin queries"),
            ({"queries": "not-a-list"}, "sin queries"),
            ({"queries": [1, 2]}, "sin queries"),
            ({"form_data": "not-a-dict"}, "sin form_data"),
        ],
    )
    def test_forma_invalida_rechazada(self, overrides, expected):
        with pytest.raises(ValueError, match=expected):
            parse_query_context(raw_query_context(**overrides))


class TestVerifyQueryContextMatchesState:
    def test_mismo_dataset_y_grafico_pasa(self):
        qc = parse_query_context(raw_query_context())
        verify_query_context_matches_state(qc, verified_state())  # no lanza

    def test_dataset_id_distinto_rechazado(self):
        qc = parse_query_context(raw_query_context(datasource={"id": 99, "type": "table"}))
        with pytest.raises(ValueError, match="no corresponde al dataset"):
            verify_query_context_matches_state(qc, verified_state())

    def test_tipo_de_datasource_distinto_rechazado(self):
        qc = parse_query_context(raw_query_context(datasource={"id": 11, "type": "query"}))
        with pytest.raises(ValueError, match="no corresponde al dataset"):
            verify_query_context_matches_state(qc, verified_state())

    def test_slice_id_distinto_rechazado_cuando_ambos_lo_declaran(self):
        qc = parse_query_context(raw_query_context(form_data={"viz_type": "table_v3", "slice_id": 999}))
        with pytest.raises(ValueError, match="no corresponde al gráfico"):
            verify_query_context_matches_state(qc, verified_state(slice_id=682))

    def test_grafico_sin_guardar_no_exige_slice_id_en_el_query_context(self):
        # slice_id=None en el estado verificado (gráfico nuevo): el
        # query_context capturado tampoco lo trae — no hay nada que comparar.
        qc = parse_query_context(raw_query_context(form_data={"viz_type": "table_v3"}))
        verify_query_context_matches_state(qc, verified_state(slice_id=None))  # no lanza

    def test_estado_sin_slice_id_pero_query_context_si_no_rechaza(self):
        # El estado no tiene slice_id (ej. se leyó form_data antes de que
        # Explore terminara de asociarlo) pero el query_context sí — no hay
        # contradicción que detectar, se deja pasar (RLS decide en la
        # ejecución real).
        qc = parse_query_context(raw_query_context())
        verify_query_context_matches_state(qc, verified_state(slice_id=None))  # no lanza


class TestCappedQueries:
    def test_recorta_al_limite_pedido(self):
        qc = parse_query_context(raw_query_context(queries=[{"row_limit": 5000}]))
        assert capped_queries(qc, 100)[0]["row_limit"] == 100

    def test_no_sube_un_limite_menor_al_pedido(self):
        qc = parse_query_context(raw_query_context(queries=[{"row_limit": 20}]))
        assert capped_queries(qc, 100)[0]["row_limit"] == 20

    def test_sin_row_limit_propio_usa_el_pedido(self):
        qc = parse_query_context(raw_query_context(queries=[{"metrics": ["count"]}]))
        assert capped_queries(qc, 250)[0]["row_limit"] == 250

    def test_row_limit_invalido_usa_el_pedido(self):
        qc = parse_query_context(raw_query_context(queries=[{"row_limit": 0}]))
        assert capped_queries(qc, 250)[0]["row_limit"] == 250
        qc2 = parse_query_context(raw_query_context(queries=[{"row_limit": -5}]))
        assert capped_queries(qc2, 250)[0]["row_limit"] == 250

    def test_no_muta_el_query_context_original(self):
        qc = parse_query_context(raw_query_context(queries=[{"row_limit": 5000}]))
        capped_queries(qc, 100)
        assert qc["queries"][0]["row_limit"] == 5000

    def test_multiples_queries_cada_una_se_recorta(self):
        qc = parse_query_context(raw_query_context(queries=[{"row_limit": 5000}, {"row_limit": 10}]))
        result = capped_queries(qc, 100)
        assert [q["row_limit"] for q in result] == [100, 10]
