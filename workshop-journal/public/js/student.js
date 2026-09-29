import { signInAnonymously, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, writeBatch, collection, onSnapshot, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { auth, db, configured, studentId, pinHash, normaliseCode } from './firebase.js';
import { STAGES, LEARNING_TAGS, TRACK_LABEL, LOG_STYLE, promptFor } from './prompts.js';
import { PROBLEMS, OWN_IDEA, CATEGORY, problemLabel, findProblem } from './problems.js';
import { icon } from './icons.js';
import { celebrate } from './confetti.js';

const $ = (id) => document.getElementById(id);
const SESSION_KEY = 'journal.session';
const LOG_ID = 'log';

const state = {
  code: null, sid: null, workshop: null, student: null,
  entries: new Map(), current: LOG_ID, unsub: null, logType: 'learnt',
};

// ---------- small helpers ----------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value' || (k in el && typeof v !== 'string')) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

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
  if (err?.code === 'unavailable') return "Can't reach the journal. Check the Wi-Fi and try again.";
  return 'Something went wrong. Try again, or ask your teacher.';
}

function joinMessage(text, kind = 'err') {
  const m = $('j-msg');
  m.textContent = text;
  m.className = `msg ${kind}`;
  m.hidden = !text;
}

const isOpen = () => state.workshop?.open === true;
const track = () => state.workshop?.track ?? 'code';

// ---------- saving ----------

