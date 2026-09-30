import {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, onSnapshot, serverTimestamp, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { auth, db, configured, pinHash } from './firebase.js';
import { LEVELS, DEFAULT_TEACHERS, trackForLevel } from './school.js';
import { STAGES, TRACK_LABEL, promptFor, isPersonal } from './prompts.js';

const $ = (id) => document.getElementById(id);
const state = {
  email: null, role: null, myName: '', teacherNames: DEFAULT_TEACHERS,
  workshops: [], ws: null, students: [], unsub: null,
  scope: readPref('scope', 'mine'), cls: '',
};

function readPref(key, fallback) {
  try { return localStorage.getItem(`dash.${key}`) ?? fallback; } catch { return fallback; }
}
function writePref(key, value) {
  try { localStorage.setItem(`dash.${key}`, value); } catch { /* private mode */ }
}

const teamKeyOf = (st) => `${st.class ?? 'X'}-t${st.team}`;
const studentTrack = (st) => (st.level ? trackForLevel(st.level) : state.ws?.track ?? 'code');

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

function screen(id) {
  for (const s of ['t-loading', 't-signin', 't-app']) $(s).hidden = s !== id;
}

function msg(id, text) {
  $(id).textContent = text;
  $(id).hidden = !text;
}

function ago(ts) {
  const ms = ts?.toMillis?.();
  if (!ms) return '–';
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 60 * 24) return `${Math.round(min / 60)} h ago`;
  return new Date(ms).toLocaleDateString();
}

// Unambiguous characters only, so codes are easy to read off a projector.
function newCode(trackId) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const rand = crypto.getRandomValues(new Uint32Array(4));
  return (trackId === 'ai' ? 'AIF' : 'CFF') + [...rand].map((n) => chars[n % chars.length]).join('');
}

// ---------- auth ----------

