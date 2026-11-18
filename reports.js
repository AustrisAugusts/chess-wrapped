import { recordPerformance, renderPerformance } from "./performance.js";
import { recordHighlights, renderHighlights } from "./highlights.js";

const api = "https://api.chess.com/pub/player";
const outcomes = {
  win: "Wins",
  agreed: "Draws", repetition: "Draws", stalemate: "Draws", insufficient: "Draws",
  "50move": "Draws", timevsinsufficient: "Draws",
  checkmated: "Losses", timeout: "Losses", resigned: "Losses", abandoned: "Losses",
  lose: "Losses", kingofthehill: "Losses", threecheck: "Losses", bughousepartnerlose: "Losses",
};
const monthNames = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
const number = new Intl.NumberFormat("en");

async function getJson(url) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  } catch {
    throw new Error("Could not reach Chess.com. Try again in a moment.");
  }
  if (response.status === 404) throw new Error("Chess.com could not find that player or game archive.");
  if (response.status === 429) throw new Error("Chess.com is limiting requests. Try again in a moment.");
  if (!response.ok) throw new Error("Chess.com could not load the game archives. Try again in a moment.");
  return response.json();
}

export async function loadGames(username, year, progress = () => {}) {
  const player = `${api}/${encodeURIComponent(username.toLowerCase())}/games`;
  const { archives } = await getJson(`${player}/archives`);
  const months = [...new Set(archives.map(url => url.split("/").slice(-2).join("/")))]
    .filter(month => new RegExp(`^${year}/(0[1-9]|1[0-2])$`).test(month)).sort();
  const games = [];
  // Chess.com asks clients to request archives serially.
  for (const [index, month] of months.entries()) {
    progress(index + 1, months.length);
    const archive = await getJson(`${player}/${month}`);
    for (const game of archive.games) games.push(game);
  }
  return games;
}

export function summarize(games, username, start, end, yearly) {
  const highlights = { start, end, days: new Map(), whiteMoves: new Map(), blackReplies: new Map(), upset: null };
  const performance = { history: new Map(), rivals: new Map(), openings: new Map() };
  const results = { Wins: 0, Losses: 0, Draws: 0 };
  const activity = Array(yearly ? 12 : (end - start) / 86400000).fill(0);
  const formats = new Map();
  const ratings = new Map();
  const seen = new Set();
  let streak = 0;
  let longest = 0;
  let total = 0;
  for (const game of [...games].sort((a, b) => a.end_time - b.end_time)) {
    const timestamp = game.end_time * 1000;
    if (game.rules !== "chess" || !(timestamp >= start && timestamp < end)) continue;
    if (game.url && seen.has(game.url)) continue;
    if (game.url) seen.add(game.url);
    const player = [game.white, game.black]
      .find(side => side?.username?.toLowerCase() === username.toLowerCase());
    const outcome = Object.hasOwn(outcomes, player?.result) && outcomes[player.result];
    if (!outcome) continue;
    total += 1;
    results[outcome] += 1;
    streak = outcome === "Wins" ? streak + 1 : 0;
    longest = Math.max(longest, streak);
    const day = new Date(timestamp);
    const opponent = player === game.white ? game.black : game.white;
    recordHighlights(highlights, game, player, opponent, Date.UTC(day.getUTCFullYear(),
      day.getUTCMonth(), day.getUTCDate()), outcome);
    activity[yearly ? day.getUTCMonth() : day.getUTCDate() - 1] += 1;
    const speed = game.time_class || "other";
    recordPerformance(performance, game, player, opponent, speed, outcome, timestamp);
    formats.set(speed, (formats.get(speed) || 0) + 1);
    if (game.rated && Number.isInteger(player.rating)) {
      ratings.set(speed, Math.max(ratings.get(speed) ?? 0, player.rating));
    }
  }
  const rate = total ? 100 * results.Wins / total : 0;
  const winRate = rate % 1 === 0.5 ? Math.floor(rate / 2) * 2 : Math.round(rate);
  return { activity, formats, highlights, longest, performance, ratings, results, total, winRate };
}

function escape(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

export function render(username, period, yearly, stats) {
  const tile = (label, value) => `<div class="tile"><strong>${value}</strong><span>${label}</span></div>`;
  const peak = Math.max(1, ...stats.activity);
  const bars = stats.activity.map((count, index) => {
    const label = yearly ? monthNames.format(Date.UTC(2000, index, 1)) : index + 1;
    const showLabel = yearly || index % 5 === 0 || index === stats.activity.length - 1;
    return `<div class="bar" title="${label}: ${count} games"><span style="height:${100 * count / peak}%"></span><small>${showLabel ? label : ""}</small></div>`;
  }).join("");
  const rows = items => items.map(([name, count]) => {
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    return `<li>${escape(label)}<strong>${number.format(count)}</strong></li>`;
  }).join("") || "<li>—</li>";
  const formats = [...stats.formats].sort((a, b) => b[1] - a[1]);
  const ratings = [...stats.ratings].sort((a, b) => a[0].localeCompare(b[0]));
  return `
    <section class="hero"><small>${yearly ? "Year in chess" : "Month in chess"}</small>
    <h1>${escape(period)}</h1><p>@${escape(username)}</p></section>
    ${stats.total ? "" : "<p>No standard games with a recorded result in this period.</p>"}
    <section class="tiles" aria-label="Highlights">
      ${tile("Games played", number.format(stats.total))}
      ${tile("Win rate", stats.total ? `${stats.winRate}%` : "—")}
      ${tile("Best win streak", stats.longest)}
    </section>
    <article class="activity"><h2>Games played over time</h2><div class="chart">${bars}</div></article>
    <section class="details">
      <article><h2>Results</h2><ul>${rows(Object.entries(stats.results))}</ul></article>
      <article><h2>Time controls</h2><ul>${rows(formats)}</ul></article>
      <article><h2>Peak rated-game rating</h2><ul>${rows(ratings)}</ul></article>
    </section>
    ${renderHighlights(stats.highlights, escape)}
    ${renderPerformance(stats.performance, escape)}
    <footer><span>Standard chess · UTC</span><span>Chess.com public archives</span></footer>`;
}
