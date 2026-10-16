import { signInAnonymously, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, writeBatch, collection, onSnapshot, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { auth, db, configured, rosterSid, pinHash, h } from './firebase.js';
import { sectionsFor, MOODS, isAnswered, countable } from './wex.js';
import { renderPortfolio } from './portfolio.js';
import { icon } from './icons.js';
import { celebrate } from './confetti.js';

const $ = (id) => document.getElementById(id);
const SESSION_KEY = 'wex-journal-session';
const MAX_PHOTOS = { placement: 2, day: 3 };
const MAX_IMAGE_CHARS = 400000; // ~300 KB per photo keeps the free database plan roomy

const state = {
  code: null, sid: null, cohort: null, student: null, sections: [],
  answers: {}, photos: new Map(), view: 'home', unsubs: [],
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
const answer = (section, id) => state.answers[section]?.[id] ?? '';
const sectionById = (id) => state.sections.find((s) => s.id === id);
const photosOf = (section) => [...state.photos.values()].filter((p) => p.section === section)
  .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));

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
  const ps = countable(s);
  let n = ps.filter((p) => isAnswered(answer(s.id, p.id))).length;
  // A day counts its photo as one more thing to do.
  if (s.photos) n += photosOf(s.id).length ? 1 : 0;
  return { n, of: ps.length + (s.photos ? 1 : 0) };
}

let lastProgress = '';
function saveProgress() {
  const progress = Object.fromEntries(state.sections.map((s) => [s.id, sectionCount(s).n]));
  const data = {
    progress,
    company: String(answer('placement', 'company')).slice(0, 100),
    industry: String(answer('placement', 'industry')).slice(0, 60),
    photoCount: state.photos.size,
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
    $('j-tg').replaceChildren(h('option', { value: '' }, tgs.length ? 'Choose your teaching group…' : 'No class lists yet. Ask your teacher.'),
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
  $('j-name').replaceChildren(h('option', { value: '' }, tg ? 'Choose your name…' : 'Pick your teaching group first'),
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
    joinMessage('This WEX journal is closed, and you don’t have a journal in it. Ask your teacher.', 'warn');
    return;
  }
  $('j-pin-field').hidden = false;
  $('j-pin-label').textContent = existing ? 'Your PIN' : 'Make up a 4-digit PIN';
  $('j-pin-hint').textContent = existing
    ? 'Welcome back! Type the PIN you made. Forgot it? Your teacher can see it.'
    : 'Write it down somewhere safe: you’ll need it next year to open this journal for your EAE interview.';
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
  if (!code) return joinMessage(joinState.open.length > 1 ? 'Choose your WEX group first.' : 'Journals aren’t open right now.', 'warn');
  if (!group || !name) return joinMessage('Choose your teaching group and your name.');
  if (!/^\d{4}$/.test(pin)) return joinMessage('Your PIN must be exactly 4 digits.');

  const sid = rosterSid(tg, name);
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
      batch.set(studentRef, { name, level: group.level, class: tg, pin, pinHash: hash, createdAt: serverTimestamp(), progress: {}, lastActive: serverTimestamp() });
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
  unsubscribeAll();
  Object.assign(state, {
    code, sid, cohort: c.data(), student: st.data(), sections: sectionsFor(c.data().days ?? 5),
    answers: {}, photos: new Map(), view: 'home',
  });
  created.clear();
  lastProgress = '';
  $('me-name').textContent = `Hi, ${state.student.name.split(' ')[0]}!`;
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
      if (first) { first = false; render(); } else refreshHome();
    }, lost),
    onSnapshot(collection(db, `${base}/photos`), (snap) => {
      state.photos = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }]));
      renderPhotos();
      refreshHome();
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
  $('me-meta').textContent = [state.student.class, company, state.cohort?.name].filter(Boolean).join(' · ');
  const all = state.sections.map(sectionCount);
  const done = all.reduce((n, c) => n + c.n, 0);
  const total = all.reduce((n, c) => n + c.of, 0);
  $('progress-fill').style.width = `${Math.round((done / total) * 100)}%`;
  $('progress-text').textContent = `${Math.round((done / total) * 100)}%`;
}

