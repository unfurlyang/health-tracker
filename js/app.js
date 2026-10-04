'use strict';

/* ============================================================
 * 康记 · 个人健康记录
 * 数据仅保存在浏览器 localStorage，不上传任何服务器
 * ============================================================ */

const RECORDS_KEY = 'healthTracker.records.v1';
const SETTINGS_KEY = 'healthTracker.settings.v1';

const COLOR = {
  weight: '#0e9f8c',
  systolic: '#f97316',
  diastolic: '#3b82f6',
  heartRate: '#ec4899',
  sleep: '#6366f1',
  steps: '#22c55e'
};

let records = [];
let settings = { name: '', gender: 'female', age: null, height: null };
let editingId = null;
let currentTab = 'dashboard';
let trendRangeDays = 30;

/* ---------------- 工具函数 ---------------- */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad2 = (n) => String(n).padStart(2, '0');

function localDateStr(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
const todayStr = () => localDateStr(new Date());

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toast(msg, type) {
  const wrap = $('#toastWrap');
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'err' ? ' err' : '');
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => { t.remove(); }, 2600);
}

function debounce(fn, ms) {
  let timer = null;
  return function () {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

const num = (v) => (v === '' || v == null ? null : Number(v));
const okNum = (v) => v != null && isFinite(v);

/* ---------------- 数据存取 ---------------- */

function loadState() {
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    const arr = raw ? JSON.parse(raw) : null;
    if (Array.isArray(arr)) records = sanitizeRecords(arr);
  } catch (e) { records = []; }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    if (obj && typeof obj === 'object') settings = Object.assign(settings, obj);
  } catch (e) { /* 保持默认 */ }
}

function sanitizeRecords(arr) {
  const out = [];
  arr.forEach((r) => {
    if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return;
    out.push({
      id: typeof r.id === 'string' && r.id ? r.id : uid(),
      date: r.date,
      weight: okNum(r.weight) ? +r.weight : null,
      systolic: okNum(r.systolic) ? +r.systolic : null,
      diastolic: okNum(r.diastolic) ? +r.diastolic : null,
      heartRate: okNum(r.heartRate) ? +r.heartRate : null,
      sleep: okNum(r.sleep) ? +r.sleep : null,
      steps: okNum(r.steps) ? +r.steps : null,
      note: typeof r.note === 'string' ? r.note.slice(0, 60) : ''
    });
  });
  return out;
}

const saveRecords = () => localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

const sortedAsc = () => records.slice().sort((a, b) =>
  a.date === b.date ? a.id.localeCompare(b.id) : (a.date < b.date ? -1 : 1));

const hasMetric = (r) => r.weight != null || r.systolic != null || r.diastolic != null ||
  r.heartRate != null || r.sleep != null || r.steps != null;

/* 按指标取「有值的记录」升序数组 */
const withMetric = (fn) => sortedAsc().filter((r) => okNum(fn(r)));

