"""jump-service: Bits hops over things. Every jump is its own request (and span)."""
import time

from flask import Flask, jsonify, request

from telemetry import get_logger, tracer

app = Flask(__name__)
log = get_logger()


@app.post("/jump")
def jump():
    body = request.json
    height, ms = body["height"], body["ms"]
    with tracer.trace("dog.jump", resource=f"jump {height} blocks") as span:
        span.set_tag("jump.height", height)
        span.set_tag("jump.leg", body.get("leg"))
        time.sleep(ms / 1000)
    log.info(f"Bits jumped {height} blocks high!", extra={"jump": {"height": height, "ms": ms}})
    return jsonify(ok=True)
