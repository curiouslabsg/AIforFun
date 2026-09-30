# CuriousLab lecture notes

Print-ready A4 lecture notes built from pieces you can re-order.

- `notes/pressure.yaml` and `notes/light.yaml` are the notes: lists of pieces in reading order.
- `PIECES.md` lists every piece type and its fields.
- `diagrams/` holds the SVG figures. `diagrams/src/light.py` generates the to-scale Light diagrams.
- `theme/` holds the look (Nunito 11 pt body, Kalam for handwritten working).
- `output/` holds the built PDFs.

## Build

Needs Python 3 with PyYAML, and Node with Playwright (Chromium).

```bash
python3 build.py notes/pressure.yaml            # output/pressure.pdf
python3 build.py notes/pressure.yaml --labels   # output/pressure-labelled.pdf, each piece tagged with its type
python3 diagrams/src/light.py                   # regenerate the Light diagrams after changing their numbers
python3 build.py notes/light.yaml               # output/light.pdf
```

## Re-jigsaw a note

1. Open `notes/pressure.yaml`.
2. Move, copy or delete whole pieces (each starts with `- type:`).
3. Rebuild. Section numbers, question numbers and the solutions annex update themselves.

To start a new topic, copy `notes/pressure.yaml`, keep the pieces you want, and change the text.
