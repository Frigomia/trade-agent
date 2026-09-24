import asyncio
import logging
from collections.abc import Callable

logger = logging.getLogger(__name__)


def make_task_tracker(label: str) -> Callable[[asyncio.Task[None]], None]:
    tasks: set[asyncio.Task[None]] = set()

    def _log_exception(task: asyncio.Task[None]) -> None:
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            logger.exception("Background %s job failed", label, exc_info=exc)

    def track(task: asyncio.Task[None]) -> None:
        tasks.add(task)
        task.add_done_callback(tasks.discard)
        task.add_done_callback(_log_exception)

    return track
