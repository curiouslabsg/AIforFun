import { signInAnonymously, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, writeBatch, collection, onSnapshot, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { auth, db, configured, rosterSid, pinHash, h } from './firebase.js';
import { sectionsFor, MOODS, sectionTarget, sectionDone, isAnswered } from './wex.js';
import { renderPortfolio } from './portfolio.js';
import { icon } from './icons.js';
import { art } from './art.js';
import { companyLogo, siteDomain, knownLogo } from './logo.js';
import { findCompany, isOkLogoUrl } from './lookup.js';
import { celebrate } from './confetti.js';

const $ = (id) => document.getElementById(id);
const START_PIN = '1234'; // every student's PIN until they choose their own
// Name lists are often in capitals: "TAN JIAMIN" → "Tan Jiamin" for greetings.
const nice = (v) => String(v ?? '').toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());
const SESSION_KEY = 'wex-journal-session';

const state = {
  code: null, sid: null, cohort: null, student: null, sections: [],
  answers: {}, view: 'home', unsubs: [], opened: new Set(),
};

// ---------- small helpers ----------

function show(id) {
  for (const s of ['loading', 'setup', 'join', 'journal']) $(s).hidden = s !== id;
}
function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function writeSession(v) {
  try { v ? localStorage.setItem(SESSION_KEY, JSON.stringify(v)) : localStorage.removeItem(SESSION_KEY); } catch { /* private mode */ }
}
function friendlyError(err) {
  if (err?.code === 'unavailable') return 'No connection. Check your mobile data or Wi-Fi and try again.';
  return 'Something went wrong. Try again, or ask your teacher.';
}
function joinMessage(text, kind = 'err') {
  const m = $('j-msg');
  m.textContent = text;
  m.className = `msg ${kind}`;
  m.hidden = !text;
}
const isOpen = () => state.cohort?.open === true;
// The company comes from the sign-in list until the student types something else.
const answer = (section, id) => state.answers[section]?.[id]
  ?? (section === 'placement' && id === 'company' ? (state.student?.class ?? '') : '');
const sectionById = (id) => state.sections.find((s) => s.id === id);
const myLogo = (cls) => companyLogo({ name: answer('placement', 'company'), site: answer('placement', 'website'), logoUrl: answer('placement', 'logoUrl') }, cls);

// ---------- saving ----------
// Writes go to the phone's copy first and upload when there's signal, so the status line
// says which of the two has happened.

