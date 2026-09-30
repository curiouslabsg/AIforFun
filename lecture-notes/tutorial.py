#!/usr/bin/env python3
"""Build an exam-style tutorial (PDF and DOCX) from a YAML file.

    python3 tutorial.py tutorials/light.yaml     # -> output/tutorial-light.pdf and .docx

Layout follows the CuriousLab Tutorials skill: Kurzgesagt-style cover, one-page
concept summary, Paper 1 (20 MCQ) and Paper 2 (Section A + B) with exam covers,
then a full answer key.
"""
import html, os, re, subprocess, sys
from collections import Counter
import yaml

from build import HERE, md, paras, inline_svg, steps_html

LETTERS = "ABCD"
ROMAN = ["I", "II", "III", "IV"]


# ---------------------------------------------------------------- checks
def check(doc):
    qs = doc["paper1"]["questions"]
    if len(qs) != 20:
        sys.exit(f"Paper 1 needs 20 questions, found {len(qs)}.")
    dist = Counter(q["answer"] for q in qs)
    if any(dist[l] != 5 for l in LETTERS):
        sys.exit(f"Paper 1 answers should be 5 A / 5 B / 5 C / 5 D, found {dict(dist)}.")
    pats = {q["pattern"] for q in qs}
    missing = {"grid", "row", "list", "roman", "table"} - pats
    if missing:
        sys.exit(f"Paper 1 does not use these option patterns: {missing}")
    a = sum(total(q) for q in doc["paper2"]["sectionA"])
    b = [total(q) for q in doc["paper2"]["sectionB"]]
    print(f"Paper 1: 20 MCQ, answers {dict(sorted(dist.items()))}. Paper 2: Section A {a} marks, Section B {b}.")
    return a, b


def total(q):
    return sum(int(p.get("marks", 0)) for p in q["parts"])


# ---------------------------------------------------------------- answers
def answer_html(ans):
    if ans is None:
        return ""
    if not isinstance(ans, list):
        return f'<p class="ans">{md(ans)}</p>'
    out, run = [], []
    for a in ans + [None]:
        if isinstance(a, dict) and ("do" in a or "work" in a):
            run.append(a)
            continue
        if run:
            out.append(steps_html(run))
            run = []
        if a is None:
            continue
        if isinstance(a, dict) and "figure" in a:
            out.append(f'<figure style="width:{a.get("width", 100)}%">{inline_svg(a["figure"])}</figure>')
        else:
            out.append(f'<p class="ans">{md(a)}</p>')
    return "".join(out)


# ---------------------------------------------------------------- HTML pieces
def cover(m):
    q = m["quote"]
    return f"""<section class="tcover">
  <div class="ctop"><span>{md(m['series'])}</span><span>{md(m['course'])}</span></div>
  <div class="cnum">Tutorial {m['number']}</div>
  <h1>{md(m['title'])}</h1>
  <p class="csub">{md(m['subtitle'])}</p>
  <blockquote><p>“{md(q['text'].strip('“”‘’"'))}”</p><cite>{md(q['by'])}</cite></blockquote>
  <div class="cart">{inline_svg('cover-light.svg')}</div>
  <div class="placeholder">Infographic placeholder · drop the NotebookLM infographic for this chapter here</div>
  <div class="cfoot"><span>Paper 1 · 20 marks · 30 min</span><span>Paper 2 · 40 marks · 45 min</span><span>Total · 60 marks</span></div>
</section>"""


def summary(items, m):
    boxes = "".join(
        f'<div class="kbox k-{b["colour"]}"><h3>{md(b["title"])}</h3><ul>'
        + "".join(f"<li>{md(i)}</li>" for i in b["items"]) + "</ul></div>" for b in items)
    return f'<section class="page summary" style="page:summary"><div class="running" data-head="Tutorial {m["number"]} · Concept summary"></div><h2 class="shead">Concept summary</h2><div class="kcols">{boxes}</div></section>'


def paper_cover(m, n, title, time, marks, instructions, examiner=None):
    ins = "".join(f"<li>{md(i)}</li>" for i in instructions)
    ex = ""
    if examiner:
        rows = "".join(f"<tr><td>{md(r)}</td><td></td><td>{md(t)}</td></tr>" for r, t in examiner)
        ex = f'<table class="exam-use"><thead><tr><th colspan="3">For examiner’s use</th></tr></thead><tbody>{rows}<tr class="tot"><td>Total</td><td></td><td>{marks}</td></tr></tbody></table>'
    return f"""<section class="pcover">
  <div class="pc-top"><span>{md(m['series'])}</span><span>{md(m['course'])}</span></div>
  <div class="pc-title"><span class="pc-sub">Tutorial {m['number']} · {md(m['title'])}</span><h2>Paper {n} · {md(title)}</h2><span class="pc-time">{md(time)} · {marks} marks</span></div>
  <table class="cand"><tr><td>Name</td><td></td></tr><tr><td>Class</td><td></td></tr><tr><td>Register number</td><td></td></tr></table>
  <div class="instr"><h3>Read these instructions first</h3><ul>{ins}</ul></div>
  {ex}
</section>"""


