import { CameraManager } from "./cameraManager.js";
import { HandTracker } from "./handTracker.js";
import { classifyGesture, extendedListChinese, fingerStatesToChinese } from "./gestureMatcher.js";

const videoEl = document.getElementById("video");
const canvasEl = document.getElementById("overlay");
const camStatusEl = document.getElementById("camStatus");
const toggleBtn = document.getElementById("toggleBtn");
const gestureNameEl = document.getElementById("gestureName");
const gestureDetailEl = document.getElementById("gestureDetail");
const fpsOverlayEl = document.getElementById("fpsOverlay");
const logEl = document.getElementById("log");
const fingerStatesEl = document.getElementById("fingerStates");
const pinchStatusEl = document.getElementById("pinchStatus");
const cameraButtonEl = document.getElementById("cameraButton");
const cameraButtonTextEl = document.getElementById("cameraButtonText");
const cameraMenuEl = document.getElementById("cameraMenu");
const cameraDropdownEl = document.getElementById("cameraDropdown");

function fmt2(n) {
  return String(Math.floor(n)).padStart(2, "0");
}

function fmtTimeMs(tsMs) {
  const d = new Date(tsMs);
  return `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}:${fmt2(d.getSeconds())}.${String(
    d.getMilliseconds(),
  ).padStart(3, "0")}`;
}

function fmt(n, digits = 1) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function setPill(el, text, kind) {
  el.textContent = text;
  el.style.borderColor =
    kind === "ok"
      ? "rgba(77, 212, 172, 0.55)"
      : kind === "bad"
        ? "rgba(255, 92, 122, 0.55)"
        : kind === "warn"
          ? "rgba(122, 162, 255, 0.45)"
          : "rgba(255, 255, 255, 0.08)";
  el.style.color =
    kind === "ok"
      ? "rgba(77, 212, 172, 0.95)"
      : kind === "bad"
        ? "#ff9bad"
        : kind === "warn"
          ? "rgba(122, 162, 255, 0.95)"
          : "";
}

const LOG_MAX_LINES = 260;
const logLines = [];
let lastLogUiMs = 0;
const LOG_UI_EVERY_MS = 60;
function appendLog(line) {
  logLines.push(line);
  if (logLines.length > LOG_MAX_LINES) logLines.splice(0, logLines.length - LOG_MAX_LINES);
  const t = performance.now();
  if (t - lastLogUiMs < LOG_UI_EVERY_MS) return;
  lastLogUiMs = t;
  logEl.textContent = logLines.join("\n");
  logEl.scrollTop = logEl.scrollHeight;
}

function gestureLabel(code) {
  switch (code) {
    case "PINCH":
      return "捏合(拇指+食指)";
    case "FIST":
      return "握拳";
    case "OPEN":
      return "张开";
    case "INDEX_ONLY":
      return "仅食指伸出";
    case "THUMB_ONLY":
      return "仅大拇指伸出";
    case "V_SIGN":
      return "V(食指+中指)";
    case "ROCK":
      return "摇滚(食指+小指)";
    case "THREE":
      return "三指";
    case "L_SHAPE":
      return "L(拇指+食指)";
    case "THUMB_INDEX_MIDDLE":
      return "三指(拇+食+中)";
    case "MIDDLE_ONLY":
      return "仅中指伸出";
    case "RING_ONLY":
      return "仅无名指伸出";
    case "PINKY_ONLY":
      return "仅小指伸出";
    case "COMBO":
      return "组合";
    case "NONE":
      return "无手";
    default:
      return "其他";
  }
}

const fingerPills = {
  thumb: null,
  index: null,
  middle: null,
  ring: null,
  pinky: null,
};

