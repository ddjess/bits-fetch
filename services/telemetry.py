"""Shared telemetry helpers: JSON logging (with trace correlation), the tracer, and DogStatsD."""
import json
import logging
import os
import sys
import traceback

from datadog import DogStatsd

try:
    from ddtrace.trace import tracer  # ddtrace >= 3
except ImportError:  # pragma: no cover
    from ddtrace import tracer  # noqa: F401

SERVICE = os.getenv("DD_SERVICE", "unknown")
DOG_NAME = os.getenv("DOG_NAME", "bits")

# Each failure mode is configurable so you can crank up the chaos before a live demo.
SQUIRREL_RATE = float(os.getenv("SQUIRREL_RATE", "0.06"))
BONE_LOST_RATE = float(os.getenv("BONE_LOST_RATE", "0.06"))
CRASH_RATE = float(os.getenv("CRASH_RATE", "0.03"))
MUD_RATE = float(os.getenv("MUD_RATE", "0.10"))

statsd = DogStatsd(
    host=os.getenv("DD_AGENT_HOST", "localhost"),
    port=int(os.getenv("DD_DOGSTATSD_PORT", "8125")),
    constant_tags=[f"env:{os.getenv('DD_ENV', 'sandbox')}", f"service:{SERVICE}", f"version:{os.getenv('DD_VERSION', '1.0.0')}"],
)

_STANDARD_ATTRS = set(vars(logging.LogRecord("", 0, "", 0, "", None, None))) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    """One JSON object per line. ddtrace's log injection adds dd.trace_id / dd.span_id to each record."""

    def format(self, record):
        payload = {
            "message": record.getMessage(),
            "status": record.levelname.lower(),
            "logger": {"name": record.name},
        }
        for key, value in vars(record).items():
            if key not in _STANDARD_ATTRS:
                payload[key] = value
        if record.exc_info:
            exc_type, exc, tb = record.exc_info
            payload["error"] = {
                "kind": exc_type.__name__,
                "message": str(exc),
                "stack": "".join(traceback.format_exception(exc_type, exc, tb)),
            }
        return json.dumps(payload, default=str)


def get_logger():
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
    for noisy in ("urllib3", "werkzeug", "gunicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    return logging.getLogger(SERVICE)
