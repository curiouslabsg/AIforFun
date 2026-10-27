import {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, getAuth,
  signInWithEmailAndPassword, sendPasswordResetEmail, updatePassword, createUserWithEmailAndPassword,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { firebaseConfig } from './firebase-config.js';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, onSnapshot, serverTimestamp, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { auth, db, configured, pinHash, h } from './firebase.js';
import { parseRosterFiles, groupRows, TEMPLATE_CSV } from './roster.js';
import { sectionsFor, isAnswered, sectionTarget, MOODS } from './wex.js';
import { renderPortfolio } from './portfolio.js';
import { companyLogo } from './logo.js';
import { art } from './art.js';

const $ = (id) => document.getElementById(id);
const MAX_ACTIVE = 5;
const state = {
  email: null, role: null, active: [],
  // Name lists: roster = company -> { level, students }; details = company -> { classes } (teachers only).
  roster: new Map(), details: new Map(),
  cohorts: [], ws: null, students: [], unsub: null, selected: new Set(),
  tg: readPref('tg', ''), cls: readPref('cls', ''),
};

const classOf = (st) => state.details.get(st.class)?.classes?.[st.name] ?? '';
const ccaOf = (st) => state.details.get(st.class)?.cca?.[st.name] ?? '';
// A number the student typed in their journal wins over the one on the name list.
const phoneOf = (st) => st.phone || state.details.get(st.class)?.phones?.[st.name] || '';
// Each company can run for its own number of days (set on its name list); otherwise the group's.
// Students can correct their company on My placement, so prefer that one when it's on the list.
const sections = (st) => sectionsFor((state.roster.get(st?.company) ?? state.roster.get(st?.class))?.days ?? state.ws?.days ?? 5);
const progressOf = (st) => {
  const secs = sections(st);
  const total = secs.reduce((n, s) => n + sectionSize(s), 0);
  const done = secs.reduce((n, s) => n + Math.min(sectionSize(s), st.progress?.[s.id] ?? 0), 0);
  return { secs, pct: total ? done / total : 0 };
};

function readPref(key, fallback) {
  try { return localStorage.getItem(`wexdash.${key}`) ?? fallback; } catch { return fallback; }
}
function writePref(key, value) {
  try { localStorage.setItem(`wexdash.${key}`, value); } catch { /* private mode */ }
}
function screen(id) {
  for (const s of ['t-loading', 't-signin', 't-app', 't-firstpw']) $(s).hidden = s !== id;
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
  return new Date(ms).toLocaleDateString('en-SG');
}
function newCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return `WEP${[...crypto.getRandomValues(new Uint32Array(4))].map((n) => chars[n % chars.length]).join('')}`;
}
// Each page change bumps navSeq, so a slow load never pulls the teacher back from a page they opened since.
let navSeq = 0;
function view(id) {
  navSeq++;
  for (const v of ['t-list', 't-ws', 't-team']) $(v).hidden = v !== id;
}

// ---------- sign-in ----------

$('t-google').addEventListener('click', async () => {
  msg('t-signin-msg', '');
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (err) {
    console.error(err);
    msg('t-signin-msg', err.code === 'auth/popup-blocked' ? 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.' : 'Google sign-in didn’t finish. Use your email and password instead, or try again.');
  }
});
$('t-signout').addEventListener('click', () => signOut(auth));
$('t-pw').addEventListener('submit', async (e) => {
  e.preventDefault();
  msg('t-signin-msg', '');
  const email = $('pw-email').value.trim().toLowerCase();
  const pass = $('pw-pass').value;
  if (!email || !pass) { msg('t-signin-msg', 'Type your email and password.'); return; }
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    $('pw-pass').value = '';
  } catch (err) {
    console.error(err);
    msg('t-signin-msg', err.code === 'auth/too-many-requests'
      ? 'Too many tries. Wait a few minutes, or ask your admin for help.'
      : 'That email and password don’t match. Check for typos, or ask your admin.');
  }
});
$('pw-forgot').addEventListener('click', async () => {
  const email = $('pw-email').value.trim().toLowerCase();
  if (!email) { msg('t-signin-msg', 'Type your email above first, then press Forgot password.'); return; }
  try { await sendPasswordResetEmail(auth, email); } catch (err) { console.warn(err); }
  msg('t-signin-msg', `If ${email} has an account, a reset link is on its way. Check your junk mail too, or ask your admin to reset it.`);
});
$('t-password').addEventListener('click', async () => {
  const next = window.prompt('New password (at least 8 characters):');
  if (next === null) return;
  if (next.length < 8) { window.alert('Use at least 8 characters.'); return; }
  try {
    await updatePassword(auth.currentUser, next);
    await clearPasswordReminder();
    window.alert('Password changed. Use it next time you sign in.');
  } catch (err) {
    console.error(err);
    window.alert(err.code === 'auth/requires-recent-login'
      ? 'For safety, sign out and sign in again, then change your password straight away.'
      : 'Could not change the password. Try again.');
  }
});

const START_PASSWORD = 'Password2026';
let firstPasswordDone = () => {};

async function clearPasswordReminder() {
  if (!state.mustChangePassword) return;
  try {
    await updateDoc(doc(db, `teachers/${auth.currentUser.email}`), { mustChangePassword: false });
    state.mustChangePassword = false;
  } catch (err) { console.warn('Could not clear the password reminder', err); }
}

