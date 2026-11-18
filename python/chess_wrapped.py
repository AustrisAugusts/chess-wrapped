"""Generate standalone Chess.com reports with Python 3.10+."""
import argparse
import calendar
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from html import escape
import json
from pathlib import Path
import random
import re
from string import Template
from tempfile import NamedTemporaryFile
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DRAWS = {"agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"}
LOSSES = {"checkmated", "timeout", "resigned", "abandoned", "lose", "kingofthehill",
          "threecheck", "bughousepartnerlose"}
BASE = "https://api.chess.com/pub/player"


def request_json(url):
    request = Request(url, headers={"User-Agent": "ChessWrapped/1.0 (Python reporting project)"})
    try:
        with urlopen(request, timeout=20) as response:
            return json.load(response)
    except HTTPError as error:
        message = {404: "Chess.com could not find that account or archive.",
                   429: "Chess.com is rate limiting requests. Try again later."}
        raise ValueError(message.get(error.code, f"Chess.com returned HTTP {error.code}.")) from error
    except (URLError, TimeoutError) as error:
        raise ValueError(f"Could not reach Chess.com. {error}") from error


def load_games(username, months):
    archive_list = request_json(f"{BASE}/{username.lower()}/games/archives")["archives"]
    available = {"/".join(archive.split("/")[-2:]) for archive in archive_list}
    games = []
    for month in sorted(months & available):
        games.extend(request_json(f"{BASE}/{username.lower()}/games/{month}")["games"])
    return games


def month_key(day):
    return day.strftime("%Y/%m")


def demo_games(username, months):
    games = []
    for month in sorted(months):
        year, number = map(int, month.split("/"))
        randomizer = random.Random(year * 12 + number)
        for index in range(randomizer.randint(15, 36)):
            day = randomizer.randint(1, calendar.monthrange(year, number)[1])
            timestamp = datetime(year, number, day, 12, tzinfo=timezone.utc).timestamp()
            player = {"username": username, "rating": randomizer.randint(1300, 1570),
                      "result": randomizer.choices(
                          ["win", "resigned", "agreed"], weights=[54, 39, 7])[0]}
            game = {"end_time": timestamp, "rules": "chess", "rated": True,
                    "time_class": randomizer.choice(["blitz", "blitz", "rapid", "bullet"]),
                    "white": player, "black": {"username": "Opponent"},
                    "url": f"demo:{month}:{index}"}
            first_turns = ("e4 c5", "d4 Nf6", "e4 e5", "Nf3 d5")
            opening_names = ("Sicilian Defense", "Indian Game", "King’s Pawn Game", "Réti Opening")
            opening_index = index % len(first_turns)
            game["pgn"] = f'[Opening "{opening_names[opening_index]}"]\n\n1. {first_turns[opening_index]} *'
            game["black"]["username"] = ("RookFan", "CastleClub", "QuietBishop")[index % 3]
            game["black"]["rating"] = player["rating"] + (index % 9 - 3) * 23
            if index % 2:
                game["white"], game["black"] = game["black"], game["white"]
            games.append(game)
    return games


def first_moves(pgn):
    """Read the first turn of a PGN that starts from the standard position."""
    if not isinstance(pgn, str) or re.search(r'^\s*\[(?:FEN\s|SetUp\s+"1")', pgn, re.M):
        return None, None
    text = re.sub(r"^\s*\[.*\]\s*$", "", pgn, flags=re.M)
    text = re.sub(r"\{[^}]*\}|;[^\n]*|\$\d+", " ", text).strip()
    move = r"[a-h][1-8]|[NBRQK][a-h][1-8]"
    match = re.match(rf"^1\.(?!\.)\s*({move})[!?]*(?=\s|$)\s*(?:1\.\.\.\s*)?({move})?", text)
    return match.groups() if match else (None, None)


def rating_upset(game, player, opponent, day):
    if player["result"] != "win" or not game.get("rated"):
        return None
    player_rating, opponent_rating = player.get("rating"), opponent.get("rating")
    if not isinstance(player_rating, int) or not isinstance(opponent_rating, int):
        return None
    gap = opponent_rating - player_rating
    if gap <= 0:
        return None
    return (gap, opponent.get("username") or "Opponent", player_rating, opponent_rating,
            day, replay_url(game.get("url")))