let pending = 0;
const inflight = new Set();
function setSave(text, bad = false) {
  const el = $('save');
  el.textContent = text;
  el.classList.toggle('bad', bad);
}
async function saving(promise) {
  inflight.add(promise);
  promise.catch(() => {}).finally(() => inflight.delete(promise));
  pending++;
  setSave('Saving…');
  try {
    await promise;
    pending--;
    if (!pending) setSave(`Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
  } catch (err) {
    pending--;
    console.error(err);
    setSave(err?.code === 'permission-denied' ? 'Not saved: the workshop is closed' : 'Not saved yet. Check the Wi-Fi', true);
  }
}
const timers = new Map(); // stageId -> { timer, answers } waiting to be saved

function queueStageSave(stageId, answers) {
  clearTimeout(timers.get(stageId)?.timer);
  const timer = setTimeout(() => { timers.delete(stageId); saveStage(stageId, answers); }, 1500);
  timers.set(stageId, { timer, answers });
}

// Save anything still waiting on the debounce, e.g. when the student changes section or leaves the page.
function flushSaves() {
  for (const [stageId, { timer, answers }] of timers) {
    clearTimeout(timer);
    timers.delete(stageId);
    saveStage(stageId, answers);
  }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSaves(); });
window.addEventListener('beforeunload', (e) => {
  flushSaves();
  if (pending) e.preventDefault();
});

async function saveStage(stageId, answers) {
  const ref = doc(db, `workshops/${state.code}/students/${state.sid}/entries/${stageId}`);
  const data = { kind: 'stage', stage: stageId, answers, updatedAt: serverTimestamp() };
  if (!state.entries.has(stageId)) data.createdAt = serverTimestamp();
  saving(setDoc(ref, data, { merge: true }));

  const stage = STAGES.find((s) => s.id === stageId);
  const answered = stage.prompts.filter((p) => (answers[p.id] ?? '').trim()).length;
  const progress = { ...(state.student.progress ?? {}) };
  if (progress[stageId] !== answered) {
    const justFinished = answered >= stage.prompts.length && (progress[stageId] ?? 0) < stage.prompts.length;
    progress[stageId] = answered;
    state.student.progress = progress;
    renderNav();
    if (justFinished) celebrate(stage.color, `${stage.title} complete!`);
    saving(updateDoc(doc(db, `workshops/${state.code}/students/${state.sid}`), { progress, lastActive: serverTimestamp() }));
  }
}

// ---------- join ----------

async function onJoin(e) {
  e.preventDefault();
  joinMessage('');
  const code = normaliseCode($('j-code').value);
  const team = Number.parseInt($('j-team').value, 10);
  const name = $('j-name').value.trim().replace(/\s+/g, ' ');
  const pin = $('j-pin').value.trim();

  if (code.length < 4) return joinMessage('Enter the workshop code from the screen.');
  if (!(team >= 1 && team <= 40)) return joinMessage('Enter your team number (1–40).');
  if (!/[a-z]/i.test(name) || name.length < 2) return joinMessage('Enter your first name and the first letter of your surname.');
  if (!/^\d{4}$/.test(pin)) return joinMessage('Your PIN must be exactly 4 digits.');

  const sid = studentId(team, name);
  $('j-btn').disabled = true;
  try {
    const ws = await getDoc(doc(db, `workshops/${code}`));
    if (!ws.exists()) return joinMessage("We couldn't find that workshop code. Check it with your teacher.");
    const open = ws.data().open === true;
    const hash = await pinHash(sid, pin);
    const studentRef = doc(db, `workshops/${code}/students/${sid}`);
    const claimRef = doc(db, `workshops/${code}/students/${sid}/claims/${auth.currentUser.uid}`);

    let snap = null;
    try {
      snap = await getDoc(studentRef);
    } catch (err) {
      if (err.code !== 'permission-denied') throw err;
    }

    if (snap?.exists()) {
      // This device already owns this journal.
    } else if (snap) {
      if (!open) return joinMessage('This workshop is closed, so new journals can’t be started.');
      const batch = writeBatch(db);
      batch.set(studentRef, { name, team, pinHash: hash, createdAt: serverTimestamp(), progress: {}, lastActive: serverTimestamp() });
      batch.set(claimRef, { pinHash: hash, at: serverTimestamp() });
      await batch.commit();
    } else {
      // The journal exists and belongs to another device: prove it's ours with the PIN.
      if (!open) return joinMessage('This workshop is closed. Open your journal on the laptop you used before, or ask your teacher.');
      try {
        await setDoc(claimRef, { pinHash: hash, at: serverTimestamp() });
      } catch (err) {
        if (err.code !== 'permission-denied') throw err;
        return joinMessage(`Someone called "${name}" in team ${team} already has a journal, and that PIN doesn't match. If it's you, check your PIN. If it isn't, add your surname initial to your name.`);
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
  const [ws, st] = await Promise.all([
    getDoc(doc(db, `workshops/${code}`)),
    getDoc(doc(db, `workshops/${code}/students/${sid}`)),
  ]);
  if (!ws.exists() || !st.exists()) throw new Error('journal missing');

  Object.assign(state, { code, sid, workshop: ws.data(), student: st.data(), entries: new Map(), current: LOG_ID });
  document.body.dataset.track = track();
  $('me-name').textContent = `Hi, ${state.student.name.split(' ')[0]}!`;
  $('me-meta').textContent = `Team ${state.student.team} · ${state.workshop.name} · ${TRACK_LABEL[track()]}`;
  $('closed').hidden = isOpen();
  setSave('');

  state.unsub?.();
  state.unsub = onSnapshot(collection(db, `workshops/${code}/students/${sid}/entries`), (snap) => {
    for (const change of snap.docChanges()) {
      if (change.type === 'removed') state.entries.delete(change.doc.id);
      else state.entries.set(change.doc.id, { id: change.doc.id, ...change.doc.data({ serverTimestamps: 'estimate' }) });
    }
    refreshFromRemote();
  }, (err) => { console.error(err); setSave('Lost connection to your journal. Reload the page', true); });

  show('journal');
  renderNav();
  renderPanel();
}

async function switchStudent() {
  flushSaves();
  await Promise.allSettled([...inflight]);
  state.unsub?.();
  state.unsub = null;
  writeSession(null);
  // A fresh anonymous account means the next student on this laptop can't open the last one's journal.
  await signOut(auth);
  $('join-form').reset();
  joinMessage('');
  show('loading');
}

function stageCount(stage) {
  return state.student.progress?.[stage.id] ?? 0;
}

function renderNav() {
  const nav = $('stages');
  const logCount = [...state.entries.values()].filter((e) => e.kind === 'learning').length;
  const btn = (id, title, sub, dotClass, style) => h('button', {
    class: 'stage-btn', type: 'button', 'aria-current': String(state.current === id), style: `--c:${style.color}`,
    onclick: () => { state.current = id; renderNav(); renderPanel(); },
  }, h('span', { class: `dot ${dotClass}` }, icon(dotClass === 'done' ? 'check' : style.icon, 16)), h('span', {}, title, h('small', {}, sub)));

  const items = [h('div', { class: 'stage-sep' }, 'Anytime'),
    btn(LOG_ID, 'Learning log', `${logCount} ${logCount === 1 ? 'entry' : 'entries'}`, logCount ? 'part' : '', LOG_STYLE)];
  let day = null;
  let done = 0;
  let answeredAll = 0;
  let totalAll = 0;
  STAGES.forEach((s) => {
    if (s.day !== day) { day = s.day; items.push(h('div', { class: 'stage-sep' }, day)); }
    const n = Math.min(stageCount(s), s.prompts.length);
    const total = s.prompts.length;
    if (n >= total) done++;
    answeredAll += n;
    totalAll += total;
    items.push(btn(s.id, s.title, n >= total ? 'Complete!' : `${n}/${total} answered`, n >= total ? 'done' : n ? 'part' : '', s));
  });
  nav.replaceChildren(...items);

  const pct = Math.round((answeredAll / totalAll) * 100);
  $('progress-fill').style.width = `${pct}%`;
  $('progress-text').textContent = done === STAGES.length
    ? 'Journal complete. Amazing work!'
    : `${pct}% · ${done} of ${STAGES.length} stages complete`;
}

function renderPanel() {
  flushSaves();
  if (state.current === LOG_ID) renderLog();
  else renderStage(STAGES.find((s) => s.id === state.current));
  $('panel').scrollIntoView?.({ block: 'nearest' });
}

function renderStage(stage) {
  const i = STAGES.indexOf(stage);
  const answers = { ...(state.entries.get(stage.id)?.answers ?? {}) };
  const fields = stage.prompts.map((raw) => {
    const p = promptFor(raw, track());
    const id = `q-${stage.id}-${p.id}`;
    if (p.type === 'problem') return problemPicker(stage, p, id, answers);
    return h('label', { class: 'field', for: id },
      h('span', {}, p.q),
      p.hint ? h('small', {}, p.hint) : null,
      h('textarea', {
        id, 'data-prompt': p.id, maxLength: 1500, disabled: !isOpen(), value: answers[p.id] ?? '',
        oninput: (e) => { answers[p.id] = e.target.value; queueStageSave(stage.id, answers); },
      }));
  });
  const go = (j) => { state.current = STAGES[j].id; renderNav(); renderPanel(); };
  $('panel').style.setProperty('--stage', stage.color);
  $('panel').replaceChildren(
    stageHeader(stage.icon, `${stage.day} · Worksheet ${stage.sheet} · Stage ${i + 1} of ${STAGES.length}`, stage.title, stage.blurb),
    ...fields,
    h('div', { class: 'nav' },
      i > 0 ? h('button', { class: 'btn ghost', type: 'button', onclick: () => go(i - 1) }, `← ${STAGES[i - 1].title}`) : h('span'),
      i < STAGES.length - 1 ? h('button', { class: 'btn', type: 'button', onclick: () => go(i + 1) }, `${STAGES[i + 1].title} →`) : null),
  );
}

function stageHeader(iconName, label, title, blurb) {
  return h('header', { class: 'stage-head' },
    h('span', { class: 'stage-badge' }, icon(iconName, 30)),
    h('div', {}, h('span', { class: 'label' }, label), h('h2', {}, title), h('p', {}, blurb)));
}

function problemCard(p) {
  if (!p) {
    return h('div', { class: 'pcard empty' }, icon('sparkle', 28),
      h('p', {}, 'Pick your team’s problem from the list to see its details here.'));
  }
  const cat = CATEGORY[p.cat];
  return h('div', { class: 'pcard', style: `--pc:${cat.color}` },
    h('span', { class: 'pcard-icon' }, icon(p.icon, 34)),
    h('div', { class: 'pcard-body' },
      h('span', { class: 'pill-cat' }, p.id === 'own' ? cat.label : `${cat.label} · #${p.id}`),
      h('h3', {}, p.title),
      h('p', {}, p.text),
      p.hmw ? h('p', { class: 'hmw' }, p.hmw) : null,
      p.tech ? h('p', { class: 'tech' }, h('b', {}, track() === 'ai' ? 'Model: ' : 'Sensors: '), p.tech) : null));
}

function problemPicker(stage, p, id, answers) {
  const list = PROBLEMS[track()] ?? [];
  const current = findProblem(track(), answers[p.id]);
  const card = h('div', { class: 'pcard-slot' }, problemCard(current));
  const group = (cat) => h('optgroup', { label: CATEGORY[cat].label },
    ...list.filter((x) => x.cat === cat).map((x) => h('option', { value: problemLabel(x) }, `#${x.id}  ${x.title}`)));
  const select = h('select', {
    id, class: 'problem-select', 'data-prompt': p.id, disabled: !isOpen(),
    onchange: (e) => {
      answers[p.id] = e.target.value;
      card.replaceChildren(problemCard(findProblem(track(), e.target.value)));
      queueStageSave(stage.id, answers);
    },
  },
  h('option', { value: '' }, 'Choose a problem statement…'),
  group('food'), group('health'),
  h('optgroup', { label: 'Something else' }, h('option', { value: OWN_IDEA.title }, OWN_IDEA.title)));
  select.value = answers[p.id] ?? '';
  return h('div', { class: 'field' }, h('label', { for: id }, h('span', {}, p.q)), select, card);
}

function renderLog() {
  const tags = LEARNING_TAGS[track()];
  const text = h('textarea', { id: 'log-text', maxLength: 2000, disabled: !isOpen() });
  const tag = h('select', { id: 'log-tag', disabled: !isOpen() }, ...tags.map((t) => h('option', { value: t }, t)));
  const hint = h('small', { id: 'log-hint' });
  const setType = (type) => {
    state.logType = type;
    for (const b of toggle.children) b.setAttribute('aria-pressed', String(b.dataset.type === type));
    hint.textContent = type === 'learnt'
      ? 'Something new you understand now. Explain it in your own words.'
      : 'Evidence you collected: a measurement, a quote, a sensor reading, a fact with its source, a link.';
    text.placeholder = type === 'learnt'
      ? 'e.g. An IF / ELSE block lets the micro:bit choose between two actions based on a sensor reading.'
      : 'e.g. Curry dropped from 72 °C to 58 °C in 25 minutes on the counter (our probe test).';
  };
  const toggle = h('div', { class: 'toggle', role: 'group', 'aria-label': 'Entry type' },
    h('button', { type: 'button', 'data-type': 'learnt', onclick: () => setType('learnt'), disabled: !isOpen() }, 'I learnt'),
    h('button', { type: 'button', 'data-type': 'gathered', onclick: () => setType('gathered'), disabled: !isOpen() }, 'I gathered'));
  setType(state.logType);

  const add = async () => {
    const value = text.value.trim();
    if (!value) { text.focus(); return; }
    text.value = '';
    await saving(addDoc(collection(db, `workshops/${state.code}/students/${state.sid}/entries`), {
      kind: 'learning', type: state.logType, tag: tag.value, text: value, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  };

  $('panel').style.setProperty('--stage', LOG_STYLE.color);
  $('panel').replaceChildren(
    stageHeader(LOG_STYLE.icon, 'Anytime', 'Learning log', 'Add an entry whenever you learn something new or collect evidence for your project. Aim for at least 3 of each by the end of Day 2.'),
    h('div', { class: 'log-add' },
      h('div', { class: 'field' }, h('span', {}, 'Type'), toggle),
      h('label', { class: 'field', for: 'log-tag' }, h('span', {}, 'Topic'), tag),
      h('label', { class: 'field', for: 'log-text', style: 'grid-column:1/-1' }, h('span', {}, 'Entry'), hint, text)),
    h('div', {}, h('button', { class: 'btn', type: 'button', onclick: add, disabled: !isOpen() }, 'Add to log')),
    h('ul', { class: 'log-list', id: 'log-list' }),
  );
  renderLogList();
}

function renderLogList() {
  const list = $('log-list');
  if (!list) return;
  const items = [...state.entries.values()]
    .filter((e) => e.kind === 'learning')
    .sort((a, b) => (b.createdAt?.toMillis?.() ?? Date.now()) - (a.createdAt?.toMillis?.() ?? Date.now()));
  if (!items.length) {
    list.replaceChildren(h('li', { class: 'muted small' }, 'Nothing here yet. Your entries will appear here, newest first.'));
    return;
  }
  list.replaceChildren(...items.map((e) => h('li', { class: 'log-item' },
    h('div', { class: 'meta' },
      h('span', { class: `pill ${e.type === 'gathered' ? 'gathered' : ''}` }, e.type === 'gathered' ? 'Gathered' : 'Learnt'),
      h('span', { class: 'pill' }, e.tag ?? 'Other'),
      h('span', { class: 'small muted' }, e.createdAt?.toDate?.().toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) ?? '')),
    isOpen() ? h('button', {
      class: 'btn quiet', type: 'button', 'aria-label': 'Delete entry',
      onclick: (ev) => {
        const b = ev.currentTarget;
        if (b.dataset.armed) saving(deleteDoc(doc(db, `workshops/${state.code}/students/${state.sid}/entries/${e.id}`)));
        else { b.dataset.armed = '1'; b.textContent = 'Tap again to delete'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'Delete'; }, 3000); }
      },
    }, 'Delete') : h('span'),
    h('p', {}, e.text))));
}

// Another device (or the teacher closing the workshop) may change entries while this page is open.
function refreshFromRemote() {
  renderNav();
  if (state.current === LOG_ID) { renderLogList(); return; }
  const answers = state.entries.get(state.current)?.answers ?? {};
  for (const sel of $('panel').querySelectorAll('select[data-prompt]')) {
    const v = answers[sel.dataset.prompt] ?? '';
    if (sel !== document.activeElement && !timers.has(state.current) && sel.value !== v) {
      sel.value = v;
      sel.closest('.field').querySelector('.pcard-slot')?.replaceChildren(problemCard(findProblem(track(), v)));
    }
  }
  for (const ta of $('panel').querySelectorAll('textarea[data-prompt]')) {
    if (ta !== document.activeElement && !timers.has(state.current) && (answers[ta.dataset.prompt] ?? '') !== ta.value) {
      ta.value = answers[ta.dataset.prompt] ?? '';
    }
  }
}

// ---------- boot ----------

$('hero-art').append(...[...STAGES, LOG_STYLE].map((st) => {
  const b = document.createElement('span');
  b.className = 'hero-dot';
  b.style.setProperty('--c', st.color);
  b.append(icon(st.icon, 22));
  return b;
}));
$('join-form').addEventListener('submit', onJoin);
$('switch').addEventListener('click', switchStudent);
$('j-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });

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
  });
}
