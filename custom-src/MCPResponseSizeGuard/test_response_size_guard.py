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

"""Regression tests for configuration-owned SQL Lab MCP response limits."""

import asyncio
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastmcp.exceptions import ToolError

from superset.mcp_service.middleware import (
    ResponseSizeGuardMiddleware,
    create_response_size_guard_middleware,
)

EXPLAIN = "extensions.irex.irex-mcp-tools.irex.explain_query"
QUERY = "extensions.irex.irex-mcp-tools.irex.query_dataset"


def context(name: str, arguments: dict[str, Any] | None = None) -> SimpleNamespace:
    """Build a middleware request without a Flask application context."""
    return SimpleNamespace(
        message=SimpleNamespace(name=name, arguments=arguments, params={})
    )


@pytest.mark.asyncio
async def test_concurrent_sql_lab_and_chat_keep_their_own_limits() -> None:
    """A large SQL plan passes without increasing another request's limit."""
    guard = ResponseSizeGuardMiddleware(tool_token_limits={EXPLAIN: 50_000})
    response = {"plan": "x" * 140_000}
    with (
        patch("superset.mcp_service.middleware.get_user_id", return_value=1),
        patch(
            "superset.mcp_service.middleware.event_logger.log",
        ),
    ):
        results = await asyncio.gather(
            guard.on_call_tool(context(EXPLAIN), AsyncMock(return_value=response)),
            guard.on_call_tool(context(QUERY), AsyncMock(return_value=response)),
            return_exceptions=True,
        )
    assert results[0] == response
    assert isinstance(results[1], ToolError)
    assert "25,000" in str(results[1])
    assert guard.token_limit == 25_000
    assert guard.warn_threshold == 20_000


@pytest.mark.asyncio
async def test_proxy_sql_lab_limit_is_still_bounded() -> None:
    """The generic proxy resolves the configured target and blocks above 50k."""
    guard = ResponseSizeGuardMiddleware(tool_token_limits={EXPLAIN: 50_000})
    proxy = context("call_tool", {"name": EXPLAIN, "arguments": {}})
    response = {"plan": "x" * 140_000}
    assert await guard.on_call_tool(proxy, AsyncMock(return_value=response)) == response
    with (
        patch("superset.mcp_service.middleware.get_user_id", return_value=1),
        patch(
            "superset.mcp_service.middleware.event_logger.log",
        ),
        pytest.raises(ToolError, match="50,000"),
    ):
        await guard.on_call_tool(proxy, AsyncMock(return_value={"plan": "x" * 180_000}))


def test_factory_loads_per_tool_limits_and_rejects_invalid_values() -> None:
    """Only positive integer limits in server configuration become overrides."""
    app = MagicMock()
    app.config.get.return_value = {
        "enabled": True,
        "token_limit": 25_000,
        "tool_token_limits": {
            EXPLAIN: 50_000,
            "bad_bool": True,
            "bad_negative": -1,
            "bad_string": "50000",
        },
    }
    with patch("superset.mcp_service.flask_singleton.get_flask_app", return_value=app):
        guard = create_response_size_guard_middleware()
    assert guard is not None
    assert guard.tool_token_limits == {EXPLAIN: 50_000}
    assert guard.token_limit == 25_000
