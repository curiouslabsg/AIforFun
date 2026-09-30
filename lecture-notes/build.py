#!/usr/bin/env python3
"""Build a lecture-note PDF from a YAML list of pieces.

    python3 build.py notes/pressure.yaml            # -> output/pressure.pdf
    python3 build.py notes/pressure.yaml --labels   # also stamps each piece with its type name
    python3 build.py notes/pressure.yaml --html     # stop after writing output/pressure.html

Every entry under `elements:` is one piece. Reorder, delete or copy pieces to
re-jigsaw a note. See PIECES.md for every piece type and its fields.
"""
import argparse, html, os, re, shutil, subprocess, sys
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))


# ---------------------------------------------------------------- text helpers
def md(s):
    """Inline markup: **bold**, *italic*, ==highlight==, x^{2}, F_{1}, ~~strike~~."""
    if s is None:
        return ""
    s = html.escape(str(s).strip(), quote=False)
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"==(.+?)==", r'<span class="hl">\1</span>', s)
    s = re.sub(r"~~(.+?)~~", r"<s>\1</s>", s)
    s = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<i>\1</i>", s)
    s = re.sub(r"\^\{(.+?)\}", r"<sup>\1</sup>", s)
    s = re.sub(r"_\{(.+?)\}", r"<sub>\1</sub>", s)
    s = s.replace("\n", "<br>")
    return s


def paras(s, cls=""):
    if not s:
        return ""
    c = f' class="{cls}"' if cls else ""
    return "".join(f"<p{c}>{md(p)}</p>" for p in re.split(r"\n\s*\n", str(s).strip()))


def ul(items):
    return "<ul>" + "".join(f"<li>{md(i)}</li>" for i in items or []) + "</ul>" if items else ""


def space_html(el, default_mm=0):
    """Blank working space: `space: <mm>` gives a graph-paper box, `lines: <n>` gives ruled lines."""
    if el.get("lines"):
        return '<div class="lines">' + "<div></div>" * int(el["lines"]) + "</div>"
    mm = el.get("space", default_mm)
    return f'<div class="space" style="height:{mm}mm"></div>' if mm else ""


def dots(level):
    n = {"warm-up": 1, "exam": 2, "stretch": 3}.get(str(level).lower(), 0)
    if not n:
        return ""
    return '<div class="dots">' + "".join(f'<i class="{"on" if i < n else ""}"></i>' for i in range(3)) + "</div>"


def opts_html(options, two=False):
    letters = "ABCDEFGH"
    rows = "".join(
        f'<div class="opt"><span class="box">{letters[i]}</span><span>{md(o)}</span></div>' for i, o in enumerate(options)
    )
    return f'<div class="opts{" two" if two else ""}">{rows}</div>'


def cues_html(el):
    return "".join(f'<p class="cue">{md(c)}</p>' for c in el.get("cues", []) or [])


