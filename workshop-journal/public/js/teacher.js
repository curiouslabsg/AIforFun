import {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField, collection, onSnapshot, serverTimestamp, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { auth, db, configured, pinHash } from './firebase.js';
import { trackForLevel } from './school.js';
import { parseRosterFiles, groupRows, TEMPLATE_CSV } from './roster.js';
import { STAGES, TRACK_LABEL, promptFor, isPersonal } from './prompts.js';

const $ = (id) => document.getElementById(id);
const state = {
  email: null, role: null, myName: '', settingsTeachers: [], active: [],
  // Class lists: roster = teaching group -> { level, students }; details = group -> { classes, teachers }.
  roster: new Map(), details: new Map(),
  workshops: [], ws: null, students: [], unsub: null,
  scope: readPref('scope', 'mine'), tg: '', cls: '',
};

// Form class and teacher come from the class list (teacher-only), keyed by teaching group + name.
const classOf = (st) => state.details.get(st.class)?.classes?.[st.name] ?? '';
const teacherOf = (st) => state.details.get(st.class)?.teachers?.[st.name] ?? st.teacher ?? '';
function teacherNames() {
  const names = new Set(state.settingsTeachers);
  for (const d of state.details.values()) for (const t of Object.values(d.teachers ?? {})) if (t) names.add(t);
  return [...names].sort();
}

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
    view('t-list');
    await loadSettings();
    // Don't pull the teacher back to the list if they've already opened another page.
    await loadWorkshops({ show: !$('t-list').hidden });
  });
}

async function loadSettings() {
  try {
    const snap = await getDoc(doc(db, 'settings/school'));
    state.settingsTeachers = snap.data()?.teachers ?? [];
    const d = snap.data() ?? {};
    state.active = Array.isArray(d.activeWorkshops) ? d.activeWorkshops : (d.activeWorkshop ? [d.activeWorkshop] : []);
  } catch (err) { console.warn('Could not read settings', err); }
  await loadRoster();
}

async function loadRoster() {
  try {
    const [r, d] = await Promise.all([getDocs(collection(db, 'roster')), getDocs(collection(db, 'rosterDetails'))]);
    state.roster = new Map(r.docs.map((x) => [x.id, x.data()]));
    state.details = new Map(d.docs.map((x) => [x.id, x.data()]));
  } catch (err) { console.warn('Could not read class lists', err); }
}

const MAX_ACTIVE = 5;

// Several workshops can be active at once; students pick one when more than one is open.
async function setActive(codes) {
  try {
    await setDoc(doc(db, 'settings/school'), {
      activeWorkshops: codes, activeWorkshop: deleteField(), updatedBy: state.email, updatedAt: serverTimestamp(),
    }, { merge: true });
    state.active = codes;
    await loadWorkshops();
  } catch (err) {
    console.error(err);
    msg('t-create-msg', 'Could not change the active workshops. Only admins can.');
  }
}

async function makeActive(code) {
  msg('t-create-msg', '');
  // Drop codes whose workshop was deleted, so they don't use up a slot.
  const live = state.active.filter((c) => c !== code && state.workshops.some((w) => w.code === c));
  if (live.length >= MAX_ACTIVE) { msg('t-create-msg', `Up to ${MAX_ACTIVE} workshops can be active. Deactivate one first.`); return; }
  await setActive([...live, code]);
}

async function deactivate(code) {
  msg('t-create-msg', '');
  await setActive(state.active.filter((c) => c !== code));
}

// ---------- workshop list ----------

