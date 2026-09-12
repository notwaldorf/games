// =====================================================================
//  Guess-free solver  (deduce.js)
// =====================================================================
// Used by the board generator as an ACCEPTANCE FILTER: a board is kept only
// if this solver can place every queen using pure logic — never trial and
// error. A board with a single valid answer can still force guessing, and
// that is what made the old levels feel unfair; requiring `deduceSolvable`
// removes it.
//
// Written from scratch for this project. The human-style, rule-based approach
// is inspired by open-source Queens solvers (e.g. github.com/zkhan04/queens),
// but shares no code with them.
//
// The rules of the game: exactly one queen per row, per column, and per
// colored region, and no two queens touching (including diagonally).
//
// Deduction techniques, gentlest first:
//   1. Singles   — a row / column / region with one candidate left is forced.
//   2. Pointing  — if every candidate of a region shares one row (or column),
//                  that line's queen must be in the region, so other regions
//                  lose that line.
//   3. Claiming  — if every candidate of a row (or column) sits in one region,
//                  that region's queen is in that line, so it loses its other
//                  lines. (The mirror image of pointing.)
//   4. Subsets   — k regions whose candidates fit in exactly k lines (or k
//                  lines whose candidates fit in exactly k regions) lock those
//                  lines/regions out for everyone else. Pointing and claiming
//                  are just the k = 1 case; this generalizes them up to
//                  `maxSubset`.
//
// Every rule only ever *removes* impossible candidates or places a *forced*
// queen, so it can never rule out the real solution — if it finishes, the
// board is genuinely solvable without guessing.
//
// Exposes deduceSolvable(n, reg[, opts]) -> boolean and attaches it to the
// global object so the generation Web Worker can importScripts() it.

(function (root) {
  "use strict";
  const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const popcount = x => { let c = 0; while (x) { x &= x - 1; c++; } return c; };

  function deduceSolvable(n, reg, opts) {
    const maxSubset = (opts && opts.maxSubset) || 4;
    const UNK = 0, Q = 1, X = 2; // cell state: unknown, queen, eliminated
    const st = new Uint8Array(n * n);
    const rowHas = new Uint8Array(n), colHas = new Uint8Array(n), regHas = new Uint8Array(n);
    let placed = 0, dead = false;

    const idx = (r, c) => r * n + c;
    const elim = i => (st[i] === UNK ? (st[i] = X, true) : false);

    // Place a queen and remove everything it rules out.
    function place(r, c) {
      const g = reg[r][c];
      st[idx(r, c)] = Q; rowHas[r] = colHas[c] = regHas[g] = 1; placed++;
      for (let k = 0; k < n; k++) { if (k !== c) elim(idx(r, k)); if (k !== r) elim(idx(k, c)); }
      for (let rr = 0; rr < n; rr++) for (let cc = 0; cc < n; cc++)
        if (reg[rr][cc] === g && !(rr === r && cc === c)) elim(idx(rr, cc));
      for (const [dr, dc] of DIRS8) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n) elim(idx(rr, cc));
      }
    }

    // Rule 1: place any row / column / region that has a single candidate.
    function singles() {
      let changed = false;
      for (let r = 0; r < n; r++) if (!rowHas[r]) {
        let cnt = 0, col = -1;
        for (let c = 0; c < n; c++) if (st[idx(r, c)] === UNK) { cnt++; col = c; }
        if (cnt === 0) { dead = true; return false; }
        if (cnt === 1) { place(r, col); changed = true; }
      }
      for (let c = 0; c < n; c++) if (!colHas[c]) {
        let cnt = 0, row = -1;
        for (let r = 0; r < n; r++) if (st[idx(r, c)] === UNK) { cnt++; row = r; }
        if (cnt === 0) { dead = true; return false; }
        if (cnt === 1) { place(row, c); changed = true; }
      }
      const cnt = new Int16Array(n), lr = new Int16Array(n), lc = new Int16Array(n);
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (st[idx(r, c)] === UNK) {
        const g = reg[r][c]; cnt[g]++; lr[g] = r; lc[g] = c;
      }
      for (let g = 0; g < n; g++) if (!regHas[g]) {
        if (cnt[g] === 0) { dead = true; return false; }
        if (cnt[g] === 1) { place(lr[g], lc[g]); changed = true; }
      }
      return changed;
    }

    // Find one "locked set" among `items` (each { id, mask } over n bits) and
    // run `apply` on it, where a locked set of size k has its masks union to
    // exactly k slots. Stops after the first set that actually removes a
    // candidate, so the caller re-derives from fresh state next pass.
    function lockedSets(items, apply) {
      const m = items.length, chosen = [];
      let done = false;
      (function dfs(start, union) {
        if (done) return;
        const pc = popcount(union);
        if (chosen.length > 0 && pc === chosen.length && apply(chosen, union)) { done = true; return; }
        if (chosen.length >= maxSubset || pc >= maxSubset) return;
        for (let i = start; i < m && !done; i++) {
          chosen.push(items[i].id);
          dfs(i + 1, union | items[i].mask);
          chosen.pop();
        }
      })(0, 0);
      return done;
    }

    // Rules 2-4, regions confined to lines: k regions whose candidates fit in
    // k rows (or columns) mean those lines belong to those regions.
    function regionsToLines(byRow) {
      const items = [];
      for (let g = 0; g < n; g++) if (!regHas[g]) {
        let mask = 0;
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
          if (reg[r][c] === g && st[idx(r, c)] === UNK) mask |= 1 << (byRow ? r : c);
        if (mask) items.push({ id: g, mask });
      }
      return lockedSets(items, (regs, lines) => {
        const inSet = new Uint8Array(n);
        for (const g of regs) inSet[g] = 1;
        let any = false;
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
          const line = byRow ? r : c;
          if ((lines & (1 << line)) && st[idx(r, c)] === UNK && !inSet[reg[r][c]] && elim(idx(r, c))) any = true;
        }
        return any;
      });
    }

    // Rules 2-4, lines confined to regions: k rows (or columns) whose
    // candidates fit in k regions mean those regions belong to those lines.
    function linesToRegions(byRow) {
      const items = [];
      for (let line = 0; line < n; line++) if (!(byRow ? rowHas : colHas)[line]) {
        let mask = 0;
        for (let k = 0; k < n; k++) {
          const r = byRow ? line : k, c = byRow ? k : line;
          if (st[idx(r, c)] === UNK) mask |= 1 << reg[r][c];
        }
        if (mask) items.push({ id: line, mask });
      }
      return lockedSets(items, (lineSet, regs) => {
        const inSet = new Uint8Array(n);
        for (const line of lineSet) inSet[line] = 1;
        let any = false;
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
          const line = byRow ? r : c;
          if ((regs & (1 << reg[r][c])) && !inSet[line] && st[idx(r, c)] === UNK && elim(idx(r, c))) any = true;
        }
        return any;
      });
    }

    while (placed < n && !dead) {
      if (singles()) continue;
      if (dead) break;
      if (regionsToLines(true) || regionsToLines(false) ||
          linesToRegions(true) || linesToRegions(false)) continue;
      break; // no rule made progress: the rest would need a guess
    }
    return placed === n && !dead;
  }

  root.deduceSolvable = deduceSolvable;
})(typeof self !== "undefined" ? self : globalThis);
