"""Helper interno compartido para reportar progreso MCP estándar
(`notifications/progress`, vía `Context.report_progress` de FastMCP —
confirmado funcionando en `superset/mcp_service/explore/tool/
generate_explore_link.py`, el único tool nativo de Superset que ya lo usa)
durante operaciones bloqueantes de larga duración en las tools irex.

Por qué hace falta esto y no alcanza con `await` directo: el servidor MCP de
Superset (`superset mcp run`) corre en un solo proceso/un solo event loop
asyncio (uvicorn sin `workers=`, sin Redis en esta instalación). Una tool
`async def` que llama código bloqueante SIN offload a thread (como hace hoy
`execute_sql` nativo con `database.execute(...)`) congela el MCP entero para
TODAS las sesiones mientras esa consulta corre — no es solo "esa sesión no
ve progreso", es "nadie más puede usar el MCP". Por eso el trabajo pesado
siempre corre en un thread real (`anyio.to_thread.run_sync`), nunca directo
en el event loop compartido.

Seguridad de contenido: los mensajes de progreso son SIEMPRE strings fijos
que arma el llamador (fases del proceso + segundos transcurridos) — esta
capa nunca interpola SQL, nombres de usuario, valores de fila ni
estimaciones de resultado. `total` es siempre `None` en los call-sites de
esta extensión: no hay forma confiable de estimar % de avance de un
EXPLAIN/SELECT, así que no se inventa uno (un cliente MCP que recibe
`total=None` lo muestra como progreso indeterminado, no como barra rota).

Cancelación (ver Registro de cambios para el contexto completo — pendiente
de diseño en una fase aparte): si el cliente MCP cancela el request mientras
`blocking_fn` sigue viva en su thread, `anyio.to_thread.run_sync` (con su
default `abandon_on_cancel=False`) NO abandona el thread — sigue esperándolo
hasta que la consulta termine sola, y recién ahí propaga la cancelación. Es
la opción segura hoy (no genera un thread huérfano sin nada que lo espere),
pero significa que cancelar el request MCP no libera el worker antes de que
la query real termine ni cancela la query en la base — eso requiere matar la
query del lado del motor (`pg_cancel_backend`/`KILL QUERY`, etc.), que es
una pieza aparte, todavía no construida.
"""

from __future__ import annotations

import time
from typing import Any, Callable, TypeVar

import anyio

T = TypeVar("T")

DEFAULT_HEARTBEAT_INTERVAL = 12.0


async def report_phase(ctx: Any, tick: int, message: str) -> None:
    """Emite una fase fija de progreso (`total=None` siempre). Nunca lanza:
    un fallo acá (el cliente no pidió progreso, algo raro en el transporte)
    no debe tumbar la operación real, que es lo único que importa de verdad.
    `ctx` puede ser `None` (por ejemplo en tests) — en ese caso es un no-op.
    """
    if ctx is None:
        return
    try:
        await ctx.report_progress(tick, None, message)
    except Exception:  # noqa: BLE001 - best-effort, nunca debe afectar la operación real
        pass


async def run_with_heartbeat(
    ctx: Any,
    blocking_fn: Callable[[], T],
    *,
    heartbeat_message: Callable[[int], str],
    interval: float = DEFAULT_HEARTBEAT_INTERVAL,
) -> T:
    """Corre `blocking_fn` (sync, potencialmente lenta — una consulta real
    contra Postgres/ClickHouse) en un thread real, nunca en el event loop
    compartido, mientras emite `report_phase(ctx, tick, heartbeat_message(
    segundos_transcurridos))` cada `interval` segundos mientras siga viva.

    El heartbeat se despierta INMEDIATAMENTE apenas `blocking_fn` termina
    (éxito o excepción) — nunca espera el resto del intervalo pendiente ni
    queda una tarea corriendo de más: `anyio.Event` + `move_on_after` cortan
    la espera en el instante en que el worker señaliza que terminó, en vez
    de un polling con margen de error de hasta `interval` segundos.

    Si `blocking_fn` lanza, la excepción ORIGINAL se re-lanza tal cual acá
    afuera (no una `ExceptionGroup` de anyio) — así el `try/except` de cada
    tool, que espera una excepción plana, no necesita cambiar.
    """
    result: dict[str, T] = {}
    error: dict[str, BaseException] = {}
    done = anyio.Event()

    async def _worker() -> None:
        try:
            result["value"] = await anyio.to_thread.run_sync(blocking_fn)
        except BaseException as exc:  # noqa: BLE001 - se re-lanza afuera del task group, no se pierde
            error["value"] = exc
        finally:
            done.set()

    start = time.monotonic()
    async with anyio.create_task_group() as tg:
        tg.start_soon(_worker)
        tick = 0
        while not done.is_set():
            with anyio.move_on_after(interval):
                await done.wait()
            if done.is_set():
                break
            tick += 1
            await report_phase(ctx, tick, heartbeat_message(int(time.monotonic() - start)))

    if "value" in error:
        raise error["value"]
    return result["value"]
