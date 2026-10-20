// School structure for the sign-up form. Teacher names can be edited by admins
// on the dashboard (stored in settings/school); these are the fallbacks.
export const LEVELS = {
  1: ['1A', '1B', '1C', '1D', '1E', '1F'],
  2: ['2A', '2B', '2C', '2D', '2E', '2F'],
};

export const DEFAULT_TEACHERS = ['Mr Lloyd Goh', 'Ms Sabrina Tay'];

// Sec 1 does Code for Fun, Sec 2 does AI for Fun.
export const trackForLevel = (level) => (Number(level) === 2 ? 'ai' : 'code');

// Gallery walk pairings: students only see (and give feedback to) teams from their own
// teaching group and its partner. Groups not listed here see every team.
export const GALLERY_PAIRS = [
  ['SC1A1', 'SC1A2'],
  ['SC1A5', 'SC1A6'],
  ['SC1B1', 'SC1B5'],
  ['SC1A9', 'SC1B9'],
  ['SC2A1', 'SC2A2'],
  ['SC2A5', 'SC2A6'],
  ['SC2B1', 'SC2B5'],
  ['SC2A9', 'SC2B9'],
];

export function galleryGroups(tg) {
  return GALLERY_PAIRS.find((pair) => pair.includes(tg)) ?? null;
}
