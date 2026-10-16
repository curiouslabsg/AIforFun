import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, connectFirestoreEmulator, persistentLocalCache, persistentSingleTabManager, memoryLocalCache,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

export const configured = !String(firebaseConfig.apiKey).startsWith('REPLACE_ME');

// `firebase emulators:start` serves the site on localhost. There, always use the local
// emulators and a demo project, so testing can never touch the live database.
const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
// The journal and the dashboard use separately named apps, so each keeps its own sign-in.
const isTeacherApp = document.documentElement.dataset.app === 'teacher';
const app = initializeApp(local || !configured ? { apiKey: 'demo', projectId: 'demo-wex', authDomain: 'localhost' } : firebaseConfig, isTeacherApp ? 'teacher' : 'student');
export const auth = getAuth(app);

// Students write at their workplace, often on patchy mobile data: keep a copy on the phone so
// answers and photos save straight away and upload when the signal comes back.
function cache() {
  if (isTeacherApp) return memoryLocalCache();
  try { return persistentLocalCache({ tabManager: persistentSingleTabManager() }); } catch { return memoryLocalCache(); }
}
export const db = initializeFirestore(app, { localCache: cache() });

if (local) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9199', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8180);
}

const slug = (v) => String(v).trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Student id from the class list: teaching group + name, e.g. "sc3a1--aisha-tan".
export function rosterSid(tg, name) {
  return `${slug(tg)}--${slug(name)}`;
}

export async function pinHash(sid, pin) {
  const bytes = new TextEncoder().encode(`${sid}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Tiny DOM helper shared by the journal and the dashboard.
export function h(tag, props = {}, ...children) {
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
