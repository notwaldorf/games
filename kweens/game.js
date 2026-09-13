// =====================================================================
//  Game
// =====================================================================
const PALETTE = [
  ["#8a7bd4", "purple"], ["#a07350", "brown"], ["#c8a637", "mustard"], ["#f5d990", "butter yellow"],
  ["#eaa0e0", "orchid"], ["#9dd486", "mint"], ["#488c5c", "forest green"], ["#c67592", "rose"],
  ["#6fa8dc", "sky blue"], ["#e8935a", "tangerine"], ["#5bb5a8", "teal"], ["#b5ada1", "stone"],
  ["#d9695f", "brick red"], ["#bcd6ef", "powder blue"], ["#7a8b3c", "olive"], ["#3f6fa8", "navy"],
];
// Bump this whenever you ship a change.
const VERSION = "1.3.5";
const DIFFICULTY = {
  easy:   { label: "Easy",   min: 8,  max: 10 },
  medium: { label: "Medium", min: 11, max: 12 },
  hard:   { label: "Hard",   min: 13, max: 14 },
};
const DEFAULT_DIFFICULTY = "easy";
const MAX_LIVES = 3, MAX_HINTS = 3;
const TOUCH = matchMedia("(hover: none)").matches;
const TAP = TOUCH ? "Tap" : "Click", DTAP = TOUCH ? "Double-tap" : "Double-click";
const DEFAULT_MSG = `${TAP} once to put an ×. ${DTAP} to place a cat.`;
const DOUBLE_MS = 400;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const S = {
  level: 1,
  n: 8, reg: null, sol: null, colors: null,
  queen: null, mark: null,          // mark: 0 none, 1 crossed out, 2 wrong guess
  auto: null,                       // auto[r][c]: true when that × was placed for you (not tentative)
  pencil: false,                    // pencil mode: taps leave small corner notes instead of real marks
  pQueen: null, pMark: null,        // pencil layer: pQueen[r][c] = tentative cat, pMark[r][c] = tentative × (0/1)
  pAuto: null,                      // pAuto[r][c]: pencil × auto-derived from pencil cats (vs. one you drew)
  lives: MAX_LIVES, hints: MAX_HINTS, placed: 0, over: false,
  autoMark: true, difficulty: DEFAULT_DIFFICULTY,
};
let cells = [];

const $ = id => document.getElementById(id);
const boardEl = $("board");

const X_SVG = '<svg class="x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M4.5 4.5l15 15M19.5 4.5l-15 15"/></svg>';
const QUEEN_HTML = '<span class="queen"><svg viewBox="0 0 64 64"><use href="#cat"/></svg></span>';
const PMARK_QUEEN = '<span class="pmark pq"><svg viewBox="0 0 64 64"><use href="#cat"/></svg></span>';
const PMARK_X = '<span class="pmark px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M4.5 4.5l15 15M19.5 4.5l-15 15"/></svg></span>';
const HEART_SVG = '<svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.6-4.6-9.6-9.3C.9 8 3.2 4 7 4c2.1 0 3.8 1.2 5 3 1.2-1.8 2.9-3 5-3 3.8 0 6.1 4 4.6 7.7C19.6 16.4 12 21 12 21z"/></svg>';
const MINI_CAT = '<svg viewBox="0 0 64 64"><use href="#cat"/></svg>';

// ---------- Saved progress ----------
// Your level, difficulty and the auto-× setting are kept in localStorage. If storage is blocked, the game still works; it
// just won't remember anything between visits.
const STORE_KEY = "kweens-progress";
const OLD_STORE_KEY = "queens-cats-progress"; // from before the rename
const store = {
  load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || localStorage.getItem(OLD_STORE_KEY)) || {}; }
    catch (e) { return {}; }
  },
  save(data) { try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) {} },
};
function saveProgress(level = S.level) {
  store.save({ level, difficulty: S.difficulty, autoMark: S.autoMark });
}
function loadProgress() {
  const saved = store.load();
  S.level = Number.isInteger(saved.level) && saved.level > 0 ? saved.level : 1;
  if (typeof saved.autoMark === "boolean") S.autoMark = saved.autoMark;
  if (DIFFICULTY[saved.difficulty]) S.difficulty = saved.difficulty;
  $("autoMark").checked = S.autoMark;
}

