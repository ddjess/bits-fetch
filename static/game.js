// Bits Fetch: the browser plays back each fetch as thrower-api streams it, phase by phase.
const GROUND_Y = 350;          // top of the ground, in stage pixels
const HOME_X = 120;            // where Bits waits (matches thrower_api.py)
const HAND = { x: 72, y: 296 };
const DOG_PX = 5, DOG_W = 100, DOG_H = 80;
const BONE_PX = 3, BONE_W = 36, BONE_H = 15;
const CHARGE_MS = 1300;        // time to go from 0% to 100% (then it swings back down)
const SEGMENTS = 24;

const $ = (id) => document.getElementById(id);
const els = {
  stage: $("stage"), wrap: $("stage-wrap"), dog: $("dog"), bone: $("bone"), human: $("human"),
  squirrel: $("squirrel"), bubbleDog: $("bubble-dog"), bubbleHuman: $("bubble-human"), banner: $("banner"),
  patches: $("patches"), dots: $("dots"), meter: $("meter"), pct: $("power-pct"),
  throwBtn: $("throw-btn"), autoBtn: $("auto-btn"), status: $("status"), log: $("log"),
};

const svgCache = {};
const svg = (name, px) => (svgCache[name + px] ??= spriteSVG(name, px));

const dog = { x: HOME_X, jump: 0, facing: 1, frame: "stand", el: els.dog };
const bone = { x: HAND.x, y: HAND.y, rot: 0, carried: false };
const score = { bones: 0, throws: 0, streak: 0, misses: 0 };
let busy = false, auto = false, chain = Promise.resolve();

// ---------- rendering ----------
function setFrame(sprite, name, px) {
  if (sprite.frame !== name) { sprite.frame = name; sprite.el.innerHTML = svg(name, px); }
}
function drawDog() {
  els.dog.style.transform = `translate(${dog.x - DOG_W / 2}px, ${GROUND_Y - DOG_H - dog.jump}px) scaleX(${dog.facing})`;
  if (bone.carried) {
    bone.x = dog.x + dog.facing * 42;
    bone.y = GROUND_Y - DOG_H - dog.jump + 34;
    bone.rot = 0;
  }
  drawBone();
  moveBubble(els.bubbleDog, dog.x, GROUND_Y - DOG_H - dog.jump - 12);
}
function drawBone() {
  els.bone.style.transform = `translate(${bone.x - BONE_W / 2}px, ${bone.y - BONE_H / 2}px) rotate(${bone.rot}deg)`;
}
function moveBubble(el, x, y) { el.style.left = `${x}px`; el.style.top = `${y}px`; }

function say(el, text, cls = "", ms = 1400) {
  el.textContent = text;
  el.className = `bubble ${cls}`;
  clearTimeout(el._t);
  if (ms) el._t = setTimeout(() => el.classList.add("hidden"), ms);
}
function banner(text, cls = "", ms = 1500) {
  els.banner.textContent = text;
  els.banner.className = cls;
  clearTimeout(els.banner._t);
  els.banner._t = setTimeout(() => els.banner.classList.add("hidden"), ms);
}
function updateHud() {
  $("bones").textContent = String(score.bones).padStart(3, "0");
  $("throws").textContent = String(score.throws).padStart(3, "0");
  $("streak").textContent = score.streak;
  $("misses").textContent = score.misses;
}
function logLine(level, service, message, traceId) {
  const li = document.createElement("li");
  const t = new Date().toLocaleTimeString();
  li.innerHTML = `<span class="t">${t}</span><span class="lvl ${level}">${level.toUpperCase()}</span><span>${service}</span><span>${message}</span>` +
    (traceId ? `<span class="trace">trace ${traceId.slice(-8)}</span>` : "");
  els.log.prepend(li);
  while (els.log.children.length > 40) els.log.lastChild.remove();
}
function fitStage() {
  const scale = Math.min(1, els.wrap.clientWidth / 960);
  els.stage.style.transform = `scale(${scale})`;
  els.wrap.style.height = `${420 * scale}px`;
}

