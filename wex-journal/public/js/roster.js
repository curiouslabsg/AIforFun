// Reads name lists (CSV or Excel) into companies: students pick their company, then their name.
// Columns are matched loosely: "Company" (or the older "Teaching group"), "Name", optional "Class" and "Level".
// Other columns are ignored. If a file has no company column, the sheet name (or file name) is used.
// Level is Sec 3 unless a Level column (or a class like "3A") says otherwise.

const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = XLSX_URL;
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('Could not load the spreadsheet reader. Check the internet connection.'));
    document.head.append(s);
  });
}

const COLS = {
  tg: /^(company|companies|organisation|organization|placement|teaching\s*group|tg|t\.?g\.?|group|teaching grp)$/i,
  name: /^(student\s*)?(full\s*)?name$|^name\s*of\s*student$/i,
  cls: /^(form\s*)?class$|^cls$|^form$/i,
  level: /^(level|sec|secondary|lvl)$/i,
};

// Group ids must be safe as Firestore doc ids and team keys: letters, digits, spaces, hyphens.
export function cleanGroup(v) {
  return String(v ?? '').trim().replace(/[^A-Za-z0-9 -]+/g, '-').replace(/\s+/g, ' ').replace(/^-+|-+$/g, '').slice(0, 30);
}

function levelFrom(...vals) {
  for (const v of vals) {
    const m = String(v ?? '').match(/[1-5]/);
    if (m && /^\D*[1-5]/.test(String(v))) return Number(m[0]);
  }
  return null;
}

function sheetRows(XLSX, ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
}

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i].map((c) => String(c).trim());
    const idx = {};
    cells.forEach((c, j) => {
      for (const [k, re] of Object.entries(COLS)) if (idx[k] === undefined && re.test(c)) idx[k] = j;
    });
    if (idx.name !== undefined) return { row: i, idx };
  }
  return null;
}

// Returns { rows: [{ tg, name, cls, level, teacher, source, error }], problems: [string] }
export async function parseRosterFiles(files) {
  const XLSX = await loadXlsx();
  const rows = [];
  const problems = [];
  for (const file of files) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const baseName = file.name.replace(/\.[^.]+$/, '');
    for (const sheetName of wb.SheetNames) {
      const data = sheetRows(XLSX, wb.Sheets[sheetName]);
      if (!data.length) continue;
      const head = findHeader(data);
      if (!head) {
        problems.push(`${file.name} › ${sheetName}: no "Name" column found, so this sheet was skipped.`);
        continue;
      }
      const fallbackTg = wb.SheetNames.length > 1 ? sheetName : baseName;
      for (const r of data.slice(head.row + 1)) {
        const get = (k) => (head.idx[k] === undefined ? '' : String(r[head.idx[k]] ?? '').trim());
        const name = get('name').replace(/\s+/g, ' ');
        if (!name) continue;
        const tg = cleanGroup(get('tg') || fallbackTg);
        const cls = get('cls');
        const level = levelFrom(get('level'), cls) ?? 3;
        const row = { tg, name, cls, level, source: `${file.name}${wb.SheetNames.length > 1 ? ` › ${sheetName}` : ''}` };
        if (!tg) row.error = 'No company';
        else if (name.length > 60) row.error = 'Name longer than 60 characters';
        rows.push(row);
      }
    }
  }
  // Duplicate names within a group would share one journal, so flag them.
  const seen = new Set();
  for (const r of rows) {
    const k = `${r.tg}|${r.name.toLowerCase()}`;
    if (seen.has(k) && !r.error) r.error = 'Same name twice in this group';
    seen.add(k);
  }
  return { rows, problems };
}

// { tg: { level, students[], classes{} } } from the valid rows.
export function groupRows(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (r.error) continue;
    if (!groups.has(r.tg)) groups.set(r.tg, { level: r.level, students: [], classes: {} });
    const g = groups.get(r.tg);
    g.students.push(r.name);
    if (r.cls) g.classes[r.name] = r.cls;
  }
  return groups;
}

export const TEMPLATE_CSV = 'Company,Name,Class\nMicron,Aisha Tan,3A\nMicron,Ben Lim,3B\nInfineon,Cara Ng,3C\n';