def replay_url(url):
    if isinstance(url, str) and re.fullmatch(
            r"https://(?:www\.)?chess\.com/game/(?:live|daily)/\d+/?", url):
        return url
    return ""


def render_highlights(start, end, stats):
    def repertoire(moves):
        top = sorted(moves.items(), key=lambda item: (-item[1], item[0]))[:3]
        return "".join(f"<li>{escape(move)}<strong>{count}</strong></li>"
                       for move, count in top) or "<li>No moves available</li>"

    def date_label(day):
        return f"{calendar.month_abbr[day.month]} {day.day}"

    days = stats["days"]
    peak = max(days.values(), default=0)
    streak = longest = 0
    months = []
    first = start
    one_day = timedelta(days=1)
    while first < end:
        next_month = min(end, (first.replace(day=28) + timedelta(days=4)).replace(day=1))
        cells = ['<span class="calendar-pad" aria-hidden="true"></span>'] * first.weekday()
        for offset in range((next_month - first).days):
            day = first + offset * one_day
            count = days[day]
            streak = streak + 1 if count else 0
            longest = max(longest, streak)
            label = f"{date_label(day)} · {count} {'game' if count == 1 else 'games'}"
            level = (4 * count + peak - 1) // peak if count else 0
            cells.append(f'<span class="calendar-day level-{level}" role="img" aria-label="{label}"'
                         f' title="{label}">{day.day}</span>')
        weekdays = "".join(f"<span>{day}</span>" for day in "MTWTFSS")
        months.append(f'<div class="calendar-month"><h3>{calendar.month_abbr[first.month]}</h3>'
                      f'<div class="calendar-grid">{weekdays}{"".join(cells)}</div></div>')
        first = next_month

    calendar_text = "No active days in this period."
    if peak:
        busiest = min(day for day, count in days.items() if count == peak)
        active_days = len(days)
        calendar_text = (f"{active_days} active {'day' if active_days == 1 else 'days'} · "
                         f"Busiest {date_label(busiest)} ({peak} {'game' if peak == 1 else 'games'}) · "
                         f"Longest streak {longest} {'day' if longest == 1 else 'days'}")
    upset_text = "<p>No rated win against a higher-rated opponent in this period.</p>"
    if stats["upset"]:
        gap, opponent, player_rating, opponent_rating, day, url = stats["upset"]
        upset_text = (f'<strong class="upset-gap">{gap} rating points</strong>'
                      f'<p>Beat @{escape(opponent)} · {player_rating} vs {opponent_rating} · {date_label(day)}</p>')
        if url:
            upset_text += f'<a href="{escape(url)}">Replay on Chess.com</a>'
    legend = "".join(f'<span class="level-{level}"></span>' for level in range(5))
    return f"""
    <section class="report-highlights">
      <article><h2>Opening repertoire</h2><div class="opening-columns">
        <div><h3>First moves as White</h3><ul>{repertoire(stats["white_moves"])}</ul></div>
        <div><h3>Replies as Black</h3><ul>{repertoire(stats["black_replies"])}</ul></div>
      </div></article>
      <article><h2>Biggest upset</h2>{upset_text}</article>
      <article class="chess-calendar"><h2>Chess calendar</h2><p>{calendar_text}</p>
        <div class="calendar-months">{"".join(months)}</div>
        <div class="calendar-legend">Fewer games {legend} More games</div>
      </article>
    </section>"""


def opening_name(game):
    pgn = game.get("pgn") or ""
    if not isinstance(pgn, str):
        pgn = ""
    tagged_name = re.search(r'^\[Opening "([^"\r\n]+)"\]', pgn, re.M)
    if tagged_name:
        return tagged_name[1]
    eco_tag = re.search(r'^\[ECOUrl "([^"\r\n]+)"\]', pgn, re.M)
    url = eco_tag[1] if eco_tag else game.get("eco")
    if isinstance(url, str):
        slug = re.fullmatch(r"https://(?:www\.)?chess\.com/openings/([A-Za-z0-9_.-]+)/?", url)
        if slug:
            return re.split(r"-\d+\.", slug[1], maxsplit=1)[0].replace("-", " ")
    return ""


