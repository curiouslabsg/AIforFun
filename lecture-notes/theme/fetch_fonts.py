"""Download the note fonts from Google Fonts into theme/fonts and write theme/fonts.css.
Run once (the fonts are committed, so you only need this to change fonts)."""
import os, re, subprocess, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
FAMILIES = [
    # (Google CSS query, subsets to keep)
    ("family=Nunito:ital,wght@0,400;0,600;0,700;0,800;0,900;1,400;1,700", {"latin", "latin-ext"}),
    ("family=Kalam:wght@400;700", {"latin"}),
    # Rounded display face for the junior (Sec 1–2) theme
    ("family=Fredoka:wght@500;600;700", {"latin", "latin-ext"}),
    # Rounded fallback that carries Greek letters (rho) and maths symbols Nunito lacks
    ("family=M+PLUS+Rounded+1c:wght@500;800", {"greek", "latin-ext", "symbols"}),
]

out = []
for query, keep in FAMILIES:
    req = urllib.request.Request(f"https://fonts.googleapis.com/css2?{query}&display=swap", headers={"User-Agent": UA})
    css = urllib.request.urlopen(req).read().decode()
    for subset, block in re.findall(r"/\* ([\w-]+) \*/\s*(@font-face\s*{[^}]*})", css):
        if subset not in keep:
            continue
        url = re.search(r"url\((\S+?)\)", block).group(1)
        name = os.path.basename(url)
        path = os.path.join(HERE, "fonts", name)
        if not os.path.exists(path):
            subprocess.run(["curl", "-sS", "-o", path, url], check=True)
        out.append(block.replace(url, f"fonts/{name}"))

with open(os.path.join(HERE, "fonts.css"), "w") as f:
    f.write("\n".join(out) + "\n")
print(f"{len(out)} font faces written to theme/fonts.css")