let pending = 0;
const inflight = new Set();
function setSave(text, bad = false) {
  $('save').textContent = text;
  $('save').classList.toggle('bad', bad);
}
function savingText() {
  return navigator.onLine ? 'Saving…' : 'Saved on this phone · uploads when you’re back online';
}
async function saving(promise) {
  inflight.add(promise);
  promise.catch(() => {}).finally(() => inflight.delete(promise));
  pending++;
  setSave(savingText());
  try {
    await promise;
    pending--;
    if (!pending) setSave(`Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
  } catch (err) {
    pending--;
    console.error(err);
    setSave(err?.code === 'permission-denied' ? 'Not saved: your journal is closed for writing' : 'Not saved yet. Check your connection', true);
  }
}
window.addEventListener('offline', () => { if (pending) setSave(savingText()); });
window.addEventListener('online', () => { if (pending) setSave('Uploading…'); });

const timers = new Map(); // "section__prompt" -> { timer, section, id, value }
function queueSave(section, id, value) {
  state.answers[section] = { ...(state.answers[section] ?? {}), [id]: value };
  const k = `${section}__${id}`;
  clearTimeout(timers.get(k)?.timer);
  timers.set(k, { section, id, value, timer: setTimeout(() => flushField(k), 1200) });
  setSave('Typing…');
}
function flushField(k) {
  const t = timers.get(k);
  if (!t) return;
  clearTimeout(t.timer);
  timers.delete(k);
  saveField(t.section, t.id, t.value);
}
function flushSaves() {
  for (const k of [...timers.keys()]) flushField(k);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSaves(); });
window.addEventListener('pagehide', flushSaves);

const created = new Set(); // sections that already have a doc
function saveField(section, id, value) {
  const data = { section, answers: { [id]: value }, updatedAt: serverTimestamp() };
  if (!created.has(section)) { data.createdAt = serverTimestamp(); created.add(section); }
  saving(setDoc(doc(db, `cohorts/${state.code}/students/${state.sid}/entries/${section}`), data, { merge: true }));
  saveProgress();
}

function sectionCount(s) {
  const answers = Object.fromEntries(s.prompts.map((p) => [p.id, answer(s.id, p.id)]));
  return { n: sectionDone(s, answers), of: sectionTarget(s) };
}

let lastProgress = '';
function saveProgress() {
  const progress = Object.fromEntries(state.sections.map((s) => [s.id, sectionCount(s).n]));
  const data = {
    progress,
    company: String(answer('placement', 'company')).slice(0, 100),
    industry: String(answer('placement', 'industry')).slice(0, 60),
    website: String(answer('placement', 'website')).slice(0, 100),
    logoUrl: isOkLogoUrl(answer('placement', 'logoUrl')) ? answer('placement', 'logoUrl') : '',
  };
  const sig = JSON.stringify(data);
  if (sig === lastProgress) return;
  lastProgress = sig;
  saving(updateDoc(doc(db, `cohorts/${state.code}/students/${state.sid}`), { ...data, lastActive: serverTimestamp() }));
}

// ---------- join ----------

const joinState = { code: null, cohort: null, open: [], roster: new Map(), existing: null };

async function loadJoinScreen() {
  joinMessage('');
  $('j-btn').disabled = true;
  try {
    const settings = await getDoc(doc(db, 'settings/school'));
    const codes = settings.data()?.activeCohorts ?? [];
    const found = await Promise.all(codes.map(async (code) => {
      try {
        const c = await getDoc(doc(db, `cohorts/${code}`));
        // Closed cohorts stay listed so students can come back and read (and print) their journal.
        return c.exists() ? { code, ...c.data() } : null;
      } catch { return null; }
    }));
    joinState.open = found.filter(Boolean);
    $('j-cohort-field').hidden = joinState.open.length < 2;
    if (!joinState.open.length) {
      joinState.code = null;
      $('j-cohort').hidden = true;
      $('j-tg').replaceChildren(h('option', { value: '' }, '—'));
      joinMessage('Work experience journals aren’t open right now. Ask your teacher.', 'warn');
      return;
    }
    if (joinState.open.length > 1) {
      $('j-cohort-sel').replaceChildren(h('option', { value: '' }, 'Choose…'), ...joinState.open.map((c) => h('option', { value: c.code }, c.name)));
    }
    pickCohort(joinState.open.length === 1 ? joinState.open[0].code : '');
    const roster = await getDocs(collection(db, 'roster'));
    joinState.roster = new Map(roster.docs.map((d) => [d.id, d.data()]));
    const tgs = [...joinState.roster.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    $('j-tg').replaceChildren(h('option', { value: '' }, tgs.length ? 'Choose your company…' : 'No name lists yet. Ask your teacher.'),
      ...tgs.map((tg) => h('option', { value: tg }, tg)));
  } catch (err) {
    console.error(err);
    joinMessage(friendlyError(err));
  }
}

function pickCohort(code) {
  const c = joinState.open.find((x) => x.code === code) ?? null;
  joinState.code = c?.code ?? null;
  joinState.cohort = c;
  $('j-cohort').textContent = c?.name ?? '';
  $('j-cohort').hidden = !c || joinState.open.length > 1;
  onNamePicked();
}

function fillNames() {
  const tg = $('j-tg').value;
  const names = [...(joinState.roster.get(tg)?.students ?? [])].sort((a, b) => a.localeCompare(b));
  $('j-name').replaceChildren(h('option', { value: '' }, tg ? 'Choose your name…' : 'Pick your company first'),
    ...names.map((n) => h('option', { value: n }, n)));
  $('j-name').disabled = !tg;
  onNamePicked();
}

// New students make up a PIN; returning students type theirs.
async function onNamePicked() {
  const tg = $('j-tg').value;
  const name = $('j-name').value;
  const code = joinState.code;
  joinState.existing = null;
  $('j-pin-field').hidden = true;
  $('j-btn').disabled = true;
  joinMessage('');
  if (!tg || !name || !code) return;
  const sid = rosterSid(tg, name);
  let existing;
  try {
    existing = (await getDoc(doc(db, `cohorts/${code}/students/${sid}`))).exists();
  } catch (err) {
    if (err.code !== 'permission-denied') { joinMessage(friendlyError(err)); return; }
    existing = true; // exists, but belongs to another phone
  }
  if ($('j-name').value !== name || $('j-tg').value !== tg || joinState.code !== code) return;
  joinState.existing = existing;
  if (!existing && joinState.cohort?.open !== true) {
    joinMessage('This work experience journal is closed, and you don’t have a journal in it. Ask your teacher.', 'warn');
    return;
  }
  $('j-pin-field').hidden = false;
  $('j-pin-label').textContent = 'Your PIN';
  $('j-pin-hint').textContent = existing
    ? 'Type your PIN. Still on the first PIN? It’s 1234. Forgot it? Your teacher can see it.'
    : 'First time? Your PIN is 1234. You can choose your own once you’re in.';
  $('j-btn').disabled = false;
  $('j-pin').focus();
}

async function onJoin(e) {
  e.preventDefault();
  joinMessage('');
  const code = joinState.code;
  const tg = $('j-tg').value;
  const name = $('j-name').value;
  const pin = $('j-pin').value.trim();
  const group = joinState.roster.get(tg);
  if (!code) return joinMessage(joinState.open.length > 1 ? 'Choose your work experience group first.' : 'Journals aren’t open right now.', 'warn');
  if (!group || !name) return joinMessage('Choose your company and your name.');
  if (!/^\d{4}$/.test(pin)) return joinMessage('Your PIN must be exactly 4 digits.');

  const sid = rosterSid(tg, name);
  if (joinState.existing === false && pin !== START_PIN) return joinMessage('First time? Your PIN is 1234.');
  $('j-btn').disabled = true;
  try {
    const hash = await pinHash(sid, pin);
    const studentRef = doc(db, `cohorts/${code}/students/${sid}`);
    const claimRef = doc(db, `cohorts/${code}/students/${sid}/claims/${auth.currentUser.uid}`);
    let snap = null;
    try { snap = await getDoc(studentRef); } catch (err) { if (err.code !== 'permission-denied') throw err; }
    if (snap?.exists()) {
      // This phone already owns the journal.
    } else if (snap) {
      const batch = writeBatch(db);
      batch.set(studentRef, { name, level: group.level, class: tg, pin, pinHash: hash, mustChangePin: true, createdAt: serverTimestamp(), progress: {}, lastActive: serverTimestamp() });
      batch.set(claimRef, { pinHash: hash, at: serverTimestamp() });
      await batch.commit();
    } else {
      try {
        await setDoc(claimRef, { pinHash: hash, at: serverTimestamp() });
      } catch (err) {
        if (err.code !== 'permission-denied') throw err;
        return joinMessage('That PIN doesn’t match. Try again, or ask your teacher. They can see your PIN.');
      }
    }
    writeSession({ code, sid });
    await openJournal(code, sid);
  } catch (err) {
    console.error(err);
    joinMessage(friendlyError(err));
  } finally {
    $('j-btn').disabled = false;
  }
}

// ---------- journal ----------

async function openJournal(code, sid) {
  const [c, st] = await Promise.all([getDoc(doc(db, `cohorts/${code}`)), getDoc(doc(db, `cohorts/${code}/students/${sid}`))]);
  if (!c.exists() || !st.exists()) throw new Error('journal missing');
  // Every company on the name list, with its own number of days and industry. A student who
  // corrected their company on My placement follows that one.
  const companies = await getDocs(collection(db, 'roster')).then((q) => new Map(q.docs.map((d) => [d.id, d.data()])), () => new Map());
  const company = companies.get(st.data().company) ?? companies.get(st.data().class) ?? {};
  unsubscribeAll();
  Object.assign(state, {
    code, sid, cohort: c.data(), student: st.data(), companies, company, sections: sectionsFor(company.days ?? c.data().days ?? 5),
    answers: {}, view: st.data().mustChangePin && c.data().open ? 'pin' : 'home', opened: new Set(),
  });
  created.clear();
  lastProgress = '';
  $('me-name').textContent = `Hi, ${nice(state.student.name.split(' ')[0])}!`;
  $('closed').hidden = isOpen();
  setSave('');
  const base = `cohorts/${code}/students/${sid}`;
  let first = true;
  state.unsubs = [
    onSnapshot(collection(db, `${base}/entries`), (snap) => {
      for (const d of snap.docs) {
        created.add(d.id);
        // Keep what's being typed here; take everything else from the database.
        const typing = Object.fromEntries([...timers.values()].filter((t) => t.section === d.id).map((t) => [t.id, t.value]));
        state.answers[d.id] = { ...(d.data().answers ?? {}), ...typing };
      }
      if (first) {
        first = false;
        // Save the company from the sign-in list as the placement, so teachers and the portfolio see it.
        if (isOpen() && !state.answers.placement?.company && state.student.class) {
          queueSave('placement', 'company', state.student.class);
          flushField('placement__company');
        }
        if (isOpen() && !state.answers.placement?.industry && state.company.industry) {
          queueSave('placement', 'industry', state.company.industry);
          flushField('placement__industry');
        }
        render();
      } else refreshHome();
    }, lost),
    onSnapshot(doc(db, base), (snap) => { if (snap.exists()) { state.student = snap.data(); renderMeta(); } }, () => {}),
  ];
  renderMeta();
  show('journal');
}

function lost(err) {
  console.warn(err);
  setSave(err.code === 'permission-denied' ? 'This journal was removed by your teacher. Tap Switch student.' : 'Lost connection. Reload the page.', true);
}

function unsubscribeAll() {
  for (const u of state.unsubs) u();
  state.unsubs = [];
}

async function switchStudent() {
  flushSaves();
  await Promise.allSettled([...inflight]);
  unsubscribeAll();
  writeSession(null);
  // A fresh anonymous account means the next student on this phone can't open the last one's journal.
  await signOut(auth);
  $('join-form').reset();
  fillNames();
  joinMessage('');
  show('loading');
}

function renderMeta() {
  const company = answer('placement', 'company') || state.student.company;
  $('me-meta').textContent = [...new Set([company, state.student.class].filter(Boolean))].concat(state.cohort?.name ?? []).join(' · ');
  const all = state.sections.map(sectionCount);
  const done = all.reduce((n, c) => n + c.n, 0);
  const total = all.reduce((n, c) => n + c.of, 0);
  $('progress-fill').style.width = `${Math.round((done / total) * 100)}%`;
  $('progress-text').textContent = `${Math.round((done / total) * 100)}%`;
  // Redraw the logo as the company name changes.
  redrawLogoBox();
  // Keep the open section's own bar in step as the student types.
  const head = $('panel').querySelector('.stage-head');
  const s = head && sectionById(state.view);
  if (s) {
    const c = sectionCount(s);
    head.querySelector('.stage-count').textContent = c.n >= c.of ? 'Done' : `${c.n} of ${c.of}`;
    head.querySelector('.mini-bar i').style.width = `${Math.round((c.n / c.of) * 100)}%`;
  }
}

function go(view) {
  flushSaves();
  state.view = view;
  render();
  window.scrollTo({ top: 0 });
}

function render() {
  $('journal').classList.toggle('home-view', state.view === 'home');
  renderMeta();
  if (state.view === 'home') return renderHome();
  if (state.view === 'portfolio') return renderPortfolioView();
  if (state.view === 'pin') return renderPinView();
  return renderSection(sectionById(state.view));
}

function refreshHome() {
  renderMeta();
  if (state.view === 'home') renderHome();
}

// ---------- home: the list of sections ----------

function miniBar(c) {
  return h('span', { class: 'mini-bar', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.round((c.n / c.of) * 100)}%` }));
}

