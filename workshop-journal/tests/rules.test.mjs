// Run with: npm test  (starts the Firestore emulator and runs this file)
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, writeBatch, serverTimestamp,
} from 'firebase/firestore';

const CODE = 'CFF7K2P';
const SID = 't3-aisha-r';
const PIN = '4821';
const hash = (sid, pin) => createHash('sha256').update(`${sid}:${pin}`).digest('hex');

let env;
const teacher = () => env.authenticatedContext('teacher', { email: 'teacher@school.test', email_verified: true }).firestore();
const admin = () => env.authenticatedContext('admin', { email: 'admin@school.test', email_verified: true }).firestore();
const stranger = () => env.authenticatedContext('stranger', { email: 'someone@else.test', email_verified: true }).firestore();
const device = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-journal-rules',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'teachers/teacher@school.test'), { name: 'T', role: 'teacher' });
    await setDoc(doc(db, 'teachers/admin@school.test'), { name: 'A', role: 'admin' });
    await setDoc(doc(db, `workshops/${CODE}`), { name: '1E1', track: 'code', open: true, createdAt: 1, createdBy: 'teacher@school.test' });
  });
});

async function join(db, uid, sid = SID, pin = PIN) {
  const batch = writeBatch(db);
  batch.set(doc(db, `workshops/${CODE}/students/${sid}`), {
    name: 'Aisha', team: 3, level: 1, class: '1A', teacher: 'Mr Lloyd Goh', pin,
    pinHash: hash(sid, pin), createdAt: serverTimestamp(), progress: {}, lastActive: serverTimestamp(),
  });
  batch.set(doc(db, `workshops/${CODE}/students/${sid}/claims/${uid}`), { pinHash: hash(sid, pin), at: serverTimestamp() });
  return batch.commit();
}

const entry = (text = 'hello') => ({ kind: 'stage', stage: 'define', answers: { hmw: text }, createdAt: 1, updatedAt: 1 });

test('student can check a workshop code but not list codes', async () => {
  const db = device('a');
  await assertSucceeds(getDoc(doc(db, `workshops/${CODE}`)));
  await assertFails(getDocs(collection(db, 'workshops')));
  await assertSucceeds(getDocs(collection(teacher(), 'workshops')));
});

test('unauthenticated users can do nothing', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, `workshops/${CODE}`)));
});

test('student joins and writes their own journal', async () => {
  const db = device('a');
  await assertSucceeds(getDoc(doc(db, `workshops/${CODE}/students/${SID}`))); // name is free
  await assertSucceeds(join(db, 'a'));
  await assertSucceeds(getDoc(doc(db, `workshops/${CODE}/students/${SID}`)));
  await assertSucceeds(setDoc(doc(db, `workshops/${CODE}/students/${SID}/entries/define`), entry()));
  await assertSucceeds(updateDoc(doc(db, `workshops/${CODE}/students/${SID}`), { progress: { define: true } }));
});

test('another device cannot read or write a journal without the PIN', async () => {
  await join(device('a'), 'a');
  await setDoc(doc(device('a'), `workshops/${CODE}/students/${SID}/entries/define`), entry());
  const other = device('b');
  await assertFails(getDoc(doc(other, `workshops/${CODE}/students/${SID}`)));
  await assertFails(getDoc(doc(other, `workshops/${CODE}/students/${SID}/entries/define`)));
  await assertFails(setDoc(doc(other, `workshops/${CODE}/students/${SID}/entries/define`), entry('hacked')));
  await assertFails(setDoc(doc(other, `workshops/${CODE}/students/${SID}/claims/b`), { pinHash: hash(SID, '0000'), at: 1 }));
  await assertFails(setDoc(doc(other, `workshops/${CODE}/students/${SID}`), { name: 'x', team: 3, level: 1, class: '1A', teacher: 'T', pin: '0000', pinHash: hash(SID, '0000'), createdAt: 1, progress: {} }));
});

