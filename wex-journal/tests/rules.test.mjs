// Run with: npm test  (starts the Firestore emulator and runs this file)
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, writeBatch, serverTimestamp, Timestamp,
} from 'firebase/firestore';

const CODE = 'WEX26';
const SID = 'sc3a1--aisha-tan';
const PIN = '4821';
const hash = (sid, pin) => createHash('sha256').update(`${sid}:${pin}`).digest('hex');
const JPEG = `data:image/jpeg;base64,${'A'.repeat(1000)}`;

let env;
const teacher = () => env.authenticatedContext('teacher', { email: 'teacher@school.test', email_verified: true }).firestore();
const admin = () => env.authenticatedContext('admin', { email: 'admin@school.test', email_verified: true }).firestore();
const stranger = () => env.authenticatedContext('stranger', { email: 'someone@else.test', email_verified: true }).firestore();
const device = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const S = (sub = '') => `cohorts/${CODE}/students/${SID}${sub}`;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-wex-rules',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8180 },
  });
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'teachers/teacher@school.test'), { name: 'T', role: 'teacher' });
    await setDoc(doc(db, 'teachers/admin@school.test'), { name: 'A', role: 'admin' });
    await setDoc(doc(db, `cohorts/${CODE}`), { name: 'Sec 3 WEX', days: 5, open: true, createdAt: 1, createdBy: 'admin@school.test' });
    await setDoc(doc(db, 'roster/SC3A1'), { level: 3, students: ['Aisha Tan', 'Ben Lim'] });
  });
});

function join(db, uid, { sid = SID, name = 'Aisha Tan', tg = 'SC3A1', level = 3, pin = PIN } = {}) {
  const batch = writeBatch(db);
  batch.set(doc(db, `cohorts/${CODE}/students/${sid}`), {
    name, level, class: tg, pin, pinHash: hash(sid, pin), createdAt: serverTimestamp(), progress: {}, lastActive: serverTimestamp(),
  });
  batch.set(doc(db, `cohorts/${CODE}/students/${sid}/claims/${uid}`), { pinHash: hash(sid, pin), at: serverTimestamp() });
  return batch.commit();
}
const entry = (section, answers = { did: 'Helped at the counter' }) => ({ section, answers, createdAt: 1, updatedAt: 1 });
const photo = (extra = {}) => ({ section: 'day1', caption: 'My desk', data: JPEG, star: false, createdAt: 1, ...extra });
const closeCohort = () => env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), `cohorts/${CODE}`), { open: false }));

test('nobody signed out can read anything', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, `cohorts/${CODE}`)));
  await assertFails(getDocs(collection(db, 'roster')));
});

test('a student joins only with a name on the class list', async () => {
  await assertSucceeds(join(device('a'), 'a'));
  await assertFails(join(device('b'), 'b', { sid: 'sc3a1--zed', name: 'Zed' }));
  await assertFails(join(device('c'), 'c', { sid: 'sc3a1--ben-lim', name: 'Ben Lim', level: 2 }));
  await assertFails(join(device('d'), 'd', { sid: 'x--ben-lim', name: 'Ben Lim', tg: 'NOPE' }));
  await assertFails(getDocs(collection(device('a'), `cohorts/${CODE}/students`)));
  await assertFails(getDocs(collection(device('a'), 'cohorts')));
});

