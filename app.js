/* =====================================================================
 * 指尖分类 · Sort at Fingertips
 * 手势控制的垃圾分类游戏 —— MediaPipe Hands + Canvas 2D + Web Audio
 * 视觉沿用「甬上四季」的宣纸／淡墨／朱砂；四类垃圾用国标分类色点一下。
 * 玩法：右手握拳抓起垃圾 → 移到对应桶上方 → 张开手掌投放。60 秒限时。
 * ===================================================================== */

/* ---------------- 可调参数 ---------------- */
const CONFIG = {
  camera: { width: { ideal: 1280 }, height: { ideal: 720 } },
  mp: {
    bundle:    "./vendor/mediapipe/vision_bundle.mjs",
    bundleAlt: "./vendor/mediapipe/vision_bundle.js",
    wasm:      "./vendor/mediapipe/wasm",
    model:     "./vendor/models/hand_landmarker.task",
  },
  // 手掌在摄像头里的活动范围映射到整屏（留一圈边，避免边缘够不到）
  handMap: { x0: 0.14, y0: 0.10, w: 0.72, h: 0.80 },
  // 手指伸展比：低于 closed 视为握拳（抓取），高于 open 视为张开（投放）
  grab: { closed: 0.30, open: 0.45, holdMs: 260 },
  cursor: { follow: 20 },       // 手心到光标的一阶跟随速度
  item: { follow: 22, home: 6 },// 手上跟随 / 松手回位
  round: { seconds: 60, penalty: 3, base: 10, comboMax: 5 },
  layout: { binMax: 720, binSpan: 0.47, binHMax: 190, binBottom: 0.90 },
};

/* ---------------- 小工具 ---------------- */
const clamp01 = v => Math.min(1, Math.max(0, v));
const clamp   = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth  = v => { v = clamp01(v); return v * v * (3 - 2 * v); };
const lerp    = (a, b, k) => a + (b - a) * k;
const rgba    = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const TAU = Math.PI * 2;
const rnd = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const easeOutBack = v => { const c = 1.70158, k = clamp01(v) - 1; return 1 + (c + 1) * k * k * k + c * k * k; };

const FONT_SONG  = '"Songti SC","STSong","Noto Serif SC","SimSun",serif';
const FONT_KAI   = '"Kaiti SC","STKaiti","KaiTi","Songti SC",serif';
const FONT_EMOJI = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji","Segoe UI Symbol",sans-serif';

const params = new URLSearchParams(location.search);
const STILL      = params.get("still") === "1";   // 静态检查：不请求摄像头与音频
const DEMO_START = params.get("demo") === "1";

/* ---------------- 四类垃圾 ---------------- */
const C = {
  recycle: [31, 110, 178],   // 可回收物 · 蓝
  harm:    [199, 62, 48],    // 有害垃圾 · 红
  food:    [56, 138, 84],    // 厨余垃圾 · 绿
  other:   [104, 100, 94],   // 其他垃圾 · 灰
};
const BINS = [
  { key: "recycle", short: "可回收", full: "可回收物", color: C.recycle },
  { key: "harm",    short: "有害",   full: "有害垃圾", color: C.harm },
  { key: "food",    short: "厨余",   full: "厨余垃圾", color: C.food },
  { key: "other",   short: "其他",   full: "其他垃圾", color: C.other },
];
const BIN_INDEX = { recycle: 0, harm: 1, food: 2, other: 3 };

const ITEMS = [
  // 可回收物
  { e: "📰", n: "报纸",     bin: "recycle" },
  { e: "🥤", n: "饮料瓶",   bin: "recycle" },
  { e: "🥫", n: "易拉罐",   bin: "recycle" },
  { e: "🍾", n: "玻璃瓶",   bin: "recycle" },
  { e: "📦", n: "纸箱",     bin: "recycle" },
  { e: "📚", n: "旧书",     bin: "recycle" },
  { e: "🥄", n: "金属勺",   bin: "recycle" },
  { e: "🧴", n: "洗发水瓶", bin: "recycle" },
  // 有害垃圾
  { e: "🔋", n: "废电池",   bin: "harm" },
  { e: "💊", n: "过期药品", bin: "harm" },
  { e: "🌡️", n: "水银温度计", bin: "harm" },
  { e: "💡", n: "荧光灯管", bin: "harm" },
  { e: "🎨", n: "油漆桶",   bin: "harm" },
  { e: "💅", n: "指甲油",   bin: "harm" },
  { e: "🧪", n: "杀虫剂",   bin: "harm" },
  // 厨余垃圾
  { e: "🍌", n: "香蕉皮",   bin: "food" },
  { e: "🍎", n: "苹果核",   bin: "food" },
  { e: "🍗", n: "鸡骨头",   bin: "food" },
  { e: "🥬", n: "菜叶",     bin: "food" },
  { e: "🍚", n: "剩饭",     bin: "food" },
  { e: "🥚", n: "蛋壳",     bin: "food" },
  { e: "🍉", n: "西瓜皮",   bin: "food" },
  { e: "🐟", n: "鱼骨",     bin: "food" },
  { e: "🍞", n: "过期面包", bin: "food" },
  // 其他垃圾
  { e: "🚬", n: "烟头",     bin: "other" },
  { e: "🧻", n: "用过的纸巾", bin: "other" },
  { e: "🪥", n: "旧牙刷",   bin: "other" },
  { e: "🍢", n: "竹签",     bin: "other" },
  { e: "🧽", n: "旧海绵",   bin: "other" },
  { e: "🩹", n: "创可贴",   bin: "other" },
  { e: "🍽️", n: "破碗碟",   bin: "other" },
];

/* ---------------- 全局状态 ---------------- */
const state = {
  time: 0,
  phase: "loading",       // loading | playing | over
  demo: false,
  introHint: false,       // 开局手势引导：抓起一次即隐去
  still: STILL,
  score: 0,
  combo: 0,
  bestCombo: 0,
  right: 0,
  wrong: 0,
  timeLeft: CONFIG.round.seconds,
  item: null,
  nextItemAt: 0,
  lastItem: -1,
  order: [],
  hands: { cursor: null },
  mode: "loading",
  libraryError: "",
  bins: BINS.map(() => ({ lid: 0, hot: 0, shake: 0, flash: 0 })),
  sparks: [],
  floats: [],
  motes: [],
};

