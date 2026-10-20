// "How it works": a plain-language tour of what Front Office does and where its numbers come from.
(function () {
  "use strict";
  const DH = window.DH;

  const card = (title, body) => `<section class="card section how-card"><h2>${title}</h2>${body}</section>`;

  DH.howHtml = () => `<div class="stack how-page">
    <header class="top"><div class="brand"><span class="eyebrow">Front Office</span><h1>How it works</h1></div></header>
    <p class="lead">Front Office is a second opinion for your Sleeper dynasty league. It reads your league from Sleeper, puts a value on
      every player, and points out the moves, trades and lineup calls worth a look. It never changes anything in Sleeper; you
      decide and make the moves there.</p>

    <div class="how-grid">
    ${card("Where the numbers come from", `
      <p><strong>Your league</strong> (rosters, scoring, lineup slots, matchups) comes straight from Sleeper every time you open it.</p>
      <p><strong>Football offense</strong> uses KeepTradeCut's dynasty values, or Dynasty Daddy's if you pick it in Settings. They're
        crowdsourced trade values, so they reflect what managers will actually pay. Superflex and tight-end premium leagues get the
        matching values.</p>
      <p><strong>Football IDP</strong> (if your league has defenders): nobody publishes trade values for them, so Front Office builds its
        own from three seasons of stats scored with your league's settings. Tackles and sacks count most; interceptions and other big
        plays are mostly luck and count less. It then checks against the FantasyPros dynasty rankings and adjusts for age.</p>
      <p><strong>Basketball</strong> uses Hashtag Basketball's dynasty rankings and its crowdsourced keeper values.</p>
      <p><strong>Projections</strong> for the Matchup tab are Sleeper's, scored with your league's settings.</p>
      <p class="small muted">Values and projections refresh twice a day.</p>`)}

    ${card("Team", `
      <p><strong>Positional balance</strong> compares your starters at each position with the rest of the league and says whether you're
        thin, solid or deep, and how many players you have against how many you need.</p>
      <p><strong>Players</strong> lists your roster and the best free agents together, ranked by value, so you can see at a glance who on
        the wire is better than who on your bench.</p>`)}

    ${card("Moves", `
      <p>Waiver pickups worth making, one at a time, each with the player to drop. A move has to clearly improve you: about 12% more
        value, and not just a rounding error. Moves that fix a short position come first.</p>
      <p>It never suggests dropping a player you've <strong>locked</strong>, or anyone on your taxi squad or IR.</p>`)}

    ${card("Trades", `
      <p>Trade ideas with every other team: one-for-one, two-for-one and one-for-two. An idea only shows up if it's:</p>
      <ul>
        <li><strong>Fair</strong> by market value (within 10% by default), counting the premium the best player in an uneven deal carries.</li>
        <li><strong>Good for them</strong>: it fills a position where they're thin, so it has a real chance of being accepted.</li>
        <li><strong>Good for you</strong>: better starters, or clearly more value.</li>
        <li><strong>Sensible for your roster</strong>: it won't leave you short somewhere or stack a position you've already filled.</li>
      </ul>
      <p class="small muted">Football trades cover offense only; IDP has no trade market. Draft picks aren't valued yet.</p>`)}

    ${card("Draft and Matchup", `
      <p><strong>Draft</strong> shows up while a rookie draft is pending: the best available rookies for each pick you own.</p>
      <p><strong>Matchup</strong> shows up during the season. Switch between your <strong>optimal</strong> lineup (best by projections) and
        your <strong>current</strong> Sleeper lineup, with a win chance against this week's opponent. Players tagged <em>Start</em> or
        <em>Sit</em> are the changes to make, and <em>Before kickoff</em> lists questionable starters and close calls.</p>
      <p><strong>Basketball Lock-In</strong> (Sleeper's standard format, where each slot counts one game a week): after each game it
        says <em>Lock</em> or <em>Hold</em> for every starter, from how often his last 10 games beat that score, his games left and
        what your other players could still put in the slot. It also says who to start today so no game goes to waste.</p>
      <p class="small muted">Injured players count less: questionable at 85%, doubtful at 25%, out at 0.</p>`)}

    ${card("Settings and locks", `
      <p>Open <strong>Settings</strong> (the gear under your team name) to pick your team, make Moves and Trades pickier or looser, and in
        football, switch the values source or lean toward winning now.</p>
      <p><strong>Lock</strong> players you'd never let go (the Lock button next to any player), and they'll never be suggested as a drop or
        trade piece.</p>`)}

    ${card("Your data and other devices", `
      <p>Front Office only reads Sleeper's public data; it never needs your Sleeper password. Your leagues and settings are saved in your
        browser and, so they follow you to your phone and other browsers, in one copy filed under a random sync key only your devices
        know. No email, password or name is collected.</p>
      <p>To use it on another device, open <strong>Leagues → Sync across devices → Copy sync link</strong> and open the link there.</p>`)}

    ${card("Good to know", `
      <ul>
        <li>These are suggestions from public data, not certainties. Values lag breaking news by a few hours.</li>
        <li>Everyone in your league can use Front Office too, and can see the same ideas for any team.</li>
        <li>On a phone, use your browser's <em>Add to Home Screen</em> to get an app icon.</li>
        <li>Something looks wrong, or there's a feature you want? <button type="button" class="linklike" data-feedback>Send feedback</button>.</li>
      </ul>`)}
    </div>
  </div>`;
})();
