import { signInAnonymously, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, writeBatch, collection, onSnapshot, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { auth, db, configured, rosterSid, pinHash } from './firebase.js';
import { STAGES, LEARNING_TAGS, TRACK_LABEL, LOG_STYLE, promptFor, isPersonal } from './prompts.js';
import { PROBLEMS, OWN_IDEA, CATEGORY, problemLabel, findProblem } from './problems.js';
import { icon } from './icons.js';
import { celebrate } from './confetti.js';
import { trackForLevel } from './school.js';

const $ = (id) => document.getElementById(id);
const SESSION_KEY = 'journal.session';
const LOG_ID = 'log';
const GALLERY_ID = 'gallery';
const GALLERY_STYLE = { color: '#ca8a04', icon: 'test' };

const state = {
  code: null, sid: null, workshop: null, student: null,
  // entries: this student's own docs (learning log + personal answers).
  // teamEntries / images / feedback / locks / members: shared by everyone in the same class + team.
  entries: new Map(), teamEntries: new Map(), images: new Map(), feedback: new Map(), locks: new Map(), members: new Map(),
  teamKey: null, current: LOG_ID, unsubs: [], logType: 'learnt',
};

const teamPath = (sub = '') => `workshops/${state.code}/teams/${state.teamKey}${sub}`;
const fieldKey = (stageId, pid) => `${stageId}__${pid}`;

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
// Sec 1 students get Code for Fun, Sec 2 get AI for Fun; older journals fall back to the workshop's track.
const track = () => (state.student?.level ? trackForLevel(state.student.level) : state.workshop?.track ?? 'code');

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
// Each answer box saves on its own (1.5 s after typing stops), so teammates editing
// different boxes never overwrite each other.
const timers = new Map(); // fieldKey -> { timer, stageId, prompt, value }
const drafts = new Map(); // fieldKey -> value typed here but not yet confirmed by the server

function answerOf(stageId, p) {
  const k = fieldKey(stageId, p.id);
  if (drafts.has(k)) return drafts.get(k);
  const src = isPersonal(p) ? state.entries : state.teamEntries;
  return src.get(stageId)?.answers?.[p.id] ?? '';
}

function queueFieldSave(stageId, p, value) {
  const k = fieldKey(stageId, p.id);
  drafts.set(k, value);
  clearTimeout(timers.get(k)?.timer);
  const timer = setTimeout(() => { timers.delete(k); saveField(stageId, p, value); }, 1500);
  timers.set(k, { timer, stageId, prompt: p, value });
}

function flushField(k) {
  const t = timers.get(k);
  if (!t) return Promise.resolve();
  clearTimeout(t.timer);
  timers.delete(k);
  return saveField(t.stageId, t.prompt, t.value);
}

// Save anything still waiting on the debounce, e.g. when the student changes section or leaves the page.
function flushSaves() {
  for (const k of [...timers.keys()]) flushField(k);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { flushSaves(); releaseAllLocks(); }
});
window.addEventListener('beforeunload', (e) => {
  flushSaves();
  releaseAllLocks();
  if (pending) e.preventDefault();
});

function stageCounts(stage) {
  let team = 0;
  let personal = 0;
  for (const p of stage.prompts) {
    if (!String(answerOf(stage.id, p)).trim()) continue;
    if (isPersonal(p)) personal++; else team++;
  }
  return { team, personal, total: team + personal };
}

async function saveField(stageId, p, value) {
  const stage = STAGES.find((s) => s.id === stageId);
  const before = stageCounts(stage).total;
  const k = fieldKey(stageId, p.id);
  drafts.set(k, value);
  const personal = isPersonal(p);
  const ref = personal
    ? doc(db, `workshops/${state.code}/students/${state.sid}/entries/${stageId}`)
    : doc(db, teamPath(`/entries/${stageId}`));
  const exists = (personal ? state.entries : state.teamEntries).has(stageId);
  const data = { kind: 'stage', stage: stageId, answers: { [p.id]: value }, updatedAt: serverTimestamp() };
  if (!exists) data.createdAt = serverTimestamp();
  const write = setDoc(ref, data, { merge: true });
  // Visitors on the gallery walk see the team's chosen problem as its project title.
  if (stageId === 'empathise' && p.id === 'problem' && !personal) {
    saving(setDoc(doc(db, teamPath()), { title: value, updatedAt: serverTimestamp() }, { merge: true }));
  }
  saving(write);
  write.then(() => { if (drafts.get(k) === value) drafts.delete(k); }, () => {});

  const after = stageCounts(stage).total;
  renderNav();
  if (after >= stage.prompts.length && before < stage.prompts.length) celebrate(stage.color, `${stage.title} complete!`);
  saveProgress();
}

// Progress is stored for the teacher dashboard: team answers on the team doc, personal ones on the student doc.
let lastProgress = '';
function saveProgress() {
  const teamP = {};
  const mine = {};
  for (const st of STAGES) {
    const c = stageCounts(st);
    teamP[st.id] = c.team;
    mine[st.id] = c.personal;
  }
  const sig = JSON.stringify([teamP, mine]);
  if (sig === lastProgress) return;
  lastProgress = sig;
  saving(setDoc(doc(db, teamPath()), { progress: teamP, updatedAt: serverTimestamp() }, { merge: true }));
  saving(updateDoc(doc(db, `workshops/${state.code}/students/${state.sid}`), { progress: mine, lastActive: serverTimestamp() }));
}