test('student reclaims their journal on a new device with the right PIN', async () => {
  await join(device('a'), 'a');
  const other = device('b');
  await assertSucceeds(setDoc(doc(other, `workshops/${CODE}/students/${SID}/claims/b`), { pinHash: hash(SID, PIN), at: 1 }));
  await assertSucceeds(getDoc(doc(other, `workshops/${CODE}/students/${SID}`)));
  // Once b has claimed, a third device still needs the PIN.
  await assertFails(setDoc(doc(device('c'), `workshops/${CODE}/students/${SID}/claims/c`), { pinHash: hash(SID, '1111'), at: 1 }));
});

test('a device cannot write a claim for somebody else\'s uid', async () => {
  await join(device('a'), 'a');
  await assertFails(setDoc(doc(device('b'), `workshops/${CODE}/students/${SID}/claims/z`), { pinHash: hash(SID, PIN), at: 1 }));
});

test('owner cannot change name, team or PIN hash', async () => {
  const db = device('a');
  await join(db, 'a');
  await assertFails(updateDoc(doc(db, `workshops/${CODE}/students/${SID}`), { team: 4 }));
  await assertFails(updateDoc(doc(db, `workshops/${CODE}/students/${SID}`), { pinHash: hash(SID, '9999') }));
});

test('closed workshop blocks joins and edits but keeps journals readable', async () => {
  const db = device('a');
  await join(db, 'a');
  await setDoc(doc(db, `workshops/${CODE}/students/${SID}/entries/define`), entry());
  await assertSucceeds(updateDoc(doc(teacher(), `workshops/${CODE}`), { open: false }));
  await assertFails(setDoc(doc(db, `workshops/${CODE}/students/${SID}/entries/define`), entry('late')));
  await assertFails(join(device('n'), 'n', 't1-new-kid'));
  await assertSucceeds(getDoc(doc(db, `workshops/${CODE}/students/${SID}/entries/define`)));
});

test('learning log entries can be deleted, stage entries cannot', async () => {
  const db = device('a');
  await join(db, 'a');
  await setDoc(doc(db, `workshops/${CODE}/students/${SID}/entries/define`), entry());
  await setDoc(doc(db, `workshops/${CODE}/students/${SID}/entries/l1`), { kind: 'learning', tag: 'Loops', text: 'x', createdAt: 1, updatedAt: 1 });
  await assertSucceeds(deleteDoc(doc(db, `workshops/${CODE}/students/${SID}/entries/l1`)));
  await assertFails(deleteDoc(doc(db, `workshops/${CODE}/students/${SID}/entries/define`)));
});

test('entry shape is enforced', async () => {
  const db = device('a');
  await join(db, 'a');
  await assertFails(setDoc(doc(db, `workshops/${CODE}/students/${SID}/entries/x`), { kind: 'essay', createdAt: 1 }));
  await assertFails(setDoc(doc(db, `workshops/${CODE}/students/${SID}/entries/x`), { kind: 'learning', text: 'x'.repeat(2001), createdAt: 1, updatedAt: 1 }));
  await assertFails(setDoc(doc(db, `workshops/${CODE}/students/${SID}/entries/x`), { ...entry(), secret: 1 }));
  await assertFails(setDoc(doc(db, `workshops/${CODE}/students/${SID}/entries/x`), { kind: 'learning', type: 'guessed', text: 'x', createdAt: 1, updatedAt: 1 }));
  await assertSucceeds(setDoc(doc(db, `workshops/${CODE}/students/${SID}/entries/x`), { kind: 'learning', type: 'gathered', tag: 'Food science', text: 'Curry cooled to 58 °C in 25 min', createdAt: 1, updatedAt: 1 }));
});