def record_performance(stats, game, player, opponent, speed, color, outcome):
    replay = replay_url(game.get("url"))
    if game.get("rated") and type(player.get("rating")) is int:
        stats["history"].setdefault(speed, []).append({
            "timestamp": game["end_time"], "rating": player["rating"],
            "opponent": opponent.get("username"), "outcome": outcome, "replay": replay})

    rival = opponent.get("username")
    if isinstance(rival, str) and rival:
        entry = stats["rivals"].setdefault(rival.casefold(), {"name": rival, "results": Counter()})
        entry["results"][outcome] += 1

    name = opening_name(game)
    if name:
        entry = stats["openings"].setdefault((name.casefold(), color), {
            "name": name, "color": color, "results": Counter(), "replays": []})
        entry["results"][outcome] += 1
        if len(entry["replays"]) < 2 and replay:
            entry["replays"].append(replay)


def rating_chart(speed, games):
    first_game, last_game = games[0], games[-1]
    peak_game = max(games, key=lambda game: game["rating"])
    first_time, first = first_game["timestamp"], first_game["rating"]
    last_time, last = last_game["timestamp"], last_game["rating"]
    low = min(game["rating"] for game in games)
    high = peak_game["rating"]
    points = []
    for index, game in enumerate(games):
        timestamp, rating = game["timestamp"], game["rating"]
        if last_time > first_time:
            fraction = (timestamp - first_time) / (last_time - first_time)
        else:
            fraction = index / max(1, len(games) - 1)
        height = 36 if high == low else 66 - 60 * (rating - low) / (high - low)
        points.append(f"{4 + 292 * fraction:.1f},{height:.1f}")

    def label(timestamp):
        day = datetime.fromtimestamp(timestamp, timezone.utc).date()
        return f"{calendar.month_abbr[day.month]} {day.day}"

    dot = '<circle cx="4" cy="36" r="3"/>' if len(games) == 1 else ""
    delta = last - first
    change = f"+{delta}" if delta > 0 else str(delta)
    count = f"{len(games)} rated {'game' if len(games) == 1 else 'games'}"
    return f"""<div class="rating-series"><h3>{escape(speed)}</h3>
      <strong>{first:,} → {last:,}</strong><span class="rating-change">{change} points</span>
      <svg viewBox="0 0 300 72" role="img" aria-label="Rating chart, low {low}, high {high}">
        <polyline points="{' '.join(points)}"/>{dot}</svg>
      <span class="rating-dates">{label(first_time)} – {label(last_time)} · {count}</span>
      {render_milestones(first_game, peak_game, last_game, label)}</div>"""


def render_milestones(first, peak, last, date_label):
    milestones = {}
    for game, label in ((first, "First"), (peak, "Peak rating"), (last, "Last")):
        milestones.setdefault(id(game), (game, []))[1].append(label)

    result = {"Wins": "Win", "Losses": "Loss", "Draws": "Draw"}
    rows = []
    for game, labels in milestones.values():
        date = date_label(game["timestamp"])
        opponent = f' · vs @{escape(game["opponent"])}' if game["opponent"] else ""
        replay = f'<a href="{escape(game["replay"])}">Replay on Chess.com</a>' if game["replay"] else ""
        rows.append(f'<li><div><strong>{" / ".join(labels)} · {game["rating"]:,}</strong>'
                    f'<span>{date} · {result[game["outcome"]]}{opponent}</span>{replay}</div></li>')
    return f'<details class="rating-milestones"><summary>Milestone games</summary><ul>{"".join(rows)}</ul></details>'


