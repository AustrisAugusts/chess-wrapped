# Chess Wrapped

Chess Wrapped turns a public Chess.com account's game archives into monthly and yearly reports with rating charts, opening stats, head-to-head records, and replayable milestone games.

## Run the website

Use Python 3.10 or newer. From the extracted folder, run:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

On Windows, use `py -3` in place of `python` if needed. Open http://127.0.0.1:8000 in the browser on the same computer. The example reports work offline. Username lookup requires internet access to Chess.com's public API.

The browser app uses HTML, CSS, and JavaScript modules. There is no build step or external JavaScript package. The Python generator uses only the standard library, so there is nothing to install with pip.

## Run the Python report generator

From the extracted folder:

```sh
python python/chess_wrapped.py --demo
python python/chess_wrapped.py YOUR_CHESS_COM_USERNAME
```

Open the HTML files listed in the terminal. See [the Python guide](python/README.md) for scheduling, saved-archive imports, and coding exercises.

## Put it on GitHub

1. Extract the ZIP.
2. Open your repository on GitHub and choose **Add file → Upload files**.
3. Upload the extracted contents so that `index.html` and `README.md` are at the repository root, then commit them.
4. To host the browser app with GitHub Pages, choose your branch and **/ (root)** in **Settings → Pages**, if Pages is available for your repository. GitHub Pages visibility is separate from your existing private Chess Wrapped site.

## Source layout

- `index.html`, `app.js`, and `report.css` implement the browser interface and HTML export.
- `reports.js`, `highlights.js`, and `performance.js` load games, tally stats, and render reports.
- `python/` contains the command-line generator, its HTML template, and the learning guide.
- The other HTML files are the included sample reports.