$('fp-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = $('fp-a').value;
  if (a.length < 8) { msg('fp-msg', 'Use at least 8 characters.'); return; }
  if (a === START_PASSWORD) { msg('fp-msg', 'Choose something other than the starting password.'); return; }
  if (a !== $('fp-b').value) { msg('fp-msg', 'The two passwords don’t match.'); return; }
  try {
    await updatePassword(auth.currentUser, a);
    await clearPasswordReminder();
    $('fp-form').reset();
    firstPasswordDone();
  } catch (err) {
    console.error(err);
    msg('fp-msg', 'Could not change the password. Try again.');
  }
});
$('fp-keep').addEventListener('click', async () => { await clearPasswordReminder(); firstPasswordDone(); });

// Makes an email + password login for a new teacher without signing the admin out: a second,
// separate Firebase connection creates it, then signs itself out.
let maker;
async function createPasswordLogin(email) {
  maker ??= getAuth(initializeApp(firebaseConfig, 'login-maker'));
  await createUserWithEmailAndPassword(maker, email, START_PASSWORD);
  await signOut(maker);
}

if (!configured && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  screen('t-signin');
  msg('t-signin-msg', 'Firebase is not set up yet. Paste the project settings into js/firebase-config.js (see README).');
} else {
  onAuthStateChanged(auth, async (user) => {
    state.unsub?.();
    if (!user || user.isAnonymous) { screen('t-signin'); return; }
    try {
      const me = await getDoc(doc(db, `teachers/${user.email}`));
      if (!me.exists()) throw Object.assign(new Error('not teacher'), { code: 'permission-denied' });
      state.role = me.data().role ?? 'teacher';
      state.name = me.data().name ?? '';
      state.mustChangePassword = me.data().mustChangePassword === true;
    } catch (err) {
      screen('t-signin');
      msg('t-signin-msg', err.code === 'permission-denied'
        ? `${user.email} doesn’t have access: it isn’t on the teacher list, or it’s a guest login that has expired. Ask your admin.`
        : 'Can’t reach the database. Check your connection.');
      await signOut(auth);
      return;
    }
    state.email = user.email;
    // "Ms Tan" stays "Ms Tan"; "Lloyd Goh" becomes "Lloyd"; no name → the start of the email.
    const shown = /^(mr|mrs|ms|mdm|miss|dr)\b/i.test(state.name) ? state.name : (state.name.split(' ')[0] || user.email.split('@')[0].split('.')[0]);
    $('t-hello').textContent = `Hi, ${shown.charAt(0).toUpperCase()}${shown.slice(1)}! 👋`;
    $('t-email').textContent = `${user.email} · ${state.role === 'admin' ? 'Admin rights' : 'Teacher rights'}`;
    $('t-manage').hidden = state.role !== 'admin';
    $('t-password').hidden = !user.providerData.some((p) => p.providerId === 'password');
    $('t-new').hidden = state.role !== 'admin';
    $('t-create').hidden = true;
    $('t-viewer-note').hidden = state.role === 'admin';
    // First sign-in with the starting password: offer to choose their own (they may keep it).
    // Only when they signed in with the password this time, not with Google.
    if (state.mustChangePassword && (await user.getIdTokenResult()).signInProvider === 'password') {
      screen('t-firstpw');
      await new Promise((done) => { firstPasswordDone = done; });
    }
    screen('t-app');
    view('t-list');
    await loadSettings();
    await loadCohorts();
  });
}