// ---------- answer locks (one teammate per box) ----------

const LOCK_FRESH_MS = 45000;
const myLocks = new Set();
let heartbeat = null;

function lockOf(k) {
  const l = state.locks.get(k);
  if (!l || l.uid === auth.currentUser?.uid) return null;
  const at = l.at?.toMillis?.() ?? Date.now();
  return Date.now() - at < LOCK_FRESH_MS ? l : null;
}

async function acquireLock(k) {
  myLocks.add(k);
  try {
    await setDoc(doc(db, teamPath(`/locks/${k}`)), { uid: auth.currentUser.uid, name: state.student.name, at: serverTimestamp() });
    if (!heartbeat) heartbeat = setInterval(refreshLocks, 20000);
    return true;
  } catch (err) {
    myLocks.delete(k);
    if (err.code !== 'permission-denied') console.warn('lock failed', err);
    return false;
  }
}

function refreshLocks() {
  if (!myLocks.size) { clearInterval(heartbeat); heartbeat = null; return; }
  for (const k of myLocks) {
    setDoc(doc(db, teamPath(`/locks/${k}`)), { uid: auth.currentUser.uid, name: state.student.name, at: serverTimestamp() }).catch(() => myLocks.delete(k));
  }
}

async function releaseLock(k) {
  if (!myLocks.has(k)) return;
  myLocks.delete(k);
  await flushField(k).catch(() => {});
  deleteDoc(doc(db, teamPath(`/locks/${k}`))).catch(() => {});
}

function releaseAllLocks() {
  if (!state.teamKey) return;
  for (const k of [...myLocks]) releaseLock(k);
}

// Wire focus / blur on a shared answer box so only one teammate can edit it at a time.
function lockable(el, stageId, p) {
  if (isPersonal(p)) return el;
  const k = fieldKey(stageId, p.id);
  el.dataset.field = k;
  el.addEventListener('focus', async () => {
    const other = lockOf(k);
    if (other) { el.blur(); applyLockState(); return; }
    if (!(await acquireLock(k))) {
      // A teammate got there first: drop anything typed meanwhile and show their text.
      clearTimeout(timers.get(k)?.timer);
      timers.delete(k);
      drafts.delete(k);
      el.blur();
      el.value = answerOf(stageId, p);
      applyLockState();
    }
  });
  el.addEventListener('blur', () => { releaseLock(k); });
  return el;
}

// Disable boxes a teammate is editing and show who.
function applyLockState() {
  for (const el of $('panel').querySelectorAll('[data-field]')) {
    const other = lockOf(el.dataset.field);
    const badge = el.closest('.field')?.querySelector('.lock-badge');
    if (el !== document.activeElement) el.disabled = !isOpen() || !!other;
    if (badge) {
      badge.hidden = !other;
      badge.textContent = other ? `${other.name} is typing…` : '';
    }
  }
}
setInterval(() => { if (state.teamKey && $('panel')) applyLockState(); }, 10000);

// ---------- join ----------

// The join screen: active workshop -> teaching group -> name -> (team, new PIN) or PIN.
const joinState = { code: null, workshop: null, roster: new Map(), existing: null };

