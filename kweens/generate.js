// =====================================================================
//  Puzzle generation (also runs inside a Web Worker, see makeBoard)
// =====================================================================
// GEN START
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

const rand = n => Math.floor(Math.random() * n);
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const range = n => [...Array(n).keys()];
const grid = (n, v) => Array.from({ length: n }, () => new Array(n).fill(v));

// A random valid queen layout: one per row & column, none touching.
function randomQueens(n) {
  const cols = new Array(n).fill(-1), used = new Array(n).fill(false);
  (function place(r) {
    if (r === n) return true;
    for (const c of shuffle(range(n))) {
      if (used[c] || (r > 0 && Math.abs(cols[r - 1] - c) <= 1)) continue;
      cols[r] = c; used[c] = true;
      if (place(r + 1)) return true;
      used[c] = false;
    }
    return false;
  })(0);
  return cols;
}

// Every board gets a staircase of small colors: one color with exactly 1
// square, one with 2, one with 3. All other colors end up bigger than these.
const STAIRCASE = [1, 2, 3];

// Grow n colored regions outward from each queen until the board is full.
// Region g is seeded at (g, sol[g]), so region g's queen is always in row g.
// The staircase regions are grown to their exact size first and then frozen.
function growRegions(n, sol) {
  const reg = grid(n, -1);
  const cells = [];
  for (let r = 0; r < n; r++) { reg[r][sol[r]] = r; cells.push([[r, sol[r]]]); }
  const fixed = new Array(n).fill(false);
  const picks = shuffle(range(n)).slice(0, STAIRCASE.length);
  for (let i = 0; i < picks.length; i++) {
    const g = picks[i];
    fixed[g] = true;
    while (cells[g].length < STAIRCASE[i]) {
      const frontier = [];
      for (const [r, c] of cells[g]) for (const [dr, dc] of DIRS4) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n && reg[rr][cc] === -1) frontier.push([rr, cc]);
      }
      if (!frontier.length) return null;
      const [rr, cc] = frontier[rand(frontier.length)];
      reg[rr][cc] = g; cells[g].push([rr, cc]);
    }
  }
  const weight = range(n).map(() => 0.2 + Math.random() ** 2 * 2.5); // varied region sizes
  const active = new Set(range(n).filter(g => !fixed[g]));
  let remaining = 0;
  for (const row of reg) for (const g of row) if (g === -1) remaining++;
  while (remaining > 0) {
    if (!active.size) return null; // a pocket got walled off; start over
    let total = 0;
    for (const g of active) total += weight[g];
    let x = Math.random() * total, g = -1;
    for (const k of active) { x -= weight[k]; if (x <= 0) { g = k; break; } }
    if (g === -1) g = [...active].pop();
    const frontier = [];
    for (const [r, c] of cells[g]) {
      for (const [dr, dc] of DIRS4) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n && reg[rr][cc] === -1) frontier.push([rr, cc]);
      }
    }
    if (!frontier.length) { active.delete(g); continue; }
    const [rr, cc] = frontier[rand(frontier.length)];
    reg[rr][cc] = g; cells[g].push([rr, cc]); remaining--;
  }
  return { reg, fixed };
}

// Find up to `limit` solutions. Always branches on the most constrained
// row / column / region, which keeps it fast even on 14x14 boards.
// Returns null if the search runs past its step budget.
function solve(n, reg, limit = 2, budget = 60000) {
  let steps = 0;
  const rowU = new Uint8Array(n), colU = new Uint8Array(n), regU = new Uint8Array(n);
  const adj = new Uint8Array(n * n);
  const cur = new Array(n).fill(-1);
  const out = [];
  const avail = (r, c) => !rowU[r] && !colU[c] && !regU[reg[r][c]] && !adj[r * n + c];
  const toggle = (r, c, on) => {
    const d = on ? 1 : -1, v = on ? 1 : 0;
    rowU[r] = v; colU[c] = v; regU[reg[r][c]] = v;
    for (const [dr, dc] of DIRS8) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n) adj[rr * n + cc] += d;
    }
  };
  (function rec(depth) {
    if (++steps > budget) return;
    if (depth === n) { out.push(cur.slice()); return; }
    const rc = new Int16Array(n), cc = new Int16Array(n), gc = new Int16Array(n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (avail(r, c)) { rc[r]++; cc[c]++; gc[reg[r][c]]++; }
    }
    let best = Infinity, type = 0, idx = 0;
    for (let i = 0; i < n; i++) {
      if (!rowU[i] && rc[i] < best) { best = rc[i]; type = 0; idx = i; }
      if (!colU[i] && cc[i] < best) { best = cc[i]; type = 1; idx = i; }
      if (!regU[i] && gc[i] < best) { best = gc[i]; type = 2; idx = i; }
    }
    if (best === 0) return;
    const cand = [];
    if (type === 0) { for (let c = 0; c < n; c++) if (avail(idx, c)) cand.push([idx, c]); }
    else if (type === 1) { for (let r = 0; r < n; r++) if (avail(r, idx)) cand.push([r, idx]); }
    else { for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (reg[r][c] === idx && avail(r, c)) cand.push([r, c]); }
    for (const [r, c] of cand) {
      toggle(r, c, true); cur[r] = c;
      rec(depth + 1);
      toggle(r, c, false); cur[r] = -1;
      if (out.length >= limit || steps > budget) return;
    }
  })(0);
  return steps > budget ? null : out;
}