/* 某指标按日期聚合后的 [{date, value}]（同日取最后一次） */
function seriesOf(fn, rangeDays) {
  const cutoff = rangeDays ? cutoffStr(rangeDays) : null;
  const map = new Map();
  sortedAsc().forEach((r) => {
    if (cutoff && r.date < cutoff) return;
    const v = fn(r);
    if (okNum(v)) map.set(r.date, +v);
  });
  return Array.from(map, ([date, value]) => ({ date, value }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function cutoffStr(rangeDays) {
  const d = new Date();
  d.setDate(d.getDate() - (rangeDays - 1));
  return localDateStr(d);
}

/* ---------------- 健康指标判定 ---------------- */

function bmiInfo(weightKg, heightCm) {
  if (!okNum(weightKg) || !okNum(heightCm) || heightCm <= 0) return null;
  const bmi = +(weightKg / Math.pow(heightCm / 100, 2)).toFixed(1);
  let label, cls;
  if (bmi < 18.5) { label = '偏瘦'; cls = 'info'; }
  else if (bmi < 24) { label = '正常'; cls = 'ok'; }
  else if (bmi < 28) { label = '超重'; cls = 'warn'; }
  else { label = '肥胖'; cls = 'bad'; }
  return { bmi, label, cls };
}

function bpInfo(s, d) {
  if (!okNum(s) || !okNum(d)) return null;
  if (s < 90 || d < 60) return { label: '偏低', cls: 'warn' };
  if (s < 120 && d < 80) return { label: '理想', cls: 'ok' };
  if (s < 140 && d < 90) return { label: '正常高值', cls: 'warn' };
  if (s < 160 && d < 100) return { label: '1级高血压', cls: 'bad' };
  return { label: '2级及以上', cls: 'bad' };
}

function hrInfo(h) {
  if (!okNum(h)) return null;
  if (h < 60) return { label: '偏慢', cls: 'warn' };
  if (h <= 100) return { label: '正常', cls: 'ok' };
  return { label: '偏快', cls: 'warn' };
}

function sleepInfo(h) {
  if (!okNum(h)) return null;
  if (h < 7) return { label: '不足', cls: 'warn' };
  if (h <= 9) return { label: '充足', cls: 'ok' };
  return { label: '偏多', cls: 'info' };
}

/* ---------------- 仪表盘 ---------------- */

function greeting() {
  const h = new Date().getHours();
  const name = settings.name ? '，' + settings.name : '';
  if (h < 5) return '夜深了' + name + ' 🌙';
  if (h < 11) return '早上好' + name + ' ☀️';
  if (h < 14) return '中午好' + name + ' 🌤️';
  if (h < 18) return '下午好' + name + ' 🌿';
  return '晚上好' + name + ' 🌙';
}

function statCard(icon, label, valueHtml, subHtml) {
  return '<div class="stat-card">' +
    '<div class="stat-top"><span class="stat-icon">' + icon + '</span>' + label + '</div>' +
    '<div class="stat-value">' + valueHtml + '</div>' +
    '<div class="stat-sub">' + subHtml + '</div>' +
    '</div>';
}

function renderDashboard() {
  $('#dashGreeting').textContent = greeting();
  const dayCount = new Set(records.map((r) => r.date)).size;
  const d = new Date();
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  $('#dashDate').textContent =
    d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · 星期' + week +
    (dayCount ? ' · 已坚持记录 ' + dayCount + ' 天' : ' · 今天开始记录吧');

  const cards = [];
  const last = (fn) => { const a = withMetric(fn); return a.length ? a[a.length - 1] : null; };
  const prev = (fn) => { const a = withMetric(fn); return a.length > 1 ? a[a.length - 2] : null; };

  // 体重
  const wRec = last((r) => r.weight);
  if (wRec) {
    const p = prev((r) => r.weight);
    let sub;
    if (p) {
      const diff = +(wRec.weight - p.weight).toFixed(1);
      sub = diff === 0 ? '与上次持平' :
        '<span class="' + (diff < 0 ? 'down' : 'up') + '">' + (diff < 0 ? '▼' : '▲') + ' ' + Math.abs(diff) + ' kg</span> 较上次';
    } else sub = '首次记录';
    cards.push(statCard('⚖️', '最新体重', esc(wRec.weight) + '<small>kg</small>', sub));
  } else {
    cards.push(statCard('⚖️', '最新体重', '—', '暂无记录'));
  }

  // BMI
  const bmi = wRec ? bmiInfo(wRec.weight, settings.height) : null;
  if (bmi) {
    cards.push(statCard('📊', 'BMI 指数', esc(bmi.bmi),
      '<span class="pill ' + bmi.cls + '">' + bmi.label + '</span> 按中国成人标准'));
  } else {
    cards.push(statCard('📊', 'BMI 指数', '—',
      settings.height ? '暂无体重记录' : '<span class="link" onclick="switchTab(\'settings\')">去设置身高 →</span>'));
  }

  // 血压
  const bpRec = last((r) => (okNum(r.systolic) && okNum(r.diastolic)) ? r.systolic : null);
  if (bpRec) {
    const info = bpInfo(bpRec.systolic, bpRec.diastolic);
    cards.push(statCard('🩸', '最新血压', esc(bpRec.systolic) + '/' + esc(bpRec.diastolic) + '<small>mmHg</small>',
      '<span class="pill ' + info.cls + '">' + info.label + '</span> · ' + shortDate2(bpRec.date)));
  } else {
    cards.push(statCard('🩸', '最新血压', '—', '暂无记录'));
  }

  // 心率
  const hrRec = last((r) => r.heartRate);
  if (hrRec) {
    const info = hrInfo(hrRec.heartRate);
    cards.push(statCard('❤️', '静息心率', esc(hrRec.heartRate) + '<small>次/分</small>',
      '<span class="pill ' + info.cls + '">' + info.label + '</span> · ' + shortDate2(hrRec.date)));
  } else {
    cards.push(statCard('❤️', '静息心率', '—', '暂无记录'));
  }

  // 睡眠
  const slRec = last((r) => r.sleep);
  if (slRec) {
    const info = sleepInfo(slRec.sleep);
    cards.push(statCard('😴', '最近睡眠', esc(slRec.sleep) + '<small>小时</small>',
      '<span class="pill ' + info.cls + '">' + info.label + '</span> · 建议 7–9 小时'));
  } else {
    cards.push(statCard('😴', '最近睡眠', '—', '暂无记录'));
  }

  // 步数
  const stRec = last((r) => r.steps);
  if (stRec) {
    const goal = 6000;
    const hit = stRec.steps >= goal;
    cards.push(statCard('👟', '最近步数', esc(stRec.steps.toLocaleString('zh-CN')) + '<small>步</small>',
      hit ? '<span class="pill ok">达标 ✓</span> 目标 6000 步' : '距目标 6000 步还差 ' + (goal - stRec.steps).toLocaleString('zh-CN') + ' 步'));
  } else {
    cards.push(statCard('👟', '最近步数', '—', '暂无记录'));
  }

  $('#statGrid').innerHTML = cards.join('');

  // 近30天图表
  drawDashChart('dashWeightChart', 'dashWeightSub', [{ name: '体重', color: COLOR.weight }],
    [(r) => r.weight], 'kg', '还没有体重数据，去添加或载入示例数据吧');
  drawDashChart('dashSleepChart', 'dashSleepSub', [{ name: '睡眠', color: COLOR.sleep }],
    [(r) => r.sleep], '小时', '还没有睡眠数据');

  // 血压（双线）
  const bpEl = $('#dashBpChart');
  const bpMap = new Map();
  seriesOf((r) => r.systolic, 30).forEach((x) => {
    if (!bpMap.has(x.date)) bpMap.set(x.date, {});
    bpMap.get(x.date).sys = x.value;
  });
  seriesOf((r) => r.diastolic, 30).forEach((x) => {
    if (!bpMap.has(x.date)) bpMap.set(x.date, {});
    bpMap.get(x.date).dia = x.value;
  });
  const bpDates = Array.from(bpMap.keys()).sort();
  const bpSeries = [
    { name: '收缩压', color: COLOR.systolic, values: bpDates.map((d2) => (bpMap.get(d2).sys != null ? bpMap.get(d2).sys : null)) },
    { name: '舒张压', color: COLOR.diastolic, values: bpDates.map((d2) => (bpMap.get(d2).dia != null ? bpMap.get(d2).dia : null)) }
  ];
  renderLineChart(bpEl, { dates: bpDates, series: bpSeries, unit: 'mmHg', emptyText: '还没有血压数据' });
}

function shortDate2(dateStr) {
  return dateStr ? dateStr.slice(5).replace('-', '月') + '日' : '';
}

function drawDashChart(elId, subId, names, fns, unit, emptyText) {
  const s = seriesOf(fns[0], 30);
  $('#' + subId).textContent = s.length ? '近30天 · ' + s.length + ' 次记录' : '';
  renderLineChart($('#' + elId), {
    dates: s.map((x) => x.date),
    series: [{ name: names[0].name, color: names[0].color, values: s.map((x) => x.value) }],
    unit, emptyText
  });
}

/* ---------------- 记录页 ---------------- */

function readForm() {
  return {
    date: $('#fDate').value,
    weight: num($('#fWeight').value),
    systolic: num($('#fSys').value),
    diastolic: num($('#fDia').value),
    heartRate: num($('#fHr').value),
    sleep: num($('#fSleep').value),
    steps: num($('#fSteps').value),
    note: $('#fNote').value.trim()
  };
}

function validateRecord(r) {
  if (!r.date) return '请选择日期';
  const checks = [
    ['weight', 20, 300, '体重'],
    ['systolic', 60, 260, '收缩压'],
    ['diastolic', 40, 160, '舒张压'],
    ['heartRate', 30, 220, '心率'],
    ['sleep', 0, 24, '睡眠时长'],
    ['steps', 0, 200000, '步数']
  ];
  for (const [key, min, max, label] of checks) {
    if (r[key] != null && !isFinite(r[key])) return label + '请输入有效数字';
    if (r[key] != null && (r[key] < min || r[key] > max)) return label + '应在 ' + min + '–' + max + ' 之间';
  }
  const any = checks.some(([key]) => r[key] != null);
  if (!any) return '至少填写一项健康指标';
  if ((r.systolic != null) !== (r.diastolic != null)) return '血压请同时填写收缩压和舒张压';
  if (r.systolic != null && r.systolic <= r.diastolic) return '收缩压应大于舒张压';
  return null;
}

function submitRecord(e) {
  e.preventDefault();
  const r = readForm();
  const err = validateRecord(r);
  if (err) { toast(err, 'err'); return; }

  if (editingId) {
    const target = records.find((x) => x.id === editingId);
    if (target) Object.assign(target, r);
    toast('记录已更新 ✅');
  } else {
    records.push(Object.assign({ id: uid() }, r));
    toast('记录已保存 ✅');
  }
  saveRecords();
  exitEditMode();
  renderRecords();
}

function startEdit(id) {
  const r = records.find((x) => x.id === id);
  if (!r) return;
  editingId = id;
  $('#fDate').value = r.date;
  $('#fWeight').value = r.weight != null ? r.weight : '';
  $('#fSys').value = r.systolic != null ? r.systolic : '';
  $('#fDia').value = r.diastolic != null ? r.diastolic : '';
  $('#fHr').value = r.heartRate != null ? r.heartRate : '';
  $('#fSleep').value = r.sleep != null ? r.sleep : '';
  $('#fSteps').value = r.steps != null ? r.steps : '';
  $('#fNote').value = r.note || '';
  $('#recordFormTitle').textContent = '✏️ 编辑记录（' + r.date + '）';
  $('#btnCancelEdit').hidden = false;
  $('#recordForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function exitEditMode() {
  editingId = null;
  $('#recordForm').reset();
  $('#fDate').value = todayStr();
  $('#recordFormTitle').textContent = '✏️ 新增记录';
  $('#btnCancelEdit').hidden = true;
}

function removeRecord(id) {
  const r = records.find((x) => x.id === id);
  if (!r) return;
  if (!confirm('确定删除 ' + r.date + ' 的这条记录吗？')) return;
  records = records.filter((x) => x.id !== id);
  if (editingId === id) exitEditMode();
  saveRecords();
  renderRecords();
  toast('已删除该记录');
}

function renderRecords() {
  const tbody = $('#recordTbody');
  const list = sortedAsc().reverse();
  $('#recordCount').textContent = list.length ? '共 ' + list.length + ' 条记录' : '';
  $('#recordTableWrap').hidden = list.length === 0;
  $('#recordsEmpty').hidden = list.length > 0;

  const rows = list.slice(0, 200).map((r) => {
    const bp = (okNum(r.systolic) && okNum(r.diastolic)) ? r.systolic + '/' + r.diastolic : null;
    const cell = (v) => v == null ? '<td class="muted">—</td>' : '<td>' + esc(v) + '</td>';
    return '<tr>' +
      '<td><b>' + esc(r.date) + '</b></td>' +
      cell(r.weight) +
      (bp ? '<td>' + esc(bp) + '</td>' : '<td class="muted">—</td>') +
      cell(r.heartRate) +
      cell(r.sleep) +
      cell(r.steps != null ? r.steps.toLocaleString('zh-CN') : null) +
      '<td class="muted">' + esc(r.note || '') + '</td>' +
      '<td><div class="row-actions">' +
      '<button class="icon-btn" data-act="edit" data-id="' + r.id + '" title="编辑">✏️</button>' +
      '<button class="icon-btn danger" data-act="del" data-id="' + r.id + '" title="删除">🗑️</button>' +
      '</div></td></tr>';
  }).join('');
  tbody.innerHTML = rows;
  if (list.length > 200) {
    tbody.insertAdjacentHTML('beforeend',
      '<tr><td colspan="8" class="muted" style="text-align:center">仅显示最近 200 条，更多请导出查看</td></tr>');
  }
}

/* ---------------- 趋势页 ---------------- */

function renderTrends() {
  const range = trendRangeDays;
  const total = records.filter((r) => !range || r.date >= cutoffStr(range)).length;
  $('#trendSummary').textContent = total ? ('范围内共 ' + total + ' 条记录 · 悬停查看明细') : '范围内暂无记录';

  const draw = (elId, fn, name, color, unit) => {
    const s = seriesOf(fn, range);
    renderLineChart($('#' + elId), {
      dates: s.map((x) => x.date),
      series: [{ name, color, values: s.map((x) => x.value) }],
      unit,
      emptyText: '范围内暂无数据'
    });
  };
  draw('trendWeight', (r) => r.weight, '体重', COLOR.weight, 'kg');
  draw('trendHr', (r) => r.heartRate, '心率', COLOR.heartRate, '次/分');
  draw('trendSleep', (r) => r.sleep, '睡眠', COLOR.sleep, '小时');
  draw('trendSteps', (r) => r.steps, '步数', COLOR.steps, '步');

  // 血压双线
  const bpMap = new Map();
  seriesOf((r) => r.systolic, range).forEach((x) => {
    if (!bpMap.has(x.date)) bpMap.set(x.date, {});
    bpMap.get(x.date).sys = x.value;
  });
  seriesOf((r) => r.diastolic, range).forEach((x) => {
    if (!bpMap.has(x.date)) bpMap.set(x.date, {});
    bpMap.get(x.date).dia = x.value;
  });
  const dates = Array.from(bpMap.keys()).sort();
  renderLineChart($('#trendBp'), {
    dates,
    series: [
      { name: '收缩压', color: COLOR.systolic, values: dates.map((d) => bpMap.get(d).sys != null ? bpMap.get(d).sys : null) },
      { name: '舒张压', color: COLOR.diastolic, values: dates.map((d) => bpMap.get(d).dia != null ? bpMap.get(d).dia : null) }
    ],
    unit: 'mmHg',
    emptyText: '范围内暂无数据'
  });
}

/* ---------------- 健康工具 ---------------- */

function renderTools() {
  // 首次进入用个人信息预填
  if (settings.height) {
    ['#bmiHeight', '#bmrHeight', '#idealHeight'].forEach((sel) => { if (!$(sel).value) $(sel).value = settings.height; });
  }
  const latestW = withMetric((r) => r.weight);
  const w = latestW.length ? latestW[latestW.length - 1].weight : null;
  if (w) {
    ['#bmiWeight', '#bmrWeight', '#waterWeight'].forEach((sel) => { if (!$(sel).value) $(sel).value = w; });
  }
  if (settings.age) { if (!$('#bmrAge').value) $('#bmrAge').value = settings.age; }
  if (settings.gender) { $('#bmrGender').value = settings.gender; }
  computeBmi();
  computeBmr();
  computeIdeal();
}

function computeBmi() {
  const h = num($('#bmiHeight').value);
  const w = num($('#bmiWeight').value);
  const res = $('#bmiResult');
  const bar = $('#bmiBar');
  const marker = $('#bmiMarker');
  const info = bmiInfo(w, h);
  if (!info) {
    res.className = 'tool-result muted small';
    res.textContent = '填入身高和体重后自动计算（按中国成人标准）';
    bar.hidden = true;
    return;
  }
  res.className = 'tool-result';
  res.innerHTML = '你的 BMI 是 <span class="big">' + info.bmi + '</span>，属于 ' +
    '<span class="pill ' + info.cls + '">' + info.label + '</span>';
  bar.hidden = false;
  const pct = Math.max(0, Math.min(100, ((info.bmi - 14) / (34 - 14)) * 100));
  marker.style.left = pct + '%';
}

function computeBmr() {
  const gender = $('#bmrGender').value;
  const age = num($('#bmrAge').value);
  const h = num($('#bmrHeight').value);
  const w = num($('#bmrWeight').value);
  const act = num($('#bmrActivity').value) || 1.375;
  const res = $('#bmrResult');
  if (!okNum(age) || !okNum(h) || !okNum(w)) {
    res.className = 'tool-result muted small';
    res.textContent = '填入信息后自动计算基础代谢与每日总消耗';
    return;
  }
  const bmr = Math.round(10 * w + 6.25 * h - 5 * age + (gender === 'male' ? 5 : -161));
  const tdee = Math.round(bmr * act);
  res.className = 'tool-result';
  res.innerHTML =
    '基础代谢 BMR 约 <span class="big">' + bmr.toLocaleString('zh-CN') + '</span> 千卡/天' +
    '<br>维持当前体重的每日消耗约 <b>' + tdee.toLocaleString('zh-CN') + '</b> 千卡' +
    '<br><span class="muted small">如需减重，每日摄入可比消耗少 300–500 千卡，并保证蛋白质摄入。</span>';
}

function computeIdeal() {
  const h = num($('#idealHeight').value);
  const w = num($('#waterWeight').value);
  const res = $('#idealResult');
  const parts = [];
  if (okNum(h) && h > 0) {
    const lo = Math.round(18.5 * Math.pow(h / 100, 2));
    const hi = Math.round(23.9 * Math.pow(h / 100, 2));
    parts.push('理想体重范围约 <b>' + lo + '–' + hi + '</b> kg（对应 BMI 18.5–23.9）');
  }
  if (okNum(w) && w > 0) {
    const water = Math.round(w * 35);
    parts.push('每日饮水建议约 <b>' + (water / 1000).toFixed(1) + '</b> L（按每公斤体重 30–40 mL 估算）');
  }
  if (!parts.length) {
    res.className = 'tool-result muted small';
    res.textContent = '填入后给出每日饮水建议与理想体重范围';
    return;
  }
  res.className = 'tool-result';
  res.innerHTML = parts.join('<br>');
}

/* ---------------- 设置与数据 ---------------- */

function renderSettings() {
  $('#setName').value = settings.name || '';
  $('#setGender').value = settings.gender || 'female';
  $('#setAge').value = settings.age != null ? settings.age : '';
  $('#setHeight').value = settings.height != null ? settings.height : '';
}

function saveProfile() {
  const name = $('#setName').value.trim();
  const age = num($('#setAge').value);
  const height = num($('#setHeight').value);
  if (okNum(age) && (age < 10 || age > 100)) { toast('年龄应在 10–100 之间', 'err'); return; }
  if (okNum(height) && (height < 80 || height > 250)) { toast('身高应在 80–250 cm 之间', 'err'); return; }
  settings.name = name;
  settings.gender = $('#setGender').value;
  settings.age = okNum(age) ? age : null;
  settings.height = okNum(height) ? height : null;
  saveSettings();
  toast('个人信息已保存 ✅');
}

function loadDemo() {
  if (records.length && !confirm('载入示例数据会覆盖现有全部记录，继续吗？')) return;
  records = makeDemoData();
  saveRecords();
  toast('已载入约 60 天示例数据 ✨');
  refreshAll();
}

function makeDemoData() {
  const out = [];
  const days = 60;
  const today = new Date();
  let w = 69.5 + Math.random() * 1.5;
  let sys = 133, dia = 87, hr = 78;
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    if (Math.random() < 0.08) continue; // 偶尔漏记，更真实
    w = Math.max(52, w - (0.05 + Math.random() * 0.12));
    sys = Math.min(152, sys - 0.12 + (Math.random() - 0.5) * 6);
    dia = Math.min(100, dia - 0.08 + (Math.random() - 0.5) * 4);
    hr = Math.min(100, hr - 0.08 + (Math.random() - 0.5) * 7);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const sleep = +Math.max(4.5, Math.min(9.5, (weekend ? 7.8 : 6.9) + (Math.random() - 0.5) * 1.6)).toFixed(1);
    const steps = Math.max(800, Math.min(22000, Math.round((weekend ? 8200 : 7400) + (Math.random() - 0.35) * 5200)));
    out.push({
      id: uid(),
      date: localDateStr(d),
      weight: +w.toFixed(1),
      systolic: Math.round(sys),
      diastolic: Math.round(dia),
      heartRate: Math.round(hr),
      sleep,
      steps,
      note: ''
    });
  }
  return out;
}

function exportData() {
  if (!records.length) { toast('还没有记录可以导出', 'err'); return; }
  const payload = { app: 'health-tracker', exportedAt: new Date().toISOString(), settings, records };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '健康记录备份_' + todayStr() + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast('已导出备份 ⬇️');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      const arr = Array.isArray(obj) ? obj : (Array.isArray(obj.records) ? obj.records : null);
      if (!arr) throw new Error('格式不正确');
      const clean = sanitizeRecords(arr);
      if (!clean.length) throw new Error('没有找到有效记录');
      if (records.length && !confirm('将导入 ' + clean.length + ' 条记录并覆盖现有 ' + records.length + ' 条，继续吗？')) return;
      records = clean;
      if (obj.settings && typeof obj.settings === 'object') {
        settings = Object.assign(settings, obj.settings);
        saveSettings();
      }
      saveRecords();
      refreshAll();
      toast('成功导入 ' + clean.length + ' 条记录 ✅');
    } catch (e) {
      toast('导入失败：' + e.message, 'err');
    }
  };
  reader.readAsText(file, 'utf-8');
}

function clearAll() {
  if (!records.length) { toast('当前没有记录'); return; }
  if (!confirm('确定清空全部 ' + records.length + ' 条记录吗？此操作不可恢复！')) return;
  if (!confirm('再次确认：真的要清空吗？（建议先导出备份）')) return;
  records = [];
  saveRecords();
  refreshAll();
  toast('已清空全部记录');
}

/* ---------------- 页面切换 ---------------- */

function switchTab(name) {
  currentTab = name;
  $$('.tab-page').forEach((sec) => { sec.hidden = sec.id !== 'tab-' + name; });
  $$('#mainTabs .tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === name));
  renderers[name]();
  window.scrollTo({ top: 0 });
}

function refreshAll() {
  renderers[currentTab]();
}

const renderers = {
  dashboard: renderDashboard,
  records: renderRecords,
  trends: renderTrends,
  tools: renderTools,
  settings: renderSettings
};

/* ---------------- 初始化 ---------------- */

function init() {
  loadState();

  // 导航
  $('#mainTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (btn) switchTab(btn.dataset.tab);
  });
  $('#btnQuickAdd').addEventListener('click', () => {
    switchTab('records');
    exitEditMode();
    $('#fWeight').focus();
  });

  // 记录表单
  $('#recordForm').addEventListener('submit', submitRecord);
  $('#btnResetForm').addEventListener('click', exitEditMode);
  $('#btnCancelEdit').addEventListener('click', exitEditMode);
  $('#recordTbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'edit') startEdit(btn.dataset.id);
    else removeRecord(btn.dataset.id);
  });

  // 趋势范围
  $('#rangeSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-range]');
    if (!btn) return;
    trendRangeDays = +btn.dataset.range;
    $$('#rangeSeg button').forEach((b) => b.classList.toggle('active', b === btn));
    renderTrends();
  });

  // 示例数据
  $('#btnDemoDash').addEventListener('click', loadDemo);
  $('#btnDemoRecords').addEventListener('click', loadDemo);
  $('#btnDemoSettings').addEventListener('click', loadDemo);

  // 健康工具（实时计算）
  ['#bmiHeight', '#bmiWeight'].forEach((sel) => $(sel).addEventListener('input', computeBmi));
  ['#bmrGender', '#bmrAge', '#bmrHeight', '#bmrWeight', '#bmrActivity'].forEach((sel) => $(sel).addEventListener('input', computeBmr));
  ['#idealHeight', '#waterWeight'].forEach((sel) => $(sel).addEventListener('input', computeIdeal));

  // 设置
  $('#btnSaveSettings').addEventListener('click', saveProfile);
  $('#btnExport').addEventListener('click', exportData);
  $('#btnImport').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  });
  $('#btnClearAll').addEventListener('click', clearAll);

  // 窗口尺寸变化时重绘当前页图表
  window.addEventListener('resize', debounce(refreshAll, 250));

  $('#fDate').value = todayStr();
  switchTab('dashboard');
}

document.addEventListener('DOMContentLoaded', init);
