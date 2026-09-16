/* ============================================================
   Charts — tiny dependency-free SVG charting kit.

   Every renderer re-measures its host element and redraws, so charts
   stay crisp at any width (no viewBox stretching, no blurry strokes).
   ============================================================ */
(function (global) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';

  function svg(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  function measure(el) {
    const rect = el.getBoundingClientRect();
    return {
      w: Math.max(120, Math.round(rect.width || el.clientWidth || 320)),
      h: Math.max(80, Math.round(rect.height || el.clientHeight || 160))
    };
  }

  /** Catmull-Rom -> cubic bezier, with control points clamped to stop overshoot. */
  function smoothPath(pts, tension = 0.85) {
    if (pts.length === 0) return '';
    if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;

    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || pts[i + 1];

      const lo = Math.min(p1.y, p2.y);
      const hi = Math.max(p1.y, p2.y);
      const c1y = Math.max(lo, Math.min(hi, p1.y + ((p2.y - p0.y) / 6) * tension));
      const c2y = Math.max(lo, Math.min(hi, p2.y - ((p3.y - p1.y) / 6) * tension));
      const c1x = p1.x + ((p2.x - p0.x) / 6) * tension;
      const c2x = p2.x - ((p3.x - p1.x) / 6) * tension;

      d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
    }
    return d;
  }

  function linearPath(pts) {
    return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  }

  function extent(values) {
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min === Infinity) return [0, 1];
    if (min === max) return [min - 1, max + 1];
    return [min, max];
  }

  /** Rounded "nice" axis ticks. */
  function ticks(min, max, count) {
    const span = max - min || 1;
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
    const out = [];
    for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) out.push(Math.round(t * 1e6) / 1e6);
    return out;
  }

  function ensureTip(host) {
    let tip = host.querySelector('.chart-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tip';
      host.appendChild(tip);
    }
    return tip;
  }

  /** Watches the host element and re-renders when its box changes. */
  function observe(host, render) {
    if (typeof ResizeObserver === 'undefined') return;
    // A host can be re-rendered many times; drop the previous observer so they
    // don't pile up.
    if (host.__chartObserver) host.__chartObserver.disconnect();
    let frame = null;
    const ro = new ResizeObserver(() => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(render);
    });
    ro.observe(host);
    host.__chartObserver = ro;
  }

  /* ------------------------------------------------------------------ */
  /* Area / line chart                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * @param {HTMLElement} host
   * @param {object} opts
   *   values      number[]            – series to plot
   *   labels      string[]            – x-axis labels (optional)
   *   color       string              – accent
   *   formatY     (n)=>string         – y axis / tooltip value formatter
   *   formatTip   (n, i)=>string      – tooltip title formatter
   *   animate     boolean             – draw-in animation on first paint
   *   grid        boolean
   */
  function area(host, opts = {}) {
    let current = opts;
    let mounted = false;
    let geom = null;

    function render() {
      const { w, h } = measure(host);
      const values = (current.values || []).filter((v) => Number.isFinite(v));
      const labels = current.labels || [];
      const color = current.color || '#22d3ee';
      const fmtY = current.formatY || ((n) => n.toFixed(0));
      const fmtTip = current.formatTip || fmtY;
      const pad = { top: 14, right: 14, bottom: 24, left: 52 };

      host.innerHTML = '';
      if (values.length < 2) {
        host.innerHTML = '<div class="skeleton" style="height:100%;width:100%"></div>';
        return;
      }

      const plotW = w - pad.left - pad.right;
      const plotH = h - pad.top - pad.bottom;
      const [rawMin, rawMax] = extent(values);
      const padding = (rawMax - rawMin) * 0.12 || 1;
      const min = rawMin - padding;
      const max = rawMax + padding;

      const xAt = (i) => pad.left + (plotW * i) / (values.length - 1);
      const yAt = (v) => pad.top + plotH - ((v - min) / (max - min)) * plotH;

      const pts = values.map((v, i) => ({ x: xAt(i), y: yAt(v), v, i }));
      const root = svg('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}` });

      /* defs: gradient + glow */
      const defs = svg('defs');
      const gradId = `grad-${Math.random().toString(36).slice(2, 9)}`;
      const grad = svg('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' });
      grad.appendChild(svg('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': '0.34' }));
      grad.appendChild(svg('stop', { offset: '55%', 'stop-color': color, 'stop-opacity': '0.10' }));
      grad.appendChild(svg('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': '0' }));
      defs.appendChild(grad);
      root.appendChild(defs);

      /* grid + y labels */
      if (current.grid !== false) {
        const g = svg('g', { class: 'chart-grid' });
        const axis = svg('g', { class: 'chart-axis' });
        for (const t of ticks(min, max, 4)) {
          const y = yAt(t);
          if (y < pad.top - 2 || y > pad.top + plotH + 2) continue;
          g.appendChild(svg('line', { x1: pad.left, y1: y, x2: w - pad.right, y2: y }));
          const label = svg('text', { x: pad.left - 10, y: y + 3.5, 'text-anchor': 'end' });
          label.textContent = fmtY(t);
          axis.appendChild(label);
        }
        root.appendChild(g);
        root.appendChild(axis);
      }

      /* x labels */
      if (labels.length) {
        const axis = svg('g', { class: 'chart-axis' });
        const step = Math.max(1, Math.ceil(values.length / 6));
        for (let i = 0; i < values.length; i += step) {
          if (labels[i] === undefined) continue;
          const text = svg('text', { x: xAt(i), y: h - 7, 'text-anchor': i === 0 ? 'start' : 'middle' });
          text.textContent = labels[i];
          axis.appendChild(text);
        }
        root.appendChild(axis);
      }

      /* area + line */
      const lineD = current.smooth === false ? linearPath(pts) : smoothPath(pts);
      const areaD = `${lineD} L${pts[pts.length - 1].x},${pad.top + plotH} L${pts[0].x},${pad.top + plotH} Z`;
      root.appendChild(svg('path', { d: areaD, fill: `url(#${gradId})` }));

      const line = svg('path', { d: lineD, class: 'chart-line', stroke: color });
      if (current.animate && !mounted) {
        const len = Math.ceil(pts[pts.length - 1].x - pts[0].x + plotH);
        line.style.setProperty('--len', len);
        line.classList.add('chart-line--draw');
      }
      root.appendChild(line);

      /* live marker */
      const last = pts[pts.length - 1];
      const halo = svg('circle', { cx: last.x, cy: last.y, r: 4, fill: color, opacity: '0.5', class: 'chart-halo' });
      halo.style.color = color;
      root.appendChild(halo);
      const dot = svg('circle', { cx: last.x, cy: last.y, r: 4, fill: color, class: 'chart-dot' });
      dot.style.color = color;
      root.appendChild(dot);

      /* crosshair + tooltip */
      const cross = svg('line', { class: 'chart-cross', x1: 0, y1: pad.top, x2: 0, y2: pad.top + plotH, opacity: '0' });
      const focusDot = svg('circle', { r: 4.5, fill: '#fff', stroke: color, 'stroke-width': 2.5, opacity: '0' });
      root.appendChild(cross);
      root.appendChild(focusDot);

      const tip = ensureTip(host);
      const overlay = svg('rect', { x: pad.left, y: 0, width: plotW, height: h, fill: 'transparent', style: 'cursor:crosshair' });
      overlay.addEventListener('mousemove', (ev) => {
        const rect = root.getBoundingClientRect();
        const relX = ev.clientX - rect.left;
        const ratio = (relX - pad.left) / plotW;
        const idx = Math.round(Math.max(0, Math.min(1, ratio)) * (values.length - 1));
        const p = pts[idx];
        cross.setAttribute('x1', p.x);
        cross.setAttribute('x2', p.x);
        cross.setAttribute('opacity', '1');
        focusDot.setAttribute('cx', p.x);
        focusDot.setAttribute('cy', p.y);
        focusDot.setAttribute('opacity', '1');
        tip.innerHTML = `<strong>${fmtTip(values[idx], idx)}</strong>${
          labels[idx] ? `<div style="color:var(--dim);margin-top:2px">${labels[idx]}</div>` : ''
        }`;
        tip.style.left = `${p.x}px`;
        tip.style.top = `${p.y}px`;
        tip.classList.add('is-visible');
      });
      overlay.addEventListener('mouseleave', () => {
        cross.setAttribute('opacity', '0');
        focusDot.setAttribute('opacity', '0');
        tip.classList.remove('is-visible');
      });
      root.appendChild(overlay);

      host.appendChild(root);
      geom = { pts, pad, plotW, plotH };
      mounted = true;
    }

    render();
    observe(host, render);
    return {
      update(next) {
        current = { ...current, ...next, animate: false };
        render();
      },
      destroy() {
        host.innerHTML = '';
      },
      get geom() { return geom; }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Sparkline                                                           */
  /* ------------------------------------------------------------------ */

  function sparkline(host, values, opts = {}) {
    const color = opts.color || '#22d3ee';
    let current = values || [];

    function render() {
      const { w, h } = measure(host);
      host.innerHTML = '';
      const vals = current.filter((v) => Number.isFinite(v));
      if (vals.length < 2) return;

      const [min, max] = extent(vals);
      const span = max - min || 1;
      const pad = 3;
      const pts = vals.map((v, i) => ({
        x: pad + ((w - pad * 2) * i) / (vals.length - 1),
        y: pad + (h - pad * 2) - ((v - min) / span) * (h - pad * 2)
      }));

      const root = svg('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}` });
      const gradId = `spark-${Math.random().toString(36).slice(2, 9)}`;
      const defs = svg('defs');
      const grad = svg('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' });
      grad.appendChild(svg('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': '0.42' }));
      grad.appendChild(svg('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': '0' }));
      defs.appendChild(grad);
      root.appendChild(defs);

      const d = smoothPath(pts, 0.7);
      root.appendChild(svg('path', { d: `${d} L${pts[pts.length - 1].x},${h} L${pts[0].x},${h} Z`, fill: `url(#${gradId})` }));
      root.appendChild(svg('path', { d, fill: 'none', stroke: color, 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      root.appendChild(svg('circle', { cx: pts[pts.length - 1].x, cy: pts[pts.length - 1].y, r: 2.4, fill: color }));
      host.appendChild(root);
    }

    render();
    observe(host, render);
    return {
      update(next) {
        current = next;
        render();
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Donut                                                               */
  /* ------------------------------------------------------------------ */

  function donut(host, segments, opts = {}) {
    const size = Math.min(measure(host).w, measure(host).h) || 168;
    const radius = size / 2 - 12;
    const circumference = 2 * Math.PI * radius;
    const total = segments.reduce((sum, s) => sum + s.value, 0);

    host.innerHTML = '';
    const root = svg('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
    root.appendChild(
      svg('circle', {
        cx: size / 2, cy: size / 2, r: radius,
        fill: 'none', stroke: 'rgba(255,255,255,0.06)', 'stroke-width': 16
      })
    );

    let offset = 0;
    segments.forEach((seg, i) => {
      const share = total ? seg.value / total : 0;
      const len = Math.max(0, share * circumference - 2.5);
      const arc = svg('circle', {
        cx: size / 2, cy: size / 2, r: radius,
        fill: 'none', stroke: seg.color, 'stroke-width': 16, 'stroke-linecap': 'round',
        'stroke-dasharray': `${len} ${circumference - len}`,
        'stroke-dashoffset': -offset,
        transform: `rotate(-90 ${size / 2} ${size / 2})`,
        style: `transition: stroke-dasharray .6s var(--ease) ${i * 0.06}s, stroke-dashoffset .6s var(--ease) ${i * 0.06}s`
      });
      root.appendChild(arc);
      offset += share * circumference;
    });

    host.appendChild(root);

    const center = document.createElement('div');
    center.className = 'donut-center';
    center.innerHTML = `<strong>${opts.centerValue ?? ''}</strong><small>${opts.centerLabel || ''}</small>`;
    host.appendChild(center);
  }

  /* ------------------------------------------------------------------ */
  /* Candlesticks                                                        */
  /* ------------------------------------------------------------------ */

  function candles(host, candleList, opts = {}) {
    const { w, h } = measure(host);
    host.innerHTML = '';
    const list = (candleList || []).filter((c) => Number.isFinite(c.o) && Number.isFinite(c.c));
    if (!list.length) {
      host.innerHTML = '<div class="skeleton" style="height:100%;width:100%"></div>';
      return;
    }

    const fmtY = opts.formatY || ((n) => n.toFixed(0));
    const pad = { top: 14, right: 54, bottom: 24, left: 14 };
    const volH = Math.min(56, (h - pad.top - pad.bottom) * 0.22);
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom - volH;

    const lows = list.map((c) => Math.min(c.l, c.o, c.c));
    const highs = list.map((c) => Math.max(c.h, c.o, c.c));
    const min = Math.min(...lows);
    const max = Math.max(...highs);
    const span = max - min || 1;
    const loPad = span * 0.1;
    const yMin = min - loPad;
    const yMax = max + loPad;

    const slot = plotW / list.length;
    const bodyW = Math.max(3, Math.min(18, slot * 0.58));
    const xAt = (i) => pad.left + slot * (i + 0.5);
    const yAt = (v) => pad.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
    const maxVol = Math.max(...list.map((c) => c.volume || 1));

    const root = svg('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}` });

    const grid = svg('g', { class: 'chart-grid' });
    const axis = svg('g', { class: 'chart-axis' });
    for (const t of ticks(yMin, yMax, 4)) {
      const y = yAt(t);
      grid.appendChild(svg('line', { x1: pad.left, y1: y, x2: w - pad.right, y2: y }));
      const label = svg('text', { x: w - pad.right + 9, y: y + 3.5, 'text-anchor': 'start' });
      label.textContent = fmtY(t);
      axis.appendChild(label);
    }
    root.appendChild(grid);
    root.appendChild(axis);

    list.forEach((c, i) => {
      const rising = c.c >= c.o;
      const color = rising ? '#34d399' : '#fb7185';
      const x = xAt(i);
      const yO = yAt(c.o);
      const yC = yAt(c.c);
      const yH = yAt(c.h);
      const yL = yAt(c.l);

      root.appendChild(
        svg('line', { class: 'chart-candle-wick', x1: x, y1: yH, x2: x, y2: yL, stroke: color, opacity: '0.85' })
      );
      const top = Math.min(yO, yC);
      root.appendChild(
        svg('rect', {
          x: x - bodyW / 2, y: top, width: bodyW, height: Math.max(2, Math.abs(yC - yO)),
          fill: rising ? 'rgba(52,211,153,0.55)' : 'rgba(251,113,133,0.55)',
          stroke: color, 'stroke-width': 1.2, rx: Math.min(2.5, bodyW / 3)
        })
      );

      const vh = ((c.volume || 0) / maxVol) * (volH - 6);
      root.appendChild(
        svg('rect', {
          class: 'chart-vol',
          x: x - bodyW / 2, y: h - pad.bottom - vh, width: bodyW, height: Math.max(1, vh),
          fill: color, opacity: '0.22', rx: 1.5
        })
      );

      if (opts.labels && opts.labels[i] !== undefined) {
        const step = Math.max(1, Math.ceil(list.length / 8));
        if (i % step === 0) {
          const label = svg('text', { x, y: h - 7, 'text-anchor': 'middle', fill: '#5e6b85', 'font-size': 10, 'font-family': 'var(--mono)' });
          label.textContent = opts.labels[i];
          root.appendChild(label);
        }
      }
    });

    /* hover tooltip */
    const tip = ensureTip(host);
    const cross = svg('line', { class: 'chart-cross', x1: 0, y1: pad.top, x2: 0, y2: pad.top + plotH, opacity: '0' });
    root.appendChild(cross);
    const overlay = svg('rect', { x: pad.left, y: 0, width: plotW, height: h, fill: 'transparent', style: 'cursor:crosshair' });
    overlay.addEventListener('mousemove', (ev) => {
      const rect = root.getBoundingClientRect();
      const idx = Math.max(0, Math.min(list.length - 1, Math.floor((ev.clientX - rect.left - pad.left) / slot)));
      const c = list[idx];
      cross.setAttribute('x1', xAt(idx));
      cross.setAttribute('x2', xAt(idx));
      cross.setAttribute('opacity', '1');
      tip.innerHTML =
        `<strong>${fmtY(c.c)}</strong>` +
        `<div style="color:var(--dim);margin-top:3px;line-height:1.5">` +
        `O ${fmtY(c.o)} · H ${fmtY(c.h)} · L ${fmtY(c.l)}<br/>${opts.labels?.[idx] ?? ''}</div>`;
      tip.style.left = `${xAt(idx)}px`;
      tip.style.top = `${yAt(Math.max(c.o, c.c)) - 10}px`;
      tip.classList.add('is-visible');
    });
    overlay.addEventListener('mouseleave', () => {
      cross.setAttribute('opacity', '0');
      tip.classList.remove('is-visible');
    });
    root.appendChild(overlay);

    host.appendChild(root);
  }

  global.Charts = { area, sparkline, donut, candles, extent, smoothPath };
})(window);
