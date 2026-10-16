"""thrower-api: serves the game and orchestrates each fetch.

POST /throw streams newline-delimited JSON events to the browser *while* the fetch happens, so the
trace starts when the bone leaves your hand and ends when Bits brings it back (or doesn't).
"""
import json
import os
import time

import requests
from flask import Flask, Response, jsonify, request, send_from_directory, stream_with_context

from telemetry import DOG_NAME, get_logger, statsd, tracer

app = Flask(__name__, static_folder="../static", static_url_path="")
log = get_logger()

DOG_URL = os.getenv("DOG_SERVICE_URL", "http://dog-service:5000")
BONE_URL = os.getenv("BONE_SERVICE_URL", "http://bone-service:5000")
TERRAIN_URL = os.getenv("TERRAIN_SERVICE_URL", "http://terrain-service:5000")

HOME_X = 120  # where Bits waits (stage coordinates, matches static/game.js)


class FetchFailed(Exception):
    def __init__(self, kind, reason, message):
        super().__init__(message)
        self.kind, self.reason = kind, reason


def distance_bucket(power):
    return "short" if power < 0.4 else "medium" if power < 0.75 else "long"


def event(**data):
    return json.dumps(data) + "\n"


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/config.js")
def rum_config():
    cfg = {
        "applicationId": os.getenv("DD_RUM_APPLICATION_ID", ""),
        "clientToken": os.getenv("DD_RUM_CLIENT_TOKEN", ""),
        "site": os.getenv("DD_SITE", "datadoghq.com"),
        "service": os.getenv("DD_RUM_SERVICE", "bits-fetch"),
        "env": os.getenv("DD_ENV", "sandbox"),
        "version": os.getenv("DD_VERSION", "1.0.0"),
    }
    return Response(f"window.BITS_RUM_CONFIG = {json.dumps(cfg)};", mimetype="application/javascript")


@app.get("/health")
def health():
    return jsonify(ok=True)


@app.post("/throw")
def throw():
    power = max(0.0, min(1.0, float(request.json.get("power", 0.5))))
    request_span = tracer.current_root_span()  # the flask.request span
    return Response(stream_with_context(run_fetch(power, request_span)), mimetype="application/x-ndjson")


def run_fetch(power, request_span):
    distance = distance_bucket(power)
    land_x = int(220 + power * 680)
    started = time.monotonic()
    tags = [f"dog_name:{DOG_NAME}", f"throw_distance:{distance}"]

    span = tracer.start_span("bone.fetch", child_of=request_span, service="thrower-api", resource=f"fetch {distance}", activate=True)
    span.set_metric("_dd.measured", 1)  # generates trace.bone.fetch.* metrics
    span.set_tags({"dog_name": DOG_NAME, "throw_distance": distance, "throw.power": round(power, 2)})
    total_jumps = 0
    terrain = "unknown"
    try:
        log.info("fetch!", extra={"dog_name": DOG_NAME, "throw_distance": distance, "power": round(power, 2)})
        statsd.increment("dog.bone.thrown", tags=tags)
        yield event(type="start", trace_id=str(span.trace_id), distance=distance, land_x=land_x)

        terrain = requests.get(f"{TERRAIN_URL}/landing", timeout=5).json()["terrain"]
        span.set_tag("terrain", terrain)

        flight_ms = int(500 + power * 700)
        yield event(type="throw", ms=flight_ms, land_x=land_x, terrain=terrain)
        with tracer.trace("bone.flight", resource=distance):
            time.sleep(flight_ms / 1000)

        for leg, from_x, to_x in (("out", HOME_X, land_x - 30), ("back", land_x - 30, HOME_X)):
            plan = requests.post(f"{DOG_URL}/plan", json={"leg": leg, "terrain": terrain, "from_x": from_x, "to_x": to_x}, timeout=5).json()
            total_jumps += len([j for j in plan["jumps"] if plan["squirrel_at"] is None or j["at"] + j["ms"] <= plan["squirrel_at"]])
            yield event(type="run", from_x=from_x, to_x=to_x, **plan)
            if not requests.post(f"{DOG_URL}/run", json=plan, timeout=30).ok:
                raise FetchFailed("SquirrelDistraction", "squirrel", f"{DOG_NAME.capitalize()} chased a squirrel instead of the bone")

            if leg == "out":
                yield event(type="pickup", ms=450, terrain=terrain)
                if not requests.post(f"{BONE_URL}/pickup", json={"terrain": terrain}, timeout=10).ok:
                    raise FetchFailed("BoneLost", "lost", f"the bone was lost in the {terrain}")

        yield event(type="deliver", ms=250)
        if not requests.post(f"{BONE_URL}/deliver", json={}, timeout=5).ok:
            raise FetchFailed("BoneServiceCrash", "crash", "bone-service crashed while handing the bone back")

        duration_ms = int((time.monotonic() - started) * 1000)
        span.set_tags({"jumps": total_jumps, "outcome": "returned"})
        statsd.increment("dog.bone.returned", tags=tags + [f"terrain:{terrain}"])
        log.info("good dog!", extra={"dog_name": DOG_NAME, "throw_distance": distance, "terrain": terrain, "jumps": total_jumps, "duration_ms": duration_ms})
        yield event(type="returned", duration_ms=duration_ms, jumps=total_jumps)
    except FetchFailed as exc:
        for s in (span, request_span):
            if s is not None:
                s.error = 1
                s.set_tags({"error.type": exc.kind, "error.message": str(exc)})
        span.set_tags({"jumps": total_jumps, "outcome": exc.reason})
        log.error(f"bad dog... {exc}", extra={"dog_name": DOG_NAME, "throw_distance": distance, "terrain": terrain, "error": {"kind": exc.kind, "message": str(exc)}})
        yield event(type="fail", reason=exc.reason, message=str(exc))
    except Exception as exc:  # network trouble etc. Still end the trace cleanly.
        span.set_exc_info(type(exc), exc, exc.__traceback__)
        log.exception("fetch blew up unexpectedly")
        yield event(type="fail", reason="error", message=str(exc))
    finally:
        span.finish()
