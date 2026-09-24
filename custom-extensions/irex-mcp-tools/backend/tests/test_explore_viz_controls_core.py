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
"""Pruebas del catálogo de controles por viz_type de irex.get_viz_controls."""

import pytest

from irex.irex_mcp_tools.explore_viz_controls_core import (
    COMMON_CONTROLS,
    CUSTOM_PLUGIN_CONTROLS,
    resolve_viz_controls,
)


class TestPluginsPropios:
    @pytest.mark.parametrize("viz_type", ["table_v3", "html_cards", "pivot_table_rx1"])
    def test_source_specific_para_los_tres_plugins_propios(self, viz_type):
        result = resolve_viz_controls(viz_type)
        assert result["source"] == "specific"
        assert result["viz_type"] == viz_type
        assert "note" not in result

    def test_table_v3_incluye_sus_controles_propios_y_no_los_genericos_ajenos(self):
        result = resolve_viz_controls("table_v3")
        # propios de table_v3 (verificados en su controlPanel.tsx real)
        assert "column_config" in result["controls"]
        assert "server_pagination" in result["controls"]
        assert "row_grouping_column" in result["controls"]
        # controles genéricos de series temporales que table_v3 NO tiene —
        # no deben colarse por estar en COMMON_CONTROLS.
        assert "x_axis" not in result["controls"]
        assert "series" not in result["controls"]

    def test_html_cards_incluye_su_control_propio_handlebarstemplate(self):
        result = resolve_viz_controls("html_cards")
        assert "handlebarsTemplate" in result["controls"]
        assert "styleTemplate" in result["controls"]
        # no tiene paginación de servidor (eso es de table_v3)
        assert "server_pagination" not in result["controls"]

    def test_pivot_table_rx1_incluye_sus_controles_propios_de_tema(self):
        result = resolve_viz_controls("pivot_table_rx1")
        assert "table_theme_header_bg" in result["controls"]
        assert "metricFormulas" in result["controls"]
        assert "groupbyColumns" in result["controls"]
        assert "groupbyRows" in result["controls"]

    def test_las_listas_no_tienen_duplicados_y_estan_ordenadas(self):
        for viz_type in CUSTOM_PLUGIN_CONTROLS:
            controls = resolve_viz_controls(viz_type)["controls"]
            assert controls == sorted(set(controls))


class TestTiposNoVerificados:
    def test_tipo_nativo_devuelve_generico_con_nota(self):
        result = resolve_viz_controls("mixed_timeseries")
        assert result["source"] == "generic"
        assert result["viz_type"] == "mixed_timeseries"
        assert "no verificado específicamente" in result["note"]
        assert "mixed_timeseries" in result["note"]

    def test_generico_incluye_los_controles_compartidos_mas_comunes(self):
        result = resolve_viz_controls("echarts_timeseries_bar")
        for expected in ("metrics", "groupby", "adhoc_filters", "row_limit", "time_range", "x_axis"):
            assert expected in result["controls"]

    def test_viz_type_desconocido_o_inventado_tambien_cae_a_generico(self):
        result = resolve_viz_controls("algo_que_no_existe")
        assert result["source"] == "generic"

    def test_generico_es_exactamente_common_controls_ordenado(self):
        result = resolve_viz_controls("table")
        assert result["controls"] == sorted(COMMON_CONTROLS)


def test_common_controls_no_esta_vacio_y_no_tiene_nombres_de_plugins_propios():
    assert len(COMMON_CONTROLS) > 20
    # column_config/handlebarsTemplate/etc. son propios, no compartidos por Superset.
    assert "column_config" not in COMMON_CONTROLS
    assert "handlebarsTemplate" not in COMMON_CONTROLS
