'use strict';

/**
 * Price simulation engine.
 *
 * A mean-reverting random walk per ticker: prices jitter every second but stay
 * tethered to a slowly drifting "fair value" anchor, so charts develop real
 * looking trends instead of the pure noise the original C client produced.
 */

const { EventEmitter } = require('events');
const config = require('../config');
const trends = require('./trends');

/** Standard normal via Box–Muller. */
function gaussian() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const round2 = (n) => Math.round(n * 100) / 100;

class Market extends EventEmitter {
  constructor() {
    super();
    this.state = new Map();
    this.timer = null;
    this.tickCount = 0;
    for (const stock of config.STOCKS) this.#seed(stock);
  }

  #seed(stock) {
    // Prefer the last price in the historical trend file so the live market
    // picks up exactly where the recorded history left off.
    const historical = trends.lastHistoricalPrice(stock.symbol);
    const open = trends.lastSessionOpen(stock.symbol);
    const start = historical ?? stock.base;

    const anchor = start;
    const price = start;

    // Back-fill a rolling window so charts are populated the moment a
    // browser connects instead of drawing from a single point.
    const history = [];
    let back = price;
    for (let i = 0; i < config.LIVE_WINDOW; i += 1) {
      back = clamp(back - gaussian() * stock.volatility * start * 0.35 + (anchor - back) * 0.02, start * 0.6, start * 1.6);
      history.push(round2(back));
    }
    history.reverse();
    history[history.length - 1] = round2(price);

    this.state.set(stock.symbol, {
      ...stock,
      anchor,
      price,
      // The live session opens where the recorded history ended, so the day's
      // change starts at 0.00% and evolves from there.
      prevClose: round2(start),
      open: round2(start),
      high: round2(price),
      low: round2(price),
      history,
      candles: [],
      buffer: []
    });
  }

  #finalise(symbol, t) {
    const s = this.state.get(symbol);
    if (!s.buffer.length) return;
    const prices = s.buffer;
    s.candles.push({
      t,
      o: prices[0],
      h: Math.max(...prices),
      l: Math.min(...prices),
      c: prices[prices.length - 1]
    });
    if (s.candles.length > 60) s.candles.shift();
    s.buffer = [];
  }

  tick() {
    const now = Date.now();
    this.tickCount += 1;

    for (const [symbol, s] of this.state) {
      // Fair value drifts slowly, producing multi-minute trends.
      s.anchor *= 1 + gaussian() * 0.0009;
      s.anchor = clamp(s.anchor, s.base * 0.55, s.base * 1.75);

      const shock = gaussian() * s.volatility * s.price * 0.35;
      const pull = (s.anchor - s.price) * 0.02;
      s.price = round2(Math.max(1, s.price + shock + pull));

      s.high = Math.max(s.high, s.price);
      s.low = Math.min(s.low, s.price);

      s.history.push(s.price);
      if (s.history.length > config.LIVE_WINDOW) s.history.shift();

      s.buffer.push(s.price);
      if (s.buffer.length >= config.CANDLE_TICKS) this.#finalise(symbol, now);
    }

    const snapshot = this.snapshot();
    this.emit('tick', { t: now, tick: this.tickCount, stocks: snapshot, index: this.index(snapshot) });
    return snapshot;
  }

  /** Equal-weighted index of all listed tickers, normalised to 1000. */
  index(snapshot = this.snapshot()) {
    const value = snapshot.reduce((sum, s) => sum + s.price / s.base, 0) / snapshot.length;
    const change = snapshot.reduce((sum, s) => sum + s.changePct, 0) / snapshot.length;
    return {
      symbol: 'VSM-5',
      value: round2(value * 1000),
      changePct: round2(change * 100) / 100
    };
  }

  price(symbol) {
    const s = this.state.get(symbol);
    return s ? s.price : null;
  }

  /** Full snapshot for the REST endpoint / initial page render. */
  snapshot() {
    return [...this.state.values()].map((s) => this.#describe(s));
  }

  /** Compact snapshot pushed over SSE (smaller payload, same shape). */
  #describe(s) {
    const change = round2(s.price - s.prevClose);
    return {
      symbol: s.symbol,
      name: s.name,
      sector: s.sector,
      color: s.color,
      price: s.price,
      base: s.base,
      prevClose: s.prevClose,
      change,
      changePct: s.prevClose ? round2((change / s.prevClose) * 10000) / 100 : 0,
      open: s.open,
      high: round2(s.high),
      low: round2(s.low),
      spark: s.history.slice(-60)
    };
  }

  /** Live series + candles for one ticker. */
  series(symbol, limit = config.LIVE_WINDOW) {
    const s = this.state.get(symbol);
    if (!s) return null;
    return {
      symbol,
      prices: s.history.slice(-limit),
      candles: s.candles.slice()
    };
  }

  start() {
    if (this.timer) return this;
    this.timer = setInterval(() => this.tick(), config.TICK_MS);
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return this;
  }
}

module.exports = { Market, gaussian };
