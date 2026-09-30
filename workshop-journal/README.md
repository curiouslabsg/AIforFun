# Workshop Journal

A web journal for the **Code for Fun (Sec 1)** and **AI for Fun (Sec 2)** design thinking workshops. Students record what they find out, build and learn at each stage of the 2-day loop. Teachers watch progress live and export everything to CSV.

- **Students** open the site, enter the workshop code, their team number, name + surname initial, and a 4-digit PIN. No accounts or emails are needed.
- **Teachers** sign in with Google at `/teacher.html`, create a code for each class, and project it on the screen.

## What students fill in

| Section | When | Matches worksheet |
|---|---|---|
| Learning log: "I learnt" and "I gathered" entries, tagged by topic | Anytime | — |
| Empathise: problem chosen, interview notes, quotes, surprises | Day 1 | W2, W3 |
| Define: How Might We question | Day 1 | W3 |
| Ideate: best Crazy 8s ideas, chosen idea and why | Day 1 | W4 |
| Design brief: input, rule, output, success test | Day 1 | W5 |
| Prototype: what I built, bugs, fixes, the concept I used | Day 2 | W6 |
| Test & feedback: results, gallery walk feedback | Day 2 | W6, W8 |
| Reflect: what we'd change, 3-2-1 | Day 2 | W9 |

AI for Fun workshops show AI-specific versions of the design brief, prototype and test prompts (classes, training data, accuracy). Edit the prompts in `public/js/prompts.js`.

## Live project

| | |
|---|---|
| Student journal | https://aiforfun-sg.web.app |
| Teacher dashboard | https://aiforfun-sg.web.app/teacher.html |
| Firebase console | https://console.firebase.google.com/project/aiforfun-sg/overview |
| Database region | asia-southeast1 (Singapore) |
| First admin | lloydgoh@gmail.com |

**Deploys are automatic.** Every push to `main` that touches `workshop-journal/` runs the security rules tests in GitHub Actions (`.github/workflows/deploy-journal.yml`) and, if they pass, deploys the site and rules to `aiforfun-sg`. Pull requests run the tests only.

GitHub signs in to Google without a stored key (Workload Identity Federation): the `github` pool's `aiforfun` provider only accepts this repo (ID `1386575510`) on `main`, and the `github-deploy` service account can deploy hosting and rules but cannot read Firestore data. To deploy by hand instead: `npx firebase login`, then `npx firebase deploy --project aiforfun-sg --only hosting,firestore:rules`.

## What's in it

**Students** join with the workshop code, level (Sec 1/2), class, teacher, team, name and a 4-digit PIN. Sec 1 gets the Code for Fun prompts and problem statements; Sec 2 gets AI for Fun.
- Problem statement picker with a detail card, coloured stages, progress bar and a confetti burst when a stage is done.
- **Prototype**: upload a photo of a paper sketch, or draw on the built-in sketch pad. Images are shrunk to under 900 KB and stored in Firestore.
- **Test & feedback**: *Visitor mode* turns the laptop into a feedback form (I like / I wish / What if / would the user use it). Each visitor's note sticks to the team's wall. Students can't delete notes; teachers can.

**Team journals.** Students with the same workshop code, class and team number share one journal and see each other's answers live. Questions tagged *Team* are shared; *Just me* questions (what I built, the coding idea I used, the team that impressed me, and the Reflect 3-2-1) and the learning log stay personal. Sketches and the feedback wall are shared too. When someone clicks into a shared answer, it locks for teammates, who see "Name is typing…"; it unlocks when they click away, or after 45 seconds if their laptop closes.

**Teachers** sign in with Google at `/teacher.html`.
- *My students* shows students who chose your name when joining; *Whole school* shows everyone. Filter by class.
- PINs are hidden until clicked. Open a student to set a new PIN or fix their class and teacher.
- Delete journals: tick students in the table (or the header box to tick everyone shown) and press **Delete selected**, or delete one from a student's panel. Teammates who stay keep the shared team pages. Admins can also delete a whole workshop.
- Create workshops with your own code (e.g. `ESSS26`) or a random one. Download a CSV of everything.
- The dashboard keeps its own sign-in, separate from the student journal, so opening the journal in the same browser never logs a teacher out. Teachers stay signed in until they press Sign out.

## Managing teachers

