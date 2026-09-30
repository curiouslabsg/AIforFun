# Pieces

A lecture note is a list of pieces in a YAML file (see `notes/pressure.yaml`).
Each piece is one block on the page. Pieces stack top to bottom in the order
you list them, so to re-jigsaw a note you move, copy or delete pieces.

Every piece sits in the same two-column row:

```
| gutter (cue questions, labels, marks) | content                         |
```

Build `output/<name>-labelled.pdf` (`python3 build.py notes/pressure.yaml --labels`)
to see every piece stamped with its type name.

## Text markup (works in every text field)

| Write            | Get                       |
| ---------------- | ------------------------- |
| `**bold**`       | **bold**                  |
| `*italic*`       | *italic*                  |
| `==key phrase==` | highlighter mark          |
| `m^{2}`          | superscript: m²           |
| `F_{1}`          | subscript: F₁             |
| `~~wrong~~`      | strikethrough             |

A blank line inside a `text: |` block starts a new paragraph.
Any piece can take `cues:`, a list of questions shown in the gutter.

## Working space

Anything students answer takes one of these:

- `space: 40` gives a 40 mm graph-paper box (for calculations)
- `lines: 3` gives 3 ruled lines (for explanations)

## Solutions and the annex

Answers never appear next to the question. Every `answer:` or `solution:`
is collected, numbered and printed by the `annex` piece, grouped under
the section headings. Keep `annex` as the **last** piece.

An answer can be:

- a sentence: `answer: "Air is **compressible**..."`
- a list of sentences, one per line
- a list of steps, printed as numbered working:

```yaml
answer:
  - do: Convert the area.            # what the step does
    work: "A = 0.015 m^{2}"          # the working, printed bold
    note: Convert before dividing.   # optional margin note
```

---

## Structure

### `cover`
The title page, with the syllabus outcomes and name/class/date lines.
```yaml
- type: cover
  chapter: Newtonian Mechanics · Pressure
  title: Why your ears hurt at the bottom of a ==deep pool==
  hook: One or two sentences that make them curious.
  chips: [Sec 3–4 · Express, "Exam weight: high"]   # first chip is filled
  art: cover-depth.svg                             # any file in diagrams/
  outcomes_title: SEAB 6091 learning outcomes · by the end you can
  outcomes: [define the term **pressure** ..., ...]
```

### `heading`
Starts a numbered section (01, 02, ...). The annex groups solutions under these.
```yaml
- type: heading
  title: Pressure in liquids
  intro: One line on why this section matters.
```

### `subheading`
A smaller title inside a section. It is kept with the piece that follows it.

### `page-break`
Forces the next piece onto a new page. No fields.

### `row`
Puts two or more pieces side by side. `cols` sets the column widths.
```yaml
- type: row
  cols: 1fr 1.3fr
  cues: [Derive p = hρg in four lines.]
  items:
    - type: figure
      src: liquid-column.svg
    - type: concept
      title: Where p = hρg comes from
      text: ...
```

## Teaching

### `concept`
Explanation text, with optional `title` and `bullets`.
```yaml
- type: concept
  title: Nothing for free          # optional
  cues: [Define pressure.]
  text: |
    **Pressure** is the ==force acting normally per unit area==.

    Second paragraph.
  bullets: [first point, second point]   # optional
```

### `formula`
A big equation with a table of symbols, meanings and units.
```yaml
- type: formula
  eq: p = hρg
  where:
    - [p, pressure due to the liquid column, Pa]
    - [h, vertical depth below the surface, m]
  note: Optional line under the table.
```

### `figure`
An SVG from `diagrams/`. `width` is a percentage of the column (default 100).
```yaml
- type: figure
  src: hydraulic-press.svg
  width: 72
  caption: The pressure is the same on both pistons.
```

### `compare`
Two coloured lists side by side, such as high-pressure uses against low-pressure uses.
```yaml
- type: compare
  left:  {title: We want HIGH pressure, items: [Knife blades, Nails]}
  right: {title: We want LOW pressure,  items: [Snowshoes, Wide tyres]}
```

### `keywords`
A grid of term cards.
```yaml
- type: keywords
  items:
    - [pressure, force acting normally per unit area]
    - [pascal (Pa), "1 N acting on 1 m^{2}"]
```

## Callouts

### `examiner`
Red box that points out where marks are lost. `title` is optional.
```yaml
- type: examiner
  text: |
    "**Total** pressure" means hρg + atmospheric pressure.
```

### `fact`
Dashed "Did you know?" box with an optional big number.
```yaml
- type: fact
  big: Over 1100 ×
  text: At the bottom of the Mariana Trench ...
```

### `predict`
Blue hook box. Students commit to a guess before the lesson. The answer goes to the annex.
```yaml
- type: predict
  title: Who would you rather be stepped on by?
  text: The set-up.
  options: [The stilettos, The elephant, About the same]
  lines: 2              # optional "why do you think so?" lines
  answer: [...]
```

### `activity`
Amber "Try it at home" box with numbered steps and a question.
```yaml
- type: activity
  title: The card that holds up water
  need: a plastic cup, a postcard, water
  steps: [Fill the cup., Slide the card on., Turn it over.]
  question: Explain why the card stays on.
  lines: 3
  answer: [...]
```

## Practice

Questions (`question` and `mcq`) share one numbering: Q1, Q2, ...

### `worked-example`
Numbered example with a blank working box. Full solution goes to the annex.
```yaml
- type: worked-example
  text: A diver swims 20 m below the surface ...
  marks: 3
  space: 42
  solution:
    - {do: Pressure due to the seawater., work: "p = hρg = 20 × 1030 × 10 = 206 000 Pa"}
    - {do: Add the air above., work: "p_{total} = 306 000 Pa", note: The classic slip.}
  final: "3.06 × 10^{5} Pa"
```

### `question`
Structured question. `level` is `warm-up`, `exam` or `stretch` (shown as 1–3 dots).
Use `parts` for (a), (b), (c); the total marks are added up for you.
```yaml
- type: question
  level: exam
  text: A water tank is filled to a depth of 3.0 m.
  parts:
    - text: Calculate the pressure on the base.
      marks: 2
      space: 18
      answer: "p = hρg = **30 000 Pa**"
    - text: Explain why ...
      marks: 1
      lines: 2
      answer: ...
```
Without `parts`, give `marks`, `space` or `lines`, and `answer` directly.

### `mcq`
Paper 1 style multiple choice. `two: true` lays short options in two columns.
```yaml
- type: mcq
  text: Which unit is the same as the pascal?
  options: [N m, "N/m^{2}", "kg/m^{3}", N/m]
  two: true
  answer: B
  explain: Pressure = force ÷ area.
```

### `error-hunt`
A student's working in handwriting. Students circle the slip and correct it.
```yaml
- type: error-hunt
  text: A student found the pressure 50 cm below the surface.
  working: [p = hρg, p = 50 × 1000 × 10, p = 500 000 Pa]
  space: 22
  answer: ["**L2 is wrong.** ..."]
```

## Wrap-up

### `summary`
A box of ruled lines. `prompt` and `lines` are optional.

### `confidence`
Shaky / Getting there / Nailed it, each with a review date. Override with
`options: [[label, advice], ...]`.

### `annex`
Prints every collected solution. Keep it last.
```yaml
- type: annex
  title: Annex · Solutions
  intro: Try every question on your own first.
```

## Sharing pieces between notes

`- include: ../pieces/hydraulics.yaml` pulls in every piece listed under
`elements:` in that file, at that spot. Paths are relative to the note file.