$('t-google').addEventListener('click', async () => {
  msg('t-signin-msg', '');
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (err) {
    console.error(err);
    msg('t-signin-msg', err.code === 'auth/popup-blocked' ? 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.' : 'Sign-in did not finish. Try again.');
  }
});
$('t-signout').addEventListener('click', () => signOut(auth));

if (!configured && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  screen('t-signin');
  msg('t-signin-msg', 'Firebase is not set up yet. Paste your project settings into js/firebase-config.js (see README).');
  $('t-google').disabled = true;
} else {
  onAuthStateChanged(auth, async (user) => {
    state.unsub?.();
    if (!user || user.isAnonymous) { screen('t-signin'); return; }
    try {
      const me = await getDoc(doc(db, `teachers/${user.email}`));
      if (!me.exists()) throw Object.assign(new Error('not teacher'), { code: 'permission-denied' });
      state.role = me.data().role ?? 'teacher';
      state.myName = me.data().name ?? '';
    } catch (err) {
      screen('t-signin');
      msg('t-signin-msg', err.code === 'permission-denied'
        ? `${user.email} isn't on the teacher list yet. Ask an admin to add this exact address on the dashboard's Teachers page.`
        : "Can't reach the database. Check your connection.");
      await signOut(auth);
      return;
    }
    state.email = user.email;
    $('t-email').textContent = `${user.email}${state.role === 'admin' ? ' · admin' : ''}`;
    $('t-manage').hidden = state.role !== 'admin';
    screen('t-app');
    await loadSettings();
    await loadWorkshops();
  });
}

async function loadSettings() {
  try {
    const snap = await getDoc(doc(db, 'settings/school'));
    if (snap.exists() && snap.data().teachers?.length) state.teacherNames = snap.data().teachers;
  } catch (err) { console.warn('Using default teacher list', err); }
}

// ---------- workshop list ----------

async function loadWorkshops() {
  const snap = await getDocs(collection(db, 'workshops'));
  state.workshops = snap.docs.map((d) => ({ code: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  $('t-cards').replaceChildren(...(state.workshops.length ? state.workshops.map((w) => h('button', {
    class: 'ws-card', type: 'button', onclick: () => openWorkshop(w.code),
  },
  h('span', { class: 'label' }, TRACK_LABEL[w.track] ?? w.track),
  h('h3', {}, w.name),
  h('span', { class: 'code' }, w.code),
  h('span', { class: 'small muted' }, w.open ? 'Open for writing' : 'Closed (read-only)'))) : [h('p', { class: 'muted' }, 'No workshops yet. Create one above, then show its code to the class.')]));
  view('t-list');
}

function view(id) {
  for (const v of ['t-list', 't-ws', 't-team']) $(v).hidden = v !== id;
}

$('t-create').addEventListener('submit', async (e) => {
  e.preventDefault();
  msg('t-create-msg', '');
  const name = $('c-name').value.trim();
  const trackId = $('c-track').value;
  const custom = $('c-code').value.trim().toUpperCase();
  if (!name) { msg('t-create-msg', 'Give the workshop a name, for example "1E1 Code for Fun".'); return; }
  if (custom && !/^[A-Z0-9]{4,12}$/.test(custom)) { msg('t-create-msg', 'Codes use 4–12 letters or numbers only, for example ESSS26.'); return; }
  try {
    let code = custom;
    if (custom) {
      if ((await getDoc(doc(db, `workshops/${custom}`))).exists()) { msg('t-create-msg', `${custom} is already used. Pick another code.`); return; }
    } else {
      for (let i = 0; i < 5; i++) {
        code = newCode(trackId);
        if (!(await getDoc(doc(db, `workshops/${code}`))).exists()) break;
      }
    }
    await setDoc(doc(db, `workshops/${code}`), { name, track: trackId, open: true, createdAt: serverTimestamp(), createdBy: state.email });
    $('t-create').reset();
    await loadWorkshops();
    openWorkshop(code);
  } catch (err) {
    console.error(err);
    msg('t-create-msg', 'Could not create the workshop. Check your connection and try again.');
  }
});

// ---------- one workshop ----------

$('t-back').addEventListener('click', () => { state.unsub?.(); closeDrawer(); loadWorkshops(); });

function openWorkshop(code) {
  state.ws = state.workshops.find((w) => w.code === code);
  document.body.dataset.track = state.ws.track;
  $('ws-track').textContent = TRACK_LABEL[state.ws.track] ?? state.ws.track;
  $('ws-name').textContent = state.ws.name;
  $('ws-code').textContent = code;
  renderToggle();
  $('ws-head').replaceChildren(h('tr', {},
    h('th', {}, 'Class'), h('th', {}, 'Team'), h('th', {}, 'Name'), h('th', {}, 'Teacher'), h('th', {}, 'PIN'), h('th', {}, 'Progress'),
    ...STAGES.map((s) => h('th', {}, s.title)), h('th', {}, 'Last active')));
  state.cls = '';
  renderFilters();
  view('t-ws');

  state.unsub?.();
  state.teams = new Map();
  const lost = (err) => { console.error(err); $('ws-status').textContent = 'Lost the live connection. Reload the page.'; };
  const u1 = onSnapshot(collection(db, `workshops/${code}/students`), (snap) => {
    state.students = snap.docs.map((d) => ({ sid: d.id, ...d.data() }))
      .sort((a, b) => (a.class ?? '').localeCompare(b.class ?? '') || a.team - b.team || a.name.localeCompare(b.name));
    renderRows();
  }, lost);
  const u2 = onSnapshot(collection(db, `workshops/${code}/teams`), (snap) => {
    state.teams = new Map(snap.docs.map((d) => [d.id, d.data()]));
    renderRows();
  }, lost);
  state.unsub = () => { u1(); u2(); };
  $('ws-delete').hidden = state.role !== 'admin';
}

function renderToggle() {
  const open = state.ws.open;
  $('ws-toggle').textContent = open ? 'Close workshop (read-only)' : 'Reopen for writing';
}

$('ws-toggle').addEventListener('click', async () => {
  const open = !state.ws.open;
  try {
    await updateDoc(doc(db, `workshops/${state.ws.code}`), { open });
    state.ws.open = open;
    renderToggle();
  } catch (err) {
    console.error(err);
    $('ws-status').textContent = 'Could not change the workshop. Try again.';
  }
});

// "My students" = students who picked this teacher's name when joining.
function renderFilters() {
  const seg = (scope, label) => h('button', {
    type: 'button', class: 'seg-btn', 'aria-pressed': String(state.scope === scope),
    onclick: () => { state.scope = scope; writePref('scope', scope); renderFilters(); renderRows(); },
  }, label);
  const allClasses = [...LEVELS[1], ...LEVELS[2]];
  const cls = h('select', { 'aria-label': 'Filter by class', onchange: (e) => { state.cls = e.target.value; renderRows(); } },
    h('option', { value: '' }, 'All classes'), ...allClasses.map((c) => h('option', { value: c }, c)));
  cls.value = state.cls;
  const parts = [h('div', { class: 'seg' }, seg('mine', state.myName ? `My students (${state.myName})` : 'My students'), seg('all', 'Whole school')), cls];
  if (state.scope === 'mine' && !state.teacherNames.includes(state.myName)) {
    const pick = h('select', {
      'aria-label': 'Which teacher are you?',
      onchange: async (e) => {
        const name = e.target.value;
        if (!name) return;
        try {
          await updateDoc(doc(db, `teachers/${state.email}`), { name });
          state.myName = name;
          renderFilters();
          renderRows();
        } catch (err) { console.error(err); $('ws-status').textContent = 'Could not save your name. Try again.'; }
      },
    }, h('option', { value: '' }, 'Which teacher are you?'), ...state.teacherNames.map((n) => h('option', { value: n }, n)));
    parts.push(h('span', { class: 'small muted' }, 'To see your students, pick your name:'), pick);
  }
  $('ws-filters').replaceChildren(...parts);
}

function visibleStudents() {
  return state.students.filter((st) => (state.scope === 'all' || st.teacher === state.myName) && (!state.cls || st.class === state.cls));
}

function pinCell(st) {
  const b = h('button', {
    class: 'pin-btn', type: 'button', title: 'Show PIN',
    onclick: (e) => { e.stopPropagation(); b.textContent = b.textContent === '••••' ? (st.pin ?? 'not set') : '••••'; },
  }, '••••');
  return h('td', {}, b);
}

// Answers counted for one student in one stage: their team's shared answers plus their own.
function stageDone(st, s) {
  const team = state.teams?.get(teamKeyOf(st))?.progress?.[s.id] ?? 0;
  return Math.min(s.prompts.length, team + (st.progress?.[s.id] ?? 0));
}

function renderRows() {
  const total = STAGES.reduce((n, s) => n + s.prompts.length, 0);
  const list = visibleStudents();
  const teams = new Set(list.map((s) => s.team)).size;
  $('ws-status').textContent = `Showing ${list.length} of ${state.students.length} ${state.students.length === 1 ? 'student' : 'students'} · ${teams} ${teams === 1 ? 'team' : 'teams'} · updates live · click a row to read a journal`;
  if (!list.length) {
    const why = state.students.length
      ? (state.scope === 'mine' ? 'None of your students have joined yet. Switch to Whole school to see everyone.' : 'No students in this class yet.')
      : `No one has joined yet. Students go to this site and enter ${state.ws.code}.`;
    $('ws-rows').replaceChildren(h('tr', {}, h('td', { colspan: String(STAGES.length + 7), class: 'muted' }, why)));
    return;
  }
  $('ws-rows').replaceChildren(...list.map((st) => {
    const answered = STAGES.reduce((n, s) => n + stageDone(st, s), 0);
    return h('tr', { onclick: () => openStudent(st), tabindex: '0', onkeydown: (e) => { if (e.key === 'Enter') openStudent(st); } },
      h('td', {}, st.class ?? '–'),
      h('td', { class: 'num' }, String(st.team)),
      h('td', {}, st.name),
      h('td', { class: 'small' }, st.teacher ?? '–'),
      pinCell(st),
      h('td', { class: 'num' }, `${Math.round((answered / total) * 100)}%`),
      ...STAGES.map((s) => {
        const n = stageDone(st, s);
        const cls = n >= s.prompts.length ? 'done' : n ? 'part' : '';
        return h('td', {}, h('div', { class: 'bar', title: `${s.title}: ${n}/${s.prompts.length}` }, h('i', { class: cls })));
      }),
      h('td', { class: 'small muted' }, ago(st.lastActive)));
  }));
}

// ---------- student drawer ----------

function closeDrawer() { $('drawer').hidden = true; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

async function loadSub(sid, sub) {
  const snap = await getDocs(collection(db, `workshops/${state.ws.code}/students/${sid}/${sub}`));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((x, y) => (x.createdAt?.toMillis?.() ?? 0) - (y.createdAt?.toMillis?.() ?? 0));
}

function lightbox(src, caption) {
  const close = () => box.remove();
  const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-label': caption || 'Image', onclick: close },
    h('img', { src, alt: caption || '' }), h('button', { class: 'btn', type: 'button', onclick: close }, 'Close'));
  document.body.append(box);
}

// PIN reset and class / teacher corrections.
function accountSection(st) {
  const note = h('span', { class: 'small muted' });
  const pinShown = h('b', { class: 'pin-big' }, '••••');
  const reveal = h('button', { class: 'btn quiet', type: 'button', onclick: () => { pinShown.textContent = pinShown.textContent === '••••' ? (st.pin ?? 'not set') : '••••'; } }, 'Show / hide');
  const newPin = h('input', { type: 'text', inputmode: 'numeric', maxlength: '4', placeholder: 'New PIN', style: 'width:7rem' });
  const reset = h('button', {
    class: 'btn ghost', type: 'button',
    onclick: async () => {
      const pin = newPin.value.trim();
      if (!/^\d{4}$/.test(pin)) { note.textContent = 'Enter exactly 4 digits.'; return; }
      try {
        await updateDoc(doc(db, `workshops/${state.ws.code}/students/${st.sid}`), { pin, pinHash: await pinHash(st.sid, pin) });
        st.pin = pin;
        pinShown.textContent = pin;
        newPin.value = '';
        note.textContent = `PIN changed. ${st.name} can now open their journal on any laptop with ${pin}.`;
      } catch (err) { console.error(err); note.textContent = 'Could not change the PIN. Try again.'; }
    },
  }, 'Set new PIN');

  const level = h('select', {}, ...Object.keys(LEVELS).map((l) => h('option', { value: l }, `Sec ${l}`)));
  const cls = h('select', {});
  const fillCls = () => { cls.replaceChildren(...LEVELS[level.value].map((c) => h('option', { value: c }, c))); };
  level.value = String(st.level ?? 1);
  fillCls();
  cls.value = st.class ?? LEVELS[level.value][0];
  level.addEventListener('change', fillCls);
  const names = [...new Set([...state.teacherNames, ...(st.teacher ? [st.teacher] : [])])];
  const teacher = h('select', {}, ...names.map((n) => h('option', { value: n }, n)));
  teacher.value = st.teacher ?? names[0];
  const save = h('button', {
    class: 'btn ghost', type: 'button',
    onclick: async () => {
      try {
        await updateDoc(doc(db, `workshops/${state.ws.code}/students/${st.sid}`), { level: Number(level.value), class: cls.value, teacher: teacher.value });
        note.textContent = 'Class and teacher updated.';
      } catch (err) { console.error(err); note.textContent = 'Could not update. Try again.'; }
    },
  }, 'Save class');

  return h('section', {},
    h('h3', {}, 'Login help'),
    h('div', { class: 'inline-row' }, h('span', {}, 'PIN:'), pinShown, reveal),
    h('div', { class: 'inline-row' }, newPin, reset),
    h('div', { class: 'inline-row' }, level, cls, teacher, save),
    note);
}

async function loadTeamSub(key, sub) {
  const snap = await getDocs(collection(db, `workshops/${state.ws.code}/teams/${key}/${sub}`));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((x, y) => (x.createdAt?.toMillis?.() ?? 0) - (y.createdAt?.toMillis?.() ?? 0));
}

// A student's journal = shared team answers for team questions + their own answers for personal ones.
// Journals from before team sync kept everything personally, so fall back to those.
async function loadJournal(st, teamCache = new Map()) {
  const key = teamKeyOf(st);
  if (!teamCache.has(key)) {
    teamCache.set(key, Promise.all([loadTeamSub(key, 'entries'), loadTeamSub(key, 'images'), loadTeamSub(key, 'feedback')]));
  }
  const [[teamEntries, teamImages, teamNotes], entries, oldImages, oldNotes] = await Promise.all([
    teamCache.get(key), loadSub(st.sid, 'entries'), loadSub(st.sid, 'images'), loadSub(st.sid, 'feedback'),
  ]);
  const mine = Object.fromEntries(entries.filter((e) => e.kind === 'stage').map((e) => [e.stage, e.answers ?? {}]));
  const team = Object.fromEntries(teamEntries.map((e) => [e.id, e.answers ?? {}]));
  const answer = (stageId, p) => (isPersonal(p)
    ? mine[stageId]?.[p.id]
    : (team[stageId]?.[p.id] || mine[stageId]?.[p.id])) ?? '';
  return {
    answer,
    log: entries.filter((e) => e.kind === 'learning'),
    images: [...teamImages, ...oldImages],
    notes: [
      ...teamNotes.map((n) => ({ ...n, path: `workshops/${state.ws.code}/teams/${key}/feedback/${n.id}` })),
      ...oldNotes.map((n) => ({ ...n, path: `workshops/${state.ws.code}/students/${st.sid}/feedback/${n.id}` })),
    ],
    key,
  };
}

async function openStudent(st) {
  const drawer = $('drawer');
  drawer.hidden = false;
  drawer.replaceChildren(h('p', { class: 'muted' }, 'Loading journal…'));
  let journal;
  try {
    journal = await loadJournal(st);
  } catch (err) {
    console.error(err);
    drawer.replaceChildren(h('p', { class: 'msg err' }, 'Could not load this journal.'));
    return;
  }
  const trk = studentTrack(st);
  const { answer, log, images, notes } = journal;
  const mates = state.students.filter((x) => x.sid !== st.sid && teamKeyOf(x) === teamKeyOf(st)).map((x) => x.name);
  const USE = { yes: 'Would use it', maybe: 'Maybe', no: 'Wouldn’t use it' };

  const noteEl = (n) => {
    const del = h('button', {
      class: 'btn quiet', type: 'button',
      onclick: async (ev) => {
        const b = ev.currentTarget;
        if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Click again to delete'; return; }
        try { await deleteDoc(doc(db, n.path)); card.remove(); } catch (err) { console.error(err); }
      },
    }, 'Delete');
    const card = h('div', { class: 'qa note-mini' },
      h('b', {}, `${n.from}${n.use ? ` · ${USE[n.use]}` : ''}`),
      n.like ? h('p', {}, `I like ${n.like}`) : null,
      n.wish ? h('p', {}, `I wish ${n.wish}`) : null,
      n.whatif ? h('p', {}, `What if ${n.whatif}`) : null,
      del);
    return card;
  };

  drawer.replaceChildren(
    h('div', { style: 'display:flex;justify-content:space-between;gap:1rem;align-items:start' },
      h('div', {},
        h('span', { class: 'label' }, [st.class, `Team ${st.team}`, st.teacher, TRACK_LABEL[trk]].filter(Boolean).join(' · ')),
        h('h2', {}, st.name),
        h('p', { class: 'small muted' }, mates.length ? `Shares a team journal with ${mates.join(', ')}.` : 'No teammates have joined yet.')),
      h('button', { class: 'btn ghost', type: 'button', onclick: closeDrawer }, 'Close')),
    accountSection(st),
    h('section', {}, h('h3', {}, `Learning log (${log.length})`),
      ...(log.length ? log.map((e) => h('div', { class: 'qa' },
        h('b', {}, `${e.type === 'gathered' ? 'Gathered' : 'Learnt'} · ${e.tag ?? 'Other'}`), h('p', {}, e.text))) : [h('p', { class: 'muted' }, 'No entries yet.')])),
    ...STAGES.map((s) => h('section', {}, h('h3', {}, `${s.day} · ${s.title}`),
      ...s.prompts.map((raw) => {
        const p = promptFor(raw, trk);
        const a = String(answer(s.id, p)).trim();
        return h('div', { class: 'qa' }, h('b', {}, p.q, isPersonal(p) ? ' (own answer)' : ''), h('p', { class: a ? '' : 'empty' }, a || 'Not answered'));
      }),
      s.id === 'prototype' ? h('div', { class: 'thumbs' },
        ...(images.length ? images.map((im) => h('button', { type: 'button', class: 'thumb', onclick: () => lightbox(im.data, im.caption) },
          h('img', { src: im.data, alt: im.caption || 'Sketch' }), h('span', {}, im.caption || ''))) : [h('p', { class: 'muted small' }, 'No sketches or photos yet.')])) : null,
      s.id === 'test' ? h('div', { class: 'stack-sm' },
        h('b', {}, `Peer feedback notes (${notes.length})`),
        ...(notes.length ? notes.map(noteEl) : [h('p', { class: 'muted small' }, 'No peer feedback yet.')])) : null)),
  );
  drawer.append(deleteStudentSection(st));
  drawer.scrollTop = 0;
}

// ---------- deleting records ----------

// Deletes every document under the given collection paths, 400 per batch.
async function deleteCollections(paths) {
  for (const path of paths) {
    const snap = await getDocs(collection(db, path));
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
}

async function deleteStudent(st, { keepTeam = false } = {}) {
  const base = `workshops/${state.ws.code}/students/${st.sid}`;
  await deleteCollections(['entries', 'images', 'feedback', 'claims'].map((c) => `${base}/${c}`));
  const key = teamKeyOf(st);
  const teamBase = `workshops/${state.ws.code}/teams/${key}`;
  const members = await getDocs(collection(db, `${teamBase}/members`));
  for (const m of members.docs) if (m.data().sid === st.sid) await deleteDoc(m.ref);
  const othersInTeam = state.students.some((x) => x.sid !== st.sid && teamKeyOf(x) === key);
  if (!othersInTeam && !keepTeam) {
    await deleteCollections(['entries', 'images', 'feedback', 'locks', 'members'].map((c) => `${teamBase}/${c}`));
    await deleteDoc(doc(db, teamBase));
  }
  await deleteDoc(doc(db, base));
}

function deleteStudentSection(st) {
  const note = h('p', { class: 'small muted' });
  const btn = h('button', {
    class: 'btn ghost danger-ghost', type: 'button',
    onclick: async () => {
      if (!btn.dataset.armed) {
        btn.dataset.armed = '1';
        btn.textContent = `Click again to delete ${st.name}'s journal for good`;
        btn.classList.add('danger');
        return;
      }
      btn.disabled = true;
      note.textContent = 'Deleting…';
      try {
        await deleteStudent(st);
        closeDrawer();
        $('ws-status').textContent = `Deleted ${st.name}'s journal.`;
      } catch (err) {
        console.error(err);
        note.textContent = 'Could not delete everything. Try again.';
        btn.disabled = false;
      }
    },
  }, 'Delete this journal');
  const others = state.students.some((x) => x.sid !== st.sid && teamKeyOf(x) === teamKeyOf(st));
  return h('section', {},
    h('h3', {}, 'Delete'),
    h('p', { class: 'small muted' }, others
      ? 'Removes this student, their personal answers and learning log. The shared team journal stays for their teammates.'
      : 'Removes this student and everything in their journal, including the team pages (no teammates are left). This can’t be undone.'),
    h('div', {}, btn), note);
}

$('ws-delete').addEventListener('click', async () => {
  const b = $('ws-delete');
  const code = state.ws.code;
  if (!b.dataset.armed) {
    b.dataset.armed = '1';
    b.textContent = `Click again to delete ${code} and all ${state.students.length} journals`;
    b.classList.add('danger');
    setTimeout(() => { delete b.dataset.armed; b.textContent = 'Delete workshop'; b.classList.remove('danger'); }, 5000);
    return;
  }
  b.disabled = true;
  $('ws-status').textContent = 'Deleting workshop…';
  try {
    for (const st of [...state.students]) await deleteStudent(st, { keepTeam: true });
    const teams = await getDocs(collection(db, `workshops/${code}/teams`));
    for (const t of teams.docs) {
      await deleteCollections(['entries', 'images', 'feedback', 'locks', 'members'].map((c) => `${t.ref.path}/${c}`));
      await deleteDoc(t.ref);
    }
    state.unsub?.();
    await deleteDoc(doc(db, `workshops/${code}`));
    closeDrawer();
    await loadWorkshops();
  } catch (err) {
    console.error(err);
    $('ws-status').textContent = 'Could not delete everything. Try again.';
  } finally {
    b.disabled = false;
    delete b.dataset.armed;
    b.textContent = 'Delete workshop';
    b.classList.remove('danger');
  }
});

// ---------- CSV export ----------

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

$('ws-export').addEventListener('click', async () => {
  const btn = $('ws-export');
  btn.disabled = true;
  btn.textContent = 'Preparing…';
  try {
    const cols = STAGES.flatMap((st) => st.prompts.map((p) => ({ stage: st, p })));
    const header = ['Level', 'Class', 'Teacher', 'Team', 'Name', 'Track', ...cols.map((c) => `${c.stage.title}: ${c.p.q}`), 'Learnt', 'Gathered', 'Sketches / photos', 'Peer feedback'];
    const rows = [header];
    const teamCache = new Map();
    for (const st of visibleStudents()) {
      const { answer, log, images, notes } = await loadJournal(st, teamCache);
      const join = (type) => log.filter((e) => (e.type ?? 'learnt') === type).map((e) => `[${e.tag}] ${e.text}`).join('\n');
      const fb = notes.map((n) => [`${n.from}${n.use ? ` (${n.use})` : ''}:`, n.like && `I like ${n.like}`, n.wish && `I wish ${n.wish}`, n.whatif && `What if ${n.whatif}`].filter(Boolean).join(' ')).join('\n');
      rows.push([st.level ? `Sec ${st.level}` : '', st.class ?? '', st.teacher ?? '', st.team, st.name, TRACK_LABEL[studentTrack(st)],
        ...cols.map((c) => answer(c.stage.id, c.p)), join('learnt'), join('gathered'), images.length, fb]);
    }
    // BOM so Excel opens the file as UTF-8 (°C, names with accents).
    const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: `${state.ws.name.replace(/[^\w-]+/g, '_')}_journals.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) {
    console.error(err);
    $('ws-status').textContent = 'Could not export. Try again.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Download CSV';
  }
});

// ---------- teachers (admins only) ----------

$('t-manage').addEventListener('click', () => { state.unsub?.(); closeDrawer(); loadTeachers(); });
$('t-team-back').addEventListener('click', () => loadWorkshops());

function addMsg(text, kind = 'err') {
  $('t-add-msg').textContent = text;
  $('t-add-msg').className = `msg ${kind}`;
  $('t-add-msg').hidden = !text;
}

async function loadTeachers() {
  view('t-team');
  addMsg('');
  let snap;
  try {
    snap = await getDocs(collection(db, 'teachers'));
  } catch (err) {
    console.error(err);
    addMsg('Could not load the teacher list. Only admins can see it.');
    return;
  }
  $('s-teachers').value = state.teacherNames.join('\n');
  $('s-msg').textContent = '';
  let dl = document.getElementById('teacher-names');
  if (!dl) { dl = h('datalist', { id: 'teacher-names' }); document.body.append(dl); }
  dl.replaceChildren(...state.teacherNames.map((n) => h('option', { value: n })));
  const rows = snap.docs.map((d) => ({ email: d.id, ...d.data() }))
    .sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === 'admin' ? -1 : 1));
  $('t-team-rows').replaceChildren(...rows.map((t) => {
    const self = t.email === state.email;
    const role = h('select', { 'aria-label': `Role for ${t.email}`, disabled: self ? true : null, onchange: (e) => changeRole(t.email, e.target.value) },
      h('option', { value: 'teacher' }, 'Teacher'), h('option', { value: 'admin' }, 'Admin'));
    role.value = t.role ?? 'teacher';
    const remove = self ? h('span', { class: 'small muted' }, 'You') : h('button', {
      class: 'btn quiet', type: 'button',
      onclick: (ev) => {
        const b = ev.currentTarget;
        if (b.dataset.armed) { removeTeacher(t.email); return; }
        b.dataset.armed = '1';
        b.textContent = 'Click again to remove';
        setTimeout(() => { delete b.dataset.armed; b.textContent = 'Remove'; }, 3000);
      },
    }, 'Remove');
    const nameIn = h('input', {
      type: 'text', value: t.name ?? '', maxlength: '60', 'aria-label': `Name for ${t.email}`, list: 'teacher-names',
      onchange: async (e) => {
        const name = e.target.value.trim();
        try {
          await updateDoc(doc(db, `teachers/${t.email}`), { name });
          if (self) state.myName = name;
          addMsg(`Saved name for ${t.email}.`, 'info');
        } catch (err) { console.error(err); addMsg('Could not save that name. Try again.'); }
      },
    });
    nameIn.value = t.name ?? '';
    return h('tr', { style: 'cursor:default' },
      h('td', {}, t.email), h('td', {}, nameIn), h('td', {}, role),
      h('td', { class: 'small muted' }, t.addedBy || 'set up in console'), h('td', {}, remove));
  }));
}

$('t-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  addMsg('');
  const email = $('a-email').value.trim().toLowerCase();
  const name = $('a-name').value.trim();
  const role = $('a-role').value;
  if (!/^[^@/\s]+@[^@/\s]+\.[^@/\s]+$/.test(email)) { addMsg('Enter a full email address, like ms.tan@school.edu.sg.'); return; }
  try {
    if ((await getDoc(doc(db, `teachers/${email}`))).exists()) { addMsg(`${email} is already on the list.`, 'warn'); return; }
    const data = { role, addedBy: state.email, addedAt: serverTimestamp() };
    if (name) data.name = name;
    await setDoc(doc(db, `teachers/${email}`), data);
    $('t-add').reset();
    await loadTeachers();
    addMsg(`Added ${email}. They can now sign in to this dashboard with that Google account.`, 'info');
  } catch (err) {
    console.error(err);
    addMsg('Could not add that teacher. Check the email and try again.');
  }
});

async function changeRole(email, role) {
  try {
    await updateDoc(doc(db, `teachers/${email}`), { role });
    addMsg(`${email} is now ${role === 'admin' ? 'an admin' : 'a teacher'}.`, 'info');
  } catch (err) {
    console.error(err);
    addMsg('Could not change the role. Try again.');
    await loadTeachers();
  }
}

async function removeTeacher(email) {
  try {
    await deleteDoc(doc(db, `teachers/${email}`));
    await loadTeachers();
    addMsg(`Removed ${email}. They can no longer open the dashboard.`, 'info');
  } catch (err) {
    console.error(err);
    addMsg('Could not remove that teacher. Try again.');
  }
}

$('s-save').addEventListener('click', async () => {
  const names = [...new Set($('s-teachers').value.split('\n').map((n) => n.trim()).filter(Boolean))].slice(0, 50);
  if (!names.length) { $('s-msg').textContent = 'Add at least one name.'; return; }
  try {
    await setDoc(doc(db, 'settings/school'), { teachers: names, updatedBy: state.email, updatedAt: serverTimestamp() });
    state.teacherNames = names;
    $('s-msg').textContent = `Saved. Students now see ${names.length} ${names.length === 1 ? 'teacher' : 'teachers'} in the sign-up list.`;
  } catch (err) {
    console.error(err);
    $('s-msg').textContent = 'Could not save the list. Only admins can change it.';
  }
});
