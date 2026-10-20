// Basketball league page: Moves / Players tabs. Uses WaiverAnalysis (nba/analysis.js).
(function () {
  "use strict";
  const DH = window.DH;
  const { esc, ordinal } = DH.fmt;
  const PAGE = 30;
  const AUTO_MAX = 80; // rows shown before "Show more" when reaching for your last player
  const NAMES = { G: "Guards", F: "Forwards", C: "Centers" };
  const TABS = [{ id: "team", label: "Team" }, { id: "league", label: "League" }, { id: "moves", label: "Moves" },
    { id: "trades", label: "Trades" }, { id: "draft", label: "Draft" }, { id: "matchup", label: "Matchup" },
    { id: "settings", label: "Settings", icon: "gear" }];
  // Which Sleeper positions can fill each starting slot (for the Matchup tab).
  const SLOT_POS = { PG: ["PG"], SG: ["SG"], SF: ["SF"], PF: ["PF"], C: ["C"], G: ["PG", "SG", "G"], F: ["SF", "PF", "F"],
    UTIL: ["PG", "SG", "SF", "PF", "C", "G", "F"] };
  const LOCK_KNOBS = {
    lockCushion: { label: "Lock-in cushion", min: 0, max: 10, step: 0.5, fmt: (v) => (v ? `${v.toFixed(1)} pts` : "None"),
      help: "Lock a starter when his score is within this many points of his lock target, not only at or above it. More cushion banks more games early; 0 follows the odds exactly." },
  };
  const MOVE_KNOBS = {
    minGain: { label: "Minimum upgrade", min: 0, max: 0.5, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%`,
      help: "A waiver swap has to add at least this much dynasty value before it's suggested (12% is about 12 ranking spots in the 100–250 range)." },
    needWeight: { label: "Positional need weight", min: 0, max: 1.5, step: 0.05, fmt: (v) => `×${v.toFixed(2)}`,
      help: "How strongly being thin at G, F or C lifts a free agent above his raw dynasty value. 0 ignores need." },
  };
  const TRADE_VALUE_MODES = [["blend", "Blend of both (recommended)"], ["keeper", "Keeper market (crowdsourced)"], ["rankings", "Dynasty rankings (curated)"]];
  const TRADE_VALUE_HELP = "Trades are judged on market value. Hashtag Basketball's crowdsourced keeper values show what managers actually rate players at; its curated dynasty rankings are the expert view. The blend averages the two. Waiver moves always use the curated rankings.";
  const TRADE_MODE_NOTE = {
    blend: "Trade value averages Hashtag Basketball's crowdsourced keeper values and its curated dynasty rankings, both on a 0–10,000 market-style scale.",
    keeper: "Trade value comes from Hashtag Basketball's crowdsourced keeper values, on a 0–10,000 market-style scale.",
    rankings: "Trade value follows the curated dynasty rank on a market-style curve (#1 = 10,000, #8 ≈ 8,560, #24 ≈ 6,000, #50 ≈ 3,370, #100 ≈ 1,100).",
  };
  const TRADE_KNOBS = {
    tradeMinValue: { label: "Value-only trades", min: 0.05, max: 0.4, step: 0.01, fmt: (v) => `+${Math.round(v * 100)}% or more`,
      help: "When a trade doesn't improve your starters, how much more value you must get back than you give. Surplus players (non-starters beyond your target at their position) count at half value." },
    tradeTolerance: { label: "Trade fairness", min: 0.03, max: 0.25, step: 0.01, fmt: (v) => `within ${Math.round(v * 100)}%`,
      help: "How far apart the two sides' trade value may be. Lower is stricter (fewer, fairer ideas); higher allows bigger asks." },
  };

  const views = new Map();
  const viewOf = (id) => {
    if (!views.has(id)) views.set(id, { wirePos: "all", wireShow: "both", wireSort: "rank", wireQuery: "", wireShown: null, open: new Set() });
    return views.get(id);
  };

  function render(ctx, el) {
    const A = window.WaiverAnalysis;
    const rankings = window.HB_RANKINGS;
    const view = viewOf(ctx.id);
    const locked = new Set((ctx.store.get("locked", []) || []).map(String));
    const opts = () => ({ ...A.DEFAULTS, ...(ctx.store.get("options", {}) || {}) });
    const matchupMode = () => (opts().matchupMode === "all" ? "all" : "lockin");
    let result;
    // Trades take a moment to search; only when the Trades tab is open.
    const keeper = window.HB_KEEPER || null;
    const analyze = () => (result = A.analyze(ctx.data, rankings.players, ctx.rosterId,
      { ...opts(), locked: [...locked], trades: ctx.tab === "trades", keeper: keeper ? keeper.players : null }));
    analyze();
    const scoring = ctx.data.league.scoring_settings || {};
    const pointsLeague = !!(scoring.pts || scoring.reb || scoring.ast);

    const posChips = (groups) => `<span class="chips">${groups.map((g) => `<span class="pos" data-g="${g}">${g}</span>`).join("")}</span>`;
    const moveTag = (m) => (m > 0 ? `<span class="mv-up" title="Moved up ${m} in the latest rankings update">▲${m}</span>`
      : m < 0 ? `<span class="mv-down" title="Moved down ${-m} in the latest rankings update">▼${-m}</span>` : "");
    const injTag = (p) => (p.injury ? `<span class="tag inj">${esc(p.injury)}</span>` : "");
    const hotTag = (p) => (p.trending ? `<span class="tag hot" title="Sleeper adds in the last 48 hours">${p.trending.toLocaleString()} adds</span>` : "");
    const rankText = (p) => (p.rank ? `#${p.rank}` : "Unranked");
    const fmt1 = (v) => (v == null || !pointsLeague ? "–" : v.toFixed(1));
    const ageFmt = (v) => (v ? v.toFixed(1) : "–");
    const lockBtn = (p) => DH.lockBtn(locked, p);
    const nameCell = (p) => `<div class="pname"><button type="button" data-open="${esc(p.id)}" aria-expanded="${view.open.has(p.id)}">${esc(p.name)}</button>
      <span class="team">${esc(p.team)}</span>${moveTag(p.move)}${injTag(p)}${hotTag(p)}</div>`;
    const detailRow = (p, cols) => {
      const link = p.hbid ? `<a href="https://hashtagbasketball.com/${encodeURIComponent(p.hbid)}/dynasty" target="_blank" rel="noopener">Dynasty profile on Hashtag Basketball</a>` : "";
      const gp = p.gp ? `${p.gp} games last season. ` : "";
      return `<tr class="detail"><td colspan="${cols}"><div>
        ${p.outlook ? `<span>${esc(p.outlook)}</span>` : "<span>No dynasty outlook written for this player.</span>"}
        <span>${gp}${link}</span></div></td></tr>`;
    };

    function headHtml() {
      const L = ctx.data.league;
      const meta = `Sleeper · ${L.season} dynasty · ${L.total_rosters} teams · ${pointsLeague ? "points" : "categories"} scoring`;
      const extra = [`Hashtag Basketball dynasty rankings, ${esc(rankings.updated)} (${rankings.players.length} players)`];
      if (keeper) extra.push(`Hashtag Basketball keeper values (crowdsourced, ${Number(keeper.votes || 0).toLocaleString()} votes), ${esc(keeper.updated)}, used for trades`);
      return DH.leagueHead(ctx, { meta }) + DH.sourceLine(ctx, extra) + DH.warnBanner([...(rankings.warnings || []), ...((keeper && keeper.warnings) || [])]);
    }

    function summaryHtml() {
      const me = result.me, rd = result.rookieDraft;
      const needs = result.positions.filter((p) => p.label !== "solid").map((p) => p.group);
      const cells = [
        [`${ordinal(me.lineupRank)}<small> of ${result.positions[0].teams}</small>`, "Best lineup, by dynasty value"],
        [needs.length ? needs.join(" · ") : "None", "Positions to address"],
        [`${me.rosterCount}<small> / ${result.maxActive}</small>`, `Active roster${me.reserve.length ? ` · ${me.reserve.length} on IR` : ""}${me.locked ? ` · ${me.locked} locked` : ""}`],
        [`$${me.faab}`, "FAAB remaining"],
      ];
      if (rd) cells.push([rd.picks.length ? rd.picks.map((p) => `${p.round}.${String(p.pick).padStart(2, "0")}`).join(", ") : "None", "Your rookie picks"]);
      return DH.summary(cells);
    }

    function positionsHtml() {
      const info = result.info;
      const labels = { need: "Need", thin: "Thin", solid: "Solid" };
      const counts = result.positions.map((p) => `${p.starters} ${p.group}`).join(", ");
      const cards = result.positions.map((p) => {
        const scale = Math.max(p.leagueBest, p.strength) * 1.08 || 1;
        const w = (v) => Math.min(100, (v / scale) * 100).toFixed(1);
        const starters = p.top.map((id) => `${esc(info[id].name)} <span class="muted">${rankText(info[id])}</span>`).join("<br>") || "None";
        return `<article class="pos-card" data-g="${p.group}">
          <div class="row1"><div class="letter">${p.group}<small>${NAMES[p.group]}</small></div><span class="pill ${p.label}">${labels[p.label]}</span></div>
          <div class="meter" role="img" aria-label="Your starters ${p.strength.toFixed(0)}, league average ${p.leagueAvg.toFixed(0)}, best ${p.leagueBest.toFixed(0)}">
            <div class="fill" style="width:${w(p.strength)}%"></div>
            <div class="tick" style="left:${w(p.leagueAvg)}%" title="League average"></div>
            <div class="tick best" style="left:calc(${w(p.leagueBest)}% - 2px)" title="Best in league"></div>
          </div>
          <div class="meter-legend"><span>You ${p.strength.toFixed(0)}</span><span>League avg ${p.leagueAvg.toFixed(0)} · best ${p.leagueBest.toFixed(0)}</span></div>
          <dl class="facts">
            <dt>Starters</dt><dd>${ordinal(p.leagueRank)} of ${p.teams}</dd>
            <dt>Depth</dt><dd>${p.depth} eligible <span class="muted">(aim for ${p.target})</span></dd>
            <dt>Top ${p.starters}</dt><dd>${starters}</dd>
          </dl>
        </article>`;
      }).join("");
      return `<section class="section"><div class="section-head"><h2>Positional balance</h2>
          <p>Starter strength is the dynasty value of your top players at each position (${counts}) compared with the other teams. Depth counts every player eligible there, aiming for two per starting slot.</p></div>
        <div class="positions">${cards}</div></section>`;
    }

    const draftHtml = () => DH.draftHtml(ctx, result.rookieDraft, result.me.rosterId, {
      basis: "the rankings", rank: rankText, sub: (p) => `${posChips(p.groups)} ${esc(p.team)} · ${ageFmt(p.age)} yrs`,
    });

    function movesHtml() {
      const moves = result.moves;
      const note = `Each add is paired with your weakest player who can go without leaving a position short of starters. A swap has to be a clear dynasty upgrade, about 12 or more ranking spots, before it's listed. Moves are planned in order, so later ones account for earlier ones.${result.me.locked ? ` ${result.me.locked} locked player${result.me.locked > 1 ? "s are" : " is"} never dropped.` : ""}`;
      let body;
      if (!moves.length) {
        const best = result.waivers[0];
        body = `<div class="empty">No clear upgrades on the wire right now. Your weakest active players are close to or better than the best available${best ? `, ${esc(best.name)} (${rankText(best)})` : ""}. Check back after the rookie draft and as rankings change.</div>`;
      } else {
        body = moves.map((m, i) => {
          const add = m.add, drop = m.drop;
          const why = [];
          if (m.fills.length) why.push(`<span class="tag fit">Helps ${m.fills.join("/")} depth</span>`);
          why.push(m.starts ? '<span class="tag fit">Would start</span>' : '<span class="tag">Bench depth</span>');
          if (drop) why.push(`<span>${add.rank && drop.rank ? `${drop.rank - add.rank} spots higher in the rankings` : "Replaces an unranked player"}</span>`);
          else why.push("<span>Fills an open roster spot</span>");
          if (pointsLeague && add.fpg != null && drop && drop.fpg != null) why.push(`<span>${(add.fpg - drop.fpg >= 0 ? "+" : "") + (add.fpg - drop.fpg).toFixed(1)} FP/G last season</span>`);
          return `<article class="move">
            <div class="step">${i + 1}</div>
            <div class="side"><span class="verb add">Add</span><span class="nm">${esc(add.name)}</span>
              <span class="meta">${posChips(add.groups)} ${esc(add.team)} · ${rankText(add)} · ${ageFmt(add.age)} yrs ${moveTag(add.move)} ${injTag(add)} ${hotTag(add)}</span></div>
            <div class="arrow" aria-hidden="true">⇄</div>
            <div class="side drop"><span class="verb drop">${drop ? "Drop" : "Roster spot"}</span><span class="nm">${drop ? esc(drop.name) : "Open"}</span>
              <span class="meta">${drop ? `${posChips(drop.groups)} ${esc(drop.team)} · ${rankText(drop)} · ${ageFmt(drop.age)} yrs ${injTag(drop)}` : "No drop needed"}</span>
              ${drop ? lockBtn(drop) : ""}</div>
            <div class="why">${why.join("")}</div>
          </article>`;
        }).join("");
      }
      return `<section class="section"><div class="section-head"><h2>Recommended moves</h2><p>${esc(note)} <a href="#/${esc(ctx.id)}/settings">Adjust in Settings</a>.</p></div><div class="moves">${body}</div></section>`;
    }

    function playerRows() {
      const me = result.me;
      const r = ctx.data.rosters.find((x) => String(x.roster_id) === String(me.rosterId)) || {};
      const taxi = new Set((r.taxi || []).map(String));
      const mine = [
        ...me.active.map((p) => ({ p, mine: true, slot: p.id in me.lineup ? me.lineup[p.id] : "BN" })),
        ...me.reserve.map((p) => ({ p, mine: true, slot: taxi.has(String(p.id)) ? "TX" : "IR" })),
      ];
      const wire = result.waivers.map((p) => ({ p, mine: false, slot: "FA" }));
      const q = view.wireQuery.trim().toLowerCase();
      const rows = mine.concat(wire).filter(({ p }) =>
        (view.wirePos === "all" || p.groups.includes(view.wirePos)) &&
        (!q || p.name.toLowerCase().includes(q) || (p.team || "").toLowerCase().includes(q)));
      const byRank = (a, b) => (a.rank ?? 9999) - (b.rank ?? 9999);
      const by = {
        fit: (a, b) => (b.fit || 0) - (a.fit || 0) || byRank(a, b),
        rank: byRank,
        fpg: (a, b) => (b.fpg ?? -1) - (a.fpg ?? -1) || byRank(a, b),
        age: (a, b) => (a.age ?? 99) - (b.age ?? 99) || byRank(a, b),
      }[view.wireSort];
      rows.sort((x, y) => by(x.p, y.p));
      return rows.filter((x) => view.wireShow === "both" || (view.wireShow === "mine") === x.mine);
    }

    function playersTable() {
      const rows = playerRows();
      const maxFit = Math.max(...rows.map((x) => x.p.fit || 0), 1);
      let count = view.wireShown;
      if (count == null) {
        let last = -1;
        rows.forEach((x, i) => { if (x.mine) last = i; });
        count = Math.min(AUTO_MAX, Math.max(PAGE, last + 6));
      }
      const shown = rows.slice(0, count);
      const body = shown.map(({ p, mine, slot }) => {
        const last = mine
          ? (slot === "IR" || slot === "TX" ? '<span class="muted small">Never dropped</span>' : lockBtn(p))
          : p.drop === "open" ? '<span class="muted">Open spot</span>'
          : p.drop ? `Drop ${esc(result.info[p.drop].name)} <span class="muted">${rankText(result.info[p.drop])}</span>`
          : '<span class="muted">Not an upgrade</span>';
        const boost = !mine && p.needGroup && result.needs[p.needGroup] >= 0.15 ? ` <span class="tag fit">${p.needGroup} need</span>` : "";
        const fit = p.fit || 0;
        return `<tr class="${mine ? "mine" : ""}">
          <td class="slot">${mine ? esc(DH.fmt.slot(slot)) : '<span class="muted">FA</span>'}</td>
          <td class="num">${p.rank ? `<span class="rank">${p.rank}</span>` : '<span class="muted">UR</span>'}</td>
          <td>${nameCell(p)}</td><td>${posChips(p.groups)}</td>
          <td class="num">${ageFmt(p.age)}</td><td class="num">${fmt1(p.fpg)}</td>
          <td style="white-space:nowrap"><span class="fitbar"><i style="width:${(fit / maxFit * 100).toFixed(0)}%"></i></span>${fit.toFixed(0)}${boost}</td>
          <td>${last}</td>
        </tr>${view.open.has(p.id) ? detailRow(p, 8) : ""}`;
      }).join("") || '<tr><td colspan="8" class="muted">No players match.</td></tr>';
      const rest = rows.length - shown.length;
      return `<div class="table-wrap"><table>
          <thead><tr><th>Slot</th><th class="num">Rank</th><th>Player</th><th>Pos</th><th class="num">Age</th>
            <th class="num" title="Last season's per-game stats scored with this league's settings">FP/G</th><th>Fit</th><th>Suggested drop / keep</th></tr></thead>
          <tbody>${body}</tbody></table></div>
        ${rest > 0 ? `<button type="button" class="more" data-more="${shown.length}">Show ${Math.min(PAGE, rest)} more of ${rest}</button>` : ""}`;
    }

    function playersTab() {
      const sort = [["rank", "Dynasty rank"], ["fit", "Best fit for my roster"], ["fpg", "Fantasy pts per game"], ["age", "Youngest first"]];
      return `<section class="section">
        <div class="section-head"><h2>Players</h2>
          <p>Your roster and the waiver wire in one list, so you can see where each free agent would slot in. <span class="mine-key">Your players</span> are highlighted, with their slot in the best lineup by dynasty value (your lineup in Sleeper may differ). Fit is dynasty value boosted at positions where you're thin.</p></div>
        <div class="toolbar">
          <div class="seg" role="group" aria-label="Position filter">${[["all", "All"], ["G", "G"], ["F", "F"], ["C", "C"]].map(([v, l]) => `<button type="button" data-pos="${v}" aria-pressed="${view.wirePos === v}">${l}</button>`).join("")}</div>
          <div class="seg" role="group" aria-label="Whose players">${[["both", "Both"], ["wire", "Wire"], ["mine", "Mine"]].map(([v, l]) => `<button type="button" data-show="${v}" aria-pressed="${view.wireShow === v}">${l}</button>`).join("")}</div>
          <label class="small muted" for="sort-${esc(ctx.id)}">Sort</label>
          <select id="sort-${esc(ctx.id)}" data-sort>${sort.map(([v, l]) => `<option value="${v}"${view.wireSort === v ? " selected" : ""}>${l}</option>`).join("")}</select>
          <input type="search" data-search placeholder="Search players" aria-label="Search players" value="${esc(view.wireQuery)}">
        </div>
        <div data-r="players" class="section">${playersTable()}</div>
      </section>`;
    }

    function settingsSummary() {
      const saved = ctx.store.get("options", {}) || {};
      const changed = Object.keys({ ...MOVE_KNOBS, ...TRADE_KNOBS }).filter((k) => saved[k] != null && Number(saved[k]) !== A.DEFAULTS[k])
        .concat(saved.tradeValues && saved.tradeValues !== A.DEFAULTS.tradeValues ? ["tradeValues"] : []);
      return changed.length ? `${changed.length} setting${changed.length > 1 ? "s" : ""} changed from defaults.` : "All settings are at their defaults.";
    }
    function settingsTab() {
      const team = `<div class="field"><label for="team-${esc(ctx.id)}">Your team</label><select id="team-${esc(ctx.id)}" class="team-select" data-team>${DH.teamOptions(ctx.data, ctx.rosterId)}</select></div>`;
      const mine = result.me.active.concat(result.me.reserve);
      return `<div class="stack settings-tab">${DH.settingsHtml([
        { title: "League", note: `Settings here apply to ${esc(ctx.data.league.name)} only.`, body: `<div class="pickers">${team}
          <div class="field"><label for="mm-${esc(ctx.id)}">Matchup scoring</label><select id="mm-${esc(ctx.id)}" class="source-select" data-matchupmode>
            ${[["lockin", "Lock-In (one game per slot)"], ["all", "Every game counts"]].map(([v, l]) => `<option value="${v}"${matchupMode() === v ? " selected" : ""}>${l}</option>`).join("")}</select></div></div>
          <p class="small muted">Lock-In is Sleeper's standard basketball format: each starting slot counts one game a week, the one you lock in (or its last game). Choose "Every game counts" only if your league adds up all of a player's games.</p>` },
        ...(matchupMode() === "lockin" ? [{ title: "Lock-In matchups", note: "How the Matchup tab calls locks.", body: DH.knobsHtml(ctx, LOCK_KNOBS, { lockCushion: Number(opts().lockCushion) || 0 }) }] : []),
        { title: "Moves", note: "How waiver moves are judged.", body: DH.knobsHtml(ctx, MOVE_KNOBS, opts()) },
        { title: "Trades", note: "How trade ideas are judged.", body: `<div class="pickers"><div class="field"><label for="tv-${esc(ctx.id)}">Trade values</label>
            <select id="tv-${esc(ctx.id)}" class="source-select" data-tradevalues>${TRADE_VALUE_MODES.map(([v, l]) => `<option value="${v}"${opts().tradeValues === v ? " selected" : ""}>${l}</option>`).join("")}</select></div></div>
            <p class="small muted">${TRADE_VALUE_HELP}</p>${DH.knobsHtml(ctx, TRADE_KNOBS, opts())}` },
        { title: "Locked players", note: "Never suggested as a drop, and never offered in a trade.", body: DH.lockedListHtml(locked, mine, posChips) },
      ])}
      <div class="toolbar"><button type="button" class="more reset" data-reset>Reset settings to defaults</button><span class="muted small" data-r="settings-sum">${esc(settingsSummary())}</span></div></div>`;
    }

    function tradesTab() {
      const fmt = {
        meta: (id) => { const p = result.info[id]; return `${posChips(p.groups)} ${esc(p.team)} · ${rankText(p)}${p.keeper ? ` <span title="Crowdsourced keeper rank">· keeper #${p.keeper.rank}</span>` : ""} · ${ageFmt(p.age)} yrs ${injTag(p)}`; },
        value: (v) => Math.round(v).toLocaleString(),
        partner: (rid) => { const t = DH.teamName(ctx.data, rid), o = DH.ownerName(ctx.data, rid); return o && o !== t ? `${t} · ${o}` : t; },
        group: (g) => NAMES[g].toLowerCase().replace(/s$/, ""),
      };
      const cards = DH.tradeCards(ctx, result.trades, locked, result.info, fmt, result.positions[0].teams);
      const tol = Math.round(Number(opts().tradeTolerance) * 100);
      return `<section class="section">
        <div class="section-head"><h2>Trade ideas</h2>
          <p>Each idea is fair on trade value (within ${tol}%, with a premium for the best player in a 2-for-1), fills a position where the other team is thin, gives you something concrete (better starters and first backups, or clearly more value), and keeps your roster in shape: it won't thin a position where you're at or below your target or pile onto one you've already filled. Non-starters beyond your target count at half value to you. ${esc(TRADE_MODE_NOTE[result.tradeMode])} Locked and injured players are left out. <a href="#/${esc(ctx.id)}/settings">Adjust in Settings</a>.</p></div>
        <div class="trades">${cards || `<div class="empty">No trade passes every test right now. Loosen trade fairness in <a href="#/${esc(ctx.id)}/settings">Settings</a> to see more.</div>`}</div>
      </section>`;
    }

    function leagueTab() {
      const s = result.standings, me = String(result.me.rosterId);
      const byLu = s.slice().sort((a, b) => b.lineup - a.lineup).map((x) => x.rosterId);
      const rows = s.map((t, i) => `<tr class="${String(t.rosterId) === me ? "me" : ""}">
          <td class="num">${i + 1}</td><td>${esc(DH.teamName(ctx.data, t.rosterId))}</td>
          <td class="num">${Math.round(t.value).toLocaleString()}</td>
          <td class="num">${t.lineup.toFixed(0)} <span class="muted small">(${ordinal(byLu.indexOf(t.rosterId) + 1)})</span></td>
          <td class="num">${t.players}</td>
        </tr>`).join("");
      const um = result.unmatched;
      return `<section class="section">
        <div class="section-head"><h2>League value</h2>
          <p>Trade value (${esc({ blend: "blend of keeper values and dynasty rankings", keeper: "crowdsourced keeper values", rankings: "dynasty rankings" }[result.tradeMode])}, 0–10,000 per player) of every player on each roster, IR included. Best lineup is each team's best starting lineup by dynasty value, the measure behind "Best lineup" in the summary.</p></div>
        <div class="table-wrap"><table>
          <thead><tr><th class="num">#</th><th>Team</th><th class="num">Trade value</th><th class="num">Best lineup</th><th class="num">Players</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
      </section>
      <footer>
        <p><strong>How it works.</strong> Players are matched between Sleeper and the <a href="https://hashtagbasketball.com/fantasy-basketball-dynasty-rankings" target="_blank" rel="noopener">Hashtag Basketball dynasty rankings</a> by name and team. Position eligibility comes from Sleeper (PG/SG count as G, SF/PF as F). Rank is turned into a value that drops off steeply, so #10 is worth far more than #60, while #200 and #260 are close. Need at a position comes from how your starters compare with the league average and how deep you are there. Players outside the top 400 count as unranked.${pointsLeague ? "" : " This league uses category scoring, so the FP/G column is left blank."}</p>
        <p><strong>Refreshing data.</strong> Your league loads live from Sleeper every time you open it. A scheduled GitHub Action pulls the Hashtag Basketball rankings once a day.</p>
        <p>${um.length ? `Not matched to a Sleeper player: ${esc(um.map((p) => p.name).join(", "))}.` : "Every ranked player was matched to a Sleeper player."}</p>
      </footer>`;
    }

    const tabBody = () => (ctx.tab === "team" ? `${positionsHtml()}${playersTab()}` : ctx.tab === "trades" ? tradesTab()
      : ctx.tab === "league" ? leagueTab() : ctx.tab === "settings" ? settingsTab() : ctx.tab === "draft" ? draftHtml()
      : ctx.tab === "matchup" ? matchupHtml() : movesHtml());
    function matchupHtml() {
      const pos = (id) => (ctx.data.players[id] && ctx.data.players[id].fantasy_positions) || [];
      const groups = (id) => [...new Set(pos(id).map((x) => A.POS_GROUP[x]).filter(Boolean))];
      const fits = (id, slot) => pos(id).some((g) => (SLOT_POS[slot] || []).includes(g));
      // Sleeper basketball leagues score Lock-In by default (one game per slot per week).
      if (matchupMode() === "lockin") return DH.lockinHtml(ctx, { chips: posChips, groupsOf: groups, fits, cushion: Number(opts().lockCushion) || 0 });
      return DH.matchupHtml(ctx, {
        sport: "nba", chips: posChips, groupsOf: groups,
        fits: (id, slot) => pos(id).some((g) => (SLOT_POS[slot] || []).includes(g)),
        spread: (pts) => (pts > 0 ? 0.18 * pts + 3 : 0),
        note: "Every game counts: a player's week is the sum of his games, so more games count",
      });
    }
    const tabs = DH.visibleTabs(TABS, result.rookieDraft, ctx.data.league);
    DH.settleTab(ctx, tabs);
    el.innerHTML = `${headHtml()}<div data-r="summary">${summaryHtml()}</div>${DH.subtabs(ctx, tabs)}<div class="stack">${tabBody()}</div>`;
    // A slider moved: recompute, refresh the summary and readouts, leave the sliders alone.
    function redrawAfterTuning() {
      analyze();
      el.querySelector('[data-r="summary"]').innerHTML = summaryHtml();
      const K = { ...MOVE_KNOBS, ...TRADE_KNOBS, ...LOCK_KNOBS }, v = { lockCushion: 0, ...opts() };
      for (const out of el.querySelectorAll("[data-out]")) out.textContent = K[out.dataset.out].fmt(Number(v[out.dataset.out]));
      el.querySelector('[data-r="settings-sum"]').textContent = settingsSummary();
    }
    const redrawPlayers = () => { const r = el.querySelector('[data-r="players"]'); if (r) r.innerHTML = playersTable(); };

    el.onchange = (e) => {
      const t = e.target;
      if (t.matches("[data-team]")) return ctx.setTeam(t.value);
      if (t.matches("[data-matchupmode]")) { ctx.store.set("options", { ...(ctx.store.get("options", {}) || {}), matchupMode: t.value }); return ctx.rerender(); }
      if (t.matches("[data-tradevalues]")) { ctx.store.set("options", { ...(ctx.store.get("options", {}) || {}), tradeValues: t.value }); return ctx.rerender(); }
      if (t.matches("[data-sort]")) { view.wireSort = t.value; view.wireShown = null; return redrawPlayers(); }
    };
    el.oninput = (e) => {
      const t = e.target;
      if (t.matches("[data-knob]")) {
        ctx.store.set("options", { ...(ctx.store.get("options", {}) || {}), [t.dataset.knob]: Number(t.value) });
        return redrawAfterTuning();
      }
      if (t.matches("[data-search]")) { view.wireQuery = t.value; view.wireShown = null; redrawPlayers(); }
    };
    el.onclick = (e) => {
      const b = e.target.closest("button");
      if (!b || !el.contains(b)) return;
      if (b.dataset.lock) {
        const id = b.dataset.lock;
        locked.has(id) ? locked.delete(id) : locked.add(id);
        ctx.store.set("locked", [...locked]);
        ctx.rerender();
        return DH.refocus(`button[data-lock="${CSS.escape(id)}"]`);
      }
      if (b.hasAttribute("data-reset")) { ctx.store.set("options", {}); return ctx.rerender(); }
      if (b.dataset.open) {
        view.open.has(b.dataset.open) ? view.open.delete(b.dataset.open) : view.open.add(b.dataset.open);
        redrawPlayers();
        return DH.refocus(`button[data-open="${CSS.escape(b.dataset.open)}"]`);
      }
      if (b.dataset.pos) {
        view.wirePos = b.dataset.pos; view.wireShown = null;
        for (const x of el.querySelectorAll("button[data-pos]")) x.setAttribute("aria-pressed", String(x === b));
        return redrawPlayers();
      }
      if (b.dataset.show) {
        view.wireShow = b.dataset.show; view.wireShown = null;
        for (const x of el.querySelectorAll("button[data-show]")) x.setAttribute("aria-pressed", String(x === b));
        return redrawPlayers();
      }
      if (b.dataset.more) { view.wireShown = Number(b.dataset.more) + PAGE; return redrawPlayers(); }
    };
  }

  DH.sports.nba = {
    id: "nba", label: "Basketball", short: "NBA",
    playersGlobal: "SLEEPER_PLAYERS_NBA",
    files: () => ["data/nba/players.js", "data/nba/rankings.js", "data/nba/keeper.js", "nba/analysis.js"],
    tabs: TABS,
    render,
  };
})();
