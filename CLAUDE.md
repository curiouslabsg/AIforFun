# CuriousLab content studio: handover

Read this first. It records what was built and decided in the cloud session (Sep–Oct 2026), so a new session can carry on without that chat.

## Who and what
- Lloyd runs CuriousLab.sg (BeCurious): Singapore O-Level / A-Level physics tuition. MOE-trained physics teacher.
- This repo holds three things:
  - `lecture-notes/`: print lecture notes and tutorials built from YAML "pieces" (Python + headless Chromium → PDF).
  - `labs/`: digital interactive chapter labs (single HTML files) that report progress to a parent page.
  - `workshop-journal/`: the Firebase journal for the Code for Fun / AI for Fun workshops (aiforfun-sg). Leave it alone for tuition work.
- Lloyd's source material lives outside the repo, in `C:\Users\lloyd\OneDrive\Desktop\Physics`:
  - `SEAB resources/`: SEAB syllabus outlines for H2 Physics, Science Physics (G3), Science Physics (G2) and Pure Physics.
  - An example TOS (table of specification).
  - `previous/`: earlier notes Lloyd rates as "not bad"; use them as the model.
  - Tutorials made with his **phytut** skill.

## Current task (next steps, in order)
1. **TOS for four syllabuses**: H2 Physics, Science Physics G3, Science Physics G2, Pure Physics. Build them from the SEAB outlines in the Physics folder, in the same format as the example TOS.
2. **Chapter 3 gap check**: compare each TOS with what the chapter 3 lecture notes should contain, using `previous/` as the model. Report what's covered, missing, or beyond the syllabus. Then write chapter 3 notes for each of the four syllabuses.
3. **Chapter 3 tutorials**: keep the phytut format, but merge in `lecture-notes/tutorial.py` features (answer-split checks, option patterns, PDF + DOCX from one YAML).
4. **Chapter 3 digital interactive** for each syllabus, in the `labs/` format.
Lloyd reviews each piece in detail before anything rolls out to the whole syllabus.

## Decisions already made
- Notes: friendly font (Nunito, 11 pt body; Kalam for "someone else's working"). No "cover this" prompts: give blank working space and put all solutions in an **annex** at the back.
- Notes are built from pieces that can be re-ordered ("jigsaw"); see `lecture-notes/PIECES.md`. `--labels` stamps each piece with its type.
- Two looks: the default upper-sec theme, and `theme: junior` (ages 13–14, sticker-bright, XP).
- Diagrams that need geometry are **generated to scale** (`lecture-notes/diagrams/src/light.py`), never hand-guessed.
- Tutorials follow Lloyd's Tutorials skill: cover, one-page concept summary, Paper 1 (20 MCQ, answers 5A/5B/5C/5D, all five option patterns), Paper 2 (Section A ~32 marks, Section B 2 × 8 choose one), answer key. `tutorial.py` refuses to build if those rules break.
- Labs: dark "optics bench" look (Fredoka / Nunito / JetBrains Mono). Each has a progress bridge (`labs/README.md`) that posts `curiouslab-lab` events to a parent page. Labs are paid-only content: don't share them publicly.
- Tuition journal: a **separate Firebase project** from the workshop journal (not built yet). It will embed labs and store their events per student.
- Use g = 10 N/kg (O-Level), c = 3.0 × 10⁸ m/s, p_atm = 1.0 × 10⁵ Pa unless a syllabus says otherwise.
- Accuracy over speed: check every number and syllabus outcome. Cite SEAB sources. If a source can't be read, say so rather than guessing.

## How to build
Needs Python 3 (PyYAML, python-docx, pypdfium2 + Pillow for previews) and Node with Playwright (Chromium).
```bash
cd lecture-notes
python3 build.py notes/pressure.yaml            # → output/pressure.pdf  (also light, density)
python3 build.py notes/light.yaml --labels      # piece names stamped on each block
python3 diagrams/src/light.py                   # regenerate to-scale Light diagrams
python3 tutorial.py tutorials/light.yaml        # → output/tutorial-light.pdf + .docx
```
On Windows: `py` instead of `python3`; `pip install pyyaml python-docx pypdfium2 pillow`; `npm install -g playwright` then `npx playwright install chromium`. `build.py` finds the global Node modules with `npm root -g`.

Before sending any PDF or lab, render it and look at every page (overlaps, orphans, clipped labels), then fix and re-check.

## What exists
| Item | File |
|---|---|
| Pressure notes (O-Level 6091) | `lecture-notes/notes/pressure.yaml` |
| Light notes (6091) | `lecture-notes/notes/light.yaml` |
| Density mock, ages 13–14 | `lecture-notes/notes/density.yaml` |
| Light tutorial (PDF + DOCX) | `lecture-notes/tutorials/light.yaml` |
| Ch 1 Measurement lab | `labs/measurement.html` |
| Ch 2 Kinematics lab | `labs/kinematics.html` |
| Light lab | `labs/light.html` |
