import json
import secrets
import time
from typing import Any

_REPORT_MAX_AGE_SEC = 7200  # 2 horas
_REPORTS: dict[str, dict[str, Any]] = {}


def _current_user_key() -> str:
    try:
        from flask import g

        user = getattr(g, "user", None)
    except RuntimeError:
        user = None
    if user is None:
        return "__anonymous__"
    return str(
        getattr(user, "username", None)
        or getattr(user, "id", None)
        or "__anonymous__"
    )


def _cleanup_expired(now: float | None = None) -> None:
    now = time.time() if now is None else now
    expired = [
        report_id
        for report_id, entry in _REPORTS.items()
        if now - float(entry.get("created_at", 0)) > _REPORT_MAX_AGE_SEC
    ]
    for report_id in expired:
        _REPORTS.pop(report_id, None)


def store_report(dataset_id: int, mode: str, params: dict[str, Any]) -> str:
    now = time.time()
    _cleanup_expired(now)
    report_id = secrets.token_urlsafe(12)
    _REPORTS[report_id] = {
        "created_at": now,
        "user_key": _current_user_key(),
        "dataset_id": dataset_id,
        "mode": mode,
        "params": params,
    }
    return report_id


def get_report(report_id: str, dataset_id_hint: int | None = None) -> dict[str, Any] | None:
    now = time.time()
    _cleanup_expired(now)
    entry = _REPORTS.get(report_id)
    if not entry:
        return None
    if now - float(entry.get("created_at", 0)) > _REPORT_MAX_AGE_SEC:
        _REPORTS.pop(report_id, None)
        return None
    if entry.get("user_key") != _current_user_key():
        return None
    if dataset_id_hint is not None and entry.get("dataset_id") != dataset_id_hint:
        return None
    return entry.get("params")


def _stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, default=str)


def find_recent_inverted_call(
    dataset_id: int,
    groupby: list[str],
    period_a_filters: list[dict[str, Any]],
    period_b_filters: list[dict[str, Any]],
    window_sec: int = 600,
) -> bool:
    now = time.time()
    _cleanup_expired(now)
    user_key = _current_user_key()
    groupby_key = _stable_json(groupby)
    period_a_key = _stable_json(period_a_filters)
    period_b_key = _stable_json(period_b_filters)

    for entry in _REPORTS.values():
        if now - float(entry.get("created_at", 0)) > window_sec:
            continue
        if entry.get("user_key") != user_key:
            continue
        if entry.get("dataset_id") != dataset_id or entry.get("mode") != "compare_periods":
            continue
        params = entry.get("params") or {}
        if _stable_json(params.get("groupby")) != groupby_key:
            continue
        if (
            _stable_json(params.get("period_a_filters")) == period_b_key
            and _stable_json(params.get("period_b_filters")) == period_a_key
        ):
            return True
    return False