// ---------- Board lifecycle ----------
// Big boards can take a moment to generate, so it happens in a background
// worker, and the next board is always being prepared while you play.
let worker = null, jobId = 0;
const pending = new Map();

function generateHere(n) {
  let p = null;
  while (!p) p = generate(n);
  return p;
}

try {
  // The worker needs the puzzle generator and the guess-free solver too;
  // importScripts needs absolute URLs.
  const deduceURL = new URL("deduce.js", document.baseURI).href;
  const generateURL = new URL("generate.js", document.baseURI).href;
  const src = "importScripts(" + JSON.stringify(deduceURL) + ", " + JSON.stringify(generateURL) + ");\n" +
    "self.onmessage = e => { let p = null; while (!p) p = generate(e.data.n); self.postMessage({ id: e.data.id, puzzle: p }); };";
  worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
  worker.onmessage = e => {
    const job = pending.get(e.data.id);
    if (job) { pending.delete(e.data.id); job.resolve({ n: job.n, ...e.data.puzzle }); }
  };
  worker.onerror = () => {
    // Workers unavailable: finish any queued jobs on the main thread.
    worker = null;
    for (const [id, job] of pending) { pending.delete(id); job.resolve({ n: job.n, ...generateHere(job.n) }); }
  };
} catch (err) {
  worker = null;
}

function makeBoard(n) {
  return new Promise(resolve => {
    if (!worker) { setTimeout(() => resolve({ n, ...generateHere(n) }), 30); return; }
    const id = ++jobId;
    pending.set(id, { n, resolve });
    worker.postMessage({ id, n });
  });
}

// One board per difficulty is kept ready, so switching is instant too.
const ready = {};
function prefetch(d) {
  if (!ready[d]) {
    const { min, max } = DIFFICULTY[d];
    ready[d] = makeBoard(min + rand(max - min + 1));
  }
}

let busy = false, queued = null;

async function startNewBoard(d = S.difficulty) {
  if (busy) { queued = d; return; }
  busy = true;
  S.difficulty = d;
  boardEl.classList.remove("cheer");
  boardEl.setAttribute("aria-busy", "true");
  boardEl.style.opacity = "0.35";
  setStatus("Building a new board…");
  prefetch(d);
  const puzzle = await ready[d];
  ready[d] = null;
  prefetch(d); // the current difficulty goes to the front of the queue
  for (const other of Object.keys(DIFFICULTY)) prefetch(other);
  S.n = puzzle.n;
  S.reg = puzzle.regions;
  S.sol = puzzle.solution;
  S.colors = shuffle(PALETTE.slice()).slice(0, S.n);
  boardEl.style.opacity = "";
  boardEl.removeAttribute("aria-busy");
  busy = false;
  resetBoard();
  if (queued) { const next = queued; queued = null; startNewBoard(next); }
}

function resetBoard() {
  S.queen = grid(S.n, false);
  S.mark = grid(S.n, 0);
  S.auto = grid(S.n, false);
  S.pQueen = grid(S.n, false);
  S.pMark = grid(S.n, 0);
  S.pAuto = grid(S.n, false);
  S.pencil = false;
  $("pencilBtn").setAttribute("aria-pressed", "false");
  boardEl.classList.remove("pencil-on");
  S.lives = MAX_LIVES;
  S.hints = MAX_HINTS;
  S.placed = 0;
  S.over = false;
  buildBoard();
  renderAll();
  setStatus(DEFAULT_MSG);
}

function buildBoard() {
  const n = S.n;
  boardEl.innerHTML = "";
  boardEl.style.setProperty("--n", n);
  boardEl.style.setProperty("--gap", n <= 9 ? "5px" : n <= 12 ? "4px" : "3px");
  boardEl.style.setProperty("--gap-sm", n <= 9 ? "3px" : n <= 12 ? "2.5px" : "2px");
  boardEl.setAttribute("aria-label", `${n} by ${n} board`);
  cells = grid(n, null);
  const frag = document.createDocumentFragment();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const [hex] = S.colors[S.reg[r][c]];
      const b = document.createElement("button");
      b.className = "cell";
      b.dataset.r = r; b.dataset.c = c; b.dataset.st = "";
      b.tabIndex = -1;
      b.style.setProperty("--c", hex);
      cells[r][c] = b;
      frag.appendChild(b);
    }
  }
  boardEl.appendChild(frag);
}