def render_performance(stats):
    def total(entry):
        return entry["results"].total()

    def by_games(entry):
        return (-total(entry), entry["name"].casefold(), entry.get("color", ""))

    def record(entry):
        results = entry["results"]
        return f'{results["Wins"]}W · {results["Losses"]}L · {results["Draws"]}D'

    history = sorted(stats["history"].items(), key=lambda item: (-len(item[1]), item[0]))
    charts = "".join(rating_chart(speed, games) for speed, games in history)
    rating_text = "<p>No rated games with recorded ratings in this period.</p>"
    if charts:
        rating_text = ('<p>Ratings recorded in your first and last rated games for each time control.</p>'
                       f'<div class="rating-series-grid">{charts}</div>')

    rivals = sorted(stats["rivals"].values(), key=by_games)
    rival_text = "<p>No repeat opponent in this period.</p>"
    if rivals and total(rivals[0]) >= 2:
        rival = rivals[0]
        rival_text = (f'<strong class="performance-leader">@{escape(rival["name"])}</strong>'
                      f'<p>{total(rival)} games against your most-played opponent</p><p>{record(rival)}</p>')

    openings = sorted(stats["openings"].values(), key=by_games)
    best = min((entry for entry in openings if total(entry) >= 5),
               key=lambda entry: (-entry["results"]["Wins"] / total(entry), by_games(entry)),
               default=None)
    displayed = openings[:5]
    if best and best not in displayed:
        displayed.append(best)
    cards = []
    for entry in displayed:
        links = " ".join(f'<a href="{escape(url)}">Replay {i}</a>'
                         for i, url in enumerate(entry["replays"], start=1))
        badge = '<span class="opening-best">Best win rate</span>' if entry is best else ""
        wins, games = entry["results"]["Wins"], total(entry)
        rate = (200 * wins + games) // (2 * games)
        cards.append(f"""<li><div><strong>{escape(entry["name"])}</strong> <span>as {entry["color"]}</span>
          {badge}<div class="opening-replays">{links}</div></div>
          <div class="opening-score"><strong>{rate}%</strong><span>{record(entry)} · {games} games</span></div></li>""")
    opening_text = "<p>No named openings available from Chess.com for this period.</p>"
    if cards:
        opening_text = ('<p>Best win rate requires at least 5 games with the same opening and color.</p>'
                        f'<ul>{"".join(cards)}</ul>')
    return f"""<section class="performance">
      <article class="rating-journey"><h2>Rating journey</h2>{rating_text}</article>
      <article><h2>Your chess nemesis</h2>{rival_text}</article>
      <article><h2>Opening report card</h2>{opening_text}</article>
    </section>"""


def summarize(games, username, start, end):
    outcomes = Counter()
    activity = Counter()
    formats = Counter()
    ratings = {}
    performance = {"history": {}, "rivals": {}, "openings": {}}
    days, white_moves, black_replies = Counter(), Counter(), Counter()
    upset = None
    streak = longest = 0
    seen = set()

    for game in sorted(games, key=lambda item: item["end_time"]):
        day = datetime.fromtimestamp(game["end_time"], timezone.utc).date()
        if not start <= day < end or game.get("rules") != "chess":
            continue
        game_id = game.get("url")
        if game_id and game_id in seen:
            continue
        if game_id:
            seen.add(game_id)
        players = [game["white"], game["black"]]
        player = next((p for p in players if p["username"].casefold() == username.casefold()), None)
        if player is None:
            continue

        result = player.get("result")
        if result == "win":
            outcome = "Wins"
        elif result in DRAWS:
            outcome = "Draws"
        elif result in LOSSES:
            outcome = "Losses"
        else:
            continue
        days[day] += 1
        white_move, black_move = first_moves(game.get("pgn"))
        is_white = player is game["white"]
        if is_white and white_move:
            white_moves[f"1.{white_move}"] += 1
        elif not is_white and black_move:
            black_replies[f"1.{white_move} → 1…{black_move}"] += 1
        opponent = game["black"] if is_white else game["white"]
        candidate = rating_upset(game, player, opponent, day)
        if candidate and (upset is None or candidate[0] > upset[0]):
            upset = candidate

        outcomes[outcome] += 1
        streak = streak + 1 if outcome == "Wins" else 0
        longest = max(streak, longest)
        bucket = day.strftime("%b") if (end - start).days > 32 else str(day.day)
        activity[bucket] += 1
        speed = game.get("time_class", "other").title()
        color = "White" if is_white else "Black"
        record_performance(performance, game, player, opponent, speed, color, outcome)
        formats[speed] += 1
        if game.get("rated") and isinstance(player.get("rating"), int):
            ratings[speed] = max(ratings.get(speed, 0), player["rating"])

    total = outcomes.total()
    return {"total": total, "win_rate": round(100 * outcomes["Wins"] / total) if total else 0,
            "outcomes": outcomes, "activity": activity, "formats": formats,
            "ratings": ratings, "longest": longest, "days": days, "upset": upset,
            "white_moves": white_moves, "black_replies": black_replies,
            "performance": performance}