function go(view) {
  flushSaves();
  state.view = view;
  render();
  window.scrollTo({ top: 0 });
}

function render() {
  renderMeta();
  if (state.view === 'home') return renderHome();
  if (state.view === 'portfolio') return renderPortfolioView();
  return renderSection(sectionById(state.view));
}

function refreshHome() {
  renderMeta();
  if (state.view === 'home') renderHome();
}

// ---------- home: the list of sections ----------

function renderHome() {
  const card = (s) => {
    const c = sectionCount(s);
    const status = c.n >= c.of ? 'done' : c.n ? 'part' : '';
    const pics = s.photos ? photosOf(s.id).length : 0;
    return h('button', { type: 'button', class: `sec-card ${status}`, style: `--c:${s.color}`, onclick: () => go(s.id) },
      h('span', { class: 'sec-icon' }, status === 'done' ? icon('check', 22) : icon(s.icon, 22)),
      h('span', { class: 'sec-body' }, h('b', {}, s.title),
        h('small', {}, status === 'done' ? 'Done' : `${c.n} of ${c.of}`, pics ? ` · ${pics} photo${pics === 1 ? '' : 's'}` : '')),
      icon('next', 18));
  };
  const group = (label, list) => [h('p', { class: 'group-label' }, label), h('div', { class: 'sec-list' }, ...list.map(card))];
  const days = state.sections.filter((s) => s.id.startsWith('day'));
  const stars = state.sections.filter((s) => s.id.startsWith('star'));
  $('panel').replaceChildren(
    h('div', { class: 'home-intro' },
      h('p', {}, 'Write a little every day while it’s fresh. Next year, this journal turns into your ', h('b', {}, 'EAE interview portfolio'), '.')),
    ...group('Before you start', [sectionById('placement')]),
    ...group('Each day', days),
    ...group('Stories for your interview', stars),
    ...group('Last day', [sectionById('wrapup')]),
    h('button', { type: 'button', class: 'portfolio-card', onclick: () => go('portfolio') },
      icon('portfolio', 28),
      h('span', {}, h('b', {}, 'My EAE portfolio'), h('small', {}, 'Your journal as interview answers. Print or save as PDF.')),
      icon('next', 18)),
  );
}

// ---------- one section ----------

function stageHead(s) {
  return h('header', { class: 'stage-head' },
    h('span', { class: 'stage-badge' }, icon(s.icon, 26)),
    h('div', {}, h('h2', {}, s.title), h('p', {}, s.blurb)));
}

function field(s, p) {
  const id = `q-${s.id}-${p.id}`;
  const value = String(answer(s.id, p.id));
  const disabled = !isOpen();
  const label = h('label', { class: 'q-line', for: id }, p.q, p.optional ? h('em', { class: 'opt' }, 'optional') : null);
  const hint = p.hint ? h('small', {}, p.hint) : null;
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
  if (p.type === 'select') {
    input = h('select', { id, disabled, onchange: (e) => { queueSave(s.id, p.id, e.target.value); flushField(`${s.id}__${p.id}`); } },
      h('option', { value: '' }, 'Choose…'), ...p.options.map((o) => h('option', { value: o }, o)));
    input.value = value;
  } else if (p.type === 'short') {
    input = h('input', { id, type: 'text', maxlength: String(p.max ?? 100), value, disabled, oninput: (e) => queueSave(s.id, p.id, e.target.value) });
  } else {
    input = h('textarea', { id, maxlength: '2000', rows: '3', value, disabled, oninput: (e) => { queueSave(s.id, p.id, e.target.value); grow(e.target); } });
    requestAnimationFrame(() => grow(input));
  }
  input.addEventListener('blur', () => flushField(`${s.id}__${p.id}`));
  return h('div', { class: 'field' }, label, hint, input);
}