def options_html(q):
    o, p = q.get("options", []), q["pattern"]
    L = lambda i: f'<b class="L">{LETTERS[i]}</b>'
    if p == "grid":
        return '<div class="og">' + "".join(f"<div>{L(i)}{md(x)}</div>" for i, x in enumerate(o)) + "</div>"
    if p == "row":
        return '<div class="orow">' + "".join(f"<div>{L(i)}{md(x)}</div>" for i, x in enumerate(o)) + "</div>"
    if p == "list":
        return '<div class="olist">' + "".join(f"<div>{L(i)}{md(x)}</div>" for i, x in enumerate(o)) + "</div>"
    if p == "roman":
        st = "".join(f"<tr><td>{ROMAN[i]}</td><td>{md(s)}</td></tr>" for i, s in enumerate(q["statements"]))
        return f'<table class="roman">{st}</table><div class="og">' + "".join(f"<div>{L(i)}{md(x)}</div>" for i, x in enumerate(o)) + "</div>"
    if p == "table":
        t = q["table"]
        head = "".join(f"<th>{md(h)}</th>" for h in t["headers"])
        rows = "".join(f"<tr><th>{LETTERS[i]}</th>" + "".join(f"<td>{md(c)}</td>" for c in r) + "</tr>" for i, r in enumerate(t["rows"]))
        return f'<table class="otable"><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table>'
    sys.exit(f"Unknown option pattern {p!r}")


def paper1(m, qs):
    out = []
    for i, q in enumerate(qs, 1):
        fig = f'<figure>{inline_svg(q["figure"])}</figure>' if q.get("figure") else ""
        out.append(f'<div class="mcq"><div class="qn">{i}</div><div class="qb"><p>{md(q["stem"])}</p>{fig}{options_html(q)}</div><div class="bracket">(&emsp;&emsp;)</div></div>')
    return f'<section class="page p1" style="page:p1"><div class="running" data-head="Tutorial {m["number"]} · Paper 1"></div>{"".join(out)}<p class="end">End of Paper 1</p></section>'


def part_html(p, label):
    if p.get("calc"):
        c = p["calc"]
        space = f'<div class="calc"><span class="work"></span><span class="res">{md(c["label"])} = <span class="dots"></span> {md(c.get("unit", ""))}</span></div>'
    elif p.get("lines"):
        space = '<div class="dl">' + "<div></div>" * int(p["lines"]) + "</div>"
    else:
        space = ""
    return (f'<div class="part"><span class="pl">{label}</span><div class="pt"><p>{md(p["text"])}</p>{space}</div>'
            f'<span class="pm">[{p["marks"]}]</span></div>')


def structured(q, n):
    fig = f'<figure>{inline_svg(q["figure"])}</figure>' if q.get("figure") else ""
    tbl = ""
    if q.get("table"):
        t = q["table"]
        head = "".join(f"<th>{md(h)}</th>" for h in t["headers"])
        rows = "".join("<tr>" + "".join(f'<td class="{"blank" if not c else ""}">{md(c)}</td>' for c in r) + "</tr>" for r in t["rows"])
        tbl = f'<table class="dtable"><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table>'
    parts = "".join(part_html(p, f"({'abcdefgh'[i]})") for i, p in enumerate(q["parts"]))
    return (f'<div class="sq"><div class="stem"><span class="qn">{n}</span><p>{md(q["stem"])}</p></div>{tbl}{fig}{parts}'
            f'<p class="totalm">[Total: {total(q)}]</p></div>')


def paper2(m, p2):
    a = "".join(structured(q, i) for i, q in enumerate(p2["sectionA"], 1))
    k = len(p2["sectionA"])
    b = "".join(structured(q, k + i) for i, q in enumerate(p2["sectionB"], 1))
    return (f'<section class="page p2" style="page:p2"><div class="running" data-head="Tutorial {m["number"]} · Paper 2"></div>'
            f'<h2 class="sec">Section A <small>Answer <b>all</b> questions.</small></h2>{a}'
            f'<h2 class="sec newpage">Section B <small>Answer <b>one</b> question.</small></h2>{b}<p class="end">End of Paper 2</p></section>')