test('teacher reads everything; non-teacher Google users read nothing', async () => {
  await join(device('a'), 'a');
  await setDoc(doc(device('a'), `workshops/${CODE}/students/${SID}/entries/define`), entry());
  await assertSucceeds(getDocs(collection(teacher(), `workshops/${CODE}/students`)));
  await assertSucceeds(getDocs(collection(teacher(), `workshops/${CODE}/students/${SID}/entries`)));
  await assertFails(getDocs(collection(stranger(), `workshops/${CODE}/students`)));
  await assertFails(getDoc(doc(stranger(), `workshops/${CODE}/students/${SID}/entries/define`)));
  await assertFails(setDoc(doc(stranger(), 'workshops/NEWCODE'), { name: 'x', track: 'ai', open: true, createdAt: 1, createdBy: 'someone@else.test' }));
});

test('teacher creates a workshop; students cannot', async () => {
  await assertSucceeds(setDoc(doc(teacher(), 'workshops/AIF9Q3M'), { name: '2E3', track: 'ai', open: true, createdAt: 1, createdBy: 'teacher@school.test' }));
  await assertFails(setDoc(doc(device('a'), 'workshops/AIF1111'), { name: 'x', track: 'ai', open: true, createdAt: 1, createdBy: 'teacher@school.test' }));
  await assertFails(deleteDoc(doc(teacher(), 'workshops/AIF9Q3M')));
});

const newTeacher = (by = 'admin@school.test', role = 'teacher') => ({ name: 'Ms Tan', role, addedBy: by, addedAt: 1 });

test('admin adds, promotes and removes teachers', async () => {
  const db = admin();
  await assertSucceeds(setDoc(doc(db, 'teachers/ms.tan@school.test'), newTeacher()));
  await assertSucceeds(getDocs(collection(db, 'teachers')));
  await assertSucceeds(updateDoc(doc(db, 'teachers/ms.tan@school.test'), { role: 'admin' }));
  await assertSucceeds(deleteDoc(doc(db, 'teachers/ms.tan@school.test')));
});

test('admin cannot remove or demote themselves', async () => {
  const db = admin();
  await assertFails(deleteDoc(doc(db, 'teachers/admin@school.test')));
  await assertFails(updateDoc(doc(db, 'teachers/admin@school.test'), { role: 'teacher' }));
});

test('ordinary teachers and students cannot manage teachers', async () => {
  await assertFails(setDoc(doc(teacher(), 'teachers/new@school.test'), newTeacher('teacher@school.test')));
  await assertFails(deleteDoc(doc(teacher(), 'teachers/admin@school.test')));
  await assertFails(updateDoc(doc(teacher(), 'teachers/teacher@school.test'), { role: 'admin' }));
  await assertFails(setDoc(doc(device('a'), 'teachers/new@school.test'), newTeacher()));
  await assertFails(getDocs(collection(device('a'), 'teachers')));
});

test('teacher emails must be lowercase and well formed', async () => {
  await assertFails(setDoc(doc(admin(), 'teachers/Ms.Tan@school.test'), newTeacher()));
  await assertFails(setDoc(doc(admin(), 'teachers/not-an-email'), newTeacher()));
  await assertFails(setDoc(doc(admin(), 'teachers/x@school.test'), newTeacher('someone@else.test')));
  await assertFails(setDoc(doc(admin(), 'teachers/x@school.test'), newTeacher(undefined, 'owner')));
});

test('a newly added teacher can use the dashboard', async () => {
  await setDoc(doc(admin(), 'teachers/new@school.test'), newTeacher());
  const db = env.authenticatedContext('new', { email: 'new@school.test', email_verified: true }).firestore();
  await assertSucceeds(getDocs(collection(db, 'workshops')));
});

const sref = (db, sub = '') => doc(db, `workshops/${CODE}/students/${SID}${sub}`);
const img = (extra = {}) => ({ stage: 'prototype', source: 'sketch', caption: 'v1', data: 'data:image/jpeg;base64,AAAA', createdAt: 1, ...extra });
const note = (extra = {}) => ({ from: 'Ben, team 2', like: 'Loud buzzer', wish: '', whatif: '', use: 'yes', createdAt: 1, ...extra });