async function loadWorkshops({ show = true } = {}) {
  const snap = await getDocs(collection(db, 'workshops'));
  state.workshops = snap.docs.map((d) => ({ code: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  const card = (w) => {
    const active = state.active.includes(w.code);
    return h('article', {
      class: `ws-card${active ? ' active' : ''}`, tabindex: '0', role: 'button',
      onclick: () => openWorkshop(w.code), onkeydown: (e) => { if (e.key === 'Enter') openWorkshop(w.code); },
    },
    active ? h('span', { class: 'active-badge' }, 'Active · students land here') : null,
    h('h3', {}, w.name),
    h('span', { class: 'code' }, w.code),
    h('span', { class: 'small muted' }, w.open ? 'Open for writing' : 'Closed (read-only)'),
    state.role === 'admin'
      ? h('button', {
        class: 'btn ghost small-btn', type: 'button',
        onclick: (e) => { e.stopPropagation(); (active ? deactivate : makeActive)(w.code); },
      }, active ? 'Deactivate' : 'Make active')
      : null);
  };
  $('t-cards').replaceChildren(...(state.workshops.length ? state.workshops.map(card) : [h('p', { class: 'muted' }, 'No workshops yet. Create one above, then make it active.')]));
  const activeNow = state.workshops.filter((w) => state.active.includes(w.code));
  if (!activeNow.length && state.workshops.length) {
    $('t-cards').prepend(h('p', { class: 'msg warn', style: 'grid-column:1/-1' }, 'No workshop is active, so students see "No workshop is open". An admin can press Make active on one.'));
  } else if (activeNow.length > 1) {
    $('t-cards').prepend(h('p', { class: 'msg', style: 'grid-column:1/-1' }, `${activeNow.length} workshops are active, so students first pick their workshop by name.`));
  }
  if (show) view('t-list');
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
    await loadWorkshops({ show: false });
    if (!state.workshops.some((w) => state.active.includes(w.code)) && state.role === 'admin') await makeActive(code);
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
    h('th', { class: 'sel' }, h('input', { type: 'checkbox', id: 'sel-all', 'aria-label': 'Select all students shown', onclick: (e) => toggleAll(e.target.checked) })),
    h('th', {}, 'Teaching group'), h('th', {}, 'Class'), h('th', {}, 'Team'), h('th', {}, 'Name'), h('th', {}, 'Teacher'), h('th', {}, 'PIN'), h('th', {}, 'Progress'),
    ...STAGES.map((s) => h('th', {}, s.title)), h('th', {}, 'Last active')));
  state.cls = '';
  state.tg = '';
  state.selected = new Set();
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
  const sortNum = (a, b) => a.localeCompare(b, undefined, { numeric: true });
  const tgs = [...new Set([...state.roster.keys(), ...state.students.map((x) => x.class).filter(Boolean)])].sort(sortNum);
  const classes = [...new Set([...state.details.values()].flatMap((d) => Object.values(d.classes ?? {})).filter(Boolean))].sort(sortNum);
  const select = (label, key, values, all) => {
    const el = h('select', { 'aria-label': label, onchange: (e) => { state[key] = e.target.value; renderRows(); } },
      h('option', { value: '' }, all), ...values.map((v) => h('option', { value: v }, v)));
    el.value = state[key];
    return el;
  };
  const parts = [
    h('div', { class: 'seg' }, seg('mine', state.myName ? `My students (${state.myName})` : 'My students'), seg('all', 'Whole school')),
    select('Filter by teaching group', 'tg', tgs, 'All teaching groups'),
    select('Filter by class', 'cls', classes, 'All classes'),
  ];
  const names = teacherNames();
  if (state.scope === 'mine' && !names.includes(state.myName)) {
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
    }, h('option', { value: '' }, names.length ? 'Which teacher are you?' : 'No teachers in the class lists yet'), ...names.map((n) => h('option', { value: n }, n)));
    parts.push(h('span', { class: 'small muted' }, 'To see your students, pick your name:'), pick);
  }
  $('ws-filters').replaceChildren(...parts);
}

function visibleStudents() {
  return state.students.filter((st) => (state.scope === 'all' || teacherOf(st) === state.myName)
    && (!state.tg || st.class === state.tg)
    && (!state.cls || classOf(st) === state.cls));
}