function grow(el) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight + 4, 480)}px`;
}

function renderSection(s) {
  if (!s) return go('home');
  const i = state.sections.indexOf(s);
  const prev = state.sections[i - 1];
  const next = state.sections[i + 1];
  $('panel').style.setProperty('--stage', s.color);
  $('panel').replaceChildren(
    h('button', { type: 'button', class: 'btn quiet back', onclick: () => go('home') }, icon('back', 16), ' My journal'),
    stageHead(s),
    s.photos || s.id === 'placement' ? photoSection(s) : null,
    ...s.prompts.map((p) => field(s, p)),
    h('div', { class: 'nav' },
      prev ? h('button', { type: 'button', class: 'btn ghost', onclick: () => go(prev.id) }, `← ${prev.title}`) : h('span'),
      next ? h('button', { type: 'button', class: 'btn', onclick: () => go(next.id) }, `${next.title} →`)
        : h('button', { type: 'button', class: 'btn', onclick: () => go('portfolio') }, 'My portfolio →')),
  );
  renderPhotos();
}

// ---------- photos ----------

function photoSection(s) {
  const max = s.id === 'placement' ? MAX_PHOTOS.placement : MAX_PHOTOS.day;
  const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: (e) => addPhotos(s, e) });
  const library = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => addPhotos(s, e) });
  return h('section', { class: 'photos', 'data-section': s.id },
    h('div', { class: 'photo-head' },
      h('b', {}, s.id === 'placement' ? 'Photo of your workplace (optional)' : 'Photos from today'),
      h('small', { class: 'muted' }, `Up to ${max}. Star the best ones for your portfolio.`)),
    isOpen() ? h('div', { class: 'photo-actions' },
      h('button', { type: 'button', class: 'btn big cam', onclick: () => camera.click() }, icon('camera', 22), ' Take photo'),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => library.click() }, icon('image', 20), ' From gallery'),
      camera, library) : null,
    h('p', { class: 'msg err photo-msg', hidden: true }),
    h('div', { class: 'photo-grid' }));
}

function photoMessage(text) {
  const m = $('panel').querySelector('.photo-msg');
  if (!m) return;
  m.textContent = text;
  m.hidden = !text;
}

async function addPhotos(s, e) {
  const files = [...(e.target.files ?? [])];
  e.target.value = '';
  photoMessage('');
  const max = s.id === 'placement' ? MAX_PHOTOS.placement : MAX_PHOTOS.day;
  const room = max - photosOf(s.id).length;
  if (room <= 0) { photoMessage(`You already have ${max} photos here. Delete one to add another.`); return; }
  for (const f of files.slice(0, room)) {
    try {
      const data = await compressImage(f);
      await saving(addDoc(collection(db, `cohorts/${state.code}/students/${state.sid}/photos`), {
        section: s.id, caption: '', data, star: false, createdAt: serverTimestamp(),
      }));
    } catch (err) {
      console.error(err);
      photoMessage(err.message && !err.code ? err.message : 'That photo didn’t save. Try again.');
    }
  }
  if (files.length > room) photoMessage(`Only ${room} more photo${room === 1 ? '' : 's'} fit here, so the rest were skipped.`);
  saveProgress();
}

function renderPhotos() {
  const grid = $('panel').querySelector('.photo-grid');
  if (!grid) return;
  const section = grid.closest('.photos').dataset.section;
  const list = photosOf(section);
  grid.replaceChildren(...list.map((p) => {
    const caption = h('input', {
      type: 'text', maxlength: '200', placeholder: 'What’s happening here?', value: p.caption ?? '', disabled: !isOpen(), 'aria-label': 'Photo caption',
      onchange: (e) => saving(updateDoc(doc(db, `cohorts/${state.code}/students/${state.sid}/photos/${p.id}`), { caption: e.target.value.trim().slice(0, 200), star: !!p.star })),
    });
    const star = h('button', {
      type: 'button', class: `star-btn${p.star ? ' on' : ''}`, disabled: !isOpen(), 'aria-pressed': String(!!p.star), title: 'Use in my portfolio',
      onclick: () => saving(updateDoc(doc(db, `cohorts/${state.code}/students/${state.sid}/photos/${p.id}`), { star: !p.star, caption: p.caption ?? '' })),
    }, icon('star', 18), p.star ? ' In portfolio' : ' Portfolio');
    const del = h('button', {
      type: 'button', class: 'btn quiet', disabled: !isOpen(),
      onclick: (ev) => {
        const b = ev.currentTarget;
        if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again to delete'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'Delete'; }, 3000); return; }
        saving(deleteDoc(doc(db, `cohorts/${state.code}/students/${state.sid}/photos/${p.id}`)));
      },
    }, 'Delete');
    return h('figure', { class: 'photo' },
      h('button', { type: 'button', class: 'photo-open', onclick: () => lightbox(p.data, p.caption) }, h('img', { src: p.data, alt: p.caption || 'Photo' })),
      h('figcaption', {}, caption, h('div', { class: 'photo-tools' }, star, del)));
  }));
}

// Shrink camera photos (often 3–5 MB) to a few hundred KB, so they upload quickly on mobile data.
async function compressImage(fileObj) {
  if (fileObj.type && !fileObj.type.startsWith('image/')) throw new Error('That isn’t a photo. Choose a JPG or PNG picture.');
  const bitmap = await (window.createImageBitmap
    ? createImageBitmap(fileObj, { imageOrientation: 'from-image' }).catch(() => null)
    : Promise.resolve(null));
  const url = bitmap ? null : URL.createObjectURL(fileObj);
  try {
    const img = bitmap ?? await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That photo couldn’t be opened. Try taking it again, or choose a JPG.'));
      i.src = url;
    });
    const w = img.naturalWidth ?? img.width;
    const hgt = img.naturalHeight ?? img.height;
    for (const [maxSide, quality] of [[1280, 0.72], [1100, 0.66], [960, 0.6], [800, 0.55]]) {
      const scale = Math.min(1, maxSide / Math.max(w, hgt));
      const c = document.createElement('canvas');
      c.width = Math.round(w * scale);
      c.height = Math.round(hgt * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/jpeg', quality);
      if (data.length <= MAX_IMAGE_CHARS) return data;
    }
    throw new Error('That photo is too big to save. Try again with less zoom.');
  } finally {
    if (url) URL.revokeObjectURL(url);
    bitmap?.close?.();
  }
}

function lightbox(src, caption) {
  const close = () => box.remove();
  const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-label': caption || 'Photo', onclick: close },
    h('img', { src, alt: caption || '' }), caption ? h('p', {}, caption) : null,
    h('button', { class: 'btn', type: 'button', onclick: close }, 'Close'));
  document.body.append(box);
}

// ---------- portfolio ----------

function renderPortfolioView() {
  $('panel').style.setProperty('--stage', '#0f172a');
  const pf = renderPortfolio({
    student: state.student, cohort: state.cohort, answers: state.answers, photos: [...state.photos.values()],
  }, { goTo: (id) => go(id) });
  $('panel').replaceChildren(
    h('div', { class: 'pf-bar no-print' },
      h('button', { type: 'button', class: 'btn quiet back', onclick: () => go('home') }, icon('back', 16), ' My journal'),
      h('button', { type: 'button', class: 'btn', onclick: () => window.print() }, icon('print', 18), ' Print / save as PDF')),
    pf);
  if (state.answers.wrapup?.pitch && !renderPortfolioView.cheered) {
    renderPortfolioView.cheered = true;
    celebrate('#7c3aed', 'Your portfolio is ready!');
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
