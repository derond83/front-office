// Lock-In basketball (Sleeper's default NBA format): each starting slot counts ONE game a week. After a
// starter's game you may lock it in, until his next game starts; a locked player can't move slots; an
// unlocked slot counts its last game, even a zero. This decides when to lock and whom to start each day.
// No DOM.
//
// A player's next game is modelled from his recent games (last 10 by default, scored with the league's
// settings), nudged by Sleeper's projection for that game (opponent, home/away, minutes), with a chance
// he doesn't play at all (injury, rest). Lock decisions are optimal stopping: lock when the score in
// hand beats what holding is expected to end with, where holding means taking the best of his later
// games and, failing that, his final game (which counts whatever it is). The team view adds the
// opportunity cost: locking uses up a slot your other players could still fill.
(function (root) {
  "use strict";

  // Chance a player suits up for a game, by Sleeper injury designation.
  const PLAYS = { Out: 0, IR: 0, Sus: 0, NA: 0, DNR: 0, COV: 0, Doubtful: 0.25, Questionable: 0.6, GTD: 0.75, DTD: 0.75 };
  const HEALTHY = 0.95; // rest days and late scratches
  const DEFAULTS = { nHist: 10, matchupWeight: 0.5, minHist: 4 };

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
  const sd = (d) => { const m = expected(d); return Math.sqrt(d.reduce((s, x) => s + x.p * (x.v - m) ** 2, 0)); };

  /** Expected final score from holding through these upcoming games (in order); the last one is forced. */
  function holdValue(dists) {
    if (!dists.length) return null;
    let h = expected(dists[dists.length - 1]);
    for (let k = dists.length - 2; k >= 0; k--) h = expMax(dists[k], h);
    return h;
  }
  /** Chance at least one of these games scores more than x. */
  const beatChance = (dists, x) => 1 - dists.reduce((s, d) => s * cdf(d, x), 1);

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
   *   optimize(slots, ids, fits, pts) -> pid per slot   (LineupEngine.optimize)
   * }
   */
  function plan(o) {
    const cfg = { ...DEFAULTS, ...(o.cfg || {}) };
    const cushion = Math.max(0, Number(o.cushion) || 0); // lock when within this many points of the target
    const lockedPids = new Set(Object.values(o.locks || {}).map((l) => String(l.pid)));
    const openIdx = o.slots.map((_, i) => i).filter((i) => !(o.locks || {})[i]);
    const info = {};

    for (const [pid, p] of Object.entries(o.players)) {
      if (lockedPids.has(pid)) continue;
      const play = PLAYS[p.injury] ?? HEALTHY;
      const games = p.games || [];
      const upcoming = games.filter((g) => g.state === "upcoming");
      // Later games are less likely to be hit by today's injury news.
      const dists = upcoming.map((g, k) => gameDist(p.hist || [], g.proj ?? null, k === 0 ? play : Math.max(play, 0.85), cfg));
      const hold = holdValue(dists);
      // A finished game can still be locked until his next game starts.
      const doneIdx = games.map((g, i) => (g.state === "done" ? i : -1)).filter((i) => i >= 0);
      const lastDone = doneIdx.length ? doneIdx[doneIdx.length - 1] : -1;
      const next = games[lastDone + 1];
      const candidate = lastDone >= 0 && (!next || next.state === "upcoming") ? games[lastDone] : null;
      const value = candidate ? (hold == null ? candidate.pts : Math.max(candidate.pts, hold)) : hold || 0;
      const todayGame = games.find((g) => g.date === o.today && g.state === "upcoming") || null;
      const sdGame = dists.length ? sd(dists[0]) : 0;
      info[pid] = { pid, play, games, upcoming, dists, hold, candidate, value, todayGame, sdGame, slot: p.slot, hist: (p.hist || []).slice(0, cfg.nHist) };
    }

    const pool = Object.keys(info);
    const assign = (slotIdx, ids, val) => {
      if (!slotIdx.length || !ids.length) return { total: 0, by: [] };
      const by = o.optimize(slotIdx.map((i) => o.slots[i]), ids, o.fits, (id) => val(id));
      return { total: by.reduce((s, id) => s + (id ? val(id) : 0), 0), by };
    };
    const valueOf = (id) => info[id].value;
    // How many of your players each slot can take: UTIL takes anyone, so it's the one to keep open longest.
    const allIds = Object.keys(o.players);
    const flex = o.slots.map((sl) => allIds.filter((id) => o.fits(id, sl)).length);
    const maxFlex = Math.max(1, ...flex);
    const occupant = {};
    for (const id of pool) if (info[id].slot != null) occupant[info[id].slot] = id;
    /** Seat every id in a distinct slot, maximizing the sum of pref(id, slot) (exact; slots are few). */
    function seat(slotIdx, ids, pref) {
      const S = slotIdx.length, size = 1 << S;
      let dp = new Map([[0, { v: 0, seats: [] }]]);
      for (const id of ids) {
        const next = new Map();
        for (const [mask, st] of dp) for (let k = 0; k < S; k++) {
          if (mask & (1 << k) || !o.fits(id, o.slots[slotIdx[k]])) continue;
          const nm = mask | (1 << k), v = st.v + pref(id, slotIdx[k]);
          if (!next.has(nm) || next.get(nm).v < v) next.set(nm, { v, seats: st.seats.concat([[slotIdx[k], id]]) });
        }
        if (!next.size) return null;
        dp = next;
      }
      let best = null;
      for (const st of dp.values()) if (!best || st.v > best.v) best = st;
      return best && size ? Object.fromEntries(best.seats) : {};
    }
    const lockedPts = Object.values(o.locks || {}).reduce((s, l) => s + (Number(l.pts) || 0), 0);
    const best = assign(openIdx, pool, valueOf);

    // Where to lock a player: before locking you can move him to any open starting slot he fits (its
    // occupant swaps into his old one). Pick the slot that costs the rest of the week least; on a tie, the
    // narrowest one, so UTIL stays open for whoever needs it later.
    function bestLockSlot(id, open, others, taken = new Set()) {
      const from = info[id].slot;
      // Another slot of the same kind gains nothing; only a different, narrower slot is worth a move.
      const options = open.filter((i) => !taken.has(i) && o.fits(id, o.slots[i]) &&
        (i === from || from == null || (o.slots[i] !== o.slots[from] && (!occupant[i] || o.fits(occupant[i], o.slots[from])))));
      if (from != null && taken.has(from)) {
        const twin = open.find((i) => !taken.has(i) && o.slots[i] === o.slots[from]);
        if (twin != null) options.push(twin);
      }
      let best = from, bestV = -Infinity;
      for (const i of options) {
        const v = assign(open.filter((j) => j !== i && !taken.has(j)), others, valueOf).total - 0.05 * flex[i] / maxFlex;
        if (v > bestV + 1e-9) { bestV = v; best = i; }
      }
      return best;
    }

    // ---- Lock decisions: starters in an open slot with a finished game still lockable.
    const decisions = [];
    for (const id of pool) {
      const p = info[id], c = p.candidate;
      if (!c || p.slot == null || !openIdx.includes(p.slot)) continue;
      const x = c.pts;
      const beatHist = p.hist.filter((v) => v > x).length;
      const base = { pid: id, slot: p.slot, game: c, x, hold: p.hold, left: p.upcoming.length, beatHist, nHist: p.hist.length };
      if (p.hold == null) { decisions.push({ ...base, lockSlot: p.slot, rec: "lock", why: "last", pBeat: 0, target: 0 }); continue; }
      const pBeat = beatChance(p.dists, x);
      // Team view. Lock: x in this slot, the others fill the other open slots. Hold: he stays in the pool.
      // The lock target is the score where the two come out even; lock at or above it (less the cushion).
      const others = pool.filter((q) => q !== id);
      const lockSlot = bestLockSlot(id, openIdx, others);
      const locked = assign(openIdx.filter((i) => i !== lockSlot), others, valueOf);
      const held = assign(openIdx, pool, (q) => (q === id ? p.hold : valueOf(q)));
      const target = Math.max(0, held.total - locked.total);
      const own = x >= p.hold ? "lock" : "hold";
      const rec = x >= target - cushion ? "lock" : "hold";
      // Holding for someone else: the player who'd lose out on a slot if you locked now.
      const lockSet = new Set(locked.by);
      const instead = rec === "hold" && own === "lock" ? held.by.find((q) => q && q !== id && !lockSet.has(q)) || null : null;
      const close = rec === "lock" && x < target;
      decisions.push({ ...base, lockSlot, rec, own, pBeat, target, close, why: close ? "cushion" : rec === own ? "odds" : "slots", instead });
    }
    decisions.sort((a, b) => (a.rec === b.rec ? b.x - a.x : a.rec === "lock" ? -1 : 1));
    // Two locks can't share a slot: settle them biggest score first.
    {
      const taken = new Set(), lockIds = new Set(decisions.filter((d) => d.rec === "lock").map((d) => d.pid));
      for (const d of decisions.filter((x) => x.rec === "lock")) {
        if (taken.has(d.lockSlot)) d.lockSlot = bestLockSlot(d.pid, openIdx, pool.filter((q) => !lockIds.has(q)), taken);
        if (taken.has(d.lockSlot)) d.lockSlot = d.slot;
        d.moveFrom = d.lockSlot !== d.slot ? d.slot : null;
        d.swapWith = d.moveFrom != null ? occupant[d.lockSlot] || null : null;
        taken.add(d.lockSlot);
      }
    }

    // ---- Today's lineup. Slots you're about to lock (per the calls above) aren't open for today.
    const lockingNow = new Map(decisions.filter((d) => d.rec === "lock").map((d) => [d.lockSlot, d.pid]));
    const openToday = openIdx.filter((i) => !lockingNow.has(i));
    const lockingIds = new Set(lockingNow.values());
    // A player's target tonight: the score that would make locking him after tonight's game worth more
    // than holding (his later games, or the bench player who'd otherwise get the slot).
    const tonight = {};
    for (const id of pool) {
      const p = info[id];
      if (!p.todayGame || lockingIds.has(id)) continue;
      const k = p.upcoming.indexOf(p.todayGame);
      const after = holdValue(p.dists.slice(k + 1));
      const d = p.dists[k];
      if (after == null) { tonight[id] = { target: 0, last: true, option: expected(d) }; continue; }
      const others = pool.filter((q) => q !== id && !lockingIds.has(q));
      const fitting = openToday.filter((i) => o.fits(id, o.slots[i]));
      if (!fitting.length) continue;
      const lockedT = Math.max(...fitting.map((i) => assign(openToday.filter((j) => j !== i), others, valueOf).total));
      const heldT = assign(openToday, others.concat(id), (q) => (q === id ? after : valueOf(q))).total;
      const target = Math.max(0, heldT - lockedT);
      // Having tonight's game is worth what it could add above that target.
      tonight[id] = { target, option: d.reduce((s, x) => s + Math.max(0, x.v - target) * x.p, 0), dist: d, left: p.upcoming.length - k - 1 };
    }
    const option = Object.fromEntries(Object.entries(tonight).map(([id, t]) => [id, t.option]));
    const playing = Object.keys(option);
    const chosen = assign(openToday, playing, (id) => option[id] + 1e-3).by.filter(Boolean);
    // Seat them in their positions before UTIL (a lock-worthy game then locks in a G/F/C slot and UTIL stays
    // flexible), and otherwise leave players where they are.
    const lineup = seat(openToday, chosen, (id, i) => (info[id].slot === i ? 0.3 : 0) - flex[i] / maxFlex) || {};
    const startNow = Object.entries(lineup).map(([i, id]) => ({ slot: Number(i), pid: id, option: option[id], already: info[id].slot === Number(i) }));
    const placed = new Set(Object.values(lineup));
    const benchPlaying = playing.filter((id) => !placed.has(id)).sort((a, b) => option[b] - option[a]);
    const idleInSlot = openToday.filter((i) => !lineup[i]);

    // ---- Tonight's targets for the players starting today.
    const targets = {};
    for (const id of Object.values(lineup)) {
      const t = tonight[id];
      if (t.last) { targets[id] = { target: 0, last: true }; continue; }
      const lockAt = Math.max(0, t.target - cushion);
      targets[id] = { target: t.target, lockAt, pReach: 1 - cdf(t.dist, lockAt), left: t.left };
    }

    // ---- Projected final: locked points plus the best expected fill of the open slots.
    const sdTotal = Math.sqrt(best.by.reduce((s, id) => s + (id ? (0.6 * info[id].sdGame) ** 2 : 0), 0));
    return {
      info, openIdx, decisions, lockedPts,
      today: { lineup, startNow, benchPlaying, idleInSlot, option, openToday, lockingNow: Object.fromEntries(lockingNow), targets },
      projected: { locked: lockedPts, open: best.total, total: lockedPts + best.total, sd: sdTotal, fill: best.by.map((id, k) => ({ slot: openIdx[k], pid: id })) },
    };
  }

  const api = { plan, gameDist, holdValue, beatChance, expected, PLAYS, DEFAULTS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LockIn = api;
})(typeof window !== "undefined" ? window : globalThis);
