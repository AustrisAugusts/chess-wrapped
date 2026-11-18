const dayMs = 86400000;
const shortMonth = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
const dateLabel = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

export function firstMoves(pgn) {
  if (typeof pgn !== "string" || /^\s*\[(?:FEN\s|SetUp\s+"1")/m.test(pgn)) return [];
  const text = pgn.replace(/^\s*\[.*\]\s*$/gm, "")
    .replace(/\{[^}]*\}|;[^\n]*|\$\d+/g, " ").trim();
  const move = "[a-h][1-8]|[NBRQK][a-h][1-8]";
  const match = text.match(new RegExp(`^1\\.(?!\\.)\\s*(${move})[!?]*(?=\\s|$)\\s*(?:1\\.\\.\\.\\s*)?(${move})?`));
  return match ? [match[1], match[2]] : [];
}

export function replayUrl(url) {
  return /^https:\/\/(?:www\.)?chess\.com\/game\/(?:live|daily)\/\d+\/?$/.test(url) ? url : "";
}

export function recordHighlights(stats, game, player, opponent, day, outcome) {
  const [white, black] = firstMoves(game.pgn);
  const isWhite = player === game.white;
  const opening = isWhite ? white && `1.${white}` : black && `1.${white} → 1…${black}`;
  if (opening) {
    const moves = isWhite ? stats.whiteMoves : stats.blackReplies;
    moves.set(opening, (moves.get(opening) || 0) + 1);
  }
  stats.days.set(day, (stats.days.get(day) || 0) + 1);
  if (outcome !== "Wins" || !game.rated ||
      !Number.isInteger(player.rating) || !Number.isInteger(opponent?.rating)) return;
  const gap = opponent.rating - player.rating;
  if (gap > (stats.upset?.gap ?? 0)) {
    const link = replayUrl(game.url);
    stats.upset = { gap, playerRating: player.rating, opponentRating: opponent.rating,
      opponent: opponent.username || "Opponent", day, link };
  }
}

export function renderHighlights(stats, escape) {
  const repertoire = moves => [...moves].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3).map(([move, count]) => `<li>${escape(move)}<strong>${count}</strong></li>`).join("")
    || "<li>No moves available</li>";
  const { upset, days, start, end } = stats;
  let busiest = start;
  let streak = 0;
  let longest = 0;
  for (let day = start; day < end; day += dayMs) {
    const count = days.get(day) || 0;
    if (count > (days.get(busiest) || 0)) busiest = day;
    streak = count ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }
  const peak = days.get(busiest) || 0;
  const months = [];
  for (let first = start; first < end;) {
    const date = new Date(first);
    const next = Math.min(end, Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
    const cells = Array.from({ length: (date.getUTCDay() + 6) % 7 },
      () => '<span class="calendar-pad" aria-hidden="true"></span>');
    for (let day = first; day < next; day += dayMs) {
      const count = days.get(day) || 0;
      const label = `${dateLabel.format(day)} · ${count} ${count === 1 ? "game" : "games"}`;
      const level = count ? Math.ceil(4 * count / peak) : 0;
      cells.push(`<span class="calendar-day level-${level}" role="img" aria-label="${label}" title="${label}">${new Date(day).getUTCDate()}</span>`);
    }
    months.push(`<div class="calendar-month"><h3>${shortMonth.format(first)}</h3>
      <div class="calendar-grid"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span>${cells.join("")}</div></div>`);
    first = next;
  }
  const upsetText = upset ? `<strong class="upset-gap">${upset.gap} rating points</strong>
    <p>Beat @${escape(upset.opponent)} · ${upset.playerRating} vs ${upset.opponentRating} · ${dateLabel.format(upset.day)}</p>
    ${upset.link ? `<a href="${escape(upset.link)}">Replay on Chess.com</a>` : ""}`
    : "<p>No rated win against a higher-rated opponent in this period.</p>";
  const calendarText = peak
    ? `${days.size} active ${days.size === 1 ? "day" : "days"} · Busiest ${dateLabel.format(busiest)} (${peak} ${peak === 1 ? "game" : "games"}) · Longest streak ${longest} ${longest === 1 ? "day" : "days"}`
    : "No active days in this period.";
  return `<section class="report-highlights">
    <article><h2>Opening repertoire</h2><div class="opening-columns">
      <div><h3>First moves as White</h3><ul>${repertoire(stats.whiteMoves)}</ul></div>
      <div><h3>Replies as Black</h3><ul>${repertoire(stats.blackReplies)}</ul></div>
    </div></article>
    <article><h2>Biggest upset</h2>${upsetText}</article>
    <article class="chess-calendar"><h2>Chess calendar</h2><p>${calendarText}</p>
      <div class="calendar-months">${months.join("")}</div>
      <div class="calendar-legend">Fewer games <span class="level-0"></span><span class="level-1"></span>
      <span class="level-2"></span><span class="level-3"></span><span class="level-4"></span> More games</div>
    </article>
  </section>`;
}