async function loadJoinScreen() {
  joinMessage('');
  $('j-btn').disabled = true;
  try {
    const settings = await getDoc(doc(db, 'settings/school'));
    const code = settings.exists() ? settings.data().activeWorkshop : null;
    const ws = code ? await getDoc(doc(db, `workshops/${code}`)) : null;
    if (!ws?.exists() || ws.data().open !== true) {
      $('j-workshop').hidden = true;
      $('j-tg').replaceChildren(h('option', { value: '' }, '—'));
      joinMessage('No workshop is open right now. Ask your teacher.', 'warn');
      return;
    }
    joinState.code = code;
    joinState.workshop = ws.data();
    $('j-workshop').textContent = ws.data().name;
    $('j-workshop').hidden = false;
    const roster = await getDocs(collection(db, 'roster'));
    joinState.roster = new Map(roster.docs.map((d) => [d.id, d.data()]));
    const tgs = [...joinState.roster.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    $('j-tg').replaceChildren(h('option', { value: '' }, tgs.length ? 'Choose your teaching group…' : 'No class lists yet. Ask your teacher.'),
      ...tgs.map((tg) => h('option', { value: tg }, tg)));
  } catch (err) {
    console.error(err);
    joinMessage(friendlyError(err));
  }
}

function fillNames() {
  const tg = $('j-tg').value;
  const names = [...(joinState.roster.get(tg)?.students ?? [])].sort((a, b) => a.localeCompare(b));
  $('j-name').replaceChildren(h('option', { value: '' }, tg ? 'Choose your name…' : 'Pick your teaching group first'),
    ...names.map((n) => h('option', { value: n }, n)));
  $('j-name').disabled = !tg;
  onNamePicked();
}

// New students set a team and make up a PIN; returning students only type their PIN.
async function onNamePicked() {
  const tg = $('j-tg').value;
  const name = $('j-name').value;
  joinState.existing = null;
  $('j-team-field').hidden = true;
  $('j-pin-field').hidden = true;
  $('j-btn').disabled = true;
  joinMessage('');
  if (!tg || !name) return;
  const sid = rosterSid(tg, name);
  try {
    const snap = await getDoc(doc(db, `workshops/${joinState.code}/students/${sid}`));
    joinState.existing = snap.exists();
  } catch (err) {
    if (err.code !== 'permission-denied') { joinMessage(friendlyError(err)); return; }
    joinState.existing = true; // exists, but belongs to another laptop
  }
  if ($('j-name').value !== name) return; // changed while we were checking
  $('j-team-field').hidden = joinState.existing;
  $('j-pin-field').hidden = false;
  $('j-pin-label').textContent = joinState.existing ? 'Your PIN' : 'Make up a 4-digit PIN';
  $('j-pin-hint').textContent = joinState.existing
    ? 'Welcome back! Type the PIN you made last time. Forgot it? Your teacher can see it.'
    : "Remember it: you'll need it if you switch laptops.";
  $('j-btn').disabled = false;
  (joinState.existing ? $('j-pin') : $('j-team')).focus();
}

async function onJoin(e) {
  e.preventDefault();
  joinMessage('');
  const code = joinState.code;
  const tg = $('j-tg').value;
  const name = $('j-name').value;
  const pin = $('j-pin').value.trim();
  const team = Number.parseInt($('j-team').value, 10);
  const group = joinState.roster.get(tg);

  if (!code) return joinMessage('No workshop is open right now. Ask your teacher.', 'warn');
  if (!group || !name) return joinMessage('Choose your teaching group and your name.');
  if (!joinState.existing && !(team >= 1 && team <= 40)) return joinMessage('Enter your team number (1–40).');
  if (!/^\d{4}$/.test(pin)) return joinMessage('Your PIN must be exactly 4 digits.');

  const sid = rosterSid(tg, name);
  $('j-btn').disabled = true;
  try {
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
      // This laptop already owns this journal.
    } else if (snap) {
      const batch = writeBatch(db);
      batch.set(studentRef, {
        name, team, level: group.level, class: tg, pin, pinHash: hash,
        createdAt: serverTimestamp(), progress: {}, lastActive: serverTimestamp(),
      });
      batch.set(claimRef, { pinHash: hash, at: serverTimestamp() });
      await batch.commit();
    } else {
      // The journal exists and was started on another laptop: prove it's yours with the PIN.
      try {
        await setDoc(claimRef, { pinHash: hash, at: serverTimestamp() });
      } catch (err) {
        if (err.code !== 'permission-denied') throw err;
        return joinMessage("That PIN doesn't match. Try again, or ask your teacher. They can see your PIN.");
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

  const student = st.data();
  Object.assign(state, {
    code, sid, workshop: ws.data(), student, current: LOG_ID,
    teamKey: `${student.class ?? 'X'}-t${student.team}`,
    entries: new Map(), teamEntries: new Map(), images: new Map(), feedback: new Map(), locks: new Map(), members: new Map(),
  });
  lastProgress = '';
  drafts.clear();
  document.body.dataset.track = track();
  $('me-name').textContent = `Hi, ${state.student.name.split(' ')[0]}!`;
  renderTeamMeta();
  $('closed').hidden = isOpen();
  setSave('');

  unsubscribeAll();
  // Join the team (a members doc tied to this journal) before listening to team data.
  const memberRef = doc(db, teamPath(`/members/${auth.currentUser.uid}`));
  if (!(await getDoc(memberRef)).exists()) {
    await setDoc(memberRef, { sid, name: student.name, at: serverTimestamp() });
  }
  // Make sure the team shows up on the gallery walk straight away.
  if (state.workshop.open) {
    const teamRef = doc(db, teamPath());
    getDoc(teamRef)
      .then((t) => (t.exists() ? null : setDoc(teamRef, { progress: {}, updatedAt: serverTimestamp() })))
      .catch((err) => console.warn('team doc', err));
  }
  let migrated = false;
  const watch = (path, map, after) => onSnapshot(collection(db, path), (snap) => {
    for (const change of snap.docChanges()) {
      if (change.type === 'removed') map.delete(change.doc.id);
      else map.set(change.doc.id, { id: change.doc.id, ...change.doc.data({ serverTimestamps: 'estimate' }) });
    }
    after();
  }, (err) => {
    console.warn(err);
    setSave(err.code === 'permission-denied'
      ? 'This journal was removed by your teacher. Tap Switch student.'
      : 'Lost connection to your journal. Reload the page', true);
  });
  const mine = `workshops/${code}/students/${sid}`;
  state.unsubs = [
    watch(`${mine}/entries`, state.entries, refreshFromRemote),
    watch(teamPath('/entries'), state.teamEntries, () => {
      if (!migrated) { migrated = true; migrateOldAnswers(); }
      refreshFromRemote();
    }),
    watch(teamPath('/images'), state.images, renderImages),
    watch(teamPath('/feedback'), state.feedback, renderNotes),
    watch(teamPath('/locks'), state.locks, applyLockState),
    watch(teamPath('/members'), state.members, renderTeamMeta),
  ];

  show('journal');
  renderNav();
  renderPanel();
}

function renderTeamMeta() {
  const mates = [...state.members.values()].map((m) => m.name).filter((n) => n && n !== state.student.name);
  $('me-meta').textContent = [
    state.student.class, `Team ${state.student.team}${mates.length ? ` with ${mates.join(', ')}` : ''}`,
    state.workshop.name, TRACK_LABEL[track()],
  ].filter(Boolean).join(' · ');
}

// Journals started before team sync kept every answer privately. Copy shared answers into the
// team journal once, without overwriting anything a teammate already wrote.
function migrateOldAnswers() {
  for (const st of STAGES) {
    const old = state.entries.get(st.id)?.answers;
    if (!old) continue;
    for (const raw of st.prompts) {
      if (isPersonal(raw) || !String(old[raw.id] ?? '').trim()) continue;
      if (String(state.teamEntries.get(st.id)?.answers?.[raw.id] ?? '').trim()) continue;
      saveField(st.id, raw, old[raw.id]);
    }
  }
}

function unsubscribeAll() {
  for (const u of state.unsubs) u();
  state.unsubs = [];
}

async function switchStudent() {
  flushSaves();
  releaseAllLocks();
  await Promise.allSettled([...inflight]);
  unsubscribeAll();
  writeSession(null);
  // A fresh anonymous account means the next student on this laptop can't open the last one's journal.
  await signOut(auth);
  $('join-form').reset();
  fillNames();
  joinMessage('');
  show('loading');
}

function stageCount(stage) {
  return stageCounts(stage).total;
}

function renderNav() {
  const nav = $('stages');
  const logCount = [...state.entries.values()].filter((e) => e.kind === 'learning').length;
  const btn = (id, title, sub, dotClass, style) => h('button', {
    class: 'stage-btn', type: 'button', 'aria-current': String(state.current === id), style: `--c:${style.color}`,
    onclick: () => { state.current = id; renderNav(); renderPanel(); },
  }, h('span', { class: `dot ${dotClass}` }, icon(dotClass === 'done' ? 'check' : style.icon, 16)), h('span', {}, title, h('small', {}, sub)));

  const items = [h('div', { class: 'stage-sep' }, 'Anytime'),
    btn(LOG_ID, 'Learning log', `${logCount} ${logCount === 1 ? 'entry' : 'entries'}`, logCount ? 'part' : '', LOG_STYLE),
    btn(GALLERY_ID, 'Gallery walk', 'Give other teams feedback', '', GALLERY_STYLE)];
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
  else if (state.current === GALLERY_ID) renderGallery();
  else renderStage(STAGES.find((s) => s.id === state.current));
  $('panel').scrollIntoView?.({ block: 'nearest' });
}

function renderStage(stage) {
  const i = STAGES.indexOf(stage);
  const fields = stage.prompts.map((raw) => {
    const p = promptFor(raw, track());
    const id = `q-${stage.id}-${p.id}`;
    if (p.type === 'problem') return problemPicker(stage, p, id);
    return h('label', { class: 'field', for: id },
      h('span', { class: 'q-line' }, p.q, h('em', { class: `scope ${isPersonal(p) ? 'me' : 'team'}` }, isPersonal(p) ? 'Just me' : 'Team')),
      p.hint ? h('small', {}, p.hint) : null,
      h('span', { class: 'lock-badge', hidden: true }),
      lockable(h('textarea', {
        id, 'data-prompt': p.id, 'data-stage': stage.id, maxLength: 1500, disabled: !isOpen(), value: answerOf(stage.id, p),
        oninput: (e) => queueFieldSave(stage.id, p, e.target.value),
      }), stage.id, p));
  });
  const go = (j) => { state.current = STAGES[j].id; renderNav(); renderPanel(); };
  $('panel').style.setProperty('--stage', stage.color);
  $('panel').replaceChildren(
    stageHeader(stage.icon, `${stage.day} · Worksheet ${stage.sheet} · Stage ${i + 1} of ${STAGES.length}`, stage.title, stage.blurb),
    ...fields,
    ...(stage.id === 'prototype' ? [imagesSection()] : []),
    ...(stage.id === 'test' ? [notesSection()] : []),
    h('div', { class: 'nav' },
      i > 0 ? h('button', { class: 'btn ghost', type: 'button', onclick: () => go(i - 1) }, `← ${STAGES[i - 1].title}`) : h('span'),
      i < STAGES.length - 1 ? h('button', { class: 'btn', type: 'button', onclick: () => go(i + 1) }, `${STAGES[i + 1].title} →`) : null),
  );  if (stage.id === 'prototype') renderImages();
  if (stage.id === 'test') renderNotes();
  applyLockState();
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

function problemPicker(stage, p, id) {
  const list = PROBLEMS[track()] ?? [];
  const current = findProblem(track(), answerOf(stage.id, p));
  const card = h('div', { class: 'pcard-slot' }, problemCard(current));
  const group = (cat) => h('optgroup', { label: CATEGORY[cat].label },
    ...list.filter((x) => x.cat === cat).map((x) => h('option', { value: problemLabel(x) }, `#${x.id}  ${x.title}`)));
  const select = h('select', {
    id, class: 'problem-select', 'data-prompt': p.id, disabled: !isOpen(),
    onchange: (e) => {
      card.replaceChildren(problemCard(findProblem(track(), e.target.value)));
      queueFieldSave(stage.id, p, e.target.value);
      flushField(fieldKey(stage.id, p.id));
    },
  },
  h('option', { value: '' }, 'Choose a problem statement…'),
  group('food'), group('health'),
  h('optgroup', { label: 'Something else' }, h('option', { value: OWN_IDEA.title }, OWN_IDEA.title)));
  select.value = answerOf(stage.id, p);
  select.dataset.prompt = p.id;
  select.dataset.stage = stage.id;
  lockable(select, stage.id, p);
  return h('div', { class: 'field' },
    h('label', { for: id, class: 'q-line' }, p.q, h('em', { class: 'scope team' }, 'Team')),
    h('span', { class: 'lock-badge', hidden: true }), select, card);
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
  const stage = STAGES.find((s) => s.id === state.current);
  if (!stage) return;
  for (const el of $('panel').querySelectorAll('[data-prompt][data-stage]')) {
    const p = promptFor(stage.prompts.find((x) => x.id === el.dataset.prompt), track());
    const k = fieldKey(stage.id, p.id);
    const v = answerOf(stage.id, p);
    if (el === document.activeElement || timers.has(k) || el.value === v) continue;
    el.value = v;
    if (el.tagName === 'SELECT') el.closest('.field').querySelector('.pcard-slot')?.replaceChildren(problemCard(findProblem(track(), v)));
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

// ---------- prototype images: photo upload + sketch pad ----------

const MAX_IMAGE_CHARS = 880000; // Firestore docs max out at 1 MiB; rules allow 900,000 characters.

function imagesSection() {
  const file = h('input', {
    type: 'file', accept: 'image/png,image/jpeg,image/webp', id: 'img-file', hidden: true,
    onchange: async (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      try {
        await saveImage(await compressImage(f), 'photo');
      } catch (err) {
        console.error(err);
        imageMessage(err.message || 'That picture could not be added. Try a JPG or PNG.');
      }
    },
  });
  return h('section', { class: 'extra' },
    h('div', { class: 'extra-head' },
      h('h3', {}, 'Sketches and photos'),
      h('p', { class: 'muted small' }, 'Draw your prototype and label the sensor, the micro:bit (or model) and where the user is. Draw on paper and take a photo, or draw right here.')),
    h('div', { class: 'extra-actions' },
      h('button', { class: 'btn', type: 'button', disabled: !isOpen(), onclick: () => openSketchPad() }, icon('design', 18), ' Draw here'),
      h('button', { class: 'btn ghost', type: 'button', disabled: !isOpen(), onclick: () => file.click() }, icon('prototype', 18), ' Upload a photo'),
      file),
    h('p', { id: 'img-msg', class: 'msg err', hidden: true }),
    h('div', { id: 'img-grid', class: 'img-grid' }));
}

function imageMessage(text) {
  const m = $('img-msg');
  if (!m) return;
  m.textContent = text;
  m.hidden = !text;
}

function renderImages() {
  const grid = $('img-grid');
  if (!grid) return;
  const items = [...state.images.values()].sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  if (!items.length) {
    grid.replaceChildren(h('p', { class: 'muted small' }, 'No sketches yet. Your drawings and photos will show here.'));
    return;
  }
  grid.replaceChildren(...items.map((im) => h('figure', { class: 'img-card' },
    h('button', { class: 'img-open', type: 'button', 'aria-label': 'Open full size', onclick: () => lightbox(im.data, im.caption) },
      h('img', { src: im.data, alt: im.caption || 'Prototype sketch', loading: 'lazy' })),
    h('figcaption', {},
      h('span', {}, `${im.caption || (im.source === 'sketch' ? 'Sketch' : 'Photo')}${im.by ? ` · ${im.by}` : ''}`),
      isOpen() ? h('button', {
        class: 'btn quiet', type: 'button',
        onclick: (ev) => {
          const b = ev.currentTarget;
          if (b.dataset.armed) saving(deleteDoc(doc(db, teamPath(`/images/${im.id}`))));
          else { b.dataset.armed = '1'; b.textContent = 'Tap again'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'Delete'; }, 3000); }
        },
      }, 'Delete') : null))));
}

async function saveImage(dataUrl, source) {
  imageMessage('');
  await saving(addDoc(collection(db, teamPath('/images')), {
    stage: 'prototype', source, by: state.student.name, caption: `${source === 'sketch' ? 'Sketch' : 'Photo'} ${state.images.size + 1}`,
    data: dataUrl, createdAt: serverTimestamp(),
  }));
}

// Shrink photos so each one fits comfortably in a Firestore document.
async function compressImage(fileObj) {
  if (!/^image\/(png|jpeg|webp)$/.test(fileObj.type)) throw new Error('Please choose a JPG or PNG picture.');
  const url = URL.createObjectURL(fileObj);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That picture could not be opened. Try a JPG or PNG.'));
      i.src = url;
    });
    for (const [maxSide, quality] of [[1400, 0.82], [1100, 0.75], [900, 0.68], [700, 0.6]]) {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/jpeg', quality);
      if (data.length <= MAX_IMAGE_CHARS) return data;
    }
    throw new Error('That picture is too big. Try a smaller photo or a screenshot.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function lightbox(src, caption) {
  const close = () => box.remove();
  const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-label': caption || 'Image', onclick: close },
    h('img', { src, alt: caption || '' }),
    h('button', { class: 'btn', type: 'button', onclick: close }, 'Close'));
  document.body.append(box);
}

function openSketchPad() {
  const W = 1200;
  const H = 800;
  const COLORS = ['#15231f', '#e11d48', '#2563eb', '#16a34a', '#f59e0b', '#7c3aed'];
  let color = COLORS[0];
  let size = 5;
  let erasing = false;
  const history = [];

  const canvas = h('canvas', { width: W, height: H, class: 'sketch-canvas', 'aria-label': 'Drawing area' });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const snapshot = () => { history.push(ctx.getImageData(0, 0, W, H)); if (history.length > 25) history.shift(); };
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)];
  };
  let drawing = false;
  canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    snapshot();
    const [x, y] = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.01, y);
    ctx.strokeStyle = erasing ? '#fff' : color;
    ctx.lineWidth = erasing ? size * 5 : size;
    ctx.stroke();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const [x, y] = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  });
  const stop = () => { drawing = false; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);

  const swatches = COLORS.map((c) => h('button', {
    class: 'swatch', type: 'button', style: `--c:${c}`, 'aria-label': `Colour ${c}`, 'aria-pressed': String(c === color),
    onclick: () => { color = c; erasing = false; syncTools(); },
  }));
  const sizes = [3, 6, 12].map((n) => h('button', {
    class: 'size-btn', type: 'button', 'aria-label': `Pen size ${n}`, 'aria-pressed': String(n === size),
    onclick: () => { size = n; syncTools(); },
  }, h('i', { style: `width:${n + 4}px;height:${n + 4}px` })));
  const eraser = h('button', { class: 'btn ghost', type: 'button', onclick: () => { erasing = !erasing; syncTools(); } }, 'Eraser');
  function syncTools() {
    swatches.forEach((b, i) => b.setAttribute('aria-pressed', String(!erasing && COLORS[i] === color)));
    sizes.forEach((b, i) => b.setAttribute('aria-pressed', String([3, 6, 12][i] === size)));
    eraser.setAttribute('aria-pressed', String(erasing));
    eraser.classList.toggle('on', erasing);
  }

  const status = h('span', { class: 'small muted' });
  const close = () => overlay.remove();
  const overlay = h('div', { class: 'sketch-overlay', role: 'dialog', 'aria-label': 'Sketch pad' },
    h('div', { class: 'sketch-box' },
      h('div', { class: 'sketch-tools' },
        h('b', {}, 'Sketch your prototype'),
        h('div', { class: 'tool-group' }, ...swatches),
        h('div', { class: 'tool-group' }, ...sizes),
        eraser,
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { const last = history.pop(); if (last) ctx.putImageData(last, 0, 0); } }, 'Undo'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { snapshot(); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); } }, 'Clear')),
      canvas,
      h('div', { class: 'sketch-foot' },
        status,
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Cancel'),
        h('button', {
          class: 'btn', type: 'button',
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            status.textContent = 'Saving…';
            try {
              let q = 0.85;
              let data = canvas.toDataURL('image/jpeg', q);
              while (data.length > MAX_IMAGE_CHARS && q > 0.4) { q -= 0.15; data = canvas.toDataURL('image/jpeg', q); }
              await saveImage(data, 'sketch');
              close();
            } catch (err) {
              console.error(err);
              status.textContent = 'Could not save. Check the Wi-Fi and try again.';
              e.currentTarget.disabled = false;
            }
          },
        }, 'Save sketch'))));
  syncTools();
  document.body.append(overlay);
}

