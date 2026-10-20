// Lock-In basketball (Sleeper's default NBA format): each starting slot counts ONE game a week. After a
// starter's game you may lock it in, until his next game starts; a locked player can't move slots; an
// unlocked starter counts his final game of the week, even a zero. This decides when to lock and whom to
// start each day. No DOM.
//
// A player's next game is modelled from his recent games (last 10 by default, scored with the league's
// settings), nudged by Sleeper's projection for that game (opponent, home/away, minutes), with a chance
// he doesn't play at all (injury, rest).
//
// Lock targets come from simulating the rest of the week a few hundred times, night by night on the real
// schedule: only open slots can take a game, one player per slot per night, players go in their
// positions before UTIL, each player locks when a game beats what he can expect from his own remaining
// games, and an unlocked slot ends with its player's final game. A player's target is the score where
// "lock it now" and "hold" come out even over those simulated weeks, so it reflects his own games left
// and form, how crowded your nights are, and what the slot is worth to the rest of your roster.
(function (root) {
  "use strict";

  // Chance a player suits up for a game, by Sleeper injury designation.
  const PLAYS = { Out: 0, IR: 0, Sus: 0, NA: 0, DNR: 0, COV: 0, Doubtful: 0.25, Questionable: 0.6, GTD: 0.75, DTD: 0.75 };
  const HEALTHY = 0.95; // rest days and late scratches
  const DEFAULTS = { nHist: 10, matchupWeight: 0.5, minHist: 4, runs: 400, seed: 20261020 };

  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

  /**
   * One game's points as a discrete distribution [{ v, p }].
   * hist: recent single-game points; proj: Sleeper's projection for this game (or null); play: chance he plays.
   */
  function gameDist(hist, proj, play, cfg = DEFAULTS) {
    let base = hist.slice(0, cfg.nHist);
    if (base.length < cfg.minHist) {
      // Too few games to have a shape: spread the projection (or what we have) around its middle.
      const mid = proj != null ? proj : mean(base);
      base = base.concat([0.6, 0.8, 1, 1.2, 1.4].map((f) => mid * f)).slice(0, Math.max(cfg.minHist, base.length + 5));
    }
    const m0 = mean(base);
    let scale = 1;
    if (proj != null && m0 > 0) scale = Math.pow(Math.min(1.25, Math.max(0.75, proj / m0)), cfg.matchupWeight);
    const w = play / base.length;
    const out = base.map((v) => ({ v: v * scale, p: w }));
    if (play < 1) out.push({ v: 0, p: 1 - play });
    return out;
  }
  const expected = (d) => d.reduce((s, x) => s + x.v * x.p, 0);
  const expMax = (d, h) => d.reduce((s, x) => s + Math.max(x.v, h) * x.p, 0);
  const cdf = (d, x) => d.reduce((s, y) => s + (y.v <= x ? y.p : 0), 0);

  /** Expected final score from holding through these upcoming games (in order); the last one is forced. */
  function holdValue(dists) {
    if (!dists.length) return null;
    let h = expected(dists[dists.length - 1]);
    for (let k = dists.length - 2; k >= 0; k--) h = expMax(dists[k], h);
    return h;
  }
  /** Chance at least one of these games scores more than x. */
  const beatChance = (dists, x) => 1 - dists.reduce((s, d) => s * cdf(d, x), 1);

  // Small seeded generator, so the same data always gives the same advice.
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function sample(d, u) {
    let c = 0;
    for (const x of d) { c += x.p; if (u < c) return x.v; }
    return d[d.length - 1].v;
  }

  /**
   * o: {
   *   slots: ["G", …],                    starting slots in order
   *   fits(pid, slot),
   *   players: { pid: {
   *     hist: [points…]                    recent single games, most recent first (this week's included)
   *     games: [{ date, opp, home, state: "done"|"live"|"upcoming", pts?, proj? }]   this week, in order
   *     injury,                            Sleeper designation or null
   *     slot: index | null                 where Sleeper has him right now (null = bench)
   *   } },
   *   locks: { slotIndex: { pid, pts } },  games already locked in
   *   today: "YYYY-MM-DD",
   *   cushion: points                      lock when within this many points of the target
   * }
   */
  function plan(o) {
    const cfg = { ...DEFAULTS, ...(o.cfg || {}) };
    const cushion = Math.max(0, Number(o.cushion) || 0);
    const lockedPids = new Set(Object.values(o.locks || {}).map((l) => String(l.pid)));
    const S = o.slots.length;
    const openIdx = o.slots.map((_, i) => i).filter((i) => !(o.locks || {})[i]);
    const info = {};

    for (const [pid, p] of Object.entries(o.players)) {
      if (lockedPids.has(pid)) continue;
      const play = PLAYS[p.injury] ?? HEALTHY;
      const games = p.games || [];
      const upcoming = games.filter((g) => g.state === "upcoming");
      // Later games are less likely to be hit by today's injury news.
      const dists = upcoming.map((g, k) => gameDist(p.hist || [], g.proj ?? null, k === 0 ? play : Math.max(play, 0.85), cfg));
      // holdFrom[k]: what holding is worth standing before upcoming game k (null once none are left).
      const holdFrom = dists.map((_, k) => holdValue(dists.slice(k))).concat([null]);
      // A finished game can still be locked until his next game starts.
      const doneIdx = games.map((g, i) => (g.state === "done" ? i : -1)).filter((i) => i >= 0);
      const lastDone = doneIdx.length ? doneIdx[doneIdx.length - 1] : -1;
      const next = games[lastDone + 1];
      const candidate = lastDone >= 0 && (!next || next.state === "upcoming") ? games[lastDone] : null;
      const todayGame = upcoming.find((g) => g.date === o.today) || null;
      info[pid] = { pid, play, games, upcoming, dists, hold: holdFrom[0], holdFrom, means: dists.map(expected), candidate,
        todayGame, slot: p.slot, hist: (p.hist || []).slice(0, cfg.nHist) };
    }
    const pool = Object.keys(info);
    const ids = pool;
    const P = ids.length;
    const ix = Object.fromEntries(ids.map((id, i) => [id, i]));

    // Slots: how many of your players each one can take (UTIL takes anyone: keep it for last).
    const allIds = Object.keys(o.players);
    const flex = o.slots.map((sl) => allIds.filter((id) => o.fits(id, sl)).length);
    const fitsIx = ids.map((id) => o.slots.map((sl) => o.fits(id, sl)));
    const narrowFirst = o.slots.map((_, i) => i).sort((a, b) => flex[a] - flex[b]);
    const occupant = {};
    for (const id of pool) if (info[id].slot != null) occupant[info[id].slot] = id;

    // Nights left this week, in order.
    const days = [...new Set(pool.flatMap((id) => info[id].upcoming.map((g) => g.date)))].sort();
    const gameOn = ids.map((id) => days.map((d) => info[id].upcoming.findIndex((g) => g.date === d)));

    // Pre-drawn outcomes, shared by every variant (paired comparisons, little noise).
    const R = cfg.runs, rand = rng(cfg.seed);
    const draws = Array.from({ length: R }, () => ids.map((id) => info[id].dists.map((d) => sample(d, rand()))));

    /**
     * Expected rest-of-week points from the open slots under the policy, for one variant:
     *   drop: pid        he doesn't lock his finished game (hold)
     *   lockNow: { pid, slot }   he locks now (his points are counted outside; slot closed, he's gone)
     *   forced: { slot: pid }    locks you're making this morning (counted outside)
     *   tonight: { pid, mode: "hold" | "lock" }   he starts tonight; "hold" = tonight's game won't be locked,
     *                    "lock" = tonight's game is locked (counted outside: only the rest is measured)
     */
    function simulate(v = {}) {
      let sum = 0, sum2 = 0;
      const totals = new Float64Array(R);
      const open0 = new Array(S).fill(false);
      for (const i of openIdx) open0[i] = true;
      const removed0 = new Array(P).fill(false);
      const close = (open, i) => { if (i != null) open[i] = false; };
      if (v.lockNow) { close(open0, v.lockNow.slot); removed0[ix[v.lockNow.pid]] = true; }
      for (const [s, id] of Object.entries(v.forced || {})) { close(open0, Number(s)); if (id in ix) removed0[ix[id]] = true; }
      const tIx = v.tonight ? ix[v.tonight.pid] : -1;
      for (let r = 0; r < R; r++) {
        const open = open0.slice(), gone = removed0.slice();
        const cand = ids.map((id, p) => (info[id].candidate && !gone[p] && id !== v.drop ? info[id].candidate.pts : null));
        const k = new Array(P).fill(0);
        // Each open slot's last game: [player, points]. Starters who already played hold theirs.
        const last = new Array(S).fill(null);
        for (let p = 0; p < P; p++) if (cand[p] != null && info[ids[p]].slot != null && open[info[ids[p]].slot]) last[info[ids[p]].slot] = [p, cand[p]];
        let total = 0;
        const lockInto = (p) => {
          for (const i of narrowFirst) if (open[i] && fitsIx[p][i]) { open[i] = false; gone[p] = true; for (let s = 0; s < S; s++) if (last[s] && last[s][0] === p) last[s] = null; return i; }
          return -1;
        };
        for (let d = 0; d < days.length; d++) {
          // Morning: lock anything that beats what his own remaining games are worth (or his last game).
          const order = [];
          for (let p = 0; p < P; p++) if (!gone[p] && cand[p] != null) order.push(p);
          order.sort((a, b) => cand[b] - cand[a]);
          for (const p of order) {
            const h = info[ids[p]].holdFrom[k[p]];
            if (h == null || cand[p] >= h) { const i = lockInto(p); if (i >= 0) total += cand[p]; }
          }
          // Evening: seat tonight's players in open slots, best first, positions before UTIL.
          const playing = [];
          for (let p = 0; p < P; p++) if (!gone[p] && gameOn[p][d] >= 0) playing.push(p);
          playing.sort((a, b) => (b === tIx && d === 0) - (a === tIx && d === 0) || info[ids[b]].means[gameOn[b][d]] - info[ids[a]].means[gameOn[a][d]]);
          const used = new Array(S).fill(false);
          for (const p of playing) {
            const g = gameOn[p][d];
            let seat = -1;
            for (const i of narrowFirst) if (open[i] && !used[i] && fitsIx[p][i]) { seat = i; break; }
            const x = draws[r][p][g];
            k[p] = g + 1;
            if (seat < 0) { cand[p] = null; continue; }
            used[seat] = true;
            for (let s = 0; s < S; s++) if (last[s] && last[s][0] === p) last[s] = null;
            last[seat] = [p, x];
            cand[p] = x;
            if (d === 0 && p === tIx) {
              if (v.tonight.mode === "lock") { open[seat] = false; gone[p] = true; last[seat] = null; cand[p] = null; }
              else cand[p] = null; // passes on tonight's game (it still counts if it turns out to be his last in the slot)
            }
          }
        }
        // End of the week: each open slot counts its player's final game.
        for (let s = 0; s < S; s++) if (open[s] && last[s]) total += last[s][1];
        totals[r] = total; sum += total; sum2 += total * total;
      }
      const m = sum / R;
      return { mean: m, sd: Math.sqrt(Math.max(0, sum2 / R - m * m)), totals };
    }

    const lockedPts = Object.values(o.locks || {}).reduce((s, l) => s + (Number(l.pts) || 0), 0);

    // Win chance: your simulated final against the opponent's simulated finals (ties count half).
    const opp = o.oppTotals && o.oppTotals.length ? Float64Array.from(o.oppTotals).sort() : null;
    const beats = (t) => {
      let lo = 0, hi = opp.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (opp[m] < t) lo = m + 1; else hi = m; }
      let eq = lo; while (eq < opp.length && opp[eq] === t) eq++;
      return (lo + (eq - lo) / 2) / opp.length;
    };
    const winChance = (totals, add) => { let w = 0; for (const t of totals) w += beats(t + add); return w / totals.length; };
    const goal = o.goal === "points" || !opp ? "points" : "win";
    /**
     * The lock target from the two simulated futures: hold (he stays unlocked) and rest (his slot is closed;
     * his score is added outside). By points: where the averages meet. By win chance: the smallest score that
     * makes locking win at least as often as holding, unless the matchup is decided either way, when the
     * points target applies.
     */
    function targetFor(hold, rest, base) {
      const byPoints = Math.max(0, hold.mean - rest.mean);
      if (goal !== "win") return byPoints;
      const pHold = winChance(hold.totals, base);
      const lo0 = winChance(rest.totals, base), hi0 = winChance(rest.totals, base + 150);
      if (hi0 - lo0 < 0.02 || pHold < 0.02 || pHold > 0.98) return byPoints;
      if (lo0 >= pHold) return 0;
      if (hi0 < pHold) return 150;
      let lo = 0, hi = 150;
      for (let it = 0; it < 24; it++) { const m = (lo + hi) / 2; if (winChance(rest.totals, base + m) >= pHold) hi = m; else lo = m; }
      return hi;
    }

    // Where to lock a player: before locking you can move him to an open slot he fits of a different kind
    // (its occupant swaps into his old one). Positions before UTIL; among those, the narrowest.
    function lockSlotFor(id, taken) {
      const from = info[id].slot, p = ix[id];
      const ok = (i) => openIdx.includes(i) && !taken.has(i) && fitsIx[p][i];
      if (from != null && ok(from)) {
        const better = narrowFirst.find((i) => ok(i) && flex[i] < flex[from] && o.slots[i] !== o.slots[from] && (!occupant[i] || o.fits(occupant[i], o.slots[from])));
        return better != null ? better : from;
      }
      const twin = from != null ? narrowFirst.find((i) => ok(i) && o.slots[i] === o.slots[from]) : undefined;
      return twin != null ? twin : narrowFirst.find(ok) ?? from;
    }

    // ---- Lock decisions: starters in an open slot with a finished game still lockable.
    const decisions = [];
    for (const id of pool) {
      const p = info[id], c = p.candidate;
      if (!c || p.slot == null || !openIdx.includes(p.slot)) continue;
      const x = c.pts;
      const beatHist = p.hist.filter((v) => v > x).length;
      const lockSlot = lockSlotFor(id, new Set());
      const base = { pid: id, slot: p.slot, lockSlot, game: c, x, hold: p.hold, left: p.upcoming.length, beatHist, nHist: p.hist.length };
      if (p.hold == null) { decisions.push({ ...base, rec: "lock", why: "last", pBeat: 0, target: 0 }); continue; }
      const pBeat = beatChance(p.dists, x);
      const target = targetFor(simulate({ drop: id }), simulate({ lockNow: { pid: id, slot: lockSlot } }), lockedPts);
      const own = x >= p.hold ? "lock" : "hold";
      const rec = x >= target - cushion ? "lock" : "hold";
      const close = rec === "lock" && x < target;
      // When the slot is what's being saved: the bench player most likely to use it.
      const instead = rec === "hold" && own === "lock"
        ? pool.filter((q) => q !== id && info[q].upcoming.length && o.fits(q, o.slots[p.slot]))
          .sort((a, b) => (info[b].hold || 0) - (info[a].hold || 0))[0] || null : null;
      decisions.push({ ...base, rec, own, pBeat, target, close, why: close ? "cushion" : rec === own ? "odds" : "slots", instead });
    }
    decisions.sort((a, b) => (a.rec === b.rec ? b.x - a.x : a.rec === "lock" ? -1 : 1));
    // Two locks can't share a slot: settle them biggest score first.
    {
      const taken = new Set();
      for (const d of decisions.filter((x) => x.rec === "lock")) {
        if (taken.has(d.lockSlot)) d.lockSlot = lockSlotFor(d.pid, taken);
        d.moveFrom = d.lockSlot !== d.slot ? d.slot : null;
        d.swapWith = d.moveFrom != null ? occupant[d.lockSlot] || null : null;
        taken.add(d.lockSlot);
      }
    }

    // ---- Today's lineup. Slots you're about to lock (per the calls above) aren't open for today.
    const lockingNow = new Map(decisions.filter((d) => d.rec === "lock").map((d) => [d.lockSlot, d.pid]));
    const forced = Object.fromEntries(lockingNow);
    const forcedPtsNow = decisions.filter((d) => d.rec === "lock").reduce((s, d) => s + d.x, 0);
    const openToday = openIdx.filter((i) => !lockingNow.has(i));
    const lockingIds = new Set(lockingNow.values());
    // Each of tonight's players: the score that would make locking tonight's game worth it, and what having
    // tonight's game is worth (its expected points above that target).
    const tonight = {};
    for (const id of pool) {
      const p = info[id];
      if (!p.todayGame || lockingIds.has(id) || !openToday.some((i) => o.fits(id, o.slots[i]))) continue;
      const kk = p.upcoming.indexOf(p.todayGame), d = p.dists[kk];
      if (p.holdFrom[kk + 1] == null) { tonight[id] = { target: 0, last: true, option: expected(d), dist: d }; continue; }
      const target = targetFor(simulate({ forced, tonight: { pid: id, mode: "hold" } }), simulate({ forced, tonight: { pid: id, mode: "lock" } }), lockedPts + forcedPtsNow);
      tonight[id] = { target, option: d.reduce((s, x) => s + Math.max(0, x.v - target) * x.p, 0), dist: d, left: p.upcoming.length - kk - 1 };
    }
    // Who gets tonight's open slots: the most to gain, seated in their positions before UTIL, else left in place.
    const chosen = pickSeats(openToday, Object.keys(tonight), (id) => tonight[id].option + 1e-3);
    const lineup = seat(openToday, chosen, (id, i) => (info[id].slot === i ? 0.3 : 0) - flex[i] / Math.max(1, ...flex)) || {};
    const startNow = Object.entries(lineup).map(([i, id]) => ({ slot: Number(i), pid: id, option: tonight[id].option, already: info[id].slot === Number(i) }));
    const placed = new Set(Object.values(lineup));
    const benchPlaying = Object.keys(tonight).filter((id) => !placed.has(id)).sort((a, b) => tonight[b].option - tonight[a].option);
    const idleInSlot = openToday.filter((i) => !lineup[i]);
    const targets = {};
    for (const id of Object.values(lineup)) {
      const t = tonight[id];
      if (t.last) { targets[id] = { target: 0, last: true }; continue; }
      const lockAt = Math.max(0, t.target - cushion);
      targets[id] = { target: t.target, lockAt, pReach: 1 - cdf(t.dist, lockAt), left: t.left };
    }

    // ---- Projected final: locked points, today's locks, and the simulated rest of the week.
    const forcedPts = decisions.filter((d) => d.rec === "lock").reduce((s, d) => s + d.x, 0);
    const restOfWeek = simulate({ forced });
    // A rough value per player for display: his lockable score or what holding is worth, whichever is more.
    for (const id of pool) {
      const p = info[id];
      p.value = p.candidate ? (p.hold == null ? p.candidate.pts : Math.max(p.candidate.pts, p.hold)) : p.hold || 0;
    }
    return {
      info, openIdx, decisions, lockedPts,
      today: { lineup, startNow, benchPlaying, idleInSlot, openToday, lockingNow: forced, targets, tonight },
      goal,
      projected: { locked: lockedPts, open: forcedPts + restOfWeek.mean, total: lockedPts + forcedPts + restOfWeek.mean, sd: restOfWeek.sd,
        totals: Array.from(restOfWeek.totals, (t) => t + lockedPts + forcedPts),
        winProb: opp ? winChance(restOfWeek.totals, lockedPts + forcedPts) : null },
    };

    /** Pick up to |slots| players for these slots maximizing the sum of val (exact assignment over slots). */
    function pickSeats(slotIdx, cands, val) {
      const best = seat(slotIdx, [], () => 0);
      // Greedy by value with a feasibility check; slots are few, so try adding in value order.
      const order = cands.slice().sort((a, b) => val(b) - val(a));
      let picked = [];
      for (const id of order) {
        if (picked.length >= slotIdx.length) break;
        if (seat(slotIdx, picked.concat(id), () => 0)) picked = picked.concat(id);
      }
      return best ? picked : [];
    }
    /** Seat every id in a distinct slot, maximizing the sum of pref(id, slot); null if they can't all fit. */
    function seat(slotIdx, list, pref) {
      const n = slotIdx.length;
      let dp = new Map([[0, { v: 0, seats: [] }]]);
      for (const id of list) {
        const next = new Map();
        for (const [mask, st] of dp) for (let j = 0; j < n; j++) {
          if (mask & (1 << j) || !o.fits(id, o.slots[slotIdx[j]])) continue;
          const nm = mask | (1 << j), val = st.v + pref(id, slotIdx[j]);
          if (!next.has(nm) || next.get(nm).v < val) next.set(nm, { v: val, seats: st.seats.concat([[slotIdx[j], id]]) });
        }
        if (!next.size) return null;
        dp = next;
      }
      let best = null;
      for (const st of dp.values()) if (!best || st.v > best.v) best = st;
      return Object.fromEntries(best.seats);
    }
  }

  const api = { plan, gameDist, holdValue, beatChance, expected, PLAYS, DEFAULTS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LockIn = api;
})(typeof window !== "undefined" ? window : globalThis);
