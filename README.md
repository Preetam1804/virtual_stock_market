# Virtual Stock Market

A paper-trading simulator: five tickers, prices that move every second, a portfolio
that marks to market in real time, and a leaderboard — served as a modern web
dashboard **and** as the original C terminal client, both reading and writing the
same text files.

```
$ npm install
$ npm start
➜  http://localhost:3000
```

Sign in with one of the seeded accounts, or create your own (every new account
starts with **10,000** in play money).

| username  | password   |
| --------- | ---------- |
| `preetam` | `pree180`  |
| `prateek` | `102010`   |
| `rakesh`  | `1122334`  |
| `rahitya` | `rahi11`   |

---

## What it looks like

- **Landing page** — split hero with an animated live chart, and a glass sign-in /
  sign-up card with a password-strength meter.
- **Dashboard** — net worth with a count-up animation and its own sparkline, cash /
  holdings / unrealised P/L cards, a large interactive chart with **Live / 1D / 1W /
  1M** ranges and a candlestick toggle, market movers, an allocation donut, and a
  live-updating positions table.
- **Market** — every listed ticker with price, change, sparkline and a session
  range bar; click a row to chart it. Below it, daily candlesticks reconstructed
  from the historical trend files.
- **Portfolio** — net worth, day P/L, cost basis, an order blotter, and the
  leaderboard ranked by net worth.

Every price on screen updates once a second over Server-Sent Events, and cells
flash green or red as they move.

## Design notes

The visual language is a dark "trading terminal" theme: layered glass panels on a
field of slowly drifting colour orbs, a monospace numeric face (JetBrains Mono) so
figures stay tabular and aligned, cyan-to-violet gradients for brand moments, and
mint/rose for gains and losses. Motion is used to explain change — numbers tween
between values, lines draw themselves in, cards rise on load — and it all collapses
gracefully on small screens and under `prefers-reduced-motion`.

There are **no frontend dependencies**. The charts (area/line, sparkline, donut,
candlesticks with volume), the modals, the toasts and the ticker are all hand-written
SVG and CSS; the only npm package is `express`.

## Architecture

```
server.js               express bootstrap + static hosting
src/
  config.js             paths, ticker definitions, simulation constants
  lib/
    market.js           price engine (mean-reverting random walk) + SSE emitter
    store.js            users.txt / portfolio.txt read + write, JSON sidecars
    trends.js           parses stock_trend_of_*.txt into daily OHLC candles
    auth.js             scrypt password hashing, sessions, cookie handling
  routes/api.js         the whole JSON API
public/
  index.html
  css/styles.css        design system
  js/charts.js          dependency-free SVG chart kit
  js/app.js             state, rendering, streaming, trade flows
virtual_stock_market.c  the original terminal client (unchanged)
```

### The price engine

Each ticker is a **mean-reverting random walk**. A slowly drifting "fair value"
anchor produces multi-minute trends, a Gaussian shock supplies per-second jitter,
and a pull term keeps prices tethered to the anchor:

```
anchor *= 1 + gaussian() * 0.0009
price  += gaussian() * volatility * price * 0.35   # noise
       +  (anchor - price) * 0.02                  # mean reversion
```

Prices are seeded from the last close in each ticker's trend file, so the live
market picks up where the recorded history stops. The session opens there too, so
the day's change starts at 0.00% and evolves from real activity rather than
appearing pre-moved.

### Data files (shared with the C client)

| File                        | Format                                   |
| --------------------------- | ---------------------------------------- |
| `users.txt`                 | `username fullname password balance`     |
| `portfolio.txt`             | `username balance APL:2,AMZN:1`          |
| `stock_trend_of_<SYM>.txt`  | `price DD-MM-YYYY`, one sample per line  |

The web server never breaks these formats, so you can trade in the browser and then
open the terminal client and see the same portfolio. Empty portfolios are normalised
to `None`, and any account in `users.txt` without a portfolio row gets one on boot.

Web-only extras live in `data/` (git-ignored): `auth.json` (password hashes),
`cost_basis.json` (weighted-average purchase price per position) and `trades.json`
(the order blotter). Deleting `data/` costs you nothing but P/L history.

## API

| Method | Endpoint                | Notes                                        |
| ------ | ----------------------- | -------------------------------------------- |
| `POST` | `/api/auth/signup`      | creates an account with 10,000 cash          |
| `POST` | `/api/auth/login`       | sets an httpOnly session cookie              |
| `POST` | `/api/auth/logout`      |                                              |
| `GET`  | `/api/auth/me`          | current user + portfolio                     |
| `GET`  | `/api/market`           | snapshot of every ticker + the VSM-5 index   |
| `GET`  | `/api/market/stream`    | SSE: `init` then a `tick` event per second   |
| `GET`  | `/api/market/:symbol`   | live series + daily candles from the trend file |
| `GET`  | `/api/portfolio`        | positions, P/L, allocation                   |
| `POST` | `/api/trade/buy`        | `{ symbol, quantity }`                       |
| `POST` | `/api/trade/sell`       | `{ symbol, quantity }`                       |
| `POST` | `/api/deposit`          | `{ amount }`                                 |
| `GET`  | `/api/activity`         | your orders + the global tape                |
| `GET`  | `/api/leaderboard`      | ranked by net worth                          |

Orders fill instantly at the current price. Quantities must be positive whole
numbers, buys are rejected when cash is short, sells when you don't hold the shares.

## Security notes

This is a simulator, but it does handle credentials, so:

- Passwords are hashed with **scrypt** and verified in constant time. Because the C
  client compares plaintext with `strcmp`, hashes are kept in `data/auth.json` and
  an existing plaintext account is upgraded to a hash the first time it signs in
  through the browser. Delete `data/auth.json` and the terminal client works as
  before.
- Sessions are random 256-bit tokens in httpOnly, SameSite=Lax cookies, expiring
  after 12 hours.
- All input is validated server-side; file writes go through a temp file and rename.
- Passwords still live in plaintext in `users.txt` for C interop. If you deploy this
  anywhere real, drop the C client and store hashes in the users file.

## The C client

`virtual_stock_market.c` is untouched and still builds on Windows (`conio.h`) —
run it from the repo root so it finds the data files:

```
> gcc virtual_stock_market.c -o virtual_stock_market
> virtual_stock_market
```

It offers login, sign-up, portfolio, buy, sell, deposit, an ASCII real-time graph
and an ASCII trend chart. Its `fix_empty_portfolios()` normalisation is now also
performed by the server on boot, so both clients agree on the file layout.

## Known data quirk

The seed account `akash` carries a negative balance and a huge APL position — a
leftover integer overflow from the C client, which lets a balance wrap past
`INT_MAX`. The data is left exactly as found rather than silently rewritten, so
that account sits at the top of the leaderboard. Delete the two `akash` lines from
`users.txt` and `portfolio.txt` if you'd rather start clean.

## Ideas from here

- Limit orders and a real order book instead of instant fills
- More tickers driven by generated history, plus sector filtering
- Net-worth history persisted server-side so the sparkline survives a reload
- A SQLite/Postgres store behind the same `store.js` interface