/* ---------------- DOM ---------------- */
const stage   = document.getElementById("stage");
const ctx     = stage.getContext("2d");
const video   = document.getElementById("cam");
const skel    = document.getElementById("skel");
const skelCtx = skel.getContext("2d");
const el = {
  score:    document.getElementById("scoreVal"),
  combo:    document.getElementById("comboVal"),
  time:     document.getElementById("timeVal"),
  timeFill: document.getElementById("timeFill"),
  timerBlk: document.getElementById("timerBlock"),
  camWrap:  document.getElementById("camWrap"),
  toast:    document.getElementById("toast"),
  gate:     document.getElementById("gate"),
  startBtn: document.getElementById("startBtn"),
  soundBtn: document.getElementById("soundBtn"),
  muteGlyph:document.getElementById("muteGlyph"),
  errDetail:document.getElementById("errDetail"),
  tagRight: document.getElementById("tagRight"),
  over:     document.getElementById("over"),
  overScore:document.getElementById("overScore"),
  overRight:document.getElementById("overRight"),
  overWrong:document.getElementById("overWrong"),
  overAcc:  document.getElementById("overAcc"),
  overCombo:document.getElementById("overCombo"),
  overBest: document.getElementById("overBest"),
  againBtn: document.getElementById("againBtn"),
  blackout: document.getElementById("blackout"),
};

let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  stage.width = W * DPR; stage.height = H * DPR;
  stage.style.width = W + "px"; stage.style.height = H + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.imageSmoothingQuality = "high";
  layout();
}
window.addEventListener("resize", resize);

/* ---------------- 版面：垃圾桶 + 待分类区 ---------------- */
const geo = { bins: [], home: { x: 0, y: 0 }, unit: 0 };
function layout() {
  const L = CONFIG.layout;
  const n = BINS.length;
  const narrow = W < 860;
  const totalW = Math.min(W * (narrow ? 0.88 : L.binSpan), L.binMax);
  const gap = totalW * 0.035;
  const bw = (totalW - gap * (n - 1)) / n;
  const bh = Math.min(H * 0.23, L.binHMax);
  const bottom = H * L.binBottom;
  const x0 = W / 2 - totalW / 2;
  geo.bins = BINS.map((_, i) => ({
    x: x0 + i * (bw + gap), y: bottom - bh, w: bw, h: bh,
  }));
  geo.home.x = W * 0.5;
  geo.home.y = H * (narrow ? 0.34 : 0.38);
  geo.unit = Math.min(W, H);
}
resize();

/* =====================================================================
 * 音效：全部用 Web Audio 现场合成，不依赖音频文件
 * =================================================================== */
const sfx = {
  ctx: null, muted: false, master: null,
  init() {
    if (this.ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const c = new AC();
      const m = c.createGain(); m.gain.value = 0.5;
      const comp = c.createDynamicsCompressor();
      m.connect(comp); comp.connect(c.destination);
      this.ctx = c; this.master = m;
      return true;
    } catch (e) { console.warn("音频初始化失败：", e); return false; }
  },
  resume() { if (this.ctx && !this.muted && !document.hidden && this.ctx.state === "suspended") this.ctx.resume(); },
  suspend() { if (this.ctx && this.ctx.state === "running") this.ctx.suspend(); },
  tone(freq, dur, { type = "sine", vol = 0.18, at = 0, to = null } = {}) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t0 = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.03);
  },
  pick()  { this.tone(620, 0.09, { type: "triangle", vol: 0.10 }); },
  right() { this.tone(784, 0.13, { type: "sine", vol: 0.16 });
            this.tone(1046, 0.20, { type: "sine", vol: 0.14, at: 0.09 }); },
  wrong() { this.tone(196, 0.26, { type: "sawtooth", vol: 0.10, to: 92 }); },
  over()  { [523, 415, 311].forEach((f, i) => this.tone(f, 0.34, { type: "sine", vol: 0.14, at: i * 0.16 })); },
  setMuted(m) { this.muted = m; if (m) this.suspend(); else this.resume(); },
};

/* =====================================================================
 * 手势识别（MediaPipe HandLandmarker）
 * =================================================================== */
let landmarker = null, camReady = false, lastDetect = 0, camStream = null;
let visionLib = null, visionFileset = null;

const HAND_LINKS = [
  [0,1],[1,2],[2,3],[3,4], [0,5],[5,6],[6,7],[7,8], [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16], [13,17],[17,18],[18,19],[19,20], [0,17],
];

async function loadVisionLibrary() {
  const candidates = [CONFIG.mp.bundle, CONFIG.mp.bundleAlt].filter(Boolean);
  const problems = [];
  let lib = null;
  for (const url of candidates) {
    try { lib = await import(/* @vite-ignore */ url); break; }
    catch (e) {
      const line = `import("${url}") → ${e.name}: ${e.message}`;
      problems.push(line);
      console.error("[手势库]", line, e);
    }
  }
  if (!lib) {
    visionLib = null; visionFileset = null;
    state.libraryError = problems.join(" ｜ ");
    showErrorDetail(state.libraryError);
    return false;
  }
  if (!lib.FilesetResolver) {
    visionLib = null; visionFileset = null;
    state.libraryError = "模块已加载，但缺少 FilesetResolver 导出（bundle 入口可能取错了文件）";
    showErrorDetail(state.libraryError);
    return false;
  }
  visionLib = lib;
  try {
    visionFileset = await lib.FilesetResolver.forVisionTasks(CONFIG.mp.wasm);
  } catch (e) {
    visionLib = null; visionFileset = null;
    state.libraryError = `FilesetResolver.forVisionTasks("${CONFIG.mp.wasm}") → ${e.name}: ${e.message}`;
    console.error("[手势库 wasm]", state.libraryError, e);
    showErrorDetail(state.libraryError);
    return false;
  }
  state.libraryError = "";
  hideErrorDetail();
  return true;
}

async function loadHandModel() {
  try {
    if (!visionLib || !visionFileset) return false;
    landmarker = await visionLib.HandLandmarker.createFromOptions(visionFileset, {
      baseOptions: { modelAssetPath: CONFIG.mp.model, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 1,
    });
    hideErrorDetail();
    return true;
  } catch (e) {
    const line = `HandLandmarker.createFromOptions("${CONFIG.mp.model}") → ${e.name}: ${e.message}`;
    state.libraryError = line;
    showErrorDetail(line);
    console.error("[模型]", line, e);
    landmarker = null;
    return false;
  }
}

async function initCamera() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return "unsupported";
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: CONFIG.camera.width, height: CONFIG.camera.height, facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
    camStream = stream;
    await video.play();
    camReady = true;
    el.camWrap.classList.remove("hidden");
    return "ok";
  } catch (e) {
    console.warn("摄像头不可用：", e);
    const n = e && e.name;
    if (n === "NotAllowedError" || n === "SecurityError") return "denied";
    if (n === "NotFoundError" || n === "OverconstrainedError") return "notfound";
    return "error";
  }
}

