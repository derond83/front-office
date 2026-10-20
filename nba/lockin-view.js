// Basketball Matchup tab for Lock-In leagues: lock-or-hold calls after each game, who to start today,
// and every slot's week at a glance. The decisions come from LockIn.plan (js/lockin.js).
(function () {
  "use strict";
  const DH = window.DH;
  const { esc } = DH.fmt;
  const API = "https://api.sleeper.com";
  const cache = new Map(); // "<season>:<week>" -> { at, schedule, stats } (or a pending promise)
  let current = null;      // the ctx on screen, for the lock buttons

  const etDate = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const dayName = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString([], { weekday: "short", timeZone: "UTC" });
  const f1 = (v) => (v == null ? "–" : v.toFixed(1));
  const pct = (v) => `${Math.round(v * 100)}%`;

  /** This week's schedule and box scores, live from Sleeper (fetched once per page view, refreshable). */
  function weekData(season, week, rerender, force) {
    const key = `${season}:${week}`;
    const have = cache.get(key);
    if (have && !force && !(have instanceof Promise)) return have;
    if (!(have instanceof Promise)) {
      const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
      const p = Promise.all([
        get(`${API}/schedule/nba/regular/${season}`).then((s) => s.filter((g) => g.week === week)).catch(() => null),
        get(`${API}/stats/nba/${season}/${week}?season_type=regular`).catch(() => null),
        DH.loadScript("data/nba/games.js").catch(() => null),
      ]).then(([schedule, stats]) => { cache.set(key, { at: Date.now(), schedule, stats }); rerender(); })
        .catch(() => { cache.delete(key); });
      cache.set(key, p);
    }
    return have instanceof Promise || !have ? null : have;
  }

  /** Locks you've marked for this league and week (Sleeper's API doesn't publish them). */
  const lockStore = (ctx, season, week) => {
    const saved = ctx.store.get("lockins", null);
    const mine = saved && saved.season === season && saved.week === week ? saved : { season, week, slots: {} };
    return {
      slots: mine.slots,
      set(i, v) { const s = { ...mine.slots }; if (v) s[i] = v; else delete s[i]; ctx.store.set("lockins", { season, week, slots: s }); },
    };
  };

  /**
   * sp: { chips(groups), groupsOf(id), fits(id, slot) }
   */
  DH.lockinHtml = function (ctx, sp) {
    current = ctx;
    const proj = window.PROJ_NBA;
    if (!proj) {
      DH.loadScript("data/nba/proj.js").then(ctx.rerender, () => {});
      return '<div class="loading" role="status">Loading this week\'s projections…</div>';
    }
    const data = ctx.data, league = data.league, players = data.players || {};
    const season = Number(proj.season), week = Number((data.state && data.state.week) || proj.week);
    const wk = weekData(season, week, ctx.rerender);
    if (!wk) return '<div class="loading" role="status">Loading this week\'s games from Sleeper…</div>';

    // Matchup (starters by slot, and Sleeper's running score)
    const mkey = `lockin-m:${ctx.id}:${week}`;
    if (!cache.has(mkey)) {
      cache.set(mkey, (data.matchups && data.matchups.week === week ? data.matchups.teams : null) || []);
      DH.sleeper.get(`/league/${ctx.id}/matchups/${week}`).then((m) => { cache.set(mkey, m || []); ctx.rerender(); }).catch(() => {});
    }
    const matchups = cache.get(mkey) || [];
    const slots = (league.roster_positions || []).filter((s) => !["BN", "IR", "TAXI"].includes(s));
    const scoring = league.scoring_settings || {};
    const score = (stats) => window.LineupEngine.score(stats, scoring);
    const today = etDate();
    const pname = (id) => (players[id] && players[id].full_name) || `Player ${id}`;
    const injury = (id) => (players[id] && players[id].injury_status) || null;

    // ---- Per-player week: schedule + box scores + per-game projections; recent games for the odds.
    const G = window.NBA_GAMES;
    const histOf = (id) => (G && G.players[id] ? G.players[id].map((g) => ({ d: g[0], pts: score(Object.fromEntries(G.keys.map((k, i) => [k, g[3 + i]]))) })) : []);
    const statRows = {};
    for (const r of wk.stats || []) (statRows[r.player_id] = statRows[r.player_id] || []).push(r);
    const teamGames = {};
    for (const g of wk.schedule || []) {
      if (g.status === "postponed" || g.status === "canceled") continue;
      for (const [side, other, home] of [[g.home, g.away, true], [g.away, g.home, false]]) {
        (teamGames[side.team] = teamGames[side.team] || []).push({ date: g.date, gid: g.game_id, opp: other.team, home, status: g.status });
      }
    }
    for (const list of Object.values(teamGames)) list.sort((a, b) => a.date.localeCompare(b.date));
    const projGames = (id) => ((proj.players[id] || {}).gm || []);

    function weekOf(id) {
      const team = players[id] && players[id].team;
      const rows = statRows[id] || [];
      return (teamGames[team] || []).map((g) => {
        const row = rows.find((r) => r.game_id === g.gid || r.date === g.date);
        const st = row && row.stats;
        const played = st && (st.gp || st.sp);
        const pg = projGames(id).find((x) => x.gid === g.gid || x.d === g.date);
        // Finished, under way (started, or box score already coming in), or still to come.
        const state = g.status === "complete" ? "done" : g.status === "pre_game" && !played ? "upcoming" : "live";
        return { ...g, state, pts: state === "done" ? (played ? score(st) : 0) : null, dnp: state === "done" && !played, proj: pg ? score(pg.s) : null };
      });
    }
    const active = (r) => { const out = new Set([...(r.reserve || []), ...(r.taxi || [])].map(String)); return (r.players || []).map(String).filter((id) => !out.has(id)); };

    function side(roster, m, locks) {
      const starters = ((m && m.starters) || roster.starters || []).map((x) => (x && x !== "0" ? String(x) : null));
      const ps = {};
      for (const id of active(roster)) {
        const games = weekOf(id);
        const thisWeek = games.filter((g) => g.state === "done" && !g.dnp).slice().reverse().map((g) => g.pts);
        const older = histOf(id).filter((h) => !games.some((g) => g.date === h.d)).map((h) => h.pts);
        const idx = starters.indexOf(id);
        ps[id] = { hist: thisWeek.concat(older), games, injury: injury(id), slot: idx >= 0 && idx < slots.length ? idx : null };
      }
      const plan = window.LockIn.plan({ slots, fits: sp.fits, players: ps, locks, today, optimize: window.LineupEngine.optimize });
      return { plan, ps, starters };
    }

    const mineRoster = data.rosters.find((r) => String(r.roster_id) === String(ctx.rosterId));
    const myM = matchups.find((m) => String(m.roster_id) === String(ctx.rosterId));
    const oppM = myM && myM.matchup_id != null ? matchups.find((m) => m.matchup_id === myM.matchup_id && String(m.roster_id) !== String(ctx.rosterId)) : null;
    const oppRoster = oppM ? data.rosters.find((r) => r.roster_id === oppM.roster_id) : null;
    const oppName = oppRoster ? DH.teamName(data, oppRoster.roster_id) : null;
    const store = lockStore(ctx, season, week);
    // A marked lock whose player has left the roster no longer applies.
    const locks = Object.fromEntries(Object.entries(store.slots).filter(([, l]) => mineRoster.players.map(String).includes(String(l.pid))));
    const me = side(mineRoster, myM, locks);
    const them = oppRoster ? side(oppRoster, oppM, {}) : null;
    const P = me.plan;

    // ---- Pieces
    const chip = (g, mark) => {
      const where = `${g.home ? "vs" : "@"} ${esc(g.opp)}`;
      if (g.state === "done") return `<span class="gchip done${mark ? " cand" : ""}" title="${esc(g.date)}">${dayName(g.date)} ${where} <b>${g.dnp ? "DNP" : f1(g.pts)}</b></span>`;
      if (g.state === "live") return `<span class="gchip live">${dayName(g.date)} ${where} <b>live</b></span>`;
      return `<span class="gchip${g.date === today ? " today" : ""}">${g.date === today ? "Today" : dayName(g.date)} ${where}</span>`;
    };
    const who = (id) => `<span class="pname"><strong>${esc(pname(id))}</strong> ${sp.chips(sp.groupsOf(id))}${injury(id) ? ` <span class="tag inj">${esc(injury(id))}</span>` : ""}</span>`;
    const left = (info) => (info.upcoming.length ? info.upcoming.map((g) => `${g.date === today ? "today" : dayName(g.date)} ${g.home ? "vs" : "@"} ${esc(g.opp)}`).join(", ") : "none");

    // Scoreboard
    const z = them ? (P.projected.total - them.plan.projected.total) / Math.sqrt(P.projected.sd ** 2 + them.plan.projected.sd ** 2 || 1) : 0;
    const wp = them ? 1 / (1 + Math.exp(-1.702 * z)) : null;
    const nLocked = Object.keys(locks).length;
    const board = `<section class="card section scoreboard">
      <div class="section-head"><h2>Week ${week}${oppName ? ` · vs ${esc(oppName)}` : ""}</h2>
        <p>Lock-In scoring: each starting slot counts one game this week. You lock a starter's game after it ends, before his next one tips off; a slot left open counts its last game, even a zero. Projected finals assume both teams lock well from here.</p></div>
      <div class="sb-row">
        <div class="sb-side"><span class="eyebrow">You · projected</span><span class="big">${f1(P.projected.total)}</span>
          <span class="small muted">${nLocked} of ${slots.length} slots locked (${f1(P.lockedPts)})${myM && myM.points ? ` · Sleeper: ${f1(myM.points)}` : ""}</span></div>
        ${them ? `<div class="sb-mid"><span class="eyebrow">Win chance</span><span class="big">${pct(wp)}</span>
          <div class="wp" role="img" aria-label="Win chance ${pct(wp)}"><i style="width:${(wp * 100).toFixed(0)}%"></i></div></div>
        <div class="sb-side right"><span class="eyebrow">${esc(oppName)} · projected</span><span class="big">${f1(them.plan.projected.total)}</span>
          <span class="small muted">${oppM && oppM.points ? `Sleeper: ${f1(oppM.points)} · ` : ""}their locks aren't public</span></div>`
        : `<div class="sb-side"><span class="muted">${matchups.length ? "No opponent this week." : "This week's matchups aren't set in Sleeper yet."}</span></div>`}
      </div></section>`;

    // Lock or hold
    const decisions = P.decisions.map((d) => {
      const info = P.info[d.pid];
      const g = d.game;
      const why = d.why === "last" ? "No games left this week, so this is his score either way. Lock it so a later lineup move can't replace it."
        : d.why === "slots" && d.rec === "hold" ? `On his own this is a lock, but locking would use up a slot ${d.instead ? `${esc(pname(d.instead))} is expected to fill for more` : "your other players are expected to fill for more"} later this week. Hold, and start him there when he plays.`
        : d.why === "slots" ? `Holding would usually pay off for him, but your open slots are filling up: banking ${f1(d.x)} now is worth more to the team.`
        : d.rec === "lock" ? `He beat ${f1(d.x)} in only ${d.beatHist} of his last ${d.nHist} games; holding is worth about ${f1(d.hold)}.`
        : `He beat ${f1(d.x)} in ${d.beatHist} of his last ${d.nHist} games and has ${d.left} more this week; holding is worth about ${f1(d.hold)}.`;
      return `<li class="decision dec-${d.rec}">
        <div class="dec-main"><span class="rec rec-${d.rec}">${d.rec === "lock" ? "Lock" : "Hold"}</span>
          <div class="dec-text"><div>${who(d.pid)} <span class="muted small">${esc(DH.fmt.slot(slots[d.slot]))}</span></div>
          <div class="small">Scored <strong>${f1(d.x)}</strong> ${dayName(g.date)} ${g.home ? "vs" : "@"} ${esc(g.opp)} · games left: ${left(info)}${d.left ? ` · ${pct(d.pBeat)} chance a later game beats it` : ""}</div>
          <div class="small muted">${why}</div></div></div>
        <button type="button" class="more" data-lockin="${d.slot}" data-pid="${esc(d.pid)}" data-pts="${d.x}" data-date="${esc(g.date)}">I locked him in</button>
      </li>`;
    }).join("");
    const benchScored = Object.values(P.info).filter((i) => i.candidate && (i.slot == null)).map((i) => i.pid);
    const lockSec = `<section class="section"><div class="section-head"><h2>Lock or hold</h2>
        <p>Starters with a finished game you can still lock. The odds come from his last ${window.LockIn.DEFAULTS.nHist} games, adjusted for each remaining matchup's projection and his injury status; the call also weighs what your other players could still put in that slot. Mark a lock here after you make it in Sleeper.</p></div>
      ${decisions ? `<ol class="decisions">${decisions}</ol>` : '<div class="empty">Nothing to decide right now: none of your starters has a finished game waiting.</div>'}
      ${benchScored.length ? `<p class="small muted">Played on your bench, so it can't be locked: ${benchScored.map((id) => esc(pname(id))).join(", ")}.</p>` : ""}</section>`;

    // Today's lineup
    const T = P.today;
    const todayRows = P.openIdx.map((i) => {
      if (T.lockingNow[i]) return `<tr class="locked-row"><td class="slot">${esc(DH.fmt.slot(slots[i]))}</td><td>${who(T.lockingNow[i])} <span class="tag fit">Lock in</span></td><td class="small muted">Lock him first; this slot is then set for the week</td></tr>`;
      const id = T.lineup[i], cur = me.starters[i];
      const g = id && P.info[id].todayGame;
      if (!id) return `<tr><td class="slot">${esc(DH.fmt.slot(slots[i]))}</td><td>${cur ? who(cur) : '<span class="muted">Empty</span>'}</td><td class="small muted">No one who fits plays today</td></tr>`;
      const move = id === cur ? '<span class="tag fit">Set</span>' : `<span class="tag warn">Start</span>${cur ? ` <span class="small muted">over ${esc(pname(cur))}</span>` : ""}`;
      return `<tr><td class="slot">${esc(DH.fmt.slot(slots[i]))}</td><td>${who(id)} ${move}</td><td class="small">${g.home ? "vs" : "@"} ${esc(g.opp)}${g.proj != null ? ` · proj ${f1(g.proj)}` : ""}</td></tr>`;
    }).join("");
    const changes = T.startNow.filter((s) => !s.already).length;
    const todaySec = `<section class="section"><div class="section-head"><h2>Today's lineup · ${dayName(today)}</h2>
        <p>After the locks above, every open slot should have someone playing today: a game only counts if he started it. When more of your players play today than you have open slots, the ones whose game today could matter most get the slots. Players already in a slot stay put where possible.</p></div>
      ${P.openIdx.length ? `<div class="table-wrap"><table class="lineups"><thead><tr><th>Slot</th><th>Start today</th><th>Game</th></tr></thead><tbody>${todayRows}</tbody></table></div>
        <p class="small ${changes ? "" : "muted"}">${changes ? `${changes} change${changes > 1 ? "s" : ""} to make in Sleeper before tip-off.` : "Your Sleeper lineup already has today right."}${T.benchPlaying.length ? ` Also playing today with no open slot: ${T.benchPlaying.map((id) => esc(pname(id))).join(", ")}.` : ""}</p>`
        : '<div class="empty">Every slot is locked in for the week.</div>'}</section>`;

    // Slots and bench, this week
    const fill = Object.fromEntries(P.projected.fill.filter((f) => f.pid).map((f) => [f.slot, f.pid]));
    const slotRows = slots.map((s, i) => {
      const l = locks[i];
      if (l) return `<tr class="locked-row"><td class="slot">${esc(DH.fmt.slot(s))}</td><td>${who(String(l.pid))} <span class="tag fit">Locked in</span></td>
        <td class="small">${dayName(l.date)}: <b>${f1(Number(l.pts))}</b></td><td class="num"><b>${f1(Number(l.pts))}</b></td>
        <td><button type="button" class="linklike small" data-unlockin="${i}">Undo</button></td></tr>`;
      const id = me.starters[i];
      const info = id && P.info[id];
      return `<tr><td class="slot">${esc(DH.fmt.slot(s))}</td><td>${id ? who(id) : '<span class="muted">Empty</span>'}</td>
        <td>${info ? info.games.map((g) => chip(g, info.candidate === g)).join(" ") || '<span class="muted small">No games</span>' : ""}</td>
        <td class="num">${fill[i] ? f1(P.info[fill[i]].value) : "–"}</td><td></td></tr>`;
    }).join("");
    const benchIds = Object.keys(me.ps).filter((id) => me.ps[id].slot == null && !Object.values(locks).some((l) => String(l.pid) === id));
    const benchRows = benchIds.sort((a, b) => (P.info[b] ? P.info[b].value : 0) - (P.info[a] ? P.info[a].value : 0)).map((id, k) => {
      const info = P.info[id];
      return `<tr class="bench-row${k ? "" : " first"}"><td class="slot">BN</td><td>${who(id)}</td>
        <td>${info.games.map((g) => chip(g, false)).join(" ") || '<span class="muted small">No games</span>'}</td><td class="num">${f1(info.value)}</td><td></td></tr>`;
    }).join("");
    const slotSec = `<section class="section"><div class="section-head"><h2>Your week</h2>
        <p>Your Sleeper lineup slot by slot, then your bench. Value is what the player is expected to end up counting for if he gets a slot: his lockable score or, if better, what holding is worth. The projected total uses the best way to fill your open slots.</p></div>
      <div class="table-wrap"><table class="lineups lockin"><thead><tr><th>Slot</th><th>Player</th><th>This week</th><th class="num">Value</th><th></th></tr></thead><tbody>${slotRows}${benchRows}</tbody></table></div></section>`;

    // Before games lock
    const notes = [];
    const hurt = P.openIdx.map((i) => T.lineup[i] || me.starters[i]).filter((id) => id && ["Questionable", "Doubtful", "GTD", "DTD"].includes(injury(id)));
    if (hurt.length) notes.push(`Check injury news before tip-off: ${hurt.map((id) => `${esc(pname(id))} (${esc(injury(id))})`).join(", ")}.`);
    const noGames = P.openIdx.map((i) => me.starters[i]).filter((id) => id && P.info[id] && !P.info[id].upcoming.length && !P.info[id].candidate);
    if (noGames.length) notes.push(`No games left this week: ${noGames.map((id) => esc(pname(id))).join(", ")}. Their slots need someone else.`);
    if (!G) notes.push("Recent games didn't load, so the odds lean on projections only.");
    if (!wk.stats) notes.push("This week's box scores didn't load from Sleeper; finished games may be missing. Try Refresh.");

    return `${board}${lockSec}${todaySec}${slotSec}
      ${notes.length ? `<section class="section"><div class="section-head"><h2>Before games lock</h2></div><ul class="notes">${notes.map((n) => `<li>${n}</li>`).join("")}</ul></section>` : ""}
      <p class="small muted">Games and box scores: Sleeper, live (loaded ${new Date(wk.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}). <button type="button" class="linklike" data-lockin-refresh>Refresh</button>.
      Recent games and projections refresh twice a day. Lock-In format details: <a href="https://support.sleeper.com/en/articles/4644860-league-formats-game-modes" target="_blank" rel="noopener">Sleeper help</a>.</p>`;
  };

  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-lockin], [data-unlockin], [data-lockin-refresh]");
    if (!b || !current) return;
    const proj = window.PROJ_NBA, ctx = current;
    const season = Number(proj.season), week = Number((ctx.data.state && ctx.data.state.week) || proj.week);
    const store = lockStore(ctx, season, week);
    if (b.hasAttribute("data-lockin-refresh")) { weekData(season, week, ctx.rerender, true); return; }
    if (b.dataset.lockin != null) store.set(b.dataset.lockin, { pid: b.dataset.pid, pts: Number(b.dataset.pts), date: b.dataset.date });
    else store.set(b.dataset.unlockin, null);
    ctx.rerender();
  });
})();