// ---------- Rendering ----------
function computeBlocked(queen = S.queen) {
  const n = S.n, b = grid(n, false);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!queen[r][c]) continue;
    const g = S.reg[r][c];
    for (let k = 0; k < n; k++) { b[r][k] = true; b[k][c] = true; }
    for (let rr = 0; rr < n; rr++) for (let cc = 0; cc < n; cc++) if (S.reg[rr][cc] === g) b[rr][cc] = true;
    for (const [dr, dc] of DIRS8) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n) b[rr][cc] = true;
    }
  }
  return b;
}

function renderCell(r, c) {
  const el = cells[r][c];
  const st = S.queen[r][c] ? "q"
    : S.mark[r][c] === 2 ? "w"
    : S.mark[r][c] === 1 ? (S.auto[r][c] ? "xa" : "x") : "";
  // A real mark always wins the cell; pencil notes only show on an otherwise-empty square.
  const pen = st ? "" : S.pQueen[r][c] ? "pq" : S.pMark[r][c] === 1 ? "px" : "";
  if (el.dataset.st !== st || el.dataset.pen !== pen) {
    el.dataset.st = st;
    el.dataset.pen = pen;
    const main = st === "q" ? QUEEN_HTML : st ? X_SVG : "";
    const note = pen === "pq" ? PMARK_QUEEN : pen === "px" ? PMARK_X : "";
    el.innerHTML = main + note;
  }
  const state = { q: ", cat", w: ", no cat here", x: ", crossed out", xa: ", crossed out", "": "" }[st];
  const penState = pen === "pq" ? ", pencil cat" : pen === "px" ? ", pencil cross" : "";
  el.setAttribute("aria-label", `Row ${r + 1}, column ${c + 1}, ${S.colors[S.reg[r][c]][1]}${state}${penState}`);
}

function renderAll() {
  for (let r = 0; r < S.n; r++) for (let c = 0; c < S.n; c++) renderCell(r, c);
  renderHud();
}

function renderHud() {
  $("level").textContent = S.level;
  $("placed").textContent = S.placed;
  $("total").textContent = S.n;
  const hearts = $("hearts");
  if (hearts.children.length !== MAX_LIVES) hearts.innerHTML = HEART_SVG.repeat(MAX_LIVES);
  [...hearts.children].forEach((h, i) => h.classList.toggle("lost", i >= S.lives));
  $("livesPill").setAttribute("aria-label", `${S.lives} of ${MAX_LIVES} lives left`);
  $("hintBadge").textContent = S.hints;
  $("hintBtn").disabled = S.hints === 0 || S.over;
  $("hintBtn").setAttribute("aria-label", `Use a hint, ${S.hints} left`);
}

function bump(el) {
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
}