// ---------- peer feedback wall (gallery walk) ----------

const NOTE_COLORS = ['#fff3a3', '#ffd6e0', '#cdeafe', '#d6f5d0', '#ffe2c2', '#e6dcff'];
const USE_LABEL = { yes: 'Would use it', maybe: 'Maybe', no: 'Wouldn’t use it' };

function notesSection() {
  return h('section', { class: 'extra' },
    h('div', { class: 'extra-head' },
      h('h3', {}, 'Peer feedback wall'),
      h('p', { class: 'muted small' }, 'During the gallery walk, tap Visitor mode and hand your laptop to each visitor. Their note sticks to your wall. You can’t delete notes, so your teacher sees everything.')),
    h('p', { class: 'find-us' }, 'Visitors can find you on the Gallery walk as ', h('b', {}, `${state.student.class} · Team ${state.student.team}`),
      '. They can leave notes from their own laptops at the same time. No laptop? Use Visitor mode on yours.'),
    h('div', { class: 'extra-actions' },
      h('button', { class: 'btn', type: 'button', disabled: !isOpen(), onclick: () => openVisitorMode() }, icon('test', 18), ' Visitor mode'),
      h('span', { id: 'note-tally', class: 'tally' })),
    h('div', { id: 'note-wall', class: 'note-wall' }));
}