async function loadSettings() {
  try {
    state.active = (await getDoc(doc(db, 'settings/school'))).data()?.activeCohorts ?? [];
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

// ---------- work experience groups (cohorts) ----------

async function setActive(codes) {
  try {
    await setDoc(doc(db, 'settings/school'), { activeCohorts: codes, updatedBy: state.email, updatedAt: serverTimestamp() }, { merge: true });
    state.active = codes;
    await loadCohorts();
  } catch (err) {
    console.error(err);
    msg('t-create-msg', 'Could not change which groups are active. Only admins can.');
  }
}

async function makeActive(code) {
  msg('t-create-msg', '');
  const live = state.active.filter((c) => c !== code && state.cohorts.some((w) => w.code === c));
  if (live.length >= MAX_ACTIVE) { msg('t-create-msg', `Up to ${MAX_ACTIVE} groups can be active. Deactivate one first.`); return; }
  await setActive([...live, code]);
}

async function loadCohorts({ show = true } = {}) {
  const seq = navSeq;
  const snap = await getDocs(collection(db, 'cohorts'));
  state.cohorts = snap.docs.map((d) => ({ code: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  const pics = ['clipboard', 'observe', 'bolt', 'thought', 'summit'];
  const card = (w, i) => {
    const active = state.active.includes(w.code);
    return h('article', {
      class: `ws-card${active ? ' active' : ''}`, tabindex: '0', role: 'button',
      onclick: () => openCohort(w.code), onkeydown: (e) => { if (e.key === 'Enter') openCohort(w.code); },
    },
    h('div', { class: 'ws-top' },
      h('div', { class: 'ws-text' },
        active ? h('span', { class: 'active-badge' }, '● On the student page') : h('span', { class: 'h-kicker' }, 'Hidden from students'),
        h('h3', {}, w.name),
        h('span', { class: 'code' }, w.code)),
      art(pics[i % pics.length], 'ws-art')),
    h('span', { class: 'small muted' }, `${w.days ?? 5} days · ${w.open ? 'Open for writing' : 'Closed (students can read and print)'}`),
    state.role === 'admin'
      ? h('button', {
        class: 'btn ghost small-btn', type: 'button',
        onclick: (e) => { e.stopPropagation(); if (active) setActive(state.active.filter((c) => c !== w.code)); else makeActive(w.code); },
      }, active ? 'Hide from students' : 'Make active')
      : null);
  };
  $('t-cards').replaceChildren(...(state.cohorts.length ? state.cohorts.map(card)
    : [h('p', { class: 'muted' }, state.role === 'admin' ? 'No work experience groups yet. Create one above.' : 'No work experience groups yet. Your admin will set them up.')]));
  if (state.cohorts.length && !state.cohorts.some((w) => state.active.includes(w.code))) {
    $('t-cards').prepend(h('p', { class: 'msg warn', style: 'grid-column:1/-1' }, 'No group is active, so students can’t open their journals. An admin can press Make active.'));
  }
  if (show && seq === navSeq) view('t-list');
}

$('t-new').addEventListener('click', () => { $('t-create').hidden = false; $('t-new').hidden = true; $('c-name').focus(); });
$('c-cancel').addEventListener('click', () => { $('t-create').reset(); $('t-create').hidden = true; $('t-new').hidden = false; msg('t-create-msg', ''); });

$('t-create').addEventListener('submit', async (e) => {
  e.preventDefault();
  msg('t-create-msg', '');
  const name = $('c-name').value.trim();
  const custom = $('c-code').value.trim().toUpperCase();
  const days = Number.parseInt($('c-days').value, 10);
  if (!name) { msg('t-create-msg', 'Give the group a name, for example "Sec 3 work experience, Nov 2026".'); return; }
  if (custom && !/^[A-Z0-9]{4,12}$/.test(custom)) { msg('t-create-msg', 'IDs use 4–12 letters or numbers only, for example WEP26.'); return; }
  if (!(days >= 1 && days <= 10)) { msg('t-create-msg', 'Days must be between 1 and 10.'); return; }
  try {
    let code = custom;
    if (custom) {
      if ((await getDoc(doc(db, `cohorts/${custom}`))).exists()) { msg('t-create-msg', `${custom} is already used. Pick another.`); return; }
    } else {
      for (let i = 0; i < 5; i++) { code = newCode(); if (!(await getDoc(doc(db, `cohorts/${code}`))).exists()) break; }
    }
    await setDoc(doc(db, `cohorts/${code}`), { name, days, open: true, createdAt: serverTimestamp(), createdBy: state.email });
    $('t-create').reset();
    $('c-days').value = '5';
    $('t-create').hidden = true;
    $('t-new').hidden = false;
    await loadCohorts({ show: false });
    if (!state.cohorts.some((w) => state.active.includes(w.code))) await makeActive(code);
    openCohort(code);
  } catch (err) {
    console.error(err);
    msg('t-create-msg', 'Could not create the group. Check your connection and try again.');
  }
});

// ---------- one work experience group ----------

$('t-back').addEventListener('click', () => { state.unsub?.(); closeDrawer(); loadCohorts(); });

function openCohort(code) {
  state.ws = state.cohorts.find((w) => w.code === code);
  $('ws-name').textContent = state.ws.name;
  $('ws-code').textContent = `${code} · ${state.ws.days ?? 5} days`;
  renderToggle();
  $('ws-head').replaceChildren(h('tr', {},
    h('th', { class: 'sel' }, h('input', { type: 'checkbox', id: 'sel-all', 'aria-label': 'Select all students shown', onclick: (e) => toggleAll(e.target.checked) })),
    h('th', {}, 'Student'), h('th', {}, 'Company'), h('th', {}, 'Progress'), h('th', {}, 'Last active'), h('th', {}, 'PIN')));
  state.selected = new Set();
  view('t-ws');
  state.unsub?.();
  const lost = (err) => { console.error(err); $('ws-status').textContent = 'Lost the live connection. Reload the page.'; };
  state.unsub = onSnapshot(collection(db, `cohorts/${code}/students`), (snap) => {
    state.students = snap.docs.map((d) => ({ sid: d.id, ...d.data() }))
      .sort((a, b) => (a.class ?? '').localeCompare(b.class ?? '', undefined, { numeric: true }) || a.name.localeCompare(b.name));
    renderFilters();
    renderRows();
  }, lost);
  $('ws-delete').hidden = state.role !== 'admin';
  $('ws-toggle').hidden = state.role !== 'admin';
}

function renderToggle() {
  $('ws-toggle').textContent = state.ws.open ? 'Close for writing' : 'Reopen for writing';
}
$('ws-toggle').addEventListener('click', async () => {
  const open = !state.ws.open;
  try {
    await updateDoc(doc(db, `cohorts/${state.ws.code}`), { open });
    state.ws.open = open;
    renderToggle();
  } catch (err) {
    console.error(err);
    $('ws-status').textContent = 'Could not change the group. Try again.';
  }
});

function renderFilters() {
  const sortNum = (a, b) => a.localeCompare(b, undefined, { numeric: true });
  const tgs = [...new Set([...state.roster.keys(), ...state.students.map((x) => x.class).filter(Boolean)])].sort(sortNum);
  const classes = [...new Set([...state.details.values()].flatMap((d) => Object.values(d.classes ?? {})).filter(Boolean))].sort(sortNum);
  const select = (label, key, values, all) => {
    const el = h('select', { 'aria-label': label, onchange: (e) => { state[key] = e.target.value; writePref(key, e.target.value); renderRows(); } },
      h('option', { value: '' }, all), ...values.map((v) => h('option', { value: v }, v)));
    if (state[key] && !values.includes(state[key])) state[key] = '';
    el.value = state[key];
    return el;
  };
  $('ws-filters').replaceChildren(select('Filter by company', 'tg', tgs, 'All companies'), select('Filter by class', 'cls', classes, 'All classes'));
}

function visibleStudents() {
  return state.students.filter((st) => (!state.tg || st.class === state.tg) && (!state.cls || classOf(st) === state.cls));
}

function joinedSummary() {
  const joined = new Set(state.students.map((x) => `${x.class}|${x.name}`));
  let total = 0;
  let inn = 0;
  for (const [tg, g] of state.roster) {
    if (state.tg && tg !== state.tg) continue;
    const d = state.details.get(tg) ?? {};
    for (const name of g.students ?? []) {
      if (state.cls && (d.classes?.[name] ?? '') !== state.cls) continue;
      total++;
      if (joined.has(`${tg}|${name}`)) inn++;
    }
  }
  return total ? `${inn} of ${total} students on the name lists have started` : '';
}

const sectionSize = sectionTarget;

function renderRows() {
  const shownIds = new Set(visibleStudents().map((x) => x.sid));
  for (const sid of [...state.selected]) if (!shownIds.has(sid)) state.selected.delete(sid);
  renderBulk();
  const list = visibleStudents();
  const joinedText = joinedSummary();
  $('ws-status').textContent = `${state.flash ? `${state.flash} · ` : ''}${joinedText ? `${joinedText} · ` : ''}Showing ${list.length} of ${state.students.length} · updates live · click a row to read a journal`;
  renderStats(list);
  if (!list.length) {
    $('ws-rows').replaceChildren(h('tr', {}, h('td', { colspan: '6', class: 'muted' },
      state.students.length ? 'No students at this company or in this class yet.' : 'No one has started yet. Students open the journal link on their phones.')));
    return;
  }
  $('ws-rows').replaceChildren(...list.map((st) => {
    const { secs, pct } = progressOf(st);
    const pin = h('button', {
      class: 'pin-btn', type: 'button', title: 'Show PIN',
      onclick: (e) => { e.stopPropagation(); pin.textContent = pin.textContent === '••••' ? (st.pin ?? 'not set') : '••••'; },
    }, '••••');
    return h('tr', { onclick: () => openStudent(st), tabindex: '0', onkeydown: (e) => { if (e.key === 'Enter') openStudent(st); } },
      h('td', { class: 'sel', onclick: (e) => e.stopPropagation() },
        h('input', {
          type: 'checkbox', 'aria-label': `Select ${st.name}`, ...(state.selected.has(st.sid) ? { checked: true } : {}),
          onchange: (e) => { if (e.target.checked) state.selected.add(st.sid); else state.selected.delete(st.sid); renderBulk(); },
        })),
      h('td', {}, h('div', { class: 'who-cell' }, h('b', {}, st.name),
        classOf(st) ? h('span', { class: 'small muted' }, classOf(st)) : null)),
      // st.class is the company the student picked when signing in.
      h('td', { class: 'small' }, h('div', { class: 'co-cell' }, companyLogo({ name: st.company || st.class, site: st.website, logoUrl: st.logoUrl }, 'sm', { school: false }), st.company || st.class || '–')),
      h('td', {}, h('div', { class: 'prog-cell' },
        // One small block per section: hover for its name and count.
        h('div', { class: 'bar' }, ...secs.map((s) => {
          const n = Math.min(sectionSize(s), st.progress?.[s.id] ?? 0);
          return h('i', { class: n >= sectionSize(s) ? 'done' : n ? 'part' : '', title: `${s.title}: ${n} of ${sectionSize(s)}` });
        })),
        h('span', { class: 'num small' }, `${Math.round(pct * 100)}%`))),
      h('td', { class: 'small muted' }, ago(st.lastActive)),
      h('td', {}, pin));
  }));
}

// Four summary tiles above the table, for the students currently shown.
function renderStats(list) {
  const avg = list.length ? Math.round((list.reduce((n, st) => n + progressOf(st).pct, 0) / list.length) * 100) : 0;
  const wrap = sections().find((s) => s.id === 'wrapup');
  const wrapped = list.filter((st) => (st.progress?.wrapup ?? 0) >= sectionSize(wrap)).length;
  // Each day's progress counts its reflection answers (mood isn't counted).
  const written = list.reduce((n, st) => n + sections(st).filter((s) => s.pick).reduce((m, s) => m + (st.progress?.[s.id] ?? 0), 0), 0);
  const tile = (pic, value, label, bar) => h('div', { class: 'stat' },
    art(pic, 'stat-art'),
    h('div', {}, h('b', {}, value), h('small', {}, label),
      bar != null ? h('span', { class: 'mini-bar' }, h('i', { style: `width:${bar}%` })) : null));
  $('ws-stats').replaceChildren(
    tile('team', String(list.length), list.length === 1 ? 'student started' : 'students started'),
    tile('summit', `${avg}%`, 'average progress', avg),
    tile('thought', String(written), written === 1 ? 'reflection written' : 'reflections written'),
    tile('finish', `${wrapped}`, `finished the wrap-up`));
}

// ---------- one student ----------

function closeDrawer() { $('drawer').hidden = true; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

async function loadJournal(st) {
  const base = `cohorts/${state.ws.code}/students/${st.sid}`;
  const entries = await getDocs(collection(db, `${base}/entries`));
  return { answers: Object.fromEntries(entries.docs.map((d) => [d.id, d.data().answers ?? {}])) };
}


function accountSection(st) {
  const note = h('span', { class: 'small muted' });
  const pinShown = h('b', { class: 'pin-big' }, '••••');
  const reveal = h('button', { class: 'btn quiet', type: 'button', onclick: () => { pinShown.textContent = pinShown.textContent === '••••' ? (st.pin ?? 'not set') : '••••'; } }, 'Show / hide');
  const newPin = h('input', { type: 'text', inputmode: 'numeric', maxlength: '4', placeholder: 'New PIN', style: 'width:7rem' });
  const reset = h('button', {
    class: 'btn ghost small-btn', type: 'button',
    onclick: async () => {
      const pin = newPin.value.trim();
      if (!/^\d{4}$/.test(pin)) { note.textContent = 'Enter exactly 4 digits.'; return; }
      try {
        await updateDoc(doc(db, `cohorts/${state.ws.code}/students/${st.sid}`), { pin, pinHash: await pinHash(st.sid, pin) });
        st.pin = pin;
        pinShown.textContent = pin;
        newPin.value = '';
        note.textContent = `PIN changed. ${st.name} can now open the journal on any phone with ${pin}.`;
      } catch (err) { console.error(err); note.textContent = 'Could not change the PIN. Try again.'; }
    },
  }, 'Set new PIN');
  return h('section', {},
    h('h3', {}, 'Login'),
    h('div', { class: 'inline-row' }, h('span', {}, 'PIN:'), pinShown, reveal),
    h('div', { class: 'inline-row' }, newPin, reset),
    note);
}

function teacherNoteSection(st) {
  const note = h('span', { class: 'small muted' }, st.noteBy ? `Last saved by ${st.noteBy}` : 'Shown at the end of the student’s portfolio.');
  const box = h('textarea', { maxlength: '1500', rows: '3', placeholder: 'e.g. Your Day 3 reflection on using feedback is a great answer for “Describe a challenge”.' });
  box.value = st.teacherNote ?? '';
  const save = h('button', {
    class: 'btn small-btn', type: 'button',
    onclick: async () => {
      try {
        await updateDoc(doc(db, `cohorts/${state.ws.code}/students/${st.sid}`), { teacherNote: box.value.trim().slice(0, 1500), noteBy: state.email, noteAt: serverTimestamp() });
        note.textContent = 'Saved. The student sees it on their portfolio.';
      } catch (err) { console.error(err); note.textContent = 'Could not save the note. Try again.'; }
    },
  }, 'Save note');
  return h('section', {}, h('h3', {}, 'Teacher’s note'), box, h('div', { class: 'inline-row' }, save, note));
}

async function openStudent(row) {
  // Use the live copy, so a note or PIN saved a moment ago shows up.
  const st = state.students.find((x) => x.sid === row.sid) ?? row;
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
  const { answers } = journal;
  const showPortfolio = () => {
    drawer.replaceChildren(
      h('div', { class: 'inline-row' },
        h('button', { class: 'btn ghost small-btn', type: 'button', onclick: () => openStudent(st) }, '← Journal'),
        h('button', { class: 'btn small-btn', type: 'button', onclick: () => window.print() }, 'Print / save as PDF')),
      renderPortfolio({ student: state.students.find((x) => x.sid === st.sid) ?? st, cohort: state.ws, answers }));
    drawer.scrollTop = 0;
  };
  const show = (s, p) => {
    let a = String(answers[s.id]?.[p.id] ?? '').trim();
    if (p.type === 'mood' && a) a = MOODS.find((m) => m.v === a)?.label ?? a;
    return h('div', { class: 'qa' }, h('b', {}, p.q), h('p', { class: isAnswered(a) ? '' : 'empty' }, a || 'Not answered'));
  };
  drawer.replaceChildren(
    h('div', { style: 'display:flex;justify-content:space-between;gap:1rem;align-items:start' },
      h('div', { class: 'drawer-who' },
        companyLogo({ name: st.company || st.class, site: st.website, logoUrl: st.logoUrl }, 'drawer-logo'),
        h('div', {},
          h('span', { class: 'label' }, [st.company || st.class, classOf(st), st.industry].filter(Boolean).join(' · ')),
          h('h2', {}, st.name),
          h('span', { class: 'small muted' }, [ccaOf(st) && `CCA: ${ccaOf(st)}`, phoneOf(st) && `Contact: ${phoneOf(st)}${st.phone ? ' (from student)' : ''}`].filter(Boolean).join(' · ')))),
      h('div', { class: 'inline-row' },
        h('button', { class: 'btn small-btn', type: 'button', onclick: showPortfolio }, 'View portfolio'),
        h('button', { class: 'btn ghost small-btn', type: 'button', onclick: closeDrawer }, 'Close'))),
    accountSection(st),
    teacherNoteSection(st),
    ...sections(st).map((s) => {
      // Of the five reflection questions, show only the ones the student chose to answer.
      const shown = s.prompts.filter((p) => !s.pick?.from.includes(p.id) || isAnswered(answers[s.id]?.[p.id]));
      return h('section', { class: 'drawer-sec' }, h('h3', {}, s.art ? art(s.art, 'drawer-art') : null, s.theme ? `${s.title} · ${s.theme}` : s.title),
        s.pick && shown.length === s.prompts.length - s.pick.from.length ? h('p', { class: 'empty small muted' }, 'No reflections yet.') : null,
        ...shown.map((p) => show(s, p)));
    }),
    deleteStudentSection(st));
  drawer.scrollTop = 0;
}

// ---------- deleting ----------

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

async function deleteStudent(st) {
  const base = `cohorts/${state.ws.code}/students/${st.sid}`;
  await deleteCollections(['entries', 'photos', 'claims'].map((c) => `${base}/${c}`));
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
  return h('section', {}, h('h3', {}, 'Delete'),
    h('p', { class: 'small muted' }, 'Removes this student’s answers. This can’t be undone. Download the CSV first if you need a copy.'),
    h('div', {}, btn), note);
}

$('ws-delete').addEventListener('click', async () => {
  const b = $('ws-delete');
  const code = state.ws.code;
  if (!b.dataset.armed) {
    b.dataset.armed = '1';
    b.textContent = `Click again to delete ${code} and all ${state.students.length} journals`;
    b.classList.add('danger');
    setTimeout(() => { delete b.dataset.armed; b.textContent = 'Delete group'; b.classList.remove('danger'); }, 5000);
    return;
  }
  b.disabled = true;
  $('ws-status').textContent = 'Deleting…';
  try {
    for (const st of [...state.students]) await deleteStudent(st);
    state.unsub?.();
    await deleteDoc(doc(db, `cohorts/${code}`));
    closeDrawer();
    if (state.active.includes(code)) await setActive(state.active.filter((c) => c !== code));
    await loadCohorts();
  } catch (err) {
    console.error(err);
    $('ws-status').textContent = 'Could not delete everything. Try again.';
  } finally {
    b.disabled = false;
    delete b.dataset.armed;
    b.textContent = 'Delete group';
    b.classList.remove('danger');
  }
});

// ---------- CSV ----------

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

$('ws-export').addEventListener('click', async () => {
  const btn = $('ws-export');
  btn.disabled = true;
  btn.textContent = 'Preparing…';
  try {
    const cols = sections().flatMap((s) => s.prompts.map((p) => ({ s, p })));
    const rows = [['Company', 'Class', 'Name', 'CCA', 'Contact number', ...cols.map((c) => `${c.s.title}: ${c.p.q}`), 'Teacher’s note']];
    for (const st of visibleStudents()) {
      const { answers } = await loadJournal(st);
      rows.push([st.class ?? '', classOf(st), st.name, ccaOf(st), phoneOf(st), ...cols.map((c) => answers[c.s.id]?.[c.p.id] ?? ''), st.teacherNote ?? '']);
    }
    // BOM so Excel opens the file as UTF-8.
    const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: `${state.ws.name.replace(/[^\w-]+/g, '_')}_wex_journals.csv` });
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

// ---------- select and delete several ----------

function toggleAll(on) {
  state.selected = new Set(on ? visibleStudents().map((x) => x.sid) : []);
  renderRows();
}

function renderBulk() {
  const bar = $('ws-bulk');
  const n = state.selected.size;
  const shown = visibleStudents().length;
  const all = $('sel-all');
  if (all) { all.checked = n > 0 && n === shown; all.indeterminate = n > 0 && n < shown; }
  bar.hidden = n === 0;
  if (!n) { bar.replaceChildren(); return; }
  const names = state.students.filter((x) => state.selected.has(x.sid)).map((x) => x.name);
  const del = h('button', {
    class: 'btn ghost danger-ghost small-btn', type: 'button',
    onclick: async () => {
      if (!del.dataset.armed) {
        del.dataset.armed = '1';
        del.textContent = `Click again to delete ${n} ${n === 1 ? 'journal' : 'journals'} for good`;
        del.classList.add('danger');
        return;
      }
      del.disabled = true;
      const targets = state.students.filter((x) => state.selected.has(x.sid));
      let done = 0;
      try {
        for (const st of targets) { del.textContent = `Deleting ${done + 1} of ${targets.length}…`; await deleteStudent(st); done++; }
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
  bar.replaceChildren(h('b', {}, `${n} selected`),
    h('span', { class: 'small muted' }, names.slice(0, 6).join(', ') + (names.length > 6 ? ` +${names.length - 6} more` : '')),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn quiet', type: 'button', onclick: () => toggleAll(false) }, 'Clear selection'), del);
}

function flash(text) {
  state.flash = text;
  renderRows();
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => { state.flash = ''; if (!$('t-ws').hidden) renderRows(); }, 6000);
}

// ---------- teachers (admins) ----------

$('t-manage').addEventListener('click', () => { state.unsub?.(); closeDrawer(); listJournals = null; loadTeachers(); });
$('t-team-back').addEventListener('click', () => loadCohorts());

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
  renderCurrentRoster();
  const rows = snap.docs.map((d) => ({ email: d.id, ...d.data() }))
    .sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === 'admin' ? -1 : 1));
  $('t-team-rows').replaceChildren(...rows.map((t) => {
    const self = t.email === state.email;
    const role = h('select', { 'aria-label': `Rights for ${t.email}`, disabled: self ? true : null, onchange: (e) => changeRole(t.email, e.target.value) },
      h('option', { value: 'teacher' }, 'Teacher rights'), h('option', { value: 'admin' }, 'Admin rights'));
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
      type: 'text', maxlength: '60', 'aria-label': `Name for ${t.email}`,
      onchange: async (e) => {
        try { await updateDoc(doc(db, `teachers/${t.email}`), { name: e.target.value.trim() }); addMsg(`Saved name for ${t.email}.`, 'info'); } catch (err) { console.error(err); addMsg('Could not save that name. Try again.'); }
      },
    });
    nameIn.value = t.name ?? '';
    return h('tr', { style: 'cursor:default' },
      h('td', {}, t.email), h('td', {}, nameIn),
      h('td', {}, role, t.expiresAt ? h('div', { class: 'small muted' },
        `Guest · ${t.expiresAt.toMillis() > Date.now() ? 'until' : 'expired'} ${t.expiresAt.toDate().toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}`) : null),
      h('td', { class: 'small muted' }, t.addedBy || 'set up by hand'), h('td', {}, remove));
  }));
}

$('t-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  addMsg('');
  const email = $('a-email').value.trim().toLowerCase();
  const name = $('a-name').value.trim();
  const role = $('a-role').value;
  const withPassword = $('a-login').value === 'password';
  if (!/^[^@/\s]+@[^@/\s]+\.[^@/\s]+$/.test(email)) { addMsg('Enter a full email address, like ms.tan@school.edu.sg.'); return; }
  try {
    if ((await getDoc(doc(db, `teachers/${email}`))).exists()) { addMsg(`${email} is already on the list.`, 'warn'); return; }
    // Make the login first. If that email already has a login we didn't make, don't trust it.
    if (withPassword) {
      try {
        await createPasswordLogin(email);
      } catch (err) {
        console.warn(err);
        addMsg(err.code === 'auth/email-already-in-use'
          ? `${email} already has a login, so it can’t be given the starting password. Add them with “Google account”, or ask Lloyd to reset it.`
          : 'Could not make their login. Check the email and try again.');
        return;
      }
    }
    const data = { role, addedBy: state.email, addedAt: serverTimestamp() };
    if (name) data.name = name;
    if (withPassword) Object.assign(data, { pwAccount: true, mustChangePassword: true });
    await setDoc(doc(db, `teachers/${email}`), data);
    $('t-add').reset();
    await loadTeachers();
    addMsg(withPassword
      ? `Added ${email}. They sign in with this email and the password ${START_PASSWORD}, and can choose their own the first time.`
      : `Added ${email}. They press “Sign in with Google” using that Google account.`, 'info');
  } catch (err) {
    console.error(err);
    addMsg('Could not add that teacher. Check the email and try again.');
  }
});

async function changeRole(email, role) {
  try {
    await updateDoc(doc(db, `teachers/${email}`), { role });
    addMsg(`${email} now has ${role === 'admin' ? 'admin' : 'teacher'} rights.`, 'info');
  } catch (err) {
    console.error(err);
    addMsg('Could not change their rights. Try again.');
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

// Journals in the groups students can see, for the "started?" column of the name list.
let listJournals = null;
async function loadListJournals() {
  const all = await Promise.all(state.active.map((code) => getDocs(collection(db, `cohorts/${code}/students`)).catch(() => null)));
  listJournals = new Map(all.filter(Boolean).flatMap((q) => q.docs.map((d) => [`${d.data().class}|${d.data().name}`, d.data()])));
  renderCurrentRoster();
}

function renderCurrentRoster() {
  const tgs = [...state.roster.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!tgs.length) {
    $('r-current').replaceChildren(h('p', { class: 'muted small' }, 'No name lists yet. Students can’t start until you upload one.'));
    return;
  }
  if (!listJournals) { listJournals = new Map(); loadListJournals(); }
  const total = tgs.reduce((n, t) => n + (state.roster.get(t).students?.length ?? 0), 0);
  // One fold-out per company: each student's class, CCA, contact number and whether they've started.
  $('r-current').replaceChildren(
    h('h4', {}, `Current name lists: ${tgs.length} companies, ${total} students`),
    h('p', { class: 'small muted' }, 'Click a company to see its students. A number marked “from student” was typed in by the student in their journal.'),
    ...tgs.map((t) => {
      const g = state.roster.get(t);
      const d = state.details.get(t) ?? {};
      const names = [...(g.students ?? [])].sort((a, b) => a.localeCompare(b));
      const started = names.filter((n) => listJournals.has(`${t}|${n}`)).length;
      return h('details', { class: 'co-list' },
        h('summary', {}, companyLogo({ name: t }, 'sm', { school: false }), h('b', {}, t),
          h('span', { class: 'small muted' }, `${names.length} students · ${g.days ?? 5} days · ${started} started`)),
        h('div', { class: 'tablewrap' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Class'), h('th', {}, 'CCA'), h('th', {}, 'Contact number'), h('th', {}, 'Journal'))),
          h('tbody', {}, ...names.map((n) => {
            const j = listJournals.get(`${t}|${n}`);
            const phone = j?.phone || d.phones?.[n] || '';
            return h('tr', { style: 'cursor:default' },
              h('td', {}, n), h('td', {}, d.classes?.[n] || '–'), h('td', {}, d.cca?.[n] || '–'),
              h('td', { class: 'num' }, phone || '–', j?.phone ? h('span', { class: 'small muted' }, ' (from student)') : null),
              h('td', { class: 'small' }, j ? `Started · ${j.mustChangePin ? 'PIN 1234' : 'own PIN'}` : h('span', { class: 'muted' }, 'Not yet')));
          })))));
    }));
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
    ? `Found ${parsed.rows.length - bad.length} students at ${groups.size} companies${bad.length ? `, plus ${bad.length} rows with problems (listed below, they won't be saved)` : ''}. Check, then press Replace.`
    : 'No students found. Check the files have a Name column.', groups.size ? 'info' : 'err');
  const sortNum = (a, b) => a.localeCompare(b, undefined, { numeric: true });
  const summary = h('div', { class: 'tablewrap' }, h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Company'), h('th', {}, 'Level'), h('th', {}, 'Students'), h('th', {}, 'Classes'), h('th', {}, 'Example names'))),
    h('tbody', {}, ...[...groups.keys()].sort(sortNum).map((tg) => {
      const g = groups.get(tg);
      return h('tr', { style: 'cursor:default' }, h('td', {}, tg), h('td', {}, `Sec ${g.level}`), h('td', { class: 'num' }, String(g.students.length)),
        h('td', { class: 'small' }, [...new Set(Object.values(g.classes))].sort().join(', ') || '–'),
        h('td', { class: 'small muted' }, g.students.slice(0, 3).join(', ') + (g.students.length > 3 ? '…' : '')));
    }))));
  const problems = [...parsed.problems.map((p) => h('li', {}, p)), ...bad.slice(0, 50).map((r) => h('li', {}, `${r.source}: ${r.name || '(no name)'} — ${r.error}`))];
  const replace = h('button', {
    class: 'btn', type: 'button', disabled: !groups.size,
    onclick: async () => {
      replace.disabled = true;
      rosterMsg('Saving name lists…', 'info');
      try {
        await saveRoster(groups);
        await loadRoster();
        $('r-preview').replaceChildren();
        renderCurrentRoster();
        rosterMsg(`Saved ${groups.size} companies. Students can now pick their company and name.`, 'info');
      } catch (err) {
        console.error(err);
        rosterMsg('Could not save the name lists. Only admins can upload them.');
        replace.disabled = false;
      }
    },
  }, `Replace name lists with these ${groups.size} companies`);
  $('r-preview').replaceChildren(
    h('h4', {}, 'Preview'), summary,
    problems.length ? h('details', { open: true }, h('summary', {}, `${problems.length} problems`), h('ul', { class: 'small' }, ...problems)) : null,
    h('div', { class: 'extra-actions' }, replace, h('span', { class: 'small muted' }, 'Groups not in these files are removed. Journals already started are kept.')));
});

async function saveRoster(groups) {
  const writes = [];
  for (const old of state.roster.keys()) {
    if (!groups.has(old)) writes.push((b) => b.delete(doc(db, `roster/${old}`)), (b) => b.delete(doc(db, `rosterDetails/${old}`)));
  }
  for (const [tg, g] of groups) {
    // Keep each company's number of days and industry when its names are re-uploaded.
    const { days, industry } = state.roster.get(tg) ?? {};
    writes.push((b) => b.set(doc(db, `roster/${tg}`), {
      level: g.level, students: g.students, ...(days ? { days } : {}), ...(industry ? { industry } : {}), updatedAt: serverTimestamp(), updatedBy: state.email,
    }));
    // A file without CCA or contact columns keeps the ones already saved.
    const old = state.details.get(tg) ?? {};
    const keep = (fresh, prev) => (Object.keys(fresh ?? {}).length ? fresh : (prev ?? {}));
    writes.push((b) => b.set(doc(db, `rosterDetails/${tg}`), { classes: g.classes, cca: keep(g.cca, old.cca), phones: keep(g.phones, old.phones), updatedAt: serverTimestamp() }));
  }
  for (let i = 0; i < writes.length; i += 400) {
    const batch = writeBatch(db);
    writes.slice(i, i + 400).forEach((w) => w(batch));
    await batch.commit();
  }
}