# ---------------------------------------------------------------- the builder
class Note:
    def __init__(self, meta, labels=False):
        self.meta = meta
        self.labels = labels
        self.n = {"section": 0, "we": 0, "q": 0, "eh": 0, "act": 0, "predict": 0}
        self.section_title = ""
        self.solutions = []  # (section title, label, html)

    # every renderer returns (gutter_html, body_html, extra_classes)
    def render(self, el, top=True):
        t = el["type"]
        fn = getattr(self, "r_" + t.replace("-", "_"), None)
        if fn is None:
            sys.exit(f"Unknown piece type: {t!r}. See PIECES.md for the list.")
        g, b, cls = fn(el)
        if not top:
            return g, b
        if cls == "raw":  # piece renders its own rows (the annex)
            return b
        tag = f'<span class="typelabel">{t}</span>' if self.labels else ""
        if cls and "full" in cls:
            return f'<section class="el {cls}">{tag}<div class="b">{b}</div></section>'
        return f'<section class="el el-{t} {cls or ""}">{tag}<div class="g">{g}</div><div class="b">{b}</div></section>'

    def solve(self, label, body):
        self.solutions.append((self.section_title, label, body))

    def answer_html(self, ans):
        if ans is None:
            return ""
        if isinstance(ans, list) and ans and isinstance(ans[0], dict) and ("do" in ans[0] or "work" in ans[0]):
            return steps_html(ans)
        if isinstance(ans, list):
            return "".join(f'<p class="ans">{md(a)}</p>' for a in ans)
        return paras(ans, "ans")

    # --- structure
    def r_cover(self, el):
        m = self.meta
        chips = "".join(
            f'<span class="chip{" solid" if i == 0 else ""}">{md(c)}</span>' for i, c in enumerate(el.get("chips", []))
        )
        outcomes = "".join(f"<li>{md(o)}</li>" for o in el.get("outcomes", []))
        art = inline_svg(el["art"]) if el.get("art") else ""
        b = f"""<div class="cover">
          <div class="top"><span>{md(m.get('course'))}</span><span>{md(m.get('series'))}</span></div>
          <div class="chapter">{md(el.get('chapter', ''))}</div>
          <h1>{md(el['title'])}</h1>
          <p class="hook">{md(el.get('hook'))}</p>
          <div class="chips">{chips}</div>
          <div class="art">{art}</div>
          <div class="outcomes"><span class="tag" style="color:var(--teal)">{md(el.get('outcomes_title', 'By the end of these notes you can'))}</span><ol>{outcomes}</ol></div>
          <div class="idrow"><div>Name</div><div>Class</div><div>Date</div></div>
        </div>"""
        return "", b, "full"

    def r_heading(self, el):
        self.n["section"] += 1
        self.section_title = f'{self.n["section"]} · {el["title"]}'
        g = f'<span class="num">{self.n["section"]:02d}</span>'
        b = f'<h2>{md(el["title"])}</h2>' + paras(el.get("intro"), "intro")
        return g, b, ""

    def r_subheading(self, el):
        return cues_html(el), f'<h3>{md(el["title"])}</h3>', ""

    def r_page_break(self, el):
        return "", '<div style="break-after:page"></div>', "full"

    def r_row(self, el):
        cols = el.get("cols") or " ".join(["1fr"] * len(el["items"]))
        gs, bs = [cues_html(el)], []
        for item in el["items"]:
            g, b = self.render(item, top=False)
            gs.append(g)
            tag = f'<span class="typelabel">{item["type"]}</span>' if self.labels else ""
            bs.append(f'<div style="position:relative">{tag}{b}</div>')
        return "".join(gs), f'<div class="row" style="grid-template-columns:{cols}">{"".join(bs)}</div>', ""

    # --- teaching pieces
    def r_concept(self, el):
        b = (f'<h3 class="subheading">{md(el["title"])}</h3>' if el.get("title") else "") + paras(el.get("text")) + ul(el.get("bullets"))
        return cues_html(el), f'<div class="concept">{b}</div>', ""

    def r_formula(self, el):
        rows = "".join(f"<tr><td>{md(s)}</td><td>{md(n)}</td><td>{md(u)}</td></tr>" for s, n, u in el.get("where", []))
        note = f'<p class="fnote">{md(el["note"])}</p>' if el.get("note") else ""
        b = f'<div class="formula-box"><span class="eq">{md(el["eq"])}</span><table>{rows}</table>{note}</div>'
        return cues_html(el), b, ""

    def r_figure(self, el):
        w = el.get("width", 100)
        cap = f"<figcaption>{md(el['caption'])}</figcaption>" if el.get("caption") else ""
        b = f'<figure style="width:{w}%;align-self:center">{inline_svg(el["src"])}{cap}</figure>'
        return cues_html(el), b, ""

    def r_compare(self, el):
        L, R = el["left"], el["right"]
        b = f"""<div class="compare"><div><h4>{md(L['title'])}</h4>{ul(L['items'])}</div>
                <div><h4>{md(R['title'])}</h4>{ul(R['items'])}</div></div>"""
        return cues_html(el), b, ""

    def r_keywords(self, el):
        items = "".join(f"<div><b>{md(k)}</b><span>{md(v)}</span></div>" for k, v in el["items"])
        head = f'<span class="tag">{md(el.get("title", "Key words"))}</span>'
        return cues_html(el), f'{head}<div class="kw">{items}</div>', ""

    # --- callouts
    def r_examiner(self, el):
        b = f'<div class="callout examiner"><span class="tag">{md(el.get("title", "Examiner’s tip"))}</span>{paras(el["text"])}</div>'
        return cues_html(el), b, ""

    def r_fact(self, el):
        big = f'<span class="big">{md(el["big"])}</span>' if el.get("big") else ""
        b = f'<div class="callout fact"><span class="tag">{md(el.get("title", "Did you know?"))}</span>{big}{paras(el["text"])}</div>'
        return cues_html(el), b, ""

    def r_predict(self, el):
        self.n["predict"] += 1
        label = f'Predict {self.n["predict"]}'
        self.solve(label, self.answer_html(el.get("answer")))
        b = f"""<div class="callout predict"><span class="tag">{md(el.get('tag', 'Predict first · no calculator, just your gut'))}</span>
            <h3>{md(el['title'])}</h3>{paras(el.get('text'))}{opts_html(el.get('options', []), two=el.get('two', False))}
            {'<p class="given">Why do you think so?</p>' + space_html(el) if (el.get('lines') or el.get('space')) else ''}</div>"""
        g = f'<span class="glabel">{label}</span><span class="gnote">Answer in the Annex. Guess first!</span>'
        return g, b, ""

    def r_activity(self, el):
        self.n["act"] += 1
        label = f'Activity {self.n["act"]}'
        if el.get("answer"):
            self.solve(label, self.answer_html(el["answer"]))
        need = f'<p class="given"><b>You need:</b> {md(el["need"])}</p>' if el.get("need") else ""
        steps = "<ol>" + "".join(f"<li>{md(s)}</li>" for s in el.get("steps", [])) + "</ol>"
        q = f'<p><b>{md(el["question"])}</b></p>{space_html(el)}' if el.get("question") else ""
        b = f'<div class="callout activity"><span class="tag">{md(el.get("tag", "Try it at home"))}</span><h3>{md(el["title"])}</h3>{need}{steps}{q}</div>'
        return f'<span class="glabel">{label}</span>', b, ""

    # --- practice
    def r_worked_example(self, el):
        self.n["we"] += 1
        label = f'Worked example {self.n["we"]}'
        self.solve(label, steps_html(el["solution"]) + final_html(el.get("final")))
        b = f'<p class="qtext">{md(el["text"])}</p>' + (f'<p class="given">{md(el["given"])}</p>' if el.get("given") else "")
        b += space_html(el, 40)
        g = (f'<span class="glabel">{label}</span>' + (f'<span class="marks">[{el["marks"]}]</span>' if el.get("marks") else "")
             + '<span class="gnote">Try it in the box. Full solution in the Annex.</span>' + cues_html(el))
        return g, b, ""

    def r_question(self, el):
        self.n["q"] += 1
        label = f'Q{self.n["q"]}'
        body = f'<p class="qtext">{md(el["text"])}</p>' if el.get("text") else ""
        if el.get("given"):
            body += f'<p class="given">{md(el["given"])}</p>'
        sol = []
        if el.get("parts"):
            parts = []
            for i, p in enumerate(el["parts"]):
                pl = f"({'abcdefgh'[i]})"
                pm = f"[{p['marks']}]" if p.get("marks") else ""
                parts.append(f'<div class="part"><span class="pl">{pl}</span><span>{md(p["text"])}</span><span class="pm">{pm}</span>'
                             f'<div class="space-wrap" style="grid-column:2/4">{space_html(p, 20)}</div></div>')
                if p.get("answer") is not None:
                    sol.append(f'<div class="ans"><span class="pl">{pl}</span></div>{self.answer_html(p["answer"])}')
            body += f'<div class="parts">{"".join(parts)}</div>'
            total = el.get("marks") or sum(int(p.get("marks", 0)) for p in el["parts"])
        else:
            body += space_html(el, 25)
            total = el.get("marks")
            sol.append(self.answer_html(el.get("answer")))
        self.solve(label + (f' · {el["title"]}' if el.get("title") else ""), "".join(sol))
        g = (f'<span class="glabel">{label}{" · " + md(el["title"]) if el.get("title") else ""}</span>' + dots(el.get("level", ""))
             + (f'<span class="gnote">{md(el["level"]).capitalize()}</span>' if el.get("level") else "")
             + (f'<span class="marks">[{total}]</span>' if total else "") + cues_html(el))
        return g, body, ""

    def r_mcq(self, el):
        self.n["q"] += 1
        label = f'Q{self.n["q"]}'
        self.solve(f"{label} · MCQ", f'<p class="ans"><span class="ans-final">{md(el["answer"])}</span></p>' + paras(el.get("explain"), "ans"))
        b = f'<div class="mcq"><p class="qtext">{md(el["text"])}</p>{opts_html(el["options"], two=el.get("two", False))}</div>'
        g = f'<span class="glabel">{label}</span><span class="gnote">Multiple choice. Tick one box.</span><span class="marks">[1]</span>'
        return g, b, ""

    def r_error_hunt(self, el):
        self.n["eh"] += 1
        label = f'Error hunt {self.n["eh"]}'
        self.solve(label, self.answer_html(el.get("answer")))
        lines = "".join(f'<div><span class="ln">L{i + 1}</span><span>{md(l)}</span></div>' for i, l in enumerate(el["working"]))
        b = (paras(el.get("text")) + f'<div class="handwork">{lines}</div>'
             + f'<p class="given">{md(el.get("task", "Circle the line with the mistake. Then write the correct working below."))}</p>' + space_html(el, 25))
        return f'<span class="glabel">{label}</span><span class="gnote">Someone else’s working. Find the slip.</span>', b, ""

    # --- wrap-up
    def r_summary(self, el):
        b = f'<div class="summary-box"><span class="tag" style="color:var(--teal)">{md(el.get("prompt", "Summary · in your own words"))}</span>{space_html({"lines": el.get("lines", 4)})}</div>'
        return cues_html(el), b, ""

    def r_confidence(self, el):
        rows = el.get("options") or [
            ["Shaky", "Redo the cue questions tomorrow."],
            ["Getting there", "Redo the worked examples in 3 days."],
            ["Nailed it", "Cue questions only, in a week."],
        ]
        cells = "".join(f'<div><b>{md(a)}</b><span>{md(b_)}</span><span class="date">Review on ____ / ____</span></div>' for a, b_ in rows)
        b = f'<span class="tag">{md(el.get("title", "How confident are you? Tick one, then diary the review date"))}</span><div class="conf">{cells}</div>'
        return "", b, ""

    def r_annex(self, el):
        out = [f'<section class="el el-heading annex-title"><div class="g"><span class="num">A</span></div><div class="b"><h2>{md(el.get("title", "Annex · Solutions"))}</h2>{paras(el.get("intro"), "intro")}</div></section>']
        last = None
        for sec, label, body in self.solutions:
            if sec != last and sec:
                out.append(f'<section class="el el-subheading"><div class="g"></div><div class="b"><h3>{md(sec)}</h3></div></section>')
                last = sec
            out.append(f'<section class="el"><div class="g"><span class="glabel">{md(label)}</span></div><div class="b"><div class="sol">{body}</div></div></section>')
        return "", "".join(out), "raw"


