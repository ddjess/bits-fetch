"""dog-service: plans each run (speed, random jumps, squirrels) and then runs it in real time."""
import os
import random
import time

import requests
from flask import Flask, jsonify, request

from telemetry import DOG_NAME, SQUIRREL_RATE, get_logger, tracer

app = Flask(__name__)
log = get_logger()

JUMP_URL = os.getenv("JUMP_SERVICE_URL", "http://jump-service:5000")
SPEED_PX_PER_MS = {"grass": 0.34, "mud": 0.17, "pond": 0.26}


class SquirrelDistraction(Exception):
    pass


@app.post("/plan")
def plan():
    body = request.json
    leg, terrain = body["leg"], body["terrain"]
    run_ms = int(abs(body["to_x"] - body["from_x"]) / SPEED_PX_PER_MS[terrain])

    jump_count = random.choices([0, 1, 2, 3], weights=[30, 35, 25, 10])[0]
    jumps, slot = [], run_ms / max(jump_count, 1)
    for i in range(jump_count):
        ms = random.randint(380, 520)
        at = int(i * slot + random.uniform(0, max(slot - ms, 0)))
        if at + ms <= run_ms:
            jumps.append({"at": at, "ms": ms, "height": random.randint(2, 6)})

    squirrel_at = None
    if leg == "out" and random.random() < SQUIRREL_RATE:
        squirrel_at = int(run_ms * random.uniform(0.35, 0.75))

    return jsonify(leg=leg, terrain=terrain, ms=run_ms, jumps=jumps, squirrel_at=squirrel_at)


@app.post("/run")
def run():
    plan = request.json
    try:
        with tracer.trace("dog.run", resource=f"run {plan['leg']}") as span:
            span.set_tags({"dog_name": DOG_NAME, "leg": plan["leg"], "terrain": plan["terrain"], "jumps": len(plan["jumps"])})
            elapsed = 0
            stop_at = plan["squirrel_at"] if plan["squirrel_at"] is not None else plan["ms"]
            for jump in plan["jumps"]:
                if jump["at"] + jump["ms"] > stop_at:
                    break
                time.sleep((jump["at"] - elapsed) / 1000)
                requests.post(f"{JUMP_URL}/jump", json={**jump, "leg": plan["leg"]}, timeout=5).raise_for_status()
                elapsed = jump["at"] + jump["ms"]
            time.sleep(max(stop_at - elapsed, 0) / 1000)
            if plan["squirrel_at"] is not None:
                raise SquirrelDistraction(f"{DOG_NAME.capitalize()} saw a squirrel and forgot about the bone")
    except SquirrelDistraction as exc:
        log.error("SQUIRREL! Bits ran off mid-fetch", extra={"error": {"kind": "SquirrelDistraction", "message": str(exc)}})
        return jsonify(error="squirrel", message=str(exc)), 500
    return jsonify(ok=True)
