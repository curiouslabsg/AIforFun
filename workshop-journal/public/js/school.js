// School structure for the sign-up form. Teacher names can be edited by admins
// on the dashboard (stored in settings/school); these are the fallbacks.
export const LEVELS = {
  1: ['1A', '1B', '1C', '1D', '1E', '1F'],
  2: ['2A', '2B', '2C', '2D', '2E', '2F'],
};

export const DEFAULT_TEACHERS = ['Mr Lloyd Goh', 'Ms Sabrina Tay'];

// Sec 1 does Code for Fun, Sec 2 does AI for Fun.
export const trackForLevel = (level) => (Number(level) === 2 ? 'ai' : 'code');