function regionConnected(n, reg, g, sol) {
  let total = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (reg[r][c] === g) total++;
  const seen = new Set([g * n + sol[g]]);
  const stack = [[g, sol[g]]];
  while (stack.length) {
    const [r, c] = stack.pop();
    for (const [dr, dc] of DIRS4) {
      const rr = r + dr, cc = c + dc, k = rr * n + cc;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n && reg[rr][cc] === g && !seen.has(k)) { seen.add(k); stack.push([rr, cc]); }
    }
  }
  return seen.size === total;
}

// Break an unwanted alternate solution: take one of its queen squares and hand
// it (plus a path to the region's edge, and any piece that gets cut off) to a
// neighboring region. That region now holds two of its queens, so it dies,
// while the intended solution is untouched.
function repair(n, reg, sol, alt, fixed) {
  const rows = shuffle(range(n).filter(r => alt[r] !== sol[r]));
  for (const r of rows) {
    const c = alt[r], g = reg[r][c], seed = g * n + sol[g];
    if (fixed[g]) continue;
    const prev = new Map([[r * n + c, -1]]), q = [r * n + c];
    let end = -1, target = -1;
    for (let qi = 0; qi < q.length && end < 0; qi++) {
      const k = q[qi], kr = (k / n) | 0, kc = k % n;
      for (const [dr, dc] of shuffle(DIRS4.slice())) {
        const rr = kr + dr, cc = kc + dc, kk = rr * n + cc;
        if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
        if (reg[rr][cc] !== g) {
          if (fixed[reg[rr][cc]]) continue;
          end = k; target = reg[rr][cc]; break;
        }
        if (kk !== seed && !prev.has(kk)) { prev.set(kk, k); q.push(kk); }
      }
    }
    if (end < 0) continue;
    for (let k = end; k !== -1; k = prev.get(k)) reg[(k / n) | 0][k % n] = target;
    const keep = new Set([seed]), stack = [seed];
    while (stack.length) {
      const k = stack.pop(), kr = (k / n) | 0, kc = k % n;
      for (const [dr, dc] of DIRS4) {
        const rr = kr + dr, cc = kc + dc, kk = rr * n + cc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n && reg[rr][cc] === g && !keep.has(kk)) { keep.add(kk); stack.push(kk); }
      }
    }
    for (let rr = 0; rr < n; rr++) for (let cc = 0; cc < n; cc++) {
      if (reg[rr][cc] === g && !keep.has(rr * n + cc)) reg[rr][cc] = target;
    }
    return true;
  }
  return false;
}

// Even out region sizes: shift border squares from big regions to smaller
// neighbors, keeping a change only if the board still has exactly one solution.
function rebalance(n, reg, sol, tries, fixed) {
  const minFree = Math.max(...STAIRCASE) + 1;
  for (let t = 0; t < tries; t++) {
    const size = new Array(n).fill(0);
    for (const row of reg) for (const g of row) size[g]++;
    let best = null, bestGain = 1;
    for (let s = 0; s < 40; s++) {
      const r = rand(n), c = rand(n), a = reg[r][c];
      if (sol[r] === c || fixed[a]) continue;
      const [dr, dc] = DIRS4[rand(4)], rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
      const b = reg[rr][cc];
      if (b === a || fixed[b] || size[a] <= minFree) continue;
      // Colors smaller than the staircase get top priority.
      const gain = size[a] - size[b] + (size[b] < minFree ? 1000 : 0);
      if (gain > bestGain) { bestGain = gain; best = [r, c, a, b]; }
    }
    if (!best) continue;
    const [r, c, a, b] = best;
    reg[r][c] = b;
    if (!regionConnected(n, reg, a, sol) || solve(n, reg, 2)?.length !== 1) reg[r][c] = a;
  }
}

// Build a board with exactly one solution and the 1-2-3 staircase.
function generate(n) {
  const minFree = Math.max(...STAIRCASE) + 1;
  for (let attempt = 0; attempt < 40; attempt++) {
    const sol = randomQueens(n);
    const grown = growRegions(n, sol);
    if (!grown) continue;
    const { reg, fixed } = grown;
    for (let it = 0; it < 300; it++) {
      const sols = solve(n, reg, 2);
      if (!sols) break;
      if (sols.length === 1) {
        rebalance(n, reg, sol, 15 * n, fixed);
        const size = new Array(n).fill(0);
        for (const row of reg) for (const g of row) size[g]++;
        // Only keep boards that are (a) staircase-shaped and (b) solvable by pure
        // deduction — no guessing. deduceSolvable comes from deduce.js.
        if (size.every((sz, g) => fixed[g] || sz >= minFree) && deduceSolvable(n, reg)) return { regions: reg, solution: sol };
        break;
      }
      const alt = sols.find(s => s.some((c, r) => c !== sol[r]));
      if (!alt || !repair(n, reg, sol, alt, fixed)) break;
    }
  }
  return null;
}
// GEN END
