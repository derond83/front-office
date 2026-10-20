#!/usr/bin/env python3
"""Refresh the data bundled with Front Office.

  python3 refresh_data.py                 # everything
  python3 refresh_data.py --sport nfl     # one sport's rankings/values only (plus league snapshots)
  python3 refresh_data.py --skip-leagues  # rankings and values only

Sport-wide data (any league of that sport uses it):

  data/nfl/values.js    offensive dynasty + redraft values from KeepTradeCut and Dynasty Daddy, every
                        format (1QB, superflex, KTC's TE-premium levels), keyed by Sleeper player id
  data/nfl/idp.js       IDP stat lines from Sleeper (three seasons) and FantasyPros dynasty DL/LB/DB ranks
  data/nfl/players.js   Sleeper player list (active players on a team, plus anyone on a built-in roster)
  data/nba/rankings.js  Hashtag Basketball dynasty rankings (it blocks direct browser requests)
  data/nba/keeper.js    Hashtag Basketball crowdsourced keeper values, used to judge trades
  data/<sport>/proj.js  this week's projected stats per player (Sleeper), for the Lineup tab
  data/nba/players.js   Sleeper player list

Built-in leagues (listed in leagues.json) also get a snapshot each, used when Sleeper can't be
reached from the browser:

  data/leagues/<id>.js  league, users, rosters, draft, trending adds
  data/home.js          the built-in league list

Each source is fetched on its own. If one fails, its last good data is kept, the problem is
listed under "warnings" in the file, and the script exits with status 1 once everything else is
written, so the scheduled workflow flags it.
"""
import argparse, html, json, re, sys, unicodedata, urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

HERE = Path(__file__).parent
DATA = HERE / "data"
SLEEPER = "https://api.sleeper.app/v1"
SLEEPER_STATS = "https://api.sleeper.app/stats/nfl"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"

# Football sources
KTC_URL = "https://keeptradecut.com/dynasty-rankings?page=0&filters=QB|WR|RB|TE&format=1"
DD_URL = "https://dynasty-daddy.com/api/v1/player/all/today?market={}"
# Dynasty Daddy market ids, from its site's FantasyMarket enum.
DD_MARKETS = {"ktc": 0, "ktc_redraft": 4, "dd": 14, "dd_redraft": 15}
FP_URL = "https://www.fantasypros.com/nfl/rankings/dynasty-{}.php"
# Basketball source
HB_URL = "https://hashtagbasketball.com/fantasy-basketball-dynasty-rankings"
HB_STATS = ["FG%", "FT%", "3PM", "PTS", "REB", "AST", "STL", "BLK", "TO"]
HB_KEEPER_URL = "https://hashtagbasketball.com/keeper"  # crowdsourced keeper values (market-style, used for trades)

OFFENSE = {"QB", "RB", "WR", "TE"}
IDP = {"DL", "LB", "DB"}
NBA_POSITIONS = {"PG", "SG", "SF", "PF", "C", "G", "F"}
PLAYER_FIELDS = {
    "nfl": ["full_name", "team", "position", "fantasy_positions", "injury_status", "age", "active",
            "search_rank", "years_exp", "depth_chart_position", "depth_chart_order"],
    "nba": ["full_name", "team", "fantasy_positions", "injury_status", "age", "active", "search_rank", "years_exp"],
}
# Stat columns kept for IDP players, in this order.
IDP_STATS = ["gp", "def_snp", "tm_def_snp", "idp_tkl_solo", "idp_tkl_ast", "idp_sack", "idp_tkl_loss",
             "idp_qb_hit", "idp_pass_def", "idp_int", "idp_ff", "idp_fum_rec", "idp_def_td", "idp_safe",
             "idp_blk_kick"]
SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}
# Names that differ beyond what last name + team can resolve (e.g. free agents).
ALIASES = {"gabriel davis": "gabe davis"}
# KeepTradeCut team codes that differ from Sleeper's.
KTC_TEAMS = {"TBB": "TB", "GBP": "GB", "KCC": "KC", "NEP": "NE", "NOS": "NO", "SFO": "SF", "LVR": "LV", "JAC": "JAX"}
# KeepTradeCut value formats: base (1QB / superflex) and its three TE-premium levels.
KTC_FORMATS = {"1qb": "oneQBValues", "sf": "superflexValues"}
TEP_LEVELS = ("tep", "tepp", "teppp")