function renderNotes() {
  const wall = $('note-wall');
  if (!wall) return;
  const notes = [...state.feedback.values()].sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
  const count = (u) => notes.filter((n) => n.use === u).length;
  $('note-tally').textContent = notes.length
    ? `${notes.length} ${notes.length === 1 ? 'note' : 'notes'} · Would use it: ${count('yes')} · Maybe: ${count('maybe')} · Wouldn’t: ${count('no')}`
    : '';
  if (!notes.length) {
    wall.replaceChildren(h('p', { class: 'muted small' }, 'No feedback yet. Notes from visitors will appear here.'));
    return;
  }
  wall.replaceChildren(...notes.map((n, i) => h('article', { class: 'note', style: `--nc:${NOTE_COLORS[i % NOTE_COLORS.length]};--tilt:${[-2, 1.5, -1, 2, -1.5, 1][i % 6]}deg` },
    n.like ? h('p', {}, h('b', {}, 'I like '), n.like) : null,
    n.wish ? h('p', {}, h('b', {}, 'I wish '), n.wish) : null,
    n.whatif ? h('p', {}, h('b', {}, 'What if '), n.whatif) : null,
    h('footer', {}, h('span', {}, `— ${n.from}`), n.use ? h('span', { class: `use use-${n.use}` }, USE_LABEL[n.use]) : null))));
}

