/* Gym Tracker — all data stays on this device (localStorage + IndexedDB for photos). */
(() => {
  'use strict';
  const D = window.GYM_DATA;
  const KEY = 'gymtracker.v1';
  const LB = 2.20462;

  // ---------------------------------------------------------------- utils
  const pad = (n) => String(n).padStart(2, '0');
  const dkey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
  const fmtDay = (k, o = { weekday: 'short', day: 'numeric', month: 'short' }) => parseKey(k).toLocaleDateString(undefined, o);
  const weekStart = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };

  // ---------------------------------------------------------------- state
  function defaultState() {
    return {
      v: 1,
      settings: { unit: 'kg', heightCm: null, sound: true, restSec: 90 },
      plan: JSON.parse(JSON.stringify(D.days)),
      customExercises: {},
      sessions: {}, // date -> { dayId, dayName, type, swaps, entries: {exId: {sets:[{w,r,pr}], done, note}}, finished }
      daily: {},    // date -> { protein, creatine }
      body: {},     // date -> weight kg
      health: {},   // date -> { steps, kcal }
      lastBackup: null,
      created: dkey(),
    };
  }
  function migrate(s) {
    const d = defaultState();
    return { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) } };
  }
  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) return migrate(JSON.parse(raw)); } catch (e) { /* fall through */ }
    return defaultState();
  }
  let S = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save — storage is full'); }
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  const ui = { tab: 'today', dayId: null, logEx: null, editIndex: null, edit: null, calMonth: new Date(), calSel: null, range: '1M', statsWeek: 0, rest: null, settingsFrom: 'today' };

  // ---------------------------------------------------------------- units
  const unit = () => S.settings.unit;
  const toDisp = (kg) => (unit() === 'lb' ? kg * LB : kg);
  const fromDisp = (v) => (unit() === 'lb' ? v / LB : v);
  const fmtNum = (v) => { const r = Math.round(v * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1); };
  const fmtW = (kg) => (kg == null ? '—' : `${fmtNum(toDisp(kg))} ${unit()}`);
  const stepFor = (e) => (unit() === 'lb' ? (e.inc >= 2.5 ? 5 : 2.5) : e.inc);
  const roundDisp = (v, e) => { const s = stepFor(e) / 2; return Math.round(v / s) * s; };

  // ---------------------------------------------------------------- domain
  const ex = (id) => S.customExercises[id] || D.exercises[id] || { name: id, muscle: 'other', group: 'other', equip: 'machine', inc: 2.5, reps: [8, 12], sets: 3 };
  const allExercises = () => ({ ...D.exercises, ...S.customExercises });
  const planDay = (id) => S.plan.find((d) => d.id === id) || S.plan[0];
  const planIndex = (id) => Math.max(0, S.plan.findIndex((d) => d.id === id));
  const e1rm = (w, r) => (r <= 1 ? w : w * (1 + r / 30));
  const sessionKeys = () => Object.keys(S.sessions).sort();
  const hasSets = (s) => s && Object.values(s.entries || {}).some((en) => en.sets && en.sets.length);
  const sessionExercises = (dayId, sess) => planDay(dayId).exercises.map((id) => (sess && sess.swaps && sess.swaps[id]) || id);

  function nextDay() {
    const keys = sessionKeys().filter((k) => k < dkey() && hasSets(S.sessions[k]));
    if (!keys.length) return S.plan[0];
    const last = S.sessions[keys[keys.length - 1]];
    return S.plan[(planIndex(last.dayId) + 1) % S.plan.length];
  }
  function todaySession() { return S.sessions[dkey()]; }
  function ensureSession(dayId) {
    const k = dkey();
    if (!S.sessions[k]) {
      const d = planDay(dayId);
      S.sessions[k] = { dayId: d.id, dayName: d.name, type: d.type, swaps: {}, entries: {}, finished: false, startedAt: Date.now() };
    }
    return S.sessions[k];
  }
  function currentDayId() { const s = todaySession(); return ui.dayId || (s ? s.dayId : nextDay().id); }

  function lastPerformance(exId, before) {
    const keys = sessionKeys().filter((k) => k < before).reverse();
    for (const k of keys) { const en = S.sessions[k].entries[exId]; if (en && en.sets && en.sets.length) return { date: k, sets: en.sets }; }
    return null;
  }
  function historyFor(exId, before, n = 3) {
    const out = [];
    for (const k of sessionKeys().filter((k) => k < before).reverse()) {
      const en = S.sessions[k].entries[exId];
      if (en && en.sets && en.sets.length) out.push({ date: k, sets: en.sets });
      if (out.length >= n) break;
    }
    return out;
  }
  const setsSummary = (sets) => {
    const top = Math.max(...sets.map((s) => s.w || 0));
    const reps = sets.map((s) => s.r).join(', ');
    return `${sets.length} sets · ${reps} reps · ${top ? fmtW(top) : 'bodyweight'}`;
  };

  function suggestion(exId, date) {
    const e = ex(exId);
    const last = lastPerformance(exId, date);
    if (!last) {
      return { w: null, r: e.reps[0], count: e.sets, text: `First time logging this. Pick a weight you can do for ${e.reps[0]}–${e.reps[1]} clean reps.` };
    }
    const top = Math.max(...last.sets.map((s) => s.w || 0));
    const topSets = last.sets.filter((s) => (s.w || 0) === top);
    const hitTop = topSets.length >= Math.min(e.sets, last.sets.length) && topSets.every((s) => s.r >= e.reps[1]);
    const when = daysBetween(last.date, date) === 1 ? 'yesterday' : fmtDay(last.date, { weekday: 'short', day: 'numeric', month: 'short' });
    const reps = last.sets.map((s) => s.r).join(', ');
    if (hitTop && !e.bodyweight) {
      const w = fromDisp(roundDisp(toDisp(top) + stepFor(e), e));
      return { w, r: e.reps[0], count: Math.max(e.sets, last.sets.length), text: `Last time (${when}): ${reps} reps at ${fmtW(top)} — top of your range. Go up to <b class="hl">${fmtW(w)}</b> today.` };
    }
    const minR = Math.min(...topSets.map((s) => s.r));
    const r = clamp(minR + 1, e.reps[0], e.reps[1]);
    const wTxt = top ? `at ${fmtW(top)}` : '';
    return { w: top || (e.bodyweight ? 0 : null), r, count: Math.max(e.sets, last.sets.length), text: `Last time (${when}): ${reps} reps ${wTxt}. Stay ${top ? 'at ' + fmtW(top) : ''} and aim for <b class="hl">${r} reps</b> a set.` };
  }

  // PR check against all previous sessions + earlier sets today
  function checkPR(exId, set, earlierToday) {
    const today = dkey();
    let maxW = 0, maxE = 0, hasHist = false; const repsAt = [];
    for (const k of sessionKeys()) {
      if (k === today) continue;
      const en = S.sessions[k].entries[exId];
      if (!en || !en.sets) continue;
      for (const s of en.sets) { hasHist = true; maxW = Math.max(maxW, s.w || 0); maxE = Math.max(maxE, e1rm(s.w || 0, s.r)); repsAt.push(s); }
    }
    if (!hasHist) return null;
    for (const s of earlierToday) { maxW = Math.max(maxW, s.w || 0); maxE = Math.max(maxE, e1rm(s.w || 0, s.r)); repsAt.push(s); }
    const w = set.w || 0;
    if (w > maxW + 1e-6) return { kind: 'Heaviest weight', prev: maxW ? fmtW(maxW) : '—', e: e1rm(w, set.r), prevE: maxE };
    const e = e1rm(w, set.r);
    if (w > 0 && e > maxE + 0.25) return { kind: 'Best estimated 1-rep max', prev: `${fmtW(maxE)} est.`, e, prevE: maxE };
    const bestReps = Math.max(0, ...repsAt.filter((s) => (s.w || 0) >= w - 1e-6).map((s) => s.r));
    if (set.r > bestReps) return { kind: w ? 'Most reps at this weight' : 'Most reps', prev: `${bestReps} reps`, e, prevE: maxE };
    return null;
  }

  // XP / level / streak
  function computeXP() {
    let xp = 0;
    for (const s of Object.values(S.sessions)) {
      for (const en of Object.values(s.entries || {})) {
        xp += (en.sets || []).length * 5;
        xp += (en.sets || []).filter((x) => x.pr).length * 100;
        if (en.done) xp += 20;
      }
      if (s.finished) xp += 50;
    }
    for (const d of Object.values(S.daily)) { if (d.protein) xp += 10; if (d.creatine) xp += 10; }
    xp += Object.keys(S.body).length * 5;
    return xp;
  }
  function levelInfo(xp) {
    let level = 1, need = 250, acc = 0;
    while (xp >= acc + need) { acc += need; level += 1; need = 200 + 50 * level; }
    return { level, into: xp - acc, need };
  }
  function streak() {
    const keys = sessionKeys().filter((k) => hasSets(S.sessions[k]));
    if (!keys.length) return 0;
    if (daysBetween(keys[keys.length - 1], dkey()) > 3) return 0;
    let n = 1;
    for (let i = keys.length - 1; i > 0; i--) { if (daysBetween(keys[i - 1], keys[i]) <= 3) n++; else break; }
    return n;
  }

  // ---------------------------------------------------------------- sound
  let actx = null;
  function ac() {
    if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; actx = new C(); }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function tone(freq, start, dur, type = 'triangle', gain = 0.12) {
    const a = ac(); if (!a) return;
    const t = a.currentTime + start;
    const o = a.createOscillator(); const g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  const SFX = {
    tap: () => tone(700, 0, 0.05, 'sine', 0.06),
    pop: () => { tone(520, 0, 0.07, 'sine', 0.12); tone(1040, 0.05, 0.1, 'sine', 0.08); },
    set: () => { tone(880, 0, 0.08, 'triangle', 0.12); tone(1320, 0.07, 0.14, 'triangle', 0.1); },
    done: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.2, 'triangle', 0.11)); },
    pr: () => {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.16, 'square', 0.05));
      [1047, 1319, 1568].forEach((f) => tone(f, 0.42, 0.7, 'triangle', 0.07));
      tone(2093, 0.5, 0.5, 'sine', 0.04);
    },
    workout: () => {
      [392, 523, 659, 784].forEach((f, i) => tone(f, i * 0.11, 0.22, 'triangle', 0.1));
      [784, 988, 1175, 1568].forEach((f) => tone(f, 0.5, 0.9, 'triangle', 0.06));
    },
    timer: () => { tone(988, 0, 0.14, 'sine', 0.18); tone(988, 0.22, 0.14, 'sine', 0.18); tone(1319, 0.44, 0.3, 'sine', 0.18); },
  };
  const play = (name) => { if (S.settings.sound) try { SFX[name](); } catch (e) { /* ignore */ } };

  // ---------------------------------------------------------------- icons
  const I = {
    check: (c = 'currentColor', s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>`,
    chev: () => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9AA3AF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`,
    back: () => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>`,
    fwd: () => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`,
    swap: () => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>`,
    flame: () => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF8A3D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-10z"/></svg>`,
    gear: () => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`,
    trend: (c = 'currentColor') => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>`,
    timer: () => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9AA3AF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/></svg>`,
    trophy: (c = '#FFD23F', s = 64) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/></svg>`,
    heart: () => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FF6B8B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>`,
    cloud: () => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5AB0FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a5 5 0 0 1-.6-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/><path d="M12 11v6M9.5 14.5L12 17l2.5-2.5"/></svg>`,
    upload: () => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9AA3AF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>`,
    camera: () => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9AA3AF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8 6l1.5-2h5L16 6"/></svg>`,
    plus: () => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
    scale: () => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9AA3AF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 9a5 5 0 0 1 8 0l-3 3"/></svg>`,
    tabToday: () => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6v12M18 6v12M3 9v6M21 9v6M6 12h12"/></svg>`,
    tabCal: () => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`,
    tabBody: () => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>`,
    tabStats: () => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>`,
  };

  // ---------------------------------------------------------------- rendering
  const $app = document.getElementById('app');
  const $ov = document.getElementById('overlay');

  function render() {
    let html = '';
    if (ui.tab === 'log') html = viewLog();
    else if (ui.tab === 'calendar') html = viewCalendar();
    else if (ui.tab === 'body') html = viewBody();
    else if (ui.tab === 'stats') html = viewStats();
    else if (ui.tab === 'settings') html = viewSettings();
    else if (ui.tab === 'photos') html = viewPhotos();
    else html = viewToday();
    const showNav = ui.tab !== 'log';
    $app.innerHTML = html + (showNav ? nav() : '') + restBar();
    $app.classList.toggle('has-rest', !!ui.rest && showNav);
    if (ui.tab === 'photos') loadPhotos();
  }

  function nav() {
    const t = (id, label, icon) => `<button type="button" data-a="tab" data-tab="${id}" class="${ui.tab === id ? 'on' : ''}" aria-current="${ui.tab === id ? 'page' : 'false'}">${icon}${label}</button>`;
    return `<nav class="tabs" aria-label="Main">${t('today', 'Today', I.tabToday())}${t('calendar', 'Calendar', I.tabCal())}${t('body', 'Body', I.tabBody())}${t('stats', 'Stats', I.tabStats())}</nav>`;
  }

  // ---- Today
  function viewToday() {
    const date = dkey();
    const sess = todaySession();
    const dayId = currentDayId();
    const day = planDay(dayId);
    const nd = nextDay();
    const xp = computeXP(); const lv = levelInfo(xp);
    const st = streak();
    const exIds = sessionExercises(dayId, sess && sess.dayId === dayId ? sess : null);
    const doneCount = exIds.filter((id) => sess && sess.entries[id] && sess.entries[id].done).length;
    const daily = S.daily[date] || {};
    const started = sess && hasSets(sess);
    const finished = sess && sess.finished && sess.dayId === dayId;
    const insight = buildInsights()[0];

    const items = exIds.map((id) => {
      const e = ex(id);
      const en = sess && sess.entries[id];
      const sets = (en && en.sets) || [];
      const pr = sets.some((s) => s.pr);
      let sub;
      if (sets.length) {
        const top = Math.max(...sets.map((s) => s.w || 0));
        sub = `${sets.length} × ${sets.map((s) => s.r).join('/')} · ${top ? fmtW(top) : 'bodyweight'}`;
      } else {
        const last = lastPerformance(id, date);
        sub = `Target ${e.sets} × ${e.reps[0]}–${e.reps[1]}${last ? ' · last ' + fmtW(Math.max(...last.sets.map((s) => s.w || 0))) : ''}`;
      }
      const chk = en && en.done ? `<span class="check done">${I.check('#0E0F12')}</span>` : sets.length ? `<span class="check partial"></span>` : `<span class="check"></span>`;
      const right = pr ? `<span class="badge pr">PR</span>` : I.chev();
      return `<button type="button" class="ex-item" data-a="openEx" data-ex="${esc(id)}">${chk}<span class="body"><span class="name">${esc(e.name)}</span><span class="sub">${sub}</span></span>${right}</button>`;
    }).join('');

    const tabs = S.plan.map((d) => `<button type="button" data-a="pickDay" data-day="${d.id}" class="${d.id === dayId ? 'on' : ''} ${d.id === nd.id ? 'next' : ''}" aria-pressed="${d.id === dayId}">${esc(d.name)}</button>`).join('');

    return `<main>
      <div class="between">
        <div class="col" style="gap:2px">
          <span class="small muted">${fmtDay(date, { weekday: 'short', day: 'numeric', month: 'short' })}${dayId === nd.id && !sess ? ' · up next' : ''}</span>
          <h1 class="title">${esc(day.name)} <span class="small muted" style="font-family:Inter;font-weight:400">${esc(day.focus || '')}</span></h1>
        </div>
        <div class="row" style="gap:8px">
          <span class="pill" title="Workout streak">${I.flame()}<span>${st}</span><span class="sr">workout streak</span></span>
          <button type="button" class="icon-btn" data-a="openSettings" aria-label="Settings">${I.gear()}</button>
        </div>
      </div>
      <div class="col">
        <div class="between tiny muted"><span class="row" style="gap:8px"><span class="level-badge" style="width:28px;height:28px;font-size:13px">${lv.level}</span>Level ${lv.level}</span><span>${lv.into} / ${lv.need} XP</span></div>
        <div class="xpbar" role="progressbar" aria-valuemin="0" aria-valuemax="${lv.need}" aria-valuenow="${lv.into}" aria-label="XP to next level"><div style="width:${Math.round((lv.into / lv.need) * 100)}%"></div></div>
      </div>
      <div class="daytabs" role="group" aria-label="Workout day">${tabs}</div>
      ${finished ? `<div class="hint">${I.check('#C6F432', 18)}<span><b>Workout complete.</b> Next up: <b>${esc(planDay(S.plan[(planIndex(dayId) + 1) % S.plan.length].id).name)}</b>.</span></div>` : ''}
      <div class="between"><span class="h2">Exercises</span><span class="small muted">${doneCount} of ${exIds.length} done</span></div>
      <div class="col">${items}</div>
      ${started && !finished && sess.dayId === dayId ? `<button type="button" class="btn accent block" data-a="finishWorkout">${I.check()}Finish workout</button>` : ''}
      <span class="h2">Daily</span>
      <div class="supp">
        <button type="button" class="${daily.protein ? 'on' : ''}" data-a="supp" data-k="protein" aria-pressed="${!!daily.protein}">${daily.protein ? I.check() : ''}Protein${daily.protein ? '' : '?'}</button>
        <button type="button" class="${daily.creatine ? 'on' : ''}" data-a="supp" data-k="creatine" aria-pressed="${!!daily.creatine}">${daily.creatine ? I.check() : ''}Creatine${daily.creatine ? '' : '?'}</button>
      </div>
      <button type="button" class="ex-item" data-a="logWeight">${I.scale()}<span class="body"><span class="name">Today's weight</span><span class="sub">${S.body[date] ? fmtW(S.body[date]) + ' logged' : 'Tap to log'}</span></span>${S.body[date] ? `<span class="check done">${I.check('#0E0F12')}</span>` : I.chev()}</button>
      ${insight ? `<div class="insight"><span class="dot" style="background:${insight.c}"></span><span>${insight.t}</span></div>` : ''}
    </main>`;
  }

  // ---- Log exercise
  function viewLog() {
    const date = dkey();
    const exId = ui.logEx; const e = ex(exId);
    const sess = todaySession();
    const dayId = currentDayId();
    const exIds = sessionExercises(dayId, sess && sess.dayId === dayId ? sess : null);
    const pos = exIds.indexOf(exId);
    const en = (sess && sess.entries[exId]) || { sets: [], done: false, note: '' };
    const sets = en.sets || [];
    const sug = suggestion(exId, date);
    const planned = Math.max(sug.count, sets.length + (en.done ? 0 : 1));
    const editing = ui.editIndex != null && ui.editIndex < sets.length;
    const activeIdx = editing ? ui.editIndex : sets.length;
    if (!ui.edit) ui.edit = defaultEdit(exId, sets, sug);
    const step = stepFor(e);

    const rows = [];
    for (let i = 0; i < planned; i++) {
      if (i === activeIdx && !(en.done && !editing && i >= sets.length)) {
        rows.push(`<div class="editor">
          <div class="between small"><b>Set ${i + 1}${editing ? ' · editing' : ''}</b><span class="muted">${editing ? '' : i === 0 ? (sets.length ? '' : 'suggested') : 'filled from set ' + i}</span></div>
          <div class="grid2">
            <div class="stepper"><button type="button" data-a="adj" data-f="w" data-d="${-step}" aria-label="Decrease weight">−</button><label><input id="inW" inputmode="decimal" value="${ui.edit.w == null ? '' : fmtNum(ui.edit.w)}" placeholder="0" aria-label="Weight in ${unit()}"><span class="u">${e.bodyweight ? '+' + unit() : unit()}</span></label><button type="button" data-a="adj" data-f="w" data-d="${step}" aria-label="Increase weight">+</button></div>
            <div class="stepper"><button type="button" data-a="adj" data-f="r" data-d="-1" aria-label="Decrease reps">−</button><label><input id="inR" inputmode="numeric" value="${ui.edit.r ?? ''}" placeholder="0" aria-label="Reps"><span class="u">reps</span></label><button type="button" data-a="adj" data-f="r" data-d="1" aria-label="Increase reps">+</button></div>
          </div>
          <div class="chips">
            <button type="button" class="chip" data-a="adj" data-f="w" data-d="${step}">+${fmtNum(step)} ${unit()}</button>
            <button type="button" class="chip" data-a="adj" data-f="r" data-d="1">+1 rep</button>
            ${sug.w != null && !editing ? `<button type="button" class="chip" data-a="useSug">Suggested ${fmtNum(toDisp(sug.w))} × ${sug.r}</button>` : ''}
            <button type="button" class="chip" data-a="dropSet">Drop set −20%</button>
          </div>
        </div>`);
      } else if (i < sets.length) {
        const s = sets[i];
        rows.push(`<button type="button" class="set-row ${s.pr ? 'pr' : ''}" data-a="editSet" data-i="${i}" aria-label="Edit set ${i + 1}"><span class="n">${i + 1}</span><span class="v">${s.w ? fmtNum(toDisp(s.w)) : (e.bodyweight ? 'BW' : '0')}</span><span class="v">${s.r}</span><span class="check done" style="${s.pr ? 'background:#FFD23F' : ''}">${s.pr ? '<b style="font-size:10px;color:#0E0F12">PR</b>' : I.check('#0E0F12')}</span></button>`);
      } else {
        const g = ui.edit;
        rows.push(`<div class="set-row ghost"><span class="n">${i + 1}</span><span class="v">${g.w == null ? '—' : fmtNum(g.w)}</span><span class="v">${g.r ?? '—'}</span><span></span></div>`);
      }
    }

    const hist = historyFor(exId, date, 3);
    const histHtml = hist.length ? hist.map((h) => `<div class="between"><span class="muted">${fmtDay(h.date)}</span><span>${h.sets.map((s) => `${s.w ? fmtNum(toDisp(s.w)) : 'BW'}×${s.r}`).join('  ')}</span></div>`).join('') : `<span class="muted">No history yet.</span>`;
    const nextId = exIds[pos + 1];

    let footer;
    if (editing) {
      footer = `<button type="button" class="btn danger" data-a="deleteSet">Delete</button><button type="button" class="btn" data-a="cancelEdit">Cancel</button><button type="button" class="btn primary" style="flex:1" data-a="saveSet">Save set</button>`;
    } else if (en.done) {
      footer = `<button type="button" class="btn" data-a="addSet">${I.plus()}Extra set</button><button type="button" class="btn primary" style="flex:1" data-a="${nextId ? 'nextEx' : 'backToday'}">${nextId ? 'Next: ' + esc(ex(nextId).name) : 'Back to today'}</button>`;
    } else {
      footer = `${sets.length ? `<button type="button" class="btn" data-a="finishEx">Finish</button>` : ''}<button type="button" class="btn primary" style="flex:1" data-a="logSet">Log set ${sets.length + 1}</button>`;
    }

    return `<main style="padding-bottom:170px">
      <div class="between">
        <button type="button" class="icon-btn" data-a="backToday" aria-label="Back">${I.back()}</button>
        <span class="small muted">${esc(planDay(dayId).name)}${pos >= 0 ? ` · ${pos + 1} of ${exIds.length}` : ''}</span>
        <button type="button" class="btn" style="height:44px" data-a="openSwap">${I.swap()}Swap</button>
      </div>
      <div class="col" style="gap:4px"><h1 class="title">${esc(e.name)}</h1><span class="small muted">${esc(D.muscles[e.muscle] || e.muscle)} · ${esc(D.equipLabel[e.equip] || e.equip)} · ${e.sets} × ${e.reps[0]}–${e.reps[1]}</span></div>
      <div class="hint">${I.trend('#C6F432')}<span>${sug.text.replace(/class="hl"/g, 'style="color:#C6F432"')}</span></div>
      <div class="col">
        <div class="sets-head"><span>Set</span><span>${unit()}</span><span>Reps</span><span></span></div>
        ${rows.join('')}
      </div>
      <label class="field">Notes<textarea id="inNote" placeholder="Seat height, grip, how it felt…">${esc(en.note || '')}</textarea></label>
      <div class="card col"><span class="small" style="font-weight:600">Previous sessions</span><div class="history">${histHtml}</div></div>
      <div style="position:fixed;left:50%;transform:translateX(-50%);bottom:0;width:100%;max-width:480px;padding:12px 20px calc(16px + var(--safe-b));background:linear-gradient(transparent,#0E0F12 30%);display:flex;gap:10px;z-index:22">${footer}</div>
    </main>`;
  }

  function defaultEdit(exId, sets, sug) {
    if (sets.length) { const l = sets[sets.length - 1]; return { w: l.w == null ? null : toDisp(l.w), r: l.r }; }
    return { w: sug.w == null ? null : toDisp(sug.w), r: sug.r };
  }

  // ---- Calendar
  function viewCalendar() {
    const m = ui.calMonth; const y = m.getFullYear(); const mo = m.getMonth();
    const first = new Date(y, mo, 1); const lead = (first.getDay() + 6) % 7;
    const days = new Date(y, mo + 1, 0).getDate();
    const today = dkey();
    const monthKeys = sessionKeys().filter((k) => k.startsWith(`${y}-${pad(mo + 1)}`) && hasSets(S.sessions[k]));
    const prs = monthKeys.reduce((a, k) => a + Object.values(S.sessions[k].entries).reduce((b, en) => b + (en.sets || []).filter((s) => s.pr).length, 0), 0);
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span></span>';
    for (let d = 1; d <= days; d++) {
      const k = `${y}-${pad(mo + 1)}-${pad(d)}`;
      const s = S.sessions[k]; const has = hasSets(s);
      const cls = [has ? s.type : (k < today ? 'past' : 'future'), k === today ? 'today' : '', ui.calSel === k ? 'sel' : ''].join(' ');
      const tag = has ? s.type.toUpperCase() : k === today ? 'TODAY' : '';
      cells += `<button type="button" class="${cls}" data-a="calSel" data-k="${k}" aria-label="${fmtDay(k)}${has ? ', ' + esc(s.dayName) : ''}"><span class="d">${d}</span><span class="tg">${tag}</span></button>`;
    }
    const sel = ui.calSel;
    let detail = '';
    if (sel) {
      const s = S.sessions[sel]; const dl = S.daily[sel] || {};
      const supp = `<span style="color:${dl.protein ? '#C6F432' : '#9AA3AF'}">Protein ${dl.protein ? '✓' : '—'}</span> · <span style="color:${dl.creatine ? '#C6F432' : '#9AA3AF'}">Creatine ${dl.creatine ? '✓' : '—'}</span>${S.body[sel] ? ' · ' + fmtW(S.body[sel]) : ''}`;
      if (hasSets(s)) {
        const list = Object.entries(s.entries).filter(([, en]) => en.sets && en.sets.length).map(([id, en]) => {
          const top = Math.max(...en.sets.map((x) => x.w || 0));
          return `<div class="between"><span>${esc(ex(id).name)} ${en.sets.some((x) => x.pr) ? '<span class="badge pr">PR</span>' : ''}</span><span class="muted">${en.sets.length} × ${en.sets.map((x) => x.r).join('/')} · ${top ? fmtW(top) : 'BW'}</span></div>`;
        }).join('');
        const mins = s.finishedAt && s.startedAt ? Math.round((s.finishedAt - s.startedAt) / 60000) : null;
        detail = `<div class="card col"><div class="between"><b>${fmtDay(sel)} · ${esc(s.dayName)}</b><span class="tiny muted">${mins && mins < 300 ? mins + ' min' : ''}</span></div><div class="history">${list}</div><div class="small">${supp}</div></div>`;
      } else {
        detail = `<div class="card col"><b>${fmtDay(sel)}</b><span class="small muted">No workout logged.</span><div class="small">${supp}</div></div>`;
      }
    }
    return `<main>
      <div class="between">
        <h1 class="title">${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h1>
        <div class="row" style="gap:8px"><button type="button" class="icon-btn" data-a="calNav" data-d="-1" aria-label="Previous month">${I.back()}</button><button type="button" class="icon-btn" data-a="calNav" data-d="1" aria-label="Next month">${I.fwd()}</button></div>
      </div>
      <div class="grid3">
        <div class="stat"><span class="k">Workouts</span><span class="v">${monthKeys.length}</span></div>
        <div class="stat"><span class="k">PRs</span><span class="v">${prs}</span></div>
        <div class="stat"><span class="k">Streak</span><span class="v">${streak()}</span></div>
      </div>
      <div class="col" style="gap:6px"><div class="cal-head"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div><div class="cal">${cells}</div></div>
      <div class="legend"><span><i style="background:#C6F432"></i>Push</span><span><i style="background:#5AB0FF"></i>Pull</span><span><i style="background:#FF8A3D"></i>Legs</span><span><i style="border:1px solid #3A3F48"></i>Rest</span></div>
      ${detail || '<p class="small muted" style="margin:0">Tap a day to see what you did.</p>'}
    </main>`;
  }

  // ---- Body
  function weightSeries(rangeDays) {
    const keys = Object.keys(S.body).sort();
    const cutoff = rangeDays ? dkey(addDays(new Date(), -rangeDays)) : '0000';
    return keys.filter((k) => k >= cutoff).map((k) => ({ k, w: S.body[k] }));
  }
  function avg7() {
    const pts = weightSeries(7); if (!pts.length) { const all = weightSeries(0); return all.length ? all[all.length - 1].w : null; }
    return pts.reduce((a, p) => a + p.w, 0) / pts.length;
  }
  function chartSVG(pts) {
    if (pts.length < 2) return `<div class="empty">${pts.length ? 'Log one more weigh-in to see your trend.' : 'No weigh-ins yet in this range.'}</div>`;
    const W = 320, H = 120, P = 8;
    const t0 = parseKey(pts[0].k).getTime(), t1 = parseKey(pts[pts.length - 1].k).getTime() || t0 + 1;
    const ws = pts.map((p) => toDisp(p.w)); let lo = Math.min(...ws), hi = Math.max(...ws);
    if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
    const x = (k) => P + ((parseKey(k).getTime() - t0) / Math.max(1, t1 - t0)) * (W - 2 * P);
    const y = (w) => P + (1 - (w - lo) / (hi - lo)) * (H - 2 * P);
    const line = pts.map((p) => `${x(p.k).toFixed(1)},${y(toDisp(p.w)).toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1];
    return `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Weight from ${fmtW(pts[0].w)} to ${fmtW(last.w)}">
      ${[0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${W}" y1="${H * f}" y2="${H * f}" stroke="#262A31"/>`).join('')}
      <polyline points="${line}" fill="none" stroke="#C6F432" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <circle cx="${x(last.k)}" cy="${y(toDisp(last.w))}" r="4" fill="#C6F432"/>
    </svg><div class="between tiny muted"><span>${fmtNum(lo)} – ${fmtNum(hi)} ${unit()}</span><span>${fmtDay(pts[0].k, { day: 'numeric', month: 'short' })} → ${fmtDay(last.k, { day: 'numeric', month: 'short' })}</span></div>`;
  }
  function bmi() {
    const h = S.settings.heightCm; const w = avg7();
    if (!h || !w) return null;
    const v = w / ((h / 100) ** 2);
    const cat = v < 18.5 ? 'Underweight' : v < 25 ? 'Healthy range' : v < 30 ? 'Overweight' : 'Obese range';
    return { v, cat };
  }
  function viewBody() {
    const ranges = { '1W': 7, '1M': 30, '3M': 90, '1Y': 365, All: 0 };
    const pts = weightSeries(ranges[ui.range]);
    const a = avg7();
    let change = '';
    if (pts.length >= 2) {
      const d = toDisp(pts[pts.length - 1].w) - toDisp(pts[0].w);
      change = `<span class="small" style="font-weight:600;color:${Math.abs(d) < 0.05 ? '#9AA3AF' : '#C6F432'}">${d > 0 ? '▲' : d < 0 ? '▼' : '•'} ${fmtNum(Math.abs(d))} ${unit()} · ${ui.range}</span>`;
    }
    const b = bmi();
    const stepsKeys = Object.keys(S.health).filter((k) => S.health[k].steps != null && k >= dkey(addDays(new Date(), -7))).sort();
    const steps = stepsKeys.length ? Math.round(stepsKeys.reduce((s, k) => s + S.health[k].steps, 0) / stepsKeys.length) : null;
    const lastHealth = Object.keys(S.health).sort().pop();
    const backupAge = S.lastBackup ? daysBetween(dkey(new Date(S.lastBackup)), dkey()) : null;
    return `<main>
      <div class="between"><h1 class="title">Body</h1><button type="button" class="icon-btn" data-a="openSettings" aria-label="Settings">${I.gear()}</button></div>
      <div class="card col" style="gap:12px">
        <div class="between" style="align-items:flex-end">
          <div class="col" style="gap:2px"><span class="tiny muted">Weight · 7-day average</span><span class="title" style="font-size:34px">${a == null ? '—' : fmtNum(toDisp(a))} <span class="small muted">${unit()}</span></span></div>
          ${change}
        </div>
        ${chartSVG(pts)}
        <div class="seg four" style="grid-template-columns:repeat(5,minmax(0,1fr))">${Object.keys(ranges).map((r) => `<button type="button" class="${ui.range === r ? 'on' : ''}" data-a="range" data-r="${r}">${r}</button>`).join('')}</div>
      </div>
      <div class="grid2">
        <button type="button" class="stat" style="text-align:left" data-a="openSettings"><span class="k">BMI</span><span class="v">${b ? fmtNum(b.v) : '—'}</span><span class="tiny" style="color:${b ? '#C6F432' : '#9AA3AF'}">${b ? b.cat : S.settings.heightCm ? 'Log your weight' : 'Add height in settings'}</span></button>
        <div class="stat"><span class="k">Steps · 7-day avg</span><span class="v">${steps == null ? '—' : steps.toLocaleString()}</span><span class="tiny muted">${steps == null ? 'Import from Apple Health' : 'from Apple Health'}</span></div>
      </div>
      <button type="button" class="btn primary block" data-a="logWeight">Log today's weight</button>
      <div class="list">
        <button type="button" data-a="healthImport">${I.heart()}<span class="body"><span class="name">Import from Apple Health</span><span class="tiny muted">${lastHealth ? 'Last import ' + fmtDay(lastHealth) : 'Run your Shortcut, then tap here'}</span></span>${I.chev()}</button>
        <button type="button" data-a="backup">${I.cloud()}<span class="body"><span class="name">Back up to iCloud Drive / Files</span><span class="tiny" style="color:${backupAge == null || backupAge > 7 ? '#FF8A3D' : '#9AA3AF'}">${backupAge == null ? 'Never backed up' : backupAge === 0 ? 'Backed up today' : `Last backup ${backupAge} day${backupAge === 1 ? '' : 's'} ago`}</span></span>${I.chev()}</button>
        <button type="button" data-a="tab" data-tab="photos">${I.camera()}<span class="body"><span class="name">Progress photos</span><span class="tiny muted">Stored only on this device</span></span>${I.chev()}</button>
      </div>
    </main>`;
  }

  // ---- Stats
  function weekRange(offset) {
    const s = addDays(weekStart(new Date()), offset * 7);
    return { start: dkey(s), end: dkey(addDays(s, 6)), s };
  }
  function weekData(offset) {
    const { start, end } = weekRange(offset);
    const keys = sessionKeys().filter((k) => k >= start && k <= end && hasSets(S.sessions[k]));
    const perMuscle = {}; let volume = 0, exercises = 0, prs = 0, sets = 0;
    for (const k of keys) {
      for (const [id, en] of Object.entries(S.sessions[k].entries)) {
        if (!en.sets || !en.sets.length) continue;
        exercises++;
        const m = ex(id).muscle;
        perMuscle[m] = (perMuscle[m] || 0) + en.sets.length;
        for (const st of en.sets) { volume += (st.w || 0) * st.r; sets++; if (st.pr) prs++; }
      }
    }
    return { keys, perMuscle, volume, exercises, prs, sets };
  }
  function muscleTargets() {
    const t = {};
    for (const d of S.plan) for (const id of d.exercises) { const e = ex(id); t[e.muscle] = (t[e.muscle] || 0) + e.sets; }
    return t;
  }
  function viewStats() {
    const wd = weekData(ui.statsWeek);
    const { s } = weekRange(ui.statsWeek);
    const tgt = muscleTargets();
    const vol = toDisp(wd.volume);
    const volTxt = vol >= 1000 ? fmtNum(vol / 1000) + 'k' : String(Math.round(vol));
    const bars = Object.keys(D.muscles).filter((m) => tgt[m]).map((m) => {
      const done = wd.perMuscle[m] || 0; const pct = Math.min(100, Math.round((done / tgt[m]) * 100));
      const c = pct >= 100 ? '#C6F432' : pct < 50 ? '#FF8A3D' : '#9AA3AF';
      return `<div class="mbar"><span>${D.muscles[m]}</span><div class="track"><div style="width:${pct}%;background:${c}"></div></div><span style="text-align:right" class="muted">${done}/${tgt[m]}</span></div>`;
    }).join('');
    const ins = buildInsights().map((i) => `<div class="insight"><span class="dot" style="background:${i.c}"></span><span style="flex:1">${i.t}${i.a ? `<br><button type="button" class="chip on" style="margin-top:8px" data-a="${i.a}">${i.al}</button>` : ''}</span></div>`).join('');
    const label = ui.statsWeek === 0 ? 'This week' : ui.statsWeek === -1 ? 'Last week' : 'Week of';
    // top lifts (best e1RM per exercise, last 8 weeks)
    const best = {};
    const cutoff = dkey(addDays(new Date(), -56));
    for (const k of sessionKeys().filter((k) => k >= cutoff)) for (const [id, en] of Object.entries(S.sessions[k].entries)) for (const st of en.sets || []) { const v = e1rm(st.w || 0, st.r); if (v > (best[id]?.v || 0)) best[id] = { v, st }; }
    const top = Object.entries(best).sort((a, b) => b[1].v - a[1].v).slice(0, 5).map(([id, b]) => `<div class="between"><span>${esc(ex(id).name)}</span><span class="muted">${fmtW(b.st.w)} × ${b.st.r} · ~${fmtNum(toDisp(b.v))} 1RM</span></div>`).join('');
    return `<main>
      <div class="between">
        <div class="col" style="gap:2px"><h1 class="title">${label}</h1><span class="small muted">${fmtDay(dkey(s), { day: 'numeric', month: 'short' })} – ${fmtDay(dkey(addDays(s, 6)), { day: 'numeric', month: 'short' })}</span></div>
        <div class="row" style="gap:8px"><button type="button" class="icon-btn" data-a="weekNav" data-d="-1" aria-label="Previous week">${I.back()}</button><button type="button" class="icon-btn" data-a="weekNav" data-d="1" aria-label="Next week" ${ui.statsWeek >= 0 ? 'disabled style="opacity:.4"' : ''}>${I.fwd()}</button></div>
      </div>
      <div class="grid4">
        <div class="stat"><span class="k">Workouts</span><span class="v">${wd.keys.length}/${S.plan.length}</span></div>
        <div class="stat"><span class="k">Exercises</span><span class="v">${wd.exercises}</span></div>
        <div class="stat"><span class="k">Volume ${unit()}</span><span class="v">${volTxt}</span></div>
        <div class="stat"><span class="k">PRs</span><span class="v" style="color:#FFD23F">${wd.prs}</span></div>
      </div>
      <div class="card col" style="gap:10px"><div class="between small"><b>Sets per muscle</b><span class="muted">done / weekly target</span></div>${bars}</div>
      <span class="h2">Insights</span>
      <div class="col">${ins || '<div class="empty">Log a few workouts and insights will show up here.</div>'}</div>
      ${top ? `<div class="card col"><b class="small">Top lifts · last 8 weeks</b><div class="history">${top}</div></div>` : ''}
    </main>`;
  }

  function buildInsights() {
    const out = [];
    const today = dkey();
    const keys = sessionKeys().filter((k) => hasSets(S.sessions[k]));
    const nd = nextDay();
    if (!keys.length) {
      out.push({ c: '#5AB0FF', t: `Start with <b>${esc(nd.name)}</b> — tap an exercise on Today to log your first set.` });
    } else {
      const gap = daysBetween(keys[keys.length - 1], today);
      if (gap >= 3) out.push({ c: '#FF8A3D', t: `It's been ${gap} days since your last workout. Next up: <b>${esc(nd.name)}</b>.` });
    }
    // muscles behind this week
    const wd = weekData(0); const tgt = muscleTargets();
    const dow = (new Date().getDay() + 6) % 7;
    if (keys.length && dow >= 3) {
      for (const m of Object.keys(tgt)) {
        const done = wd.perMuscle[m] || 0;
        if (done < tgt[m] * 0.5) {
          const start = planIndex(nd.id);
          let fix = null;
          for (let i = 0; i < S.plan.length; i++) { const d = S.plan[(start + i) % S.plan.length]; if (d.exercises.some((id) => ex(id).muscle === m)) { fix = d; break; } }
          out.push({ c: '#FF8A3D', t: `${D.muscles[m] || m} is ${tgt[m] - done} sets behind this week.${fix ? ` <b>${esc(fix.name)}</b> covers it.` : ''}` });
        }
      }
    }
    // stalled lifts
    const per = {};
    for (const k of keys) for (const [id, en] of Object.entries(S.sessions[k].entries)) if (en.sets && en.sets.length) (per[id] = per[id] || []).push(en.sets);
    for (const [id, list] of Object.entries(per)) {
      if (list.length < 3) continue;
      const last3 = list.slice(-3).map((sets) => { const w = Math.max(...sets.map((s) => s.w || 0)); return { w, r: sets.filter((s) => (s.w || 0) === w).reduce((a, s) => a + s.r, 0) }; });
      if (last3[0].w === last3[1].w && last3[1].w === last3[2].w && last3[2].r <= last3[0].r && last3[2].w > 0) {
        out.push({ c: '#FF8A3D', t: `${esc(ex(id).name)} has stayed at ${fmtW(last3[2].w)} for 3 sessions. Add 1–2 reps per set, or drop ~10% and build back up.` });
      }
    }
    // PRs this week
    if (wd.prs) out.push({ c: '#C6F432', t: `${wd.prs} personal record${wd.prs > 1 ? 's' : ''} this week. Keep the momentum.` });
    // supplements (last 7 days since app start)
    const span = Math.min(7, daysBetween(S.created, today) + 1);
    let p = 0, c = 0;
    for (let i = 0; i < span; i++) { const d = S.daily[dkey(addDays(new Date(), -i))] || {}; if (d.protein) p++; if (d.creatine) c++; }
    if (span >= 3) {
      if (c < span) out.push({ c: '#5AB0FF', t: `Creatine logged ${c} of the last ${span} days — it works best taken daily. Protein ${p}/${span}.` });
      else if (p < span) out.push({ c: '#5AB0FF', t: `Protein logged ${p} of the last ${span} days. Creatine ${c}/${span} — nice.` });
      else out.push({ c: '#C6F432', t: `Protein and creatine logged every day this week.` });
    }
    // weigh-ins
    const wk = Object.keys(S.body).sort();
    if (!wk.length) out.push({ c: '#5AB0FF', t: `Log your weight to start tracking your trend.`, a: 'logWeight', al: 'Log weight' });
    else {
      const g = daysBetween(wk[wk.length - 1], today);
      if (g >= 7) out.push({ c: '#FF8A3D', t: `No weigh-in for ${g} days.`, a: 'logWeight', al: 'Log weight' });
      const m = weightSeries(30);
      if (m.length >= 4) { const d = toDisp(m[m.length - 1].w) - toDisp(m[0].w); out.push({ c: '#5AB0FF', t: `Weight ${d < 0 ? 'down' : 'up'} ${fmtNum(Math.abs(d))} ${unit()} over the last 30 days.` }); }
    }
    if (!S.settings.heightCm) out.push({ c: '#5AB0FF', t: `Add your height in settings to see your BMI.`, a: 'openSettings', al: 'Open settings' });
    // backup
    const hasData = keys.length || wk.length;
    const age = S.lastBackup ? daysBetween(dkey(new Date(S.lastBackup)), today) : null;
    if (hasData && (age == null || age > 7)) out.push({ c: '#FF8A3D', t: age == null ? `You haven't backed up yet. Save a copy to iCloud Drive so you never lose your progress.` : `Last backup was ${age} days ago.`, a: 'backup', al: 'Back up now' });
    return out;
  }

  // ---- Settings
  function viewSettings() {
    const st = S.settings;
    const h = st.heightCm;
    const ft = h ? Math.floor(h / 2.54 / 12) : ''; const inch = h ? Math.round(h / 2.54 - ft * 12) : '';
    const plan = S.plan.map((d, di) => `<div class="card col"><div class="between"><b>${esc(d.name)}</b><span class="tiny muted">${esc(d.focus || '')}</span></div>
      ${d.exercises.map((id, i) => `<div class="between small" style="gap:6px"><span style="flex:1">${esc(ex(id).name)}</span>
        <button type="button" class="chip" data-a="planMove" data-day="${di}" data-i="${i}" data-d="-1" aria-label="Move up" ${i === 0 ? 'disabled style="opacity:.35"' : ''}>↑</button>
        <button type="button" class="chip" data-a="planSwap" data-day="${di}" data-i="${i}">Change</button>
        <button type="button" class="chip" data-a="planRemove" data-day="${di}" data-i="${i}" aria-label="Remove ${esc(ex(id).name)}">✕</button></div>`).join('')}
      <button type="button" class="btn ghost" style="height:40px" data-a="planAdd" data-day="${di}">${I.plus()}Add exercise</button></div>`).join('');
    return `<main>
      <div class="between"><button type="button" class="icon-btn" data-a="closeSettings" aria-label="Back">${I.back()}</button><h1 class="title" style="font-size:22px">Settings</h1><span style="width:44px"></span></div>
      <div class="card col" style="gap:14px">
        <div class="col"><span class="small muted">Units</span><div class="seg"><button type="button" class="${st.unit === 'kg' ? 'on' : ''}" data-a="setUnit" data-u="kg">kg / cm</button><button type="button" class="${st.unit === 'lb' ? 'on' : ''}" data-a="setUnit" data-u="lb">lb / ft</button></div></div>
        ${st.unit === 'kg'
          ? `<label class="field">Height (cm)<input id="inHeight" inputmode="decimal" value="${h ? Math.round(h) : ''}" placeholder="e.g. 180"></label>`
          : `<div class="grid2"><label class="field">Height (ft)<input id="inFt" inputmode="numeric" value="${ft}" placeholder="5"></label><label class="field">(in)<input id="inIn" inputmode="numeric" value="${inch}" placeholder="11"></label></div>`}
        <div class="col"><span class="small muted">Rest timer</span><div class="seg four">${[60, 90, 120, 180].map((s) => `<button type="button" class="${st.restSec === s ? 'on' : ''}" data-a="setRest" data-s="${s}">${s < 120 ? s + 's' : s / 60 + ' min'}</button>`).join('')}</div></div>
        <div class="between"><span>Sound effects</span><div class="seg" style="width:160px"><button type="button" class="${st.sound ? 'on' : ''}" data-a="setSound" data-v="1">On</button><button type="button" class="${!st.sound ? 'on' : ''}" data-a="setSound" data-v="0">Off</button></div></div>
      </div>
      <span class="h2">Data</span>
      <div class="list">
        <button type="button" data-a="backup">${I.cloud()}<span class="body"><span class="name">Back up now</span><span class="tiny muted">Choose “Save to Files” → iCloud Drive</span></span>${I.chev()}</button>
        <button type="button" data-a="import">${I.upload()}<span class="body"><span class="name">Restore from backup</span><span class="tiny muted">Pick a gym-backup .json file</span></span>${I.chev()}</button>
        <button type="button" data-a="healthHelp">${I.heart()}<span class="body"><span class="name">Set up Apple Health Shortcut</span><span class="tiny muted">One-time setup, about 3 minutes</span></span>${I.chev()}</button>
      </div>
      <span class="h2">Workout plan</span>
      <p class="small muted" style="margin:0">Days rotate in this order. “Change” here is permanent — use Swap during a workout for a one-off.</p>
      ${plan}
      <button type="button" class="btn block" data-a="resetPlan">Reset plan to default</button>
      <button type="button" class="btn danger block" data-a="eraseAll">Erase all data on this device</button>
      <p class="tiny muted" style="margin:0;text-align:center">All data is stored only on this device. Nothing is uploaded.</p>
    </main>`;
  }

  // ---- Photos
  function viewPhotos() {
    return `<main>
      <div class="between"><button type="button" class="icon-btn" data-a="tab" data-tab="body" aria-label="Back">${I.back()}</button><h1 class="title" style="font-size:22px">Progress photos</h1><span style="width:44px"></span></div>
      <button type="button" class="btn primary block" data-a="addPhoto">${I.plus()}Add photo</button>
      <p class="tiny muted" style="margin:0">Photos stay on this device and are not included in backups. Save the originals to your Photos library if you want them kept elsewhere.</p>
      <div class="photos" id="photoGrid"><div class="empty" style="grid-column:1/-1">Loading…</div></div>
    </main>`;
  }

  // ---------------------------------------------------------------- photos (IndexedDB)
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('gymtracker-photos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function photoTx(mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => { const tx = db.transaction('photos', mode); const st = tx.objectStore('photos'); const out = fn(st); tx.oncomplete = () => res(out && out.result !== undefined ? out.result : out); tx.onerror = () => rej(tx.error); });
  }
  let photoURLs = [];
  async function loadPhotos() {
    const grid = document.getElementById('photoGrid'); if (!grid) return;
    try {
      const all = await photoTx('readonly', (st) => st.getAll());
      photoURLs.forEach((u) => URL.revokeObjectURL(u)); photoURLs = [];
      if (!all.length) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1">No photos yet.</div>'; return; }
      all.sort((a, b) => (a.date < b.date ? 1 : -1));
      grid.innerHTML = all.map((p) => { const u = URL.createObjectURL(p.blob); photoURLs.push(u); return `<figure><button type="button" data-a="viewPhoto" data-id="${p.id}" style="all:unset;display:block;width:100%;height:100%;cursor:pointer" aria-label="Photo from ${fmtDay(p.date)}"><img src="${u}" alt=""></button><figcaption>${fmtDay(p.date, { day: 'numeric', month: 'short', year: '2-digit' })}</figcaption></figure>`; }).join('');
    } catch (e) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1">Photos are not available in this browser.</div>'; }
  }
  async function shrink(file) {
    try {
      const bmp = await createImageBitmap(file);
      const max = 1400; const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise((r) => c.toBlob((b) => r(b || file), 'image/jpeg', 0.85));
    } catch (e) { return file; }
  }

  // ---------------------------------------------------------------- overlays
  function sheet(inner) { $ov.innerHTML = `<div class="scrim" data-a="closeSheet"><div class="sheet" role="dialog" aria-modal="true" data-stop>${'<div class="grab"></div>' + inner}</div></div>`; const f = $ov.querySelector('input,textarea'); if (f) setTimeout(() => f.focus(), 50); }
  function closeOverlay() { $ov.innerHTML = ''; }
  let toastTimer;
  function toast(msg) {
    let t = document.querySelector('.toast'); if (t) t.remove();
    t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 2200);
  }
  function confetti() {
    const cols = ['#C6F432', '#FFD23F', '#FF8A3D', '#5AB0FF', '#F2F4F7'];
    return `<div class="confetti" aria-hidden="true">${Array.from({ length: 28 }, (_, i) => `<i style="left:${Math.random() * 100}%;background:${cols[i % cols.length]};animation-delay:${(Math.random() * 0.5).toFixed(2)}s;transform:rotate(${Math.random() * 180}deg)"></i>`).join('')}</div>`;
  }
  function showPR(exId, set, info) {
    play('pr');
    const up = info.prevE ? toDisp(info.e) - toDisp(info.prevE) : 0;
    $ov.innerHTML = `<div class="pr-screen" role="dialog" aria-modal="true" aria-label="New personal record">${confetti()}<div class="inner">
      <div class="trophy">${I.trophy()}</div>
      <div class="col" style="align-items:center;gap:6px"><span class="pr-label">New personal record</span><span class="pr-big">${set.w ? fmtNum(toDisp(set.w)) + ' ' + unit() : 'BW'} × ${set.r}</span><span class="muted">${esc(ex(exId).name)} · ${info.kind}</span></div>
      <div class="grid2" style="width:100%"><div class="stat"><span class="k">Previous best</span><span class="v" style="font-size:17px">${info.prev}</span></div><div class="stat"><span class="k">Est. 1-rep max</span><span class="v" style="font-size:17px">${set.w ? fmtNum(toDisp(info.e)) + ' ' + unit() : '—'} ${up > 0.05 ? `<span class="small" style="color:#C6F432">▲ ${fmtNum(up)}</span>` : ''}</span></div></div>
      <span class="xp-chip">+100 XP · PR bonus</span>
      <button type="button" class="btn primary block" data-a="closeSheet">Keep going</button>
    </div></div>`;
  }
  function showWorkoutDone(sess) {
    play('workout');
    const ens = Object.values(sess.entries).filter((e) => e.sets && e.sets.length);
    const sets = ens.reduce((a, e) => a + e.sets.length, 0);
    const vol = ens.reduce((a, e) => a + e.sets.reduce((b, s) => b + (s.w || 0) * s.r, 0), 0);
    const prs = ens.reduce((a, e) => a + e.sets.filter((s) => s.pr).length, 0);
    const xp = sets * 5 + prs * 100 + ens.filter((e) => e.done).length * 20 + 50;
    const nd = S.plan[(planIndex(sess.dayId) + 1) % S.plan.length];
    $ov.innerHTML = `<div class="pr-screen workout" role="dialog" aria-modal="true" aria-label="Workout complete">${confetti()}<div class="inner">
      <div class="trophy">${I.check('#C6F432', 60)}</div>
      <div class="col" style="align-items:center;gap:6px"><span class="pr-label" style="color:#C6F432">Workout complete</span><span class="pr-big">${esc(sess.dayName)}</span><span class="muted">Next up: ${esc(nd.name)}</span></div>
      <div class="grid3" style="width:100%"><div class="stat"><span class="k">Exercises</span><span class="v">${ens.length}</span></div><div class="stat"><span class="k">Sets</span><span class="v">${sets}</span></div><div class="stat"><span class="k">PRs</span><span class="v" style="color:#FFD23F">${prs}</span></div></div>
      <span class="small muted">Volume ${Math.round(toDisp(vol)).toLocaleString()} ${unit()}</span>
      <span class="xp-chip">+${xp} XP</span>
      <button type="button" class="btn primary block" data-a="closeSheet">Done</button>
    </div></div>`;
  }

  function swapSheet(mode, ctx) {
    // mode 'session' (ctx.exId) or 'plan' (ctx.day, ctx.i) or 'add' (ctx.day)
    const curId = mode === 'session' ? ctx.exId : mode === 'plan' ? S.plan[ctx.day].exercises[ctx.i] : null;
    const cur = curId ? ex(curId) : null;
    const filter = ctx.filter || (cur ? 'group' : 'all');
    const all = allExercises();
    let list = Object.entries(all).filter(([id]) => id !== curId);
    if (cur && filter === 'group') list = list.filter(([, e]) => e.group === cur.group);
    else if (cur && filter === 'muscle') list = list.filter(([, e]) => e.muscle === cur.muscle);
    else if (cur && filter === 'machines') list = list.filter(([, e]) => e.muscle === cur.muscle && ['machine', 'cable', 'smith'].includes(e.equip));
    const today = dkey();
    list.sort((a, b) => (a[1].muscle + a[1].name).localeCompare(b[1].muscle + b[1].name));
    const rows = list.map(([id, e]) => {
      const last = lastPerformance(id, today + 'z');
      const lt = last ? `last ${fmtW(Math.max(...last.sets.map((s) => s.w || 0)))} × ${last.sets[0].r}` : 'not tried yet';
      return `<button type="button" class="opt" data-a="doSwap" data-id="${esc(id)}"><span class="body" style="flex:1;display:flex;flex-direction:column;gap:2px"><span style="font-weight:600">${esc(e.name)}</span><span class="tiny muted">${esc(D.equipLabel[e.equip] || e.equip)}${!cur || filter === 'all' ? ' · ' + esc(D.muscles[e.muscle] || e.muscle) : ''} · ${lt}</span></span></button>`;
    }).join('') || '<div class="empty">No matches — try another filter.</div>';
    const f = (k, l) => `<button type="button" class="chip ${filter === k ? 'on' : ''}" data-a="swapFilter" data-f="${k}">${l}</button>`;
    const title = mode === 'session' ? `<span class="small muted">Machine busy? Swap</span><h2 style="font-size:22px">${esc(cur.name)}</h2>` : mode === 'plan' ? `<span class="small muted">Permanently replace</span><h2 style="font-size:22px">${esc(cur.name)}</h2>` : `<span class="small muted">Add to ${esc(S.plan[ctx.day].name)}</span><h2 style="font-size:22px">Pick an exercise</h2>`;
    const applySeg = mode === 'session' ? `<div class="col"><span class="tiny muted">Apply swap</span><div class="seg"><button type="button" class="${ctx.always ? '' : 'on'}" data-a="swapScope" data-v="0">Just today</button><button type="button" class="${ctx.always ? 'on' : ''}" data-a="swapScope" data-v="1">Always</button></div></div>` : '';
    swapCtx = { mode, ...ctx, filter };
    sheet(`<div class="col" style="gap:4px">${title}</div>
      ${cur ? `<div class="chips">${f('group', 'Same movement')}${f('machines', 'Machines & cables')}${f('muscle', 'All ' + (D.muscles[cur.muscle] || '').toLowerCase())}${f('all', 'Everything')}</div>` : ''}
      ${applySeg}
      <div class="col">${rows}</div>
      <button type="button" class="opt" style="border-style:dashed;color:#9AA3AF" data-a="customEx">${I.plus()}Add my own exercise</button>`);
  }
  let swapCtx = null;

  function customExSheet() {
    const cur = swapCtx && swapCtx.mode !== 'add' ? ex(swapCtx.mode === 'session' ? swapCtx.exId : S.plan[swapCtx.day].exercises[swapCtx.i]) : null;
    sheet(`<h2 style="font-size:22px">New exercise</h2>
      <label class="field">Name<input id="cxName" placeholder="e.g. Hammer Strength row"></label>
      <div class="grid2">
        <label class="field">Muscle<select id="cxMuscle">${Object.entries(D.muscles).map(([k, v]) => `<option value="${k}" ${cur && cur.muscle === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field">Equipment<select id="cxEquip">${Object.entries(D.equipLabel).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      </div>
      <div class="grid3">
        <label class="field">Sets<input id="cxSets" inputmode="numeric" value="3"></label>
        <label class="field">Reps from<input id="cxLo" inputmode="numeric" value="8"></label>
        <label class="field">to<input id="cxHi" inputmode="numeric" value="12"></label>
      </div>
      <button type="button" class="btn primary block" data-a="saveCustomEx">Save and use</button>`);
  }

  function weightSheet() {
    const last = Object.keys(S.body).sort().pop();
    const v = S.body[dkey()] ?? (last ? S.body[last] : null);
    sheet(`<h2 style="font-size:22px">Today's weight</h2>
      <div class="stepper"><button type="button" data-a="wAdj" data-d="-0.1" aria-label="Decrease">−</button><label><input id="inBody" inputmode="decimal" value="${v == null ? '' : fmtNum(toDisp(v))}" placeholder="0.0" aria-label="Weight in ${unit()}"><span class="u">${unit()}</span></label><button type="button" data-a="wAdj" data-d="0.1" aria-label="Increase">+</button></div>
      <button type="button" class="btn primary block" data-a="saveWeight">Save</button>
      ${S.body[dkey()] != null ? '<button type="button" class="btn danger block" data-a="deleteWeight">Remove today\'s entry</button>' : ''}`);
  }

  function healthHelpSheet() {
    sheet(`<h2 style="font-size:22px">Apple Health Shortcut</h2>
      <p class="small muted" style="margin:0;line-height:1.5">Websites can't read Apple Health directly, so a Shortcut copies today's numbers and this app reads them. One-time setup in the <b>Shortcuts</b> app:</p>
      <ol class="small" style="margin:0;padding-left:20px;line-height:1.6">
        <li>New Shortcut → add <b>Find Health Samples</b>: Type <i>Weight</i>, Sort by <i>Start Date</i>, Latest first, Limit <i>1</i>.</li>
        <li>Add <b>Find Health Samples</b>: Type <i>Steps</i>, Start Date <i>is today</i>.</li>
        <li>Add <b>Calculate Statistics</b>: <i>Sum</i> of the Steps samples.</li>
        <li>Add <b>Text</b> and type <code>GYM weight=</code>, insert the Weight sample, then <code> steps=</code> and insert the Sum.</li>
        <li>Add <b>Copy to Clipboard</b> (the Text).</li>
        <li>Name it “Gym Sync” and add it to your Home Screen or run it with Siri.</li>
      </ol>
      <p class="small muted" style="margin:0;line-height:1.5">Then run “Gym Sync”, open this app and tap <b>Import from Apple Health</b> on the Body tab. The weight is read in the unit Health uses — if Health shows lb, include “lb” after the number.</p>
      <button type="button" class="btn primary block" data-a="closeSheet">Got it</button>`);
  }

  function pasteSheet() {
    sheet(`<h2 style="font-size:22px">Import health data</h2>
      <p class="small muted" style="margin:0">Paste what your Shortcut copied (e.g. <code>GYM weight=78.4 steps=9210</code>).</p>
      <label class="field">Text<textarea id="inHealth" placeholder="GYM weight=78.4 steps=9210"></textarea></label>
      <button type="button" class="btn primary block" data-a="healthParse">Import</button>
      <button type="button" class="btn block" data-a="healthHelp">How to set up the Shortcut</button>`);
  }

  // ---------------------------------------------------------------- rest timer
  let restInterval = null;
  function restBar() {
    if (!ui.rest) return '';
    const left = Math.max(0, Math.ceil((ui.rest.end - Date.now()) / 1000));
    const pct = 100 - Math.round((left / ui.rest.total) * 100);
    const mm = `${Math.floor(left / 60)}:${pad(left % 60)}`;
    return `<div class="rest ${left === 0 ? 'done' : ''}" id="restBar" style="${ui.tab === 'log' ? 'bottom:calc(84px + var(--safe-b))' : ''}">${I.timer()}<span class="t" id="restT">${left === 0 ? 'Go!' : mm}</span><div class="bar"><div id="restP" style="width:${pct}%"></div></div><button type="button" data-a="restAdd">+30s</button><button type="button" data-a="restStop">${left === 0 ? 'Close' : 'Skip'}</button></div>`;
  }
  function startRest() {
    ui.rest = { end: Date.now() + S.settings.restSec * 1000, total: S.settings.restSec, fired: false };
    clearInterval(restInterval);
    restInterval = setInterval(tickRest, 250);
  }
  function tickRest() {
    if (!ui.rest) { clearInterval(restInterval); return; }
    const left = Math.max(0, Math.ceil((ui.rest.end - Date.now()) / 1000));
    const t = document.getElementById('restT'); const p = document.getElementById('restP'); const bar = document.getElementById('restBar');
    if (t) t.textContent = left === 0 ? 'Go!' : `${Math.floor(left / 60)}:${pad(left % 60)}`;
    if (p) p.style.width = `${100 - Math.round((left / ui.rest.total) * 100)}%`;
    if (left === 0 && !ui.rest.fired) {
      ui.rest.fired = true; play('timer');
      if (bar) { bar.classList.add('done'); const b = bar.querySelectorAll('button')[1]; if (b) b.textContent = 'Close'; }
      setTimeout(() => { if (ui.rest && ui.rest.fired) { ui.rest = null; const rb = document.getElementById('restBar'); if (rb) rb.remove(); } }, 8000);
    }
  }

  // ---------------------------------------------------------------- actions
  function readEdit() {
    const w = document.getElementById('inW'); const r = document.getElementById('inR');
    if (w && ui.edit) ui.edit.w = w.value.trim() === '' ? null : num(w.value);
    if (r && ui.edit) ui.edit.r = r.value.trim() === '' ? null : Math.round(num(r.value) ?? 0);
  }
  function saveNote() {
    const n = document.getElementById('inNote'); if (!n || !ui.logEx) return;
    const sess = todaySession();
    if (!sess && !n.value.trim()) return;
    const s = ensureSession(currentDayId());
    const en = s.entries[ui.logEx] || (s.entries[ui.logEx] = { sets: [], done: false, note: '' });
    en.note = n.value; save();
  }
  function openEx(id) { ui.logEx = id; ui.editIndex = null; ui.edit = null; ui.tab = 'log'; render(); window.scrollTo(0, 0); }
  function markDoneIfComplete(en, e) { if (!en.done && en.sets.length >= e.sets) { en.done = true; return true; } return false; }
  function checkWorkoutComplete() {
    const sess = todaySession(); if (!sess || sess.finished) return false;
    const ids = sessionExercises(sess.dayId, sess);
    if (ids.every((id) => sess.entries[id] && sess.entries[id].done)) { sess.finished = true; sess.finishedAt = Date.now(); save(); return true; }
    return false;
  }

  const A = {
    tab: (d) => { saveNote(); ui.tab = d.tab; ui.calSel = ui.tab === 'calendar' ? ui.calSel : null; render(); window.scrollTo(0, 0); },
    pickDay: (d) => {
      const sess = todaySession();
      if (sess && hasSets(sess) && sess.dayId !== d.day) {
        if (!confirm(`You've already logged sets for ${sess.dayName} today. Switch today's workout to ${planDay(d.day).name}? Logged sets are kept.`)) return;
        const nd = planDay(d.day); sess.dayId = nd.id; sess.dayName = nd.name; sess.type = nd.type; sess.finished = false; save();
      } else if (sess && !hasSets(sess)) { const nd = planDay(d.day); sess.dayId = nd.id; sess.dayName = nd.name; sess.type = nd.type; save(); }
      ui.dayId = d.day; play('tap'); render();
    },
    openEx: (d) => openEx(d.ex),
    backToday: () => { saveNote(); ui.tab = 'today'; ui.logEx = null; render(); window.scrollTo(0, 0); },
    nextEx: () => {
      saveNote();
      const sess = todaySession(); const ids = sessionExercises(currentDayId(), sess);
      const n = ids[ids.indexOf(ui.logEx) + 1]; if (n) openEx(n); else A.backToday();
    },
    adj: (d) => {
      readEdit();
      const e = ex(ui.logEx); const delta = parseFloat(d.d);
      if (d.f === 'w') { const cur = ui.edit.w ?? 0; ui.edit.w = Math.max(0, roundDisp(cur + delta, e)); }
      else ui.edit.r = Math.max(0, (ui.edit.r ?? 0) + delta);
      play('tap'); render();
    },
    useSug: () => { const s = suggestion(ui.logEx, dkey()); ui.edit = { w: s.w == null ? null : toDisp(s.w), r: s.r }; play('tap'); render(); },
    dropSet: () => { readEdit(); const e = ex(ui.logEx); if (ui.edit.w) ui.edit.w = Math.max(0, roundDisp(ui.edit.w * 0.8, e)); play('tap'); render(); },
    logSet: () => {
      readEdit(); saveNote();
      const e = ex(ui.logEx);
      if (!ui.edit.r) { toast('Enter how many reps you did'); return; }
      if (ui.edit.w == null && !e.bodyweight) { toast('Enter the weight you used'); return; }
      const sess = ensureSession(currentDayId());
      const en = sess.entries[ui.logEx] || (sess.entries[ui.logEx] = { sets: [], done: false, note: '' });
      const set = { w: ui.edit.w == null ? 0 : fromDisp(ui.edit.w), r: ui.edit.r };
      const pr = checkPR(ui.logEx, set, en.sets);
      if (pr) set.pr = true;
      en.sets.push(set);
      const completed = markDoneIfComplete(en, e);
      const workoutDone = completed && checkWorkoutComplete();
      save();
      ui.edit = { ...ui.edit };
      startRest();
      render();
      if (pr) showPR(ui.logEx, set, pr);
      else if (workoutDone) showWorkoutDone(todaySession());
      else if (completed) { play('done'); toast(`${e.name} complete · +20 XP`); }
      else { play('set'); toast(`Set ${en.sets.length} logged · +5 XP`); }
      if (pr && workoutDone) pendingWorkoutDone = true;
    },
    finishEx: () => {
      saveNote();
      const sess = todaySession(); const en = sess && sess.entries[ui.logEx]; if (!en || !en.sets.length) return;
      en.done = true; const wd = checkWorkoutComplete(); save(); render();
      if (wd) showWorkoutDone(todaySession()); else { play('done'); toast(`${ex(ui.logEx).name} complete · +20 XP`); }
    },
    addSet: () => { const en = todaySession().entries[ui.logEx]; en.done = false; const s = todaySession(); if (s.finished) { s.finished = false; } save(); ui.edit = null; render(); },
    editSet: (d) => { readEdit(); const en = todaySession().entries[ui.logEx]; const s = en.sets[+d.i]; ui.editIndex = +d.i; ui.edit = { w: s.w == null ? null : toDisp(s.w), r: s.r }; render(); },
    cancelEdit: () => { ui.editIndex = null; ui.edit = null; render(); },
    saveSet: () => {
      readEdit();
      const en = todaySession().entries[ui.logEx]; const s = en.sets[ui.editIndex];
      s.w = ui.edit.w == null ? 0 : fromDisp(ui.edit.w); s.r = ui.edit.r || 0;
      delete s.pr; const pr = checkPR(ui.logEx, s, en.sets.slice(0, ui.editIndex)); if (pr) s.pr = true;
      save(); ui.editIndex = null; ui.edit = null; render(); toast('Set updated');
    },
    deleteSet: () => {
      const sess = todaySession(); const en = sess.entries[ui.logEx]; en.sets.splice(ui.editIndex, 1);
      if (en.sets.length < ex(ui.logEx).sets) en.done = false;
      if (!en.sets.length && !en.note) delete sess.entries[ui.logEx];
      sess.finished = false; save(); ui.editIndex = null; ui.edit = null; render(); toast('Set deleted');
    },
    finishWorkout: () => {
      const sess = todaySession(); if (!sess || !hasSets(sess)) return;
      if (!confirm('Finish this workout? Unlogged exercises will be skipped.')) return;
      sess.finished = true; sess.finishedAt = Date.now(); save(); render(); showWorkoutDone(sess);
    },
    supp: (d) => {
      const k = dkey(); const day = S.daily[k] || (S.daily[k] = {});
      day[d.k] = !day[d.k]; save(); render();
      if (day[d.k]) { play('pop'); toast(`${d.k === 'protein' ? 'Protein' : 'Creatine'} logged · +10 XP`); }
    },
    logWeight: () => weightSheet(),
    wAdj: (d) => { const i = document.getElementById('inBody'); const v = (num(i.value) ?? 0) + parseFloat(d.d); i.value = fmtNum(Math.max(0, v)); play('tap'); },
    saveWeight: () => {
      const v = num(document.getElementById('inBody').value);
      if (!v || v < 20 || v > 700) { toast('Enter a valid weight'); return; }
      const first = S.body[dkey()] == null;
      S.body[dkey()] = fromDisp(v); save(); closeOverlay(); render(); play('pop'); toast(first ? 'Weight logged · +5 XP' : 'Weight updated');
    },
    deleteWeight: () => { delete S.body[dkey()]; save(); closeOverlay(); render(); },
    range: (d) => { ui.range = d.r; render(); },
    calSel: (d) => { ui.calSel = d.k; play('tap'); render(); },
    calNav: (d) => { ui.calMonth = new Date(ui.calMonth.getFullYear(), ui.calMonth.getMonth() + (+d.d), 1); ui.calSel = null; render(); },
    weekNav: (d) => { ui.statsWeek = Math.min(0, ui.statsWeek + (+d.d)); render(); },
    openSettings: () => { closeOverlay(); ui.settingsFrom = ui.tab; ui.tab = 'settings'; render(); window.scrollTo(0, 0); },
    closeSettings: () => { saveHeight(); ui.tab = ui.settingsFrom === 'settings' ? 'today' : ui.settingsFrom; render(); },
    setUnit: (d) => { saveHeight(); S.settings.unit = d.u; save(); render(); },
    setRest: (d) => { S.settings.restSec = +d.s; save(); render(); },
    setSound: (d) => { S.settings.sound = d.v === '1'; save(); render(); if (S.settings.sound) play('pop'); },
    // swaps
    openSwap: () => {
      const sess = todaySession(); const en = sess && sess.entries[ui.logEx];
      if (en && en.sets.length) { toast('Delete the logged sets first to swap this exercise'); return; }
      swapSheet('session', { exId: ui.logEx, always: false });
    },
    swapFilter: (d) => swapSheet(swapCtx.mode, { ...swapCtx, filter: d.f }),
    swapScope: (d) => { swapCtx.always = d.v === '1'; $ov.querySelectorAll('[data-a="swapScope"]').forEach((b) => b.classList.toggle('on', b.dataset.v === d.v)); },
    doSwap: (d) => applySwap(d.id),
    customEx: () => customExSheet(),
    saveCustomEx: () => {
      const name = document.getElementById('cxName').value.trim(); if (!name) { toast('Give it a name'); return; }
      const muscle = document.getElementById('cxMuscle').value; const equip = document.getElementById('cxEquip').value;
      const sets = clamp(parseInt(document.getElementById('cxSets').value, 10) || 3, 1, 10);
      const lo = clamp(parseInt(document.getElementById('cxLo').value, 10) || 8, 1, 50); const hi = clamp(parseInt(document.getElementById('cxHi').value, 10) || lo, lo, 60);
      const id = 'custom_' + uid();
      S.customExercises[id] = { name, muscle, group: 'custom-' + muscle, equip, inc: equip === 'dumbbell' ? 2 : 2.5, reps: [lo, hi], sets, bodyweight: equip === 'bodyweight', custom: true };
      save(); applySwap(id);
    },
    planSwap: (d) => swapSheet('plan', { day: +d.day, i: +d.i }),
    planAdd: (d) => swapSheet('add', { day: +d.day, filter: 'all' }),
    planRemove: (d) => { const day = S.plan[+d.day]; if (day.exercises.length <= 1) { toast('A day needs at least one exercise'); return; } day.exercises.splice(+d.i, 1); save(); render(); },
    planMove: (d) => { const ex_ = S.plan[+d.day].exercises; const i = +d.i, j = i + (+d.d); if (j < 0 || j >= ex_.length) return; [ex_[i], ex_[j]] = [ex_[j], ex_[i]]; save(); render(); },
    resetPlan: () => { if (confirm('Reset the workout plan to the default 5-day rotation? Your logged history is kept.')) { S.plan = JSON.parse(JSON.stringify(D.days)); save(); render(); toast('Plan reset'); } },
    eraseAll: async () => {
      if (!confirm('Erase ALL workouts, weights and settings on this device? Make a backup first if you want to keep them.')) return;
      if (!confirm('Are you sure? This cannot be undone.')) return;
      localStorage.removeItem(KEY); try { await photoTx('readwrite', (st) => st.clear()); } catch (e) { /* ignore */ }
      S = defaultState(); ui.tab = 'today'; render(); toast('All data erased');
    },
    // data
    backup: () => doBackup(),
    import: () => document.getElementById('importFile').click(),
    healthHelp: () => healthHelpSheet(),
    healthImport: async () => {
      let text = '';
      try { if (navigator.clipboard && navigator.clipboard.readText) text = await navigator.clipboard.readText(); } catch (e) { text = ''; }
      if (text && /weight|steps/i.test(text)) { importHealthText(text); } else pasteSheet();
    },
    healthParse: () => importHealthText(document.getElementById('inHealth').value),
    // photos
    addPhoto: () => document.getElementById('photoFile').click(),
    viewPhoto: async (d) => {
      const p = await photoTx('readonly', (st) => st.get(d.id)); if (!p) return;
      const u = URL.createObjectURL(p.blob); photoURLs.push(u);
      sheet(`<b>${fmtDay(p.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</b><img src="${u}" alt="Progress photo" style="width:100%;border-radius:12px"><button type="button" class="btn danger block" data-a="deletePhoto" data-id="${p.id}">Delete photo</button>`);
    },
    deletePhoto: async (d) => { if (!confirm('Delete this photo?')) return; await photoTx('readwrite', (st) => st.delete(d.id)); closeOverlay(); loadPhotos(); },
    // timer
    restAdd: () => { if (!ui.rest) return; if (ui.rest.fired) { ui.rest = { end: Date.now() + 30000, total: 30, fired: false }; clearInterval(restInterval); restInterval = setInterval(tickRest, 250); render(); return; } ui.rest.end += 30000; ui.rest.total += 30; },
    restStop: () => { ui.rest = null; clearInterval(restInterval); const rb = document.getElementById('restBar'); if (rb) rb.remove(); },
    closeSheet: () => { closeOverlay(); if (pendingWorkoutDone) { pendingWorkoutDone = false; showWorkoutDone(todaySession()); } },
  };
  let pendingWorkoutDone = false;

  function saveHeight() {
    const c = document.getElementById('inHeight'); const f = document.getElementById('inFt'); const i = document.getElementById('inIn');
    if (c) { const v = num(c.value); S.settings.heightCm = v && v > 80 && v < 260 ? v : (c.value.trim() ? S.settings.heightCm : null); }
    else if (f) { const ft = num(f.value) || 0; const inch = num(i.value) || 0; const cm = (ft * 12 + inch) * 2.54; S.settings.heightCm = cm > 80 && cm < 260 ? cm : (f.value.trim() ? S.settings.heightCm : null); }
    save();
  }

  function applySwap(newId) {
    const c = swapCtx; if (!c) return;
    if (c.mode === 'session') {
      const dayId = currentDayId(); const day = planDay(dayId);
      const sess = ensureSession(dayId);
      // find the plan slot currently showing c.exId
      const slot = day.exercises.findIndex((id) => ((sess.swaps && sess.swaps[id]) || id) === c.exId);
      if (c.always) {
        if (slot >= 0) { delete sess.swaps[day.exercises[slot]]; day.exercises[slot] = newId; }
      } else if (slot >= 0) {
        const orig = day.exercises[slot];
        if (orig === newId) delete sess.swaps[orig]; else sess.swaps[orig] = newId;
      }
      if (sess.entries[c.exId] && !sess.entries[c.exId].sets.length) delete sess.entries[c.exId];
      save(); closeOverlay(); toast(`Swapped to ${ex(newId).name}${c.always ? ' (permanent)' : ' for today'}`); openEx(newId);
    } else if (c.mode === 'plan') {
      S.plan[c.day].exercises[c.i] = newId; save(); closeOverlay(); render(); toast('Plan updated');
    } else {
      S.plan[c.day].exercises.push(newId); save(); closeOverlay(); render(); toast(`Added to ${S.plan[c.day].name}`);
    }
  }

  function importHealthText(text) {
    const t = String(text || '');
    const wm = t.match(/weight\s*[=:]\s*([\d.,]+)\s*(kg|lb|lbs|pounds|st)?/i);
    const sm = t.match(/steps\s*[=:]\s*([\d.,]+)/i);
    if (!wm && !sm) { toast('No weight or steps found in that text'); return; }
    const k = dkey(); const msgs = [];
    if (wm) {
      let w = num(wm[1].replace(/,(?=\d{3}\b)/g, ''));
      const u = (wm[2] || '').toLowerCase();
      if (w) {
        if (u.startsWith('lb') || u === 'pounds') w = w / LB;
        else if (!u && unit() === 'lb' && w > 140) w = w / LB; // assume Health uses lb
        if (w > 20 && w < 350) { S.body[k] = w; msgs.push(fmtW(w)); }
      }
    }
    if (sm) { const s = Math.round(num(sm[1].replace(/,/g, '')) || 0); S.health[k] = { ...(S.health[k] || {}), steps: s }; msgs.push(`${s.toLocaleString()} steps`); }
    save(); closeOverlay(); render(); play('pop'); toast(`Imported ${msgs.join(' · ') || 'nothing'}`);
  }

  async function doBackup() {
    const payload = { app: 'gym-tracker', version: 1, exportedAt: new Date().toISOString(), data: S };
    const name = `gym-backup-${dkey()}.json`;
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Gym Tracker backup' });
        S.lastBackup = Date.now(); save(); render(); toast('Backup saved'); return;
      }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    S.lastBackup = Date.now(); save(); render(); toast('Backup downloaded');
  }

  document.getElementById('importFile').addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const data = j && j.app === 'gym-tracker' ? j.data : j;
      if (!data || typeof data !== 'object' || !data.sessions) throw new Error('bad');
      const n = Object.keys(data.sessions).length;
      if (!confirm(`Restore backup from ${j.exportedAt ? new Date(j.exportedAt).toLocaleString() : 'file'} (${n} workouts)? This replaces the data on this device.`)) return;
      S = migrate(data); save(); ui.tab = 'today'; render(); play('done'); toast('Backup restored');
    } catch (e) { toast('That file is not a Gym Tracker backup'); }
  });
  document.getElementById('photoFile').addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    try { const blob = await shrink(f); await photoTx('readwrite', (st) => st.put({ id: uid(), date: dkey(), blob })); play('pop'); toast('Photo saved'); loadPhotos(); }
    catch (e) { toast('Could not save photo'); }
  });

  // event delegation
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-a]');
    if (!el) return;
    if (el.classList.contains('scrim') && ev.target.closest('[data-stop]')) return; // clicks inside sheet
    const fn = A[el.dataset.a];
    if (fn) { ev.preventDefault(); fn(el.dataset, el); }
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && $ov.innerHTML) A.closeSheet();
    if (ev.key === 'Enter' && (ev.target.id === 'inW' || ev.target.id === 'inR') && ui.tab === 'log') { ev.preventDefault(); if (ui.editIndex != null) A.saveSet(); else if (document.querySelector('[data-a="logSet"]')) A.logSet(); }
    if (ev.key === 'Enter' && ev.target.id === 'inBody') { ev.preventDefault(); A.saveWeight(); }
  });
  document.addEventListener('focusin', (ev) => { if (ev.target.id === 'inW' || ev.target.id === 'inR' || ev.target.id === 'inBody') setTimeout(() => ev.target.select && ev.target.select(), 0); });
  document.addEventListener('input', (ev) => { if (ev.target.id === 'inW' || ev.target.id === 'inR') readEdit(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { if (ui.rest) tickRest(); if (ui.tab === 'today') render(); } else saveNote(); });

  // URL import, e.g. #health?weight=78.4&steps=9000
  if (location.hash.startsWith('#health')) {
    const q = location.hash.split('?')[1] || '';
    const p = new URLSearchParams(q); const txt = `weight=${p.get('weight') || ''}${p.get('unit') || ''} steps=${p.get('steps') || ''}`;
    history.replaceState(null, '', location.pathname);
    setTimeout(() => importHealthText(txt), 300);
  }

  // offline support
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  // test hook (harmless in production)
  window.__gym = { get state() { return S; }, ui, render };

  render();
})();
