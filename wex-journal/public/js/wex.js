// The questions students answer. Written so the answers can be reused, almost word for word,
// in an Early Admissions Exercise (EAE) interview a year later.

export const INDUSTRIES = [
  'Healthcare', 'Social service / Eldercare', 'Food & beverage / Hospitality', 'Retail', 'Education / Early childhood', 'Engineering / Manufacturing', 'Law / Legal',
  'IT / Tech', 'Media / Design', 'Business / Finance', 'Public service', 'Logistics / Transport', 'Science / Lab', 'Other',
];

export const MOODS = [
  { v: '1', face: '😫', label: 'Tough' },
  { v: '2', face: '😕', label: 'Meh' },
  { v: '3', face: '🙂', label: 'OK' },
  { v: '4', face: '😀', label: 'Good' },
  { v: '5', face: '🤩', label: 'Great' },
];

// type: text (big box), short (one line), select, chips (pick several), mood.
export const PLACEMENT = {
  id: 'placement', title: 'My placement', icon: 'building', color: '#1d4ed8',
  blurb: 'Fill this in on Day 1.',
  prompts: [
    { id: 'company', type: 'company', q: 'Company or organisation', hint: 'Wrong company? Choose the right one here.', max: 100 },
    { id: 'website', type: 'short', q: 'Company website', hint: 'e.g. starbucks.com.sg (we’ll use its logo)', max: 100, optional: true },
    { id: 'industry', type: 'select', q: 'Industry', options: INDUSTRIES },
    { id: 'dept', type: 'short', q: 'Department or team I am in', hint: 'e.g. Front desk, Kitchen, IT support', max: 100 },
    { id: 'supervisor', type: 'short', q: 'My supervisor’s job title (not their name)', hint: 'e.g. Clinic manager', max: 100 },
    { id: 'hope', type: 'text', q: 'What do I hope to learn or find out this week?' },
    { id: 'why', type: 'text', q: 'Why this placement? How do I feel about it on Day 1?' },
    { id: 'phone', type: 'short', q: 'My contact number', hint: 'e.g. 8123 4567 (only your teachers see it)', max: 20, optional: true },
  ],
};

// A theme and picture for each day of a 5-day run; longer runs repeat "Keep going".
const DAY_THEMES = [
  ['Getting started', 'clipboard'], ['Observe', 'observe'], ['Try', 'bolt'], ['Reflect', 'thought'], ['Look ahead', 'summit'],
];

// The five reflection questions. On most days students answer any 3; on the last day, all 5.
export const REFLECTION = [
  { id: 'q1', type: 'text', q: 'What did I do or observe today?' },
  { id: 'q2', type: 'text', q: 'What did I learn about work? Include a specific example.' },
  { id: 'q3', type: 'text', q: 'What did I discover about my strengths, interests or areas for growth?' },
  { id: 'q4', type: 'text', q: 'What challenged me, and how did I respond or use feedback?' },
  { id: 'q5', type: 'text', q: 'What will I do differently tomorrow?' },
];

// days: how many days this run has, so the last one can ask for all five answers.
export function dayStage(n, days = 5) {
  const [theme, art] = DAY_THEMES[n - 1] ?? ['Keep going', 'bolt'];
  const last = n === days;
  // "What will I do differently tomorrow?" doesn't fit the last day, so it asks the other four.
  const qs = last ? REFLECTION.filter((q) => q.id !== 'q5') : REFLECTION;
  const need = last ? qs.length : 3;
  return {
    id: `day${n}`, title: `Day ${n}`, theme, art, icon: 'sun', color: ['#1d4ed8', '#2563eb', '#0284c7', '#1e40af', '#0369a1'][(n - 1) % 5],
    blurb: last ? 'Last day: answer all four questions.' : 'Choose any 3 of the 5 questions to answer today.',
    last,
    pick: { from: qs.map((q) => q.id), need },
    prompts: [...qs, { id: 'mood', type: 'mood', q: 'How did today feel?', optional: true }],
  };
}

export const WRAPUP = {
  id: 'wrapup', title: 'Wrap-up', icon: 'flag', color: '#1e3a8a',
  blurb: 'On the last day. These become your interview answers.',
  prompts: [
    { id: 'industry', type: 'text', q: 'Would I like to work in this industry? Why or why not?' },
    { id: 'strengths', type: 'text', q: 'My top 3 strengths, each with a moment from this week as proof' },
    { id: 'improve', type: 'text', q: 'One thing I want to get better at, and how' },
    { id: 'course', type: 'text', q: 'How does this experience link to the course I might apply for?', hint: 'Poly / ITE course, or the kind of work you want to try' },
    { id: 'pitch', type: 'text', q: 'My 30-second answer to “Tell us about your work experience”', hint: 'Where, what you did, one highlight, what you learnt about yourself' },
    { id: 'thanks', type: 'text', q: 'A short thank-you note to my supervisor (optional)', optional: true },
  ],
};

export function sectionsFor(days = 5) {
  return [PLACEMENT, ...Array.from({ length: days }, (_, i) => dayStage(i + 1, days)), WRAPUP];
}

export const isAnswered = (v) => String(v ?? '').trim() !== '';
// Questions that always count towards a section being done (the "choose 3" ones are counted separately).
export const countable = (s) => s.prompts.filter((p) => !p.optional && !s.pick?.from.includes(p.id));

// How many answers finish a section, and how many of those are given. Used by students and teachers.
export const sectionTarget = (s) => countable(s).length + (s.pick?.need ?? 0);
export function sectionDone(s, answers = {}) {
  const fixed = countable(s).filter((p) => isAnswered(answers[p.id])).length;
  const picked = s.pick ? Math.min(s.pick.need, s.pick.from.filter((id) => isAnswered(answers[id])).length) : 0;
  return fixed + picked;
}

// Common EAE interview questions, each pointing at the journal answers that help.
// from: wrap-up answers; days: the same reflection question, collected from every day.
export const INTERVIEW = [
  { q: 'Tell us about yourself and your work experience.', from: [['wrapup', 'pitch']] },
  { q: 'Why are you interested in this course?', from: [['wrapup', 'course'], ['wrapup', 'industry']] },
  { q: 'What did you learn from your work experience?', days: 'q2' },
  { q: 'Describe a challenge you faced. How did you handle it?', days: 'q4' },
  { q: 'What are your strengths?', from: [['wrapup', 'strengths']], days: 'q3' },
  { q: 'What is one weakness, and what are you doing about it?', from: [['wrapup', 'improve']], days: 'q5' },
];
