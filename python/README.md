# Chess Wrapped

A Python app for turning a public Chess.com username into monthly and yearly chess reports. It uses only the Python 3.10+ standard library.

## Run it

```sh
python chess_wrapped.py --demo
python chess_wrapped.py YOUR_CHESS_COM_USERNAME
python chess_wrapped.py YOUR_CHESS_COM_USERNAME --month 2026-10-01
```

Open the paths printed in your terminal. Each HTML file contains its own styles and can be shared as an attachment or printed to PDF from your browser. The default run creates a report for the current UTC month and one for the current year. An explicit month uses that month's year. Charts count completed standard chess games with recognized results. Peak ratings come from rated games within the reporting period and are grouped by time control.

If you have saved Chess.com monthly archive responses, pass them in using `--archive october.json --archive november.json`. The reports cover only the games in the supplied files. The public archive directory for a player is at `https://api.chess.com/pub/player/USERNAME/games/archives`.

## Automate it

Run the following from any shell to generate the last completed UTC month and calendar year. The files use stable names, so repeat runs refresh the same periods.

```sh
python chess_wrapped.py YOUR_CHESS_COM_USERNAME --scheduled
```

For a Unix machine with cron, add a line like this with `crontab -e`. Replace the username and paths with yours and use the absolute path returned by `command -v python3`. The example runs on the second day of every month at 06:15 in the scheduler's timezone. The machine needs to be on and able to reach Chess.com.

```cron
15 6 2 * * /usr/bin/python3 /absolute/path/chess_wrapped.py YOUR_USERNAME --scheduled --output /absolute/path/reports
```

## Learn the Python in three steps

1. **Read a dictionary.** Open `demo_games()` and find `player`. A dictionary stores values by key. `player["username"]` reads the username, and `player.get("rating")` returns the rating or `None` if the key is missing.
2. **Loop and count.** In `summarize()`, the `for` loop examines one game at a time. `continue` skips a game outside the date range or a chess variant. The first time `outcomes["Wins"] += 1` runs, the `Counter` starts that key at zero.
3. **Return a value and reuse it.** `summarize()` returns a dictionary, and `render()` uses it to build the report. The same calculation works for a month and a year because the caller supplies the start and end dates.

### Your first exercise

In `render()`, add a tile for draws after “Best win streak.” The label is `"Draws"` and the value comes from `stats["outcomes"]["Draws"]`. Adjust the `.tiles` grid in `report.html` to make room. Run the demo again and check that the tile agrees with the Results section.

### Next exercise

Add a draw-rate calculation to `summarize()`. Predict what the report should display for an empty month first. Then try 2 draws in 10 games and check that your code produces 20%.

### Read the opening repertoire code

Find `first_moves()` in `chess_wrapped.py`. It takes a PGN string and returns a pair: White's first move and Black's reply. In `summarize()`, the line `white_move, black_move = first_moves(...)` is called **tuple unpacking**. The two variables get their values from the two positions in the returned pair. A `Counter` counts each move or reply as you loop through the games.

Try adding `print(first_moves("1. e4 c5 2. Nf3"))` in a Python session after importing the function. Then try a missing game record with `first_moves(None)` and see how it handles missing moves.

### Read a head-to-head tally

Find `record_performance()` in `chess_wrapped.py`. Its rival dictionary is keyed by the opponent's case-folded username. Calling `setdefault()` gives you the existing matchup entry, or creates one with an empty `Counter`. The next line increments the counter for the current game's result. Try changing the capitalization of a demo opponent's name and check that both games still count toward the same matchup.

## Scope

The €9.99/year figure is a proposed subscription price. This version runs locally with public archive data and has no billing or hosted accounts.