test('the owner writes sections and photos; other devices cannot read them', async () => {
  const a = device('a');
  await join(a, 'a');
  await assertSucceeds(setDoc(doc(a, S('/entries/day1')), entry('day1')));
  await assertSucceeds(setDoc(doc(a, S('/entries/star2')), entry('star2', { s: 'x' })));
  await assertSucceeds(setDoc(doc(a, S('/entries/wrapup')), entry('wrapup', { pitch: 'x' })));
  await assertSucceeds(setDoc(doc(a, S('/photos/p1')), photo()));
  await assertSucceeds(setDoc(doc(a, S('/photos/logo1')), photo({ section: 'logo' })));
  await assertSucceeds(updateDoc(doc(a, S('/photos/p1')), { caption: 'Front desk', star: true }));
  await assertSucceeds(updateDoc(doc(a, S()), { progress: { day1: 3 }, company: 'Clinic', industry: 'Healthcare', photoCount: 1 }));
  // Bad section names, mismatched section field, other file types, oversized photos.
  await assertFails(setDoc(doc(a, S('/entries/day11')), entry('day11')));
  await assertFails(setDoc(doc(a, S('/entries/notes')), entry('notes')));
  await assertFails(setDoc(doc(a, S('/entries/day2')), entry('day1')));
  await assertFails(setDoc(doc(a, S('/photos/p2')), photo({ data: 'data:image/png;base64,AAAA' })));
  await assertFails(setDoc(doc(a, S('/photos/p3')), photo({ data: `data:image/jpeg;base64,${'A'.repeat(900001)}` })));
  await assertFails(setDoc(doc(a, S('/photos/p4')), photo({ section: 'star1' })));
  await assertFails(updateDoc(doc(a, S('/photos/p1')), { data: `data:image/jpeg;base64,${'B'.repeat(1000)}` }));
  // Students can't change their own name, PIN or teacher note.
  await assertFails(updateDoc(doc(a, S()), { name: 'Someone' }));
  await assertFails(updateDoc(doc(a, S()), { teacherNote: 'Great job' }));
  // A second device without the PIN sees nothing.
  const b = device('b');
  await assertFails(getDoc(doc(b, S())));
  await assertFails(getDoc(doc(b, S('/entries/day1'))));
  await assertFails(getDoc(doc(b, S('/photos/p1'))));
  await assertFails(setDoc(doc(b, S('/entries/day2')), entry('day2')));
});

test('a new phone gets in with the right PIN, even after the cohort closes', async () => {
  await join(device('a'), 'a');
  const b = device('b');
  await assertFails(setDoc(doc(b, S('/claims/b')), { pinHash: hash(SID, '0000'), at: 1 }));
  await assertFails(setDoc(doc(b, S('/claims/c')), { pinHash: hash(SID, PIN), at: 1 }));
  await closeCohort();
  // Next year, for the EAE interview: read-only access from a new device.
  await assertSucceeds(setDoc(doc(b, S('/claims/b')), { pinHash: hash(SID, PIN), at: 1 }));
  await assertSucceeds(getDoc(doc(b, S())));
  await assertSucceeds(getDocs(collection(b, S('/photos'))));
  await assertFails(setDoc(doc(b, S('/entries/day1')), entry('day1')));
  await assertFails(setDoc(doc(b, S('/photos/p9')), photo()));
});

test('teachers read journals, reset PINs, leave a note and delete; admins run cohorts', async () => {
  const a = device('a');
  await join(a, 'a');
  await setDoc(doc(a, S('/photos/p1')), photo());
  const t = teacher();
  await assertSucceeds(getDocs(collection(t, `cohorts/${CODE}/students`)));
  await assertSucceeds(getDocs(collection(t, S('/photos'))));
  await assertSucceeds(updateDoc(doc(t, S()), { pin: '1234', pinHash: hash(SID, '1234') }));
  await assertSucceeds(updateDoc(doc(t, S()), { teacherNote: 'Strong STAR stories.', noteBy: 'teacher@school.test', noteAt: 1 }));
  await assertFails(updateDoc(doc(t, S()), { teacherNote: 'x'.repeat(1501) }));
  await assertFails(updateDoc(doc(t, S()), { name: 'Renamed' }));
  await assertSucceeds(getDoc(doc(a, S())));
  // Cohorts and the active list are admin-only.
  await assertFails(setDoc(doc(t, 'cohorts/NEW1'), { name: 'x', days: 5, open: true, createdAt: 1, createdBy: 'teacher@school.test' }));
  await assertSucceeds(setDoc(doc(admin(), 'cohorts/NEW1'), { name: 'x', days: 5, open: true, createdAt: 1, createdBy: 'admin@school.test' }));
  await assertFails(setDoc(doc(admin(), 'cohorts/NEW2'), { name: 'x', days: 11, open: true, createdAt: 1, createdBy: 'admin@school.test' }));
  await assertFails(updateDoc(doc(t, `cohorts/${CODE}`), { open: false }));
  await assertSucceeds(updateDoc(doc(admin(), `cohorts/${CODE}`), { open: false, days: 4 }));
  await assertFails(setDoc(doc(t, 'settings/school'), { activeCohorts: [CODE] }));
  await assertSucceeds(setDoc(doc(admin(), 'settings/school'), { activeCohorts: [CODE, 'NEW1'], updatedBy: 'admin@school.test', updatedAt: 1 }));
  await assertFails(setDoc(doc(admin(), 'settings/school'), { activeCohorts: ['bad code'] }));
  // Teachers delete journals; students can't delete their own record.
  await assertFails(deleteDoc(doc(a, S())));
  await assertSucceeds(deleteDoc(doc(t, S('/photos/p1'))));
  await assertSucceeds(deleteDoc(doc(t, S())));
  // Strangers with an email that isn't on the teacher list get nothing.
  await assertFails(getDocs(collection(stranger(), `cohorts/${CODE}/students`)));
});

