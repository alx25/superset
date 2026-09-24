"""Lógica pura del reenvío del asistente de SQL Lab (REST API de la
extensión, Fase 6). La vista Flask (`assistant_api.py`) se prueba contra el
Superset de test real, no acá."""

import json

from irex.irex_mcp_tools._assistant_proxy import (
    EXPLORE_UPSTREAM_PATH,
    build_upstream_headers,
    explore_datasource_id,
    has_explore_permissions,
    has_explore_dataset_access,
    prepare_explore_body,
    filter_response_headers,
    has_required_role,
    upstream_url,
    with_environment_mcp_url,
)


def _headers(incoming):
    return build_upstream_headers(
        incoming,
        service_secret="s3cr3t",
        username="ana",
        email="ana@example.invalid",
        display_name="Ana Pérez",
    )


class TestUpstreamHeaders:
    def test_only_whitelisted_browser_headers_are_forwarded(self):
        headers = _headers(
            {
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
                "Cookie": "session=secreta-de-superset",
                "Authorization": "Bearer x",
                "X-CSRFToken": "abc",
                "Host": "superset",
            }
        )
        assert headers["Content-Type"] == "application/json"
        assert headers["Accept"] == "text/event-stream"
        for dropped in ("Cookie", "Authorization", "X-CSRFToken", "Host"):
            assert dropped not in headers

    def test_identity_comes_from_server_session_not_browser(self):
        headers = _headers(
            {
                "X-Superset-User": "admin",
                "X-Superset-User-Email": "admin@x",
                "X-Service-Secret": "falsificado",
            }
        )
        assert headers["X-Superset-User"] == "ana"
        assert headers["X-Superset-User-Email"] == "ana@example.invalid"
        assert headers["X-Superset-User-Display-Name"] == "Ana Pérez"
        assert headers["X-Service-Secret"] == "s3cr3t"

    def test_no_secret_configured_means_no_secret_header(self):
        headers = build_upstream_headers(
            {}, service_secret="", username="ana", email=None, display_name=None
        )
        assert "X-Service-Secret" not in headers
        assert headers["X-Superset-User-Email"] == ""


class TestRoleAndUrl:
    def test_without_required_role_everyone_authenticated_passes(self):
        assert has_required_role("", ["Gamma"]) is True
        assert has_required_role(None, []) is True

    def test_required_role_must_be_present(self):
        assert has_required_role("acceso chat", ["Gamma", "acceso chat"]) is True
        assert has_required_role("acceso chat", ["Gamma", "sql_lab"]) is False

    def test_upstream_url(self):
        assert (
            upstream_url("http://chat:8008/")
            == "http://chat:8008/api/sql-lab-assistant"
        )
        assert upstream_url("  ") is None
        assert upstream_url(None) is None


def test_response_headers_drop_hop_by_hop_and_stale_length():
    kept = filter_response_headers(
        [
            ("Content-Type", "text/event-stream"),
            ("Content-Length", "10"),
            ("Transfer-Encoding", "chunked"),
            ("Content-Encoding", "gzip"),
            ("Connection", "keep-alive"),
            ("Cache-Control", "no-cache"),
        ]
    )
    assert kept == [
        ("Content-Type", "text/event-stream"),
        ("Cache-Control", "no-cache"),
    ]


