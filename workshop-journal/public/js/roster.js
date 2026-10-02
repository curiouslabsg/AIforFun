// Reads class lists (CSV or Excel) into teaching groups.
// Columns are matched loosely: "Teaching group"/"TG", "Name", "Class", optional "Level", "Teacher".
// If a file has no teaching group column, the sheet name (or file name) is used as the group.

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
  tg: /^(teaching\s*group|tg|t\.?g\.?|group|teaching grp)$/i,
  name: /^(student\s*)?(full\s*)?name$|^name\s*of\s*student$/i,
  cls: /^(form\s*)?class$|^cls$|^form$/i,
  level: /^(level|sec|secondary|lvl)$/i,
  teacher: /^(teacher|tg\s*teacher|subject\s*teacher|form\s*teacher)$/i,
};

// Group ids must be safe as Firestore doc ids and team keys: letters, digits, spaces, hyphens.
export function cleanGroup(v) {
  return String(v ?? '').trim().replace(/[^A-Za-z0-9 -]+/g, '-').replace(/\s+/g, ' ').replace(/^-+|-+$/g, '').slice(0, 30);
}

function levelFrom(...vals) {
  for (const v of vals) {
    const m = String(v ?? '').match(/[12]/);
    if (m && /^\D*[12]/.test(String(v))) return Number(m[0]);
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
        const level = levelFrom(get('level'), cls, tg);
        const row = { tg, name, cls, level, teacher: get('teacher'), source: `${file.name}${wb.SheetNames.length > 1 ? ` › ${sheetName}` : ''}` };
        if (!tg) row.error = 'No teaching group';
        else if (!level) row.error = 'Level unknown (add a Level column with 1 or 2)';
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

// { tg: { level, students[], classes{}, teachers{} } } from the valid rows.
export function groupRows(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (r.error) continue;
    if (!groups.has(r.tg)) groups.set(r.tg, { level: r.level, students: [], classes: {}, teachers: {} });
    const g = groups.get(r.tg);
    g.students.push(r.name);
    if (r.cls) g.classes[r.name] = r.cls;
    if (r.teacher) g.teachers[r.name] = r.teacher;
  }
  return groups;
}

export const TEMPLATE_CSV = 'Teaching group,Name,Class,Level,Teacher\n1-TG1,Aisha Tan,1A,1,Mr Lloyd Goh\n1-TG1,Ben Lim,1B,1,Mr Lloyd Goh\n2-TG1,Cara Ng,2C,2,Ms Sabrina Tay\n';