warnings = []


def get(url, as_json=True):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=120) as r:
        body = r.read().decode("utf-8", "ignore")
    return json.loads(body) if as_json else body


def write_js(rel, target, payload):
    """Write `<target> = <payload>;` to data/<rel>. target is a JS assignment target."""
    path = DATA / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{target} = " + json.dumps(payload, separators=(",", ":")) + ";\n")
    return path


def read_js(rel):
    """The payload of a previously written data file, or {}."""
    try:
        text = (DATA / rel).read_text()
        return json.loads(text[text.index("= ") + 2:].strip().rstrip(";"))
    except (OSError, ValueError):
        return {}


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z ]", "", s.replace("-", " "))
    return " ".join(w for w in s.split() if w not in SUFFIXES)


def warn(msg):
    warnings.append(msg)
    print("WARNING:", msg, file=sys.stderr)


# ---------- Sleeper ----------

def sleeper_players(sport):
    players = get(f"{SLEEPER}/players/{sport}")
    for p in players.values():
        if not p.get("full_name"):
            p["full_name"] = " ".join(x for x in (p.get("first_name"), p.get("last_name")) if x)
    return players


class Matcher:
    """Finds the Sleeper id for a player named by another site."""

    def __init__(self, players):
        self.players = players
        self.by_name, self.by_last = {}, {}
        for pid, p in players.items():
            n = norm(p.get("full_name"))
            if n:
                self.by_name.setdefault(n, []).append(pid)
                self.by_last.setdefault(n.split(" ")[-1], []).append(pid)

    def find(self, name, groups, team=None):
        """groups: Sleeper fantasy positions the player could have (any match counts)."""
        fits = lambda i: set(self.players[i].get("fantasy_positions") or []) & groups
        n = ALIASES.get(norm(name), norm(name))
        ids = [i for i in self.by_name.get(n, []) if fits(i)]
        if not ids and team:
            # Nicknames (Kenny / Kenneth, Bam / Zonovan): same last name, position and team.
            ids = [i for i in self.by_last.get(n.split(" ")[-1], [])
                   if fits(i) and self.players[i].get("team") == team]
            if len(ids) != 1:
                return None
        if not ids:
            return None
        if len(ids) > 1:
            live = [i for i in ids if self.players[i].get("active")]
            ids = live or ids
            on_team = [i for i in ids if team and self.players[i].get("team") == team]
            ids = on_team or ids
        return ids[0]


def refresh_players(sport, players, rostered):
    """The sport's player list: active players on a team, plus anyone on a built-in roster."""
    relevant = (OFFENSE | IDP) if sport == "nfl" else NBA_POSITIONS
    keep = {}
    for pid, p in players.items():
        fp = set(p.get("fantasy_positions") or [])
        if pid in rostered or (p.get("active") and p.get("team") and fp & relevant):
            keep[pid] = {k: p.get(k) for k in PLAYER_FIELDS[sport]}
    path = write_js(f"{sport}/players.js", f"window.SLEEPER_PLAYERS_{sport.upper()}", keep)
    print(f"Players: {sport} {len(keep)} -> {path.relative_to(HERE)}")


