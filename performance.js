import { replayUrl } from "./highlights.js";

const minimumOpeningGames = 5;
const dateLabel = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const total = entry => entry.Wins + entry.Losses + entry.Draws;

function openingName(game) {
  const pgn = typeof game.pgn === "string" ? game.pgn : "";
  const taggedName = pgn.match(/^\[Opening "([^"\r\n]+)"\]/m)?.[1];
  if (taggedName) return taggedName;
  const ecoUrl = pgn.match(/^\[ECOUrl "([^"\r\n]+)"\]/m)?.[1] || game.eco;
  const slug = typeof ecoUrl === "string" &&
    ecoUrl.match(/^https:\/\/(?:www\.)?chess\.com\/openings\/([\w.-]+)\/?$/)?.[1];
  if (slug) return slug.split(/-\d+\./)[0].replaceAll("-", " ");
  return "";
}

function countResult(groups, key, fields, outcome) {
  if (!groups.has(key)) groups.set(key, { ...fields, Wins: 0, Losses: 0, Draws: 0 });
  const entry = groups.get(key);
  entry[outcome] += 1;
  return entry;
}

export function recordPerformance(stats, game, player, opponent, speed, outcome, timestamp) {
  const replay = replayUrl(game.url);
  if (game.rated && Number.isInteger(player.rating)) {
    if (!stats.history.has(speed)) stats.history.set(speed, []);
    stats.history.get(speed).push({ timestamp, rating: player.rating,
      opponent: opponent?.username, outcome, replay });
  }
  const rival = opponent?.username;
  if (typeof rival === "string" && rival) {
    countResult(stats.rivals, rival.toLowerCase(), { name: rival }, outcome);
  }
  const name = openingName(game);
  if (!name) return;
  const color = player === game.white ? "White" : "Black";
  const entry = countResult(stats.openings, `${color}:${name.toLowerCase()}`,
    { name, color, replays: [] }, outcome);
  if (entry.replays.length < 2 && replay) entry.replays.push(replay);
}

function ratingChart(speed, games, escape) {
  const firstGame = games[0];
  const lastGame = games.at(-1);
  const { timestamp: firstTime, rating: first } = firstGame;
  const { timestamp: lastTime, rating: last } = lastGame;
  const delta = last - first;
  let low = first;
  let peakGame = firstGame;
  for (const game of games) {
    low = Math.min(low, game.rating);
    if (game.rating > peakGame.rating) peakGame = game;
  }
  const high = peakGame.rating;
  const points = games.map(({ timestamp, rating }, index) => {
    const fraction = lastTime > firstTime ? (timestamp - firstTime) / (lastTime - firstTime)
      : index / Math.max(1, games.length - 1);
    const x = 4 + 292 * fraction;
    const y = high === low ? 36 : 66 - 60 * (rating - low) / (high - low);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const dot = games.length === 1 ? '<circle cx="4" cy="36" r="3"/>' : "";
  const label = speed.charAt(0).toUpperCase() + speed.slice(1);
  return `<div class="rating-series"><h3>${escape(label)}</h3>
    <strong>${first.toLocaleString("en")} → ${last.toLocaleString("en")}</strong>
    <span class="rating-change">${delta > 0 ? "+" : ""}${delta} points</span>
    <svg viewBox="0 0 300 72" role="img" aria-label="Rating chart, low ${low}, high ${high}">
      <polyline points="${points}"/>${dot}</svg>
    <span class="rating-dates">${dateLabel.format(firstTime)} – ${dateLabel.format(lastTime)} · ${games.length} rated ${games.length === 1 ? "game" : "games"}</span>
    ${renderMilestones(firstGame, peakGame, lastGame, escape)}</div>`;
}

function renderMilestones(first, peak, last, escape) {
  const milestones = new Map();
  for (const [game, label] of [[first, "First"], [peak, "Peak rating"], [last, "Last"]]) {
    if (!milestones.has(game)) milestones.set(game, []);
    milestones.get(game).push(label);
  }
  const result = { Wins: "Win", Losses: "Loss", Draws: "Draw" };
  const rows = [...milestones].map(([game, labels]) => {
    const opponent = game.opponent ? ` · vs @${escape(game.opponent)}` : "";
    const replay = game.replay ? `<a href="${escape(game.replay)}">Replay on Chess.com</a>` : "";
    return `<li><div><strong>${labels.join(" / ")} · ${game.rating.toLocaleString("en")}</strong>
      <span>${dateLabel.format(game.timestamp)} · ${result[game.outcome]}${opponent}</span>${replay}</div></li>`;
  }).join("");
  return `<details class="rating-milestones"><summary>Milestone games</summary><ul>${rows}</ul></details>`;
}

export function renderPerformance(stats, escape) {
  const ratings = [...stats.history].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([speed, games]) => ratingChart(speed, games, escape)).join("");
  const byGames = (a, b) => total(b) - total(a) || a.name.localeCompare(b.name) ||
    (a.color || "").localeCompare(b.color || "");
  const rival = [...stats.rivals.values()].sort(byGames)[0];
  const record = entry => `${entry.Wins}W · ${entry.Losses}L · ${entry.Draws}D`;
  const rivalText = rival && total(rival) >= 2
    ? `<strong class="performance-leader">@${escape(rival.name)}</strong>
       <p>${total(rival)} games against your most-played opponent</p><p>${record(rival)}</p>`
    : "<p>No repeat opponent in this period.</p>";
  const openings = [...stats.openings.values()].sort(byGames);
  const best = openings.filter(entry => total(entry) >= minimumOpeningGames)
    .sort((a, b) => b.Wins / total(b) - a.Wins / total(a) || byGames(a, b))[0];
  const displayed = openings.slice(0, 5);
  if (best && !displayed.includes(best)) displayed.push(best);
  const cards = displayed.map(entry => {
    const links = entry.replays.map((url, i) => `<a href="${escape(url)}">Replay ${i + 1}</a>`).join(" ");
    return `<li><div><strong>${escape(entry.name)}</strong> <span>as ${entry.color}</span>
      ${entry === best ? '<span class="opening-best">Best win rate</span>' : ""}
      <div class="opening-replays">${links}</div></div>
      <div class="opening-score"><strong>${Math.round(100 * entry.Wins / total(entry))}%</strong>
      <span>${record(entry)} · ${total(entry)} games</span></div></li>`;
  }).join("");
  const eligible = openings.length ? `<p>Best win rate requires at least ${minimumOpeningGames} games with the same opening and color.</p><ul>${cards}</ul>`
    : "<p>No named openings available from Chess.com for this period.</p>";
  return `<section class="performance">
    <article class="rating-journey"><h2>Rating journey</h2>
      ${ratings ? `<p>Ratings recorded in your first and last rated games for each time control.</p><div class="rating-series-grid">${ratings}</div>`
        : "<p>No rated games with recorded ratings in this period.</p>"}</article>
    <article><h2>Your chess nemesis</h2>${rivalText}</article>
    <article><h2>Opening report card</h2>${eligible}</article>
  </section>`;
}
