/* Part 107 Flight Deck: app logic. Plain JavaScript, no build step, no dependencies. */
(function () {
  'use strict';

  // ---------- Data ----------
  const DATA = window.P107 || {};
  const QUESTIONS = Array.isArray(DATA.QUESTIONS) ? DATA.QUESTIONS : [];
  const CATEGORIES = Array.isArray(DATA.CATEGORIES) ? DATA.CATEGORIES : [];
  const DIFFICULTIES = Array.isArray(DATA.DIFFICULTIES) ? DATA.DIFFICULTIES : [];
  const BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));
  const ALL_IDS = QUESTIONS.map((q) => q.id);
  const TOTAL = ALL_IDS.length;
  const COUNT_BY_CAT = {};
  for (const c of CATEGORIES) COUNT_BY_CAT[c] = QUESTIONS.filter((q) => q.category === c).length;

  const STORE_KEY = 'p107-flight-deck/v1';
  const SIZES = [10, 30, 60, 100];
  const EXAM_SIZE = 60;
  const EXAM_MS = 120 * 60 * 1000;
  const PASS = 70;
  const REVIEW_BATCH = 30;
  const LIB_PAGE = 30;
  const CHOICE_KEYS = ['c', 'd1', 'd2', 'd3'];
  const RESULTS = ['correct', 'correct2', 'missed', 'revealed', 'skipped'];
  const MODES = ['practice', 'exam', 'review'];
  const THEMES = ['system', 'light', 'dark'];

  const SUBJECTS = {
    'Regulations': { icon: 'i-scale', tone: 'reg' },
    'Airspace & Charts': { icon: 'i-map', tone: 'air' },
    'Weather': { icon: 'i-cloud', tone: 'wx' },
    'Airport & Radio': { icon: 'i-radio', tone: 'apt' },
    'Performance & Loading': { icon: 'i-gauge', tone: 'perf' },
    'ADM & Human Factors': { icon: 'i-bulb', tone: 'adm' },
    'Operations & Safety': { icon: 'i-shield', tone: 'ops' },
  };
  const subjectMeta = (c) => SUBJECTS[c] || { icon: 'i-book', tone: 'reg' };
  const PRAISE = ['Correct!', 'Nice work!', 'Spot on!', 'Exactly right!', 'You got it!'];

  // ---------- Small helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const icon = (id, cls) => `<svg class="icon${cls ? ' ' + cls : ''}" aria-hidden="true" focusable="false"><use href="#${id}"></use></svg>`;
  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);
  const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many || one + 's'}`;
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const int = (x, fallback) => (Number.isFinite(Number(x)) ? Math.floor(Number(x)) : fallback);

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, rand) {
    const next = rand || Math.random;
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function dayKey(d) {
    const date = d || new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function daysBetween(a, b) {
    const pa = a.split('-').map(Number);
    const pb = b.split('-').map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  }

  function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function formatDate(ts) {
    try {
      return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch (e) {
      return '';
    }
  }

  // ---------- Saved state ----------
  function freshState() {
    return {
      v: 1,
      mastery: {},     // id -> 'mastered' | 'review'
      stats: {},       // id -> [times answered, times correct on the first try]
      usedIds: [],     // ids drawn so far in the current rotation
      lastIds: [],     // ids from the most recently drawn session, held back next time
      sessionCount: 0,
      session: null,
      history: [],     // finished sessions, newest first
      streak: { count: 0, last: null },
      settings: { theme: 'system', builder: { mode: 'practice', size: 30, subject: null } },
    };
  }

  const known = (id) => BY_ID.has(id);
  const idList = (x) => (Array.isArray(x) ? Array.from(new Set(x.map(Number).filter(known))) : []);

  function sanitizeSession(x) {
    if (!x || typeof x !== 'object' || !MODES.includes(x.mode)) return null;
    const ids = idList(x.ids);
    if (!ids.length) return null;
    const exam = x.mode === 'exam';
    const answers = {};
    const src = x.answers && typeof x.answers === 'object' ? x.answers : {};
    for (const id of ids) {
      const a = src[id];
      if (!a || typeof a !== 'object') continue;
      const result = RESULTS.includes(a.result) ? a.result : null;
      if (exam) {
        answers[id] = { pick: CHOICE_KEYS.includes(a.pick) ? a.pick : null, flagged: !!a.flagged, result };
      } else {
        const picks = Array.isArray(a.picks) ? Array.from(new Set(a.picks.filter((k) => CHOICE_KEYS.includes(k)))).slice(0, 2) : [];
        answers[id] = { picks, result, flagged: !!a.flagged };
      }
    }
    const startedAt = Number.isFinite(x.startedAt) ? x.startedAt : Date.now();
    return {
      number: Math.max(1, int(x.number, 1)),
      mode: x.mode,
      subject: CATEGORIES.includes(x.subject) ? x.subject : null,
      ids,
      pos: Math.min(Math.max(0, int(x.pos, 0)), ids.length - 1),
      answers,
      seed: Number.isFinite(x.seed) ? x.seed >>> 0 : 1,
      startedAt,
      deadline: exam ? (Number.isFinite(x.deadline) ? x.deadline : startedAt + EXAM_MS) : null,
      finishedAt: Number.isFinite(x.finishedAt) ? x.finishedAt : null,
      timeUp: !!x.timeUp,
      note: typeof x.note === 'string' ? x.note.slice(0, 240) : '',
    };
  }

  function sanitize(raw) {
    const s = freshState();
    if (!raw || typeof raw !== 'object') return s;
    if (raw.mastery && typeof raw.mastery === 'object') {
      for (const [k, v] of Object.entries(raw.mastery)) {
        const id = Number(k);
        if (known(id) && (v === 'mastered' || v === 'review')) s.mastery[id] = v;
      }
    }
    if (raw.stats && typeof raw.stats === 'object') {
      for (const [k, v] of Object.entries(raw.stats)) {
        const id = Number(k);
        if (!known(id) || !Array.isArray(v)) continue;
        const n = Math.max(0, int(v[0], 0));
        const c = Math.min(n, Math.max(0, int(v[1], 0)));
        if (n > 0) s.stats[id] = [n, c];
      }
    }
    s.usedIds = idList(raw.usedIds);
    s.lastIds = idList(raw.lastIds);
    s.sessionCount = Math.max(0, int(raw.sessionCount, 0));
    s.session = sanitizeSession(raw.session);
    if (s.session) s.sessionCount = Math.max(s.sessionCount, s.session.number);
    if (Array.isArray(raw.history)) {
      s.history = raw.history
        .filter((h) => h && typeof h === 'object' && MODES.includes(h.mode) && Number.isFinite(h.total) && Number.isFinite(h.correct))
        .slice(0, 20)
        .map((h) => ({
          n: Math.max(1, int(h.n, 1)),
          mode: h.mode,
          subject: CATEGORIES.includes(h.subject) ? h.subject : null,
          correct: Math.max(0, int(h.correct, 0)),
          total: Math.max(0, int(h.total, 0)),
          date: Number.isFinite(h.date) ? h.date : Date.now(),
        }));
    }
    if (raw.streak && typeof raw.streak === 'object' && typeof raw.streak.last === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.streak.last)) {
      s.streak = { count: Math.max(0, int(raw.streak.count, 0)), last: raw.streak.last };
    }
    const set = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    if (THEMES.includes(set.theme)) s.settings.theme = set.theme;
    const b = set.builder && typeof set.builder === 'object' ? set.builder : {};
    s.settings.builder = {
      mode: b.mode === 'exam' ? 'exam' : 'practice',
      size: SIZES.includes(b.size) ? b.size : 30,
      subject: CATEGORIES.includes(b.subject) ? b.subject : null,
    };
    return s;
  }

  function load() {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      return raw ? sanitize(JSON.parse(raw)) : freshState();
    } catch (e) {
      return freshState();
    }
  }

  function save() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      /* Storage can be full or blocked; the app keeps working for this visit. */
    }
  }

  let state = load();

  // ---------- Progress math ----------
  function recordStat(id, correct) {
    const st = state.stats[id] || [0, 0];
    st[0] += 1;
    if (correct) st[1] += 1;
    state.stats[id] = st;
  }

  function bumpStreak() {
    const today = dayKey();
    const st = state.streak;
    if (st.last === today) return;
    const gap = st.last ? daysBetween(st.last, today) : null;
    st.count = gap === 1 ? st.count + 1 : 1;
    st.last = today;
  }

  function currentStreak() {
    const st = state.streak;
    if (!st.last) return 0;
    const gap = daysBetween(st.last, dayKey());
    return gap >= 0 && gap <= 1 ? st.count : 0;
  }

  const isExplored = (id) => !!state.stats[id] || !!state.mastery[id];

  function tally(ids) {
    let answered = 0, first = 0, explored = 0, mastered = 0, review = 0;
    for (const id of ids) {
      const st = state.stats[id];
      if (st) { answered += st[0]; first += st[1]; }
      if (isExplored(id)) explored++;
      if (state.mastery[id] === 'mastered') mastered++;
      if (state.mastery[id] === 'review') review++;
    }
    return { total: ids.length, answered, first, explored, mastered, review, accuracy: answered ? pct(first, answered) : null };
  }

  const idsIn = (cat) => ALL_IDS.filter((id) => BY_ID.get(id).category === cat);
  const reviewQueue = () => ALL_IDS.filter((id) => state.mastery[id] === 'review');
  const freshLeft = () => TOTAL - new Set(state.usedIds).size;

  // ---------- Drawing sessions ----------
  // Priority: never-drawn this rotation, then drawn earlier, and only as a last
  // resort anything from the previous session (small single-subject pools).
  function drawIds(size, subject) {
    const pool = subject ? idsIn(subject) : ALL_IDS.slice();
    const n = Math.min(size, pool.length);
    const prev = new Set(state.lastIds);
    const used = new Set(state.usedIds);
    const fresh = shuffle(pool.filter((id) => !prev.has(id) && !used.has(id)));
    const reused = shuffle(pool.filter((id) => !prev.has(id) && used.has(id)));
    const recent = shuffle(pool.filter((id) => prev.has(id)));
    const picked = fresh.concat(reused, recent).slice(0, n);
    const cycleReset = !subject && fresh.length < n;
    const nextUsed = cycleReset ? new Set(picked) : new Set(Array.from(used).concat(picked));
    return {
      ids: picked,
      usedIds: Array.from(nextUsed),
      cycleReset,
      repeatedRecent: picked.some((id) => prev.has(id)),
    };
  }

  function choicesFor(q, seed) {
    const base = [
      { key: 'c', text: q.answer, correct: true },
      { key: 'd1', text: q.distractors[0], correct: false },
      { key: 'd2', text: q.distractors[1], correct: false },
      { key: 'd3', text: q.distractors[2], correct: false },
    ];
    const rand = mulberry32((seed ^ Math.imul(q.id, 2654435761)) >>> 0);
    return shuffle(base, rand).map((c, i) => Object.assign({}, c, { label: 'ABCD'[i] }));
  }

  function sessionLabel(s) {
    if (s.mode === 'exam') return 'Exam simulation';
    if (s.mode === 'review') return 'Review session';
    return s.subject ? `${s.subject} practice` : 'Practice session';
  }

  function answerOf(s, id) {
    if (!s.answers[id]) s.answers[id] = s.mode === 'exam' ? { pick: null, flagged: false, result: null } : { picks: [], result: null, flagged: false };
    return s.answers[id];
  }

  function isDone(s, id) {
    const a = s.answers[id];
    if (!a) return false;
    return s.mode === 'exam' ? !!a.pick : !!a.result;
  }

  const answeredCount = (s) => s.ids.filter((id) => isDone(s, id)).length;

  function phaseOf(s, id) {
    const a = s.answers[id];
    if (!a || s.mode === 'exam') return s.mode === 'exam' ? 'exam' : 'answering';
    if (a.result) return 'done';
    return a.picks.length === 1 ? 'retry' : 'answering';
  }

  function summarize(s) {
    let total = 0, correct = 0;
    const bySubject = {};
    for (const id of s.ids) {
      const a = s.answers[id];
      const q = BY_ID.get(id);
      let counted = false, ok = false;
      if (s.mode === 'exam') { counted = true; ok = !!a && a.pick === 'c'; }
      else if (a && a.result) { counted = true; ok = a.result === 'correct'; }
      if (!counted) continue;
      total++;
      if (ok) correct++;
      const b = bySubject[q.category] || (bySubject[q.category] = { total: 0, correct: 0 });
      b.total++;
      if (ok) b.correct++;
    }
    return { total, correct, bySubject, missed: s.ids.filter((id) => { const a = s.answers[id]; return s.mode === 'exam' ? !(a && a.pick === 'c') : a && a.result && a.result !== 'correct'; }) };
  }

  // ---------- UI state (not saved) ----------
  const ui = {
    view: null,
    selected: null,
    flash: null,
    resultsTab: 'all',
    lib: { q: '', subject: '', diff: '', status: '', source: '', shown: LIB_PAGE },
    timer: null,
    toastTimer: null,
    firstRoute: true,
  };

  function announce(msg) {
    const live = $('#live');
    if (!live) return;
    live.textContent = '';
    window.setTimeout(() => { live.textContent = msg; }, 40);
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    window.clearTimeout(ui.toastTimer);
    ui.toastTimer = window.setTimeout(() => { el.hidden = true; }, 2800);
  }

  // ---------- Starting and ending sessions ----------
  function confirmReplace() {
    const cur = state.session;
    if (!cur || cur.finishedAt) return true;
    const done = answeredCount(cur);
    if (cur.mode === 'exam') {
      return window.confirm(`You have an exam simulation in progress (${done} of ${cur.ids.length} answered). Start something new and discard it?`);
    }
    if (done === 0) return true;
    return window.confirm(`You have a session in progress (${done} of ${cur.ids.length} answered). Start a new one instead? Answers you already checked still count toward your progress.`);
  }

  function startSession(opts) {
    if (!confirmReplace()) return;
    const mode = MODES.includes(opts.mode) ? opts.mode : 'practice';
    let ids, note, subject = null;
    if (mode === 'review') {
      const pool = (opts.ids && opts.ids.length ? opts.ids : reviewQueue()).filter(known);
      if (!pool.length) { toast('Nothing to review right now.'); return; }
      ids = shuffle(pool).slice(0, opts.size || REVIEW_BATCH);
      note = `Reviewing ${plural(ids.length, 'card')} you missed or saved. Get one right on the first try to clear it.`;
    } else {
      subject = mode === 'practice' && CATEGORIES.includes(opts.subject) ? opts.subject : null;
      const size = mode === 'exam' ? EXAM_SIZE : SIZES.includes(opts.size) ? opts.size : 30;
      const d = drawIds(size, subject);
      state.usedIds = d.usedIds;
      state.lastIds = d.ids;
      ids = shuffle(d.ids);
      if (mode === 'exam') note = 'The clock is running. Answer every question, then submit to see your score.';
      else if (d.cycleReset) note = 'You’ve now drawn every question once, so a fresh rotation has started.';
      else if (d.repeatedRecent) note = 'This subject is small, so a few cards from your last session are back.';
      else note = 'None of these cards were in your last session.';
    }
    const now = Date.now();
    state.sessionCount += 1;
    state.session = {
      number: state.sessionCount,
      mode,
      subject,
      ids,
      pos: 0,
      answers: {},
      seed: Math.floor(Math.random() * 4294967296) >>> 0,
      startedAt: now,
      deadline: mode === 'exam' ? now + EXAM_MS : null,
      finishedAt: null,
      timeUp: false,
      note,
    };
    ui.selected = null;
    ui.flash = null;
    save();
    navigate('study');
  }

  function finishSession(opts) {
    const o = opts || {};
    const s = state.session;
    if (!s || s.finishedAt) return;
    if (s.mode === 'exam') {
      for (const id of s.ids) {
        const a = answerOf(s, id);
        if (!a.pick) { a.result = 'skipped'; continue; }
        const correct = a.pick === 'c';
        a.result = correct ? 'correct' : 'missed';
        recordStat(id, correct);
        state.mastery[id] = correct ? 'mastered' : 'review';
      }
      if (s.ids.some((id) => s.answers[id] && s.answers[id].pick)) bumpStreak();
      s.timeUp = !!o.timeUp;
    }
    s.finishedAt = Date.now();
    const sum = summarize(s);
    state.history.unshift({ n: s.number, mode: s.mode, subject: s.subject, correct: sum.correct, total: sum.total, date: s.finishedAt });
    state.history = state.history.slice(0, 20);
    ui.resultsTab = 'all';
    stopTimer();
    save();
    if (o.navigate !== false) navigate('results');
  }

  function discardSession() {
    const s = state.session;
    if (!s || s.finishedAt) return;
    const msg = s.mode === 'exam'
      ? 'Discard this exam simulation? Its answers will not be scored.'
      : 'Discard this session? Answers you already checked still count toward your progress.';
    if (!window.confirm(msg)) return;
    state.session = null;
    save();
    toast('Session discarded.');
    route();
  }

  function endEarly() {
    const s = state.session;
    if (!s || s.finishedAt) return;
    if (s.mode === 'exam') return submitExam();
    const done = answeredCount(s);
    if (done === 0) {
      if (!window.confirm('End this session? You haven’t checked any answers yet, so it will be discarded.')) return;
      state.session = null;
      save();
      closeDialogs();
      navigate('study');
      return;
    }
    const left = s.ids.length - done;
    if (left > 0 && !window.confirm(`End now? The ${plural(left, 'card')} you haven’t answered won’t count.`)) return;
    finishSession();
  }

  function submitExam() {
    const s = state.session;
    if (!s || s.mode !== 'exam' || s.finishedAt) return;
    const left = s.ids.length - answeredCount(s);
    const msg = left > 0
      ? `Submit your exam? ${plural(left, 'question')} ${left === 1 ? 'is' : 'are'} unanswered and will count as incorrect.`
      : 'Submit your exam and see your score?';
    if (!window.confirm(msg)) return;
    finishSession();
  }

  function checkExamExpiry() {
    const s = state.session;
    if (s && s.mode === 'exam' && !s.finishedAt && Date.now() >= s.deadline) {
      finishSession({ navigate: false, timeUp: true });
      return true;
    }
    return false;
  }

  // ---------- Answering ----------
  function currentQuestion() {
    const s = state.session;
    return s ? BY_ID.get(s.ids[s.pos]) : null;
  }

  function selectChoice(key) {
    const s = state.session;
    const q = currentQuestion();
    if (!s || !q || s.finishedAt || !CHOICE_KEYS.includes(key)) return;
    if (s.mode === 'exam') {
      const a = answerOf(s, q.id);
      a.pick = key;
      bumpStreak();
      save();
    } else {
      const phase = phaseOf(s, q.id);
      const a = s.answers[q.id];
      if (phase === 'done' || (a && a.picks.includes(key))) return;
      ui.selected = key;
    }
    syncSelection();
  }

  function selectByIndex(i) {
    const s = state.session;
    const q = currentQuestion();
    if (!s || !q) return;
    const c = choicesFor(q, s.seed)[i];
    if (!c) return;
    const input = $(`#view-session input[name="choice"][value="${c.key}"]`);
    if (!input || input.disabled) return;
    input.checked = true;
    selectChoice(c.key);
  }

  function syncSelection() {
    const s = state.session;
    const q = currentQuestion();
    if (!s || !q) return;
    const key = s.mode === 'exam' ? (s.answers[q.id] && s.answers[q.id].pick) : ui.selected;
    for (const label of $$('#view-session .choice')) {
      const on = label.dataset.key === key;
      label.classList.toggle('is-selected', on);
      const input = $('input', label);
      if (input && !input.disabled) input.checked = on;
    }
    const check = $('#btn-check');
    if (check) check.disabled = !ui.selected;
    if (s.mode === 'exam') syncExamChrome();
  }

  function syncExamChrome() {
    const s = state.session;
    const done = answeredCount(s);
    const total = s.ids.length;
    const bar = $('#view-session .progress');
    if (bar) {
      bar.setAttribute('aria-valuenow', String(done));
      bar.setAttribute('aria-valuetext', `${done} of ${total} answered`);
      $('span', bar).style.width = `${pct(done, total)}%`;
    }
    const status = $('#exam-status');
    if (status) status.textContent = `${done} of ${total} answered`;
    renderChrome();
  }

  function check() {
    const s = state.session;
    const q = currentQuestion();
    if (!s || !q || s.mode === 'exam' || s.finishedAt) return;
    const key = ui.selected;
    const a = answerOf(s, q.id);
    if (a.result) return;
    if (!key || a.picks.includes(key)) { announce('Pick an answer first.'); return; }
    const first = a.picks.length === 0;
    const correct = key === 'c';
    a.picks.push(key);
    if (first) recordStat(q.id, correct);
    if (correct) a.result = first ? 'correct' : 'correct2';
    else if (a.picks.length >= 2) a.result = 'missed';
    if (a.result) settleMastery(q.id, a);
    ui.selected = null;
    ui.flash = { id: q.id, kind: correct ? 'correct' : 'wrong' };
    bumpStreak();
    save();
    const right = choicesFor(q, s.seed).find((c) => c.correct);
    if (a.result === 'correct' || a.result === 'correct2') announce(`Correct. ${right.label}: ${q.answer}`);
    else if (a.result === 'missed') announce(`Incorrect. The correct answer is ${right.label}: ${q.answer}`);
    else announce('Not quite. You have one more try.');
    renderSession({ focus: a.result ? 'continue' : 'choices' });
  }

  function reveal() {
    const s = state.session;
    const q = currentQuestion();
    if (!s || !q || s.mode === 'exam' || s.finishedAt) return;
    const a = answerOf(s, q.id);
    if (a.result) return;
    if (a.picks.length === 0) recordStat(q.id, false);
    a.result = 'revealed';
    settleMastery(q.id, a);
    ui.selected = null;
    bumpStreak();
    save();
    const right = choicesFor(q, s.seed).find((c) => c.correct);
    announce(`The answer is ${right.label}: ${q.answer}`);
    renderSession({ focus: 'continue' });
  }

  function settleMastery(id, a) {
    state.mastery[id] = a.result === 'correct' && !a.flagged ? 'mastered' : 'review';
  }

  function toggleFlag() {
    const s = state.session;
    const q = currentQuestion();
    if (!s || !q || s.finishedAt) return;
    const a = answerOf(s, q.id);
    a.flagged = !a.flagged;
    if (s.mode !== 'exam' && a.result) settleMastery(q.id, a);
    save();
    announce(s.mode === 'exam' ? (a.flagged ? 'Flagged to revisit.' : 'Flag removed.') : (a.flagged ? 'Saved to your review list.' : 'Removed from your review list.'));
    renderSession({ focus: 'flag' });
  }

  function goTo(index) {
    const s = state.session;
    if (!s || index < 0 || index >= s.ids.length) return;
    s.pos = index;
    ui.selected = null;
    save();
    renderSession({ focus: 'question' });
  }

  function advance() {
    const s = state.session;
    if (!s) return;
    const n = s.ids.length;
    for (let step = 1; step <= n; step++) {
      const i = (s.pos + step) % n;
      if (!isDone(s, s.ids[i])) { goTo(i); return; }
    }
    finishSession();
  }

  function primaryAction() {
    const s = state.session;
    const q = currentQuestion();
    if (!s || !q || s.finishedAt) return;
    if (s.mode === 'exam') {
      if (s.pos < s.ids.length - 1) goTo(s.pos + 1);
      else submitExam();
      return;
    }
    if (phaseOf(s, q.id) === 'done') advance();
    else check();
  }

  // ---------- Exam timer ----------
  function startTimer() {
    stopTimer();
    ui.timer = window.setInterval(tick, 1000);
    tick();
  }

  function stopTimer() {
    if (ui.timer) window.clearInterval(ui.timer);
    ui.timer = null;
  }

  function tick() {
    const s = state.session;
    if (!s || s.mode !== 'exam' || s.finishedAt) { stopTimer(); return; }
    const left = s.deadline - Date.now();
    const el = $('#exam-timer-text');
    if (el) {
      el.textContent = formatClock(left);
      el.parentElement.classList.toggle('is-low', left < 5 * 60 * 1000);
    }
    if (left <= 0) {
      stopTimer();
      closeDialogs();
      finishSession({ timeUp: true });
      toast('Time’s up. Your exam was submitted.');
    }
  }

  // ---------- Theme ----------
  function applyTheme() {
    const t = state.settings.theme;
    const root = document.documentElement;
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
    else root.removeAttribute('data-theme');
    const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#1a1816' : '#fbfaf8');
  }

  // ---------- Routing ----------
  const HASH = { dashboard: '#/', study: '#/study', results: '#/study/results', questions: '#/questions' };
  const VIEW_IDS = { dashboard: 'view-dashboard', study: 'view-study', session: 'view-session', results: 'view-results', questions: 'view-questions' };
  const TITLES = {
    dashboard: 'Part 107 Flight Deck · Free FAA drone test practice',
    study: 'Study cards · Part 107 Flight Deck',
    session: 'Studying · Part 107 Flight Deck',
    results: 'Session results · Part 107 Flight Deck',
    questions: 'All questions · Part 107 Flight Deck',
  };
  const HEADINGS = { dashboard: '#dash-title', study: '#study-title', results: '#results-title', questions: '#questions-title' };

  function parseHash() {
    const raw = decodeURIComponent(location.hash || '').replace(/^#\/?/, '').replace(/\/+$/, '').toLowerCase();
    if (raw === 'study') return 'study';
    if (raw === 'study/results') return 'results';
    if (raw === 'questions' || raw === 'library') return 'questions';
    return 'dashboard';
  }

  function navigate(name) {
    const target = HASH[name];
    if (location.hash === target) route();
    else location.hash = target;
  }

  function closeDialogs() {
    for (const d of $$('dialog[open]')) d.close();
  }

  function route() {
    let name = parseHash();
    const expired = checkExamExpiry();
    const s = state.session;
    if (expired && name === 'study') name = 'results';
    if (name === 'results' && !(s && s.finishedAt)) name = 'study';
    const view = name === 'study' && s && !s.finishedAt ? 'session' : name;
    if (location.hash !== HASH[name]) history.replaceState(null, '', HASH[name]);

    closeDialogs();
    stopTimer();
    ui.view = view;
    for (const [key, id] of Object.entries(VIEW_IDS)) document.getElementById(id).hidden = key !== view;
    document.body.dataset.view = view;
    document.body.classList.toggle('in-session', view === 'session');
    document.title = TITLES[view];
    const navKey = view === 'dashboard' || view === 'questions' ? view : 'study';
    for (const a of $$('[data-nav]')) {
      if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }

    renderChrome();
    const moveFocus = !ui.firstRoute;
    if (view === 'dashboard') renderDashboard();
    else if (view === 'study') renderStudy();
    else if (view === 'session') renderSession({ focus: moveFocus ? 'question' : 'none' });
    else if (view === 'results') renderResults();
    else if (view === 'questions') renderQuestions();

    if (moveFocus) {
      window.scrollTo(0, 0);
      const h = HEADINGS[view] && $(HEADINGS[view]);
      if (h) h.focus({ preventScroll: true });
    }
    ui.firstRoute = false;
  }

  // ---------- Shared chrome ----------
  function renderChrome() {
    const streak = currentStreak();
    const today = state.streak.last === dayKey();
    for (const el of $$('[data-streak]')) el.textContent = String(streak);
    for (const el of $$('[data-streak-hint]')) {
      el.textContent = streak === 0 ? 'Answer a question to start' : today ? 'You studied today' : 'Study today to keep it going';
    }
    for (const el of $$('.streak-card, .streak-chip')) el.classList.toggle('is-cold', streak === 0);
    const chip = $('.streak-chip');
    if (chip) chip.title = `${plural(streak, 'day')} in a row`;
    const s = state.session;
    const active = s && !s.finishedAt;
    for (const el of $$('[data-live-badge]')) {
      el.hidden = !active;
      if (active && el.classList.contains('nav-badge')) el.textContent = `${answeredCount(s)}/${s.ids.length}`;
    }
  }

  function sourceLink(q, hl) {
    const h = hl || esc;
    return `<a class="source-link" href="${esc(q.source.url)}" target="_blank" rel="noopener noreferrer">${icon('i-book')}<span>${h(q.source.label)} · ${h(q.source.reference)}</span>${icon('i-external', 'icon-sm')}<span class="sr-only"> (opens in a new tab)</span></a>`;
  }

  function subjectChip(cat, small) {
    const m = subjectMeta(cat);
    return `<span class="chip${small ? ' chip-sm' : ''} tone-${m.tone}">${icon(m.icon)}${esc(cat)}</span>`;
  }

  // ---------- Dashboard ----------
  function renderDashboard() {
    const s = state.session;
    const b = state.settings.builder;
    const hero = $('#dash-hero');
    if (s && !s.finishedAt) {
      const done = answeredCount(s);
      const left = s.mode === 'exam' ? ` · ${formatClock(s.deadline - Date.now())} left` : '';
      hero.innerHTML = `<div class="card hero-card">
        <div>
          <p class="eyebrow">Session #${s.number} in progress</p>
          <h2>Pick up where you left off</h2>
          <p>${esc(sessionLabel(s))} · ${done} of ${s.ids.length} answered${esc(left)}</p>
          <div class="progress progress-sm hero-progress" aria-hidden="true"><span style="width:${pct(done, s.ids.length)}%"></span></div>
        </div>
        <div class="hero-actions">
          <button type="button" class="btn btn-ghost" data-action="discard">Discard</button>
          <button type="button" class="btn btn-primary btn-lg" data-action="resume">Continue${icon('i-arrow-right')}</button>
        </div>
      </div>`;
    } else {
      const first = state.history.length === 0;
      const label = b.mode === 'exam' ? 'Start exam simulation' : `Start ${b.size} cards`;
      hero.innerHTML = `<div class="card hero-card">
        <div>
          <p class="eyebrow">${first ? 'Welcome aboard' : `Ready for session #${state.sessionCount + 1}`}</p>
          <h2>${first ? 'Start your first set of study cards' : 'Keep your streak going'}</h2>
          <p>${first ? 'Answer, check, and learn why. Your progress is saved on this device as you go.' : `${plural(freshLeft(), 'question')} you haven’t drawn yet this round.`}</p>
        </div>
        <div class="hero-actions">
          <a class="btn btn-secondary btn-lg" href="#/study">Choose a session</a>
          <button type="button" class="btn btn-primary btn-lg" data-action="start-saved">${esc(label)}${icon('i-arrow-right')}</button>
        </div>
      </div>`;
    }

    const all = tally(ALL_IDS);
    const streak = currentStreak();
    const studiedToday = state.streak.last === dayKey();
    $('#dash-stats').innerHTML = [
      stat('stat-flame', 'i-flame', `${streak}`, streak === 1 ? 'day streak' : 'day streak', streak === 0 ? 'Answer a question to start one' : studiedToday ? 'You studied today' : 'Study today to keep it going'),
      stat('stat-ink', 'i-cards', `${all.explored}<small>/${TOTAL}</small>`, 'questions explored', `${pct(all.explored, TOTAL)}% of the bank`),
      stat('stat-ok', 'i-check-circle', `${all.mastered}`, 'mastered', all.review ? `${plural(all.review, 'card')} to review` : 'Right on the first try'),
      stat('stat-ink', 'i-target', all.accuracy == null ? '—' : `${all.accuracy}<small>%</small>`, 'first-try accuracy', all.accuracy == null ? 'Shows after your first answer' : all.accuracy >= PASS ? 'Above the 70% pass mark' : 'Aim for 70% or higher'),
    ].join('');

    const queue = reviewQueue();
    $('#dash-review').innerHTML = queue.length ? reviewCallout(queue.length) : '';

    $('#dash-subjects').innerHTML = CATEGORIES.map((c) => {
      const m = subjectMeta(c);
      const t = tally(idsIn(c));
      const exploredOnly = Math.max(0, t.explored - t.mastered);
      return `<article class="subject-card tone-${m.tone}">
        <div class="subject-top">
          <span class="subject-icon">${icon(m.icon)}</span>
          <div><h3 class="subject-name">${esc(c)}</h3><p class="subject-count">${plural(t.total, 'question')}</p></div>
        </div>
        <div class="meter" role="img" aria-label="${t.mastered} of ${t.total} mastered, ${t.explored} explored">
          <span class="m-mastered" style="width:${pct(t.mastered, t.total)}%"></span><span class="m-explored" style="width:${pct(exploredOnly, t.total)}%"></span>
        </div>
        <div class="subject-foot">
          <p class="subject-stats"><b>${t.mastered}</b> mastered · ${t.accuracy == null ? 'not started' : `<b>${t.accuracy}%</b> first try`}</p>
          <button type="button" class="btn btn-secondary btn-sm" data-action="drill" data-subject="${esc(c)}" aria-label="Practice 10 ${esc(c)} cards">Practice 10</button>
        </div>
      </article>`;
    }).join('');

    const hist = state.history.slice(0, 5);
    $('#dash-history').hidden = hist.length === 0;
    $('#dash-history-list').innerHTML = hist.map(historyRow).join('');
  }

  function stat(cls, ic, value, label, sub) {
    return `<div class="stat ${cls}">
      <span class="stat-icon">${icon(ic)}</span>
      <span class="stat-value">${value}</span>
      <span class="stat-label">${esc(label)}</span>
      <span class="stat-sub">${esc(sub)}</span>
    </div>`;
  }

  function reviewCallout(n) {
    return `<div class="callout">
      <span class="callout-icon">${icon('i-rotate')}</span>
      <div><p class="callout-title">${plural(n, 'card')} to review</p><p class="callout-sub">Questions you missed or saved. Get one right on the first try to clear it.</p></div>
      <button type="button" class="btn btn-secondary" data-action="review">Review ${Math.min(n, REVIEW_BATCH)}</button>
    </div>`;
  }

  function historyRow(h) {
    const p = pct(h.correct, h.total);
    const label = h.mode === 'exam' ? 'Exam simulation' : h.mode === 'review' ? 'Review session' : h.subject ? `${h.subject} practice` : 'Practice session';
    const ic = h.mode === 'exam' ? 'i-clipboard' : h.mode === 'review' ? 'i-rotate' : 'i-cards';
    return `<li>
      <span class="history-badge">${icon(ic)}</span>
      <div><p class="history-title">${esc(label)}</p><p class="history-sub">Session #${h.n} · ${esc(formatDate(h.date))}</p></div>
      <p class="history-score${h.total && p >= PASS ? ' is-pass' : ''}">${h.total ? `${p}%` : '—'}<small>${h.correct}/${h.total} correct</small></p>
    </li>`;
  }

  // ---------- Study builder ----------
  function renderStudy() {
    const b = state.settings.builder;
    const exam = b.mode === 'exam';
    const pool = b.subject ? COUNT_BY_CAT[b.subject] : TOTAL;
    if (b.size > pool) b.size = SIZES.filter((n) => n <= pool).pop() || SIZES[0];
    const last = state.session && state.session.finishedAt ? state.session : null;
    const queue = reviewQueue();
    const lastSum = last ? summarize(last) : null;

    $('#view-study').innerHTML = `<div class="page">
      <header class="page-head">
        <div>
          <p class="eyebrow">Study cards</p>
          <h1 id="study-title" tabindex="-1">Start a study session</h1>
          <p class="page-sub">Each card is one question. Pick an answer, check it, and see why it’s right, with the FAA source one tap away.</p>
        </div>
      </header>
      <div class="study-grid">
        <section class="card builder" aria-labelledby="builder-title">
          <h2 id="builder-title">Session setup</h2>
          <div class="seg seg-2" role="group" aria-label="Session type">
            <button type="button" class="seg-btn" data-action="mode" data-mode="practice" aria-pressed="${!exam}">${icon('i-cards')}Practice</button>
            <button type="button" class="seg-btn" data-action="mode" data-mode="exam" aria-pressed="${exam}">${icon('i-clock')}Exam simulation</button>
          </div>
          ${exam ? `
            <ul class="exam-rules">
              <li><b>60</b>questions from every subject</li>
              <li><b>2 hours</b>on the clock</li>
              <li><b>One try</b>per question, change answers any time</li>
              <li><b>70%</b>to pass, like the FAA test</li>
            </ul>` : `
            <div class="field">
              <span class="field-label" id="size-label">Number of cards</span>
              <div class="size-grid" role="group" aria-labelledby="size-label">
                ${SIZES.map((n) => `<button type="button" class="size-btn" data-action="size" data-size="${n}" aria-pressed="${b.size === n}"${n > pool ? ' disabled' : ''}><b>${n}</b><span>${n === 10 ? 'quick set' : 'cards'}</span></button>`).join('')}
              </div>
            </div>
            <label class="field">
              <span class="field-label">Subject</span>
              <select id="builder-subject">
                <option value="">All subjects (${TOTAL})</option>
                ${CATEGORIES.map((c) => `<option value="${esc(c)}"${b.subject === c ? ' selected' : ''}>${esc(c)} (${COUNT_BY_CAT[c]})</option>`).join('')}
              </select>
            </label>`}
          <button type="button" class="btn btn-primary btn-lg btn-block" data-action="start">${exam ? 'Start exam simulation' : `Start ${Math.min(b.size, pool)} cards`}${icon('i-arrow-right')}</button>
          <p class="builder-note">${icon(exam ? 'i-clock' : 'i-rotate')}<span>${exam ? 'The timer keeps running if you leave the page, just like the real test.' : 'Cards from your last session are held back, so every session feels fresh.'}</span></p>
        </section>

        <div class="side-stack">
          ${last ? `<section class="card side-card">
            <h3>Last session</h3>
            <p>${esc(sessionLabel(last))} · ${lastSum.correct} of ${lastSum.total} correct${lastSum.total ? ` (${pct(lastSum.correct, lastSum.total)}%)` : ''}</p>
            <a class="btn btn-secondary btn-sm" href="#/study/results">View results</a>
          </section>` : ''}
          ${queue.length ? `<section class="card side-card">
            <h3>Review list</h3>
            <p>${plural(queue.length, 'card')} you missed or saved. Get one right on the first try to clear it.</p>
            <button type="button" class="btn btn-secondary btn-sm" data-action="review">${icon('i-rotate')}Review ${Math.min(queue.length, REVIEW_BATCH)}</button>
          </section>` : ''}
          <section class="card side-card">
            <h3>This rotation</h3>
            <p class="rotation"><b>${freshLeft()}</b><span>of ${TOTAL} questions not drawn yet</span></p>
            <p>New sessions pull unseen questions first. Once you’ve drawn all ${TOTAL}, a fresh rotation starts.</p>
          </section>
          <section class="card side-card hide-sm">
            <h3>Keyboard shortcuts</h3>
            <p><kbd class="kbd">A</kbd>–<kbd class="kbd">D</kbd> choose · <kbd class="kbd">Enter</kbd> check or continue · <kbd class="kbd">←</kbd> <kbd class="kbd">→</kbd> move between cards</p>
          </section>
        </div>
      </div>
    </div>`;
  }

  // ---------- Session ----------
  function renderSession(opts) {
    const o = opts || {};
    const s = state.session;
    const view = $('#view-session');
    if (!s) return;
    const q = BY_ID.get(s.ids[s.pos]);
    const exam = s.mode === 'exam';
    const a = s.answers[q.id];
    const phase = phaseOf(s, q.id);
    const choices = choicesFor(q, s.seed);
    const right = choices.find((c) => c.correct);
    const total = s.ids.length;
    const done = answeredCount(s);
    const selected = exam ? a && a.pick : ui.selected;
    const flash = ui.flash && ui.flash.id === q.id ? ui.flash.kind : null;
    ui.flash = null;

    const choiceHtml = choices.map((c) => {
      const picked = !exam && a && a.picks.includes(c.key);
      let cls = 'choice';
      let disabled = false;
      let mark = '';
      let sr = '';
      if (!exam && phase === 'done') {
        disabled = true;
        if (c.correct) { cls += ' is-correct'; mark = icon('i-check'); sr = ', correct answer'; if (flash === 'correct') cls += ' pop'; }
        else if (picked) { cls += ' is-wrong'; mark = icon('i-x'); sr = ', your answer, incorrect'; if (flash === 'wrong') cls += ' shake'; }
        else cls += ' is-dim';
      } else if (picked) {
        disabled = true;
        cls += ' is-wrong';
        mark = icon('i-x');
        sr = ', your answer, incorrect';
        if (flash === 'wrong') cls += ' shake';
      }
      const checked = !disabled && selected === c.key;
      if (checked) cls += ' is-selected';
      return `<label class="${cls}" data-key="${c.key}">
        <input type="radio" name="choice" value="${c.key}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}>
        <span class="choice-letter" aria-hidden="true">${c.label}</span>
        <span class="choice-text"><span class="sr-only">${c.label}. </span>${esc(c.text)}<span class="sr-only">${sr}</span></span>
        <span class="choice-mark" aria-hidden="true">${mark}</span>
      </label>`;
    }).join('');

    const showExplain = !exam && phase === 'done';
    const explain = showExplain ? `<div class="explain" id="explain">
      <p class="explain-answer">${icon('i-check-circle')}<span>${right.label}. ${esc(q.answer)}</span></p>
      <p class="explain-text">${esc(q.explanation)}</p>
      ${sourceLink(q)}
    </div>` : '';

    const note = s.note && done === 0 && s.pos === 0 && !(a && (a.picks && a.picks.length)) ? `<p class="session-note">${icon('i-sparkles')}<span>${esc(s.note)}</span></p>` : '';

    let status = '';
    let actions = '';
    let barState = phase;
    if (exam) {
      barState = 'exam';
      status = `<span class="bar-muted" id="exam-status">${done} of ${total} answered</span>`;
      const flagged = !!(a && a.flagged);
      actions = `<button type="button" class="btn btn-secondary" data-action="prev"${s.pos === 0 ? ' disabled' : ''} aria-label="Previous question">${icon('i-arrow-left')}<span class="hide-sm">Back</span></button>
        <button type="button" class="btn btn-secondary" data-action="flag" id="btn-flag" aria-pressed="${flagged}">${icon('i-flag')}<span class="hide-sm">${flagged ? 'Flagged' : 'Flag'}</span><span class="sr-only"> this question to revisit</span></button>
        ${s.pos < total - 1
          ? `<button type="button" class="btn btn-primary" data-action="next">Next${icon('i-arrow-right')}</button>`
          : `<button type="button" class="btn btn-primary" data-action="submit-exam">Submit exam</button>`}`;
    } else if (phase === 'answering' || phase === 'retry') {
      status = phase === 'retry'
        ? `<span class="bar-title">${icon('i-x-circle')}Not quite. One more try.</span>`
        : `<span class="bar-muted hide-sm">Pick an answer, then check it.</span>`;
      actions = `<button type="button" class="btn btn-ghost" data-action="reveal">${icon('i-eye')}<span>Show answer</span></button>
        <button type="button" class="btn btn-primary" data-action="check" id="btn-check"${ui.selected ? '' : ' disabled'}>Check</button>`;
    } else {
      const r = a.result;
      barState = r;
      const title = {
        correct: PRAISE[q.id % PRAISE.length],
        correct2: 'Got it on the second try.',
        missed: `The answer is ${right.label}.`,
        revealed: `The answer is ${right.label}.`,
      }[r];
      const ic = { correct: 'i-check-circle', correct2: 'i-check-circle', missed: 'i-x-circle', revealed: 'i-eye' }[r];
      const sub = r === 'correct' ? (a.flagged ? 'Saved to your review list.' : 'Marked as mastered.') : 'Added to your review list.';
      const allDone = s.ids.every((id) => isDone(s, id));
      const btnCls = r === 'correct' || r === 'correct2' ? 'btn-success' : r === 'missed' ? 'btn-danger' : 'btn-primary';
      status = `<span class="bar-title">${icon(ic)}${esc(title)}</span><span class="bar-sub">${esc(sub)}</span>`;
      actions = `${r === 'correct' ? `<button type="button" class="btn btn-ghost" data-action="flag" id="btn-flag" aria-pressed="${!!a.flagged}">${icon('i-flag')}<span class="hide-sm">${a.flagged ? 'Saved' : 'Review later'}</span><span class="sr-only">${a.flagged ? ': saved to review list' : ': save to review list'}</span></button>` : ''}
        <button type="button" class="btn ${btnCls}" data-action="advance" id="btn-continue">${allDone ? 'See results' : 'Continue'}${icon('i-arrow-right')}</button>`;
    }

    const timer = exam ? `<span class="timer" role="timer" aria-label="Time remaining">${icon('i-clock')}<span id="exam-timer-text">${formatClock(s.deadline - Date.now())}</span></span>` : '';

    view.innerHTML = `<div class="session-wrap">
        <div class="session-top">
          <button type="button" class="icon-btn" data-action="exit" aria-label="Save and go to dashboard">${icon('i-x')}</button>
          <div class="progress" role="progressbar" aria-label="Session progress" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}" aria-valuetext="${done} of ${total} answered"><span style="width:${pct(done, total)}%"></span></div>
          ${timer}
          <button type="button" class="map-btn" data-action="map" aria-haspopup="dialog" aria-label="Card map. Card ${s.pos + 1} of ${total}">${icon('i-grid')}<span aria-hidden="true">${s.pos + 1}<span class="map-of">/${total}</span></span></button>
        </div>
        <article class="card study-card${o.focus === 'question' ? ' is-entering' : ''}">
          <h1 class="sr-only" id="session-h">${esc(sessionLabel(s))}: card ${s.pos + 1} of ${total}</h1>
          <div class="q-meta">
            ${subjectChip(q.category)}
            <span class="chip chip-plain">${esc(q.difficulty)}</span>
            ${exam && a && a.flagged ? `<span class="chip chip-flag">${icon('i-flag')}Flagged</span>` : ''}
            <span class="q-number" aria-hidden="true">${esc(sessionLabel(s))}</span>
          </div>
          <p class="q-text" id="q-text" tabindex="-1">${esc(q.question)}</p>
          <form id="choices-form" novalidate>
            <fieldset class="choices" aria-labelledby="q-text"${showExplain ? ' aria-describedby="explain"' : ''}>
              ${choiceHtml}
            </fieldset>
          </form>
          ${explain}
          ${note}
        </article>
      </div>
      <div class="session-bar" data-state="${barState}">
        <div class="session-bar-inner">
          <div class="bar-status">${status}</div>
          <div class="bar-actions">${actions}</div>
        </div>
      </div>`;

    renderChrome();
    if (exam) startTimer();

    const focus = o.focus || 'none';
    if (focus === 'question') {
      window.scrollTo(0, 0);
      $('#q-text').focus({ preventScroll: true });
    } else if (focus === 'continue') {
      const btn = $('#btn-continue');
      if (btn) btn.focus({ preventScroll: true });
      const ex = $('#explain');
      if (ex) ex.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    } else if (focus === 'choices') {
      const input = $('#view-session input[name="choice"]:not(:disabled)');
      if (input) input.focus({ preventScroll: true });
    } else if (focus === 'flag') {
      const btn = $('#btn-flag');
      if (btn) btn.focus({ preventScroll: true });
    }
  }

  // ---------- Card map ----------
  function openMap() {
    const s = state.session;
    if (!s || s.finishedAt) return;
    const exam = s.mode === 'exam';
    const done = answeredCount(s);
    $('#map-sub').textContent = `${sessionLabel(s)} · ${done} of ${s.ids.length} answered`;
    const legend = exam
      ? [['is-current', 'Current'], ['st-answered', 'Answered'], ['is-flagged', 'Flagged'], ['', 'Not answered']]
      : [['is-current', 'Current'], ['st-correct', 'Correct'], ['st-correct2', 'Second try'], ['st-missed', 'Missed or shown'], ['', 'Not answered']];
    $('#map-legend').innerHTML = legend.map(([c, l]) => `<li><i class="${c}" aria-hidden="true"></i>${l}</li>`).join('');
    $('#map-grid').innerHTML = s.ids.map((id, i) => {
      const a = s.answers[id];
      let st = '';
      let label = 'not answered';
      if (exam) {
        if (a && a.pick) { st = 'st-answered'; label = 'answered'; }
        if (a && a.flagged) { st += ' is-flagged'; label += ', flagged'; }
      } else if (a && a.result) {
        st = `st-${a.result}`;
        label = { correct: 'correct', correct2: 'correct on second try', missed: 'missed', revealed: 'answer shown' }[a.result] || 'answered';
      } else if (a && a.picks.length) {
        st = 'st-retry';
        label = 'one try used';
      }
      const current = i === s.pos;
      return `<button type="button" class="map-cell ${st}${current ? ' is-current' : ''}" data-action="jump" data-index="${i}" aria-label="Card ${i + 1}, ${label}"${current ? ' aria-current="true"' : ''}>${i + 1}</button>`;
    }).join('');
    const finish = $('#map-finish');
    finish.textContent = exam ? 'Submit exam' : s.ids.every((id) => isDone(s, id)) ? 'See results' : 'End session early';
    finish.className = exam ? 'btn btn-primary' : 'btn btn-secondary';
    const dlg = $('#dlg-map');
    dlg.showModal();
    const cur = $('.map-cell.is-current', dlg);
    if (cur) { cur.focus(); cur.scrollIntoView({ block: 'nearest' }); }
  }

  // ---------- Results ----------
  function renderResults() {
    const s = state.session;
    if (!s || !s.finishedAt) return;
    const sum = summarize(s);
    const p = pct(sum.correct, sum.total);
    const exam = s.mode === 'exam';
    const passed = p >= PASS;
    const headline = sum.total === 0 ? 'Session ended'
      : exam ? (passed ? 'You passed the simulation!' : 'Not a pass yet')
      : p >= 90 ? 'Outstanding!' : passed ? 'Nice work!' : 'Keep practicing';
    let sub;
    if (exam) {
      sub = `${sum.correct} of ${sum.total} correct. The FAA test needs 70% to pass.`;
      if (s.timeUp) sub += ' Time ran out, so unanswered questions counted as incorrect.';
    } else {
      sub = `${sum.correct} of ${sum.total} correct on the first try`;
      sub += sum.total < s.ids.length ? ` (you answered ${sum.total} of ${s.ids.length} cards).` : '.';
      sub += passed ? ' That’s above the 70% the FAA test needs.' : ' The FAA test needs 70% to pass, so review your misses and try again.';
    }
    const missedCount = sum.missed.length;
    const subjects = CATEGORIES.filter((c) => sum.bySubject[c]);
    const tab = ui.resultsTab === 'missed' && missedCount ? 'missed' : 'all';
    const list = s.ids.filter((id) => {
      if (tab === 'missed') return sum.missed.includes(id);
      return exam || (s.answers[id] && s.answers[id].result);
    });

    $('#view-results').innerHTML = `<div class="page">
      <section class="card results-hero">
        <div class="score-ring${passed ? '' : ' is-low'}" style="--p:${p}" role="img" aria-label="Score ${p} percent">
          <div class="score-ring-inner"><b>${p}%</b><small>${sum.correct}/${sum.total}</small></div>
        </div>
        <div class="results-copy">
          <p class="eyebrow">Session #${s.number} · ${esc(sessionLabel(s))}</p>
          ${exam && sum.total ? `<span class="chip pass-pill ${passed ? 'chip-ok' : 'chip-bad'}">${icon(passed ? 'i-award' : 'i-x-circle')}${passed ? 'Pass' : 'Below 70%'}</span>` : ''}
          <h1 id="results-title" tabindex="-1">${esc(headline)}</h1>
          <p>${esc(sub)}</p>
          <div class="results-actions">
            ${missedCount ? `<button type="button" class="btn btn-primary" data-action="review-missed">${icon('i-rotate')}Review ${plural(missedCount, 'miss', 'misses')}</button>` : ''}
            <button type="button" class="btn ${missedCount ? 'btn-secondary' : 'btn-primary'}" data-action="again">${icon('i-play')}${exam ? 'New exam simulation' : 'Start another set'}</button>
            <a class="btn btn-ghost" href="#/">Dashboard</a>
          </div>
        </div>
      </section>

      ${subjects.length ? `<section class="section" aria-labelledby="by-subject">
        <div class="section-head"><h2 id="by-subject">By subject</h2><p class="section-hint">The line marks 70%.</p></div>
        <ol class="breakdown card">
          ${subjects.map((c) => {
            const m = subjectMeta(c);
            const b = sum.bySubject[c];
            const bp = pct(b.correct, b.total);
            return `<li class="tone-${m.tone}">
              <span class="breakdown-name"><span class="subject-icon">${icon(m.icon)}</span><span>${esc(c)}</span></span>
              <span class="bar-track" aria-hidden="true"><span style="width:${bp}%"></span></span>
              <span class="breakdown-score">${bp}%<small>${b.correct}/${b.total}</small></span>
            </li>`;
          }).join('')}
        </ol>
      </section>` : ''}

      ${list.length || missedCount ? `<section class="section" aria-labelledby="review-title">
        <div class="section-head">
          <h2 id="review-title">Card review</h2>
          ${missedCount ? `<div class="tabs" role="tablist" aria-label="Filter cards">
            <button type="button" class="tab" role="tab" data-action="rtab" data-tab="all" aria-selected="${tab === 'all'}">All</button>
            <button type="button" class="tab" role="tab" data-action="rtab" data-tab="missed" aria-selected="${tab === 'missed'}">Missed (${missedCount})</button>
          </div>` : ''}
        </div>
        <div class="q-list">${list.map((id) => resultItem(s, id)).join('')}</div>
      </section>` : ''}
    </div>`;
  }

  function resultItem(s, id) {
    const q = BY_ID.get(id);
    const a = s.answers[id] || {};
    const choices = choicesFor(q, s.seed);
    const byKey = (k) => choices.find((c) => c.key === k);
    const index = s.ids.indexOf(id) + 1;
    let chip = '';
    let yours = '';
    if (s.mode === 'exam') {
      if (!a.pick) { chip = '<span class="chip chip-sm chip-plain">Not answered</span>'; yours = `<p class="q-yours">${icon('i-x-circle')}<span>You didn’t answer this one.</span></p>`; }
      else if (a.pick === 'c') chip = `<span class="chip chip-sm chip-ok">${icon('i-check')}Correct</span>`;
      else { chip = `<span class="chip chip-sm chip-bad">${icon('i-x')}Missed</span>`; const c = byKey(a.pick); yours = `<p class="q-yours">${icon('i-x-circle')}<span>You chose ${c.label}. ${esc(c.text)}</span></p>`; }
    } else {
      const wrong = (a.picks || []).filter((k) => k !== 'c').map(byKey);
      chip = {
        correct: `<span class="chip chip-sm chip-ok">${icon('i-check')}First try</span>`,
        correct2: `<span class="chip chip-sm chip-warn">${icon('i-check')}Second try</span>`,
        missed: `<span class="chip chip-sm chip-bad">${icon('i-x')}Missed</span>`,
        revealed: `<span class="chip chip-sm chip-bad">${icon('i-eye')}Answer shown</span>`,
      }[a.result] || '';
      if (wrong.length) yours = `<p class="q-yours">${icon('i-x-circle')}<span>You chose ${wrong.map((c) => `${c.label}. ${esc(c.text)}`).join(' Then ')}</span></p>`;
    }
    return questionItem(q, { num: `${index}`, chips: chip, yours, rightLabel: byKey('c').label });
  }

  function questionItem(q, opts) {
    const o = opts || {};
    const h = o.hl || esc;
    return `<details class="q-item">
      <summary>
        <span class="q-num">${esc(o.num || '')}</span>
        <span class="q-sum">
          <span class="q-tags">${subjectChip(q.category, true)}<span class="chip chip-sm chip-plain">${esc(q.difficulty)}</span>${o.chips || ''}</span>
          <span class="q-title">${h(q.question)}</span>
        </span>
        ${icon('i-chevron-down', 'q-chev')}
      </summary>
      <div class="q-body">
        <p class="q-answer">${icon('i-check-circle')}<span><span class="sr-only">Correct answer: </span>${o.rightLabel ? `${o.rightLabel}. ` : ''}${h(q.answer)}</span></p>
        ${o.yours || ''}
        <p class="q-explain">${h(q.explanation)}</p>
        <div class="q-others"><p class="q-others-label">Other choices</p><ul>${q.distractors.map((d) => `<li>${h(d)}</li>`).join('')}</ul></div>
        ${sourceLink(q, h)}
      </div>
    </details>`;
  }

  // ---------- All questions ----------
  let libReady = false;
  const SEARCH_TEXT = new Map();

  function normalize(s) {
    return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[“”"‘’'`]/g, '').replace(/[–—]/g, '-');
  }

  function searchText(q) {
    if (!SEARCH_TEXT.has(q.id)) {
      SEARCH_TEXT.set(q.id, normalize([q.question, q.answer, q.explanation, q.category, q.difficulty, q.source.label, q.source.reference].join('  ')));
    }
    return SEARCH_TEXT.get(q.id);
  }

  function tokens() {
    return normalize(ui.lib.q).split(/\s+/).filter(Boolean).slice(0, 8);
  }

  const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Words match from their start, so "light" finds "lights" but not "flight".
  function wordMatchers(toks) {
    return toks.map((t) => new RegExp(`(?:^|[^a-z0-9])${escapeRe(t)}`));
  }

  function highlighter(toks) {
    if (!toks.length) return esc;
    const re = new RegExp(`(^|[^a-z0-9])(${toks.map(escapeRe).join('|')})`, 'gi');
    return (text) => {
      const str = String(text);
      let out = '';
      let last = 0;
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(str))) {
        const start = m.index + m[1].length;
        out += `${esc(str.slice(last, start))}<mark>${esc(m[2])}</mark>`;
        last = start + m[2].length;
        re.lastIndex = last;
      }
      return out + esc(str.slice(last));
    };
  }

  function initQuestionFilters() {
    if (libReady) return;
    libReady = true;
    const opt = (v, l) => `<option value="${esc(v)}">${esc(l)}</option>`;
    $('#lib-subject').innerHTML = opt('', 'All subjects') + CATEGORIES.map((c) => opt(c, `${c} (${COUNT_BY_CAT[c]})`)).join('');
    $('#lib-diff').innerHTML = opt('', 'All difficulties') + DIFFICULTIES.map((d) => opt(d, d)).join('');
    $('#lib-status').innerHTML = opt('', 'Any status') + opt('unseen', 'Not seen yet') + opt('review', 'On my review list') + opt('mastered', 'Mastered');
    const sources = Array.from(new Set(QUESTIONS.map((q) => q.source.label))).sort((x, y) => x.localeCompare(y));
    $('#lib-source').innerHTML = opt('', 'All sources') + sources.map((l) => opt(l, l)).join('');
  }

  function libMatches() {
    const matchers = wordMatchers(tokens());
    const f = ui.lib;
    return QUESTIONS.filter((q) => {
      if (f.subject && q.category !== f.subject) return false;
      if (f.diff && q.difficulty !== f.diff) return false;
      if (f.source && q.source.label !== f.source) return false;
      if (f.status) {
        const m = state.mastery[q.id];
        if (f.status === 'unseen' && isExplored(q.id)) return false;
        if (f.status === 'review' && m !== 'review') return false;
        if (f.status === 'mastered' && m !== 'mastered') return false;
      }
      if (matchers.length) {
        const hay = searchText(q);
        return matchers.every((re) => re.test(hay));
      }
      return true;
    });
  }

  function renderQuestions() {
    initQuestionFilters();
    $('#lib-q').value = ui.lib.q;
    $('#lib-subject').value = ui.lib.subject;
    $('#lib-diff').value = ui.lib.diff;
    $('#lib-status').value = ui.lib.status;
    $('#lib-source').value = ui.lib.source;
    renderQuestionList();
  }

  function renderQuestionList() {
    const matches = libMatches();
    const shown = matches.slice(0, ui.lib.shown);
    const hl = highlighter(tokens());
    const f = ui.lib;
    const filtered = !!(f.q.trim() || f.subject || f.diff || f.status || f.source);
    $('#lib-count').innerHTML = matches.length
      ? `Showing <b>${shown.length}</b> of <b>${matches.length}</b> ${matches.length === 1 ? 'question' : 'questions'}${filtered ? ` <span class="sr-only">matching your filters</span>` : ''}`
      : 'No questions match';
    $('#lib-clear').hidden = !filtered;
    $('#lib-list').innerHTML = matches.length
      ? shown.map((q) => {
          const m = state.mastery[q.id];
          const chip = m === 'mastered' ? `<span class="chip chip-sm chip-ok">${icon('i-check')}Mastered</span>` : m === 'review' ? `<span class="chip chip-sm chip-warn">${icon('i-rotate')}Review</span>` : '';
          return questionItem(q, { num: `#${String(q.id).padStart(3, '0')}`, chips: chip, hl });
        }).join('')
      : `<div class="card lib-empty"><h2>Nothing found</h2><p>Try fewer words, or clear the filters.</p></div>`;
    const more = $('#lib-more');
    more.hidden = matches.length <= shown.length;
    more.textContent = `Show ${Math.min(LIB_PAGE, matches.length - shown.length)} more`;
  }

  let searchTimer = null;
  function onSearchInput(value) {
    ui.lib.q = value;
    ui.lib.shown = LIB_PAGE;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(renderQuestionList, 120);
  }

  // ---------- Settings: export, import, reset ----------
  function openSettings() {
    const dlg = $('#dlg-settings');
    for (const r of $$('input[name="theme"]', dlg)) r.checked = r.value === state.settings.theme;
    dlg.showModal();
  }

  function exportProgress() {
    const payload = { app: 'part-107-flight-deck', version: 1, exportedAt: new Date().toISOString(), data: state };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `flight-deck-progress-${dayKey()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Progress file downloaded.');
  }

  function importProgress(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try { parsed = JSON.parse(String(reader.result)); } catch (e) { toast('That file isn’t a Flight Deck backup.'); return; }
      const data = parsed && parsed.app === 'part-107-flight-deck' ? parsed.data : parsed;
      if (!data || typeof data !== 'object' || !('mastery' in data || 'stats' in data)) { toast('That file isn’t a Flight Deck backup.'); return; }
      if (!window.confirm('Replace the progress on this device with the imported file?')) return;
      state = sanitize(data);
      save();
      applyTheme();
      closeDialogs();
      toast('Progress imported.');
      route();
    };
    reader.onerror = () => toast('Couldn’t read that file.');
    reader.readAsText(file);
  }

  function resetProgress() {
    if (!window.confirm('Erase all progress, streaks, and sessions on this device? This can’t be undone.')) return;
    const theme = state.settings.theme;
    state = freshState();
    state.settings.theme = theme;
    save();
    closeDialogs();
    toast('Progress reset.');
    navigate('dashboard');
  }

  // ---------- Events ----------
  function handleAction(el, event) {
    const action = el.dataset.action;
    const s = state.session;
    const b = state.settings.builder;
    switch (action) {
      case 'start':
        startSession({ mode: b.mode, size: b.size, subject: b.subject });
        break;
      case 'start-saved':
        startSession({ mode: b.mode, size: b.size, subject: b.subject });
        break;
      case 'mode':
        b.mode = el.dataset.mode === 'exam' ? 'exam' : 'practice';
        save();
        renderStudy();
        $(`[data-action="mode"][data-mode="${b.mode}"]`).focus();
        break;
      case 'size': {
        const n = Number(el.dataset.size);
        if (SIZES.includes(n)) b.size = n;
        save();
        renderStudy();
        $(`[data-action="size"][data-size="${b.size}"]`).focus();
        break;
      }
      case 'drill':
        startSession({ mode: 'practice', size: 10, subject: el.dataset.subject });
        break;
      case 'review':
        startSession({ mode: 'review', size: REVIEW_BATCH });
        break;
      case 'review-missed':
        if (s && s.finishedAt) startSession({ mode: 'review', ids: summarize(s).missed, size: 100 });
        break;
      case 'again':
        if (s && s.finishedAt) {
          if (s.mode === 'review') navigate('study');
          else startSession({ mode: s.mode, size: SIZES.includes(s.ids.length) ? s.ids.length : b.size, subject: s.subject });
        }
        break;
      case 'resume':
        navigate('study');
        break;
      case 'discard':
        discardSession();
        break;
      case 'exit':
        navigate('dashboard');
        break;
      case 'check':
        check();
        break;
      case 'reveal':
        reveal();
        break;
      case 'advance':
        advance();
        break;
      case 'flag':
        toggleFlag();
        break;
      case 'prev':
        if (s) goTo(s.pos - 1);
        break;
      case 'next':
        if (s) goTo(s.pos + 1);
        break;
      case 'submit-exam':
        submitExam();
        break;
      case 'map':
        openMap();
        break;
      case 'jump':
        closeDialogs();
        goTo(Number(el.dataset.index));
        break;
      case 'finish':
        if (s && s.mode !== 'exam' && s.ids.every((id) => isDone(s, id))) { closeDialogs(); finishSession(); }
        else endEarly();
        break;
      case 'rtab':
        ui.resultsTab = el.dataset.tab === 'missed' ? 'missed' : 'all';
        renderResults();
        $(`[data-action="rtab"][data-tab="${ui.resultsTab}"]`).focus();
        break;
      case 'lib-more':
        ui.lib.shown += LIB_PAGE;
        renderQuestionList();
        break;
      case 'lib-clear':
        ui.lib = { q: '', subject: '', diff: '', status: '', source: '', shown: LIB_PAGE };
        renderQuestions();
        $('#lib-q').focus();
        break;
      case 'settings':
        openSettings();
        break;
      case 'close-dialog': {
        const d = el.closest('dialog');
        if (d) d.close();
        break;
      }
      case 'export':
        exportProgress();
        break;
      case 'reset':
        resetProgress();
        break;
      default:
        return;
    }
    if (event) event.preventDefault();
  }

  function bindEvents() {
    document.addEventListener('click', (e) => {
      const dlg = e.target instanceof HTMLDialogElement ? e.target : null;
      if (dlg && dlg.open) { dlg.close(); return; }
      const el = e.target.closest('[data-action]');
      if (!el || el.disabled) return;
      handleAction(el, e);
    });

    document.addEventListener('change', (e) => {
      const t = e.target;
      if (t.name === 'choice') selectChoice(t.value);
      else if (t.id === 'builder-subject') {
        state.settings.builder.subject = CATEGORIES.includes(t.value) ? t.value : null;
        save();
        renderStudy();
        $('#builder-subject').focus();
      } else if (t.name === 'theme') {
        state.settings.theme = THEMES.includes(t.value) ? t.value : 'system';
        save();
        applyTheme();
      } else if (t.id === 'import-file') {
        importProgress(t.files && t.files[0]);
        t.value = '';
      } else if (t.id === 'lib-subject' || t.id === 'lib-diff' || t.id === 'lib-status' || t.id === 'lib-source') {
        const key = { 'lib-subject': 'subject', 'lib-diff': 'diff', 'lib-status': 'status', 'lib-source': 'source' }[t.id];
        ui.lib[key] = t.value;
        ui.lib.shown = LIB_PAGE;
        renderQuestionList();
      }
    });

    document.addEventListener('input', (e) => {
      if (e.target.id === 'lib-q') onSearchInput(e.target.value);
    });

    document.addEventListener('submit', (e) => {
      if (e.target.id === 'choices-form') {
        e.preventDefault();
        primaryAction();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if ($('dialog[open]')) return;
      const t = e.target;
      const typing = t.closest && t.closest('input:not([type="radio"]), textarea, select, [contenteditable="true"]');

      if (ui.view === 'questions' && e.key === '/' && !typing) {
        e.preventDefault();
        $('#lib-q').focus();
        return;
      }
      if (ui.view !== 'session' || typing) return;
      const s = state.session;
      if (!s || s.finishedAt) return;
      const k = e.key.toLowerCase();
      const idx = ['a', 'b', 'c', 'd'].indexOf(k) >= 0 ? ['a', 'b', 'c', 'd'].indexOf(k) : ['1', '2', '3', '4'].indexOf(k);
      if (idx >= 0 && !e.shiftKey) {
        e.preventDefault();
        selectByIndex(idx);
        return;
      }
      if (e.key === 'Enter') {
        if (t.closest('button, a, summary')) return;
        e.preventDefault();
        primaryAction();
        return;
      }
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !(t.matches && t.matches('input[type="radio"]'))) {
        e.preventDefault();
        goTo(s.pos + (e.key === 'ArrowRight' ? 1 : -1));
        return;
      }
      if (k === 'f' && s.mode === 'exam') {
        e.preventDefault();
        toggleFlag();
      }
    });

    window.addEventListener('hashchange', route);
    window.addEventListener('storage', (e) => {
      if (e.key !== STORE_KEY) return;
      state = load();
      applyTheme();
      route();
    });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => { if (state.settings.theme === 'system') applyTheme(); };
    if (mq.addEventListener) mq.addEventListener('change', onScheme);
    else if (mq.addListener) mq.addListener(onScheme);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && ui.view === 'session') tick();
    });
  }

  // ---------- Start ----------
  function init() {
    if (!QUESTIONS.length) {
      document.getElementById('main').innerHTML = '<div class="page"><p class="noscript">The question bank didn’t load. Please refresh the page.</p></div>';
      return;
    }
    applyTheme();
    bindEvents();
    route();
  }

  // Expose internals for automated tests only.
  window.__FLIGHT_DECK__ = { drawIds, choicesFor, sanitize, summarize, get state() { return state; } };

  init();
})();
