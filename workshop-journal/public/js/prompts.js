// Journal stages follow the workshop loop. Each prompt is one text box, except
// `type: 'problem'`, which is the problem statement picker.
// `ai` replaces `q`/`hint` for AI for Fun (Sec 2) workshops.
// `color` and `icon` style each stage (icons live in icons.js).
// Prompts are shared by the whole team (same workshop, class and team number)
// unless marked `personal: true`, which each student answers for themselves.
// `images` adds photo / sketch boxes to a stage (one per entry, stored by `key`).
// `retired` lists questions no longer asked: earlier answers still show (read-only),
// on the dashboard and in the CSV, so nothing students wrote disappears.
// `type: 'code'` is a wide monospace box for pasted code.

export const STAGES = [
  {
    id: 'empathise',
    color: '#e11d48',
    icon: 'empathise',
    day: 'Day 1',
    title: 'Empathise',
    blurb: 'Who has this problem, and what did you find out from them?',
    sheet: 'W2 · W3',
    prompts: [
      { id: 'problem', type: 'problem', q: 'Which problem statement did your team choose?' },
      { id: 'why', q: 'Why did your team choose this one?', hint: 'e.g. three of us get neck pain after homework' },
      { id: 'user', q: 'Who did you interview? Where and when does the problem happen for them?', hint: 'Role, not full name. e.g. "Sec 3 student, during self-study in the library"' },
      { id: 'quotes', q: 'Write down 2–3 things they actually said.', hint: 'Copy their words exactly, in quotes' },
      { id: 'surprise', q: 'What surprised you most from the interviews?' },
    ],
  },
  {
    id: 'define',
    color: '#b45309',
    icon: 'define',
    day: 'Day 1',
    title: 'Define',
    blurb: 'Turn what you heard into a question your team can answer.',
    sheet: 'W3',
    prompts: [
      { id: 'hmw', q: 'Your team\'s "How might we…" question', hint: 'How might we help [user] to [need] so that [result]?' },
      { id: 'why', q: 'Which interview finding led to this question?' },
    ],
  },
  {
    id: 'ideate',
    color: '#7c3aed',
    icon: 'ideate',
    day: 'Day 1',
    title: 'Ideate',
    blurb: 'Go wide first, then pick one idea you can build.',
    sheet: 'W4',
    prompts: [
      { id: 'myideas', q: 'List 3 ideas.', hint: 'e.g. your best 3 from Crazy 8s' },
      { id: 'chosen', q: 'Which idea did the team choose?' },
      { id: 'reason', q: 'Why this one? Think about impact on the user and effort to build.' },
    ],
  },
  {
    id: 'design',
    color: '#2563eb',
    icon: 'design',
    day: 'Day 1',
    title: 'Design brief',
    blurb: 'Plan exactly what goes in, what the code decides, and what comes out.',
    sheet: 'W5',
    prompts: [
      {
        id: 'input', q: 'INPUT: Which sensor are you using, and what does it measure?', hint: 'e.g. accelerometer, measures tilt in degrees',
        ai: { q: 'INPUT: What will your model look at, listen to or read?', hint: 'Laptop only, no hardware: webcam, mic, online pictures or typed text' },
      },
      {
        id: 'rule', q: 'PROCESS: Write your IF / THEN rule, with a number and unit.', hint: 'IF temperature < 60 °C THEN buzz 3 times',
        ai: { q: 'PROCESS: What classes will your model sort into?', hint: 'e.g. unripe · ripe · overripe · spoiled' },
      },
      {
        id: 'output', q: 'OUTPUT: What will the user see, hear or feel?',
        ai: { q: 'OUTPUT: What happens for each class?', hint: 'e.g. "overripe" → Scratch sprite says "Eat today!"' },
      },
      {
        id: 'success', q: 'How will you know it works?',
        ai: { q: 'How many samples per class will you collect, and from how many different people?' },
      },
      { id: 'tps', personal: true, q: 'Think · Pair · Share: 2 things that went well in creating your group’s project', hint: 'Think on your own, pair up and discuss, then share' },
    ],
    images: [
      {
        key: 'design-flowchart', title: 'Computation flowchart',
        help: 'Draw the steps your program follows: start → input → decision (IF / ELSE) → output. Draw on paper and take a photo, or draw right here.',
      },
      {
        key: 'design-connectivity', title: 'Connectivity diagram',
        help: 'Show how the parts connect: sensor → micro:bit → output (for AI: webcam / mic / text → model → app). Label each part.',
      },
    ],
  },
  {
    id: 'prototype',
    color: '#0d9488',
    icon: 'prototype',
    day: 'Day 2',
    title: 'Prototype',
    blurb: 'Paste your code, then look back on how building it went.',
    sheet: 'W6',
    prompts: [
      {
        id: 'code', type: 'code', q: 'Paste your code', hint: 'MakeCode: switch to JavaScript, select all and copy, or paste your Share link',
        ai: { q: 'Paste your code or model link', hint: 'Teachable Machine: Export → copy the shareable link. Add any code you wrote.' },
      },
      { id: 'well', personal: true, q: 'Self-reflection: What went well in creating your project?' },
      { id: 'challenge', personal: true, q: 'What was the most challenging, and how did your team solve it?' },
      { id: 'improve', personal: true, q: 'What could be improved further?' },
    ],
    images: [
      {
        key: 'prototype', title: 'Sketches and photos',
        help: 'Photos of your prototype, or a labelled sketch. Draw on paper and take a photo, or draw right here.',
      },
    ],
    retired: [
      { id: 'mypart', personal: true, q: 'What did you personally build or code today?' },
      { id: 'bug', q: 'Biggest bug or problem you hit' },
      { id: 'fix', q: 'How did you fix it (or what would you try next)?' },
      { id: 'concept', personal: true, q: 'Which coding idea did you use?' },
    ],
  },
  {
    id: 'test',
    color: '#db2777',
    icon: 'test',
    day: 'Day 2',
    title: 'Peer Feedback Reflection',
    blurb: 'After the gallery walk: read the notes your visitors left, then answer below.',
    sheet: 'W8',
    notesFirst: true,
    prompts: [
      { id: 'like', q: 'One piece of feedback I like', hint: 'Copy it from the wall above' },
      { id: 'wish', q: 'The most useful feedback, and why', hint: 'Usually an “I wish…” or “What if…” note' },
      { id: 'others', personal: true, q: 'One project that impressed me, and why' },
    ],
    retired: [
      { id: 'results', q: 'Test results: what did you test, and what happened?' },
    ],
  },
  {
    id: 'reflect',
    color: '#16a34a',
    icon: 'reflect',
    day: 'Day 2',
    title: 'Self-Reflection',
    blurb: 'Close the loop: what would you change, and what did you learn?',
    sheet: 'W9',
    prompts: [
      { id: 'change', q: 'If you had one more day, what would you change, and which feedback made you decide that?' },
      {
        id: 'learnt3', personal: true, q: '3 things I learnt about coding or electronics',
        ai: { q: '3 things I learnt about how AI works' },
      },
      { id: 'design2', personal: true, q: '2 things I learnt about designing for real people' },
      { id: 'question1', personal: true, q: '1 question I still have' },
    ],
  },
];

// Tags for the free-form learning log. Same list for both tracks so the
// teacher dashboard can compare, with a few AI-specific ones.
export const LEARNING_TAGS = {
  code: ['Sensors', 'IF / ELSE', 'Variables', 'Loops', 'Debugging', 'Health science', 'Food science', 'Teamwork', 'Other'],
  ai: ['Training data', 'Classes', 'Accuracy', 'Bias', 'Privacy', 'Health science', 'Food science', 'Teamwork', 'Other'],
};

export const LOG_STYLE = { color: '#4f46e5', icon: 'log' };

export const isPersonal = (p) => p.personal === true;

export function promptFor(p, track) {
  return track === 'ai' && p.ai ? { ...p, ...p.ai } : p;
}

export const TRACK_LABEL = { code: 'Code for Fun · Sec 1', ai: 'AI for Fun · Sec 2' };