// target = null: a visitor uses this laptop (Visitor mode).
// target = { key, label, title }: this student visits another team from their own journal.
function openVisitorMode(target = null) {
  const problem = target ? null : findProblem(track(), state.teamEntries.get('empathise')?.answers?.problem);
  const field = (id, label, placeholder) => h('label', { class: 'field' },
    h('span', {}, label), h('textarea', { id, maxLength: 300, rows: 2, placeholder }));
  let use = '';
  const useBtns = ['yes', 'maybe', 'no'].map((u) => h('button', {
    type: 'button', class: 'chip-btn', 'aria-pressed': 'false',
    onclick: () => { use = use === u ? '' : u; useBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(['yes', 'maybe', 'no'][i] === use))); },
  }, { yes: 'Yes', maybe: 'Maybe', no: 'No' }[u]));
  const msg = h('p', { class: 'msg err', hidden: true });
  const form = h('form', { class: 'visitor-form', novalidate: true },
    target
      ? h('p', { class: 'small muted' }, `Posting as ${state.student.name} (${state.student.class}). One note per team.`)
      : h('label', { class: 'field' }, h('span', {}, 'Your name and team'), h('input', { id: 'v-from', type: 'text', maxLength: 60, placeholder: 'e.g. Ben, 2B team 4', autocomplete: 'off' })),
    field('v-like', 'I like…', 'Something that works well'),
    field('v-wish', 'I wish…', 'Something to improve, and why'),
    field('v-whatif', 'What if…', 'A new idea to try'),
    h('div', { class: 'field' }, h('span', {}, 'Would the user use it?'), h('div', { class: 'chip-row' }, ...useBtns)),
    msg,
    h('button', { class: 'btn big', type: 'submit' }, 'Stick my note on the wall'));
  const thanks = h('div', { class: 'visitor-thanks', hidden: true },
    icon('check', 48), h('h2', {}, 'Thanks for your feedback!'),
    h('p', {}, target ? 'Your note is on their wall.' : 'Pass the laptop to the next visitor.'),
    target
      ? h('div', { class: 'extra-actions' }, h('button', { class: 'btn big', type: 'button', onclick: () => { overlay.remove(); renderGallery(); } }, 'Back to the gallery'))
      : h('div', { class: 'extra-actions' },
        h('button', { class: 'btn big', type: 'button', onclick: () => { form.reset(); use = ''; useBtns.forEach((b) => b.setAttribute('aria-pressed', 'false')); thanks.hidden = true; form.hidden = false; form.querySelector('#v-from').focus(); } }, 'Next visitor'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => overlay.remove() }, 'Back to my journal')));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = (id) => form.querySelector(`#${id}`).value.trim();
    const note = { from: target ? state.student.name : val('v-from'), like: val('v-like'), wish: val('v-wish'), whatif: val('v-whatif'), use, createdAt: serverTimestamp() };
    if (target) Object.assign(note, { fromSid: state.sid, fromTg: state.student.class });
    msg.hidden = true;
    if (!note.from) { msg.textContent = 'Add your name and team.'; msg.hidden = false; return; }
    if (!note.like && !note.wish && !note.whatif) { msg.textContent = 'Write at least one of I like, I wish or What if.'; msg.hidden = false; return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      // saving() only shows status; await the write itself so a refusal reaches the catch below.
      if (target) {
        // Stored under the visitor's own id: the rules allow one note per visitor per team.
        const w = setDoc(doc(db, `workshops/${state.code}/teams/${target.key}/feedback/${state.sid}`), note);
        saving(w);
        await w;
        markReviewed(target.key);
      } else {
        const w = addDoc(collection(db, teamPath('/feedback')), note);
        saving(w);
        await w;
      }
      form.hidden = true;
      thanks.hidden = false;
    } catch (err) {
      if (target && err?.code === 'permission-denied') {
        markReviewed(target.key);
        msg.textContent = "You've already left feedback for this team. One note per team.";
      } else {
        msg.textContent = 'Could not save your note. Check the Wi-Fi and try again.';
      }
      msg.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  const overlay = h('div', { class: 'visitor-overlay', role: 'dialog', 'aria-label': 'Leave feedback' },
    h('div', { class: 'visitor-box' },
      h('div', { class: 'visitor-head' },
        h('span', { class: 'label' }, target ? `Gallery walk · ${target.label}` : `Gallery walk · ${state.student.class ?? ''} · Team ${state.student.team}`),
        h('h2', {}, target ? (target.title || 'Leave feedback for this project') : (problem ? problem.title : 'Leave feedback for this project')),
        h('p', { class: 'muted' }, 'Try the prototype first, then write your note. Be specific: say what and why.')),
      form, thanks,
      h('button', { class: 'btn quiet visitor-exit', type: 'button', onclick: () => overlay.remove() }, target ? 'Cancel' : 'Exit visitor mode')));
  document.body.append(overlay);
  form.querySelector(target ? '#v-like' : '#v-from').focus();
}