// ---------- animation helpers ----------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function animate(ms, step) {
  return new Promise((resolve) => {
    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / ms);
      step(t, now - start);
      t < 1 ? requestAnimationFrame(tick) : resolve();
    }
    requestAnimationFrame(tick);
  });
}
const runFrame = (elapsed) => (Math.floor(elapsed / 110) % 2 ? "dog_runA" : "dog_runB");

// ---------- phases (one per streamed event) ----------
let traceId = null;
const phases = {
  start(ev) {
    traceId = ev.trace_id;
    score.throws++; updateHud();
    say(els.bubbleHuman, "FETCH!", "", 900);
    logLine("info", "thrower-api", "fetch!", traceId);
    window.DD_RUM?.addAction?.("throw_bone", { throw_distance: ev.distance });
  },

  async throw(ev) {
    els.patches.innerHTML = "";
    if (ev.terrain !== "grass") {
      const p = document.createElement("div");
      p.className = `patch ${ev.terrain}`;
      p.style.left = `${ev.land_x - 60}px`;
      p.style.width = "120px";
      els.patches.appendChild(p);
    }
    els.human.innerHTML = svg("humanThrow", 4);
    setTimeout(() => (els.human.innerHTML = svg("human", 4)), 350);
    const x0 = HAND.x, y0 = HAND.y, x1 = ev.land_x, y1 = GROUND_Y - 8;
    const peak = 90 + (x1 - x0) * 0.22;
    await animate(ev.ms, (t, elapsed) => {
      bone.x = x0 + (x1 - x0) * t;
      bone.y = y0 + (y1 - y0) * t - peak * 4 * t * (1 - t);
      bone.rot = t * 720;
      drawBone();
      dog.jump = Math.abs(Math.sin(elapsed / 90)) * 6;  // excited bouncing
      drawDog();
    });
    bone.rot = 0; dog.jump = 0; drawBone(); drawDog();
  },

  async run(ev) {
    dog.facing = ev.to_x >= ev.from_x ? 1 : -1;
    bone.carried = ev.leg === "back";
    const until = ev.squirrel_at ?? ev.ms;
    await animate(until, (_t, elapsed) => {
      dog.x = ev.from_x + (ev.to_x - ev.from_x) * Math.min(1, elapsed / ev.ms);
      const j = ev.jumps.find((jp) => elapsed >= jp.at && elapsed <= jp.at + jp.ms);
      dog.jump = j ? Math.sin(Math.PI * (elapsed - j.at) / j.ms) * j.height * 12 : 0;
      setFrame(dog, j ? "dog_jump" : runFrame(elapsed), DOG_PX);
      drawDog();
    });
    dog.jump = 0;
    if (ev.squirrel_at != null) {
      els.squirrel.classList.remove("hidden");
      els.squirrel.style.transform = `translate(${dog.x + 70}px, ${GROUND_Y - 36}px)`;
      say(els.bubbleDog, "SQUIRREL!", "bad", 1200);
    }
    setFrame(dog, "dog_stand", DOG_PX);
    drawDog();
  },

  async pickup(ev) {
    await animate(ev.ms, (_t, elapsed) => {
      dog.jump = -Math.abs(Math.sin(elapsed / 70)) * 4;  // sniff sniff
      drawDog();
    });
    dog.jump = 0; drawDog();
  },

  async deliver(ev) {
    dog.facing = -1;
    bone.carried = false;
    const x0 = bone.x, y0 = bone.y;
    await animate(ev.ms, (t) => {
      bone.x = x0 + (HAND.x - x0) * t;
      bone.y = y0 + (HAND.y - y0) * t;
      drawBone();
    });
    setFrame(dog, "dog_stand", DOG_PX); drawDog();
  },

  async returned(ev) {
    score.bones++; score.streak++; updateHud();
    dog.facing = 1;
    say(els.bubbleDog, "GOOD DOG!", "good", 1500);
    logLine("info", "thrower-api", `good dog! (${(ev.duration_ms / 1000).toFixed(1)}s, ${ev.jumps} jumps)`, traceId);
    window.DD_RUM?.addAction?.("bone_returned", { duration_ms: ev.duration_ms, jumps: ev.jumps });
    await animate(500, (t) => { dog.jump = Math.sin(Math.PI * t) * 26; setFrame(dog, "dog_jump", DOG_PX); drawDog(); });
    dog.jump = 0; setFrame(dog, "dog_stand", DOG_PX); drawDog();
  },

  async fail(ev) {
    score.misses++; score.streak = 0; updateHud();
    logLine("error", "thrower-api", `bad dog... ${ev.message}`, traceId);
    window.DD_RUM?.addAction?.("fetch_failed", { reason: ev.reason });
    bone.carried = false;

    if (ev.reason === "squirrel") {
      banner("SQUIRREL!!");
      const sx = dog.x + 70;
      await animate(1000, (t, elapsed) => {
        els.squirrel.style.transform = `translate(${sx + t * 500}px, ${GROUND_Y - 36 - Math.abs(Math.sin(elapsed / 80)) * 10}px)`;
        dog.x += 7; setFrame(dog, runFrame(elapsed), DOG_PX); drawDog();
      });
      els.squirrel.classList.add("hidden");
      await fadeBone();
      dog.x = 1020; dog.facing = -1;
      await runTo(HOME_X, 1300);
    } else if (ev.reason === "lost") {
      banner("BONE LOST!");
      say(els.bubbleDog, "...", "bad", 1200);
      const y0 = bone.y;
      await animate(800, (t) => { bone.y = y0 + t * 18; els.bone.style.opacity = 1 - t; drawBone(); });
      dog.facing = -1;
      await runTo(HOME_X, 1100);
    } else {
      banner(ev.reason === "crash" ? "ERROR 500" : "OOPS!", "glitch", 1600);
      els.bone.classList.add("flicker");
      await wait(900);
      els.bone.classList.remove("flicker");
      await fadeBone();
      if (Math.abs(dog.x - HOME_X) > 5) { dog.facing = -1; await runTo(HOME_X, 900); }
    }
    dog.facing = 1; setFrame(dog, "dog_stand", DOG_PX); drawDog();
  },
};

