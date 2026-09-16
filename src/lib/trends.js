'use strict';

/**
 * Reads the historical `stock_trend_of_<SYMBOL>.txt` files written for the C
 * client and turns them into daily OHLC candles the dashboard can chart.
 *
 * File format: one `price DD-MM-YYYY` sample per line, in arbitrary order.
 */

const fs = require('fs');
const config = require('../config');

const cache = new Map();

function parseDate(text) {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text || '');
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  return {
    date: `${yyyy}-${mm}-${dd}`,
    iso: `${yyyy}-${mm}-${dd}`,
    day: Number(dd),
    month: Number(mm),
    year: Number(yyyy),
    time: Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)),
    label: `${dd}-${mm}-${yyyy}`
  };
}

function toCandle(day, samples) {
  const open = samples[0];
  const close = samples[samples.length - 1];
  return {
    ...day,
    open,
    high: Math.max(...samples),
    low: Math.min(...samples),
    close,
    // The files have no volume; sample density is a decent stand-in.
    volume: samples.length,
    samples: samples.slice()
  };
}

/**
 * @returns {{symbol: string, days: Array, samples: number, hasData: boolean}}
 */
function loadTrend(symbol) {
  const cached = cache.get(symbol);
  if (cached) return cached;

  let byDay = new Map();
  try {
    const raw = fs.readFileSync(config.trendFile(symbol), 'utf8');
    for (const line of raw.split('\n')) {
      const text = line.trim();
      if (!text) continue;
      const match = text.match(/^(-?\d+(?:\.\d+)?)\s+(\d{2}-\d{2}-\d{4})$/);
      if (!match) continue;
      const price = Number.parseFloat(match[1]);
      const date = parseDate(match[2]);
      if (!Number.isFinite(price) || !date) continue;

      if (!byDay.has(date.iso)) byDay.set(date.iso, { date, prices: [] });
      byDay.get(date.iso).prices.push(price);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const days = [...byDay.values()]
    .sort((a, b) => a.date.time - b.date.time)
    .filter((d) => d.prices.length)
    .map((d) => toCandle(d.date, d.prices));

  const result = {
    symbol,
    days,
    samples: days.reduce((sum, d) => sum + d.samples.length, 0),
    hasData: days.length > 0
  };

  cache.set(symbol, result);
  return result;
}

/** The most recent traded price in the historical file, if any. */
function lastHistoricalPrice(symbol) {
  const trend = loadTrend(symbol);
  if (!trend.days.length) return null;
  return trend.days[trend.days.length - 1].close;
}

/** Opening price of the most recent day -> used as the "previous close". */
function lastSessionOpen(symbol) {
  const trend = loadTrend(symbol);
  if (!trend.days.length) return null;
  return trend.days[trend.days.length - 1].open;
}

function clearCache() {
  cache.clear();
}

module.exports = { loadTrend, lastHistoricalPrice, lastSessionOpen, clearCache };