def refresh_league(league_id):
    league = get(f"{SLEEPER}/league/{league_id}")
    sport = league.get("sport")
    users = get(f"{SLEEPER}/league/{league_id}/users")
    rosters = get(f"{SLEEPER}/league/{league_id}/rosters")
    state = get(f"{SLEEPER}/state/{sport}")
    trending = get(f"{SLEEPER}/players/{sport}/trending/add?lookback_hours=48&limit=100")
    draft = None
    if league.get("draft_id"):
        d = get(f"{SLEEPER}/draft/{league['draft_id']}")
        draft = {k: d.get(k) for k in ("draft_id", "status", "type", "season", "start_time", "slot_to_roster_id")}
        draft["rounds"] = (d.get("settings") or {}).get("rounds")
        draft["player_type"] = (d.get("settings") or {}).get("player_type")
        draft["traded_picks"] = get(f"{SLEEPER}/draft/{league['draft_id']}/traded_picks")
    payload = {
        "league": {k: league.get(k) for k in ("league_id", "name", "sport", "season", "status", "draft_id",
                                              "previous_league_id", "roster_positions", "scoring_settings",
                                              "settings", "total_rosters")},
        "users": [{"user_id": u["user_id"], "display_name": u.get("display_name"),
                   "team_name": (u.get("metadata") or {}).get("team_name")} for u in users],
        "rosters": [{k: r.get(k) for k in ("roster_id", "owner_id", "co_owners", "players", "reserve", "taxi",
                                           "starters", "settings")} for r in rosters],
        "state": {k: state.get(k) for k in ("season", "week", "season_type", "display_week")},
        "trending": trending,
        # This week's matchups, so the Lineup tab can find your opponent without Sleeper.
        "matchups": get_matchups(league_id, state),
        "draft": draft,
        "fetched": datetime.now(timezone.utc).isoformat(timespec="minutes"),
    }
    path = write_js(f"leagues/{league_id}.js",
                    f'(window.LEAGUE_SNAPSHOTS = window.LEAGUE_SNAPSHOTS || {{}})["{league_id}"]', payload)
    print(f"League: {league.get('name')} ({sport}, {len(rosters)} teams) -> {path.relative_to(HERE)}")
    rostered = {pid for r in rosters for pid in (r.get("players") or [])}
    return {"id": league_id, "sport": sport, "name": league.get("name"), "season": league.get("season")}, rostered


# ---------- Football values: KeepTradeCut + Dynasty Daddy ----------

def parse_ktc(page):
    m = re.search(r'<script[^>]*id="ktc-players"[^>]*>(.*?)</script>', page, re.S)
    if not m:
        raise ValueError("KeepTradeCut page has no ktc-players data block; the layout may have changed")
    rows = json.loads(html.unescape(m.group(1)))
    return [r for r in rows if r.get("position") in OFFENSE]


def dd_market(market):
    rows = get(DD_URL.format(market))
    if len(rows) < 200:
        raise ValueError(f"Dynasty Daddy market {market} returned only {len(rows)} players")
    return rows


def dd_table(rows, sf=False):
    """{sleeper_id: [value, change over the last month]} for offensive players, 1QB or superflex."""
    key, last_key = ("sf_trade_value", "last_month_value_sf") if sf else ("trade_value", "last_month_value")
    out = {}
    for r in rows:
        sid, v = r.get("sleeper_id"), r.get(key)
        if sid and v and r.get("position") in OFFENSE:
            last = r.get(last_key)
            out[str(sid)] = [int(v), int(v - last) if last else 0]
    return out


def dd_formats(rows):
    return {"1qb": dd_table(rows), "sf": dd_table(rows, sf=True)}


def upgrade_old(table):
    """Values files before superflex support held one flat 1QB table; nest it."""
    if table and all(isinstance(v, list) for v in table.values()):
        return {"1qb": table}
    return table or {}