function stopCamera() {
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  video.srcObject = null;
  camReady = false;
  if (el.camWrap) el.camWrap.classList.add("hidden");
}

async function resumeCamera() {
  if (state.mode !== "camera" || camReady || document.hidden) return;
  showToast("正在重新请求摄像头…", 0);
  const r = await initCamera();
  if (r === "ok") showToast("把手伸进画面", 3600);
  else showToast(camFailMessage(r).text, 5200);
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise(res => setTimeout(() => res(false), ms))]);
}

const camFailMessage = reason => ({
  denied:      { text: "摄像头不可用/被拒绝", tip: "请在 Chrome 地址栏左侧的摄像头图标里改为「允许」，然后刷新页面。" },
  notfound:    { text: "摄像头不可用 · 未找到设备", tip: "请确认摄像头已连接且未被其他程序独占，然后重试。" },
  unsupported: { text: "摄像头不可用 · 当前环境不支持", tip: "请用 localhost 或 HTTPS 访问，并换用新版 Chrome。" },
  error:       { text: "摄像头不可用 · 取流失败", tip: "请关闭占用摄像头的其他程序后按 C 重新开启。" },
}[reason] || { text: "摄像头不可用", tip: "请检查设备与浏览器权限后重试。" });

/* 手指伸展比：握拳≈0，张开≈1（不含捏合因子，便于作为“抓/放”判据） */
function calcOpenness(lm) {
  const wrist = lm[0];
  const tips = [8, 12, 16, 20], mcps = [5, 9, 13, 17];
  let sum = 0;
  for (let k = 0; k < 4; k++) sum += dist(lm[tips[k]], wrist) / (dist(lm[mcps[k]], wrist) + 1e-6);
  return clamp01((sum / 4 - 1.02) / (1.72 - 1.02));
}

function drawSkeleton(lm, color) {
  const w = skel.width, h = skel.height;
  skelCtx.strokeStyle = color; skelCtx.fillStyle = color;
  skelCtx.lineWidth = 4; skelCtx.lineCap = "round"; skelCtx.globalAlpha = 0.9;
  for (const [a, b] of HAND_LINKS) {
    skelCtx.beginPath();
    skelCtx.moveTo((1 - lm[a].x) * w, lm[a].y * h);
    skelCtx.lineTo((1 - lm[b].x) * w, lm[b].y * h);
    skelCtx.stroke();
  }
  for (const p of lm) {
    skelCtx.beginPath();
    skelCtx.arc((1 - p.x) * w, p.y * h, 6, 0, TAU);
    skelCtx.fill();
  }
  skelCtx.globalAlpha = 1;
}

function detect(now) {
  if (!landmarker || !camReady || video.readyState < 2 || now - lastDetect < 16) return;
  lastDetect = now;
  let res;
  try { res = landmarker.detectForVideo(video, now); } catch (e) { return; }
  skelCtx.clearRect(0, 0, skel.width, skel.height);
  const lms = res.landmarks || [];
  if (!lms.length) { state.hands.cursor = null; return; }

  /* 取检测到的手（手柄最靠画面中心的那只，单只足够） */
  const lm = lms[0];
  drawSkeleton(lm, "#c8552f");

  const M = CONFIG.handMap;
  const palm = lm[9];                                // 中指掌指关节 ≈ 手心
  const tx = clamp01(((1 - palm.x) - M.x0) / M.w);   // 镜像，与预览一致
  const ty = clamp01((palm.y - M.y0) / M.h);
  const open = calcOpenness(lm);

  /* 抓取/投放：握拳抓，张开放，带滞回避免抖动 */
  let grab = state.hands.cursor ? state.hands.cursor.grab : false;
  if (grab) { if (open > CONFIG.grab.open) grab = false; }
  else      { if (open < CONFIG.grab.closed) grab = true; }

  state.hands.cursor = { tx, ty, grab, open, at: now };
}

/* =====================================================================
 * 统一光标：手势 / 鼠标 / 键盘都写同一个入口
 * =================================================================== */
const cursor = {
  x: 0.5, y: 0.5, tx: 0.5, ty: 0.5,
  grab: false, prevGrab: false,
  src: "none",            // hand | pointer | keys
  handGrab: false, ptrGrab: false, keyGrab: false,
  active: false,
};
const keys = { left: false, right: false, up: false, down: false };

function handFresh(now) { return state.hands.cursor && now - state.hands.cursor.at < CONFIG.grab.holdMs; }

function updateCursor(dt, now) {
  if (handFresh(now)) {
    const h = state.hands.cursor;
    cursor.tx = h.tx; cursor.ty = h.ty;
    cursor.handGrab = h.grab;
    cursor.src = "hand";
    cursor.active = true;
  } else if (cursor.src === "hand") {
    cursor.handGrab = false;
    cursor.src = "none";
    cursor.active = false;
  }
  if (cursor.src === "keys") {
    const sp = 0.9 * dt;
    if (keys.left)  cursor.tx -= sp;
    if (keys.right) cursor.tx += sp;
    if (keys.up)    cursor.ty -= sp;
    if (keys.down)  cursor.ty += sp;
    cursor.tx = clamp01(cursor.tx); cursor.ty = clamp01(cursor.ty);
    cursor.active = true;
  }
  cursor.grab = cursor.handGrab || cursor.ptrGrab || cursor.keyGrab;

  const k = 1 - Math.exp(-CONFIG.cursor.follow * dt);
  cursor.x = lerp(cursor.x, cursor.tx, k);
  cursor.y = lerp(cursor.y, cursor.ty, k);
  cursor.px = cursor.x * W; cursor.py = cursor.y * H;

  if (cursor.grab && !cursor.prevGrab) onGrab();
  if (!cursor.grab && cursor.prevGrab) onRelease();
  cursor.prevGrab = cursor.grab;
}

/* =====================================================================
 * 局面：出题、抓取、投放、计分
 * =================================================================== */
function binAt(x, y) {
  for (let i = 0; i < geo.bins.length; i++) {
    const r = geo.bins[i];
    if (x >= r.x - r.w * 0.04 && x <= r.x + r.w * 1.04 &&
        y >= r.y - r.h * 0.55 && y <= r.y + r.h * 1.02) return i;
  }
  return -1;
}

