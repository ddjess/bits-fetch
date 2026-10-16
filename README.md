# 🦴 Bits Fetch

A tiny 8-bit fetch game that sends **traces, logs, custom metrics and RUM** to Datadog.
Hold to charge, let go to throw, and Bits (a good white dog with a purple collar) runs out, jumps over things, and brings the bone back. Usually.

Each throw is **one distributed trace across five Python services**. The trace starts when the bone leaves your hand and ends when Bits returns it, so trace duration matches what you see on screen.

```
Browser (RUM + Session Replay)
   │  POST /throw  (streams each phase back as it happens)
   ▼
thrower-api ──► terrain-service   where did it land? grass / mud (slow) / pond
     │
     ├──────► dog-service ──► jump-service   random 0–3 jumps per run, one span each
     │
     └──────► bone-service ──► terrain-service   dig it out (retries once)
```

| Signal | What gets sent |
|---|---|
| **Traces** | `bone.fetch` root, `bone.flight`, `dog.run`, `dog.jump`, `bone.dig` retries, `bone.deliver` |
| **Logs** | `fetch!` on throw, `good dog!` on return, `bad dog...` on failure. JSON, trace-correlated |
| **Metrics** | `dog.bone.thrown`, `dog.bone.returned` (DogStatsD counts, tagged `dog_name`, `throw_distance`, `terrain`) |
| **RUM** | Sessions, Session Replay, custom actions `throw_bone`, `bone_returned`, `fetch_failed`, linked to backend traces |

### Built-in failures (about 15% of throws)

| Failure | Rate | What you'll see |
|---|---|---|
| 🐿️ Squirrel | 6% | Error span on `dog-service`, Bits runs off-screen, the bone is never returned |
| 🫧 Bone lost in the pond | 6% | `terrain-service` 503 → `bone-service` retries once, then gives up |
| 💥 bone-service crash | 3% | Unhandled `KeyError` with a stack trace in Error Tracking |
| 🐢 Muddy terrain | 10% | Not an error: a slow `terrain.scan` and a slower run, so p95 latency spikes |

You can change every rate in `.env`. Turn them up before a demo.

## Setup

**You need:** [Colima](https://github.com/abiosoft/colima) (or Docker Desktop) with `docker compose`, a Datadog API key, and a Browser RUM app.

1. **Create a RUM app** in Datadog: *Digital Experience → RUM → New Application*. Choose **Manual Setup**, name it `bits-fetch`, and pick **JavaScript**. Copy the **Application ID** and **Client Token**.
2. **Configure:**
   ```bash
   cp .env.example .env
   ```
   Fill in `DD_API_KEY`, `DD_RUM_APPLICATION_ID` and `DD_RUM_CLIENT_TOKEN`. `.env` is git-ignored.
3. **Run:**
   ```bash
   colima start --cpu 2 --memory 4
   docker compose up -d --build
   ```
4. Open **http://localhost:8080** and throw the bone.

Stop everything with `docker compose down`.

## Import the dashboard and monitor

- **Dashboard:** *Dashboards → New Dashboard → ⚙ (settings) → Import dashboard JSON*, then paste [`datadog/dashboard.json`](datadog/dashboard.json).
- **Monitor:** *Monitors → New Monitor → Import from JSON*, then paste [`datadog/monitor.json`](datadog/monitor.json). It alerts when fewer than 70% of thrown bones come back in a 15-minute window (normal is about 85%). Add your own `@notification` handle to the message.

## A 5-minute walkthrough

1. Turn on **Auto-Fetch** so data keeps flowing while you click around.
2. **APM → Service Map:** five services, with `thrower-api` in the middle.
3. **APM → Traces**, `service:thrower-api`: open one. The flame graph mirrors the animation, with each jump as its own span. Find a trace with an error and see where it broke.
4. Inside the trace, open the **Logs** tab: `fetch!` and `good dog!` carry the same trace ID.
5. **Error Tracking:** the `KeyError: 'bone-2'` crash, grouped, with its stack trace.
6. **Metrics → Explorer:** `dog.bone.thrown` vs. `dog.bone.returned`, split by `throw_distance` or `terrain`.
7. **RUM → Sessions:** replay your session and watch Bits run, then jump from a `/throw` resource to its backend trace.

## Notes

- Everything runs in containers, including the Datadog Agent, so the only thing to install is Colima.
- DogStatsD submits counts as a rate per flush interval. Use `.as_count()` in queries (the dashboard and monitor already do) to get bone totals.
- `env:sandbox` and `version:1.0.0` are set in `docker-compose.yml` (unified service tagging).
- **Port 8080 already in use?** Change `"8080:5000"` in `docker-compose.yml`.
- **Nothing in Datadog?** Run `docker compose exec datadog-agent agent status` and check the APM, Logs and DogStatsD sections.

Bits is an original pixel character made for this project.
