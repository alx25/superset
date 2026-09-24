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
"""Pruebas de permisos y fidelidad de irex.get_explore_state."""

import json

import pytest

from irex.irex_mcp_tools.explore_state_core import verified_explore_state


@pytest.fixture
def state():
    return {
        "datasource_id": 11,
        "datasource_type": "table",
        "chart_id": 682,
        "form_data": json.dumps({"viz_type": "table_v3", "slice_id": 1187}),
    }


def resolve(state, *, can_access=None, check_access=None, is_admin=None):
    return verified_explore_state(
        "key-1",
        state,
        can_access=can_access or (lambda _permission, _view: True),
        check_access=check_access or (lambda _dataset_id, _chart_id, _type: True),
        is_admin=is_admin or (lambda: False),
    )


def test_uses_cache_chart_id_not_stale_form_data_slice_id(state):
    calls = []
    result = resolve(
        state,
        check_access=lambda dataset_id, chart_id, type_: calls.append(
            (dataset_id, chart_id, type_)
        ),
        is_admin=lambda: True,
    )
    assert calls == [(11, 682, "table")]
    assert result["slice_id"] == 682
    assert result["form_data"]["slice_id"] == 1187
    assert result["datasource"] == {"id": 11, "type": "table"}
    assert result["state_kind"] == "last_persisted"
    assert result["user"] == {"is_admin": True}


def test_unsaved_chart_has_null_slice_id(state):
    state["chart_id"] = None
    assert resolve(state)["slice_id"] is None


@pytest.mark.parametrize(
    "missing",
    [
        ("can_explore", "Superset"),
        ("can_read", "Chart"),
        ("can_read", "Dataset"),
    ],
)
def test_denies_each_missing_permission(state, missing):
    with pytest.raises(PermissionError):
        resolve(
            state, can_access=lambda permission, view: (permission, view) != missing
        )


def test_denies_dataset_or_chart_access(state):
    def denied(_dataset_id, _chart_id, _type):
        raise PermissionError("Acceso denegado")

    with pytest.raises(PermissionError):
        resolve(state, check_access=denied)


def test_missing_key_and_corrupt_state_never_return_verified_data(state):
    with pytest.raises(KeyError):
        resolve(None)
    state["form_data"] = "no json"
    with pytest.raises(ValueError):
        resolve(state)


def test_rejects_invalid_dataset_and_datasource_type(state):
    state["datasource_id"] = 0
    with pytest.raises(ValueError):
        resolve(state)
    state["datasource_id"] = 11
    state["datasource_type"] = "query"
    with pytest.raises(ValueError):
        resolve(state)
