"""terrain-service: decides where the bone lands, and whether it can be dug back out of the pond."""
import math
import random
import time

from flask import Flask, jsonify, request

from telemetry import BONE_LOST_RATE, MUD_RATE, get_logger, tracer

app = Flask(__name__)
log = get_logger()

POND_RATE = max(0.20, BONE_LOST_RATE)
# bone-service retries a failed dig once, so the bone is only lost when both digs fail.
SINK_CHANCE = math.sqrt(min(1.0, BONE_LOST_RATE / POND_RATE))


@app.get("/landing")
def landing():
    roll = random.random()
    terrain = "pond" if roll < POND_RATE else "mud" if roll < POND_RATE + MUD_RATE else "grass"
    with tracer.trace("terrain.scan", resource=terrain) as span:
        span.set_tag("terrain", terrain)
        if terrain == "mud":
            # The slow path: scanning muddy ground takes a while.
            time.sleep(random.uniform(0.4, 0.9))
            log.warning("Bone landed in mud, Bits is going to get messy", extra={"terrain": terrain})
        else:
            time.sleep(random.uniform(0.02, 0.06))
    return jsonify(terrain=terrain)


@app.post("/dig")
def dig():
    terrain = request.json.get("terrain", "grass")
    with tracer.trace("terrain.dig", resource=terrain) as span:
        span.set_tag("terrain", terrain)
        time.sleep(0.12)
        if terrain == "pond" and random.random() < SINK_CHANCE:
            span.set_tag("bone.sunk", True)
            log.warning("The bone sank to the bottom of the pond", extra={"terrain": terrain})
            return jsonify(error="bone sank"), 503
    return jsonify(found=True)
