// Smoke tests: run both sports' analysis on the bundled league snapshots and check the
// rules the app promises. Run with `node tests/smoke.js`; exits non-zero on failure.
"use strict";
const path = require("path");
const assert = require("assert");
global.window = global;
const root = path.join(__dirname, "..");
const load = (f) => require(path.join(root, f));

load("data/home.js");
load("data/nfl/players.js"); load("data/nfl/values.js"); load("data/nfl/idp.js");
load("data/nba/players.js"); load("data/nba/rankings.js"); load("data/nba/keeper.js");
const NFL = load("nfl/analysis.js");
const Draft = load("js/draft.js");
const Lineup = load("js/lineup.js");
load("data/nfl/proj.js"); load("data/nba/proj.js");
const NBA = load("nba/analysis.js");

let failures = 0;
function test(name, fn) {
  try { fn(); console.log("ok  ", name); } catch (e) { failures++; console.log("FAIL", name, "\n     ", e.message); }
}

// Every suggested trade: your unlocked active players for the partner's, fair within the
// tolerance (with a little slack for the 2-for-1 premium), filling their need, helping you.
function checkTrades(res, rosters, myId, tol, eligible) {
  const mine = new Set(res.me.active.map((p) => String(p.id)));
  for (const t of res.trades) {
    const partner = rosters.find((r) => r.roster_id === t.partner);
    assert(partner && t.partner !== myId, "partner is another team");
    const theirs = new Set((partner.players || []).map(String));
    assert(t.give.every((id) => mine.has(String(id)) && eligible(id)), "gives only your eligible active players");
    assert(t.get.every((id) => theirs.has(String(id)) && eligible(id)), "gets only the partner's eligible players");
    assert(t.fairness >= (1 - tol) * 0.95 && t.fairness <= 1 / ((1 - tol) * 0.95), `fair within tolerance (got ${t.fairness.toFixed(3)})`);
    assert(t.fills.length > 0 && t.theirGain > 0, "fills a need for them");
    assert(t.myGain > 0 || t.myValue > 0, "gives you something concrete");
    for (const c of t.shape || []) {
      assert(!(c.after < c.before && c.after < c.target), `doesn't thin ${c.group} below target (${c.before} → ${c.after}, aim ${c.target})`);
    }
  }
}

test("matchup: best lineup fills every slot it can, beats or ties the set lineup, and win chance is a probability", () => {
  for (const home of window.HOME_LEAGUES) {
    load(`data/leagues/${home.id}.js`);
    const snap = window.LEAGUE_SNAPSHOTS[home.id];
    const proj = home.sport === "nfl" ? window.PROJ_NFL : window.PROJ_NBA;
    const players = home.sport === "nfl" ? window.SLEEPER_PLAYERS_NFL : window.SLEEPER_PLAYERS_NBA;
    const slots = snap.league.roster_positions.filter((s) => !["BN", "IR", "TAXI"].includes(s));
    const any = { FLEX: ["RB", "WR", "TE"], SUPER_FLEX: ["QB", "RB", "WR", "TE"], IDP_FLEX: ["DL", "LB", "DB"], G: ["PG", "SG", "G"], F: ["SF", "PF", "F"], UTIL: ["PG", "SG", "SF", "PF", "C", "G", "F"] };
    const fits = (id, slot) => ((players[id] || {}).fantasy_positions || []).some((g) => (any[slot] || [slot]).includes(g));
    const pts = (id) => (proj.players[id] ? Lineup.score(proj.players[id].s, snap.league.scoring_settings) : 0);
    const active = (r) => (r.players || []).map(String).filter((id) => !(r.reserve || []).includes(id) && !(r.taxi || []).includes(id));
    for (const r of snap.rosters) {
      const res = Lineup.matchup({ slots, fits, pts, spread: (p) => 0.4 * p + 2,
        mine: { active: active(r), starters: r.starters }, theirs: { active: active(snap.rosters[0]), starters: snap.rosters[0].starters } });
      assert(res.me.bestTotal + 1e-6 >= res.me.currentTotal, `best ${res.me.bestTotal} < current ${res.me.currentTotal}`);
      assert(res.me.best.every((id, i) => !id || fits(id, slots[i])), "every starter fits his slot");
      assert(new Set(res.me.best.filter(Boolean)).size === res.me.best.filter(Boolean).length, "no player starts twice");
      assert(res.winProb >= 0 && res.winProb <= 1);
    }
  }
});