def refresh_values(players):
    old = read_js("nfl/values.js").get("sources", {})
    sources = {}
    matcher = Matcher(players)

    dd_rows = {}
    for key, market in DD_MARKETS.items():
        try:
            dd_rows[key] = dd_market(market)
        except Exception as e:  # noqa: BLE001 - any failure keeps the last good copy
            warn(f"Dynasty Daddy market {market} ({key}): {e}")

    # KeepTradeCut, straight from its rankings page. Dynasty Daddy's KTC market is the fallback.
    ktc = None
    try:
        rows = parse_ktc(get(KTC_URL, as_json=False))
        if len(rows) < 300:
            raise ValueError(f"only {len(rows)} offensive players parsed")
        # Dynasty Daddy knows each KTC player's Sleeper id; use it before matching by name.
        dd_ids = {}
        for r in dd_rows.get("ktc", []):
            if r.get("sleeper_id"):
                dd_ids[(norm(r.get("full_name")), r.get("position"))] = str(r["sleeper_id"])
        trend = dd_formats(dd_rows.get("ktc", []))
        formats = {f: {} for f in KTC_FORMATS}
        formats.update({f"{f}_{t}": {} for f in KTC_FORMATS for t in TEP_LEVELS})
        unmatched = []
        for r in rows:
            sid = dd_ids.get((norm(r["playerName"]), r["position"])) or \
                matcher.find(r["playerName"], {r["position"]}, KTC_TEAMS.get(r.get("team"), r.get("team")))
            if not sid:
                unmatched.append(r["playerName"])
                continue
            for fmt, key in KTC_FORMATS.items():
                vals = r.get(key) or {}
                if vals.get("value"):
                    formats[fmt][sid] = [int(vals["value"]), trend[fmt].get(sid, [0, 0])[1]]
                # TE premium only changes tight ends; other positions use the base value.
                if r["position"] == "TE":
                    for t in TEP_LEVELS:
                        v = (vals.get(t) or {}).get("value")
                        if v:
                            formats[f"{fmt}_{t}"][sid] = int(v)
        ktc = {"dynasty": formats, "unmatched": unmatched, "via": KTC_URL.split("?")[0]}
    except Exception as e:  # noqa: BLE001
        warn(f"KeepTradeCut: {e}")
        if "ktc" in dd_rows:
            ktc = {"dynasty": dd_formats(dd_rows["ktc"]), "unmatched": [],
                   "via": "Dynasty Daddy's copy of KeepTradeCut (KTC itself could not be read)"}

    def assemble(name, label, url, fresh, redraft_key, prev):
        if fresh is None and not prev:
            return
        src = dict(prev or {})
        src["dynasty"] = upgrade_old(src.get("dynasty"))
        src["redraft"] = upgrade_old(src.get("redraft"))
        src.update({"label": label, "url": url})
        if fresh is not None:
            src.update(fresh)
            src["updated"] = date.today().isoformat()
        if redraft_key in dd_rows:
            src["redraft"] = dd_formats(dd_rows[redraft_key])
        sources[name] = src

    assemble("ktc", "KeepTradeCut", "https://keeptradecut.com/dynasty-rankings", ktc, "ktc_redraft", old.get("ktc"))
    dd = {"dynasty": dd_formats(dd_rows["dd"]), "unmatched": [], "via": DD_URL.format(14)} if "dd" in dd_rows else None
    assemble("dd", "Dynasty Daddy", "https://dynasty-daddy.com/", dd, "dd_redraft", old.get("dd"))

    if not sources:
        raise SystemExit("No value source could be read and there is no saved copy.")
    payload = {"updated": date.today().isoformat(), "sources": sources,
               "warnings": [w for w in warnings if not w.startswith("IDP") and not w.startswith("NBA")]}
    path = write_js("nfl/values.js", "window.DYNASTY_VALUES", payload)
    for s in sources.values():
        d = s.get("dynasty", {})
        print(f"Values: {s['label']} " + ", ".join(f"{f} {len(v)}" for f, v in d.items()) +
              f" ({len(s.get('unmatched', []))} unmatched) -> {path.relative_to(HERE)}")


# ---------- Football IDP: Sleeper stats + FantasyPros ----------

def idp_season(season):
    rows = get(f"{SLEEPER_STATS}/{season}?season_type=regular&position[]=DL&position[]=LB&position[]=DB")
    out = {}
    for r in rows:
        s = r.get("stats") or {}
        if s.get("def_snp", 0) <= 0 and s.get("gp", 0) <= 0:
            continue
        out[str(r["player_id"])] = [round(s.get(k, 0) or 0, 1) for k in IDP_STATS]
    return out


def parse_fp(page):
    m = re.search(r"var ecrData = (\{.*?\});\s*\n", page, re.S)
    if not m:
        raise ValueError("no ecrData block; the FantasyPros layout may have changed")
    return json.loads(m.group(1))


