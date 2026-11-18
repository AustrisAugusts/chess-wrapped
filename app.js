import { loadGames, render, summarize } from "./reports.js";

const form = document.querySelector("#lookup");
const monthInput = form.elements.month;
const usernameInput = form.elements.username;
const output = document.querySelector("#report");
const controls = document.querySelector("#controls");
const status = document.querySelector("#status");
const monthly = document.querySelector("#monthly");
const yearly = document.querySelector("#yearly");
const monthFormat = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });

monthInput.value = monthInput.max = new Date().toISOString().slice(0, 7);
let reports;
let active;
let username;

function show(mode) {
  active = reports[mode];
  output.innerHTML = active.html;
  monthly.setAttribute("aria-pressed", mode === "monthly");
  yearly.setAttribute("aria-pressed", mode === "yearly");
}

monthly.addEventListener("click", () => show("monthly"));
yearly.addEventListener("click", () => show("yearly"));

form.addEventListener("submit", async event => {
  event.preventDefault();
  const player = usernameInput.value.trim();
  if (!/^[a-z0-9_-]{1,64}$/i.test(player)) {
    status.textContent = "Enter a Chess.com username using letters, numbers, underscores or hyphens.";
    return;
  }
  const selected = monthInput.value;
  const [year, month] = selected.split("-").map(Number);
  const start = Date.UTC(year, month - 1, 1);
  const end = Date.UTC(year, month, 1);
  const submit = form.querySelector("button");
  submit.disabled = true;
  controls.hidden = true;
  output.replaceChildren();
  status.textContent = "Looking up Chess.com archives…";
  try {
    const games = await loadGames(player, year, (current, total) => {
      status.textContent = `Loading Chess.com archive ${current} of ${total}…`;
    });
    const monthPeriod = monthFormat.format(start);
    reports = {
      monthly: { label: selected, html: render(player, monthPeriod, false,
        summarize(games, player, start, end, false)) },
      yearly: { label: String(year), html: render(player, String(year), true,
        summarize(games, player, Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1), true)) },
    };
    username = player;
    show("monthly");
    controls.hidden = false;
    status.textContent = `Reports ready for @${player}.`;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#download").addEventListener("click", async () => {
  const report = active;
  const player = username;
  try {
    const response = await fetch("report.css");
    if (!response.ok) throw new Error();
    const css = await response.text();
    const markup = `<!doctype html><html lang="en"><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>${player} · ${report.label} · Chess Wrapped</title><style>${css}</style>
      <main><header><span>♞ Chess Wrapped</span></header>${report.html}</main></html>`;
    const url = URL.createObjectURL(new Blob([markup], { type: "text/html" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${player.toLowerCase()}-${report.label}.html`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    status.textContent = "The report could not download. Try again in a moment.";
  }
});