function statusOf(s) {
  const c = sectionCount(s);
  return { c, done: c.n >= c.of, started: c.n > 0 };
}

function overall() {
  const all = state.sections.map(sectionCount);
  const done = all.reduce((n, c) => n + c.n, 0);
  const total = all.reduce((n, c) => n + c.of, 0);
  return { done, total, pct: Math.round((done / total) * 100) };
}

function renderHome() {
  const days = state.sections.filter((s) => s.id.startsWith('day'));
  const { done, pct } = overall();
  // "Day 2 of 5": the first day that isn't finished yet.
  const today = Math.max(1, days.findIndex((s) => !statusOf(s).done) + 1 || days.length);
  const first = nice((state.student.name ?? '').split(' ')[0]);

  const head = (label, note) => h('div', { class: 'h-head' }, h('span', { class: 'group-label' }, label), note ? h('span', { class: 'h-note' }, note) : null);

  const placement = sectionById('placement');
  const pl = statusOf(placement);
  const company = String(answer('placement', 'company')).trim();
  const wrap = sectionById('wrapup');
  const wr = statusOf(wrap);

  $('panel').replaceChildren(
    h('header', { class: 'h-hero' },
      h('div', { class: 'h-hero-text' },
        h('h1', {}, `Hi, ${first || 'there'}! 👋`),
        h('p', {}, 'Write a little each day. Next year this becomes your EAE portfolio.'),
        h('div', { class: 'h-journey' },
          h('p', {}, h('b', {}, `Day ${today}`), ` of ${days.length} · `, h('span', {}, `${pct}% complete`)),
          h('span', { class: 'mini-bar' }, h('i', { style: `width:${pct}%` }))),
        h('div', { class: 'h-links' },
          isOpen() ? h('button', { type: 'button', class: 'h-switch', onclick: () => go('pin') }, state.student.mustChangePin ? 'Choose my own PIN' : 'Change my PIN') : null,
          h('button', { type: 'button', class: 'h-switch', onclick: () => $('switch').click() }, 'Not you? Switch student'))),
      art('hero', 'h-hero-art')),

    h('button', { type: 'button', class: `h-card h-place${pl.done ? ' done' : ''}`, onclick: () => go('placement') },
      h('div', { class: 'h-place-text' },
        company ? h('span', { class: 'h-kicker' }, 'My placement') : null,
        h('b', { class: 'h-title' }, company || 'My placement'),
        h('small', {}, answer('placement', 'dept') || 'Get to know your workplace. Fill this in on Day 1.'),
        h('span', { class: 'h-dots' }, ...Array.from({ length: pl.c.of }, (_, i) => h('i', { class: i < pl.c.n ? 'on' : '' })),
          h('small', {}, `${pl.c.n} / ${pl.c.of} completed`))),
      company ? myLogo('h-place-art') : art('building', 'h-place-art'),
      h('span', { class: 'btn h-go' }, pl.done ? 'Review' : pl.started ? 'Continue' : 'Start', icon('next', 16))),

    head('Days', 'Answer 3 of 5 questions each day'),
    h('div', { class: 'h-days', style: `--n:${Math.min(days.length, 5)}` }, ...days.map((s) => {
      const { c, done: d, started } = statusOf(s);
      return h('button', {
        type: 'button', class: `h-card h-day${d ? ' done' : started ? ' part' : ''}`, onclick: () => go(s.id),
        'aria-label': `${s.title}, ${s.theme}: ${d ? 'done' : `${c.n} of ${c.of}`}`,
      },
      h('span', { class: 'h-day-top' }, h('span', { class: 'h-kicker' }, s.title), d ? icon('check', 16) : null),
      h('b', { class: 'h-day-theme' }, s.theme),
      art(s.art, 'h-day-art'),
      miniBar(c));
    })),

    head('Last day', 'Bring it all together'),
    h('button', { type: 'button', class: `h-card h-wrap${wr.done ? ' done' : ''}`, onclick: () => go('wrapup') },
      art('finish', 'h-wrap-art'),
      h('div', { class: 'h-wrap-text' },
        h('b', { class: 'h-title' }, 'Wrap-up'),
        h('small', {}, 'What you learnt, and how this week helps you next.'),
        h('span', { class: 'h-wrap-bar' }, miniBar(wr.c), h('small', {}, `${wr.c.n} / ${wr.c.of}`))),
      h('span', { class: 'h-round' }, wr.done ? icon('check', 18) : icon('next', 18))),

    h('button', { type: 'button', class: 'h-portfolio', onclick: () => go('portfolio') },
      h('div', { class: 'h-pf-text' },
        h('b', {}, icon('portfolio', 24), ' My EAE portfolio'),
        h('small', {}, 'Your reflections, ready for EAE interviews.'),
        h('small', { class: 'h-pf-count' }, `${done} answer${done === 1 ? '' : 's'} collected`)),
      art('folder', 'h-pf-art'),
      h('span', { class: 'h-pf-btn' }, 'View portfolio', icon('next', 16))),
  );
}