test('join requires level, class, teacher and a 4-digit PIN', async () => {
  const db = device('a');
  const bad = (fields) => setDoc(doc(db, `workshops/${CODE}/students/t9-x`), { name: 'X', team: 9, level: 1, class: '1A', teacher: 'T', pin: '1234', pinHash: hash('t9-x', '1234'), createdAt: 1, progress: {}, ...fields });
  await assertFails(bad({ level: 3 }));
  await assertFails(bad({ pin: '12a4' }));
  await assertFails(bad({ class: '' }));
  await assertSucceeds(bad({}));
});

test('teacher sees the PIN and can reset it; other students cannot', async () => {
  await join(device('a'), 'a');
  const t = teacher();
  const snap = await getDoc(sref(t));
  if (snap.data().pin !== PIN) throw new Error('teacher should see pin');
  await assertSucceeds(updateDoc(sref(t), { pin: '9999', pinHash: hash(SID, '9999') }));
  await assertSucceeds(updateDoc(sref(t), { class: '1B', teacher: 'Ms Sabrina Tay' }));
  await assertFails(updateDoc(sref(t), { name: 'Renamed' }));
  await assertFails(getDoc(sref(device('b'))));
  // The new PIN works on another device, the old one doesn't.
  await assertFails(setDoc(doc(device('c'), `workshops/${CODE}/students/${SID}/claims/c`), { pinHash: hash(SID, PIN), at: 1 }));
  await assertSucceeds(setDoc(doc(device('d'), `workshops/${CODE}/students/${SID}/claims/d`), { pinHash: hash(SID, '9999'), at: 1 }));
});

test('students cannot change their own PIN or class after joining', async () => {
  await join(device('a'), 'a');
  await assertFails(updateDoc(sref(device('a')), { pin: '0000', pinHash: hash(SID, '0000') }));
  await assertFails(updateDoc(sref(device('a')), { class: '1F' }));
});

test('prototype images: owner adds and deletes, teacher reads, others blocked', async () => {
  const db = device('a');
  await join(db, 'a');
  await assertSucceeds(setDoc(sref(db, '/images/i1'), img()));
  await assertFails(setDoc(sref(db, '/images/i2'), img({ data: 'javascript:alert(1)' })));
  await assertFails(setDoc(sref(db, '/images/i3'), img({ data: 'data:image/jpeg;base64,' + 'A'.repeat(900001) })));
  await assertFails(setDoc(sref(db, '/images/i4'), img({ source: 'upload-anything' })));
  await assertSucceeds(getDocs(collection(teacher(), `workshops/${CODE}/students/${SID}/images`)));
  await assertFails(getDoc(sref(device('b'), '/images/i1')));
  await assertFails(setDoc(sref(device('b'), '/images/i5'), img()));
  await assertSucceeds(deleteDoc(sref(db, '/images/i1')));
});

test('peer feedback notes: owner device writes, cannot delete; teacher can', async () => {
  const db = device('a');
  await join(db, 'a');
  await assertSucceeds(setDoc(sref(db, '/feedback/n1'), note()));
  await assertFails(setDoc(sref(db, '/feedback/n2'), note({ like: '', wish: '', whatif: '' })));
  await assertFails(setDoc(sref(db, '/feedback/n3'), note({ use: 'definitely' })));
  await assertFails(setDoc(sref(device('b'), '/feedback/n4'), note()));
  await assertFails(deleteDoc(sref(db, '/feedback/n1')));
  await assertSucceeds(deleteDoc(sref(teacher(), '/feedback/n1')));
});

test('school settings: everyone signed in reads, only admins write', async () => {
  await assertSucceeds(setDoc(doc(admin(), 'settings/school'), { teachers: ['Mr Lloyd Goh', 'Ms Sabrina Tay'], updatedBy: 'admin@school.test', updatedAt: 1 }));
  await assertSucceeds(getDoc(doc(device('a'), 'settings/school')));
  await assertFails(setDoc(doc(teacher(), 'settings/school'), { teachers: ['Me'] }));
  await assertFails(setDoc(doc(device('a'), 'settings/school'), { teachers: ['Me'] }));
});

