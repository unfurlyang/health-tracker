'use strict';

/* ============================================================
 * 轻量 SVG 折线图组件（零依赖）
 *
 * renderLineChart(container, {
 *   dates:  ['YYYY-MM-DD', ...],            // x 轴，按出现顺序均分
 *   series: [{ name, color, values:[...] }],// values 与 dates 等长，缺失传 null（断线）
 *   unit:   'kg',
 *   emptyText: '暂无数据'
 * })
 * ============================================================ */

function niceTicks(min, max, count) {
  count = count || 4;
  if (!isFinite(min) || !isFinite(max) || min > max) return [];
  if (min === max) { min -= 1; max += 1; }
  const step0 = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  let step;
  if (norm <= 1) step = 1;
  else if (norm <= 2) step = 2;
  else if (norm <= 2.5) step = 2.5;
  else if (norm <= 5) step = 5;
  else step = 10;
  step *= mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
    ticks.push(+v.toFixed(6));
  }
  return ticks;
}

function fmtTick(t) {
  if (Math.abs(t) >= 1000) {
    const v = t / 1000;
    return (Number.isInteger(v) ? v : +v.toFixed(1)) + 'k';
  }
  return String(+(t.toFixed(2)));
}

function shortDate(d) {
  return typeof d === 'string' && d.length >= 10 ? d.slice(5) : d;
}

function hexToRgba(hex, a) {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

function pathFor(values, xf, yf) {
  let d = '', pen = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null || !isFinite(v)) { pen = false; continue; }
    d += (pen ? ' L' : ' M') + xf(i).toFixed(1) + ' ' + yf(v).toFixed(1);
    pen = true;
  }
  return d.trim();
}

function renderLineChart(el, opts) {
  if (!el) return;
  const dates = opts.dates || [];
  const series = opts.series || [];
  const unit = opts.unit || '';
  el.innerHTML = '';

  let anyVal = false;
  series.forEach(function (s) {
    (s.values || []).forEach(function (v) {
      if (v != null && isFinite(v)) anyVal = true;
    });
  });
  if (!anyVal || dates.length === 0) {
    el.innerHTML = '<div class="chart-empty"><span>' + (opts.emptyText || '暂无数据') + '</span></div>';
    return;
  }
  if (el.clientWidth < 60) return; // 容器不可见时跳过，切页时会重绘

  const W = Math.max(el.clientWidth, 280);
  const H = Math.max(el.clientHeight, 200);
  const padL = 48, padR = 14, padT = 16, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = dates.length;
  const xf = function (i) { return padL + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1)); };

  let vMin = Infinity, vMax = -Infinity;
  series.forEach(function (s) {
    (s.values || []).forEach(function (v) {
      if (v != null && isFinite(v)) { vMin = Math.min(vMin, v); vMax = Math.max(vMax, v); }
    });
  });
  if (vMin === vMax) { vMin -= 1; vMax += 1; }
  let ticks = niceTicks(vMin, vMax, 4);
  if (ticks.length < 2) ticks = [vMin, vMax];
  const aMin = Math.min(vMin, ticks[0]);
  const aMax = Math.max(vMax, ticks[ticks.length - 1]);
  const yf = function (v) { return padT + plotH * (1 - (v - aMin) / (aMax - aMin)); };

  const p = [];
  p.push('<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">');

  // 网格与 y 轴标签
  ticks.forEach(function (t) {
    const y = yf(t);
    p.push('<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#e5eef0" stroke-width="1"/>');
    p.push('<text x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" class="tick-label">' + fmtTick(t) + '</text>');
  });

  // x 轴日期标签（最多 6 个）
  const stepX = Math.max(1, Math.ceil((n - 1) / 5));
  const seen = {};
  for (let i = 0; i < n; i += stepX) seen[i] = true;
  seen[n - 1] = true;
  Object.keys(seen).forEach(function (k) {
    const i = +k;
    p.push('<text x="' + xf(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="tick-label">' + shortDate(dates[i]) + '</text>');
  });

  // 面积填充（仅单条且无断点时）
  if (series.length === 1) {
    const vals = series[0].values || [];
    const noGap = vals.every(function (v) { return v != null && isFinite(v); });
    if (noGap && n > 1) {
      const gid = 'grad' + Math.random().toString(36).slice(2, 8);
      p.push('<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="' + series[0].color + '" stop-opacity=".22"/>' +
        '<stop offset="100%" stop-color="' + series[0].color + '" stop-opacity="0"/>' +
        '</linearGradient></defs>');
      let area = 'M' + xf(0).toFixed(1) + ' ' + yf(aMin).toFixed(1);
      vals.forEach(function (v, i) { area += ' L' + xf(i).toFixed(1) + ' ' + yf(v).toFixed(1); });
      area += ' L' + xf(n - 1).toFixed(1) + ' ' + yf(aMin).toFixed(1) + ' Z';
      p.push('<path d="' + area + '" fill="url(#' + gid + ')"/>');
    }
  }

  // 折线
  series.forEach(function (s) {
    const d = pathFor(s.values || [], xf, yf);
    if (d) p.push('<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>');
  });

  // 数据点（点较少时显示圆点）
  if (n <= 40) {
    series.forEach(function (s) {
      (s.values || []).forEach(function (v, i) {
        if (v == null || !isFinite(v)) return;
        p.push('<circle cx="' + xf(i).toFixed(1) + '" cy="' + yf(v).toFixed(1) + '" r="3.2" fill="' + s.color + '" stroke="#fff" stroke-width="1.4"/>');
      });
    });
  }

  // 悬停参考线
  p.push('<line class="chart-guide" x1="0" y1="' + padT + '" x2="0" y2="' + (H - padB) + '" stroke="#94a3b8" stroke-dasharray="4 4" visibility="hidden"/>');
  p.push('</svg>');
  p.push('<div class="chart-tip" style="display:none"></div>');
  el.innerHTML = p.join('');

  // ---- 悬停交互 ----
  const svg = el.querySelector('svg');
  const tip = el.querySelector('.chart-tip');
  const guide = el.querySelector('.chart-guide');
  svg.addEventListener('mousemove', function (ev) {
    const rect = svg.getBoundingClientRect();
    const scale = W / rect.width;
    const mx = (ev.clientX - rect.left) * scale;
    let i = Math.round(((mx - padL) / (plotW || 1)) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    const gx = xf(i);
    guide.setAttribute('x1', gx.toFixed(1));
    guide.setAttribute('x2', gx.toFixed(1));
    guide.setAttribute('visibility', 'visible');

    const rows = series.map(function (s) {
      const v = (s.values || [])[i];
      const shown = v == null || !isFinite(v) ? '—' : (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('zh-CN') : v) + (unit ? ' ' + unit : '');
      return '<div class="tip-row"><span class="tip-dot" style="background:' + s.color + '"></span>' + s.name + '：<b>' + shown + '</b></div>';
    }).join('');
    tip.innerHTML = '<div class="tip-date">' + dates[i] + '</div>' + rows;
    tip.style.display = 'block';
    const leftPx = Math.max(4, gx / scale + (gx / W > 0.6 ? -tip.offsetWidth - 12 : 12));
    tip.style.left = leftPx + 'px';
  });
  svg.addEventListener('mouseleave', function () {
    tip.style.display = 'none';
    guide.setAttribute('visibility', 'hidden');
  });
}