function nextItemIndex() {
  if (!state.order.length) {
    state.order = ITEMS.map((_, i) => i);
    for (let i = state.order.length - 1; i > 0; i--) {   // 洗牌
      const j = (Math.random() * (i + 1)) | 0;
      [state.order[i], state.order[j]] = [state.order[j], state.order[i]];
    }
    if (state.order[0] === state.lastItem && state.order.length > 1) {
      [state.order[0], state.order[1]] = [state.order[1], state.order[0]];
    }
  }
  const i = state.order.shift();
  state.lastItem = i;
  return i;
}

function spawnItem() {
  const i = nextItemIndex();
  state.item = {
    i, x: geo.home.x, y: geo.home.y,
    appear: 0, held: false, mode: "idle",
    fly: 0, flyFrom: null, flyTo: null, dead: false,
    shake: 0, pop: 0,
  };
}

function onGrab() {
  if (state.phase !== "playing") return;
  const it = state.item;
  if (!it || it.dead || it.mode === "fly") return;
  it.held = true;
  it.pop = 0.4;
  state.introHint = false;      // 已经会抓了，收起引导
  sfx.pick();
}

function onRelease() {
  if (state.phase !== "playing") return;
  const it = state.item;
  if (!it || !it.held) return;
  it.held = false;
  const b = binAt(it.x, it.y);
  if (b < 0) return;                     // 没对准桶：自己飘回中间
  resolve(it, b);
}

function resolve(it, binIdx) {
  const want = BIN_INDEX[ITEMS[it.i].bin];
  const bin = geo.bins[binIdx];
  const brt = state.bins[binIdx];

  if (want === binIdx) {
    state.combo++;
    state.bestCombo = Math.max(state.bestCombo, state.combo);
    state.right++;
    const mult = Math.min(state.combo, CONFIG.round.comboMax);
    const gain = CONFIG.round.base * mult;
    state.score += gain;
    brt.lid = 1; brt.flash = 1;
    sparkAt(bin.x + bin.w / 2, bin.y + bin.h * 0.10, BINS[binIdx].color, 22);
    floatAt(bin.x + bin.w / 2, bin.y - 6, `+${gain}`, BINS[binIdx].color, 26);
    if (mult > 1) floatAt(bin.x + bin.w / 2, bin.y - 40, `连击 ×${mult}`, [158, 59, 44], 17);
    it.mode = "fly";
    it.flyFrom = { x: it.x, y: it.y };
    it.flyTo = { x: bin.x + bin.w / 2, y: bin.y + bin.h * 0.45 };
    it.fly = 0;
    sfx.right();
    syncHUD(true);
  } else {
    state.combo = 0;
    state.wrong++;
    state.timeLeft = Math.max(0, state.timeLeft - CONFIG.round.penalty);
    brt.shake = 1;
    it.shake = 1;
    floatAt(bin.x + bin.w / 2, bin.y - 6, `−${CONFIG.round.penalty}秒`, [176, 46, 38], 20);
    const cbin = geo.bins[want];
    floatAt(cbin.x + cbin.w / 2, cbin.y - 30, `应投「${BINS[want].full}」`, BINS[want].color, 14);
    state.bins[want].flash = 0.9;
    sfx.wrong();
    syncHUD(true);
    flashWrong();
  }
}

function flashWrong() {
  if (!stage.animate) return;
  stage.animate(
    [{ filter: "none" }, { filter: "saturate(1.7) brightness(0.97)" }, { filter: "none" }],
    { duration: 280, easing: "ease-out" }
  );
}

function startRound() {
  state.phase = "playing";
  state.score = 0; state.combo = 0; state.bestCombo = 0;
  state.right = 0; state.wrong = 0;
  state.timeLeft = CONFIG.round.seconds;
  state.item = null; state.nextItemAt = 0;
  state.introHint = true;       // 每局开局都提示一次怎么比手势
  state.bins.forEach(b => { b.lid = 0; b.hot = 0; b.shake = 0; b.flash = 0; });
  state.sparks.length = 0; state.floats.length = 0;
  el.over.classList.add("hidden");
  spawnItem();
  syncHUD(true);
}

function endRound() {
  state.phase = "over";
  state.item = null;
  sfx.over();
  const total = state.right + state.wrong;
  el.overScore.textContent = state.score;
  el.overRight.textContent = state.right;
  el.overWrong.textContent = state.wrong;
  el.overAcc.textContent = total ? Math.round(state.right / total * 100) + "%" : "—";
  el.overCombo.textContent = state.bestCombo;
  let best = 0;
  try { best = parseInt(localStorage.getItem("fenleiBest") || "0", 10) || 0; } catch (e) {}
  if (state.score > best) {
    best = state.score;
    try { localStorage.setItem("fenleiBest", String(best)); } catch (e) {}
    el.overBest.textContent = "刷新纪录 · 有史以来最高";
  } else {
    el.overBest.textContent = best ? `历史最高 ${best} 分` : "";
  }
  el.over.classList.remove("hidden");
}

/* ---------------- HUD ---------------- */
let lastHudTime = -1;
function syncHUD(pop) {
  el.score.textContent = state.score;
  const mult = Math.min(state.combo, CONFIG.round.comboMax);
  el.combo.textContent = state.combo >= 2 ? `${state.combo} ×${mult}` : String(state.combo);
  el.combo.classList.toggle("on", state.combo >= 2);
  if (pop) {
    for (const node of [el.score, el.combo]) {
      node.classList.remove("pop");
      void node.offsetWidth;
      node.classList.add("pop");
    }
  }
}
function syncTimer() {
  const s = Math.max(0, Math.ceil(state.timeLeft));
  if (s !== lastHudTime) {
    lastHudTime = s;
    el.time.textContent = s;
    el.timerBlk.classList.toggle("urgent", s <= 10);
  }
  el.timeFill.style.transform = `scaleX(${clamp01(state.timeLeft / CONFIG.round.seconds)})`;
}

/* =====================================================================
 * 粒子与浮字
 * =================================================================== */
