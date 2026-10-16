// The EAE portfolio: one printable page built from a student's journal.
// Used by the student journal and by the teacher dashboard.
import { h } from './firebase.js';
import { SKILLS, MOODS, INTERVIEW } from './wex.js';

const text = (v) => String(v ?? '').trim();
const para = (v, cls = '') => h('p', { class: `pf-text ${cls}` }, text(v));

// data: { student, cohort, answers: { section: { promptId: value } }, photos: [...] }
// opts.goTo(sectionId) adds "write it" links for missing answers (student view only).
export function renderPortfolio(data, opts = {}) {
  const { student, cohort } = data;
  const a = (section, id) => text(data.answers?.[section]?.[id]);
  const days = Array.from({ length: cohort?.days ?? 5 }, (_, i) => `day${i + 1}`);
  const missing = (section, label) => h('p', { class: 'pf-missing' }, 'Not written yet. ',
    opts.goTo ? h('button', { type: 'button', class: 'linkish', onclick: () => opts.goTo(section) }, `Go to ${label} →`) : null);

  // Skills: how many days each was used, plus the stories that show it.
  const tally = new Map();
  for (const d of days) for (const s of a(d, 'skills').split(',').map(text).filter(Boolean)) tally.set(s, (tally.get(s) ?? 0) + 1);
  for (const n of [1, 2, 3]) for (const s of a(`star${n}`, 'shows').split(',').map(text).filter(Boolean)) if (!tally.has(s)) tally.set(s, 0);
  const skills = [...tally].sort((x, y) => y[1] - x[1] || SKILLS.indexOf(x[0]) - SKILLS.indexOf(y[0]));

  // Photos: the ones marked for the portfolio, otherwise the first from each day.
  const dayOrder = (p) => (p.section === 'placement' ? 0 : Number(p.section.slice(3)));
  let photos = data.photos.filter((p) => p.star);
  if (!photos.length) photos = days.map((d) => data.photos.find((p) => p.section === d)).filter(Boolean);
  photos = photos.sort((x, y) => dayOrder(x) - dayOrder(y)).slice(0, 6);

  const star = (n) => {
    const sec = `star${n}`;
    if (!['s', 't', 'a', 'r'].some((k) => a(sec, k))) return missing(sec, `Story ${n}`);
    return h('div', { class: 'pf-star' },
      a(sec, 'title') ? h('b', {}, a(sec, 'title')) : null,
      ...[['s', 'Situation'], ['t', 'Task'], ['a', 'Action'], ['r', 'Result']].filter(([k]) => a(sec, k))
        .map(([k, label]) => h('p', { class: 'pf-text' }, h('span', { class: 'pf-k' }, `${label}: `), a(sec, k))),
      a(sec, 'shows') ? h('p', { class: 'small muted' }, `Shows: ${a(sec, 'shows').split(',').join(', ')}`) : null);
  };

  const answerFor = (item) => {
    if (item.star) return star(item.star);
    if (item.learnt) {
      const items = days.map((d, i) => [i + 1, a(d, 'learnt')]).filter(([, v]) => v);
      return items.length ? h('ul', { class: 'pf-list' }, ...items.map(([n, v]) => h('li', {}, h('span', { class: 'pf-k' }, `Day ${n}: `), v))) : missing('day1', 'Day 1');
    }
    const found = item.from.map(([s, id]) => a(s, id)).filter(Boolean);
    return found.length ? h('div', {}, ...found.map((v) => para(v))) : missing(item.from[0][0], 'Wrap-up');
  };

  const company = a('placement', 'company');
  const where = [a('placement', 'dept'), company, a('placement', 'industry')].filter(Boolean).join(' · ');
  const moods = days.map((d) => MOODS.find((m) => m.v === a(d, 'mood'))?.face ?? '·');

  return h('article', { class: 'portfolio' },
    h('header', { class: 'pf-head' },
      h('span', { class: 'label' }, `Work experience portfolio${cohort?.name ? ` · ${cohort.name}` : ''}`),
      h('h1', {}, student.name),
      h('p', { class: 'pf-where' }, where || 'Placement not filled in yet'),
      h('p', { class: 'small muted' }, [student.class, a('placement', 'supervisor') && `Supervisor: ${a('placement', 'supervisor')}`, `Mood by day: ${moods.join(' ')}`].filter(Boolean).join(' · '))),

    h('section', { class: 'pf-sec pf-pitch' }, h('h2', {}, 'My 30-second story'),
      a('wrapup', 'pitch') ? para(a('wrapup', 'pitch'), 'big') : missing('wrapup', 'Wrap-up')),

    photos.length ? h('section', { class: 'pf-sec' }, h('h2', {}, 'Highlights'),
      h('div', { class: 'pf-photos' }, ...photos.map((p) => h('figure', {},
        h('img', { src: p.data, alt: p.caption || 'Work experience photo' }),
        h('figcaption', {}, h('b', {}, p.section === 'placement' ? 'Placement' : `Day ${p.section.slice(3)}`), p.caption ? ` · ${p.caption}` : ''))))) : null,

    h('section', { class: 'pf-sec' }, h('h2', {}, 'Skills I showed'),
      skills.length
        ? h('div', { class: 'pf-skills' }, ...skills.map(([s, n]) => h('span', { class: 'pf-skill' }, s, n ? h('small', {}, ` ${n} ${n === 1 ? 'day' : 'days'}`) : null)))
        : missing('day1', 'Day 1'),
      ...days.map((d, i) => [i + 1, a(d, 'example')]).filter(([, v]) => v).slice(0, 3)
        .map(([n, v]) => h('p', { class: 'pf-text small' }, h('span', { class: 'pf-k' }, `Day ${n}: `), v))),

    h('section', { class: 'pf-sec' }, h('h2', {}, 'Interview practice'),
      h('p', { class: 'small muted' }, 'Common EAE questions, with your own answers from this journal. Practise saying them out loud.'),
      ...INTERVIEW.map((item) => h('div', { class: 'pf-q' }, h('h3', {}, item.q), answerFor(item)))),

    h('section', { class: 'pf-sec' }, h('h2', {}, 'Day by day'),
      ...days.map((d, i) => {
        const did = a(d, 'did');
        const moment = a(d, 'moment');
        if (!did && !moment) return null;
        return h('div', { class: 'pf-day' }, h('b', {}, `Day ${i + 1}`), did ? para(did) : null,
          moment ? h('p', { class: 'pf-text' }, h('span', { class: 'pf-k' }, 'High point / challenge: '), moment) : null);
      })),

    text(student.teacherNote) ? h('section', { class: 'pf-sec pf-note' }, h('h2', {}, 'Teacher’s note'), para(student.teacherNote)) : null,
    h('footer', { class: 'small muted pf-foot' }, `WEX Journal · ${new Date().toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })}`),
  );
}