Admins see a **Teachers** button on the dashboard. From there they can add a teacher by Google email, make someone an admin, remove access, and edit the list of teacher names students choose from when they join. A teacher's *Name* must match one of those names for *My students* to work; teachers can also pick their name themselves on the dashboard. An admin can't remove or demote themselves, so there is always at least one admin.

Add the address exactly as the teacher's Google account reports it. Gmail ignores dots, but Firebase doesn't, so `lloydgoh@gmail.com` and `lloyd.goh@gmail.com` count as different teachers. If a teacher can't get in, the sign-in screen shows the exact address to add.

## Setting up a new project from scratch (about 20 minutes)

1. **Create a Firebase project** at <https://console.firebase.google.com>. The free Spark plan is enough.
2. **Add a web app** (Project settings → General → Your apps → `</>`). Copy the config values into `public/js/firebase-config.js`.
3. **Turn on sign-in methods** (Build → Authentication → Sign-in method): enable **Anonymous** (for students) and **Google** (for teachers).
4. **Create the database** (Build → Firestore Database → Create database). Choose **production mode** and the region **asia-southeast1 (Singapore)**.
5. **Add the first admin** (Firestore → Start collection):
   - Collection ID: `teachers`
   - Document ID: the admin's Google email in lowercase, for example `ms.tan@school.edu.sg`
   - Field `role` = `admin`
   Everyone else can then be added from the dashboard's Teachers page.
6. **Deploy** from this folder:
   ```bash
   npm install
   npx firebase login
   npx firebase use --add        # pick your project
   npm run deploy                # uploads the site and the security rules
   ```
   The site is then live at `https://<project-id>.web.app`, and the dashboard at `https://<project-id>.web.app/teacher.html`.

## Before Day 1

- **Test on the school Wi-Fi.** School firewalls sometimes block Firebase. From a student laptop, open the site and join a test workshop. The site needs `*.web.app`, `www.gstatic.com`, `firestore.googleapis.com`, `identitytoolkit.googleapis.com` and `securetoken.googleapis.com`.
- **Create one code per class** on the dashboard. Codes start with `CFF` (Code for Fun) or `AIF` (AI for Fun).
- **Tell students to write down their PIN.** They'll need it on Day 2 if they get a different laptop.

## During and after the workshop

- The dashboard updates live. Each square is one stage: empty, partly answered, or complete. Click a student to read their journal.
- **Download CSV** gives one row per student with every answer and all learning log entries. It opens in Excel and Google Sheets.
- **Close workshop** makes every journal in that class read-only. Students can still open and read theirs. **Reopen** undoes it.

## Privacy and safety

- Stored per student: name + surname initial, team number, a hashed PIN, and their journal text. No emails, photos or full names are collected from students.
- Only the student (on a device that entered their PIN) and teachers listed in `teachers` can read a journal. The security rules in `firestore.rules` enforce this, and `tests/rules.test.mjs` checks them.
- "Switch student" signs the laptop out completely, so the next student on a shared laptop can't open the previous one's journal.
- A 4-digit PIN protects against casual snooping, not a determined attacker. The journal is meant for workshop reflections, so tell students not to write anything personal or sensitive.
- Check your school's data protection (PDPA) requirements before use. After the workshop, export the CSV, then delete the workshop's data in the Firebase console (Firestore → `workshops` → the code → delete) once you no longer need it.

## Free plan limits

The Spark plan allows 20,000 writes and 50,000 reads per day. Autosave waits for a 1.5-second pause in typing, so one student usually makes 100–200 writes a day. That covers about 100 students writing at the same time. If you run more classes on the same day, watch Usage in the Firebase console or switch to the Blaze plan (pay as you go, still cents at this size).

## Development

```bash
npm install
npm run dev      # local emulators: site on http://127.0.0.1:5000, emulator UI on http://127.0.0.1:4000
npm test         # runs the security rules tests against the Firestore emulator (needs Java 11+)
```

Locally, the site talks to the emulators, so no real data is touched. To try the teacher dashboard locally, add a `teachers/<email>` document in the emulator UI, then sign in with the emulator's fake Google account using the same email.

## Files

```
firestore.rules          who can read and write what
firebase.json            hosting + emulator config
public/index.html        student journal
public/teacher.html      teacher dashboard
public/js/prompts.js     journal stages and questions (edit these)
public/js/student.js     student logic
public/js/teacher.js     dashboard logic
public/js/firebase.js    Firebase setup, shared helpers
tests/rules.test.mjs     security rules tests
```