function sparkAt(x, y, col, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, sp = 60 + Math.random() * 190;
    state.sparks.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
      r: 1.6 + Math.random() * 3.2, age: 0, life: 0.5 + Math.random() * 0.6,
      col,
    });
  }
}
function floatAt(x, y, text, col, size) {
  state.floats.push({ x, y, text, col, size, age: 0, life: 1.25 });
}
function spawnMote() {
  state.motes.push({
    x: Math.random(), y: 0.15 + Math.random() * 0.9,
    vx: (Math.random() - 0.5) * 0.006, vy: -0.004 - Math.random() * 0.008,
    r: 0.8 + Math.random() * 1.8, age: 0,
    life: 7 + Math.random() * 9, ph: Math.random() * TAU,
  });
}
for (let i = 0; i < 26; i++) { spawnMote(); const m = state.motes[i]; m.age = Math.random() * m.life; }

function updateFx(dt) {
  for (let i = state.sparks.length - 1; i >= 0; i--) {
    const p = state.sparks[i];
    p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 380 * dt; p.vx *= 0.97;
    if (p.age > p.life) state.sparks.splice(i, 1);
  }
  for (let i = state.floats.length - 1; i >= 0; i--) {
    const f = state.floats[i];
    f.age += dt; f.y -= 34 * dt;
    if (f.age > f.life) state.floats.splice(i, 1);
  }
  if (state.motes.length < 34 && Math.random() < dt * 2.2) spawnMote();
  for (let i = state.motes.length - 1; i >= 0; i--) {
    const m = state.motes[i];
    m.age += dt;
    m.x += (m.vx + Math.sin(state.time * 0.6 + m.ph) * 0.004) * dt;
    m.y += m.vy * dt;
    if (m.age > m.life || m.y < -0.05 || m.x < -0.05 || m.x > 1.05) state.motes.splice(i, 1);
  }
}

/* =====================================================================
 * 纸纹与颗粒（一次生成，不每帧重算）
 * =================================================================== */
let grainPat = null, paperTex = null;
function makeNoiseTextures() {
  const g = document.createElement("canvas");
  g.width = g.height = 128;
  const gc = g.getContext("2d");
  const id = gc.createImageData(128, 128);
  for (let i = 0; i < id.data.length; i += 4) {
    const v = 128 + (Math.random() * 70 - 35) | 0;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
    id.data[i + 3] = 255;
  }
  gc.putImageData(id, 0, 0);
  grainPat = ctx.createPattern(g, "repeat");

  const p = document.createElement("canvas");
  p.width = p.height = 256;
  const pc = p.getContext("2d");
  pc.fillStyle = "#f2eee4"; pc.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 760; i++) {
    pc.fillStyle = `rgba(${180 + Math.random() * 40 | 0},${170 + Math.random() * 40 | 0},${150 + Math.random() * 40 | 0},0.045)`;
    pc.beginPath();
    pc.arc(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 7, 0, TAU);
    pc.fill();
  }
  pc.strokeStyle = "rgba(120,108,88,0.045)";
  pc.lineWidth = 0.8;
  for (let i = 0; i < 120; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const a = Math.random() * TAU, l = 4 + Math.random() * 14;
    pc.beginPath(); pc.moveTo(x, y); pc.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); pc.stroke();
  }
  paperTex = p;
}
makeNoiseTextures();

/* =====================================================================
 * 绘制
 * =================================================================== */
const PAPER = {
  top: [247, 242, 232], bot: [236, 228, 214],
  light: [255, 226, 196], lightA: 0.34, lightX: 0.30, lightY: 0.18, lightR: 0.86,
  mist: [252, 246, 238], mistA: 0.26, mistY: 0.60,
  vignette: [78, 64, 50], vignetteA: 0.15, paperMul: 0.042, grain: 0.030,
};
const INK = [46, 41, 35];

function softEllipse(c, cx, cy, rx, ry, color, alpha) {
  if (alpha <= 0.001) return;
  c.save();
  c.translate(cx, cy);
  c.scale(Math.max(1, rx), Math.max(1, ry));
  const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.52, rgba(color, alpha * 0.38));
  g.addColorStop(1, rgba(color, 0));
  c.fillStyle = g;
  c.beginPath(); c.arc(0, 0, 1, 0, TAU); c.fill();
  c.restore();
}

function roundRect(c, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.lineTo(x + w - rr, y); c.quadraticCurveTo(x + w, y, x + w, y + rr);
  c.lineTo(x + w, y + h - rr); c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  c.lineTo(x + rr, y + h); c.quadraticCurveTo(x, y + h, x, y + h - rr);
  c.lineTo(x, y + rr); c.quadraticCurveTo(x, y, x + rr, y);
  c.closePath();
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgba(PAPER.top, 1));
  g.addColorStop(1, rgba(PAPER.bot, 1));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const lx = W * PAPER.lightX, ly = H * PAPER.lightY;
  const lr = Math.max(W, H) * PAPER.lightR;
  const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
  lg.addColorStop(0, rgba(PAPER.light, PAPER.lightA));
  lg.addColorStop(0.52, rgba(PAPER.light, PAPER.lightA * 0.32));
  lg.addColorStop(1, rgba(PAPER.light, 0));
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < 3; i++) {
    const cx = W * (0.16 + i * 0.33 + Math.sin(state.time * 0.018 + i * 1.7) * 0.030);
    const cy = H * (PAPER.mistY + i * 0.125) + Math.sin(state.time * 0.022 + i * 1.3) * H * 0.012;
    softEllipse(ctx, cx, cy, W * (0.34 + i * 0.10), H * (0.085 + i * 0.022),
      PAPER.mist, PAPER.mistA * (i === 1 ? 1 : 0.68));
  }
  // 桌面：一道极淡的“地平”，让桶有落处
  softEllipse(ctx, W * 0.5, H * 1.02, W * 0.62, H * 0.10, PAPER.vignette, 0.06);

  for (const m of state.motes) {
    const fade = Math.min(1, m.age / 1.4) * Math.min(1, (m.life - m.age) / 1.6);
    ctx.fillStyle = rgba([196, 178, 150], 0.34 * fade);
    ctx.beginPath();
    ctx.arc(m.x * W, m.y * H, m.r, 0, TAU);
    ctx.fill();
  }

  const cx = W / 2, cy = H * 0.52;
  const vg = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.36, cx, cy, Math.max(W, H) * 0.86);
  vg.addColorStop(0, rgba(PAPER.vignette, 0));
  vg.addColorStop(0.72, rgba(PAPER.vignette, PAPER.vignetteA * 0.28));
  vg.addColorStop(1, rgba(PAPER.vignette, PAPER.vignetteA));
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

