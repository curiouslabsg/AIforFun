// The EAE portfolio: one printable page built from a student's journal.
// Used by the student journal and by the teacher dashboard.
import { h } from './firebase.js';
import { MOODS, INTERVIEW, REFLECTION } from './wex.js';
import { companyLogo } from './logo.js';

const text = (v) => String(v ?? '').trim();
const para = (v, cls = '') => h('p', { class: `pf-text ${cls}` }, text(v));

// data: { student, cohort, answers: { section: { promptId: value } } }
// opts.goTo(sectionId) adds "write it" links for missing answers (student view only).
export function renderPortfolio(data, opts = {}) {
  const { student, cohort } = data;
  const a = (section, id) => text(data.answers?.[section]?.[id]);
  const days = Array.from({ length: cohort?.days ?? 5 }, (_, i) => `day${i + 1}`);
  const missing = (section, label) => h('p', { class: 'pf-missing' }, 'Not written yet. ',
    opts.goTo ? h('button', { type: 'button', class: 'linkish', onclick: () => opts.goTo(section) }, `Go to ${label} →`) : null);

  // One reflection question's answers from every day, newest last.
  const byDay = (qid) => days.map((d, i) => [i + 1, a(d, qid)]).filter(([, v]) => v);
  const dayList = (items) => h('ul', { class: 'pf-list' }, ...items.map(([n, v]) => h('li', {}, h('span', { class: 'pf-k' }, `Day ${n}: `), v)));

  const answerFor = (item) => {
    const found = (item.from ?? []).map(([s, id]) => a(s, id)).filter(Boolean);
    const daily = item.days ? byDay(item.days) : [];
    if (!found.length && !daily.length) return missing(item.from?.[0][0] ?? 'day1', item.from ? 'Wrap-up' : 'Day 1');
    return h('div', {}, ...found.map((v) => para(v)), daily.length ? dayList(daily) : null);
  };

  const company = a('placement', 'company') || text(student.class);
  const where = [a('placement', 'dept'), company, a('placement', 'industry')].filter(Boolean).join(' · ');
  const moods = days.map((d) => MOODS.find((m) => m.v === a(d, 'mood'))?.face ?? '·');

  return h('article', { class: 'portfolio' },
    h('header', { class: 'pf-head' },
      companyLogo({ name: company, site: a('placement', 'website'), logoUrl: a('placement', 'logoUrl') }, 'pf-logo'),
      h('span', { class: 'label' }, `Work experience portfolio${cohort?.name ? ` · ${cohort.name}` : ''}`),
      h('h1', {}, student.name),
      h('p', { class: 'pf-where' }, where || 'Placement not filled in yet'),
      h('p', { class: 'small muted' }, [a('placement', 'supervisor') && `Supervisor: ${a('placement', 'supervisor')}`, `Mood by day: ${moods.join(' ')}`].filter(Boolean).join(' · '))),

    h('section', { class: 'pf-sec pf-pitch' }, h('h2', {}, 'My 30-second story'),
      a('wrapup', 'pitch') ? para(a('wrapup', 'pitch'), 'big') : missing('wrapup', 'Wrap-up')),

    h('section', { class: 'pf-sec' }, h('h2', {}, 'Interview practice'),
      h('p', { class: 'small muted' }, 'Common EAE questions, with your own answers from this journal. Practise saying them out loud.'),
      ...INTERVIEW.map((item) => h('div', { class: 'pf-q' }, h('h3', {}, item.q), answerFor(item)))),

    h('section', { class: 'pf-sec' }, h('h2', {}, 'Day by day'),
      ...days.map((d, i) => {
        const done = REFLECTION.filter((q) => a(d, q.id));
        if (!done.length) return null;
        return h('div', { class: 'pf-day' }, h('b', {}, `Day ${i + 1}`),
          ...done.map((q) => h('p', { class: 'pf-text' }, h('span', { class: 'pf-k' }, `${q.q} `), a(d, q.id))));
      })),

    text(student.teacherNote) ? h('section', { class: 'pf-sec pf-note' }, h('h2', {}, 'Teacher’s note'), para(student.teacherNote)) : null,
    h('footer', { class: 'small muted pf-foot' }, `Work Experience Journal · ${new Date().toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })}`),
  );
}