// ---------- one section ----------

function stageHead(s) {
  const c = sectionCount(s);
  return h('header', { class: 'stage-head' },
    h('div', { class: 'stage-title' },
      s.art ? art(s.art, 'stage-art') : null,
      h('div', { class: 'stage-name' }, s.theme ? h('span', { class: 'h-kicker' }, s.title) : null, h('h2', {}, s.theme ?? s.title)),
      h('span', { class: 'stage-count' }, c.n >= c.of ? 'Done' : `${c.n} of ${c.of}`)),
    miniBar(c),
    h('p', {}, s.blurb));
}

function field(s, p) {
  const id = `q-${s.id}-${p.id}`;
  const value = String(answer(s.id, p.id));
  const disabled = !isOpen();
  const label = h('label', { class: 'q-line', for: id }, p.q, p.optional ? h('em', { class: 'opt' }, 'optional') : null);
  // Hints sit inside the box as grey example text, so the page has fewer lines to read.
  const placeholder = p.hint ?? '';
  const hint = p.hint && (p.type === 'chips' || p.type === 'mood' || p.type === 'select') ? h('small', {}, p.hint) : null;
  if (p.type === 'chips' || p.type === 'mood') {
    const picked = new Set(value.split(',').map((x) => x.trim()).filter(Boolean));
    const opts = p.type === 'mood' ? MOODS.map((m) => ({ v: m.v, label: `${m.face} ${m.label}` })) : p.options.map((o) => ({ v: o, label: o }));
    const row = h('div', { class: `chips ${p.type}`, role: 'group', 'aria-label': p.q, id });
    const paint = () => { for (const b of row.children) b.setAttribute('aria-pressed', String(picked.has(b.dataset.v))); };
    for (const o of opts) {
      row.append(h('button', {
        type: 'button', class: 'chip', 'data-v': o.v, disabled,
        onclick: () => {
          if (p.type === 'mood') { picked.clear(); picked.add(o.v); } else if (picked.has(o.v)) picked.delete(o.v); else picked.add(o.v);
          paint();
          const v = p.type === 'mood' ? o.v : opts.filter((x) => picked.has(x.v)).map((x) => x.v).join(', ');
          queueSave(s.id, p.id, v);
          flushField(`${s.id}__${p.id}`);
        },
      }, o.label));
    }
    paint();
    return h('div', { class: 'field' }, h('span', { class: 'q-line' }, p.q), hint, row);
  }
  let input;
  if (p.type === 'company') return companyField(s, p, id, value, disabled, label, placeholder);
  if (p.type === 'select') {
    input = h('select', { id, disabled, onchange: (e) => { queueSave(s.id, p.id, e.target.value); flushField(`${s.id}__${p.id}`); } },
      h('option', { value: '' }, 'Choose…'), ...p.options.map((o) => h('option', { value: o }, o)));
    input.value = value;
  } else if (p.type === 'short') {
    input = h('input', { id, type: 'text', maxlength: String(p.max ?? 100), value, placeholder, disabled, oninput: (e) => queueSave(s.id, p.id, e.target.value) });
  } else {
    input = h('textarea', { id, maxlength: '2000', rows: '3', value, placeholder, disabled, oninput: (e) => { queueSave(s.id, p.id, e.target.value); grow(e.target); } });
    requestAnimationFrame(() => grow(input));
  }
  input.addEventListener('blur', () => flushField(`${s.id}__${p.id}`));
  return h('div', { class: 'field' }, label, hint, input);
}