test('teachers can set their own display name but not their role', async () => {
  await assertSucceeds(updateDoc(doc(teacher(), 'teachers/teacher@school.test'), { name: 'Ms Sabrina Tay' }));
  await assertFails(updateDoc(doc(teacher(), 'teachers/teacher@school.test'), { role: 'admin' }));
  await assertFails(updateDoc(doc(teacher(), 'teachers/admin@school.test'), { name: 'x' }));
});

test('custom workshop codes must be 4-12 capital letters or digits', async () => {
  const w = { name: 'Demo', track: 'code', open: true, createdAt: 1, createdBy: 'teacher@school.test' };
  await assertSucceeds(setDoc(doc(teacher(), 'workshops/ESSS26'), w));
  await assertFails(setDoc(doc(teacher(), 'workshops/es-26'), w));
  await assertFails(setDoc(doc(teacher(), 'workshops/ABC'), w));
});

// ---------- team sync, locks, teacher deletes ----------
import { Timestamp } from 'firebase/firestore';

async function joinStudent(uid, sid, name, klass, team, pin = '1111') {
  const db = device(uid);
  const batch = writeBatch(db);
  batch.set(doc(db, `workshops/${CODE}/students/${sid}`), {
    name, team, level: 1, class: klass, teacher: 'Mr Lloyd Goh', pin, pinHash: hash(sid, pin), createdAt: 1, progress: {}, lastActive: 1,
  });
  batch.set(doc(db, `workshops/${CODE}/students/${sid}/claims/${uid}`), { pinHash: hash(sid, pin), at: 1 });
  await batch.commit();
  return db;
}
const tpath = (key, sub = '') => `workshops/${CODE}/teams/${key}${sub}`;
const member = (db, key, uid, sid, name) => setDoc(doc(db, tpath(key, `/members/${uid}`)), { sid, name, at: 1 });

test('teammates share a team journal; other teams cannot see it', async () => {
  const a = await joinStudent('a', 't1-aisha', 'Aisha', '1A', 1);
  const b = await joinStudent('b', 't1-ben', 'Ben', '1A', 1);
  const c = await joinStudent('c', 't1-cara', 'Cara', '1B', 1);
  await assertSucceeds(member(a, '1A-t1', 'a', 't1-aisha', 'Aisha'));
  await assertSucceeds(member(b, '1A-t1', 'b', 't1-ben', 'Ben'));
  await assertSucceeds(setDoc(doc(a, tpath('1A-t1', '/entries/define')), { kind: 'stage', stage: 'define', answers: { hmw: 'from Aisha' }, updatedAt: 1 }, { merge: true }));
  await assertSucceeds(setDoc(doc(b, tpath('1A-t1', '/entries/define')), { kind: 'stage', stage: 'define', answers: { why: 'from Ben' }, updatedAt: 1 }, { merge: true }));
  const snap = await getDoc(doc(a, tpath('1A-t1', '/entries/define')));
  if (snap.data().answers.hmw !== 'from Aisha' || snap.data().answers.why !== 'from Ben') throw new Error('merge lost a field');
  await assertSucceeds(getDocs(collection(b, tpath('1A-t1', '/members'))));
  // Cara is in 1B: she can't join 1A-t1 or read it.
  await assertFails(member(c, '1A-t1', 'c', 't1-cara', 'Cara'));
  await assertFails(getDoc(doc(c, tpath('1A-t1', '/entries/define'))));
  await assertSucceeds(member(c, '1B-t1', 'c', 't1-cara', 'Cara'));
  await assertSucceeds(getDocs(collection(teacher(), tpath('1A-t1', '/entries'))));
});

