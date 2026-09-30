# CuriousLab Labs

Interactive chapter labs for O-Level Physics (SEAB 6091). Each lab is one self-contained HTML file with no build step. It works on its own, and it is ready to be embedded in the student journal.

| File | Chapter | Activities tracked |
|---|---|---|
| `measurement.html` | 1 · Physical quantities, units and measurement | units, prefixes, magnitude, vernier, micrometer, time, vectors, quiz |
| `light.html` | Light: reflection, refraction, TIR, lenses | reflection, refraction, tir, fibre, lens, quiz |

## Progress messages

Every lab reports progress the same way. It always saves to the device (`localStorage`, keyed by the lab id). When the lab is inside an iframe, it also posts each event to the parent page:

```js
{ source: 'curiouslab-lab', lab: 'p6091-ch01-measurement', event, data, at: '2026-09-30T08:15:00.000Z' }
```

| `event` | `data` | When |
|---|---|---|
| `lab-open` | `{ activities: [...] }` | The lab loads. Lists every activity id, so the journal can show "3 of 8". |
| `attempt` | `{ id, correct }` | Every answer checked (quiz questions use ids `quiz-q1`, `quiz-q2`, …). |
| `activity-complete` | `{ id, ...details }` | The first time an activity is completed on this device. |
| `quiz-complete` | `{ score, of }` | All quiz questions answered. |

The journal listens with:

```js
addEventListener('message', (e) => {
  if (e.data?.source !== 'curiouslab-lab') return;
  // save e.data to the student's record
});
```

## Adding a lab

1. Copy the `Progress` block at the top of the `<script>` in `measurement.html`.
2. Set `LAB.id` (`p6091-<chapter>`) and list its `activities`.
3. Call `Progress.complete('<activity>')` when an activity is finished, and `Progress.attempt('<activity>', correct)` on each answer.
4. Add a row to the table above.