function drawPaper() {
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = PAPER.paperMul;
  ctx.drawImage(paperTex, 0, 0, W, H);
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = PAPER.grain;
  const ox = (Math.random() * 128) | 0, oy = (Math.random() * 128) | 0;
  ctx.translate(-ox, -oy);
  ctx.fillStyle = grainPat;
  ctx.fillRect(0, 0, W + 128, H + 128);
  ctx.restore();
}

/* ---------------- 垃圾桶 ---------------- */
function drawBins(dt) {
  const itemOver = state.item && (state.item.held || state.item.mode === "fly")
    ? binAt(state.item.x, state.item.y) : -1;

  for (let i = 0; i < BINS.length; i++) {
    const B = BINS[i], r = geo.bins[i], rt = state.bins[i];
    const wantHot = i === itemOver ? 1 : 0;
    rt.hot += (wantHot - rt.hot) * Math.min(1, dt * 12);
    rt.flash = Math.max(0, rt.flash - dt * 1.8);
    rt.shake = Math.max(0, rt.shake - dt * 2.6);
    // 桶盖：悬停时半开，投中/揭示答案时全开
    const lidTarget = Math.max(rt.hot * 0.62, rt.flash);
    rt.lid += (lidTarget - rt.lid) * Math.min(1, dt * 11);

    const sx = rt.shake > 0 ? Math.sin(state.time * 46) * rt.shake * 6 : 0;
    ctx.save();
    ctx.translate(sx, 0);

    const cxp = r.x + r.w / 2;
    const rimY = r.y + r.h * 0.30;
    const botY = r.y + r.h;
    const topW = r.w * 0.90, botW = r.w * 0.70;
    const hot = rt.hot;

    // 影子
    softEllipse(ctx, cxp, botY + r.h * 0.035, r.w * 0.46, r.h * 0.055, [72, 60, 46], 0.09 + hot * 0.03);

    // 桶身
    ctx.beginPath();
    ctx.moveTo(cxp - topW / 2, rimY);
    ctx.lineTo(cxp + topW / 2, rimY);
    ctx.lineTo(cxp + botW / 2, botY);
    ctx.lineTo(cxp - botW / 2, botY);
    ctx.closePath();
    const bg = ctx.createLinearGradient(0, rimY, 0, botY);
    bg.addColorStop(0, rgba(B.color, 0.075 + hot * 0.075));
    bg.addColorStop(1, rgba(B.color, 0.15 + hot * 0.10));
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = 1.6 + hot * 0.7;
    ctx.strokeStyle = rgba(INK, 0.62 + hot * 0.30);
    ctx.stroke();

    // 桶身：竖排短名
    const chars = B.short.split("");
    const fs = Math.max(14, Math.min(r.w * 0.26, r.h * 0.185));
    ctx.save();
    ctx.font = `600 ${fs}px ${FONT_KAI}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = rgba(INK, 0.80 + hot * 0.15);
    const step = fs * 1.10;
    const y0 = rimY + (botY - rimY) / 2 - (chars.length - 1) * step / 2;
    chars.forEach((ch, k) => ctx.fillText(ch, cxp, y0 + k * step));
    ctx.restore();

    // 桶盖：分类色，被抓取的垃圾悬停时自动掀开
    const lidW = topW * 1.10, lidH = Math.max(9, r.h * 0.13);
    const lidY = rimY - lidH;
    ctx.save();
    ctx.translate(cxp, lidY + lidH / 2);
    ctx.rotate(-rt.lid * 0.20);
    ctx.translate(0, -rt.lid * lidH * 1.5);
    roundRect(ctx, -lidW / 2, -lidH / 2, lidW, lidH, 3);
    ctx.fillStyle = rgba(B.color, 0.80 + hot * 0.16);
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = rgba(INK, 0.66);
    ctx.stroke();
    ctx.restore();

    // 盖子把手
    roundRect(ctx, cxp - lidW * 0.14, lidY - lidH * 0.62, lidW * 0.28, Math.max(3, lidH * 0.34), 2);
    ctx.fillStyle = rgba(B.color, 0.72);
    ctx.fill();
    ctx.strokeStyle = rgba(INK, 0.55);
    ctx.lineWidth = 1.1;
    ctx.stroke();

    // 命中高亮：朱砂细线
    if (hot > 0.02) {
      ctx.save();
      ctx.globalAlpha = hot * 0.55;
      ctx.strokeStyle = rgba([158, 59, 44], 1);
      ctx.lineWidth = 1.2;
      roundRect(ctx, r.x - 6, rimY - 8, r.w + 12, botY - rimY + 16, 4);
      ctx.stroke();
      ctx.restore();
    }

    // 桶下：全名
    ctx.font = `${Math.max(11, Math.min(r.w * 0.16, 15))}px ${FONT_KAI}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = rgba(INK, 0.52 + hot * 0.30);
    ctx.fillText(B.full, cxp, botY + 12);

    ctx.restore();
  }
}