// Company: the list's companies (theirs chosen already), or "Other" to type a name.
function companyField(s, p, id, value, disabled, label, hint) {
  const names = [...state.companies.keys()].sort((a, b) => a.localeCompare(b));
  const other = !!value && !state.companies.has(value);
  const typed = h('input', {
    type: 'text', maxlength: String(p.max ?? 100), value: other ? value : '', placeholder: 'Type the company name', disabled, hidden: !other, 'aria-label': 'Company name',
    oninput: (e) => queueSave(s.id, p.id, e.target.value),
  });
  typed.addEventListener('blur', () => flushField(`${s.id}__${p.id}`));
  const pick = h('select', {
    id, disabled,
    onchange: (e) => {
      if (e.target.value === '__other') { typed.hidden = false; typed.focus(); return; }
      typed.hidden = true;
      queueSave(s.id, p.id, e.target.value);
      flushField(`${s.id}__${p.id}`);
      switchCompany(e.target.value);
    },
  }, ...names.map((n) => h('option', { value: n }, n)), h('option', { value: '__other' }, 'Other (type it)'));
  pick.value = other ? '__other' : value;
  return h('div', { class: 'field' }, label, h('small', {}, hint), pick, typed);
}

// Switching company changes the number of days (and fills in the industry if it's empty).
function switchCompany(name) {
  const c = state.companies.get(name);
  if (!c) return;
  state.company = c;
  state.sections = sectionsFor(c.days ?? state.cohort.days ?? 5);
  if (c.industry && !state.answers.placement?.industry) {
    queueSave('placement', 'industry', c.industry);
    flushField('placement__industry');
  }
  // The logo found for the old company no longer fits; look up the new one.
  if (answer('placement', 'logoUrl') || answer('placement', 'website')) { setPlacement('logoUrl', ''); setPlacement('website', ''); }
  lookup.query = '';
  render();
}