async function fadeBone() {
  await animate(300, (t) => (els.bone.style.opacity = 1 - t));
}
async function runTo(x, ms) {
  const x0 = dog.x;
  await animate(ms, (t, elapsed) => { dog.x = x0 + (x - x0) * t; setFrame(dog, runFrame(elapsed), DOG_PX); drawDog(); });
}
function resetBone() {
  els.patches.innerHTML = "";
  bone.carried = false; bone.x = HAND.x; bone.y = HAND.y; bone.rot = 0;
  els.bone.style.opacity = 1;
  drawBone();
}

// ---------- talking to thrower-api ----------
async function throwBone(power) {
  busy = true;
  setBusyUI();
  chain = Promise.resolve();
  const handle = (ev) => (chain = chain.then(() => phases[ev.type]?.(ev)));
  let finished = false;
  try {
    const res = await fetch("/throw", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ power }) });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.type === "returned" || ev.type === "fail") finished = true;
        handle(ev);
      }
    }
  } catch (err) {
    console.error(err);
  }
  if (!finished) handle({ type: "fail", reason: "error", message: "lost contact with thrower-api" });
  await chain;
  resetBone();
  busy = false;
  setBusyUI();
}

function setBusyUI() {
  els.throwBtn.disabled = busy && !auto;
  els.throwBtn.textContent = busy ? "BITS IS FETCHING..." : "HOLD TO THROW";
  if (!auto) els.status.innerHTML = busy ? "Bits is on the way..." : "Hold the button (or the <kbd>SPACE</kbd> bar) to charge, then let go to throw.";
}

// ---------- power meter (hold to charge) ----------
for (let i = 0; i < SEGMENTS; i++) els.meter.appendChild(Object.assign(document.createElement("div"), { className: "seg" }));
const segColor = (i) => `hsl(${120 - (i / (SEGMENTS - 1)) * 120}, 85%, 52%)`;  // green -> yellow -> red