def refresh_idp(players, season):
    old = read_js("nfl/idp.js")
    matcher = Matcher(players)
    seasons = dict(old.get("seasons") or {})
    for y in (season - 2, season - 1, season):
        try:
            data = idp_season(y)
            if y < season and len(data) < 500:
                raise ValueError(f"only {len(data)} players")
            seasons[str(y)] = data
        except Exception as e:  # noqa: BLE001
            warn(f"IDP stats {y}: {e}")
    seasons = {k: v for k, v in seasons.items() if int(k) >= season - 2}

    fp = dict(old.get("fantasypros") or {})
    for page, group in (("dl", "DL"), ("lb", "LB"), ("db", "DB")):
        try:
            d = parse_fp(get(FP_URL.format(page), as_json=False))
            ranked, unmatched = [], []
            for p in d.get("players", []):
                # FantasyPros puts edge rushers on both its DL and LB pages; Sleeper eligibility decides.
                sid = matcher.find(p["player_name"], IDP, p.get("player_team_id"))
                if sid:
                    ranked.append([sid, int(p["rank_ecr"])])
                else:
                    unmatched.append(p["player_name"])
            if len(ranked) < 40:
                raise ValueError(f"only {len(ranked)} {group} players matched")
            fp[group] = {"ranks": ranked, "unmatched": unmatched, "updated": d.get("last_updated"),
                         "experts": d.get("total_experts")}
        except Exception as e:  # noqa: BLE001
            warn(f"IDP FantasyPros {group}: {e}")

    payload = {"updated": date.today().isoformat(), "fields": IDP_STATS, "seasons": seasons,
               "fantasypros": fp, "warnings": [w for w in warnings if w.startswith("IDP")]}
    path = write_js("nfl/idp.js", "window.IDP_DATA", payload)
    print(f"IDP: seasons {sorted(seasons)} ({', '.join(str(len(v)) for v in seasons.values())} players), "
          f"FantasyPros {', '.join(g + ' ' + str(len(v['ranks'])) for g, v in fp.items())} -> {path.relative_to(HERE)}")


# ---------- Basketball: Hashtag Basketball ----------