function replayClass(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function setStatus(msg) { $("status").textContent = msg; }

// ---------- Moves ----------
// When the setting is on, every square a new cat rules out gets a regular ×,
// exactly as if you'd put it there yourself. Turning the setting off leaves
// existing ×s alone.
function autoCross() {
  if (!S.autoMark) return;
  const blocked = computeBlocked();
  for (let r = 0; r < S.n; r++) for (let c = 0; c < S.n; c++) {
    // A cat now rules this square out. Give empty squares a locked ×, and promote your own
    // hand-drawn × to a locked one too, so it fades along with the rest.
    if (blocked[r][c] && !S.queen[r][c] && S.mark[r][c] !== 2) { S.mark[r][c] = 1; S.auto[r][c] = true; }
  }
}

function placeQueen(r, c) {
  if (busy || S.over || S.queen[r][c] || S.mark[r][c] === 2 || S.auto[r][c]) return;
  if (S.sol[r] === c) {
    S.queen[r][c] = true;
    S.mark[r][c] = 0;
    S.placed++;
    autoCross();
    renderAll();
    if (S.placed === S.n) return win();
    setStatus(`Cat placed. ${S.n - S.placed} to go.`);
  } else {
    S.lives--;
    S.mark[r][c] = 2;
    renderAll();
    replayClass(cells[r][c], "shake");
    const lostHeart = $("hearts").children[S.lives];
    if (lostHeart) replayClass(lostHeart, "bump");
    if (S.lives <= 0) return lose();
    setStatus(`No cat goes there. ${S.lives} ${S.lives === 1 ? "life" : "lives"} left.`);
  }
}

function setMark(r, c, value) {
  // Auto ×s are locked: a cat already ruled the square out, so you can't undo them.
  if (busy || S.over || S.queen[r][c] || S.mark[r][c] === 2 || S.auto[r][c] || S.mark[r][c] === value) return;
  S.mark[r][c] = value;
  renderCell(r, c);
}

function toggleMark(r, c) {
  setMark(r, c, S.mark[r][c] === 1 ? 0 : 1);
}

// ---------- Pencil layer ----------
// Pencil moves never touch the real board or cost a life; they're tentative corner notes.
// Re-derive every auto pencil × from the current pencil cats, leaving your hand-drawn ones be.
function pencilAutoCross() {
  for (let r = 0; r < S.n; r++) for (let c = 0; c < S.n; c++) {
    if (S.pAuto[r][c]) { S.pMark[r][c] = 0; S.pAuto[r][c] = false; }
  }
  if (!S.autoMark) return;
  const blocked = computeBlocked(S.pQueen);
  for (let r = 0; r < S.n; r++) for (let c = 0; c < S.n; c++) {
    if (blocked[r][c] && !S.pQueen[r][c] && S.pMark[r][c] === 0) { S.pMark[r][c] = 1; S.pAuto[r][c] = true; }
  }
}

function pencilSetX(r, c, value) {
  // Only annotate squares that are still empty for real; a real mark would hide the note anyway.
  if (busy || S.over || S.queen[r][c] || S.mark[r][c] !== 0 || S.pQueen[r][c] || S.pMark[r][c] === value) return;
  S.pMark[r][c] = value;
  S.pAuto[r][c] = false;
  renderCell(r, c);
}

function pencilPlaceCat(r, c) {
  if (busy || S.over || S.queen[r][c] || S.mark[r][c] !== 0) return;
  if (S.pQueen[r][c]) {
    S.pQueen[r][c] = false;          // double-tapping a pencil cat clears it
  } else {
    S.pQueen[r][c] = true;
    S.pMark[r][c] = 0;
    S.pAuto[r][c] = false;
  }
  pencilAutoCross();
  renderAll();
}

function useHint() {
  if (busy || S.over || S.hints <= 0) return;
  // Reveal the cat of the color region with the fewest open squares left.
  const blocked = computeBlocked();
  let best = -1, bestCount = Infinity;
  for (let g = 0; g < S.n; g++) {
    if (S.queen[g][S.sol[g]]) continue;
    let count = 0;
    for (let r = 0; r < S.n; r++) for (let c = 0; c < S.n; c++) {
      if (S.reg[r][c] === g && !blocked[r][c] && S.mark[r][c] !== 2) count++;
    }
    if (count < bestCount) { bestCount = count; best = g; }
  }
  if (best < 0) return;
  const r = best, c = S.sol[best];
  S.hints--;
  S.queen[r][c] = true;
  S.mark[r][c] = 0;
  S.placed++;
  autoCross();
  renderAll();
  for (let rr = 0; rr < S.n; rr++) for (let cc = 0; cc < S.n; cc++) {
    if (S.reg[rr][cc] === best) replayClass(cells[rr][cc], "flash");
  }
  cells[r][c].classList.add("hinted");
  if (S.placed === S.n) return win();
  setStatus(`Hint: that's the ${S.colors[best][1]} cat. ${S.hints} ${S.hints === 1 ? "hint" : "hints"} left.`);
}

function win() {
  S.over = true;
  saveProgress(S.level + 1); // saved right away, even if the page closes before "Next level"
  renderAll();
  setStatus("All cats found.");

  if (!reducedMotion) {
    boardEl.classList.add("cheer");
    for (let r = 0; r < S.n; r++) cells[r][S.sol[r]].style.setProperty("--d", `${r * 45}ms`);
  }

  $("winTitle").textContent = `Level ${S.level} cleared`;
  $("winText").textContent = `You solved a ${S.n}×${S.n} board.`;
  setTimeout(() => $("winDlg").showModal(), reducedMotion ? 0 : 900 + S.n * 45);
}

function lose() {
  S.over = true;
  renderHud();
  setStatus("Out of lives.");
  setTimeout(() => $("loseDlg").showModal(), reducedMotion ? 0 : 500);
}

// ---------- Input: pointer ----------
let press = null;

function cellFrom(el) {
  const cell = el && el.closest ? el.closest(".cell") : null;
  return cell && boardEl.contains(cell) ? cell : null;
}

// One click/tap toggles an ×, a second one on the same square soon after
// places a cat. Dragging after pressing puts × on every square you pass.
// In pencil mode the same gestures write to the tentative note layer instead.
let lastTap = null;

const tapCat = (r, c) => (S.pencil ? pencilPlaceCat : placeQueen)(r, c);
const paintX = (r, c, value) => (S.pencil ? pencilSetX : setMark)(r, c, value);
const xToggleValue = (r, c) => ((S.pencil ? S.pMark[r][c] : S.mark[r][c]) === 1 ? 0 : 1);

boardEl.addEventListener("pointerdown", e => {
  const cell = cellFrom(e.target);
  if (!cell || S.over || busy || e.button > 0) return;
  const r = +cell.dataset.r, c = +cell.dataset.c;
  const now = performance.now();
  if (lastTap && lastTap.r === r && lastTap.c === c && now - lastTap.t < DOUBLE_MS) {
    lastTap = null;
    press = null;
    tapCat(r, c);
    return;
  }
  lastTap = { r, c, t: now };
  press = { id: e.pointerId, r, c, value: xToggleValue(r, c) };
  paintX(r, c, press.value);
});

window.addEventListener("pointermove", e => {
  if (!press || e.pointerId !== press.id) return;
  const cell = cellFrom(document.elementFromPoint(e.clientX, e.clientY));
  if (!cell) return;
  const r = +cell.dataset.r, c = +cell.dataset.c;
  if (r === press.r && c === press.c) return;
  paintX(r, c, press.value);
  press.r = r; press.c = c;
  lastTap = null; // a drag is never the first half of a double-click
});

const endPress = e => { if (press && e.pointerId === press.id) press = null; };
window.addEventListener("pointerup", endPress);
window.addEventListener("pointercancel", endPress);
boardEl.addEventListener("contextmenu", e => e.preventDefault());

// ---------- Buttons & dialogs ----------
document.querySelectorAll(".tap-word").forEach(el => (el.textContent = TAP));
document.querySelectorAll(".dtap-word").forEach(el => (el.textContent = DTAP));
$("hintBtn").addEventListener("click", useHint);

$("pencilBtn").addEventListener("click", () => {
  S.pencil = !S.pencil;
  $("pencilBtn").setAttribute("aria-pressed", S.pencil);
  boardEl.classList.toggle("pencil-on", S.pencil);
  setStatus(S.pencil
    ? `Pencil mode: notes only. ${TAP} for a tentative ×, ${DTAP} for a tentative cat.`
    : DEFAULT_MSG);
});

function prepNextBoard() {
  startNewBoard();
}

// ---------- New board dropdown ----------
const newMenu = $("newMenu");
function setMenu(open) {
  newMenu.hidden = !open;
  $("newBtn").setAttribute("aria-expanded", open);
  if (open) {
    newMenu.querySelectorAll(".menu-item").forEach(b => b.setAttribute("aria-checked", b.dataset.d === S.difficulty));
  }
}
$("newBtn").addEventListener("click", () => setMenu(newMenu.hidden));
newMenu.querySelectorAll(".menu-item").forEach(b => b.addEventListener("click", () => {
  setMenu(false);
  S.difficulty = b.dataset.d;
  saveProgress();
  startNewBoard(b.dataset.d);
}));
// A tap anywhere else just closes the menu (it doesn't also mark the board).
document.addEventListener("pointerdown", e => {
  if (newMenu.hidden || e.target.closest(".new-wrap")) return;
  e.stopPropagation();
  e.preventDefault();
  setMenu(false);
}, true);
document.addEventListener("keydown", e => { if (e.key === "Escape" && !newMenu.hidden) setMenu(false); });

$("nextBtn").addEventListener("click", () => {
  $("winDlg").close();
  S.level++;
  saveProgress();
  prepNextBoard();
});
$("extraLifeBtn").addEventListener("click", () => {
  $("loseDlg").close();
  S.lives = 1;
  S.over = false;
  renderAll();
  setStatus("You got another life. Careful now.");
});
$("retryBtn").addEventListener("click", () => { $("loseDlg").close(); boardEl.classList.remove("cheer"); resetBoard(); });
$("loseNewBtn").addEventListener("click", () => { $("loseDlg").close(); prepNextBoard(); });

// Win / lose dialogs need a choice, so Escape shouldn't dismiss them.
["winDlg", "loseDlg"].forEach(id => $(id).addEventListener("cancel", e => e.preventDefault()));

function disarmClear() {
  $("clearBtn").classList.remove("armed");
  $("clearBtn").textContent = "Clear history";
}
$("settingsBtn").addEventListener("click", () => {
  $("progressText").textContent = `Level ${S.level}`;
  disarmClear();
  $("settingsDlg").showModal();
});
// Two taps so progress isn't wiped by accident.
$("clearBtn").addEventListener("click", () => {
  const btn = $("clearBtn");
  if (!btn.classList.contains("armed")) {
    btn.classList.add("armed");
    btn.textContent = `${TAP} again to clear`;
    return;
  }
  S.level = 1;
  saveProgress();
  $("settingsDlg").close();
  startNewBoard();
});
$("closeSettings").addEventListener("click", () => $("settingsDlg").close());
$("autoMark").addEventListener("change", e => { S.autoMark = e.target.checked; saveProgress(); });
$("restartBtn").addEventListener("click", () => {
  if (busy) return;
  boardEl.classList.remove("cheer");
  resetBoard();
});

// ---------- Rule illustrations ----------
document.querySelectorAll(".mini").forEach(m => {
  m.innerHTML = [...m.dataset.pattern]
    .map(ch => ch === "x" ? '<span class="x"></span>' : ch === "q" ? `<span class="q">${MINI_CAT}</span>` : "<span></span>")
    .join("");
  m.setAttribute("aria-hidden", "true");
});

$("versionText").textContent = `Kweens v${VERSION}`;

// =====================================================================
//  Color test page (kweens.html#colors)
// =====================================================================
// Color-vision simulation matrices (Machado et al. 2009, full severity),
// applied to linear RGB.
const VISION = {
  normal: null,
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.303900],
  grayscale: "gray",
};
const hexToRgb = h => { const v = parseInt(h.slice(1), 16); return [v >> 16, (v >> 8) & 255, v & 255]; };
const toLinear = c => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toSrgb = c => {
  c = Math.min(1, Math.max(0, c));
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
};