function setPower(p) {
  const lit = Math.round(p * SEGMENTS);
  [...els.meter.children].forEach((seg, i) => (seg.style.background = i < lit ? segColor(i) : ""));
  els.pct.textContent = `${Math.round(p * 100)}%`;
  els.meter.classList.toggle("max", p >= 0.98);
  drawTrajectory(p);
}
function drawTrajectory(p) {
  if (p <= 0) { els.dots.innerHTML = ""; return; }
  const x1 = 220 + p * 680, peak = 90 + (x1 - HAND.x) * 0.22;
  let html = "";
  for (let k = 1; k <= 14; k++) {
    const t = k / 15;
    const x = HAND.x + (x1 - HAND.x) * t;
    const y = HAND.y + (GROUND_Y - 8 - HAND.y) * t - peak * 4 * t * (1 - t);
    html += `<div class="dot" style="left:${x - 3}px;top:${y - 3}px"></div>`;
  }
  els.dots.innerHTML = html;
}

let charging = null;
function powerAt(ms) {
  const phase = (ms % (CHARGE_MS * 2)) / CHARGE_MS;  // 0..2, ping-pongs if you hold too long
  return Math.max(0.03, phase <= 1 ? phase : 2 - phase);
}
function startCharge() {
  if (busy || charging || auto) {
    if (busy) els.status.textContent = "Bits is still fetching! Wait for the bone to come back.";
    return;
  }
  els.throwBtn.classList.add("held");
  charging = { start: performance.now(), power: 0 };
  (function loop(now) {
    if (!charging) return;
    charging.power = powerAt((now ?? performance.now()) - charging.start);
    setPower(charging.power);
    requestAnimationFrame(loop);
  })();
}
function releaseCharge() {
  if (!charging) return;
  const power = charging.power;
  charging = null;
  els.throwBtn.classList.remove("held");
  setTimeout(() => setPower(0), 400);
  throwBone(power);
}

els.throwBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); startCharge(); });
els.stage.addEventListener("pointerdown", (e) => { e.preventDefault(); startCharge(); });
window.addEventListener("pointerup", releaseCharge);
window.addEventListener("pointercancel", releaseCharge);
window.addEventListener("keydown", (e) => {
  if (e.code !== "Space") return;
  e.preventDefault();
  if (!e.repeat) startCharge();
});
window.addEventListener("keyup", (e) => { if (e.code === "Space") { e.preventDefault(); releaseCharge(); } });

// ---------- auto-fetch ----------
els.autoBtn.addEventListener("click", () => {
  auto = !auto;
  els.autoBtn.setAttribute("aria-pressed", String(auto));
  els.autoBtn.textContent = `AUTO-FETCH: ${auto ? "ON" : "OFF"}`;
  els.status.textContent = auto ? "Auto-Fetch is on. Sit back and watch the telemetry roll in." : "";
  window.DD_RUM?.addAction?.("auto_fetch_toggled", { enabled: auto });
  setBusyUI();
  if (auto) autoLoop();
});
async function autoLoop() {
  while (auto) {
    if (busy) { await wait(300); continue; }
    await wait(1500);
    if (!auto || busy) continue;
    const target = 0.15 + Math.random() * 0.85;
    await animate(target * CHARGE_MS, (t) => setPower(t * target));
    setTimeout(() => setPower(0), 400);
    await throwBone(target);
  }
}

// ---------- boot ----------
els.human.innerHTML = svg("human", 4);
els.human.style.transform = `translate(18px, ${GROUND_Y - 64}px)`;
els.bone.innerHTML = svg("bone", BONE_PX);
els.squirrel.innerHTML = svg("squirrel", 3);
setFrame(dog, "dog_stand", DOG_PX);
drawDog(); drawBone(); setPower(0); updateHud(); fitStage();
window.addEventListener("resize", fitStage);
logLine("info", "browser", "Bits is ready. Throw the bone!");