def render(username, start, end, stats, source):
    yearly = (end - start).days > 32
    period = start.strftime("%Y" if yearly else "%B %Y")
    mode = "Year in chess" if yearly else "Month in chess"
    buckets = list(calendar.month_abbr)[1:] if yearly else [
        str(day) for day in range(1, (end - start).days + 1)]
    peak = max(stats["activity"].values(), default=1)
    bars = []
    for index, bucket in enumerate(buckets):
        count = stats["activity"][bucket]
        height = 100 * count / peak
        label = bucket if yearly or index % 5 == 0 or index == len(buckets) - 1 else ""
        bars.append(f'<div class="bar" title="{bucket}: {count} games">'
                    f'<span style="height:{height:.2f}%"></span><small>{label}</small></div>')

    def tile(label, value):
        return f'<div class="tile"><strong>{value}</strong><span>{label}</span></div>'

    def rows(items):
        return "".join(f"<li>{escape(label)}<strong>{count:,}</strong></li>"
                       for label, count in items) or "<li>—</li>"

    tiles = "".join([tile("Games played", f'{stats["total"]:,}'),
                     tile("Win rate", f'{stats["win_rate"]}%' if stats["total"] else "—"),
                     tile("Best win streak", stats["longest"])])
    results = rows((name, stats["outcomes"][name]) for name in ("Wins", "Losses", "Draws"))
    formats = rows(stats["formats"].most_common())
    ratings = rows(sorted(stats["ratings"].items()))
    empty = "<p>No standard games with a recorded result in this period.</p>" if not stats["total"] else ""
    template = Path(__file__).with_name("report.html").read_text(encoding="utf-8")
    return Template(template).substitute(username=escape(username), period=period, mode=mode,
                                         tiles=tiles, bars="".join(bars), results=results,
                                         formats=formats, ratings=ratings, source=source, empty=empty,
                                         highlights=render_highlights(start, end, stats),
                                         performance=render_performance(stats["performance"]))


def write_report(path, contents):
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as temp:
        temporary_path = Path(temp.name)
        temp.write(contents)
    try:
        temporary_path.replace(path)
    finally:
        temporary_path.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("username", nargs="?", help="Public Chess.com username")
    parser.add_argument("--demo", action="store_true", help="Generate sample reports offline")
    parser.add_argument("--archive", action="append", type=Path, metavar="JSON",
                        help="Read a saved Chess.com monthly archive (repeat for more months)")
    parser.add_argument("--month", type=date.fromisoformat, metavar="YYYY-MM-01",
                        help="Choose a month using its first day")
    parser.add_argument("--scheduled", action="store_true",
                        help="Use the previous completed month and calendar year")
    parser.add_argument("--output", type=Path, default=Path("reports"))
    args = parser.parse_args()
    username = args.username or ("Knightshift" if args.demo else "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", username):
        parser.error("Enter a Chess.com username with letters, digits, underscores or hyphens.")
    if args.month and (args.scheduled or args.month.day != 1 or args.month.year == 9999):
        parser.error("--month needs the first day of a month and cannot be combined with --scheduled.")

    if args.demo and args.archive:
        parser.error("Choose either --demo or --archive.")

    today = datetime.now(timezone.utc).date()
    month_start = args.month or today.replace(day=1)
    if args.scheduled:
        month_start = (month_start - timedelta(days=1)).replace(day=1)
    year = today.year - 1 if args.scheduled else month_start.year
    month_end = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
    periods = [(month_start, month_end, month_start.strftime("%Y-%m")),
               (date(year, 1, 1), date(year + 1, 1, 1), str(year))]
    months = {f"{year}/{number:02}" for number in range(1, 13)} | {month_key(month_start)}
    try:
        if args.demo:
            source = "Sample data"
            games = demo_games(username, months)
        elif args.archive:
            source = "Imported Chess.com archives"
            games = []
            for archive in args.archive:
                payload = json.loads(archive.read_text(encoding="utf-8"))
                if not isinstance(payload, dict) or not isinstance(payload.get("games"), list):
                    raise ValueError(f"{archive} needs a JSON object with a games list.")
                games.extend(payload["games"])
        else:
            source = "Chess.com public archives"
            games = load_games(username, months)
        for start, end, label in periods:
            report = render(username, start, end, summarize(games, username, start, end), source)
            prefix = "demo-" if args.demo else ""
            path = args.output / f"{prefix}{username.lower()}-{label}.html"
            write_report(path, report)
            print(path)
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.exit(1, f"Chess Wrapped: {error}\n")


if __name__ == "__main__":
    main()