def steps_html(steps):
    rows = []
    for i, s in enumerate(steps):
        note = f'<span class="note">{md(s.get("note"))}</span>' if s.get("note") else "<span></span>"
        rows.append(f'<div class="step"><span class="n">{i + 1}</span><div>{md(s.get("do"))}<span class="w">{md(s.get("work"))}</span></div>{note}</div>')
    return f'<div class="steps">{"".join(rows)}</div>'


def final_html(final):
    return f'<p class="ans">Answer: <span class="ans-final">{md(final)}</span></p>' if final else ""


def inline_svg(name):
    path = os.path.join(HERE, "diagrams", name)
    with open(path) as f:
        svg = f.read()
    return re.sub(r"<\?xml.*?\?>", "", svg)


def expand(elements, base):
    """`- include: pieces/file.yaml` pulls in another file's elements, so pieces can be shared across notes."""
    out = []
    for el in elements:
        if "include" in el:
            path = os.path.join(base, el["include"])
            with open(path) as f:
                out += expand(yaml.safe_load(f)["elements"], os.path.dirname(path))
        else:
            out.append(el)
    return out


def build(src, labels=False, html_only=False):
    with open(src) as f:
        doc = yaml.safe_load(f)
    meta = doc.get("meta", {})
    note = Note(meta, labels)
    body = "\n".join(note.render(el) for el in expand(doc["elements"], os.path.dirname(os.path.abspath(src))))

    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>{html.escape(meta.get('title', 'Lecture notes'))}</title>
