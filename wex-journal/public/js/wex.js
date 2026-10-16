// The questions students answer. Written so the answers can be reused, almost word for word,
// in an Early Admissions Exercise (EAE) interview a year later.

export const SKILLS = [
  'Communication', 'Teamwork', 'Problem solving', 'Initiative', 'Adaptability', 'Responsibility',
  'Customer service', 'Attention to detail', 'Time management', 'Creativity', 'Digital skills', 'Leadership',
];

export const INDUSTRIES = [
  'Healthcare', 'Food & beverage / Hospitality', 'Retail', 'Education / Early childhood', 'Engineering / Manufacturing',
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
  id: 'placement', title: 'My placement', icon: 'building', color: '#0f766e',
  blurb: 'Where you are and what you hope to get out of it. Fill this in on Day 1.',
  prompts: [
    { id: 'company', type: 'short', q: 'Company or organisation', hint: 'e.g. Sunshine Family Clinic', max: 100 },
    { id: 'industry', type: 'select', q: 'Industry', options: INDUSTRIES },
    { id: 'dept', type: 'short', q: 'Department or team I am in', hint: 'e.g. Front desk, Kitchen, IT support', max: 100 },
    { id: 'supervisor', type: 'short', q: 'My supervisor’s job title (not their name)', hint: 'e.g. Clinic manager', max: 100 },
    { id: 'hope', type: 'text', q: 'What do I hope to learn or find out this week?' },
    { id: 'why', type: 'text', q: 'Why this placement? How do I feel about it on Day 1?' },
  ],
};

export function dayStage(n) {
  return {
    id: `day${n}`, title: `Day ${n}`, icon: 'sun', color: ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a'][(n - 1) % 5],
    blurb: 'Take 1–3 photos that show what you did (no faces of customers or patients, nothing confidential). Then write while it’s fresh.',
    photos: true,
    prompts: [
      { id: 'did', type: 'text', q: 'What did I do today?', hint: 'Tasks, people you worked with, tools you used' },
      { id: 'learnt', type: 'text', q: 'One thing I learnt about this job or industry', hint: 'Something you didn’t know this morning' },
      { id: 'skills', type: 'chips', q: 'Skills I used today', options: SKILLS },
      { id: 'example', type: 'text', q: 'An example: when did I use one of these skills?', hint: '“When a customer asked…, I…”' },
      { id: 'moment', type: 'text', q: 'Today’s high point or biggest challenge, and what I did about it' },
      { id: 'mood', type: 'mood', q: 'How did today feel?' },
    ],
  };
}

export const STAR_PROMPTS = [
  { id: 'title', type: 'short', q: 'Give this story a title', hint: 'e.g. “The day the printer broke”', max: 80 },
  { id: 's', type: 'text', q: 'Situation: where were you, what was going on?' },
  { id: 't', type: 'text', q: 'Task: what did you need to do, or what was the problem?' },
  { id: 'a', type: 'text', q: 'Action: what did YOU do, step by step?', hint: 'Say “I”, not “we”. This is the part interviewers care most about.' },
  { id: 'r', type: 'text', q: 'Result: what happened? What did you learn?' },
  { id: 'shows', type: 'chips', q: 'What does this story show about me?', options: SKILLS },
];

const STAR_FOCUS = [
  'A problem I solved or a challenge I handled',
  'A time I worked well with others',
  'A time I took initiative or learnt something new fast',
];

export function starStage(n) {
  return {
    id: `star${n}`, title: `Story ${n}`, icon: 'star', color: '#ca8a04',
    blurb: `${STAR_FOCUS[n - 1]}. Use the STAR steps. Pick a real moment from your days; a small one is fine.`,
    prompts: STAR_PROMPTS,
  };
}

export const WRAPUP = {
  id: 'wrapup', title: 'Wrap-up', icon: 'flag', color: '#be123c',
  blurb: 'Do this on the last day. These answers become your EAE interview answers.',
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
  return [PLACEMENT, ...Array.from({ length: days }, (_, i) => dayStage(i + 1)), starStage(1), starStage(2), starStage(3), WRAPUP];
}

export const isAnswered = (v) => String(v ?? '').trim() !== '';
export const countable = (s) => s.prompts.filter((p) => !p.optional);

// Common EAE interview questions, each pointing at the journal answers that help.
export const INTERVIEW = [
  { q: 'Tell us about yourself and your work experience.', from: [['wrapup', 'pitch']] },
  { q: 'Why are you interested in this course?', from: [['wrapup', 'course'], ['wrapup', 'industry']] },
  { q: 'Describe a challenge you faced. How did you handle it?', star: 1 },
  { q: 'Tell us about a time you worked in a team.', star: 2 },
  { q: 'Give an example of when you showed initiative.', star: 3 },
  { q: 'What are your strengths?', from: [['wrapup', 'strengths']] },
  { q: 'What is one weakness, and what are you doing about it?', from: [['wrapup', 'improve']] },
  { q: 'What did you learn from your work experience?', learnt: true },
];