test('closed cohorts are read-only for students', async () => {
  const a = device('a');
  await join(a, 'a');
  await setDoc(doc(a, S('/photos/p1')), photo());
  await closeCohort();
  await assertFails(setDoc(doc(a, S('/entries/day1')), entry('day1')));
  await assertFails(updateDoc(doc(a, S('/photos/p1')), { caption: 'late', star: false }));
  await assertFails(deleteDoc(doc(a, S('/photos/p1'))));
  await assertFails(join(device('n'), 'n', { sid: 'sc3a1--ben-lim', name: 'Ben Lim' }));
  await assertSucceeds(getDoc(doc(a, S('/photos/p1'))));
});

test('class lists: students read names only; admins upload', async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'rosterDetails/SC3A1'), { classes: { 'Aisha Tan': '3A' } }));
  await assertSucceeds(getDocs(collection(device('a'), 'roster')));
  await assertFails(getDoc(doc(device('a'), 'rosterDetails/SC3A1')));
  await assertSucceeds(getDoc(doc(teacher(), 'rosterDetails/SC3A1')));
  await assertFails(setDoc(doc(teacher(), 'roster/SC3A2'), { level: 3, students: [] }));
  await assertSucceeds(setDoc(doc(admin(), 'roster/SC3A2'), { level: 3, students: ['Cara'] }));
  await assertFails(setDoc(doc(admin(), 'roster/SC3A2'), { level: 6, students: [] }));
});

test('guest logins stop working after they expire; unverified emails never count', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'teachers/guest1@guest.test'), { role: 'teacher', expiresAt: Timestamp.fromMillis(Date.now() + 86400000) });
    await setDoc(doc(db, 'teachers/guest2@guest.test'), { role: 'teacher', expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  });
  const g = (n) => env.authenticatedContext(`g${n}`, { email: `guest${n}@guest.test`, email_verified: true }).firestore();
  await assertSucceeds(getDocs(collection(g(1), 'cohorts')));
  await assertFails(getDocs(collection(g(2), 'cohorts')));
  const unverified = env.authenticatedContext('u', { email: 'teacher@school.test', email_verified: false }).firestore();
  await assertFails(getDocs(collection(unverified, 'cohorts')));
});

test('admins manage teachers but cannot remove themselves', async () => {
  const a = admin();
  await assertSucceeds(setDoc(doc(a, 'teachers/new@school.test'), { name: 'New', role: 'teacher', addedBy: 'admin@school.test', addedAt: 1 }));
  await assertFails(setDoc(doc(teacher(), 'teachers/x@school.test'), { role: 'admin', addedBy: 'teacher@school.test', addedAt: 1 }));
  await assertFails(deleteDoc(doc(a, 'teachers/admin@school.test')));
  await assertFails(updateDoc(doc(a, 'teachers/admin@school.test'), { role: 'teacher' }));
  await assertSucceeds(updateDoc(doc(teacher(), 'teachers/teacher@school.test'), { name: 'Ms T' }));
  await assertFails(updateDoc(doc(teacher(), 'teachers/teacher@school.test'), { role: 'admin' }));
});
