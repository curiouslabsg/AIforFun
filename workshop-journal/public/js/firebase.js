import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

export const configured = !String(firebaseConfig.apiKey).startsWith('REPLACE_ME');

// `firebase emulators:start` serves the site on localhost. There, always use the local
// emulators and a demo project, so testing can never touch the live database.
const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
// The student journal and the teacher dashboard use separately named apps, so each keeps
// its own sign-in. Otherwise opening the journal in a teacher's browser would replace the
// teacher's Google sign-in with an anonymous student one and log the teacher out.
const appName = document.documentElement.dataset.app === 'teacher' ? 'teacher' : 'student';
const app = initializeApp(local || !configured ? { apiKey: 'demo', projectId: 'demo-journal', authDomain: 'localhost' } : firebaseConfig, appName);
export const auth = getAuth(app);
export const db = getFirestore(app);

if (local) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

// Student ids are readable and stable so the same name + team finds the same journal.
export function studentId(team, name) {
  const slug = name.trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `t${team}-${slug}`;
}

export async function pinHash(sid, pin) {
  const bytes = new TextEncoder().encode(`${sid}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function normaliseCode(raw) {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}