function initFingerPills() {
  fingerStatesEl.textContent = "";
  const defs = [
    ["thumb", "拇"],
    ["index", "食"],
    ["middle", "中"],
    ["ring", "无"],
    ["pinky", "小"],
  ];
  for (const [key, label] of defs) {
    const span = document.createElement("span");
    span.className = "fingerPill fingerOff";
    span.textContent = `${label}:—`;
    fingerStatesEl.appendChild(span);
    fingerPills[key] = span;
  }
}

function updateFingerPills(states) {
  const set = (key, label) => {
    const s = states[key];
    const el = fingerPills[key];
    if (!el || !s) return;
    const on = s.state === "EXTENDED";
    el.className = `fingerPill ${on ? "fingerOn" : "fingerOff"}`;
    el.textContent = `${label}:${s.state === "EXTENDED" ? "伸" : s.state === "FOLDED" ? "收" : "弯"}`;
  };
  set("thumb", "拇");
  set("index", "食");
  set("middle", "中");
  set("ring", "无");
  set("pinky", "小");
}

// Layout mapping (letterbox-aware) + minimal overlay drawing for low latency.
let layoutCache = null;
let lastLayoutMs = 0;
const LAYOUT_EVERY_MS = 200;

function updateLayout(force = false) {
  const t = performance.now();
  if (!force && t - lastLayoutMs < LAYOUT_EVERY_MS && layoutCache) return;
  lastLayoutMs = t;

  const rect = videoEl.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(rect.width));
  const cssH = Math.max(1, Math.round(rect.height));

  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  const pxW = Math.max(1, Math.round(cssW * dpr));
  const pxH = Math.max(1, Math.round(cssH * dpr));

  if (canvasEl.width !== pxW) canvasEl.width = pxW;
  if (canvasEl.height !== pxH) canvasEl.height = pxH;
  canvasEl.style.width = `${cssW}px`;
  canvasEl.style.height = `${cssH}px`;

  const vw = videoEl.videoWidth || 1;
  const vh = videoEl.videoHeight || 1;
  const scale = Math.min(cssW / vw, cssH / vh);
  const dispW = vw * scale;
  const dispH = vh * scale;
  const offX = (cssW - dispW) / 2;
  const offY = (cssH - dispH) / 2;

  layoutCache = {
    dpr,
    contentRectPx: { x: offX * dpr, y: offY * dpr, w: dispW * dpr, h: dispH * dpr, dpr },
  };
}

function getVideoContentRectPx() {
  updateLayout(false);
  return (
    layoutCache?.contentRectPx || { x: 0, y: 0, w: canvasEl.width, h: canvasEl.height, dpr: 1 }
  );
}

function normToCanvasPx(lm) {
  const r = getVideoContentRectPx();
  const x = r.x + Math.max(0, Math.min(1, lm.x)) * r.w;
  const y = r.y + Math.max(0, Math.min(1, lm.y)) * r.h;
  return { x, y, _rect: r };
}

function clearOverlay() {
  const ctx = canvasEl.getContext("2d");
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
}

