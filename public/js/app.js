/* ============================================================
   Virtual Stock Market — dashboard app
   ============================================================ */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const state = {
    user: null,
    portfolio: null,
    stocks: [],
    index: null,
    selected: 'APL',
    range: 'live',
    candleMode: false,
    view: 'dashboard',
    histSymbol: 'APL',
    histDays: 7,
    liveSeries: {},        // symbol -> number[]
    history: {},           // symbol -> { days, hasData }
    sort: { key: 'changePct', dir: -1 },
    netWorthTrail: []
  };

  /* ------------------------------------------------------------------ */
  /* Formatting                                                          */
  /* ------------------------------------------------------------------ */
  const nf = new Intl.NumberFormat('en-US');
  const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const money = (n) => `$${nf.format(Math.round(n || 0))}`;
  const price = (n) => `$${nf2.format(n || 0)}`;
  const compact = (n) => {
    const abs = Math.abs(n);
    if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (abs >= 1e4) return `$${(n / 1e3).toFixed(1)}K`;
    return `$${nf.format(Math.round(n))}`;
  };
  const signed = (n, fmt = (x) => nf2.format(x)) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))}`;
  const pct = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`;
  const dirClass = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
  const pillClass = (n) => (n > 0 ? 'pill pill--up' : n < 0 ? 'pill pill--down' : 'pill pill--neutral');

  function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  /* ------------------------------------------------------------------ */
  /* API                                                                 */
  /* ------------------------------------------------------------------ */
  /** Called when the server no longer recognises our session. */
  function sessionExpired() {
    if (state.sessionLost) return;
    state.sessionLost = true;
    toast('Session expired', 'Reloading to sign you back in…', 'info');
    setTimeout(() => location.reload(), 1400);
  }

  async function api(path, options = {}) {
    const res = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      ...options
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.startsWith('/auth/')) sessionExpired();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  /* ------------------------------------------------------------------ */
  /* Small UI helpers                                                    */
  /* ------------------------------------------------------------------ */
  function flash(el, direction) {
    if (!el) return;
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth; // restart the animation
    el.classList.add(direction >= 0 ? 'flash-up' : 'flash-down');
  }

  function setValue(el, value, fmt = money, animate = false) {
    if (!el) return;
    const prev = Number(el.dataset.value);
    el.dataset.value = value;
    const next = fmt(value);

    if (animate && Number.isFinite(prev) && prev !== value && Math.abs(value - prev) > 0.5) {
      const start = performance.now();
      const dur = 520;
      const from = prev;
      const step = (now) => {
        const t = Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = fmt(from + (value - from) * eased);
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    } else {
      el.textContent = next;
    }

    if (Number.isFinite(prev) && prev !== value) flash(el, value - prev);
  }

  function toast(title, msg, kind = 'ok') {
    const icons = { ok: '✅', err: '⚠️', info: '💡' };
    const el = document.createElement('div');
    el.className = `toast toast--${kind}`;
    el.innerHTML = `<span class="toast__icon">${icons[kind] || icons.info}</span>
      <div><div class="toast__title">${title}</div>${msg ? `<div class="toast__msg">${msg}</div>` : ''}</div>`;
    $('#toasts').appendChild(el);
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 350);
    }, 4200);
  }

  function openModal(html) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-backdrop"><div class="modal">${html}</div></div>`;
    const backdrop = $('.modal-backdrop', root);
    const close = () => {
      backdrop.style.animation = 'fade .2s ease reverse both';
      setTimeout(() => (root.innerHTML = ''), 180);
    };
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });
    $('.modal__close', root)?.addEventListener('click', close);
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') {
        close();
        document.removeEventListener('keydown', onEsc);
      }
    });
    $('.modal', root).querySelector('input, button:not(.modal__close)')?.focus();
    return { root, close };
  }

  /* ================================================================== */
  /* AUTH                                                                */
  /* ================================================================== */
  let authSparkTimer = null;

  function initAuth() {
    const glider = $('.tabs__glider');
    $$('[data-auth-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.authTab;
        $$('[data-auth-tab]').forEach((b) => b.classList.toggle('is-active', b === btn));
        glider.classList.toggle('is-right', tab === 'signup');
        $('#login-form').classList.toggle('is-hidden', tab !== 'login');
        $('#signup-form').classList.toggle('is-hidden', tab !== 'signup');
      });
    });

    $$('[data-peek]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.peek);
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.textContent = show ? 'Hide' : 'Show';
      });
    });

    $$('[data-demo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const passwords = { preetam: 'pree180', prateek: '102010', rakesh: '1122334' };
        $('#login-username').value = btn.dataset.demo;
        $('#login-password').value = passwords[btn.dataset.demo] || '';
        $('#login-username').dispatchEvent(new Event('input', { bubbles: true }));
        $('#login-password').dispatchEvent(new Event('input', { bubbles: true }));
      });
    });

    const meter = $('#pw-meter');
    $('#signup-password').addEventListener('input', (e) => {
      const v = e.target.value;
      const score = Math.min(4, (v.length >= 4 ? 1 : 0) + (v.length >= 8 ? 1 : 0) + (/[A-Z]/.test(v) ? 1 : 0) + (/[0-9]|\W/.test(v) ? 1 : 0));
      const colors = ['#fb7185', '#fb7185', '#fbbf24', '#34d399', '#22d3ee'];
      meter.style.width = `${(score / 4) * 100}%`;
      meter.style.background = colors[score];
    });

    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = $('[data-error-for="login"]');
      errEl.textContent = '';
      const payload = {
        username: $('#login-username').value.trim(),
        password: $('#login-password').value
      };
      try {
        const data = await api('/auth/login', { method: 'POST', body: JSON.stringify(payload) });
        enterApp(data);
      } catch (err) {
        errEl.textContent = err.message;
        $('.auth__card').classList.add('shake');
        setTimeout(() => $('.auth__card').classList.remove('shake'), 420);
      }
    });

    $('#signup-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = $('[data-error-for="signup"]');
      errEl.textContent = '';
      const payload = {
        username: $('#signup-username').value.trim(),
        fullname: $('#signup-fullname').value.trim(),
        password: $('#signup-password').value
      };
      try {
        const data = await api('/auth/signup', { method: 'POST', body: JSON.stringify(payload) });
        enterApp(data);
        toast('Account created', `Welcome to the floor — you start with ${money(10000)}.`, 'ok');
      } catch (err) {
        errEl.textContent = err.message;
        $('.auth__card').classList.add('shake');
        setTimeout(() => $('.auth__card').classList.remove('shake'), 420);
      }
    });

    // Animated mini-chart on the landing page.
    const host = $('#auth-spark');
    if (host) {
      let seed = 1000;
      const values = Array.from({ length: 48 }, () => (seed += (Math.random() - 0.46) * 22));
      Charts.sparkline(host, values, { color: '#22d3ee' });
      authSparkTimer = setInterval(() => {
        seed += (Math.random() - 0.46) * 22;
        values.push(seed);
        values.shift();
        Charts.sparkline(host, values, { color: seed >= values[0] ? '#22d3ee' : '#fb7185' });
      }, 1400);
    }
  }

  /* ================================================================== */
  /* BOOT                                                                */
  /* ================================================================== */
  function enterApp({ user, portfolio }) {
    if (authSparkTimer) clearInterval(authSparkTimer); // landing page animation
    state.user = user;
    state.portfolio = portfolio;
    $('#auth').classList.add('is-hidden');
    $('#app').classList.remove('is-hidden');

    $('#user-name').textContent = user.fullname;
    $('#user-avatar').textContent = (user.fullname || user.username).charAt(0).toUpperCase();

    initAppChrome();
    loadAll();
    connectStream();
  }

  function initAppChrome() {
    $$('.nav__btn').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
    $$('[data-goto]').forEach((btn) =>
      btn.addEventListener('click', () => switchView(btn.dataset.goto))
    );
    $('#logout-btn').addEventListener('click', async () => {
      await api('/auth/logout', { method: 'POST' }).catch(() => {});
      location.reload();
    });
    $('#deposit-btn').addEventListener('click', openDeposit);
    $('#chart-buy').addEventListener('click', () => openTrade('buy'));
    $('#chart-sell').addEventListener('click', () => openTrade('sell'));
    $('#candle-toggle').addEventListener('click', () => {
      state.candleMode = !state.candleMode;
      $('#candle-toggle').classList.toggle('is-active', state.candleMode);
      renderChart();
    });
    $$('[data-range]').forEach((btn) =>
      btn.addEventListener('click', () => {
        state.range = btn.dataset.range;
        $$('[data-range]').forEach((b) => b.classList.toggle('is-active', b === btn));
        $('#chart-range-label').textContent = { live: 'Live tape', '1d': 'Last session', '1w': 'Last 7 sessions', '1m': 'Full history' }[state.range];
        renderChart();
      })
    );
    $$('[data-hist]').forEach((btn) =>
      btn.addEventListener('click', () => {
        state.histDays = Number(btn.dataset.hist);
        $$('[data-hist]').forEach((b) => b.classList.toggle('is-active', b === btn));
        renderHistory();
      })
    );

    // Pointer-tracked glow on glass panels.
    document.addEventListener('pointermove', (e) => {
      const panel = e.target.closest?.('.panel');
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      panel.style.setProperty('--mx', `${e.clientX - rect.left}px`);
      panel.style.setProperty('--my', `${e.clientY - rect.top}px`);
    });
  }

  function switchView(view) {
    state.view = view;
    $$('.nav__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
    $$(`.view`).forEach((v) => v.classList.toggle('is-active', v.dataset.view === view));
    if (view === 'portfolio') refreshPortfolioSide();
    if (view === 'market') renderHistory();
    if (view === 'dashboard') renderChart();
  }

  async function loadAll() {
    try {
      const market = await api('/market');
      applySnapshot(market.stocks);
      state.index = market.index;
      renderSymbolChips();
      renderAll();
    } catch (err) {
      toast('Market offline', err.message, 'err');
    }
    refreshPortfolioSide();
  }

  /* ================================================================== */
  /* Streaming                                                           */
  /* ================================================================== */
  function connectStream() {
    const es = new EventSource('/api/market/stream');

    es.addEventListener('init', (ev) => {
      const data = JSON.parse(ev.data);
      applySnapshot(data.stocks);
      state.index = data.index;
      renderAll();
    });

    es.addEventListener('tick', (ev) => {
      const data = JSON.parse(ev.data);
      applySnapshot(data.stocks);
      state.index = data.index;
      renderLive();
    });

    es.onerror = () => {
      // EventSource retries on its own; just surface it once.
      const pill = $('#index-pill');
      if (pill && !pill.dataset.warned) {
        pill.dataset.warned = '1';
        toast('Reconnecting…', 'Lost the live feed, retrying.', 'info');
      }
    };
  }

  function applySnapshot(stocks) {
    state.stocks = stocks;
    for (const s of stocks) {
      const series = state.liveSeries[s.symbol] || (state.liveSeries[s.symbol] = s.spark ? s.spark.slice() : []);
      if (series[series.length - 1] !== s.price) {
        series.push(s.price);
        if (series.length > 240) series.shift();
      }
    }
  }

  const stockOf = (sym) => state.stocks.find((s) => s.symbol === sym);

  /** Cheap recompute of derived portfolio numbers from the new prices. */
  function recomputePortfolio() {
    const p = state.portfolio;
    if (!p) return;
    let holdings = 0;
    let day = 0;
    for (const pos of p.positions) {
      const q = stockOf(pos.symbol);
      if (!q) continue;
      pos.price = q.price;
      pos.value = Math.round(q.price * pos.quantity * 100) / 100;
      pos.changePct = q.changePct;
      pos.dayChange = Math.round((q.price - q.prevClose) * pos.quantity * 100) / 100;
      if (pos.costBasis != null) {
        pos.unrealised = Math.round((pos.value - pos.costBasis) * 100) / 100;
        pos.unrealisedPct = pos.costBasis ? Math.round(((pos.value - pos.costBasis) / pos.costBasis) * 10000) / 100 : 0;
      }
      holdings += pos.value;
      day += pos.dayChange;
    }
    p.holdingsValue = Math.round(holdings * 100) / 100;
    p.netWorth = Math.round((p.cash + holdings) * 100) / 100;
    p.dayChange = Math.round(day * 100) / 100;
    p.dayChangePct = p.netWorth - day ? Math.round((day / (p.netWorth - day)) * 10000) / 100 : 0;
    const priced = p.positions.filter((pos) => pos.costBasis != null);
    p.invested = Math.round(priced.reduce((s, pos) => s + pos.costBasis, 0) * 100) / 100;
    p.unrealised = priced.length ? Math.round(priced.reduce((s, pos) => s + pos.unrealised, 0) * 100) / 100 : null;
    p.unrealisedPct = p.unrealised !== null && p.invested ? Math.round((p.unrealised / p.invested) * 10000) / 100 : null;
    p.allocation = p.positions.map((pos) => ({
      symbol: pos.symbol,
      color: pos.color,
      value: pos.value,
      pct: p.netWorth ? Math.round((pos.value / p.netWorth) * 10000) / 100 : 0
    }));
  }

  /* ================================================================== */
  /* Rendering                                                           */
  /* ================================================================== */
  function renderAll() {
    renderIndex();
    renderStats();
    renderTicker();
    renderMovers();
    renderMarketTable();
    renderPositions();
    renderAllocation();
    renderChart();
    renderHistory();
  }

  /** Everything that changes on every 1s tick. */
  function renderLive() {
    recomputePortfolio();
    renderIndex();
    renderStats();
    updateTicker();
    updateMovers();
    updateMarketTable();
    updatePositions();
    updateQuote();
    if (state.view === 'dashboard' && state.range === 'live') renderChart({ animate: false });
    if (state.view === 'portfolio') renderPortfolioStats();
  }

  function renderIndex() {
    const idx = state.index;
    if (!idx) return;
    $('#index-value').textContent = nf2.format(idx.value);
    const d = $('#index-delta');
    d.textContent = pct(idx.changePct);
    d.className = `index-pill__delta mono ${dirClass(idx.changePct)}`;
  }

  function renderStats() {
    const p = state.portfolio;
    if (!p) return;

    setValue($('#networth-value'), p.netWorth, money, true);
    setValue($('#cash-value'), p.cash, money);
    setValue($('#holdings-value'), p.holdingsValue, money);

    // P/L is unknown for holdings opened in the C client (no purchase record).
    const plEl = $('#pl-value');
    if (p.unrealised == null) {
      plEl.textContent = '—';
      plEl.classList.remove('up', 'down');
      plEl.dataset.value = '';
    } else {
      setValue(plEl, p.unrealised, (n) => signed(n, (x) => nf.format(Math.round(x))));
    }

    const delta = $('#networth-delta');
    delta.textContent = `${pct(p.dayChangePct)} today`;
    delta.className = pillClass(p.dayChangePct);

    $('#pl-caption').textContent =
      p.unrealised == null
        ? p.positions.length
          ? 'No purchase price on file for these holdings'
          : 'Buy something to start tracking'
        : `${pct(p.unrealisedPct)} on ${money(p.invested)} invested`;

    $('#holdings-caption').textContent = p.positions.length
      ? `${p.positions.length} position${p.positions.length > 1 ? 's' : ''} · ${money(p.dayChange)} today`
      : 'No open positions';

    $('#user-networth').textContent = money(p.netWorth);
    $('#networth-caption').textContent = `${money(p.cash)} cash available`;

    state.netWorthTrail.push(p.netWorth);
    if (state.netWorthTrail.length > 70) state.netWorthTrail.shift();
    if (!$('#networth-spark').dataset.ready) {
      Charts.sparkline($('#networth-spark'), state.netWorthTrail, { color: '#22d3ee' });
      $('#networth-spark').dataset.ready = '1';
    } else if (state.netWorthTrail.length > 3) {
      Charts.sparkline($('#networth-spark'), state.netWorthTrail, {
        color: p.netWorth >= state.netWorthTrail[0] ? '#22d3ee' : '#a78bfa'
      });
    }
  }

  function renderSymbolChips() {
    const host = $('#symbol-chips');
    host.innerHTML = '';
    for (const s of state.stocks) {
      const btn = document.createElement('button');
      btn.className = `seg__btn${s.symbol === state.selected ? ' is-active' : ''}`;
      btn.textContent = s.symbol;
      btn.style.color = s.symbol === state.selected ? s.color : '';
      btn.addEventListener('click', () => {
        state.selected = s.symbol;
        renderSymbolChips();
        updateQuote();
        renderChart();
        renderMovers();
      });
      host.appendChild(btn);
    }
    $('#chart-buy-sym').textContent = state.selected;
    $('#chart-sell-sym').textContent = state.selected;
  }

  function tickerItems() {
    return state.stocks
      .map(
        (s) => `<div class="ticker__item" data-ticker="${s.symbol}">
          <span class="ticker__sym" style="color:${s.color}">${s.symbol}</span>
          <span class="ticker__price" data-field="price">${price(s.price)}</span>
          <span class="ticker__delta ${dirClass(s.changePct)}" data-field="delta">${pct(s.changePct)}</span>
        </div>`
      )
      .join('');
  }

  function renderTicker() {
    const items = tickerItems();
    $('#ticker-track').innerHTML = items + items;
  }

  function updateTicker() {
    for (const el of $$('[data-ticker]')) {
      const s = stockOf(el.dataset.ticker);
      if (!s) continue;
      const priceEl = $('[data-field="price"]', el);
      const deltaEl = $('[data-field="delta"]', el);
      if (priceEl.textContent !== price(s.price)) flash(priceEl, s.price - s.prevClose);
      priceEl.textContent = price(s.price);
      deltaEl.textContent = pct(s.changePct);
      deltaEl.className = `ticker__delta ${dirClass(s.changePct)}`;
    }
  }

  function updateQuote() {
    const s = stockOf(state.selected);
    if (!s) return;
    $('#chart-badge').textContent = s.symbol;
    $('#chart-badge').style.color = s.color;
    $('#chart-badge').style.borderColor = `${s.color}55`;
    $('#chart-name').textContent = s.name;
    $('#chart-sector').textContent = s.sector;
    $('#chart-price').textContent = price(s.price);
    const ch = $('#chart-change');
    ch.textContent = `${signed(s.change)} (${pct(s.changePct)})`;
    ch.className = pillClass(s.changePct);

    const owned = state.portfolio?.positions.find((p) => p.symbol === s.symbol)?.quantity || 0;
    $('#quote-stats').innerHTML = `
      <div><dt>Open</dt><dd>${price(s.open)}</dd></div>
      <div><dt>Session range</dt><dd>${price(s.low)} – ${price(s.high)}</dd></div>
      <div><dt>Prev close</dt><dd>${price(s.prevClose)}</dd></div>
      <div><dt>Your shares</dt><dd>${nf.format(owned)}</dd></div>`;
  }

  function renderMovers() {
    const host = $('#movers');
    const sorted = [...state.stocks].sort((a, b) => b.changePct - a.changePct);
    host.innerHTML = sorted
      .map(
        (s) => `<li><button class="mover${s.symbol === state.selected ? ' is-active' : ''}" data-mover="${s.symbol}">
          <span class="sym">
            <span class="sym__dot" style="background:${s.color}"></span>
            <span class="sym__text"><strong>${s.symbol}</strong><small>${s.name}</small></span>
          </span>
          <span class="mover__spark" data-spark="${s.symbol}"></span>
          <span class="mover__delta ${dirClass(s.changePct)}" data-field="delta">${pct(s.changePct)}</span>
        </button></li>`
      )
      .join('');

    $$('[data-mover]', host).forEach((btn) =>
      btn.addEventListener('click', () => {
        state.selected = btn.dataset.mover;
        renderSymbolChips();
        updateQuote();
        renderChart();
        renderMovers();
      })
    );

    for (const s of state.stocks) {
      Charts.sparkline($(`[data-spark="${s.symbol}"]`, host), state.liveSeries[s.symbol] || s.spark, { color: s.color });
    }
  }

  function updateMovers() {
    for (const el of $$('[data-mover]')) {
      const s = stockOf(el.dataset.mover);
      if (!s) continue;
      const deltaEl = $('[data-field="delta"]', el);
      deltaEl.textContent = pct(s.changePct);
      deltaEl.className = `mover__delta ${dirClass(s.changePct)}`;
      const sparkEl = $('[data-spark]', el);
      if (sparkEl) Charts.sparkline(sparkEl, state.liveSeries[s.symbol] || s.spark, { color: s.color });
    }
  }

  function renderMarketTable() {
    const rows = sortStocks(state.stocks);
    const tbody = $('#market-table tbody');
    tbody.innerHTML = rows
      .map((s) => {
        const owned = state.portfolio?.positions.find((p) => p.symbol === s.symbol)?.quantity || 0;
        const position = ((s.price - s.low) / Math.max(1e-9, s.high - s.low)) * 100;
        return `<tr data-row="${s.symbol}">
          <td><span class="sym">
            <span class="sym__dot" style="background:${s.color}"></span>
            <span class="sym__text"><strong>${s.symbol}</strong><small>${s.name} · ${s.sector}</small></span>
          </span></td>
          <td class="num" data-field="price">${price(s.price)}</td>
          <td class="num ${dirClass(s.changePct)}" data-field="delta">${pct(s.changePct)}</td>
          <td class="hide-sm"><span class="mover__spark" data-mspark="${s.symbol}" style="width:110px"></span></td>
          <td class="hide-sm">
            <div class="range">
              <div class="range__track"><span class="range__fill" style="width:${position}%"></span><span class="range__pin" data-field="pin" style="left:${position}%"></span></div>
              <div class="range__labels"><span data-field="low">${nf.format(s.low)}</span><span data-field="high">${nf.format(s.high)}</span></div>
            </div>
          </td>
          <td class="num hide-sm" data-field="owned">${owned ? nf.format(owned) : '—'}</td>
          <td><div class="row-actions">
            <button class="btn btn--buy btn--sm" data-buy="${s.symbol}">Buy</button>
            <button class="btn btn--sell btn--sm" data-sell="${s.symbol}">Sell</button>
          </div></td>
        </tr>`;
      })
      .join('');

    $$('[data-buy]', tbody).forEach((b) => b.addEventListener('click', () => openTrade('buy', b.dataset.buy)));
    $$('[data-sell]', tbody).forEach((b) => b.addEventListener('click', () => openTrade('sell', b.dataset.sell)));
    $$('tr[data-row]', tbody).forEach((tr) =>
      tr.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        state.selected = tr.dataset.row;
        state.histSymbol = tr.dataset.row;
        renderSymbolChips();
        updateQuote();
        renderChart();
        renderHistory();
        renderMovers();
      })
    );

    for (const s of state.stocks) {
      const el = $(`[data-mspark="${s.symbol}"]`, tbody);
      if (el) Charts.sparkline(el, state.liveSeries[s.symbol] || s.spark, { color: s.color });
    }

    wireSort();
  }

  function wireSort() {
    $$('#market-table th.is-sortable').forEach((th) => {
      const key = th.dataset.sort;
      th.classList.toggle('is-sorted', state.sort.key === key);
      $('span', th).textContent = state.sort.key === key ? (state.sort.dir === 1 ? '▲' : '▼') : '↕';
      th.onclick = () => {
        state.sort =
          state.sort.key === key ? { key, dir: -state.sort.dir } : { key, dir: key === 'symbol' ? 1 : -1 };
        renderMarketTable();
      };
    });
  }

  function updateMarketTable() {
    for (const tr of $$('#market-table tbody tr[data-row]')) {
      const s = stockOf(tr.dataset.row);
      if (!s) continue;
      const p = $('[data-field="price"]', tr);
      if (p.textContent !== price(s.price)) flash(p, s.change);
      p.textContent = price(s.price);
      const d = $('[data-field="delta"]', tr);
      d.textContent = pct(s.changePct);
      d.className = `num ${dirClass(s.changePct)}`;
      const pin = $('[data-field="pin"]', tr);
      const fill = $('.range__fill', tr);
      const position = ((s.price - s.low) / Math.max(1e-9, s.high - s.low)) * 100;
      if (pin) pin.style.left = `${position}%`;
      if (fill) fill.style.width = `${position}%`;
      $('[data-field="low"]', tr).textContent = nf.format(s.low);
      $('[data-field="high"]', tr).textContent = nf.format(s.high);
      const spark = $('[data-mspark]', tr);
      if (spark) Charts.sparkline(spark, state.liveSeries[s.symbol] || s.spark, { color: s.color });
    }
  }

  function sortStocks(list) {
    const { key, dir } = state.sort;
    return [...list].sort((a, b) => {
      const av = key === 'symbol' ? a.symbol : a[key];
      const bv = key === 'symbol' ? b.symbol : b[key];
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }

  function renderPositions() {
    const p = state.portfolio;
    if (!p) return;
    const tbody = $('#positions-table tbody');
    const rows = p.positions
      .map((pos) => {
        const weight = p.netWorth ? (pos.value / p.netWorth) * 100 : 0;
        return `<tr data-pos="${pos.symbol}">
          <td><span class="sym">
            <span class="sym__dot" style="background:${pos.color}"></span>
            <span class="sym__text"><strong>${pos.symbol}</strong><small>${pos.name}</small></span>
          </span></td>
          <td class="num">${nf.format(pos.quantity)}</td>
          <td class="num">${pos.avgCost == null ? '—' : price(pos.avgCost)}</td>
          <td class="num" data-field="price">${price(pos.price)}</td>
          <td class="num" data-field="value">${money(pos.value)}</td>
          <td class="num ${dirClass(pos.changePct)}" data-field="day">${pct(pos.changePct)}</td>
          <td class="num ${dirClass(pos.unrealised ?? 0)}" data-field="pl">${
            pos.unrealised == null ? '—' : `${signed(pos.unrealised, (x) => nf.format(Math.round(x)))} (${pct(pos.unrealisedPct || 0)})`
          }</td>
          <td class="num">
            <div class="range" style="min-width:80px">
              <div class="range__track"><span class="range__fill" style="width:${weight}%"></span></div>
            </div>
          </td>
          <td><div class="row-actions">
            <button class="btn btn--buy btn--sm" data-buy="${pos.symbol}">Buy</button>
            <button class="btn btn--sell btn--sm" data-sell="${pos.symbol}">Sell</button>
          </div></td>
        </tr>`;
      })
      .join('');
    tbody.innerHTML = rows;

    $$('[data-buy]', tbody).forEach((b) => b.addEventListener('click', () => openTrade('buy', b.dataset.buy)));
    $$('[data-sell]', tbody).forEach((b) => b.addEventListener('click', () => openTrade('sell', b.dataset.sell)));

    $('#positions-empty').classList.toggle('is-visible', p.positions.length === 0);
    $('#positions-table').style.display = p.positions.length ? '' : 'none';
    $('#positions-hint').textContent = p.positions.length
      ? `${p.positions.length} open · ${money(p.holdingsValue)} at market`
      : 'no open positions';
  }

  function updatePositions() {
    const p = state.portfolio;
    if (!p) return;
    for (const tr of $$('#positions-table tbody tr[data-pos]')) {
      const pos = p.positions.find((x) => x.symbol === tr.dataset.pos);
      if (!pos) continue;
      const weight = p.netWorth ? (pos.value / p.netWorth) * 100 : 0;
      $('[data-field="price"]', tr).textContent = price(pos.price);
      $('[data-field="value"]', tr).textContent = money(pos.value);
      const day = $('[data-field="day"]', tr);
      day.textContent = pct(pos.changePct);
      day.className = `num ${dirClass(pos.changePct)}`;
      const pl = $('[data-field="pl"]', tr);
      pl.textContent = pos.unrealised == null ? '—' : `${signed(pos.unrealised, (x) => nf.format(Math.round(x)))} (${pct(pos.unrealisedPct || 0)})`;
      pl.className = `num ${dirClass(pos.unrealised ?? 0)}`;
      const fill = $('.range__fill', tr);
      if (fill) fill.style.width = `${weight}%`;
    }
  }

  function renderAllocation() {
    const p = state.portfolio;
    if (!p) return;
    const cash = Math.max(0, p.cash);
    const segments = [
      ...p.allocation.filter((a) => a.value > 0),
      ...(cash > 0 ? [{ symbol: 'CASH', color: '#64748b', value: cash, pct: 0 }] : [])
    ];
    const total = segments.reduce((s, x) => s + x.value, 0);
    for (const seg of segments) seg.pct = total ? (seg.value / total) * 100 : 0;

    Charts.donut($('#donut-host'), segments, { centerValue: compact(total), centerLabel: 'Net worth' });

    $('#allocation-legend').innerHTML = segments
      .map(
        (s) => `<li class="alloc-row">
          <span class="alloc-row__swatch" style="background:${s.color}"></span>
          <span class="alloc-row__name">${s.symbol}${s.symbol === 'CASH' ? ' <small style="color:var(--dim)">idle</small>' : ''}</span>
          <span class="alloc-row__pct">${s.pct.toFixed(1)}%</span>
        </li>`
      )
      .join('') || '<li class="alloc-row"><span class="alloc-row__name" style="color:var(--dim)">Nothing allocated yet</span></li>';

    $('#allocation-hint').textContent = `${segments.length} bucket${segments.length === 1 ? '' : 's'}`;
  }

  /* ------------------------------------------------------------------ */
  /* Charts                                                              */
  /* ------------------------------------------------------------------ */
  let liveChart = null;

  async function ensureHistory(symbol) {
    if (state.history[symbol]) return state.history[symbol];
    try {
      const data = await api(`/market/${symbol}`);
      state.history[symbol] = data.history;
      const series = state.liveSeries[symbol];
      if (data.live?.prices?.length > series.length) state.liveSeries[symbol] = data.live.prices.slice();
      return data.history;
    } catch {
      return { days: [], hasData: false };
    }
  }

  function dailyCandles(days) {
    return days.map((d) => ({ o: d.open, h: d.high, l: d.low, c: d.close, volume: d.volume }));
  }

  function renderChart(opts = {}) {
    const symbol = state.selected;
    const s = stockOf(symbol);
    const host = $('#chart-host');
    if (!s) return;
    updateQuote();

    const fmtY = (n) => nf2.format(n);
    const draw = () => {
      if (state.range === 'live') {
        const values = state.liveSeries[symbol] || s.spark || [];
        if (state.candleMode) {
          const candlesFromTicks = buildLiveCandles(values);
          Charts.candles(host, candlesFromTicks, { formatY: fmtY, labels: candlesFromTicks.map((_, i) => `t-${candlesFromTicks.length - i}`) });
          return;
        }
        if (!liveChart || liveChart.__symbol !== symbol || liveChart.__range !== 'live') {
          liveChart = Charts.area(host, {
            values,
            color: s.color,
            formatY: fmtY,
            animate: opts.animate !== false,
            labels: []
          });
          liveChart.__symbol = symbol;
          liveChart.__range = 'live';
        } else {
          liveChart.update({ values, color: s.color, animate: false });
        }
        return;
      }

      // Historical ranges come from the trend files.
      ensureHistory(symbol).then((history) => {
        const days = history.days || [];
        if (!days.length) {
          host.innerHTML = '<div class="empty is-visible"><span class="empty__icon">📉</span><p>No historical data for this ticker.</p></div>';
          return;
        }
        const slice = state.range === '1d' ? days.slice(-1) : state.range === '1w' ? days.slice(-7) : days;
        const labels = slice.map((d) => d.label.slice(0, 5));

        if (state.range === '1d') {
          const samples = slice[0].samples;
          Charts.area(host, { values: samples, color: s.color, formatY: fmtY, labels: samples.map((_, i) => `#${i + 1}`), animate: true });
          return;
        }

        if (state.candleMode) {
          Charts.candles(host, dailyCandles(slice), { formatY: fmtY, labels });
        } else {
          Charts.area(host, { values: slice.map((d) => d.close), color: s.color, formatY: fmtY, labels, animate: true });
        }
      });
    };

    draw();
  }

  function buildLiveCandles(values) {
    const size = 6;
    const out = [];
    for (let i = 0; i < values.length; i += size) {
      const chunk = values.slice(i, i + size);
      if (chunk.length < 2) continue;
      out.push({ o: chunk[0], h: Math.max(...chunk), l: Math.min(...chunk), c: chunk[chunk.length - 1], volume: chunk.length });
    }
    return out.slice(-40);
  }

  function renderHistory() {
    const symbol = state.selected;
    const s = stockOf(symbol);
    if (!s) return;
    $('#hist-badge').textContent = symbol;
    $('#hist-badge').style.color = s.color;
    $('#hist-name').textContent = s.name;
    $('.chart-panel__sub', $('#hist-host').closest('.panel')).innerHTML =
      `Daily candles from <code>stock_trend_of_${symbol}.txt</code>`;

    ensureHistory(symbol).then((history) => {
      const days = history.days || [];
      const slice = state.histDays ? days.slice(-state.histDays) : days;
      Charts.candles($('#hist-host'), dailyCandles(slice), {
        formatY: (n) => nf2.format(n),
        labels: slice.map((d) => d.label.slice(0, 5))
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Portfolio tab                                                       */
  /* ------------------------------------------------------------------ */
  function renderPortfolioStats() {
    const p = state.portfolio;
    if (!p) return;
    setValue($('#pf-networth'), p.netWorth, money, true);
    setValue($('#pf-day'), p.dayChange, (n) => signed(n, (x) => nf.format(Math.round(x))));
    $('#pf-day').classList.toggle('up', p.dayChange > 0);
    $('#pf-day').classList.toggle('down', p.dayChange < 0);
    setValue($('#pf-invested'), p.invested, money);
    $('#pf-positions').textContent = String(p.positions.length);
    $('#pf-sectors').textContent = [...new Set(p.positions.map((x) => x.sector))].join(' · ') || 'diversify a little';
  }

  async function refreshPortfolioSide() {
    try {
      const [portfolio, activity, board] = await Promise.all([
        api('/portfolio'),
        api('/activity'),
        api('/leaderboard')
      ]);
      state.portfolio = portfolio;
      renderPortfolioStats();
      renderPositions();
      renderAllocation();
      renderFeed(activity.mine);
      renderLeaderboard(board);
    } catch (err) {
      toast('Could not load portfolio', err.message, 'err');
    }
  }

  function renderFeed(trades) {
    const host = $('#feed');
    if (!trades.length) {
      host.innerHTML = '<li class="empty is-visible"><span class="empty__icon">🧾</span><p>No orders yet.</p></li>';
      return;
    }
    host.innerHTML = trades
      .map((t) => {
        const amount = t.side === 'DEPOSIT' ? `+${money(t.total)}` : `${t.side === 'BUY' ? '−' : '+'}${money(t.total)}`;
        const cls = t.side === 'BUY' ? 'down' : 'up';
        return `<li class="feed__item">
          <span class="feed__badge feed__badge--${t.side}">${t.side === 'DEPOSIT' ? '₵' : t.side === 'BUY' ? 'B' : 'S'}</span>
          <span class="feed__body">
            <strong>${t.side === 'DEPOSIT' ? 'Cash deposit' : `${t.side === 'BUY' ? 'Bought' : 'Sold'} ${t.quantity} × ${t.symbol}`}</strong>
            <small>@ ${price(t.price)} · ${timeAgo(t.ts)}</small>
          </span>
          <span class="feed__amount ${cls}">${amount}</span>
        </li>`;
      })
      .join('') +
      (trades.length
        ? '<li style="padding:8px 4px 2px;color:var(--dim);font-size:.74rem;text-align:center">Showing your most recent orders</li>'
        : '');
  }

  function renderLeaderboard(board) {
    $('#lb-hint').textContent = `${board.total} trader${board.total === 1 ? '' : 's'}`;
    const rows = board.rows.length ? board.rows : [];
    const me = board.me;
    if (me && !rows.some((r) => r.isMe)) rows.push(me);

    $('#leaderboard').innerHTML = rows
      .map(
        (r) => `<li class="lb-row${r.isMe ? ' is-me' : ''}">
          <span class="lb-rank">${r.rank}</span>
          <span class="lb-name"><strong>${r.fullname}${r.isMe ? ' <small>(you)</small>' : ''}</strong><small>@${r.username} · ${r.positions} position${r.positions === 1 ? '' : 's'}</small></span>
          <span class="lb-value"><strong>${money(r.netWorth)}</strong><small class="${dirClass(r.dayChangePct)}">${pct(r.dayChangePct)}</small></span>
        </li>`
      )
      .join('') || '<li class="empty is-visible"><p>Nobody here yet.</p></li>';
  }

  /* ================================================================== */
  /* Trade + deposit modals                                              */
  /* ================================================================== */
  function openTrade(side = 'buy', symbol = state.selected) {
    const s = stockOf(symbol);
    const pos = state.portfolio?.positions.find((p) => p.symbol === symbol);
    const owned = pos?.quantity || 0;
    const cash = state.portfolio?.cash || 0;
    const isBuy = side === 'buy';

    const modal = openModal(`
      <div class="modal__head">
        <h3>${isBuy ? 'Buy' : 'Sell'} ${symbol}</h3>
        <button class="modal__close" aria-label="Close">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:.85rem;color:var(--muted)">
        <span>${s.name}</span>
        <span class="mono" id="trade-price">${price(s.price)}</span>
      </div>
      <div class="qty">
        <button class="qty__btn" data-step="-1">−</button>
        <input id="qty-input" type="number" min="1" step="1" value="1" />
        <button class="qty__btn" data-step="1">+</button>
      </div>
      <div class="qty-presets">
        <button data-qty="1">1</button><button data-qty="5">5</button>
        <button data-qty="10">10</button><button data-qty="max">Max</button>
      </div>
      <div class="order-summary">
        <div class="order-row"><span>${isBuy ? 'Available cash' : 'Shares owned'}</span><span id="trade-avail">${isBuy ? money(cash) : nf.format(owned)}</span></div>
        <div class="order-row"><span>Order value</span><span id="trade-total">${money(s.price)}</span></div>
        <div class="order-row"><span>After the trade</span><span id="trade-after">—</span></div>
        <div class="order-row order-row--total"><span>${isBuy ? 'Total cost' : 'You receive'}</span><span id="trade-grand">${money(s.price)}</span></div>
      </div>
      <p class="form__error" id="trade-error" style="margin-top:10px"></p>
      <div class="modal__foot">
        <button class="btn btn--ghost" id="trade-cancel">Cancel</button>
        <button class="btn ${isBuy ? 'btn--buy' : 'btn--sell'}" id="trade-confirm">${isBuy ? 'Buy' : 'Sell'} ${symbol}</button>
      </div>
    `);

    const input = $('#qty-input', modal.root);
    const errEl = $('#trade-error', modal.root);

    function maxQty() {
      return isBuy ? Math.floor(cash / s.price) : owned;
    }

    function sync() {
      const qty = Math.max(0, Math.floor(Number(input.value) || 0));
      const total = qty * s.price;
      $('#trade-total', modal.root).textContent = money(total);
      $('#trade-grand', modal.root).textContent = money(total);
      $('#trade-after', modal.root).textContent = isBuy
        ? `${money(cash - total)} cash`
        : `${nf.format(Math.max(0, owned - qty))} shares left`;
      $(`#trade-confirm`, modal.root).textContent = `${isBuy ? 'Buy' : 'Sell'} ${qty || 0} ${symbol}`;

      const over = qty > maxQty();
      $('#trade-confirm', modal.root).disabled = !qty || over;
      if (over) errEl.textContent = isBuy
        ? `You can afford ${maxQty()} share${maxQty() === 1 ? '' : 's'} at ${price(s.price)}.`
        : `You only hold ${owned} share${owned === 1 ? '' : 's'}.`;
      else errEl.textContent = '';
    }

    input.addEventListener('input', sync);
    $$('[data-step]', modal.root).forEach((b) =>
      b.addEventListener('click', () => {
        input.value = Math.max(1, (Number(input.value) || 0) + Number(b.dataset.step));
        sync();
      })
    );
    $$('[data-qty]', modal.root).forEach((b) =>
      b.addEventListener('click', () => {
        input.value = b.dataset.qty === 'max' ? Math.max(1, maxQty()) : b.dataset.qty;
        sync();
      })
    );
    $('#trade-cancel', modal.root).addEventListener('click', modal.close);

    $('#trade-confirm', modal.root).addEventListener('click', async () => {
      const qty = Math.floor(Number(input.value) || 0);
      const btn = $('#trade-confirm', modal.root);
      btn.disabled = true;
      btn.textContent = 'Working…';
      try {
        const data = await api(`/trade/${side}`, { method: 'POST', body: JSON.stringify({ symbol, quantity: qty }) });
        state.portfolio = data.portfolio;
        modal.close();
        toast(
          `${isBuy ? 'Bought' : 'Sold'} ${qty} × ${symbol}`,
          `${isBuy ? 'Cost' : 'Proceeds'} ${money(data.filled.total)} @ ${price(data.filled.price)}`,
          'ok'
        );
        renderStats();
        renderPositions();
        renderAllocation();
        renderMarketTable();
        updateQuote();
        refreshPortfolioSide();
      } catch (err) {
        errEl.textContent = err.message;
        btn.disabled = false;
        sync();
      }
    });

    sync();
  }

  function openDeposit() {
    const cash = state.portfolio?.cash || 0;
    const modal = openModal(`
      <div class="modal__head">
        <h3>Add play money</h3>
        <button class="modal__close" aria-label="Close">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <p style="font-size:.86rem;color:var(--muted);line-height:1.6">
        Top up your paper balance. Nothing here touches real money — it just moves
        a number in <code>users.txt</code>.
      </p>
      <div class="qty-presets" style="margin-top:14px">
        <button data-amt="1000">+1K</button><button data-amt="5000">+5K</button>
        <button data-amt="10000">+10K</button><button data-amt="25000">+25K</button>
      </div>
      <div class="qty" style="grid-template-columns:1fr">
        <input id="dep-amount" type="number" min="1" step="100" value="5000" />
      </div>
      <div class="order-summary">
        <div class="order-row"><span>Current cash</span><span>${money(cash)}</span></div>
        <div class="order-row order-row--total"><span>New balance</span><span id="dep-new">${money(cash + 5000)}</span></div>
      </div>
      <p class="form__error" id="dep-error" style="margin-top:10px"></p>
      <div class="modal__foot">
        <button class="btn btn--ghost" id="dep-cancel">Cancel</button>
        <button class="btn btn--primary" id="dep-confirm">Deposit</button>
      </div>
    `);

    const input = $('#dep-amount', modal.root);
    const sync = () => {
      const amt = Math.max(0, Math.floor(Number(input.value) || 0));
      $('#dep-new', modal.root).textContent = money(cash + amt);
      $('#dep-confirm', modal.root).disabled = amt <= 0;
    };
    input.addEventListener('input', sync);
    $$('[data-amt]', modal.root).forEach((b) =>
      b.addEventListener('click', () => {
        input.value = b.dataset.amt;
        sync();
      })
    );
    $('#dep-cancel', modal.root).addEventListener('click', modal.close);
    $('#dep-confirm', modal.root).addEventListener('click', async () => {
      const amount = Math.floor(Number(input.value) || 0);
      try {
        const data = await api('/deposit', { method: 'POST', body: JSON.stringify({ amount }) });
        state.portfolio = data.portfolio;
        modal.close();
        toast('Deposit complete', `${money(amount)} added — new balance ${money(data.portfolio.cash)}.`, 'ok');
        renderStats();
        renderPositions();
        renderAllocation();
        refreshPortfolioSide();
      } catch (err) {
        $('#dep-error', modal.root).textContent = err.message;
      }
    });
    sync();
  }

  /* ================================================================== */
  /* Start                                                               */
  /* ================================================================== */
  initAuth();

  api('/auth/me')
    .then((data) => enterApp(data))
    .catch(() => {
      $('#auth').classList.remove('is-hidden');
    });
})();