<link rel="stylesheet" href="../theme/fonts.css"><link rel="stylesheet" href="../theme/notes.css">
</head><body>
<div class="running" data-course="{html.escape(meta.get('course', ''))}" data-series="{html.escape(meta.get('series', ''))}"></div>
{body}
</body></html>"""

    name = os.path.splitext(os.path.basename(src))[0] + ("-labelled" if labels else "")
    out_dir = os.path.join(HERE, "output")
    os.makedirs(out_dir, exist_ok=True)
    html_path = os.path.join(out_dir, name + ".html")
    with open(html_path, "w") as f:
        f.write(page)
    if html_only:
        print(html_path)
        return
    pdf_path = os.path.join(out_dir, name + ".pdf")
    env = dict(os.environ)
    try:
        groot = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True).stdout.strip()
        env["NODE_PATH"] = os.pathsep.join(filter(None, [env.get("NODE_PATH"), groot]))
    except FileNotFoundError:
        pass
    subprocess.run(["node", os.path.join(HERE, "render.js"), html_path, pdf_path], check=True, env=env)
    print(pdf_path)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("--labels", action="store_true", help="stamp each piece with its type name")
    ap.add_argument("--html", action="store_true", help="write HTML only, skip the PDF")
    a = ap.parse_args()
    build(a.src, a.labels, a.html)
