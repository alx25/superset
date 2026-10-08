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

"""Apply the canonical per-tool MCP response guard patch to a Superset tree."""

from pathlib import Path
import sys


def refine_guard(source: str) -> str:
    """Keep per-request limit selection outside the main guard's complexity."""
    if "    def _request_token_limit(" in source:
        return source
    start = source.index(
        "        target_name = tool_name\n",
        source.index("class ResponseSizeGuardMiddleware"),
    )
    end = source.index("        if limit != self.token_limit:", start)
    source = (
        source[:start]
        + "        limit = self._request_token_limit(context)\n"
        + source[end:]
    )
    helper = '''    def _request_token_limit(self, context: MiddlewareContext) -> int:
        """Resolve trusted configuration for direct tools and proxy targets."""
        target = getattr(context.message, "name", "unknown")
        if target == "call_tool":
            arguments = getattr(context.message, "arguments", None)
            if isinstance(arguments, dict) and isinstance(arguments.get("name"), str):
                target = arguments["name"]
        return self.tool_token_limits.get(target, self.token_limit)

'''
    anchor = "    def _try_truncate_info_response(\n"
    return source.replace(anchor, helper + anchor, 1)


def patch_guard(root: Path) -> None:
    """Add trusted per-tool limits without changing the global guard default."""
    path = root / "superset/mcp_service/middleware.py"
    source = path.read_text()
    if "# IREX per-tool response limits" in source:
        updated = refine_guard(source)
        if updated != source:
            compile(updated, str(path), "exec")
            path.write_text(updated)
        print("MCP per-tool response guard already patched")
        return
    offset = source.index("class ResponseSizeGuardMiddleware(")
    prefix, body = source[:offset], source[offset:]
    replacements = [
        (
            "        excluded_tools: list[str] | str | None = None,\n",
            "        excluded_tools: list[str] | str | None = None,\n"
            "        tool_token_limits: dict[str, int] | None = None,\n",
        ),
        (
            "        self.excluded_tools = set(excluded_tools or [])\n",
            "        self.excluded_tools = set(excluded_tools or [])\n"
            "        # IREX per-tool response limits: configuration only, never client metadata.\n"
            "        self.tool_token_limits = {\n"
            "            name: limit for name, limit in (tool_token_limits or {}).items()\n"
            "            if isinstance(name, str) and isinstance(limit, int)\n"
            "            and not isinstance(limit, bool) and limit > 0\n"
            "        }\n",
        ),
        (
            "        # Execute the tool\n        response = await call_next(context)\n",
            "        # Select an independent guard per request; shared middleware must not\n"
            "        # mutate its token limit while other tool calls run concurrently.\n"
            "        target_name = tool_name\n"
            '        if tool_name == "call_tool":\n'
            '            arguments = getattr(context.message, "arguments", None)\n'
            '            if isinstance(arguments, dict) and isinstance(arguments.get("name"), str):\n'
            '                target_name = arguments["name"]\n'
            "        limit = self.tool_token_limits.get(target_name, self.token_limit)\n"
            "        if limit != self.token_limit:\n"
            "            guard = ResponseSizeGuardMiddleware(\n"
            "                token_limit=limit, warn_threshold_pct=self.warn_threshold_pct,\n"
            "                excluded_tools=list(self.excluded_tools),\n"
            "            )\n"
            "            return await guard.on_call_tool(context, call_next)\n\n"
            "        # Execute the tool\n        response = await call_next(context)\n",
        ),
        (
            '            excluded_tools=config.get("excluded_tools"),\n',
            '            excluded_tools=config.get("excluded_tools"),\n'
            '            tool_token_limits=config.get("tool_token_limits"),\n',
        ),
    ]
    for old, new in replacements:
        if body.count(old) != 1:
            raise RuntimeError("Superset response guard changed; patch requires review")
        body = body.replace(old, new, 1)
    updated = refine_guard(prefix + body)
    compile(updated, str(path), "exec")
    path.write_text(updated)
    print("Patched MCP response guard with configuration-owned per-tool limits")


if __name__ == "__main__":
    patch_guard(Path(sys.argv[1]))