class TestEnvironmentMcpUrl:
    """El MCP de destino lo fija el servidor (MCP_WIDGET_URL de su entorno), no
    el navegador. Caso real: sin esto, pedidos de producción iban al MCP de
    test ("Database with ID 11 not found", 2026-09-23)."""

    def test_adds_environment_mcp_url(self):
        body = json.dumps({"contract_version": 1, "user_message": "hola"}).encode()
        out = json.loads(with_environment_mcp_url(body, "http://mcp-prod:5008/"))
        assert out == {
            "contract_version": 1,
            "user_message": "hola",
            "mcp_url": "http://mcp-prod:5008",
        }

    def test_overrides_value_sent_by_browser(self):
        body = json.dumps({"mcp_url": "http://mcp-de-test:5009"}).encode()
        assert (
            json.loads(with_environment_mcp_url(body, "http://mcp-prod:5008"))[
                "mcp_url"
            ]
            == "http://mcp-prod:5008"
        )

    def test_without_config_body_is_untouched(self):
        body = b'{"mcp_url": "x"}'
        assert with_environment_mcp_url(body, None) is body
        assert with_environment_mcp_url(body, "") is body

    def test_non_object_or_invalid_json_is_untouched(self):
        for body in (b"[1, 2]", b"no es json", b""):
            assert with_environment_mcp_url(body, "http://mcp-prod:5008") == body

    def test_preserves_non_ascii(self):
        body = json.dumps({"user_message": "año"}, ensure_ascii=False).encode()
        assert (
            json.loads(with_environment_mcp_url(body, "http://m"))["user_message"]
            == "año"
        )


class TestExploreProxy:
    def test_upstream_path_is_fixed_and_not_arbitrary(self):
        assert (
            upstream_url("http://chat:8008/", EXPLORE_UPSTREAM_PATH)
            == "http://chat:8008/api/explore-assistant"
        )
        try:
            upstream_url("http://chat:8008/", "/api/other")
        except ValueError:
            pass
        else:
            raise AssertionError("La ruta arbitraria no fue rechazada")

    def test_denies_each_missing_explore_permission(self):
        required = {
            ("can_explore", "Superset"),
            ("can_read", "Chart"),
            ("can_read", "Dataset"),
        }
        assert has_explore_permissions(
            lambda permission, view: (permission, view) in required
        )
        for missing in required:
            assert not has_explore_permissions(
                lambda permission, view: (permission, view) in required - {missing}
            )

    def test_spoofed_admin_and_mcp_are_replaced(self):
        body = json.dumps(
            {
                "source": "superset_explore",
                "user": {"is_admin": True},
                "mcp_url": "https://atacante.example/mcp",
                "form_data": {"viz_type": "table"},
            }
        ).encode()
        clean = json.loads(
            prepare_explore_body(body, is_admin=False, mcp_url="http://mcp-test:5009/")
        )
        assert clean["user"] == {"is_admin": False}
        assert clean["mcp_url"] == "http://mcp-test:5009"
        assert clean["form_data"] == {"viz_type": "table"}
        incoming = {"X-Superset-Is-Admin": "true", "X-Superset-User": "admin"}
        headers = _headers(incoming)
        assert "X-Superset-Is-Admin" not in headers
        assert headers["X-Superset-User"] == "ana"

    def test_invalid_body_or_missing_mcp_never_reaches_upstream(self):
        for body, mcp_url in (
            (b"no es json", "http://mcp-test"),
            (b"{}", "http://mcp-test"),
            (b'{"source":"superset_sqllab"}', "http://mcp-test"),
            (b'{"source":"superset_explore"}', ""),
        ):
            try:
                prepare_explore_body(body, is_admin=False, mcp_url=mcp_url)
            except ValueError:
                pass
            else:
                raise AssertionError("El body inválido no fue rechazado")


def test_explore_dataset_id_must_be_a_positive_integer():
    assert explore_datasource_id(b'{"chart":{"datasource":{"id":11}}}') == 11
    for body in (
        b'{"chart":{"datasource":{"id":0}}}',
        b'{"chart":{"datasource":{"id":true}}}',
        b'{"chart":{"datasource":{"id":"11"}}}',
        b'{"chart":{}}',
    ):
        try:
            explore_datasource_id(body)
        except ValueError:
            pass
        else:
            raise AssertionError("Dataset inválido aceptado")


def test_explore_dataset_gate_rejects_missing_or_denied_dataset():
    dataset = object()
    assert has_explore_dataset_access(11, lambda _: dataset, lambda _: True)
    assert not has_explore_dataset_access(11, lambda _: None, lambda _: True)
    assert not has_explore_dataset_access(11, lambda _: dataset, lambda _: False)