// ---------- gallery walk: give other teams feedback from your own laptop ----------

const reviewedKey = () => `journal.reviewed.${state.code}.${state.sid}`;
function reviewedTeams() {
  try { return new Set(JSON.parse(localStorage.getItem(reviewedKey()) ?? '[]')); } catch { return new Set(); }
}
function markReviewed(key) {
  const set = reviewedTeams();
  set.add(key);
  try { localStorage.setItem(reviewedKey(), JSON.stringify([...set])); } catch { /* private mode */ }
}

// Team keys look like "<teaching group>-t<team>", e.g. "1-TG3-t2".
function teamLabel(key) {
  const i = key.lastIndexOf('-t');
  return i > 0 ? `${key.slice(0, i)} · Team ${key.slice(i + 2)}` : key;
}

async function renderGallery() {
  $('panel').style.setProperty('--stage', GALLERY_STYLE.color);
  const filter = h('input', { type: 'search', id: 'gal-filter', placeholder: 'Search teaching group or project…', 'aria-label': 'Search teams' });
  const grid = h('div', { class: 'gallery-grid' }, h('p', { class: 'muted small' }, 'Loading teams…'));
  $('panel').replaceChildren(
    stageHeader(GALLERY_STYLE.icon, 'Anytime · Gallery walk', 'Gallery walk', 'Visit other teams, try their prototype, then leave a note from your own laptop. Lots of people can post at once. One note per team.'),
    h('div', { class: 'extra-actions' }, filter, h('button', { class: 'btn ghost', type: 'button', onclick: () => renderGallery() }, 'Refresh')),
    grid);
  let teams;
  try {
    const snap = await getDocs(collection(db, `workshops/${state.code}/teams`));
    teams = snap.docs.map((d) => ({ key: d.id, ...d.data() })).filter((t) => t.key !== state.teamKey);
  } catch (err) {
    console.error(err);
    grid.replaceChildren(h('p', { class: 'msg err' }, 'Could not load the teams. Check the Wi-Fi and tap Refresh.'));
    return;
  }
  if (state.current !== GALLERY_ID) return;
  teams.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  const done = reviewedTeams();
  const cards = teams.map((t) => {
    const label = teamLabel(t.key);
    const title = t.title ? t.title.replace(/^#\S+\s/, '') : '';
    const reviewed = done.has(t.key);
    const card = h('article', { class: `gal-card${reviewed ? ' done' : ''}`, 'data-search': `${label} ${title}`.toLowerCase() },
      h('span', { class: 'label' }, label),
      h('h3', {}, title || 'Project not chosen yet'),
      reviewed
        ? h('p', { class: 'gal-done' }, icon('check', 16), ' You left feedback')
        : h('button', { class: 'btn', type: 'button', disabled: !isOpen(), onclick: () => openVisitorMode({ key: t.key, label, title }) }, 'Give feedback'));
    return card;
  });
  grid.replaceChildren(...(cards.length ? cards : [h('p', { class: 'muted small' }, 'No other teams yet. Check back once teams have started their journals.')]));
  filter.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    for (const c of grid.querySelectorAll('.gal-card')) c.hidden = q && !c.dataset.search.includes(q);
  });
}
