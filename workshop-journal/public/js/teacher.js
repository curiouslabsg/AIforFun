import {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, onSnapshot, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { auth, db, configured } from './firebase.js';
import { STAGES, TRACK_LABEL, promptFor } from './prompts.js';

const $ = (id) => document.getElementById(id);
const state = { email: null, role: null, workshops: [], ws: null, students: [], unsub: null };

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
    await loadWorkshops();
  });
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
  if (!name) { msg('t-create-msg', 'Give the workshop a name, for example "1E1 Code for Fun".'); return; }
  try {
    let code;
    for (let i = 0; i < 5; i++) {
      code = newCode(trackId);
      if (!(await getDoc(doc(db, `workshops/${code}`))).exists()) break;
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
    h('th', {}, 'Team'), h('th', {}, 'Name'), h('th', {}, 'Progress'),
    ...STAGES.map((s) => h('th', {}, s.title)), h('th', {}, 'Last active')));
  view('t-ws');

  state.unsub?.();
  state.unsub = onSnapshot(collection(db, `workshops/${code}/students`), (snap) => {
    state.students = snap.docs.map((d) => ({ sid: d.id, ...d.data() }))
      .sort((a, b) => a.team - b.team || a.name.localeCompare(b.name));
    renderRows();
  }, (err) => { console.error(err); $('ws-status').textContent = 'Lost the live connection. Reload the page.'; });
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

function renderRows() {
  const total = STAGES.reduce((n, s) => n + s.prompts.length, 0);
  const teams = new Set(state.students.map((s) => s.team)).size;
  $('ws-status').textContent = `${state.students.length} ${state.students.length === 1 ? 'student' : 'students'} in ${teams} ${teams === 1 ? 'team' : 'teams'} · updates live · click a row to read a journal`;
  if (!state.students.length) {
    $('ws-rows').replaceChildren(h('tr', {}, h('td', { colspan: String(STAGES.length + 4), class: 'muted' }, `No one has joined yet. Students go to this site and enter ${state.ws.code}.`)));
    return;
  }
  $('ws-rows').replaceChildren(...state.students.map((st) => {
    const answered = STAGES.reduce((n, s) => n + Math.min(st.progress?.[s.id] ?? 0, s.prompts.length), 0);
    return h('tr', { onclick: () => openStudent(st), tabindex: '0', onkeydown: (e) => { if (e.key === 'Enter') openStudent(st); } },
      h('td', { class: 'num' }, String(st.team)),
      h('td', {}, st.name),
      h('td', { class: 'num' }, `${Math.round((answered / total) * 100)}%`),
      ...STAGES.map((s) => {
        const n = st.progress?.[s.id] ?? 0;
        const cls = n >= s.prompts.length ? 'done' : n ? 'part' : '';
        return h('td', {}, h('div', { class: 'bar', title: `${s.title}: ${n}/${s.prompts.length}` }, h('i', { class: cls })));
      }),
      h('td', { class: 'small muted' }, ago(st.lastActive)));
  }));
}

// ---------- student drawer ----------

function closeDrawer() { $('drawer').hidden = true; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

async function loadEntries(sid) {
  const snap = await getDocs(collection(db, `workshops/${state.ws.code}/students/${sid}/entries`));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function openStudent(st) {
  const drawer = $('drawer');
  drawer.hidden = false;
  drawer.replaceChildren(h('p', { class: 'muted' }, 'Loading journal…'));
  let entries;
  try { entries = await loadEntries(st.sid); } catch (err) {
    console.error(err);
    drawer.replaceChildren(h('p', { class: 'msg err' }, 'Could not load this journal.'));
    return;
  }
  const byStage = Object.fromEntries(entries.filter((e) => e.kind === 'stage').map((e) => [e.stage, e.answers ?? {}]));
  const log = entries.filter((e) => e.kind === 'learning').sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));

  drawer.replaceChildren(
    h('div', { style: 'display:flex;justify-content:space-between;gap:1rem;align-items:start' },
      h('div', {}, h('span', { class: 'label' }, `Team ${st.team}`), h('h2', {}, st.name)),
      h('button', { class: 'btn ghost', type: 'button', onclick: closeDrawer }, 'Close')),
    h('section', {}, h('h3', {}, `Learning log (${log.length})`),
      ...(log.length ? log.map((e) => h('div', { class: 'qa' },
        h('b', {}, `${e.type === 'gathered' ? 'Gathered' : 'Learnt'} · ${e.tag ?? 'Other'}`), h('p', {}, e.text))) : [h('p', { class: 'muted' }, 'No entries yet.')])),
    ...STAGES.map((s) => h('section', {}, h('h3', {}, `${s.day} · ${s.title}`),
      ...s.prompts.map((raw) => {
        const p = promptFor(raw, state.ws.track);
        const a = (byStage[s.id]?.[p.id] ?? '').trim();
        return h('div', { class: 'qa' }, h('b', {}, p.q), h('p', { class: a ? '' : 'empty' }, a || 'Not answered'));
      }))),
  );
  drawer.scrollTop = 0;
}

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
    const cols = STAGES.flatMap((s) => s.prompts.map((raw) => ({ stage: s, p: promptFor(raw, state.ws.track) })));
    const header = ['Team', 'Name', ...cols.map((c) => `${c.stage.title}: ${c.p.q}`), 'Learnt', 'Gathered'];
    const rows = [header];
    for (const st of state.students) {
      const entries = await loadEntries(st.sid);
      const byStage = Object.fromEntries(entries.filter((e) => e.kind === 'stage').map((e) => [e.stage, e.answers ?? {}]));
      const log = entries.filter((e) => e.kind === 'learning');
      const join = (type) => log.filter((e) => (e.type ?? 'learnt') === type).map((e) => `[${e.tag}] ${e.text}`).join('\n');
      rows.push([st.team, st.name, ...cols.map((c) => byStage[c.stage.id]?.[c.p.id] ?? ''), join('learnt'), join('gathered')]);
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
    return h('tr', { style: 'cursor:default' },
      h('td', {}, t.email), h('td', {}, t.name || '–'), h('td', {}, role),
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