// How many students on the class lists (within the current filters) have started a journal.
function joinedSummary() {
  const joined = new Set(state.students.map((x) => `${x.class}|${x.name}`));
  let total = 0;
  let inn = 0;
  for (const [tg, g] of state.roster) {
    if (state.tg && tg !== state.tg) continue;
    const d = state.details.get(tg) ?? {};
    for (const name of g.students ?? []) {
      if (state.scope === 'mine' && (d.teachers?.[name] ?? '') !== state.myName) continue;
      if (state.cls && (d.classes?.[name] ?? '') !== state.cls) continue;
      total++;
      if (joined.has(`${tg}|${name}`)) inn++;
    }
  }
  return total ? `${inn} of ${total} students on the class lists have joined` : '';
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
  // Forget selections for students who were deleted or are now filtered out.
  const shownIds = new Set(visibleStudents().map((x) => x.sid));
  for (const sid of [...(state.selected ?? [])]) if (!shownIds.has(sid)) state.selected.delete(sid);
  renderBulk();
  const total = STAGES.reduce((n, s) => n + s.prompts.length, 0);
  const list = visibleStudents();
  const teams = new Set(list.map((s) => teamKeyOf(s))).size;
  const joinedText = joinedSummary();
  $('ws-status').textContent = `${state.flash ? `${state.flash} · ` : ''}${joinedText ? `${joinedText} · ` : ''}Showing ${list.length} of ${state.students.length} ${state.students.length === 1 ? 'student' : 'students'} · ${teams} ${teams === 1 ? 'team' : 'teams'} · updates live · click a row to read a journal`;
  if (!list.length) {
    const why = state.students.length
      ? (state.scope === 'mine' ? 'None of your students have joined yet. Switch to Whole school to see everyone.' : 'No students in this class yet.')
      : `No one has joined yet. Students go to this site and enter ${state.ws.code}.`;
    $('ws-rows').replaceChildren(h('tr', {}, h('td', { colspan: String(STAGES.length + 9), class: 'muted' }, why)));
    return;
  }
  $('ws-rows').replaceChildren(...list.map((st) => {
    const answered = STAGES.reduce((n, s) => n + stageDone(st, s), 0);
    return h('tr', { onclick: () => openStudent(st), tabindex: '0', onkeydown: (e) => { if (e.key === 'Enter') openStudent(st); } },
      h('td', { class: 'sel', onclick: (e) => e.stopPropagation() },
        h('input', {
          type: 'checkbox', 'aria-label': `Select ${st.name}`, ...(state.selected.has(st.sid) ? { checked: true } : {}),
          onchange: (e) => { if (e.target.checked) state.selected.add(st.sid); else state.selected.delete(st.sid); renderBulk(); },
        })),
      h('td', {}, st.class ?? '–'),
      h('td', {}, classOf(st) || '–'),
      h('td', { class: 'num' }, String(st.team)),
      h('td', {}, st.name),
      h('td', { class: 'small' }, teacherOf(st) || '–'),
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

  const tgs = [...state.roster.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const tgSel = h('select', { 'aria-label': 'Teaching group' }, ...tgs.map((t) => h('option', { value: t }, t)));
  tgSel.value = st.class ?? '';
  const save = h('button', {
    class: 'btn ghost', type: 'button',
    onclick: async () => {
      const tg = tgSel.value;
      const g = state.roster.get(tg);
      if (!g) { note.textContent = 'Pick a teaching group from the class lists.'; return; }
      try {
        await updateDoc(doc(db, `workshops/${state.ws.code}/students/${st.sid}`), { class: tg, level: g.level });
        note.textContent = `Moved to ${tg}. They join that group's team journals next time they open the journal.`;
      } catch (err) { console.error(err); note.textContent = 'Could not update. Try again.'; }
    },
  }, 'Move');

  return h('section', {},
    h('h3', {}, 'Login help'),
    h('div', { class: 'inline-row' }, h('span', {}, 'PIN:'), pinShown, reveal),
    h('div', { class: 'inline-row' }, newPin, reset),
    tgs.length ? h('div', { class: 'inline-row' }, h('span', {}, 'Teaching group:'), tgSel, save) : null,
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
      h('b', {}, `${n.from}${n.fromTg ? ` (${n.fromTg})` : ''}${n.fromSid ? ' · own laptop' : ''}${n.use ? ` · ${USE[n.use]}` : ''}`),
      n.like ? h('p', {}, `I like ${n.like}`) : null,
      n.wish ? h('p', {}, `I wish ${n.wish}`) : null,
      n.whatif ? h('p', {}, `What if ${n.whatif}`) : null,
      del);
    return card;
  };

  drawer.replaceChildren(
    h('div', { style: 'display:flex;justify-content:space-between;gap:1rem;align-items:start' },
      h('div', {},
        h('span', { class: 'label' }, [st.class, classOf(st), `Team ${st.team}`, teacherOf(st), TRACK_LABEL[trk]].filter(Boolean).join(' · ')),
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

async function deleteStudent(st, { keepTeam = false, removing = new Set() } = {}) {
  const base = `workshops/${state.ws.code}/students/${st.sid}`;
  await deleteCollections(['entries', 'images', 'feedback', 'claims'].map((c) => `${base}/${c}`));
  const key = teamKeyOf(st);
  const teamBase = `workshops/${state.ws.code}/teams/${key}`;
  const members = await getDocs(collection(db, `${teamBase}/members`));
  for (const m of members.docs) if (m.data().sid === st.sid) await deleteDoc(m.ref);
  // Teammates being deleted in the same batch don't count as staying.
  const othersInTeam = state.students.some((x) => x.sid !== st.sid && !removing.has(x.sid) && teamKeyOf(x) === key);
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
        flash(`Deleted ${st.name}'s journal`);
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
    if (state.active.includes(code)) await setActive(state.active.filter((c) => c !== code));
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
    const header = ['Level', 'Teaching group', 'Class', 'Teacher', 'Team', 'Name', 'Track', ...cols.map((c) => `${c.stage.title}: ${c.p.q}`), 'Learnt', 'Gathered', 'Sketches / photos', 'Peer feedback'];
    const rows = [header];
    const teamCache = new Map();
    for (const st of visibleStudents()) {
      const { answer, log, images, notes } = await loadJournal(st, teamCache);
      const join = (type) => log.filter((e) => (e.type ?? 'learnt') === type).map((e) => `[${e.tag}] ${e.text}`).join('\n');
      const fb = notes.map((n) => [`${n.from}${n.fromTg ? ` [${n.fromTg}]` : ''}${n.use ? ` (${n.use})` : ''}:`, n.like && `I like ${n.like}`, n.wish && `I wish ${n.wish}`, n.whatif && `What if ${n.whatif}`].filter(Boolean).join(' ')).join('\n');
      rows.push([st.level ? `Sec ${st.level}` : '', st.class ?? '', classOf(st), teacherOf(st), st.team, st.name, TRACK_LABEL[studentTrack(st)],
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
  let dl = document.getElementById('teacher-names');
  if (!dl) { dl = h('datalist', { id: 'teacher-names' }); document.body.append(dl); }
  dl.replaceChildren(...teacherNames().map((n) => h('option', { value: n })));
  renderCurrentRoster();
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

// ---------- class lists (admins) ----------

function rosterMsg(text, kind = 'err') {
  $('r-msg').textContent = text;
  $('r-msg').className = `msg ${kind}`;
  $('r-msg').hidden = !text;
}

function renderCurrentRoster() {
  const tgs = [...state.roster.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!tgs.length) {
    $('r-current').replaceChildren(h('p', { class: 'muted small' }, 'No class lists yet. Students can’t join until you upload one.'));
    return;
  }
  const total = tgs.reduce((n, t) => n + (state.roster.get(t).students?.length ?? 0), 0);
  $('r-current').replaceChildren(
    h('h4', {}, `Current class lists: ${tgs.length} teaching groups, ${total} students`),
    h('div', { class: 'tablewrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Teaching group'), h('th', {}, 'Level'), h('th', {}, 'Students'), h('th', {}, 'Classes'))),
      h('tbody', {}, ...tgs.map((t) => {
        const g = state.roster.get(t);
        const cls = [...new Set(Object.values(state.details.get(t)?.classes ?? {}))].sort().join(', ');
        return h('tr', { style: 'cursor:default' }, h('td', {}, t), h('td', {}, `Sec ${g.level}`), h('td', { class: 'num' }, String(g.students?.length ?? 0)), h('td', { class: 'small' }, cls || '–'));
      })))));
}

$('r-template').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: 'class-list-template.csv' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

$('r-file').addEventListener('change', async (e) => {
  const files = [...(e.target.files ?? [])];
  e.target.value = '';
  if (!files.length) return;
  rosterMsg('Reading files…', 'info');
  $('r-preview').replaceChildren();
  let parsed;
  try {
    parsed = await parseRosterFiles(files);
  } catch (err) {
    console.error(err);
    rosterMsg(err.message || 'Could not read those files. Try saving them as CSV or .xlsx.');
    return;
  }
  const groups = groupRows(parsed.rows);
  const bad = parsed.rows.filter((r) => r.error);
  rosterMsg(groups.size
    ? `Found ${parsed.rows.length - bad.length} students in ${groups.size} teaching groups${bad.length ? `, plus ${bad.length} rows with problems (listed below, they won't be saved)` : ''}. Check, then press Replace.`
    : 'No students found. Check the files have a Name column.', groups.size ? 'info' : 'err');
  const sortNum = (a, b) => a.localeCompare(b, undefined, { numeric: true });
  const summary = h('div', { class: 'tablewrap' }, h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Teaching group'), h('th', {}, 'Level'), h('th', {}, 'Students'), h('th', {}, 'Classes'), h('th', {}, 'Teachers'), h('th', {}, 'Example names'))),
    h('tbody', {}, ...[...groups.keys()].sort(sortNum).map((tg) => {
      const g = groups.get(tg);
      return h('tr', { style: 'cursor:default' }, h('td', {}, tg), h('td', {}, `Sec ${g.level}`), h('td', { class: 'num' }, String(g.students.length)),
        h('td', { class: 'small' }, [...new Set(Object.values(g.classes))].sort().join(', ') || '–'),
        h('td', { class: 'small' }, [...new Set(Object.values(g.teachers))].sort().join(', ') || '–'),
        h('td', { class: 'small muted' }, g.students.slice(0, 3).join(', ') + (g.students.length > 3 ? '…' : '')));
    }))));
  const problems = [...parsed.problems.map((p) => h('li', {}, p)), ...bad.slice(0, 50).map((r) => h('li', {}, `${r.source}: ${r.name || '(no name)'} — ${r.error}`))];
  const replace = h('button', {
    class: 'btn', type: 'button', disabled: !groups.size,
    onclick: async () => {
      replace.disabled = true;
      rosterMsg('Saving class lists…', 'info');
      try {
        await saveRoster(groups);
        await loadRoster();
        $('r-preview').replaceChildren();
        renderCurrentRoster();
        rosterMsg(`Saved ${groups.size} teaching groups. Students can now pick their group and name.`, 'info');
      } catch (err) {
        console.error(err);
        rosterMsg('Could not save the class lists. Only admins can upload them.');
        replace.disabled = false;
      }
    },
  }, `Replace class lists with these ${groups.size} groups`);
  $('r-preview').replaceChildren(
    h('h4', {}, 'Preview'), summary,
    problems.length ? h('details', { open: true }, h('summary', {}, `${problems.length} problems`), h('ul', { class: 'small' }, ...problems)) : null,
    h('div', { class: 'extra-actions' }, replace,
      h('span', { class: 'small muted' }, 'Groups not in these files are removed. Journals already started are kept.')));
});

// Replace every teaching group: names (readable by students) and classes / teachers (teachers only).
async function saveRoster(groups) {
  const writes = [];
  for (const old of state.roster.keys()) {
    if (!groups.has(old)) writes.push((b) => b.delete(doc(db, `roster/${old}`)), (b) => b.delete(doc(db, `rosterDetails/${old}`)));
  }
  for (const [tg, g] of groups) {
    writes.push((b) => b.set(doc(db, `roster/${tg}`), { level: g.level, students: g.students, updatedAt: serverTimestamp(), updatedBy: state.email }));
    writes.push((b) => b.set(doc(db, `rosterDetails/${tg}`), { classes: g.classes, teachers: g.teachers, updatedAt: serverTimestamp() }));
  }
  for (let i = 0; i < writes.length; i += 400) {
    const batch = writeBatch(db);
    writes.slice(i, i + 400).forEach((w) => w(batch));
    await batch.commit();
  }
}

// ---------- select and delete several journals ----------

function toggleAll(on) {
  state.selected = new Set(on ? visibleStudents().map((x) => x.sid) : []);
  renderRows();
}

function renderBulk() {
  const bar = $('ws-bulk');
  const n = state.selected?.size ?? 0;
  const shown = visibleStudents().length;
  const all = $('sel-all');
  if (all) {
    all.checked = n > 0 && n === shown;
    all.indeterminate = n > 0 && n < shown;
  }
  bar.hidden = n === 0;
  if (!n) { bar.replaceChildren(); return; }
  const names = state.students.filter((x) => state.selected.has(x.sid)).map((x) => x.name);
  const del = h('button', {
    class: 'btn ghost danger-ghost', type: 'button',
    onclick: async () => {
      if (!del.dataset.armed) {
        del.dataset.armed = '1';
        del.textContent = `Click again to delete ${n} ${n === 1 ? 'journal' : 'journals'} for good`;
        del.classList.add('danger');
        setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = `Delete ${n} selected`; del.classList.remove('danger'); } }, 5000);
        return;
      }
      del.disabled = true;
      const removing = new Set(state.selected);
      const targets = state.students.filter((x) => removing.has(x.sid));
      let done = 0;
      try {
        for (const st of targets) {
          del.textContent = `Deleting ${done + 1} of ${targets.length}…`;
          await deleteStudent(st, { removing });
          done++;
        }
        state.selected.clear();
        closeDrawer();
        flash(`Deleted ${done} ${done === 1 ? 'journal' : 'journals'}`);
      } catch (err) {
        console.error(err);
        $('ws-status').textContent = `Deleted ${done} of ${targets.length}. Something went wrong; try again for the rest.`;
      }
      renderRows();
    },
  }, `Delete ${n} selected`);
  bar.replaceChildren(
    h('b', {}, `${n} selected`),
    h('span', { class: 'small muted' }, names.slice(0, 6).join(', ') + (names.length > 6 ? ` +${names.length - 6} more` : '')),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn quiet', type: 'button', onclick: () => toggleAll(false) }, 'Clear selection'),
    del);
}

// A short message shown in front of the live student count for a few seconds.
function flash(text) {
  state.flash = text;
  renderRows();
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => { state.flash = ''; if (!$('t-ws').hidden) renderRows(); }, 6000);
}