test('cannot join a team with a journal you do not own or a fake name', async () => {
  await joinStudent('a', 't1-aisha', 'Aisha', '1A', 1);
  const x = device('x');
  await assertFails(member(x, '1A-t1', 'x', 't1-aisha', 'Aisha'));
  const b = await joinStudent('b', 't1-ben', 'Ben', '1A', 1);
  await assertFails(member(b, '1A-t1', 'b', 't1-ben', 'Aisha'));
  await assertFails(member(b, '1A-t1', 'a', 't1-ben', 'Ben'));
});

test('answer locks: one teammate at a time, stale locks can be taken over', async () => {
  const a = await joinStudent('a', 't1-aisha', 'Aisha', '1A', 1);
  const b = await joinStudent('b', 't1-ben', 'Ben', '1A', 1);
  await member(a, '1A-t1', 'a', 't1-aisha', 'Aisha');
  await member(b, '1A-t1', 'b', 't1-ben', 'Ben');
  const lock = (db, uid, name) => setDoc(doc(db, tpath('1A-t1', '/locks/define__hmw')), { uid, name, at: serverTimestamp() });
  await assertSucceeds(lock(a, 'a', 'Aisha'));
  await assertSucceeds(lock(a, 'a', 'Aisha')); // heartbeat
  await assertFails(lock(b, 'b', 'Ben'));
  await assertFails(deleteDoc(doc(b, tpath('1A-t1', '/locks/define__hmw'))));
  await assertFails(setDoc(doc(b, tpath('1A-t1', '/locks/define__why')), { uid: 'a', name: 'Aisha', at: serverTimestamp() }));
  await assertSucceeds(deleteDoc(doc(a, tpath('1A-t1', '/locks/define__hmw'))));
  await assertSucceeds(lock(b, 'b', 'Ben'));
  // A lock left behind 2 minutes ago can be taken over.
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), tpath('1A-t1', '/locks/define__why')), { uid: 'a', name: 'Aisha', at: Timestamp.fromMillis(Date.now() - 120000) }));
  await assertSucceeds(setDoc(doc(b, tpath('1A-t1', '/locks/define__why')), { uid: 'b', name: 'Ben', at: serverTimestamp() }));
});

test('teachers delete student records; only admins delete workshops', async () => {
  const a = await joinStudent('a', 't1-aisha', 'Aisha', '1A', 1);
  await member(a, '1A-t1', 'a', 't1-aisha', 'Aisha');
  await setDoc(doc(a, `workshops/${CODE}/students/t1-aisha/entries/define`), entry());
  await assertFails(deleteDoc(doc(a, `workshops/${CODE}/students/t1-aisha`)));
  const t = teacher();
  await assertSucceeds(deleteDoc(doc(t, `workshops/${CODE}/students/t1-aisha/entries/define`)));
  await assertSucceeds(deleteDoc(doc(t, `workshops/${CODE}/students/t1-aisha/claims/a`)));
  await assertSucceeds(deleteDoc(doc(t, tpath('1A-t1', '/members/a'))));
  await assertSucceeds(deleteDoc(doc(t, `workshops/${CODE}/students/t1-aisha`)));
  await assertFails(deleteDoc(doc(t, `workshops/${CODE}`)));
  await assertSucceeds(deleteDoc(doc(admin(), `workshops/${CODE}`)));
});

test('teachers can list and clear answer locks when deleting', async () => {
  const a = await joinStudent('a', 't1-aisha', 'Aisha', '1A', 1);
  await member(a, '1A-t1', 'a', 't1-aisha', 'Aisha');
  await setDoc(doc(a, tpath('1A-t1', '/locks/define__hmw')), { uid: 'a', name: 'Aisha', at: serverTimestamp() });
  await assertSucceeds(getDocs(collection(teacher(), tpath('1A-t1', '/locks'))));
  await assertSucceeds(deleteDoc(doc(teacher(), tpath('1A-t1', '/locks/define__hmw'))));
  await assertFails(getDocs(collection(device('z'), tpath('1A-t1', '/locks'))));
});