function simulate(hex, mode) {
  const m = VISION[mode];
  if (!m) return hex;
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  let out;
  if (m === "gray") { const y = 0.2126 * r + 0.7152 * g + 0.0722 * b; out = [y, y, y]; }
  else out = [m[0] * r + m[1] * g + m[2] * b, m[3] * r + m[4] * g + m[5] * b, m[6] * r + m[7] * g + m[8] * b];
  return "#" + out.map(toSrgb).map(v => v.toString(16).padStart(2, "0")).join("");
}

function toLab(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
// Rounded to one decimal so the flag always agrees with the number shown.
const deltaE = (a, b) => { const p = toLab(a), q = toLab(b); return Math.round(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 10) / 10; };

function initColorLab() {
  document.querySelector(".app").hidden = true;
  $("colorLab").hidden = false;
  document.title = "Kweens color test";
  const lab = { colors: PALETTE.map(([hex, name]) => ({ hex, name })), vision: "normal", threshold: 25 };
  const shown = i => simulate(lab.colors[i].hex, lab.vision);

  function renderSwatches() {
    $("labSwatches").innerHTML = lab.colors.map((col, i) => `
      <div class="swatch">
        <div class="tiles">
          <div class="cell" style="--c:${shown(i)}"></div>
          <div class="cell" data-st="x" style="--c:${shown(i)}">${X_SVG}</div>
          <div class="cell" style="--c:${shown(i)}">${QUEEN_HTML}</div>
          <div class="cell" data-st="w" style="--c:${shown(i)}">${X_SVG}</div>
        </div>
        <div class="meta">
          <span>${col.name}<span class="hex">${col.hex}</span></span>
          <input type="color" value="${col.hex}" data-i="${i}" aria-label="Change ${col.name}">
        </div>
      </div>`).join("");
    $("labSwatches").querySelectorAll('input[type="color"]').forEach(inp => inp.addEventListener("input", e => {
      lab.colors[+e.target.dataset.i].hex = e.target.value;
      renderPairs();
      // Update just this swatch's tiles and label so the picker stays open.
      const card = e.target.closest(".swatch"), i = +e.target.dataset.i;
      card.querySelectorAll(".cell").forEach(c => c.style.setProperty("--c", shown(i)));
      card.querySelector(".hex").textContent = lab.colors[i].hex;
    }));
  }

  function renderPairs() {
    const n = lab.colors.length;
    const d = (i, j) => deltaE(shown(i), shown(j));
    const pairs = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push({ i, j, e: d(i, j) });
    pairs.sort((a, b) => a.e - b.e);
    const flagged = pairs.filter(p => p.e < lab.threshold).length;
    $("labSummary").textContent = flagged
      ? `${flagged} ${flagged === 1 ? "pair is" : "pairs are"} closer than ${lab.threshold} and may be hard to tell apart on the board.`
      : `No pairs are closer than ${lab.threshold}.`;
    $("labClosest").innerHTML = pairs.slice(0, 8).map(p => `
      <div class="close-card ${p.e < lab.threshold ? "warn" : ""}">
        <div class="two"><span style="--c:${shown(p.i)}"></span><span style="--c:${shown(p.j)}"></span></div>
        <div>${lab.colors[p.i].name} and ${lab.colors[p.j].name}<small>ΔE ${p.e.toFixed(1)}</small></div>
      </div>`).join("");

    let html = "<thead><tr><th></th>" +
      lab.colors.map((c, j) => `<th title="${c.name}"><span class="dot" style="--c:${shown(j)}"></span></th>`).join("") +
      "</tr></thead><tbody>";
    for (let i = 0; i < n; i++) {
      html += `<tr><th>${lab.colors[i].name}<span class="dot" style="--c:${shown(i)}"></span></th>`;
      for (let j = 0; j < n; j++) {
        if (i === j) { html += "<td></td>"; continue; }
        const e = d(i, j);
        html += `<td><div class="pair ${e < lab.threshold ? "warn" : ""}" title="${lab.colors[i].name} and ${lab.colors[j].name}">
          <div class="two"><span style="--c:${shown(i)}"></span><span style="--c:${shown(j)}"></span></div>
          <small>${Math.round(e)}</small></div></td>`;
      }
      html += "</tr>";
    }
    $("labMatrix").innerHTML = html + "</tbody>";
  }

  $("labVision").addEventListener("change", e => { lab.vision = e.target.value; renderSwatches(); renderPairs(); });
  $("labThreshold").addEventListener("input", e => {
    lab.threshold = +e.target.value;
    $("labThresholdOut").textContent = lab.threshold;
    renderPairs();
  });
  $("labReset").addEventListener("click", () => {
    lab.colors = PALETTE.map(([hex, name]) => ({ hex, name }));
    renderSwatches(); renderPairs();
  });
  $("labCopy").addEventListener("click", async () => {
    const code = "const PALETTE = [\n" + lab.colors.map(c => `  ["${c.hex}", "${c.name}"],`).join("\n") + "\n];";
    try { await navigator.clipboard.writeText(code); $("labCopy").textContent = "Copied"; }
    catch (e) { window.prompt("Copy this into the game:", code); }
    setTimeout(() => ($("labCopy").textContent = "Copy palette code"), 1500);
  });

  renderSwatches();
  renderPairs();
}

// Switching between the game and the color page reloads, so each starts clean.
window.addEventListener("hashchange", () => location.reload());

if (location.hash === "#colors") {
  initColorLab();
} else {
  loadProgress();
  startNewBoard();
}