function grow(el) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight + 4, 480)}px`;
}

function renderSection(s) {
  if (!s) return go('home');
  const i = state.sections.indexOf(s);
  const next = state.sections[i + 1];
  $('panel').style.removeProperty('--stage');
  $('panel').replaceChildren(
    h('button', { type: 'button', class: 'btn quiet back', onclick: () => go('home') }, icon('back', 16), ' My journal'),
    stageHead(s),
    ...(s.id === 'placement' ? [logoSection()] : []),
    ...s.prompts.map((p) => (s.pick?.from.includes(p.id) ? pickField(s, p) : field(s, p))),
    h('div', { class: 'nav' },
      next ? h('button', { type: 'button', class: 'btn', onclick: () => go(next.id) }, `Next: ${next.title} →`)
        : h('button', { type: 'button', class: 'btn', onclick: () => go('portfolio') }, 'See my portfolio →')),
  );
  // Look up the company's logo, unless one is already set: now, and again if they change the name.
  const autoLookup = () => {
    const name = String(answer('placement', 'company')).trim();
    const set = knownLogo(name) || isOkLogoUrl(answer('placement', 'logoUrl')) || siteDomain(answer('placement', 'website'));
    if (name && !set && isOpen() && lookup.query !== name) runLookup();
  };
  if (s.id === 'placement') autoLookup();
  $('q-placement-company')?.addEventListener('blur', autoLookup);
}

// One of the five reflection questions. Students open the ones they choose to answer;
// on the last day (or once written) a question stays open.
function pickField(s, p) {
  const key = `${s.id}__${p.id}`;
  const written = isAnswered(answer(s.id, p.id));
  const open = s.last || written || state.opened.has(key);
  const n = s.pick.from.indexOf(p.id) + 1;
  if (open) {
    const f = field(s, p);
    f.classList.add('pick', 'on');
    f.querySelector('.q-line').prepend(h('span', { class: 'pick-n' }, String(n)));
    return f;
  }
  const done = sectionCount(s).n >= s.pick.need;
  return h('button', {
    type: 'button', class: `field pick${done ? ' extra' : ''}`, disabled: !isOpen(),
    onclick: () => { state.opened.add(key); render(); requestAnimationFrame(() => $(`q-${s.id}-${p.id}`)?.focus()); },
  },
  h('span', { class: 'q-line' }, h('span', { class: 'pick-n' }, String(n)), p.q),
  h('span', { class: 'pick-go' }, done ? '+ Answer this too (optional)' : '+ Answer this'));
}

// ---------- company logo ----------

// Online lookup state survives the logo box being redrawn as the student types.
const lookup = { query: '', status: '', results: [], ctrl: null };

async function runLookup() {
  const name = String(answer('placement', 'company')).trim();
  if (!name) return;
  lookup.ctrl?.abort();
  const ctrl = new AbortController();
  Object.assign(lookup, { query: name, status: 'searching', results: [], ctrl });
  redrawLogoBox();
  try {
    const results = await findCompany(name, { signal: ctrl.signal });
    if (lookup.ctrl !== ctrl) return;
    Object.assign(lookup, { status: results.length ? 'results' : 'none', results });
  } catch (err) {
    if (ctrl.signal.aborted) return;
    console.warn(err);
    lookup.status = navigator.onLine === false ? 'offline' : 'error';
  }
  redrawLogoBox();
}

function setPlacement(id, value) {
  queueSave('placement', id, value);
  flushField(`placement__${id}`);
  const input = $(`q-placement-${id}`);
  if (input) input.value = value;
}

function useCompany(r) {
  setPlacement('website', siteDomain(r.website) || '');
  setPlacement('logoUrl', r.logoUrl || '');
  Object.assign(lookup, { status: 'picked', results: [] });
  redrawLogoBox();
}

function clearFound() {
  setPlacement('website', '');
  setPlacement('logoUrl', '');
  Object.assign(lookup, { status: '', results: [] });
  redrawLogoBox();
}

function redrawLogoBox() {
  const lb = $('panel').querySelector('.logo-box');
  if (lb && state.view === 'placement') lb.replaceWith(logoSection());
}

function logoSection() {
  const name = String(answer('placement', 'company')).trim();
  const known = !!knownLogo(name);
  const online = !known && (isOkLogoUrl(answer('placement', 'logoUrl')) || siteDomain(answer('placement', 'website')));
  const note = known ? 'Your company’s logo, from your teachers.'
    : online ? 'Found online. Not the right one? Search again.'
    : name ? 'Our school crest for now. Tap Find logo online, or type the company website below.'
      : 'Type your company name below, then find its logo.';
  const results = lookup.status === 'results' && lookup.query === name
    ? h('div', { class: 'lookup-list' },
      h('small', { class: 'muted' }, 'Which one is it?'),
      ...lookup.results.map((r) => h('button', { type: 'button', class: 'lookup-item', onclick: () => useCompany(r) },
        companyLogo({ name: r.name, site: r.website, logoUrl: r.logoUrl }, 'sm', { school: false }),
        h('span', {}, h('b', {}, r.name), h('small', {}, [r.about, siteDomain(r.website)].filter(Boolean).join(' · '))))),
      h('button', { type: 'button', class: 'btn quiet small-btn', onclick: () => { lookup.status = 'none-picked'; redrawLogoBox(); } }, 'None of these'))
    : null;
  const status = {
    searching: 'Searching online…',
    none: 'Couldn’t find this company online. Type its website below, or keep the school crest.',
    'none-picked': 'No problem. Type the website below, or keep the school crest.',
    offline: 'You’re offline. Try again when you have signal.',
    error: 'The search didn’t work. Try again in a moment.',
  }[lookup.query === name ? lookup.status : ''];
  return h('section', { class: 'logo-box' },
    h('div', { class: 'logo-top' },
      myLogo('lg'),
      h('div', { class: 'logo-text' },
        h('b', {}, 'Company logo'),
        h('small', { class: 'muted' }, note),
        isOpen() && !known ? h('div', { class: 'logo-actions' },
          name ? h('button', { type: 'button', class: 'btn small-btn', disabled: lookup.status === 'searching' && lookup.query === name, onclick: runLookup },
            online ? 'Search again' : 'Find logo online') : null,
          online ? h('button', { type: 'button', class: 'btn quiet small-btn', onclick: clearFound }, 'Clear') : null) : null)),
    status ? h('p', { class: 'small muted lookup-status' }, status) : null,
    results);
}

// ---------- choosing a PIN ----------

function renderPinView() {
  $('panel').style.removeProperty('--stage');
  const first = state.student.mustChangePin;
  const a = h('input', { id: 'pin-a', type: 'password', inputmode: 'numeric', maxlength: '4', autocomplete: 'off' });
  const b = h('input', { id: 'pin-b', type: 'password', inputmode: 'numeric', maxlength: '4', autocomplete: 'off' });
  const msg = h('p', { class: 'msg', hidden: true });
  const say = (text, kind = 'err') => { msg.textContent = text; msg.className = `msg ${kind}`; msg.hidden = !text; };
  const save = h('button', { type: 'submit', class: 'btn big' }, 'Save my PIN');
  const form = h('form', {
    class: 'pin-card', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const pin = a.value.trim();
      if (!/^\d{4}$/.test(pin)) return say('Your PIN must be exactly 4 digits.');
      if (pin === START_PIN) return say('Choose a PIN that isn’t 1234.');
      if (pin !== b.value.trim()) return say('The two PINs don’t match. Try again.');
      save.disabled = true;
      try {
        await updateDoc(doc(db, `cohorts/${state.code}/students/${state.sid}`), { pin, pinHash: await pinHash(state.sid, pin), mustChangePin: false });
        state.student.mustChangePin = false;
        celebrate('#1d4ed8', 'New PIN saved!');
        go('home');
      } catch (err) {
        console.error(err);
        say(err.code === 'permission-denied' ? 'Your journal is closed, so the PIN can’t be changed now.' : 'That didn’t save. Check your connection and try again.');
        save.disabled = false;
      }
    },
  },
  art('clipboard', 'pin-art'),
  h('h2', {}, first ? 'Welcome! Choose your own PIN' : 'Change my PIN'),
  h('p', { class: 'muted' }, first
    ? 'Everyone starts with 1234. Pick your own 4 digits so only you can open your journal. Write it down: you’ll need it next year for your EAE interview.'
    : 'Pick a new 4-digit PIN. You’ll use it the next time you sign in on a phone.'),
  h('label', { class: 'field' }, h('span', {}, 'New PIN'), a),
  h('label', { class: 'field' }, h('span', {}, 'Type it again'), b),
  msg, save,
  h('button', { type: 'button', class: 'btn quiet', onclick: () => go('home') }, first ? 'Not now, keep 1234' : 'Cancel'));
  $('panel').replaceChildren(form);
  requestAnimationFrame(() => a.focus());
}

// ---------- portfolio ----------

function renderPortfolioView() {
  $('panel').style.setProperty('--stage', '#0f172a');
  const pf = renderPortfolio({
    student: state.student, cohort: state.cohort, answers: state.answers,
  }, { goTo: (id) => go(id) });
  $('panel').replaceChildren(
    h('div', { class: 'pf-bar no-print' },
      h('button', { type: 'button', class: 'btn quiet back', onclick: () => go('home') }, icon('back', 16), ' My journal'),
      h('button', { type: 'button', class: 'btn', onclick: () => window.print() }, icon('print', 18), ' Print / save as PDF')),
    pf);
  if (state.answers.wrapup?.pitch && !renderPortfolioView.cheered) {
    renderPortfolioView.cheered = true;
    celebrate('#1d4ed8', 'Your portfolio is ready!');
  }
}

// ---------- boot ----------

$('j-cohort-sel').addEventListener('change', () => pickCohort($('j-cohort-sel').value));
$('j-tg').addEventListener('change', fillNames);
$('j-name').addEventListener('change', onNamePicked);
$('join-form').addEventListener('submit', onJoin);
$('switch').addEventListener('click', switchStudent);

if (!configured && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  show('setup');
} else {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      try { await signInAnonymously(auth); } catch (err) { console.error(err); show('join'); joinMessage(friendlyError(err)); }
      return;
    }
    const saved = readSession();
    if (saved?.code && saved?.sid) {
      try { await openJournal(saved.code, saved.sid); return; } catch (err) { console.warn('Saved journal could not be opened', err); writeSession(null); }
    }
    show('join');
    await loadJoinScreen();
  });
}