for (const home of window.HOME_LEAGUES) {
  load(`data/leagues/${home.id}.js`);
  const snap = window.LEAGUE_SNAPSHOTS[home.id];
  const rosters = snap.rosters;

  if (home.sport === "nfl") {
    const data = { ...snap, players: window.SLEEPER_PLAYERS_NFL };
    for (const r of rosters) {
      test(`nfl ${home.name}: roster ${r.roster_id} analyzes and keeps its rules`, () => {
        const res = NFL.analyze(data, window.DYNASTY_VALUES, window.IDP_DATA, r.roster_id, {});
        const active = new Set(res.me.active.map((p) => p.id));
        for (const m of res.moves) {
          assert(!m.drop || active.has(m.drop.id), `drop ${m.drop && m.drop.name} isn't on the active roster`);
          assert(!m.drop || m.drop.domain, "never drops an unvalued (K/DEF) player");
          if (m.kind === "upgrade") assert.strictEqual(m.add.domain, m.drop.domain, "upgrades stay on one side of the ball");
        }
      });
    }
    test(`nfl ${home.name}: trade ideas are legitimate for every team`, () => {
      for (const r of rosters) {
        const res = NFL.analyze(data, window.DYNASTY_VALUES, window.IDP_DATA, r.roster_id, { locked: [] });
        checkTrades(res, rosters, r.roster_id, NFL.DEFAULTS.tradeTolerance, (id) => res.info[id].domain === "off");
      }
    });
    test(`nfl ${home.name}: no trade adds a non-starting QB to a full QB room`, () => {
      for (const r of rosters) {
        const res = NFL.analyze(data, window.DYNASTY_VALUES, window.IDP_DATA, r.roster_id, {});
        for (const t of res.trades) for (const c of t.shape) {
          if (c.after > c.before && c.before >= c.target) assert(t.myChanges.some(([g, d]) => g === c.group && d > 0), `${c.group} added without starting`);
        }
      }
    });
    test(`nfl ${home.name}: rookie draft board only while a rookies-only draft is pending`, () => {
      const r = rosters[0];
      const now = NFL.analyze(data, window.DYNASTY_VALUES, window.IDP_DATA, r.roster_id, { trades: false });
      assert.strictEqual(now.rookieDraft == null, !Draft.pending(snap.draft), "board matches the league's draft state");
      const draft = { status: "pre_draft", player_type: 1, rounds: 3, type: "linear", season: snap.league.season, traded_picks: [],
        slot_to_roster_id: Object.fromEntries(rosters.map((x, i) => [i + 1, x.roster_id])) };
      const res = NFL.analyze({ ...data, draft }, window.DYNASTY_VALUES, window.IDP_DATA, r.roster_id, { trades: false });
      assert(res.rookieDraft && res.rookieDraft.picks.length === 3, "one pick per round");
      assert(res.rookieDraft.board.every((p) => p.rookie && p.domain === "off"), "board is offensive rookies");
      assert(!res.waivers.some((w) => w.rookie), "rookies are off the wire during the draft");
    });
    test(`nfl ${home.name}: locked players are never offered in a trade`, () => {
      const r = rosters[0];
      const ids = NFL.analyze(data, window.DYNASTY_VALUES, window.IDP_DATA, r.roster_id, {}).me.active.map((p) => p.id);
      const res = NFL.analyze(data, window.DYNASTY_VALUES, window.IDP_DATA, r.roster_id, { locked: ids });
      assert.strictEqual(res.trades.length, 0);
    });
    test(`nfl ${home.name}: a locked player is never dropped`, () => {
      const r = rosters[0];
      const first = NFL.analyze(data, window.DYNASTY_VALUES, window.IDP_DATA, r.roster_id, {});
      const ids = first.me.active.map((p) => p.id);
      const res = NFL.analyze(data, window.DYNASTY_VALUES, window.IDP_DATA, r.roster_id, { locked: ids });
      assert.strictEqual(res.moves.filter((m) => m.drop).length, 0);
      assert(res.waivers.every((w) => !w.drop || w.drop === "open"));
    });
    test(`nfl ${home.name}: superflex and TE premium pick the right value tables`, () => {
      const rp = snap.league.roster_positions.map((s, i, a) => (s === "FLEX" && i === a.indexOf("FLEX") ? "SUPER_FLEX" : s));
      const sf = NFL.leagueFormat({ roster_positions: rp, scoring_settings: { bonus_rec_te: 0.5 } });
      assert.deepStrictEqual([sf.base, sf.tep, sf.key], ["sf", "tep", "sf_tep"]);
      const res = NFL.analyze({ ...data, league: { ...snap.league, roster_positions: rp } }, window.DYNASTY_VALUES, window.IDP_DATA, rosters[0].roster_id, {});
      const qb = Object.values(res.info).filter((p) => p.groups.includes("QB")).sort((a, b) => b.value - a.value)[0];
      assert(qb.value >= 9000, `top superflex QB should be ~9999, got ${qb.value}`);
    });
    test(`nfl ${home.name}: a league without IDP turns IDP off`, () => {
      const rp = snap.league.roster_positions.filter((s) => !["DL", "LB", "DB", "IDP_FLEX"].includes(s)).concat(["K", "DEF"]);
      const res = NFL.analyze({ ...data, league: { ...snap.league, roster_positions: rp } }, window.DYNASTY_VALUES, null, rosters[0].roster_id, {});
      assert.strictEqual(res.hasIdp, false);
      assert(res.positions.every((p) => p.domain === "off"));
      assert(res.waivers.every((w) => w.domain === "off"));
      assert.deepStrictEqual(res.unvalued, ["kickers", "team defenses"]);
    });
  }

  if (home.sport === "nba") {
    const data = { ...snap, players: window.SLEEPER_PLAYERS_NBA };
    for (const r of rosters) {
      test(`nba ${home.name}: roster ${r.roster_id} analyzes`, () => {
        const res = NBA.analyze(data, window.HB_RANKINGS.players, r.roster_id, {});
        assert(res.positions.length === 3);
        const active = new Set(res.me.active.map((p) => String(p.id)));
        for (const m of res.moves) assert(!m.drop || active.has(String(m.drop.id)));
      });
    }
    test(`nba ${home.name}: trade ideas are legitimate for every team`, () => {
      for (const r of rosters) {
        for (const tradeValues of ["blend", "keeper", "rankings"]) {
          const res = NBA.analyze(data, window.HB_RANKINGS.players, r.roster_id, { keeper: window.HB_KEEPER.players, tradeValues });
          checkTrades(res, rosters, r.roster_id, NBA.DEFAULTS.tradeTolerance, () => true);
        }
      }
    });
    test(`nba ${home.name}: a locked player is never dropped`, () => {
      const r = rosters[0];
      const ids = NBA.analyze(data, window.HB_RANKINGS.players, r.roster_id, {}).me.active.map((p) => p.id);
      const res = NBA.analyze(data, window.HB_RANKINGS.players, r.roster_id, { locked: ids });
      assert.strictEqual(res.moves.filter((m) => m.drop).length, 0);
    });
  }
}