/* ---------------- 垃圾对象 ---------------- */
function drawItem(it, x, y, scale, alpha, rot) {
  const def = ITEMS[it.i];
  const R = geo.unit * 0.062;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(scale, scale);

  // 落纸柔影
  softEllipse(ctx, 0, R * 0.98, R * 0.80, R * 0.22, [72, 60, 46], 0.13);

  // 纸牌圆盘
  const g = ctx.createRadialGradient(-R * 0.3, -R * 0.35, R * 0.1, 0, 0, R * 1.05);
  g.addColorStop(0, "#fdfaf3");
  g.addColorStop(1, "#efe5d2");
  ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU);
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 1.6; ctx.strokeStyle = rgba(INK, 0.55); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, R * 0.90, 0, TAU);
  ctx.lineWidth = 0.9; ctx.strokeStyle = rgba(INK, 0.16); ctx.stroke();

  // 图形
  ctx.font = `${R * 1.18}px ${FONT_EMOJI}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(def.e, 0, R * 0.04);

  // 名称牌
  ctx.font = `600 ${Math.max(13, R * 0.30)}px ${FONT_KAI}`;
  const tw = ctx.measureText(def.n).width;
  const pw = tw + 24, ph = Math.max(22, R * 0.52);
  const py = R + 10;
  roundRect(ctx, -pw / 2, py, pw, ph, 3);
  ctx.fillStyle = rgba([246, 240, 229], 0.88);
  ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = rgba(INK, 0.26); ctx.stroke();
  ctx.fillStyle = rgba(INK, 0.86);
  ctx.textBaseline = "middle";
  ctx.fillText(def.n, 0, py + ph / 2 + 0.5);

  ctx.restore();
}

function updateItem(dt) {
  const it = state.item;
  if (!it) return;
  it.appear = Math.min(1, it.appear + dt / 0.34);
  it.shake = Math.max(0, it.shake - dt * 2.8);
  it.pop = Math.max(0, it.pop - dt * 3.2);

  if (it.mode === "fly") {
    it.fly = Math.min(1, it.fly + dt / 0.30);
    const k = smooth(it.fly);
    it.x = lerp(it.flyFrom.x, it.flyTo.x, k);
    it.y = lerp(it.flyFrom.y, it.flyTo.y, k);
    if (it.fly >= 1) {
      it.dead = true;
      state.item = null;
      state.nextItemAt = state.time + 0.22;
    }
    return;
  }

  if (it.held) {
    const k = 1 - Math.exp(-CONFIG.item.follow * dt);
    it.x = lerp(it.x, cursor.px, k);
    it.y = lerp(it.y, cursor.py, k);
  } else {
    const k = 1 - Math.exp(-CONFIG.item.home * dt);
    it.x = lerp(it.x, geo.home.x, k);
    it.y = lerp(it.y, geo.home.y, k);
  }
}

function drawItemNow() {
  const it = state.item;
  if (!it) return;
  const sh = it.shake > 0 ? Math.sin(state.time * 52) * it.shake * 9 : 0;
  const scale = easeOutBack(it.appear) * (1 + it.pop * 0.16) * (it.held ? 1.08 : 1);
  const rot = it.held ? Math.sin(state.time * 3) * 0.04 : Math.sin(state.time * 1.2) * 0.02;
  drawItem(it, it.x + sh, it.y, scale, 1, rot);
}

/* ---------------- 光标 ---------------- */
function drawCursor() {
  const showHand = cursor.src === "hand";
  const x = cursor.x * W, y = cursor.y * H;
  const R = geo.unit * 0.020;

  // 目标点：一小圈淡墨
  ctx.beginPath();
  ctx.arc(x, y, R, 0, TAU);
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = rgba(INK, showHand ? 0.30 : 0.20);
  ctx.stroke();

  // 抓握状态：朱砂实心点 + 外扩环
  if (cursor.grab) {
    ctx.beginPath();
    ctx.arc(x, y, R * 0.42, 0, TAU);
    ctx.fillStyle = rgba([158, 59, 44], 0.92);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, R * (1.9 + Math.sin(state.time * 7) * 0.14), 0, TAU);
    ctx.strokeStyle = rgba([158, 59, 44], 0.42);
    ctx.lineWidth = 1.1;
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(x, y, R * 0.26, 0, TAU);
    ctx.fillStyle = rgba(INK, 0.34);
    ctx.fill();
  }
}

/* ---------------- 开局引导 ---------------- */
function drawIntro() {
  if (!state.introHint || state.phase !== "playing" || state.demo) return;
  const a = 0.52 + Math.sin(state.time * 2.6) * 0.20;
  const fs = Math.max(15, geo.unit * 0.021);
  ctx.save();
  ctx.globalAlpha = clamp01(a);
  ctx.font = `600 ${fs}px ${FONT_KAI}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = rgba(INK, 0.82);
  ctx.fillText("握拳抓取 · 张开投放", geo.home.x, geo.home.y - geo.unit * 0.130);
  ctx.restore();
}