def text(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def parse_rankings(page):
    players = []
    for card in page.split('<div class="card dyn-card">')[1:]:
        rank = re.search(r'class="dyn-rank">\s*(\d+)', card)
        name = re.search(r'class="dyn-name">(.*?)<span', card, re.S)
        if not (rank and name):
            continue
        meta = re.search(r'class="dyn-meta">(.*?)</div>', card, re.S).group(1)
        badges = [text(b) for b in re.findall(r"<span[^>]*badge[^>]*>(.*?)</span>", meta, re.S)]
        age = next((float(b[:-2]) for b in badges if re.fullmatch(r"[\d.]+yo", b)), None)
        pos = [b for b in badges if b in ("PG", "SG", "SF", "PF", "C")]
        team = next((b for b in badges if not b.endswith("yo") and b not in pos), "") or "FA"
        trend = re.search(r'class="dyn-trend">\s*<i class="fa ([^"]+)"></i>\s*(\d*)', card)
        move = 0
        if trend and trend.group(2):
            move = int(trend.group(2)) * (1 if "up" in trend.group(1) else -1)
        stats = {lab: float(val) for val, lab in
                 re.findall(r'<div class="m [^"]*">([-\d.]+)<small>([^<]+)</small>', card)}
        gp = re.search(r'Season</td>\s*<td class="d-none">[^<]*</td>\s*<td>(\d+)</td>', card)
        outlook = re.search(r'class="dyn-outlook">(.*?)</div>', card, re.S)
        hbid = re.search(r"href='/(\d+)/dynasty'", card)
        players.append({
            "rank": int(rank.group(1)), "name": text(name.group(1)), "pos": pos, "team": team,
            "age": age, "move": move, "gp": int(gp.group(1)) if gp else None,
            "stats": {k: stats.get(k) for k in HB_STATS},
            "outlook": text(outlook.group(1)) if outlook else "",
            "hbid": hbid.group(1) if hbid else None,
        })
    return players


def refresh_rankings():
    try:
        players = parse_rankings(get(HB_URL, as_json=False))
        if len(players) < 100:
            raise ValueError(f"only parsed {len(players)} ranked players; the rankings page layout may have changed")
    except Exception as e:  # noqa: BLE001
        warn(f"NBA Hashtag Basketball: {e}")
        old = read_js("nba/rankings.js")
        if old:  # keep the last good rankings, flagged so the page can say so
            old["warnings"] = [f"Hashtag Basketball: {e}"]
            write_js("nba/rankings.js", "window.HB_RANKINGS", old)
        return
    path = write_js("nba/rankings.js", "window.HB_RANKINGS",
                    {"source": HB_URL, "updated": date.today().isoformat(), "players": players, "warnings": []})
    print(f"Rankings: {len(players)} players -> {path.relative_to(HERE)}")


def parse_keeper(page):
    table = re.search(r'<table[^>]*id="ContentPlaceHolder1_GridView1".*?</table>', page, re.S)
    if not table:
        raise ValueError("no keeper table; the page layout may have changed")
    players = []
    for row in re.findall(r"<tr.*?</tr>", table.group(0), re.S)[1:]:
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        if len(cells) < 6 or not text(cells[0]).isdigit():
            continue
        hbid = re.search(r'href="/(\d+)/dynasty"', cells[1])
        players.append({
            "rank": int(text(cells[0])), "name": text(cells[1]), "team": text(cells[2]) or "FA",
            "pos": [x for x in text(cells[3]).split(",") if x], "age": float(text(cells[4]) or 0) or None,
            "value": int(text(cells[5])), "hbid": hbid.group(1) if hbid else None,
        })
    votes = re.search(r"using ([\d,]+) votes", page)
    updated = re.search(r"Updated:(?:</strong>)?\s*([^<]+?)\s*<", page)
    return players, (int(votes.group(1).replace(",", "")) if votes else None), (updated.group(1).strip() if updated else None)


def refresh_keeper():
    try:
        players, votes, updated = parse_keeper(get(HB_KEEPER_URL, as_json=False))
        if len(players) < 200:
            raise ValueError(f"only parsed {len(players)} players")
    except Exception as e:  # noqa: BLE001
        warn(f"NBA Hashtag Basketball keeper values: {e}")
        old = read_js("nba/keeper.js")
        if old:
            old["warnings"] = [f"Hashtag Basketball keeper values: {e}"]
            write_js("nba/keeper.js", "window.HB_KEEPER", old)
        return
    path = write_js("nba/keeper.js", "window.HB_KEEPER", {"source": HB_KEEPER_URL, "updated": updated or date.today().isoformat(),
                                                           "votes": votes, "players": players, "warnings": []})
    print(f"Keeper values: {len(players)} players ({votes} votes, updated {updated}) -> {path.relative_to(HERE)}")


def lineup_week(state):
    """The week whose lineups matter now: the current regular-season week (week 1 before the season)."""
    if state.get("season_type") != "regular":
        return int(state.get("league_season") or state.get("season")), 1
    return int(state.get("season")), int(state.get("week") or 1)


def get_matchups(league_id, state):
    season, week = lineup_week(state)
    try:
        return {"week": week, "teams": [{k: m.get(k) for k in ("roster_id", "matchup_id", "starters", "points")}
                                        for m in (get(f"{SLEEPER}/league/{league_id}/matchups/{week}") or [])]}
    except Exception:  # noqa: BLE001 - optional; the page fetches it live too
        return {"week": week, "teams": []}


# Projection fields that are never scoring categories.
PROJ_SKIP = {"adp_dd_ppr", "pos_adp_dd_ppr", "cmp_pct", "pts_ppr", "pts_half_ppr", "pts_std", "sp", "gp"}


def refresh_projections(sport):
    """This week's projected stats per player, summed over his games (basketball has one entry per game)."""
    state = get(f"{SLEEPER}/state/{sport}")
    season, week = lineup_week(state)
    try:
        url = f"https://api.sleeper.app/projections/{sport}/{season}/{week}?season_type=regular"
        if sport == "nfl":
            url += "".join(f"&position[]={p}" for p in ("QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"))
        rows = get(url)
        players = {}
        for r in rows:
            st = r.get("stats") or {}
            if not st.get("gp"):
                continue
            p = players.setdefault(str(r["player_id"]), {"s": {}, "g": 0, "opp": []})
            p["g"] += 1
            if r.get("opponent"):
                p["opp"].append(r["opponent"])
            for k, v in st.items():
                if k not in PROJ_SKIP and isinstance(v, (int, float)) and v:
                    p["s"][k] = round(p["s"].get(k, 0) + v, 2)
            if sport == "nba":  # Lock-In leagues judge each game on its own: keep them apart too
                p.setdefault("gm", []).append({"d": r.get("date"), "opp": r.get("opponent"), "gid": r.get("game_id"),
                                               "s": {k: round(v, 2) for k, v in st.items()
                                                     if k not in PROJ_SKIP and isinstance(v, (int, float)) and v}})
        if len(players) < 100:
            raise ValueError(f"only {len(players)} players projected for week {week}")
    except Exception as e:  # noqa: BLE001
        warn(f"{sport.upper()} projections: {e}")
        return
    path = write_js(f"{sport}/proj.js", f"window.PROJ_{sport.upper()}",
                    {"season": season, "week": week, "updated": datetime.now(timezone.utc).isoformat(timespec="minutes"),
                     "players": players})
    print(f"Projections: {sport} {season} week {week}, {len(players)} players -> {path.relative_to(HERE)}")


# Box-score stats kept for each recent basketball game (any of them can be a scoring category).
NBA_GAME_KEYS = ["pts", "reb", "oreb", "dreb", "ast", "stl", "blk", "to", "tpm", "tpa", "fgm", "fga", "ftm", "fta",
                 "pf", "tf", "ff", "dd", "td", "bonus_pt_40p", "bonus_pt_50p", "bonus_reb_20p", "bonus_ast_15p"]
NBA_RECENT = 10


def refresh_nba_games():
    """Each player's last 10 games, box score by box score, for Lock-In decisions ("how often does he beat this?").
    Reads this season's weeks so far, then last season's final weeks until most players have 10 games."""
    state = get(f"{SLEEPER}/state/nba")
    season, week = lineup_week(state)
    games = {}  # pid -> [[date, opp, team, *stats]] newest first

    def take(season_, week_):
        rows = get(f"https://api.sleeper.com/stats/nba/{season_}/{week_}?season_type=regular") or []
        n = 0
        for r in sorted(rows, key=lambda r: r.get("date") or "", reverse=True):
            st = r.get("stats") or {}
            if not st.get("gp") and not st.get("sp"):
                continue  # did not play
            g = games.setdefault(str(r["player_id"]), [])
            if len(g) < NBA_RECENT and not any(x[0] == r.get("date") for x in g):
                g.append([r.get("date"), r.get("opponent"), r.get("team")] + [st.get(k, 0) or 0 for k in NBA_GAME_KEYS])
                n += 1
        return n

    try:
        # This season, newest week first (the current week may be in progress; finished games count).
        for w in range(week, 0, -1):
            take(season, w)
        # Then last season, from its last regular-season week back, until the rotation players have 10.
        prev, fetched = season - 1, 0
        for w in range(26, 0, -1):
            enough = sum(1 for g in games.values() if len(g) >= NBA_RECENT)
            if fetched and enough >= 300:
                break
            if take(prev, w):
                fetched += 1
            if fetched >= 6:
                break
        if sum(1 for g in games.values() if g) < 200:
            raise ValueError(f"only {len(games)} players with recent games")
    except Exception as e:  # noqa: BLE001
        warn(f"NBA recent games: {e}")
        return
    path = write_js("nba/games.js", "window.NBA_GAMES",
                    {"updated": datetime.now(timezone.utc).isoformat(timespec="minutes"), "keys": NBA_GAME_KEYS,
                     "players": games})
    print(f"Recent games: nba {len(games)} players -> {path.relative_to(HERE)}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sport", choices=["nfl", "nba"], help="refresh one sport's data only")
    ap.add_argument("--skip-leagues", action="store_true", help="don't snapshot the built-in leagues")
    args = ap.parse_args()
    sports = [args.sport] if args.sport else ["nfl", "nba"]

    home_ids = json.loads((HERE / "leagues.json").read_text())["leagues"]
    rostered = {"nfl": set(), "nba": set()}
    home = read_js("home.js") or []
    if not args.skip_leagues:
        home = []
        for lid in home_ids:
            try:
                entry, ids = refresh_league(lid)
            except Exception as e:  # noqa: BLE001
                warn(f"League {lid}: {e}")
                continue
            home.append(entry)
            rostered.setdefault(entry["sport"], set()).update(ids)
        write_js("home.js", "window.HOME_LEAGUES", home)

    if "nfl" in sports:
        players = sleeper_players("nfl")
        season = int(get(f"{SLEEPER}/state/nfl").get("season") or date.today().year)
        refresh_players("nfl", players, rostered["nfl"])
        refresh_values(players)
        refresh_idp(players, season)
        refresh_projections("nfl")
    if "nba" in sports:
        refresh_players("nba", sleeper_players("nba"), rostered["nba"])
        refresh_rankings()
        refresh_keeper()
        refresh_projections("nba")
        refresh_nba_games()

    if warnings:
        print(f"\n{len(warnings)} source(s) failed; their last good data was kept.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
