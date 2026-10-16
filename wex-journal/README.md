# WEX Journal

A phone-first reflection journal for Secondary 3 **Work Experience (WEX)**. Students take photos and write a short reflection each day of their placement. At the end, the journal turns itself into an **EAE interview portfolio**: their own answers lined up under common Early Admissions Exercise questions, ready to print or save as a PDF.

Same building blocks as the workshop journal (`../workshop-journal`), in its own Firebase project so the data stays separate.

## What students do (on their phones)

They open the site, pick their **teaching group**, then **their name** from the class list, and make up a 4-digit PIN. No accounts or emails.

| Section | When | What they write |
|---|---|---|
| My placement | Day 1 | Company, industry, department, supervisor's job title, what they hope to learn |
| Day 1 … Day 5 | Each day | Up to 3 photos with captions (camera or gallery), what I did, one thing I learnt, skills I used (tap chips), an example of one skill, high point or challenge, how the day felt |
| Story 1–3 | Any time | STAR stories: Situation, Task, Action, Result, and what the story shows. Story 1 is a challenge, 2 teamwork, 3 initiative |
| Wrap-up | Last day | Would I work in this industry, top 3 strengths with proof, one thing to improve, link to the course they'll apply for, a 30-second "tell us about your work experience", thank-you note |
| My EAE portfolio | After | 30-second story, best photos (starred), skills tally, interview practice (8 common EAE questions with their own answers), day by day, teacher's note. **Print / save as PDF** |

- **Patchy mobile data is fine.** Answers and photos save on the phone first ("Saved on this phone · uploads when you're back online") and upload when the signal returns.
- **Photos** are shrunk on the phone (to about 100–300 KB) and stored in Firestore, so the free plan is enough. Students are reminded not to photograph customers' or patients' faces or anything confidential.
- **Next year:** the journal stays readable. A student opens the site on any phone, picks their name and types their PIN, even after the group is closed, and prints the portfolio before their EAE interview. Tell students to keep their PIN; teachers can see and reset it.

## Teachers

Teachers sign in at `/teacher.html` with email + password (or Google, if switched on).

- **Teacher rights:** see every journal and photo, see and reset PINs, write a **teacher's note** that appears on the student's portfolio, view and print a student's portfolio, download a CSV, delete journals.
- **Admin rights:** everything above, plus create WEX groups (name, ID, number of days), make them active (show them on the student page), close and reopen them for writing, add teachers, upload class lists.
- **Class lists:** CSV or Excel with *Teaching group*, *Name*, *Class* (and optional *Level*). Students only ever see teaching groups and names.
- **Closing a group** makes journals read-only. Keep it **active** if students should still be able to open (and print) their journals next year.

## Data and privacy

- Stored per student: name (from the class list), teaching group, PIN and its hash, answers and photos. Only the student (on a phone that knew their PIN) and teachers on the list can read a journal; `firestore.rules` enforces this and `tests/rules.test.mjs` checks it.
- A 4-digit PIN stops casual snooping, not a determined attacker. Tell students not to write or photograph anything confidential.
- Check your school's PDPA requirements. Download the CSV and delete journals you no longer need.

## Development

```bash
npm install
npm run dev      # emulators: site on http://127.0.0.1:5100, emulator UI on http://127.0.0.1:4100
npm test         # security rules tests against the Firestore emulator (needs Java 11+)
```

Locally the site always talks to the emulators (project `demo-wex`), never the live database.

## Files

```
firestore.rules          who can read and write what
firebase.json            hosting + emulator config (ports differ from the workshop journal)
public/index.html        student journal (phone-first)
public/teacher.html      teacher dashboard
public/js/wex.js         sections, questions, skills, interview questions (edit these)
public/js/portfolio.js   the printable EAE portfolio
public/js/student.js     student logic (join, sections, camera photos, offline saving)
public/js/teacher.js     dashboard logic
public/js/roster.js      reads class-list CSV / Excel files
tests/rules.test.mjs     security rules tests
```
