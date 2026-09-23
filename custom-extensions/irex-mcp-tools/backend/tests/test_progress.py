"""Tests de `_progress.py` — el helper de heartbeat MCP compartido por
explain_query/check_query_nulls/get_sql_schema_context (progreso estándar
`notifications/progress` sin bloquear el event loop del servidor MCP).

No depende de `superset`/`fastmcp` — es puro `anyio` + stdlib, así que no
hace falta el stubbing de `sys.modules` que usan los otros tests.

Correr con:
  cd custom-extensions/irex-mcp-tools/backend
  ../../.venv/bin/python -m pytest tests/ -q
"""

import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from irex.irex_mcp_tools._progress import report_phase, run_with_heartbeat  # noqa: E402


class _FakeCtx:
    def __init__(self, raise_on_report=False):
        self.calls: list[tuple[int, float | None, str]] = []
        self._raise_on_report = raise_on_report

    async def report_progress(self, progress, total=None, message=None):
        if self._raise_on_report:
            raise RuntimeError("el cliente MCP no pidió progreso")
        self.calls.append((progress, total, message))


class TestReportPhase:
    def test_calls_ctx_report_progress_with_total_none(self):
        ctx = _FakeCtx()
        asyncio.run(report_phase(ctx, 3, "Validando la sentencia"))
        assert ctx.calls == [(3, None, "Validando la sentencia")]

    def test_noop_with_none_ctx(self):
        # No debe lanzar ni requerir nada más.
        asyncio.run(report_phase(None, 0, "cualquier cosa"))

    def test_swallows_ctx_exceptions(self):
        ctx = _FakeCtx(raise_on_report=True)
        # No debe propagar — un heartbeat que falla nunca tumba la operación real.
        asyncio.run(report_phase(ctx, 0, "mensaje"))


class TestRunWithHeartbeat:
    def test_returns_result_without_heartbeat_if_fast(self):
        ctx = _FakeCtx()

        def fast_operation():
            return "resultado"

        result = asyncio.run(
            run_with_heartbeat(
                ctx, fast_operation, heartbeat_message=lambda elapsed: f"{elapsed}s", interval=1.0
            )
        )
        assert result == "resultado"
        # Termina bien antes de que pase un intervalo completo -> cero heartbeats.
        assert ctx.calls == []

    def test_emits_heartbeats_for_slow_operation(self):
        ctx = _FakeCtx()

        def slow_operation():
            time.sleep(0.25)
            return "listo"

        result = asyncio.run(
            run_with_heartbeat(
                ctx,
                slow_operation,
                heartbeat_message=lambda elapsed: f"sigue en ejecución; {elapsed}s transcurridos",
                interval=0.05,
            )
        )
        assert result == "listo"
        assert len(ctx.calls) >= 2
        assert all(total is None for (_, total, _) in ctx.calls)
        assert all("sigue en ejecución" in message for (_, _, message) in ctx.calls)
        # Los ticks son consecutivos arrancando en 1 (0 se reserva para las
        # fases explícitas que reportan las tools antes/después).
        ticks = [tick for (tick, _, _) in ctx.calls]
        assert ticks == list(range(1, len(ticks) + 1))

    def test_reraises_original_exception_not_exception_group(self):
        def failing_operation():
            raise ValueError("boom")

        try:
            asyncio.run(
                run_with_heartbeat(None, failing_operation, heartbeat_message=lambda elapsed: "x")
            )
        except ValueError as e:
            assert str(e) == "boom"
        else:
            raise AssertionError("se esperaba que run_with_heartbeat relance ValueError")

    def test_stops_promptly_after_completion_not_after_full_interval(self):
        """La propiedad central del requisito: el heartbeat no debe esperar
        el resto del intervalo pendiente una vez que la operación terminó."""
        ctx = _FakeCtx()

        def quick_operation():
            time.sleep(0.05)
            return "ok"

        start = time.monotonic()
        asyncio.run(
            run_with_heartbeat(ctx, quick_operation, heartbeat_message=lambda elapsed: "x", interval=5.0)
        )
        elapsed_wall = time.monotonic() - start
        # Si esperara el resto del intervalo (5s), esto tardaría >=5s.
        assert elapsed_wall < 1.0

    def test_works_with_none_ctx(self):
        def op():
            return 42

        result = asyncio.run(run_with_heartbeat(None, op, heartbeat_message=lambda elapsed: "x"))
        assert result == 42