function drawFx() {
  for (const p of state.sparks) {
    const a = Math.max(0, 1 - p.age / p.life);
    ctx.fillStyle = rgba(p.col, a * 0.85);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * (0.5 + a * 0.7), 0, TAU);
    ctx.fill();
  }
  for (const f of state.floats) {
    const k = f.age / f.life;
    const a = k < 0.15 ? k / 0.15 : Math.max(0, 1 - (k - 0.15) / 0.85);
    ctx.globalAlpha = a;
    ctx.font = `600 ${f.size}px ${FONT_KAI}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = rgba([247, 242, 232], 0.75);
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = rgba(f.col, 0.95);
    ctx.fillText(f.text, f.x, f.y);
    ctx.globalAlpha = 1;
  }
}

/* =====================================================================
 * 主循环
 * =================================================================== */
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  state.time += dt;

  detect(now);
  updateCursor(dt, now);

  if (el.tagRight) el.tagRight.classList.toggle("on", handFresh(now));

  if (state.phase === "playing" && !state.demo) {
    state.timeLeft = Math.max(0, state.timeLeft - dt);
    if (state.timeLeft <= 0) endRound();
    if (!state.item && state.time >= state.nextItemAt) spawnItem();
  }

  updateItem(dt);
  updateFx(dt);

  drawBackground();
  drawBins(dt);
  drawItemNow();
  drawIntro();
  if (state.phase === "playing" || state.phase === "over") {
    drawCursor();
    drawFx();
  }
  drawPaper();

  syncTimer();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* =====================================================================
 * 提示 / 错误
 * =================================================================== */
let toastTimer = null;
function showToast(text, ms = 4200) {
  if (!el.toast || state.demo || state.still) return;
  el.toast.textContent = text;
  el.toast.classList.add("show");
  clearTimeout(toastTimer);
  if (ms > 0) toastTimer = setTimeout(() => el.toast.classList.remove("show"), ms);
}
function showErrorDetail(txt) {
  if (!el.errDetail || !txt) return;
  el.errDetail.textContent = `[加载诊断] ${txt}`;
  el.errDetail.classList.remove("hidden");
}
function hideErrorDetail() {
  if (!el.errDetail) return;
  el.errDetail.classList.add("hidden");
  el.errDetail.textContent = "";
}

/* =====================================================================
 * 输入：键盘降级
 * =================================================================== */
const KEYMAP = {
  ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
};
window.addEventListener("keydown", e => {
  if (KEYMAP[e.code]) {
    e.preventDefault();
    keys[KEYMAP[e.code]] = true;
    if (cursor.src !== "hand") cursor.src = "keys";
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    if (!e.repeat) { cursor.keyGrab = true; if (cursor.src !== "hand") cursor.src = "keys"; }
    return;
  }
  if (e.code === "KeyR") { startRound(); return; }
  if (e.code === "KeyM") { syncSoundUI(!sfx.muted); return; }
  if (e.code === "KeyC") {
    if (camReady) { stopCamera(); showToast("摄像头已关闭 · 按 C 重新开启", 4200); }
    else resumeCamera();
    return;
  }
  if (e.code === "KeyD") { setDemo(!state.demo); return; }
  if (e.code === "Escape" && state.demo) { setDemo(false); return; }
});
window.addEventListener("keyup", e => {
  if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false;
  if (e.code === "Space") cursor.keyGrab = false;
});

/* ---------------- 鼠标降级 ---------------- */
window.addEventListener("mousedown", e => {
  if (e.target.closest("#gate") || e.target.closest("#over") || e.target.closest("button")) return;
  cursor.ptrGrab = true;
  if (cursor.src !== "hand") cursor.src = "pointer";
  cursor.tx = clamp01(e.clientX / W);
  cursor.ty = clamp01(e.clientY / H);
});
window.addEventListener("mousemove", e => {
  if (cursor.src === "hand") return;
  cursor.tx = clamp01(e.clientX / W);
  cursor.ty = clamp01(e.clientY / H);
  if (!cursor.ptrGrab && cursor.src === "none") cursor.src = "pointer";
});
window.addEventListener("mouseup", () => { cursor.ptrGrab = false; });
window.addEventListener("touchstart", e => {
  const t = e.touches[0]; if (!t) return;
  cursor.ptrGrab = true;
  if (cursor.src !== "hand") cursor.src = "pointer";
  cursor.tx = clamp01(t.clientX / W); cursor.ty = clamp01(t.clientY / H);
}, { passive: true });
window.addEventListener("touchmove", e => {
  const t = e.touches[0]; if (!t || cursor.src === "hand") return;
  cursor.tx = clamp01(t.clientX / W); cursor.ty = clamp01(t.clientY / H);
}, { passive: true });
window.addEventListener("touchend", () => { cursor.ptrGrab = false; });

/* =====================================================================
 * 演示模式 / 声音 / 回看小窗 / 入口
 * =================================================================== */
let blackoutTimer = null;
function setDemo(on) {
  if (state.demo === on) return;
  el.blackout.classList.add("on");
  clearTimeout(blackoutTimer);
  blackoutTimer = setTimeout(() => {
    state.demo = on;
    document.body.classList.toggle("demo", on);
    el.blackout.classList.remove("on");
    if (on) { el.toast.classList.remove("show"); hideErrorDetail(); }
  }, 180);
}

function syncSoundUI(muted) {
  sfx.setMuted(muted);
  el.muteGlyph.textContent = muted ? "静" : "♪";
  el.soundBtn.classList.toggle("muted", muted);
}
el.soundBtn.addEventListener("click", () => syncSoundUI(!sfx.muted));

/* ---------------- 回看小窗：拖动 + 记住位置 ---------------- */
skel.width = 1280; skel.height = 720;
(function setupCamDrag() {
  const w = el.camWrap;
  if (!w) return;
  try {
    const saved = JSON.parse(localStorage.getItem("camPos") || "null");
    if (saved && typeof saved.x === "number") {
      w.style.right = "auto"; w.style.bottom = "auto";
      w.style.left = (saved.x * 100) + "vw";
      w.style.top = (saved.y * 100) + "vh";
    }
  } catch (e) {}
  let dragging = false, ox = 0, oy = 0;
  const onDown = e => {
    dragging = true; w.classList.add("dragging");
    const r = w.getBoundingClientRect();
    ox = e.clientX - r.left; oy = e.clientY - r.top;
    e.preventDefault();
  };
  const onMove = e => {
    if (!dragging) return;
    w.style.right = "auto"; w.style.bottom = "auto";
    const nx = Math.max(0, Math.min(window.innerWidth - w.offsetWidth, e.clientX - ox));
    const ny = Math.max(0, Math.min(window.innerHeight - w.offsetHeight, e.clientY - oy));
    w.style.left = nx + "px"; w.style.top = ny + "px";
    try { localStorage.setItem("camPos", JSON.stringify({ x: nx / window.innerWidth, y: ny / window.innerHeight })); } catch (e) {}
  };
  const onUp = () => { dragging = false; w.classList.remove("dragging"); };
  w.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
})();

/* 后台/失焦挂起，回前台恢复 */
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { sfx.suspend(); stopCamera(); }
  else { sfx.resume(); resumeCamera(); }
});
window.addEventListener("blur", () => { sfx.suspend(); stopCamera(); });
window.addEventListener("focus", () => { if (!document.hidden) { sfx.resume(); resumeCamera(); } });

/* ---------------- 入口 ---------------- */
async function enterGame() {
  el.gate.classList.add("hide");
  sfx.init(); sfx.resume();
  showToast("正在加载手势库…", 0);

  if (!(await withTimeout(loadVisionLibrary(), 15000))) {
    enterFallback("手势库加载失败 · 见下方诊断",
      "把 [加载诊断] 那行原样念给老师；并确认是用 http://localhost 打开本页（不要直接双击 index.html），vendor/mediapipe/ 里的文件也要完整。");
    return;
  }

  showToast("正在请求摄像头权限…", 0);
  const camRes = await withTimeout(initCamera(), 12000);
  if (camRes !== "ok") {
    const m = camFailMessage(camRes === false ? "error" : camRes);
    enterFallback(camRes === false ? "摄像头请求超时" : m.text,
      camRes === false ? "授权弹窗无响应，请在 Chrome 里允许摄像头后刷新页面。" : m.tip);
    return;
  }

  showToast("正在加载手势模型…", 0);
  if (!(await withTimeout(loadHandModel(), 25000))) {
    stopCamera();
    enterFallback("模型加载失败",
      "请确认 vendor/models/hand_landmarker.task 文件存在且未损坏（正常约 7.6 MB）。");
    return;
  }

  state.mode = "camera";
  hideErrorDetail();
  showToast("60 秒 · 把垃圾送回对的桶", 4200);
  startRound();
}

function enterFallback(msg, tip) {
  state.mode = "fallback";
  el.camWrap.classList.add("hidden");
  video.style.display = "none";
  skel.style.display = "none";
  showToast(msg || "手动模式 · 鼠标拖动或用方向键", 7000);
  if (tip) showErrorDetail(tip);
  startRound();
}

el.startBtn.addEventListener("click", enterGame);
el.againBtn.addEventListener("click", () => startRound());

/* ---------------- 静态检查：?still=1&demo=1 ---------------- */
if (STILL) {
  el.gate.style.display = "none";
  el.camWrap.classList.add("hidden");
  state.mode = "fallback";
  if (!DEMO_START) { el.score.textContent = "120"; el.combo.textContent = "3"; }
  startRound();
  if (DEMO_START) { state.demo = true; document.body.classList.add("demo"); }
}
