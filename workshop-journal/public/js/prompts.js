// Journal stages follow the workshop loop. Each prompt is one text box, except
// `type: 'problem'`, which is the problem statement picker.
// `ai` replaces `q`/`hint` for AI for Fun (Sec 2) workshops.
// `color` and `icon` style each stage (icons live in icons.js).
// Prompts are shared by the whole team (same workshop, class and team number)
// unless marked `personal: true`, which each student answers for themselves.

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
      { id: 'myideas', q: 'List your best 3 ideas from Crazy 8s.' },
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
        ai: { q: 'INPUT: What will your model look at or listen to?', hint: 'e.g. webcam image of a lunch tray' },
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
    ],
  },
  {
    id: 'prototype',
    color: '#0d9488',
    icon: 'prototype',
    day: 'Day 2',
    title: 'Prototype',
    blurb: 'Log what you built and what went wrong along the way.',
    sheet: 'W6',
    prompts: [
      { id: 'mypart', personal: true, q: 'What did you personally build or code today?' },
      { id: 'bug', q: 'Biggest bug or problem you hit' },
      { id: 'fix', q: 'How did you fix it (or what would you try next)?' },
      {
        id: 'concept', personal: true, q: 'Which coding idea did you use? Explain it in your own words.', hint: 'variables, IF / ELSE, loops, events, thresholds…',
        ai: { q: 'What did you learn about training data? What made the model better or worse?', hint: 'more samples, different lighting, different people…' },
      },
    ],
  },
  {
    id: 'test',
    color: '#db2777',
    icon: 'test',
    day: 'Day 2',
    title: 'Test & feedback',
    blurb: 'Record your test results and what visitors told you in the gallery walk.',
    sheet: 'W6 · W8',
    prompts: [
      {
        id: 'results', q: 'Test results: what did you test, and what happened?', hint: 'Include the test right at your threshold number',
        ai: { q: 'Test results: out of 10 tries by someone who didn\'t train it, how many did the model get right?', hint: 'Which class did it confuse most?' },
      },
      { id: 'like', q: 'Best "I like…" feedback you received' },
      { id: 'wish', q: 'Most useful "I wish…" or "What if…" feedback' },
      { id: 'others', personal: true, q: 'Which other team\'s project impressed you, and why?' },
    ],
  },
  {
    id: 'reflect',
    color: '#16a34a',
    icon: 'reflect',
    day: 'Day 2',
    title: 'Reflect',
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