def key(m, doc):
    rows = "".join(f'<tr><td>{i}</td><td class="letter">{q["answer"]}</td><td>{md(q["explain"])}</td></tr>'
                   for i, q in enumerate(doc["paper1"]["questions"], 1))
    p1 = f'<div class="kbox k-cyan keybox"><h3>Paper 1 · Multiple choice</h3><table class="keyt"><thead><tr><th>Q</th><th>Ans</th><th>Why</th></tr></thead><tbody>{rows}</tbody></table></div>'
    blocks = []
    allq = doc["paper2"]["sectionA"] + doc["paper2"]["sectionB"]
    for n, q in enumerate(allq, 1):
        ps = "".join(f'<div class="kp"><span class="pl">({"abcdefgh"[i]})</span><div>{answer_html(p.get("answer"))}</div><span class="pm">[{p["marks"]}]</span></div>'
                     for i, p in enumerate(q["parts"]))
        blocks.append(f'<div class="kbox k-green keybox"><h3>Paper 2 · Question {n} <small>[{total(q)}]</small></h3>{ps}</div>')
    return f'<section class="page key" style="page:key"><div class="running" data-head="Tutorial {m["number"]} · Answer key"></div><h2 class="shead">Answer key</h2>{p1}{"".join(blocks)}</section>'


P1_INSTR = [
    "Write your name, class and register number in the spaces above.",
    "There are **twenty** questions in this paper. Answer **all** questions.",
    "For each question there are four possible answers, **A**, **B**, **C** and **D**. Choose the one you consider correct and write its letter in the brackets provided.",
    "Each correct answer scores one mark. A mark is not deducted for a wrong answer.",
    "Any rough working should be done in this booklet. The use of an approved scientific calculator is expected, where appropriate.",
    "Take the speed of light in a vacuum as 3.0 × 10^{8} m/s.",
]
P2_INSTR = [
    "Write your name, class and register number in the spaces above.",
    "**Section A:** answer **all** questions in the spaces provided.",
    "**Section B:** answer **one** question in the spaces provided.",
    "Show your working. Omission of essential working will result in loss of marks.",
    "The number of marks is given in brackets [ ] at the end of each question or part question.",
    "Take the speed of light in a vacuum as 3.0 × 10^{8} m/s.",
]


def page_rules(m):
    """Chromium has no running strings, so each part is a named page with its own header text."""
    right = f"{m['title']} · {m['course']}"
    heads = {"summary": "Concept summary", "p1": "Paper 1 · Multiple choice", "p2": "Paper 2 · Structured", "key": "Answer key"}
    return "".join(f'@page {k}{{@top-left{{content:"Tutorial {m["number"]} · {v}"}} @top-right{{content:"{right}"}}}}' for k, v in heads.items())


def build_html(doc):
    m = doc["meta"]
    a, b = check(doc)
    exam = [(f"Section A · Q{i}", total(q)) for i, q in enumerate(doc["paper2"]["sectionA"], 1)]
    exam.append(("Section B · Q" + " / Q".join(str(len(doc["paper2"]["sectionA"]) + i) for i in range(1, len(b) + 1)), b[0]))
    body = "\n".join([
        cover(m),
        summary(doc["summary"], m),
        paper_cover(m, 1, "Multiple Choice", doc["paper1"]["time"], 20, P1_INSTR),
        paper1(m, doc["paper1"]["questions"]),
        paper_cover(m, 2, "Structured Questions", doc["paper2"]["time"], a + b[0], P2_INSTR, exam),
        paper2(m, doc["paper2"]),
        key(m, doc),
    ])
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Tutorial {m['number']} · {html.escape(m['title'])}</title>
<link rel="stylesheet" href="../theme/fonts.css"><link rel="stylesheet" href="../theme/tutorial.css">
<style>{page_rules(m)}</style></head><body>{body}</body></html>"""


def main(src):
    with open(src) as f:
        doc = yaml.safe_load(f)
    name = "tutorial-" + os.path.splitext(os.path.basename(src))[0]
    out = os.path.join(HERE, "output")
    html_path = os.path.join(out, name + ".html")
    with open(html_path, "w") as f:
        f.write(build_html(doc))
    env = dict(os.environ)
    groot = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True).stdout.strip()
    env["NODE_PATH"] = os.pathsep.join(filter(None, [env.get("NODE_PATH"), groot]))
    subprocess.run(["node", os.path.join(HERE, "render.js"), html_path, os.path.join(out, name + ".pdf")], check=True, env=env)
    print(os.path.join(out, name + ".pdf"))
    from tutorial_docx import write_docx
    print(write_docx(doc, os.path.join(out, name + ".docx"), env))


if __name__ == "__main__":
    main(sys.argv[1])