function drawOverlay(landmarks, pinchPx, pinchThresholdPx) {
  const ctx = canvasEl.getContext("2d");
  const r = getVideoContentRectPx();
  ctx.save();
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  // Mirror to match video CSS mirror.
  ctx.translate(canvasEl.width, 0);
  ctx.scale(-1, 1);

  // Draw full skeleton + landmarks (letterbox-aware mapping).
  const connections =
    (typeof window.HAND_CONNECTIONS !== "undefined" && window.HAND_CONNECTIONS) || [];
  if (connections.length && typeof window.drawConnectors === "function") {
    const mapped = landmarks.map((lm) => {
      const p = normToCanvasPx(lm);
      return { x: p.x / canvasEl.width, y: p.y / canvasEl.height, z: lm.z ?? 0 };
    });

    // Premium look: white points + subtle gray lines.
    window.drawConnectors(ctx, mapped, connections, {
      color: "rgba(200, 210, 225, 0.45)",
      lineWidth: 2 * r.dpr,
    });
    window.drawLandmarks(ctx, mapped, {
      color: "rgba(255, 255, 255, 0.98)",
      radius: 2 * r.dpr,
    });
  }

  const thumb = landmarks?.[4];
  const index = landmarks?.[8];
  if (thumb && index) {
    const a = normToCanvasPx(thumb);
    const b = normToCanvasPx(index);
    const pinching = typeof pinchPx === "number" ? pinchPx < pinchThresholdPx : false;

    ctx.strokeStyle = pinching ? "#4dd4ac" : "rgba(200, 210, 225, 0.55)";
    ctx.lineWidth = 3 * r.dpr;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 255, 255, 0.98)";
    ctx.beginPath();
    ctx.arc(b.x, b.y, 5 * r.dpr, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// Gesture smoothing.
const GESTURE_HIST_N = 7;
const gestureHist = [];
function pushGesture(code) {
  gestureHist.push(code);
  if (gestureHist.length > GESTURE_HIST_N) gestureHist.shift();
}
function stableGesture() {
  if (gestureHist.length === 0) return "NONE";
  const counts = new Map();
  for (const g of gestureHist) counts.set(g, (counts.get(g) || 0) + 1);
  let best = gestureHist[gestureHist.length - 1];
  let bestCount = -1;
  for (const [k, v] of counts.entries()) {
    if (v > bestCount) {
      best = k;
      bestCount = v;
    }
  }
  return best;
}

// Motion (index fingertip speed).
let prevIndexTipPx = null;
let prevTsMs = null;
function computeMotion(pointPx, tsMs) {
  if (!prevIndexTipPx || prevTsMs == null) {
    prevIndexTipPx = pointPx;
    prevTsMs = tsMs;
    return { speedPxPerS: 0 };
  }
  const dt = Math.max(1, tsMs - prevTsMs);
  const dx = pointPx.x - prevIndexTipPx.x;
  const dy = pointPx.y - prevIndexTipPx.y;
  const speedPxPerS = (Math.hypot(dx, dy) / dt) * 1000;
  prevIndexTipPx = pointPx;
  prevTsMs = tsMs;
  return { speedPxPerS };
}

// FPS estimate.
let lastResultsPerfMs = null;
let fpsEma = 0;

const camera = new CameraManager(videoEl, { width: 640, height: 480, frameRate: 30 });
const tracker = new HandTracker({ maxNumHands: 1, modelComplexity: 0 });

let running = false;
let loopStop = () => {};
let lastStatusUiMs = 0;
const STATUS_UI_EVERY_MS = 60;

// Pinch hysteresis so the UI reacts immediately without needing "shake" stabilization.
let pinchActive = false;
const PINCH_ENTER_RATIO = 0.8;
const PINCH_EXIT_RATIO = 0.92;

/** @type {{deviceId:string,label:string}[]} */
let cameraDevices = [];
let selectedDeviceId = null;

function shortId(id) {
  if (!id) return "";
  return id.length <= 6 ? id : `${id.slice(0, 3)}…${id.slice(-3)}`;
}

function closeCameraMenu() {
  cameraMenuEl.hidden = true;
  cameraButtonEl.setAttribute("aria-expanded", "false");
}

function openCameraMenu() {
  cameraMenuEl.hidden = false;
  cameraButtonEl.setAttribute("aria-expanded", "true");
}

function toggleCameraMenu() {
  if (cameraMenuEl.hidden) openCameraMenu();
  else closeCameraMenu();
}

function setCameraButtonText(text) {
  cameraButtonTextEl.textContent = text;
}

async function refreshCameraMenu() {
  const list = await camera.listVideoDevices();
  cameraDevices = list.map((d, i) => ({
    deviceId: d.deviceId,
    label: d.label || `Camera ${i + 1}`,
  }));

  if (!selectedDeviceId && cameraDevices.length) {
    selectedDeviceId = cameraDevices[0].deviceId;
  }

  cameraMenuEl.textContent = "";
  for (const d of cameraDevices) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dropItem";
    btn.addEventListener("click", async () => {
      selectedDeviceId = d.deviceId;
      setCameraButtonText(d.label);
      closeCameraMenu();
      if (running) {
        appendLog(`${fmtTimeMs(Date.now())}  camera_switch=${shortId(d.deviceId)}`);
        await stop();
        await start();
      }
    });

    const left = document.createElement("span");
    left.textContent = d.label;

    const right = document.createElement("span");
    right.className = "dropMeta";
    right.textContent = d.deviceId === selectedDeviceId ? "✓" : shortId(d.deviceId);

    btn.appendChild(left);
    btn.appendChild(right);
    cameraMenuEl.appendChild(btn);
  }

  const cur = cameraDevices.find((d) => d.deviceId === selectedDeviceId);
  setCameraButtonText(cur ? cur.label : cameraDevices[0]?.label || "No camera");
}

cameraButtonEl.addEventListener("click", () => toggleCameraMenu());
document.addEventListener("click", (ev) => {
  if (!cameraDropdownEl.contains(ev.target)) closeCameraMenu();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") closeCameraMenu();
});

navigator.mediaDevices?.addEventListener?.("devicechange", () => {
  refreshCameraMenu().catch(() => {});
});

tracker.onResults((results) => {
  updateLayout(false);

  const perfNow = performance.now();
  if (lastResultsPerfMs != null) {
    const dt = Math.max(1, perfNow - lastResultsPerfMs);
    const inst = 1000 / dt;
    fpsEma = fpsEma ? fpsEma * 0.85 + inst * 0.15 : inst;
  }
  lastResultsPerfMs = perfNow;

  const tsWall = Date.now();
  const tsPerf = performance.now();

  const lmList = results.multiHandLandmarks || [];
  if (!lmList.length) {
    clearOverlay();
    pushGesture("NONE");
    const tUi = performance.now();
    if (tUi - lastStatusUiMs >= STATUS_UI_EVERY_MS) {
      lastStatusUiMs = tUi;
      gestureNameEl.textContent = "无手";
      gestureDetailEl.textContent = "—";
      pinchStatusEl.textContent = "—";
      fpsOverlayEl.textContent = `FPS: ${fmt(fpsEma, 1)}`;
      for (const k of Object.keys(fingerPills)) {
        const el = fingerPills[k];
        if (!el) continue;
        el.className = "fingerPill fingerOff";
        el.textContent = `${el.textContent.split(":")[0]}:—`;
      }
    }
    appendLog(`${fmtTimeMs(tsWall)}  gesture=无手  fps=${fmt(fpsEma, 1)}`);
    return;
  }

  const landmarks = lmList[0];
  const g = classifyGesture(landmarks);
  pushGesture(g.gesture);
  const stableBase = stableGesture();

  const cn = fingerStatesToChinese(g.states);
  const extList = extendedListChinese(g.states);
  const pinchRatio = g.pinch.pinchRatio;

  // Hysteresis to avoid delayed pinch recognition due to gesture smoothing.
  if (!pinchActive && pinchRatio < PINCH_ENTER_RATIO) pinchActive = true;
  if (pinchActive && pinchRatio > PINCH_EXIT_RATIO) pinchActive = false;
  const stable = pinchActive ? "PINCH" : stableBase;

  const thumbTip = landmarks?.[4] ? normToCanvasPx(landmarks[4]) : null;
  const indexTip = landmarks?.[8] ? normToCanvasPx(landmarks[8]) : null;
  const rect = getVideoContentRectPx();
  const pinchPx =
    thumbTip && indexTip ? Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y) : null;
  const pinchThresholdPx = Math.min(rect.w, rect.h) * 0.06;

  drawOverlay(landmarks, pinchPx, pinchThresholdPx);

  const motion = indexTip ? computeMotion(indexTip, tsPerf) : { speedPxPerS: 0 };

  const tUi = performance.now();
  if (tUi - lastStatusUiMs >= STATUS_UI_EVERY_MS) {
    lastStatusUiMs = tUi;
    const primary = stable === "COMBO" ? g.label : gestureLabel(stable);
    gestureNameEl.textContent = primary;
    gestureDetailEl.textContent = `当前: ${g.label} | 伸出: ${extList} | Thumb:${cn.thumb}  Index:${cn.index}  Middle:${cn.middle}  Ring:${cn.ring}  Pinky:${cn.pinky}`;
    updateFingerPills(g.states);
    pinchStatusEl.textContent = `${pinchActive ? "是" : "否"} (r=${fmt(pinchRatio, 2)})`;
    fpsOverlayEl.textContent = `FPS: ${fmt(fpsEma, 1)}`;
  }

  appendLog(
    [
      fmtTimeMs(tsWall),
      `gesture=${gestureLabel(stable)}`,
      `code=${g.code}`,
      `ext=${extList}`,
      `pinch=${fmt(pinchPx, 0)}px`,
      `speed=${fmt(motion.speedPxPerS, 0)}px/s`,
      indexTip ? `idx=(${fmt(indexTip.x / rect.dpr, 0)},${fmt(indexTip.y / rect.dpr, 0)})` : "idx=(—,—)",
    ].join("  "),
  );
});