// ---------- Lock-In basketball ----------
{
  const LockIn = load("js/lockin.js");
  const hist = (m) => [m + 8, m - 8, m, m + 4, m - 4, m + 12, m - 10, m, m + 3, m - 3];
  const game = (date, state, extra) => ({ date, state, opp: "XXX", home: true, ...extra });
  const solo = (x, left, extra = {}) => LockIn.plan({
    slots: ["UTIL"], fits: () => true, today: "2026-10-22", optimize: Lineup.optimize,
    players: { a: { hist: hist(30), slot: 0, ...extra, games: [game("2026-10-21", "done", { pts: x }),
      ...Array.from({ length: left }, (_, k) => game(`2026-10-2${3 + k}`, "upcoming", { proj: 30 }))] } },
  }).decisions[0];
  test("lock-in: a big game with one game left is locked", () => assert.strictEqual(solo(45, 1).rec, "lock"));
  test("lock-in: an ordinary game with three left is held", () => assert.strictEqual(solo(30, 3).rec, "hold"));
  test("lock-in: no games left means lock", () => { const d = solo(12, 0); assert.strictEqual(d.rec, "lock"); assert.strictEqual(d.why, "last"); });
  test("lock-in: hold value grows with games left", () => assert.ok(solo(30, 3).hold > solo(30, 1).hold));
  test("lock-in: an injured player's later games are worth less", () => assert.ok(solo(30, 2, { injury: "Doubtful" }).hold < solo(30, 2).hold));
  test("lock-in: chance to beat matches the recent-games count direction", () => assert.ok(solo(20, 2).pBeat > solo(40, 2).pBeat));

  const team = LockIn.plan({
    slots: ["UTIL"], fits: () => true, today: "2026-10-22", optimize: Lineup.optimize,
    players: {
      a: { hist: hist(30), slot: 0, games: [game("2026-10-21", "done", { pts: 34 }), game("2026-10-23", "upcoming", { proj: 30 }), game("2026-10-25", "upcoming", { proj: 30 })] },
      b: { hist: hist(40), slot: null, games: [game("2026-10-24", "upcoming", { proj: 40 })] },
    },
  });
  test("lock-in: holds a slot for a better player still to play", () => {
    const d = team.decisions[0];
    assert.strictEqual(d.own, "lock"); assert.strictEqual(d.rec, "hold"); assert.strictEqual(d.instead, "b");
  });

  const locked = LockIn.plan({
    slots: ["G", "F"], fits: (id, s) => ({ g: ["G"], f: ["F"], f2: ["F"] })[id].includes(s), today: "2026-10-22", optimize: Lineup.optimize,
    locks: { 0: { pid: "g", pts: 41 } },
    players: {
      g: { hist: hist(30), slot: 0, games: [game("2026-10-20", "done", { pts: 41 }), game("2026-10-22", "upcoming", { proj: 30 })] },
      f: { hist: hist(25), slot: 1, games: [game("2026-10-24", "upcoming", { proj: 25 })] },
      f2: { hist: hist(25), slot: null, games: [game("2026-10-22", "upcoming", { proj: 25 })] },
    },
  });
  test("lock-in: locked slots count their score and stay out of today's lineup", () => {
    assert.strictEqual(locked.lockedPts, 41);
    assert.ok(!locked.today.lineup[0], "a locked slot isn't refilled");
    assert.strictEqual(locked.today.lineup[1], "f2", "the open slot goes to the player who plays today");
    assert.ok(locked.projected.total > 41);
  });
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
