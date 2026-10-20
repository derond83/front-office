# Front Office

Front Office gives waiver, trade, lineup and rookie-draft advice for Sleeper **dynasty** leagues, football and basketball, in one app:
`https://derond83.github.io/front-office/`

- **Football** offense is valued by [KeepTradeCut](https://keeptradecut.com/dynasty-rankings) or
  [Dynasty Daddy](https://dynasty-daddy.com/) in the league's own format (1QB or superflex, KTC's TE-premium level).
  IDP, when the league has it, is valued by a production model scored with the league's settings and cross-checked
  against the free FantasyPros dynasty DL / LB / DB rankings.
- **Basketball** uses the [Hashtag Basketball dynasty rankings](https://hashtagbasketball.com/fantasy-basketball-dynasty-rankings),
  weighted toward the positions (G / F / C) where you're thin, plus a rookie-draft board while a rookie draft is pending.

## Using it

- **League tabs** across the top switch leagues. Each league has its own address (`#/<league id>/<tab>`), so links,
  bookmarks and the back button work. Inside a league: **Team** (positional balance, then your roster and the wire
  in one list), **League** (league value table and how it works), **Moves** (waiver moves), **Trades** (trade ideas),
  **Draft** (the rookie-draft board, while a rookies-only draft is pending) or **Matchup** (this week's matchup, during
  the season; the two take turns). **Settings** is the gear link under your team name.
- **Settings** (per league, saved in this browser): your team, offensive values source (football), how waiver moves
  and trades are judged, trade values source (basketball), and your locked players.
- **Leagues page** (top right, or **＋ Add league**). A first visit starts here with a short welcome.
  - *Your Sleeper account*: enter your username once. Every league then opens on your team, your leagues are listed
    for one-click adding, and leagues are followed when Sleeper starts a new season (a dynasty league gets a new id
    each season).
  - *Add by league ID*: any Sleeper league that is **dynasty** and **football or basketball**. Redraft, keeper and
    guillotine leagues, and other sports, are refused with the reason.
  - *Sync across devices*: see below.
- Leagues load live from Sleeper in the browser every time they're opened. Leagues listed in `leagues.json` also get a
  daily snapshot, so they open instantly and even if Sleeper can't be reached; that's only a speed-up, and any league
  works without one.

## Sync across devices

Your leagues, team picks, locked players and Settings sync through a small Cloudflare Worker (`worker/`) over Workers KV,
on Cloudflare's free tier.

- Sync turns on by itself the first time you add a league or change a setting: the browser makes a random **sync key**
  and saves one JSON document under it. KV stores the key's SHA-256, never the key.
- To add a device, use **Copy sync link** on the Leagues page and open it on the other device (or paste it into "Have
  a sync link"). Its settings replace that browser's. After that, changes go out about 4 seconds after your last edit
  and come in when the app opens or returns to the foreground.
- What stays per device: which league and tab you're on.
- If the sync service can't be reached, everything keeps working from the browser's storage and syncs later.
- **Stop syncing** leaves the synced copy for your other devices; **Delete the synced copy** removes it.
- Free-tier limits (100,000 reads and 1,000 writes a day, 1 GB) are far beyond what a league's managers use. Saves are
  batched to stay well under the write limit.

**Deploying the Worker.** `.github/workflows/worker.yml` tests and deploys it on any push that changes `worker/`
(or from **Actions → Deploy sync worker → Run workflow**). It needs two repository secrets, `CLOUDFLARE_API_TOKEN`
(the "Edit Cloudflare Workers" token template) and `CLOUDFLARE_ACCOUNT_ID`. It looks up the KV namespace titled
`dynasty-helper` (creating it if missing), deploys to `https://dynasty-helper-sync.deron-dantzler.workers.dev`, and checks
`/health`. The Worker accepts requests only from `https://derond83.github.io` and localhost.

## Feedback, help and installing

- **Send feedback** (footer, and the How it works page) opens a short form. Messages go to the sync Worker, which keeps
  them in the same KV namespace under keys starting `fb:` (at most 40 a day, so a flood can't use up the free tier's
  writes). Read them in the Cloudflare dashboard: **Storage & Databases → Workers KV → dynasty-helper → KV Pairs**.
- **How it works** (`#/how`) explains the app in plain language for leaguemates. A one-time tip on the first league
  page points to Settings and How it works.
- **Add to Home Screen** installs it like an app: `manifest.webmanifest` and `icons/` give it a name, the FO icon and a
  full-screen window.

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `styles.css` | The app shell and styles. |
| `manifest.webmanifest`, `icons/` | Home-screen install: app name and icons (`icon.svg` is the source). |
| `js/how.js`, `js/feedback.js` | The How it works page; the feedback form. |
| `js/app.js` | League list, navigation, the Leagues page, loading a league. |
| `js/common.js`, `js/sleeper.js` | Shared helpers and storage; Sleeper API calls. |
| `js/sync.js` | Settings sync with the Worker. |
| `worker/` | The sync Worker (Cloudflare Workers + KV) and its `wrangler.toml`. |
| `js/trades.js` | Trade search and judging, shared by both sports (no DOM). |
| `js/draft.js`, `js/lineup.js` | Rookie draft board; weekly best lineups and matchup (both sports, no DOM). |
| `nfl/analysis.js`, `nfl/view.js` | Football: values, IDP model, lineups, move planner (no DOM) / its league page. |
| `nba/analysis.js`, `nba/view.js` | Basketball: rankings match, lineups, needs, moves, rookie draft (no DOM) / its league page. |
| `data/nfl/*.js` | Football values (all formats), IDP stats + FantasyPros ranks, this week's projections, Sleeper player list. |
| `data/nba/*.js` | Hashtag Basketball dynasty rankings and crowdsourced keeper values, this week's projections, Sleeper player list. |
| `data/leagues/<id>.js`, `data/home.js` | Daily league snapshots and the list of leagues that have one. |
| `leagues.json` | Which leagues get a daily snapshot. |
| `refresh_data.py` | Rebuilds everything under `data/`. Python 3, standard library only. |
| `tests/smoke.js`, `tests/worker.mjs` | Both sports' analysis on the snapshots; the sync Worker against an in-memory KV. |
| `.github/workflows/refresh.yml` | Daily refresh, smoke tests, GitHub Pages deploy. |
| `.github/workflows/worker.yml` | Tests and deploys the sync Worker. |

## Hosting (GitHub Pages)

`.github/workflows/refresh.yml`:

- runs twice a day, at 10:17 and 16:17 UTC (and on demand from **Actions → Refresh data and deploy → Run workflow**),
- runs `refresh_data.py` for both sports and commits the new data if it changed,
- runs the smoke tests, then deploys to GitHub Pages. Every push to `main` deploys too.

Each source is fetched on its own. If one breaks (say KeepTradeCut changes its page), the others still refresh, the
broken one keeps its last good data, the league page shows a warning, and the run is marked failed so GitHub emails
you. If KeepTradeCut itself can't be read, its values come from Dynasty Daddy's copy of KTC instead.

## Run locally

```sh
python3 refresh_data.py          # both sports + league snapshots (or --sport nfl / --sport nba)
python3 -m http.server 8000      # then open http://localhost:8000/
node tests/smoke.js
node tests/worker.mjs
```

## How football suggestions are made

**Format.** Superflex when the league has a SUPER_FLEX slot or two QB slots. TE premium follows KeepTradeCut's guidance:
TE+ for a 0.5–1 point TE reception bonus, TE++ for 2 TE slots or a bonus over 1, TE+++ for 2 TE slots and a bonus.
Dynasty Daddy has no TE-premium values, so its standard values are used (the page says so).

**Offensive value** is the source's dynasty value; the *win now* setting blends in its redraft value.

**IDP value**, in roughly points per game (IDP leagues only):

1. Score each season with the league's IDP settings.
2. Count only part of a player's own big plays (INT, forced fumble, recovery, TD, safety, blocked kick; 35% by default);
   the rest is the position average for his snaps, so tackles and sacks drive value.
3. Weight seasons 3 : 1.5 : 0.6 (this season, last, two ago), per game played.
4. Average with per-snap production projected at the snaps he's playing now (catches role changes).
5. Shrink small samples toward a replacement-level player at his position.
6. Discount for age (production assumed to end around 33 for DL, 32 for LB/DB; six or more years left counts fully).
7. Add 5% for DL/LB or LB/DB eligibility.
8. Blend 30% with FantasyPros: their #k player at a position is worth what the model's #k player is worth.

Next to each IDP value is points per game above a waiver-level player at his position.

**Moves**, planned one at a time:

- Each position keeps its dedicated starting slots plus one (superflex counts toward QB; dual-eligible players count
  for both). Moves that fix a shortfall come first.
- Offense and IDP are managed separately: a set number of active spots are IDP (IDP starters + 2 by default, in
  Tuning), the rest offense, and a move only crosses sides to restore that split.
- Otherwise a swap stays on one side and must add 12% or more value, and at least 150 offensive value or 0.5 IDP points per game.
- Kickers and team defenses aren't valued; they're left out of lineups and never suggested.
- Taxi and IR players are never dropped, and neither is any player you **lock**. Injured free agents (IR, PUP,
  suspended) stay on the wire but aren't suggested.

## How basketball suggestions are made

- **Value.** Dynasty rank becomes a 0–100 value: `100 · e^(−(rank−1)/110)`. Unranked players are 0.
- **Positional need.** For G, F and C: your top starters' value compared with the league average, plus depth against
  a target of two per starting slot.
- **Fit.** `value × (1 + 0.6 × need)` at the player's neediest position.
- **Drops.** Your lowest-value active player whose loss keeps every position at starter depth. A swap must add about
  12% value. IR players and locked players are never dropped.
- **Rookie draft.** While a rookies-only draft is pending, rookies are shown on a draft board instead of the waiver wire.

## How trade ideas are made (both sports)

Every 1-for-1, 2-for-1 and 1-for-2 swap with each other team is checked (your locked, taxi and IR players are never
offered). A trade is suggested only if all of these hold:

1. **Fair on market value**, within the trade-fairness setting (10% by default) in both directions. The best player in
   an uneven deal carries a premium (values are compared raised to the power 1.35), as trade calculators do. A player a
   side would have to release to make room counts against that side.
2. **It fills their need**: their starters improve, at a position where they're thin.
3. **It gives you something concrete**: your starters improve (your first backup at each position counts at 35%), or
   you gain clearly more value (10% by default, the "Value-only trades" setting, and at least 400).
4. **It keeps your roster in shape**: it won't leave a position below the depth you aim for by thinning it further,
   or add to a position you've already filled unless the newcomer would start. A non-starter beyond your target at
   his position counts at half value to you, so a fourth QB in a one-QB league isn't a "value win", and trading
   surplus away costs you less. Each card shows how your position counts change.

Ideas are ranked by your gain, nudged toward deals the other team will like more; at most two per partner, and the
same player of yours appears in at most two.

- **Football**: offense only, on KeepTradeCut or Dynasty Daddy value in the league's format. IDP has no trade market,
  and draft picks aren't valued yet.
- **Basketball**: on a 0–10,000 market-style scale. By default the average of Hashtag Basketball's crowdsourced
  [keeper values](https://hashtagbasketball.com/keeper) (vote ratings: `10,000 · ((rating − 1,000) / (top − 1,000))^1.2`)
  and its curated dynasty rank (`10,000 · e^(−(rank − 1)/45)`); Settings can switch to either one alone.

## How the Matchup tab works (both sports)

Sleeper's projected stats for the week are scored with the league's own settings (so IDP, kickers, team defenses and
basketball categories count exactly as the league scores them). Out, IR and suspended players count 0, Doubtful 25%,
Questionable 85%; football players on bye count 0. A basketball player's week is the sum of his games.

- **Optimal / Current** toggle (remembered per league): the scoreboard and lineup table show either each team's best
  lineup by projection (exact search over the league's slots) or the lineups set in Sleeper right now.
- **Lineup table**: your lineup slot by slot, then every active bench player as **BN** rows, by projection. Players are
  tagged **Start** (in your best lineup but not set) or **Sit** (set but not in your best lineup). The opponent appears
  only in the scoreboard (their total and the win chance), not player by player.
- **Win chance**: the difference in totals of the lineups shown against their combined spread (each player's weekly
  spread grows with his projection).
- **Lineup changes**: "Start X over Y (+points)" against the lineup set in Sleeper.
- **Before kickoff** (basketball: before games lock): your questionable or doubtful starters, and toss-ups between a
  starter and a bench player within a point.

### Basketball: Lock-In leagues

Sleeper's standard basketball format is **Lock-In**: each starting slot counts **one game a week**. After a starter's
game you can lock it in, until his next game tips off; a locked player can't move slots, bench games can't be locked,
and a slot left open counts its last game, even a zero. The Matchup tab handles this by default (Settings → Matchup
scoring switches to "Every game counts" for leagues that add up all games). `js/lockin.js` does the deciding:

- **A player's next game** is modelled from his last 10 games scored with the league's settings, nudged by
  Sleeper's projection for that game (opponent, home/away, minutes; half weight, within ±25%), with a chance he
  doesn't play: 95% healthy, 75% day-to-day, 60% questionable, 25% doubtful, 0 out.
- **Today's checklist** (top of the tab) is the daily routine, in order: **Lock** (with the score and its target),
  **Start** (bench players to move in, and where), **Bench** (starters with no game today, or whose game matters less),
  **Hold** (starters to leave unlocked).
- **Lock target**: the score at which locking is worth as much to the week as holding the slot open. It's the larger of
  what the player is expected to beat later and what the best bench player who'd otherwise take that slot is worth.
  Lock at or above it. Settings → **Lock-in cushion** (0–10 points, default 0) locks anything within that many points
  of the target, for banking games earlier. "Lock tonight if" in Today's lineup is each starter's target for tonight's
  game, with his chance of reaching it.
- **Lock or hold** is optimal stopping. Holding is worth the expected result of taking the best of his remaining
  games and otherwise his last one (which counts whatever it is). Lock when the score in hand beats that. Each call
  shows how many of his last 10 games beat the score and the chance a remaining game does.
- **Opportunity cost**: the call is made for the team. Locking fills a slot, so it compares "this score plus the best
  fill of the other open slots" against "the best fill of all open slots with him still in the pool". A good-not-great
  score is held when a stronger player still to play needs that slot, and banked when slots are running out.
- **Today's lineup**: after those locks, every open slot gets someone who plays today. When more play than there are open
  slots, the slots go to the players whose game tonight is most likely to clear their lock target (expected points
  above it). Players already in a slot stay put where possible.
- **Your week**: each slot's player and his games (finished games with their score, the lockable one highlighted),
  then the bench. The projected total is your locked points plus the best expected fill of the open slots.
- Sleeper doesn't publish which games you've locked, so you mark them with **I locked him in** (saved per league and
  week, and synced). The opponent's projection assumes they lock well from here.
- Data: this week's schedule and box scores load live from Sleeper (`api.sleeper.com`); recent games
  (`data/nba/games.js`) and per-game projections (`data/nba/proj.js`) are refreshed twice a day.

Projections are refreshed twice a day (6 AM and noon Eastern).

## Ideas for later

- Draft pick values in the league value table.
- Rookie and taxi planning for the offseason in football.