async function processingLoop() {
  let lastProcessMs = 0;
  const PROCESS_EVERY_MS = 33; // ~30 FPS
  let stopped = false;
  let inFlight = false;
  loopStop = () => {
    stopped = true;
  };

  const useVfc = typeof videoEl.requestVideoFrameCallback === "function";
  const step = async () => {
    if (stopped) return;
    const t = performance.now();
    if (t - lastProcessMs >= PROCESS_EVERY_MS) {
      lastProcessMs = t;
      if (!inFlight) {
        inFlight = true;
        try {
          await tracker.processVideoFrame(videoEl);
        } catch {
          // ignore
        } finally {
          inFlight = false;
        }
      }
    }

    if (useVfc) {
      videoEl.requestVideoFrameCallback(() => {
        step();
      });
    } else {
      requestAnimationFrame(() => {
        step();
      });
    }
  };

  step();
}

async function start() {
  setPill(camStatusEl, "CAM: requesting…", "warn");
  toggleBtn.disabled = true;
  try {
    await camera.start(selectedDeviceId);
    await refreshCameraMenu();
    updateLayout(true);
    running = true;
    pinchActive = false;
    setPill(camStatusEl, "CAM: running", "ok");
    toggleBtn.textContent = "Stop";
    await processingLoop();
  } catch (err) {
    running = false;
    setPill(camStatusEl, "CAM: blocked", "bad");
    appendLog(`${fmtTimeMs(Date.now())}  error=camera_denied_or_failed`);
    // eslint-disable-next-line no-console
    console.error(err);
  } finally {
    toggleBtn.disabled = false;
  }
}

async function stop() {
  loopStop();
  running = false;
  toggleBtn.textContent = "Start";
  setPill(camStatusEl, "CAM: stopped", "warn");
  prevIndexTipPx = null;
  prevTsMs = null;
  gestureHist.length = 0;
  pinchActive = false;
  clearOverlay();
  for (const k of Object.keys(fingerPills)) {
    const el = fingerPills[k];
    if (!el) continue;
    el.className = "fingerPill fingerOff";
    el.textContent = `${el.textContent.split(":")[0]}:—`;
  }
  pinchStatusEl.textContent = "—";
  await camera.stop();
}

toggleBtn.addEventListener("click", async () => {
  if (running) await stop();
  else await start();
});

// Init UI.
setPill(camStatusEl, "CAM: idle", "warn");
initFingerPills();
closeCameraMenu();
refreshCameraMenu().catch(() => {});
