// Problem statements from the workshop kit, one list per track.
// `tech` is sensors for Code for Fun and the model type for AI for Fun.

export const PROBLEMS = {
  code: [
    { id: '1', cat: 'food', icon: 'thermometer', title: 'Hot food going cold on the counter', text: 'Curry rice and noodles sit on the canteen counter through recess. Below 60 °C bacteria grow fast, and staff can’t tell when food has dropped too low.', hmw: 'HMW help canteen staff know the moment hot food drops below a safe temperature?', tech: 'Temperature probe · buzzer / LED' },
    { id: '2', cat: 'food', icon: 'bin', title: 'Nobody measures canteen food waste', text: 'Stalls throw away unsold food and trays come back with leftovers, but nobody measures which stall or recess wastes the most.', hmw: 'HMW help a stall see how much food is wasted each recess, so it can cook less?', tech: 'Ultrasonic bin-level sensor or load cell' },
    { id: '3', cat: 'food', icon: 'banana', title: 'Fruit spoils before anyone notices', text: 'Fruit goes from ripe to spoiled in a few days. People notice too late, so it gets thrown away or eaten when it’s gone bad.', hmw: 'HMW warn a family that their fruit is about to spoil, while there’s still time to eat it?', tech: 'Gas sensor · temperature & humidity' },
    { id: '4', cat: 'health', icon: 'droplet', title: 'Rushed handwashing after lab practicals', text: 'After a practical or the toilet, many students wash for only a few seconds. Hands need 20 seconds of scrubbing with soap.', hmw: 'HMW get students to scrub for a full 20 seconds after a lab practical?', tech: 'Proximity sensor · LED countdown · buzzer' },
    { id: '5', cat: 'health', icon: 'bottle', title: 'Forgetting to drink during PE and CCA', text: 'In Singapore’s heat, students forget to drink during PE and outdoor CCAs, risking dehydration and heat exhaustion.', hmw: 'HMW remind active students to drink before they feel thirsty, more often when it’s hot?', tech: 'Timer · temperature · accelerometer' },
    { id: '6', cat: 'health', icon: 'posture', title: 'Hunching over homework', text: 'Hours of hunching over laptops and textbooks build a bad posture habit that leads to back and neck pain.', hmw: 'HMW help students notice they’re slouching and sit up before it becomes a habit?', tech: 'Accelerometer / tilt · buzzer' },
    { id: '7', cat: 'health', icon: 'moon', title: 'Screens keeping students up at night', text: 'Using phones in bed late at night means less sleep and a harder time concentrating the next day.', hmw: 'HMW help students put their phone down at bedtime without a parent reminding them?', tech: 'Light sensor · timer (bedside phone dock)' },
    { id: '8', cat: 'health', icon: 'eye', title: 'Screens too close, rooms too dim', text: 'Long hours with screens close to the face, often in dim light, strain eyes and add to myopia.', hmw: 'HMW remind students to keep a safe screen distance and take eye breaks?', tech: 'Light sensor · ultrasonic distance · 20-20-20 timer' },
    { id: '9', cat: 'health', icon: 'pill', title: 'Grandparents missing medication', text: 'Elderly relatives sometimes forget their medicine, making diabetes or high blood pressure harder to control.', hmw: 'HMW help a grandparent take medicine on time, and tell the family if a dose is missed?', tech: 'Light sensor in pillbox · timer · buzzer' },
    { id: '10', cat: 'health', icon: 'cloud', title: 'Invisible haze indoors', text: 'During haze season, indoor air can get worse with no visible sign, triggering asthma and breathing problems.', hmw: 'HMW warn a family when indoor air is getting unhealthy, so they can act?', tech: 'PM2.5 sensor · traffic-light LEDs' },
  ],
  // AI for Fun: every solution runs on a laptop (webcam, mic, online pictures or typed text). No hardware.
  ai: [
    { id: 'A1', cat: 'food', icon: 'plate', title: 'Is my lunch a Healthy Plate?', text: 'My Healthy Plate says half fruit and veg, a quarter wholegrains and a quarter protein. Most students never check how close their canteen lunch comes.', hmw: 'HMW give students instant feedback on how balanced a meal photo is?', tech: 'Image model trained on online meal photos · balanced / needs more veg / mostly carbs' },
    { id: 'A2', cat: 'food', icon: 'drink', title: 'Sugary drink swaps', text: 'Bubble tea and canned drinks carry a Nutri-Grade mark from A to D, but students order without thinking about how much sugar is inside.', hmw: 'HMW help students pick a lower-sugar drink before they order?', tech: 'Text model: drink name → Grade A / B / C / D, then suggests a swap' },
    { id: 'A3', cat: 'food', icon: 'warning', title: 'Food myth or fact?', text: 'Health tips spread fast on social media ("carrots give you night vision", "skipping breakfast burns fat"). Many are wrong, and students can’t tell which.', hmw: 'HMW help students check a food claim before they believe or share it?', tech: 'Text model on food and health claims · myth / fact / needs more info' },
    { id: 'A4', cat: 'food', icon: 'warning', title: 'Spotting allergens on a menu', text: 'Students with allergies must read every dish carefully, and menus don’t always list ingredients like peanuts or shellfish.', hmw: 'HMW flag dishes that might contain an allergen so students know to ask first?', tech: 'Text model on dish descriptions · nuts / seafood / dairy / none' },
    { id: 'A5', cat: 'food', icon: 'bin', title: 'Leftovers going to waste', text: 'Families throw away leftover rice, vegetables and bread because nobody knows what to cook with them.', hmw: 'HMW turn a list of leftovers into a meal idea in seconds?', tech: 'Chatbot: typed leftovers → recipe type (fried rice / soup / sandwich / smoothie)' },
    { id: 'A6', cat: 'health', icon: 'posture', title: 'Slouching during self-study', text: 'Students hunch over laptops for hours. By the time their neck hurts, the habit is hard to change.', hmw: 'HMW nudge students to sit up the moment they start slouching?', tech: 'Webcam pose model · upright / slouching / away' },
    { id: 'A7', cat: 'health', icon: 'eye', title: 'Faces too close to the screen', text: 'Students lean in towards screens when tired or in dim light, adding to eye strain and myopia, which is common in Singapore.', hmw: 'HMW warn students when they’re too close and remind them to rest their eyes?', tech: 'Webcam image model · good distance / too close, plus a 20-20-20 timer' },
    { id: 'A8', cat: 'health', icon: 'moon', title: 'Late-night screen habits', text: 'Students scroll and game late into the night, then struggle to focus the next day. They rarely notice how their routine affects sleep.', hmw: 'HMW coach students towards a better bedtime routine?', tech: 'Sleep-coach chatbot: text model on bedtime routines · good / risky / needs change' },
    { id: 'A9', cat: 'health', icon: 'dumbbell', title: 'Bad form in NAPFA training', text: 'Practising sit-ups or push-ups alone, students use poor form and lose count of their reps.', hmw: 'HMW help students count reps and check their form without a coach?', tech: 'Webcam pose model · up / down / bad form, with a rep counter' },
    { id: 'A10', cat: 'health', icon: 'sound', title: 'Coughs spreading in class', text: 'Nobody tracks how much coughing happens in class, so teachers can’t tell when to open windows or remind students about masks.', hmw: 'HMW let a teacher know when coughing in class is going up?', tech: 'Laptop-mic audio model · cough / sneeze / talking / background' },
  ],
};

export const OWN_IDEA = { id: 'own', cat: 'own', icon: 'sparkle', title: 'Our own idea (check with your teacher)', text: 'Your team found a different health or food science problem. Describe it in the box below.', hmw: '', tech: '' };

export const CATEGORY = {
  food: { label: 'Food Science', color: '#f97316' },
  health: { label: 'Health Science', color: '#0ea5a4' },
  own: { label: 'Our own idea', color: '#8b5cf6' },
};

// Stored answer text, e.g. "#6 Hunching over homework". Kept readable for the dashboard and CSV.
export const problemLabel = (p) => (p.id === 'own' ? p.title : `#${p.id} ${p.title}`);

export function findProblem(track, label) {
  if (!label) return null;
  if (label === OWN_IDEA.title) return OWN_IDEA;
  return (PROBLEMS[track] ?? []).find((p) => problemLabel(p) === label) ?? null;
}
