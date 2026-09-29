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
    await setDoc(doc(db, 'teachers/teacher@school.test'), { name: 'T' });
    await setDoc(doc(db, `workshops/${CODE}`), { name: '1E1', track: 'code', open: true, createdAt: 1, createdBy: 'teacher@school.test' });
  });
});

async function join(db, uid, sid = SID, pin = PIN) {
  const batch = writeBatch(db);
  batch.set(doc(db, `workshops/${CODE}/students/${sid}`), {
    name: 'Aisha R', team: 3, pinHash: hash(sid, pin), createdAt: serverTimestamp(), progress: {}, lastActive: serverTimestamp(),
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
  await assertFails(setDoc(doc(other, `workshops/${CODE}/students/${SID}`), { name: 'x', team: 3, pinHash: hash(SID, '0000'), createdAt: 1, progress: {} }));
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
