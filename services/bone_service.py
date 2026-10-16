"""bone-service: picks the bone up (digging it out of the terrain) and hands it back."""
import os
import random
import time

import requests
from flask import Flask, jsonify, request

from telemetry import CRASH_RATE, get_logger, tracer

app = Flask(__name__)
log = get_logger()

TERRAIN_URL = os.getenv("TERRAIN_SERVICE_URL", "http://terrain-service:5000")
BONE_REGISTRY = {"bone-1": {"owner": "bits", "condition": "slobbery"}}


@app.post("/pickup")
def pickup():
    terrain = request.json["terrain"]
    with tracer.trace("bone.pickup", resource=terrain) as span:
        time.sleep(0.2)
        for attempt in (1, 2):
            with tracer.trace("bone.dig", resource=f"attempt {attempt}") as dig_span:
                dig_span.set_tag("attempt", attempt)
                resp = requests.post(f"{TERRAIN_URL}/dig", json={"terrain": terrain}, timeout=5)
                if resp.ok:
                    break
                dig_span.error = 1
                dig_span.set_tag("error.message", "dig came up empty")
                if attempt == 1:
                    log.warning("Couldn't find the bone, digging again", extra={"terrain": terrain})
        else:
            span.error = 1
            span.set_tag("error.type", "BoneLost")
            span.set_tag("error.message", f"bone lost in the {terrain} after 2 attempts")
            log.error(f"Bone lost in the {terrain}", extra={"error": {"kind": "BoneLost", "message": f"bone lost in the {terrain}"}})
            return jsonify(error="lost"), 404
    return jsonify(ok=True)


@app.post("/deliver")
def deliver():
    with tracer.trace("bone.deliver"):
        time.sleep(0.25)
        bone_id = "bone-1"
        if random.random() < CRASH_RATE:
            bone_id = "bone-2"  # a bug: this bone was never registered
        # Unhandled KeyError on the crash path: a real 500 with a stack trace for Error Tracking.
        owner = BONE_REGISTRY[bone_id]["owner"]
    log.info(f"Bone delivered back to {owner}'s human")
    return jsonify(ok=True)
