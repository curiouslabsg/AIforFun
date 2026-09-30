"""Generate the Light chapter diagrams from real geometry.

    python3 diagrams/src/light.py

Every angle comes from the law of reflection or Snell's law, and every lens
diagram from where the construction rays actually cross, so the drawings are
to scale. Edit the numbers below and re-run to change a diagram.
"""
import math, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

INK, MUTED, TEAL, TEAL_T, CORAL, BLUE, GRID, AMBER = (
    "#1d2433", "#5d6577", "#0f6e74", "#e5f3f2", "#d4533b", "#3563c9", "#dbe7ea", "#f4b740")
FONT = 'font-family="Nunito, sans-serif"'
N_GLASS = 1.5


# ------------------------------------------------------------------ primitives
class SVG:
    def __init__(self, w, h, label, pid):
        self.w, self.h, self.label, self.pid, self.parts = w, h, label, pid, []

    def add(self, s):
        self.parts.append(s)

    def line(self, x1, y1, x2, y2, color=INK, width=1.5, dash=None, opacity=1):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        o = f' opacity="{opacity}"' if opacity != 1 else ""
        self.add(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{color}" stroke-width="{width}"{d}{o} stroke-linecap="round"/>')

    def arrowhead(self, x1, y1, x2, y2, color=CORAL, at=0.5, size=6, opacity=1):
        a = math.atan2(y2 - y1, x2 - x1)
        mx, my = x1 + (x2 - x1) * at, y1 + (y2 - y1) * at
        c, s = math.cos(a), math.sin(a)
        tip = (mx + c * size * 0.6, my + s * size * 0.6)
        b1 = (mx - c * size * 0.6 - s * size * 0.5, my - s * size * 0.6 + c * size * 0.5)
        b2 = (mx - c * size * 0.6 + s * size * 0.5, my - s * size * 0.6 - c * size * 0.5)
        o = f' opacity="{opacity}"' if opacity != 1 else ""
        self.add(f'<polygon points="{tip[0]:.1f},{tip[1]:.1f} {b1[0]:.1f},{b1[1]:.1f} {b2[0]:.1f},{b2[1]:.1f}" fill="{color}"{o}/>')

    def ray(self, p, q, color=CORAL, width=2, arrow=True, dash=None, opacity=1, at=0.5):
        self.line(*p, *q, color=color, width=width, dash=dash, opacity=opacity)
        if arrow:
            self.arrowhead(*p, *q, color=color, at=at, opacity=opacity)

    def text(self, x, y, s, size=11, color=INK, anchor="start", weight=700, italic=False):
        st = ' font-style="italic"' if italic else ""
        self.add(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}"{st}>{s}</text>')

    def arc(self, cx, cy, r, a1, a2, color=INK, width=1.2):
        """Arc between two directions given in degrees (SVG angles: 0 = +x, 90 = +y/down)."""
        x1, y1 = cx + r * math.cos(math.radians(a1)), cy + r * math.sin(math.radians(a1))
        x2, y2 = cx + r * math.cos(math.radians(a2)), cy + r * math.sin(math.radians(a2))
        sweep = 1 if (a2 - a1) % 360 < 180 else 0
        self.add(f'<path d="M{x1:.1f} {y1:.1f} A{r} {r} 0 0 {sweep} {x2:.1f} {y2:.1f}" fill="none" stroke="{color}" stroke-width="{width}"/>')

    def save(self, name):
        body = "\n  ".join(self.parts)
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" {FONT} role="img" aria-label="{self.label}">\n'
               f"  {body}\n</svg>\n")
        with open(os.path.join(OUT, name), "w") as f:
            f.write(svg)


def ang(dx, dy):
    return math.degrees(math.atan2(dy, dx))


def mirror_hatch(s, x1, y1, x2, y2, side=1, step=9, length=7):
    """Draw a mirror line with short hatch marks on its back (side=+1: right/below)."""
    s.line(x1, y1, x2, y2, color=INK, width=3)
    L = math.hypot(x2 - x1, y2 - y1)
    ux, uy = (x2 - x1) / L, (y2 - y1) / L
    nx, ny = -uy * side, ux * side
    # hatch slanted 45 degrees behind the mirror
    n = int(L // step)
    for k in range(n + 1):
        px, py = x1 + ux * k * step, y1 + uy * k * step
        s.line(px, py, px + (nx + ux) * length * 0.72, py + (ny + uy) * length * 0.72, color=MUTED, width=1)


# ------------------------------------------------------------------ reflection
def reflection_law():
    s = SVG(340, 185, "Law of reflection: a ray hits a plane mirror; the angle of incidence equals the angle of reflection, both measured from the normal", "rl")
    P = (170, 150)
    i = 40
    L = 125
    A = (P[0] - L * math.sin(math.radians(i)), P[1] - L * math.cos(math.radians(i)))
    B = (P[0] + L * math.sin(math.radians(i)), P[1] - L * math.cos(math.radians(i)))
    mirror_hatch(s, 40, 150, 300, 150, side=-1)
    s.line(P[0], P[1], P[0], 20, color=MUTED, width=1.3, dash="5 4")
    s.ray(A, P)
    s.ray(P, B)
    s.arc(P[0], P[1], 38, ang(A[0] - P[0], A[1] - P[1]), -90)
    s.arc(P[0], P[1], 38, -90, ang(B[0] - P[0], B[1] - P[1]))
    s.text(P[0] - 16, P[1] - 44, "i", 13, INK, "middle", 900, italic=True)
    s.text(P[0] + 16, P[1] - 44, "r", 13, INK, "middle", 900, italic=True)
    s.text(P[0] + 6, 26, "normal", 10.5, MUTED)
    s.text(A[0] - 4, A[1] - 6, "incident ray", 10.5, CORAL, "middle", 800)
    s.text(B[0] + 4, B[1] - 6, "reflected ray", 10.5, CORAL, "middle", 800)
    s.text(300, 176, "plane mirror", 10.5, MUTED, "end")
    s.text(P[0], 176, "point of incidence", 9.5, MUTED, "middle")
    s.save("reflection-law.svg")


def plane_mirror_image():
    s = SVG(360, 235, "Image in a plane mirror: rays from an object reflect off the mirror and appear to come from a virtual image the same distance behind the mirror", "pm")
    mx = 200
    O = (115, 125)
    I = (2 * mx - O[0], O[1])
    mirror_hatch(s, mx, 25, mx, 205, side=1)
    for my in (70, 170):
        M = (mx, my)
        # reflected ray continues the line from the image through M
        dx, dy = M[0] - I[0], M[1] - I[1]
        L = math.hypot(dx, dy)
        E = (M[0] - dx / L * 95, M[1] - dy / L * 95)
        s.ray(O, M)
        s.ray(M, E, at=0.55)
        s.line(*M, *I, color=CORAL, width=1.4, dash="4 4")
    s.add(f'<circle cx="{O[0]}" cy="{O[1]}" r="5" fill="{AMBER}" stroke="{INK}" stroke-width="1.5"/>')
    s.add(f'<circle cx="{I[0]}" cy="{I[1]}" r="5" fill="#ffffff" stroke="{INK}" stroke-width="1.5" stroke-dasharray="2 2"/>')
    s.text(O[0], O[1] + 22, "object", 10.5, INK, "middle", 800)
    s.text(I[0], I[1] + 22, "image", 10.5, INK, "middle", 800)
    s.text(I[0], I[1] + 35, "(virtual)", 9.5, MUTED, "middle")
    for x1, x2 in ((O[0], mx), (mx, I[0])):
        s.line(x1 + 3, 222, x2 - 3, 222, color=INK, width=1)
        s.line(x1, 216, x1, 228, color=INK, width=1)
        s.line(x2, 216, x2, 228, color=INK, width=1)
        s.text((x1 + x2) / 2, 216, "d", 11, INK, "middle", 900, italic=True)
    s.text(mx, 18, "mirror", 10.5, MUTED, "middle")
    s.save("plane-mirror-image.svg")


def grid(s, x0, y0, cols, rows, cell):
    for c in range(cols + 1):
        s.line(x0 + c * cell, y0, x0 + c * cell, y0 + rows * cell, color=GRID, width=0.8)
    for r in range(rows + 1):
        s.line(x0, y0 + r * cell, x0 + cols * cell, y0 + r * cell, color=GRID, width=0.8)


def object_arrow(s, x, ybase, ytip, color=TEAL, dashed=False, width=2.4):
    d = "5 3" if dashed else None
    s.line(x, ybase, x, ytip, color=color, width=width, dash=d)
    up = ytip < ybase
    h = 7 if up else -7
    fill = color if not dashed else "#ffffff"
    s.add(f'<polygon points="{x:.1f},{ytip:.1f} {x - 5:.1f},{ytip + h:.1f} {x + 5:.1f},{ytip + h:.1f}" fill="{fill}" stroke="{color}" stroke-width="1.2"/>')


def mirror_construction(solution):
    cell = 16
    cols, rows = 20, 11
    x0, y0 = 10, 10
    s = SVG(cols * cell + 20, rows * cell + 20,
            "Grid with a vertical plane mirror, an object arrow and an eye" + (", with the image and two rays constructed" if solution else ""), "mc")
    grid(s, x0, y0, cols, rows, cell)
    X = lambda c: x0 + c * cell
    Y = lambda r: y0 + r * cell
    mc = 10
    mirror_hatch(s, X(mc), Y(1), X(mc), Y(10), side=1, step=8)
    ob, ot = (X(6), Y(9)), (X(6), Y(5))
    eye = (X(2), Y(2))
    object_arrow(s, ob[0], ob[1], ot[1])
    s.text(ob[0], Y(9) + 13, "object", 9.5, TEAL, "middle", 800)
    # eye glyph
    s.add(f'<path d="M{eye[0]-9} {eye[1]} Q{eye[0]} {eye[1]-7} {eye[0]+9} {eye[1]} Q{eye[0]} {eye[1]+7} {eye[0]-9} {eye[1]} Z" fill="#ffffff" stroke="{INK}" stroke-width="1.3"/>')
    s.add(f'<circle cx="{eye[0]+3}" cy="{eye[1]}" r="2.6" fill="{INK}"/>')
    s.text(eye[0], eye[1] - 12, "eye", 9.5, INK, "middle", 800)
    if solution:
        ib, it = (X(14), Y(9)), (X(14), Y(5))
        object_arrow(s, ib[0], ib[1], it[1], color=TEAL, dashed=True)
        s.text(ib[0], Y(9) + 13, "image", 9.5, TEAL, "middle", 800)
        for src, img in ((ot, it), (ob, ib)):
            # where the line image -> eye meets the mirror
            t = (X(mc) - img[0]) / (eye[0] - img[0])
            M = (X(mc), img[1] + (eye[1] - img[1]) * t)
            s.ray(src, M, width=1.8)
            s.ray(M, eye, width=1.8)
            s.line(*M, *img, color=CORAL, width=1.3, dash="4 3")
    s.save("mirror-construct-" + ("answer" if solution else "task") + ".svg")


# ------------------------------------------------------------------ refraction
def glass_block():
    s = SVG(380, 272, "Refraction through a rectangular glass block: the ray bends towards the normal on entering and away from the normal on leaving, emerging parallel to the incident ray", "gb")
    top, bot, left, right = 80, 190, 90, 330
    s.add(f'<rect x="{left}" y="{top}" width="{right-left}" height="{bot-top}" fill="{TEAL_T}" stroke="{TEAL}" stroke-width="1.8"/>')
    i = 50
    r = math.degrees(math.asin(math.sin(math.radians(i)) / N_GLASS))
    P = (160, top)
    d = (math.sin(math.radians(i)), math.cos(math.radians(i)))
    A = (P[0] - 85 * d[0], P[1] - 85 * d[1])
    Q = (P[0] + (bot - top) * math.tan(math.radians(r)), bot)
    E = (Q[0] + 70 * d[0], Q[1] + 70 * d[1])
    # dashed path the ray would have taken with no block
    s.line(P[0], P[1], P[0] + 150 * d[0], P[1] + 150 * d[1], color=MUTED, width=1, dash="3 4")
    for pt in (P, Q):
        s.line(pt[0], pt[1] - 42, pt[0], pt[1] + 42, color=MUTED, width=1.2, dash="5 4")
    s.ray(A, P)
    s.ray(P, Q)
    s.ray(Q, E)
    s.arc(P[0], P[1], 30, ang(A[0] - P[0], A[1] - P[1]), -90)
    s.arc(P[0], P[1], 30, 90, ang(Q[0] - P[0], Q[1] - P[1]) + 360)
    s.text(P[0] - 13, P[1] - 36, "i", 12.5, INK, "middle", 900, italic=True)
    s.text(P[0] + 9, P[1] + 44, "r", 12.5, INK, "middle", 900, italic=True)
    s.text(right - 8, top + 18, "glass (optically denser)", 10.5, TEAL, "end", 800)
    s.text(20, 30, "air", 11, MUTED, weight=800)
    s.text(P[0] + 14, top - 26, "bends towards the normal", 10, CORAL, weight=800)
    s.text(Q[0] - 12, bot + 22, "bends away from the normal", 10, CORAL, "end", 800)
    s.text(E[0] + 4, E[1] + 16, "emergent ray, parallel to incident ray", 9.5, MUTED, "end")
    s.save("glass-block.svg")
    return r


def tir_panel(s, cx, top, R, i, label, sub):
    s.add(f'<path d="M{cx-R} {top} A{R} {R} 0 0 0 {cx+R} {top} Z" fill="{TEAL_T}" stroke="{TEAL}" stroke-width="1.6"/>')
    s.line(cx, top - 55, cx, top + R + 8, color=MUTED, width=1.1, dash="5 4")
    ri = math.radians(i)
    A = (cx - R * math.sin(ri), top + R * math.cos(ri))
    Rf = (cx + R * math.sin(ri), top + R * math.cos(ri))
    start = (A[0] - 18 * math.sin(ri), A[1] + 18 * math.cos(ri))
    s.ray(start, A, at=0.6)
    s.ray(A, (cx, top), at=0.55)
    sc = math.sin(ri) * N_GLASS
    if sc < 1 - 1e-6:
        th = math.asin(sc)
        out = (cx + 62 * math.sin(th), top - 62 * math.cos(th))
        s.ray((cx, top), out)
        s.ray((cx, top), Rf, width=1.3, opacity=0.35)
    elif sc <= 1 + 1e-6:
        s.ray((cx, top), (cx + R + 12, top), at=0.6)
        s.ray((cx, top), Rf, width=1.3, opacity=0.35)
    else:
        s.ray((cx, top), Rf, width=2.4)
    s.arc(cx, top, 24, 90, ang(A[0] - cx, A[1] - top))
    s.text(cx - 9, top + 38, "i", 11.5, INK, "middle", 900, italic=True)
    s.text(cx, top + R + 24, label, 11, INK, "middle", 900)
    s.text(cx, top + R + 38, sub, 9.5, MUTED, "middle")


def tir_panels():
    c = math.degrees(math.asin(1 / N_GLASS))
    s = SVG(540, 215, "Semicircular glass block with light hitting the flat face from inside at three angles: below, equal to and above the critical angle", "tp")
    tir_panel(s, 90, 70, 62, 25, "i < c", "refracts out, weak reflection")
    tir_panel(s, 270, 70, 62, c, "i = c", "refracted ray skims the surface")
    tir_panel(s, 450, 70, 62, 58, "i > c", "total internal reflection")
    s.text(12, 22, "air", 11, MUTED, weight=800)
    s.text(12, 120, "glass", 11, TEAL, weight=800)
    s.save("tir-panels.svg")
    return c


def optical_fibre():
    s = SVG(420, 170, "Optical fibre: light bounces along the glass core by total internal reflection at the boundary with the cladding", "of")
    x0, x1 = 50, 405
    s.add(f'<rect x="{x0}" y="35" width="{x1-x0}" height="100" rx="6" fill="#f1f4f8" stroke="{MUTED}" stroke-width="1.2"/>')
    s.add(f'<rect x="{x0}" y="57" width="{x1-x0}" height="56" fill="{TEAL_T}" stroke="{TEAL}" stroke-width="1.2"/>')
    a = math.radians(24)          # ray angle to the fibre axis inside the core
    out = math.asin(N_GLASS * math.sin(a))
    entry = (x0, 97)
    start = (entry[0] - 40 * math.cos(out), entry[1] + 40 * math.sin(out))
    s.ray(start, entry)
    pts = [entry]
    x, y, up = entry[0], entry[1], True
    while True:
        ty = 57 if up else 113
        nx = x + abs(y - ty) / math.tan(a)
        if nx > x1:
            nx = x1
            ty = y - (x1 - x) * math.tan(a) if up else y + (x1 - x) * math.tan(a)
            pts.append((nx, ty))
            break
        pts.append((nx, ty))
        x, y, up = nx, ty, not up
    for p, q in zip(pts, pts[1:]):
        s.ray(p, q, width=1.9)
    b = pts[1]
    s.text(b[0], 150, "total internal reflection at every bounce", 10, CORAL, "middle", 800)
    s.line(b[0], 140, b[0], b[1] + 4, color=CORAL, width=0.9)
    s.text(x1 - 6, 51, "cladding: lower refractive index", 9.5, MUTED, "end", 800)
    s.text(x1 - 6, 128, "core: higher refractive index", 9.5, TEAL, "end", 800)
    s.save("optical-fibre.svg")


def prism(answer):
    s = SVG(320, 270, "Right-angled glass prism with a ray entering one short face at right angles" + (" and being totally internally reflected through 90 degrees" if answer else ""), "pr")
    A, B, C = (90, 30), (90, 200), (260, 200)
    s.add(f'<polygon points="{A[0]},{A[1]} {B[0]},{B[1]} {C[0]},{C[1]}" fill="{TEAL_T}" stroke="{TEAL}" stroke-width="1.8"/>')
    s.add(f'<path d="M{B[0]} {B[1]-12} H{B[0]+12} V{B[1]}" fill="none" stroke="{TEAL}" stroke-width="1.2"/>')
    y = 150
    hx = A[0] + (y - A[1]) * (C[0] - A[0]) / (C[1] - A[1])   # hypotenuse point at this height
    s.ray((15, y), (B[0], y))
    s.ray((B[0], y), (hx, y))
    s.text(24, y - 8, "ray", 10, CORAL, weight=800)
    s.text(A[0] - 8, A[1] + 4, "45°", 10, TEAL, "end", 800)
    s.text(C[0] + 4, C[1] + 14, "45°", 10, TEAL, weight=800)
    if answer:
        nx, ny = 1 / math.sqrt(2), -1 / math.sqrt(2)
        s.line(hx - 38 * nx, y - 38 * ny, hx + 38 * nx, y + 38 * ny, color=MUTED, width=1.1, dash="5 4")
        s.ray((hx, y), (hx, C[1]))
        s.ray((hx, C[1]), (hx, 262))
        s.arc(hx, y, 22, 135, 180)
        s.text(hx - 26, y + 22, "45°", 10, INK, "end", 900)
        s.text(hx + 10, 250, "turned through 90°", 10, CORAL, weight=800)
    s.save("prism-" + ("answer" if answer else "task") + ".svg")


# ------------------------------------------------------------------ lenses
def lens_shape(s, x, yc, half):
    w = 9
    s.add(f'<path d="M{x} {yc-half} Q{x+w*2.2} {yc} {x} {yc+half} Q{x-w*2.2} {yc} {x} {yc-half} Z" fill="#dff0fb" stroke="{BLUE}" stroke-width="1.6"/>')


def lens_beam():
    s = SVG(380, 215, "A converging lens brings a parallel beam of light to a point, the principal focus F, one focal length from the optical centre", "lb")
    xl, ya, f = 180, 100, 110
    lens_shape(s, xl, ya, 72)
    s.line(20, ya, 365, ya, color=MUTED, width=1.1)
    F = (xl + f, ya)
    for h in (-52, -26, 26, 52):
        s.ray((25, ya + h), (xl, ya + h), width=1.8)
        dx, dy = F[0] - xl, F[1] - (ya + h)
        k = 1.55
        s.ray((xl, ya + h), (xl + dx * k, ya + h + dy * k), width=1.8, at=0.4)
    s.add(f'<circle cx="{F[0]}" cy="{F[1]}" r="3.2" fill="{INK}"/>')
    s.text(F[0] + 2, ya - 8, "F", 12, INK, "middle", 900)
    s.add(f'<circle cx="{xl}" cy="{ya}" r="2.6" fill="{INK}"/>')
    s.text(xl - 22, ya - 6, "C", 11, INK, "end", 900)
    s.line(xl, 200, F[0], 200, color=INK, width=1)
    s.line(xl, 194, xl, 206, color=INK, width=1)
    s.line(F[0], 194, F[0], 206, color=INK, width=1)
    s.text((xl + F[0]) / 2, 194, "focal length f", 10, INK, "middle", 900)
    s.text(25, ya - 60, "parallel rays", 10, CORAL, weight=800)
    s.text(22, ya - 6, "principal axis", 9, MUTED)
    s.save("lens-beam.svg")


def lens_rules():
    s = SVG(560, 170, "The three construction rays for a converging lens", "lr")
    specs = [(95, "1", "parallel to the axis →", "through F on the far side"),
             (280, "2", "through the optical centre →", "carries straight on"),
             (465, "3", "through F on the near side →", "comes out parallel")]
    f, ya = 48, 85
    for xl, n, a, b in specs:
        lens_shape(s, xl, ya, 55)
        s.line(xl - 88, ya, xl + 88, ya, color=MUTED, width=1)
        for fx in (xl - f, xl + f):
            s.add(f'<circle cx="{fx}" cy="{ya}" r="2.5" fill="{INK}"/>')
            s.text(fx, ya + 15, "F", 10, INK, "middle", 900)
        if n == "1":
            s.ray((xl - 85, ya - 34), (xl, ya - 34), width=2)
            s.ray((xl, ya - 34), (xl + 85, ya - 34 + 34 * 85 / f), width=2, at=0.35)
        elif n == "2":
            s.ray((xl - 85, ya - 40), (xl + 85, ya + 40), width=2, at=0.25)
        else:
            # passes through the near F on its way to the lens, 40 units above the axis
            p0 = (xl - 85, ya + (85 - f) * 40 / f)
            p1 = (xl, ya - 40)
            s.ray(p0, p1, width=2, at=0.3)
            s.ray(p1, (xl + 85, ya - 40), width=2)
        s.text(xl, 150, a, 9.5, INK, "middle", 800)
        s.text(xl, 163, b, 9.5, CORAL, "middle", 800)
        s.add(f'<circle cx="{xl - 82}" cy="18" r="9" fill="{TEAL}"/>')
        s.text(xl - 82, 22, n, 10.5, "#ffffff", "middle", 900)
    s.save("lens-rules.svg")


def lens_diagram(name, f, u, h, px, xmin, xmax, ymax, ymin, show, label, grid_on=True, rays3=True):
    """Scale ray diagram. Lengths in cm; px = SVG units per cm. Object at x=-u, height h.
    show: 'task' (object, lens, F marks only) or 'answer' (rays + image)."""
    W = (xmax - xmin) * px
    H = (ymax - ymin) * px
    s = SVG(W + 20, H + 34, label, name)
    X = lambda x: 10 + (x - xmin) * px
    Y = lambda y: 10 + (ymax - y) * px
    if grid_on:
        grid(s, 10, 10, int(xmax - xmin), int(ymax - ymin), px)
    s.line(X(xmin), Y(0), X(xmax), Y(0), color=MUTED, width=1.2)
    # lens drawn as a line with outward arrowheads (the exam convention)
    top, bot = Y(ymax - 0.4), Y(ymin + 0.4)
    s.line(X(0), top, X(0), bot, color=BLUE, width=2.4)
    s.add(f'<polygon points="{X(0)},{top-6} {X(0)-6},{top+3} {X(0)+6},{top+3}" fill="{BLUE}"/>')
    s.add(f'<polygon points="{X(0)},{bot+6} {X(0)-6},{bot-3} {X(0)+6},{bot-3}" fill="{BLUE}"/>')
    for k, lab in ((-2, "2F"), (-1, "F"), (1, "F"), (2, "2F")):
        xf = k * f
        if xmin < xf < xmax:
            s.add(f'<circle cx="{X(xf):.1f}" cy="{Y(0):.1f}" r="2.8" fill="{INK}"/>')
            s.text(X(xf), Y(0) + 15, lab, 10, INK, "middle", 900)
    object_arrow(s, X(-u), Y(0), Y(h))
    s.text(X(-u), Y(0) + 15, "object", 9.5, TEAL, "middle", 800)
    if show == "answer":
        v = 1 / (1 / f - 1 / u)           # real-is-positive: v > 0 real, v < 0 virtual
        hi = -h * v / u
        tip = (-u, h)
        edge = xmax - 0.3

        def end(x0, y0, m):
            """Point where a ray from (x0, y0) with slope m leaves the drawing area."""
            x = edge
            y = y0 + m * (x - x0)
            lo, hi_ = ymin + 0.2, ymax - 0.2
            if y < lo:
                x, y = x0 + (lo - y0) / m, lo
            elif y > hi_:
                x, y = x0 + (hi_ - y0) / m, hi_
            return X(x), Y(y)
        # ray 1: parallel, then through far F
        s.ray((X(tip[0]), Y(h)), (X(0), Y(h)), width=1.9)
        slope = (0 - h) / (f - 0)
        s.ray((X(0), Y(h)), end(0, h, slope), width=1.9, at=0.3)
        # ray 2: through optical centre
        s2 = -h / u
        s.ray((X(tip[0]), Y(h)), end(tip[0], h, s2), width=1.9, at=0.2)
        if v > 0:
            if rays3 and u > f:
                y_at_lens = h + (0 - h) / (-f - tip[0]) * (0 - tip[0])
                if ymin < y_at_lens < ymax:
                    s.ray((X(tip[0]), Y(h)), (X(0), Y(y_at_lens)), width=1.9)
                    s.ray((X(0), Y(y_at_lens)), (X(edge), Y(y_at_lens)), width=1.9)
            object_arrow(s, X(v), Y(0), Y(hi), color=CORAL)
            if X(v) + 62 < X(xmax):   # label on whichever side of the image has room
                s.text(X(v) + 5, Y(0) - 6, "image (real)", 9.5, CORAL, "start", 800)
            else:
                s.text(X(v) - 5, Y(0) - 6, "image (real)", 9.5, CORAL, "end", 800)
        else:
            # trace the rays back (dashed) to where they appear to come from
            s.line(X(0), Y(h), X(v - 0.6), Y(h + slope * (v - 0.6)), color=CORAL, width=1.3, dash="4 3")
            s.line(X(tip[0]), Y(h), X(v - 0.6), Y(h + s2 * (v - 0.6 - tip[0])), color=CORAL, width=1.3, dash="4 3")
            object_arrow(s, X(v), Y(0), Y(hi), color=CORAL, dashed=True)
            s.text(X(v), Y(hi) - 9, "image (virtual)", 9.5, CORAL, "middle", 800)
    if grid_on:
        s.text(10, H + 30, "Scale: 1 square = 1 cm", 9.5, MUTED)
    s.save(name + ".svg")


def cover():
    s = SVG(480, 250, "Light entering a semicircular glass block at three angles: one refracts out, one skims the surface at the critical angle, one is totally internally reflected", "cv")
    s.add('<defs><radialGradient id="cv-g" cx="0.5" cy="0" r="0.9"><stop offset="0" stop-color="#e8f5f7"/><stop offset="1" stop-color="#bfe0e6"/></radialGradient></defs>')
    s.add(f'<rect x="0" y="0" width="480" height="250" rx="10" fill="#10263a"/>')
    cx, top, R = 240, 95, 125
    s.add(f'<path d="M{cx-R} {top} A{R} {R} 0 0 0 {cx+R} {top} Z" fill="url(#cv-g)" opacity="0.95"/>')
    c = math.degrees(math.asin(1 / N_GLASS))
    for i, col in ((22, "#f4b740"), (c, "#ff8a6b"), (60, "#7ce0d3")):
        ri = math.radians(i)
        A = (cx - R * math.sin(ri), top + R * math.cos(ri))
        st = (A[0] - 60 * math.sin(ri), A[1] + 60 * math.cos(ri))
        s.line(*st, cx, top, color=col, width=4)
        sc = N_GLASS * math.sin(ri)
        if sc < 1 - 1e-6:
            th = math.asin(sc)
            s.line(cx, top, cx + 150 * math.sin(th), top - 150 * math.cos(th), color=col, width=4)
        elif sc <= 1 + 1e-6:
            s.line(cx, top, cx + 230, top, color=col, width=4)
        else:
            s.line(cx, top, cx + (R + 60) * math.sin(ri), top + (R + 60) * math.cos(ri), color=col, width=4)
    s.add(f'<circle cx="{cx}" cy="{top}" r="5" fill="#ffffff"/>')
    s.text(18, 30, "refracts", 11, "#f4b740", weight=900)
    s.text(18, 46, "skims at the critical angle", 11, "#ff8a6b", weight=900)
    s.text(18, 62, "trapped: total internal reflection", 11, "#7ce0d3", weight=900)
    s.save("cover-light.svg")


def ambulance():
    s = SVG(300, 70, "The word AMBULANCE printed in mirror writing", "am")
    s.add(f'<rect x="1" y="1" width="298" height="68" rx="8" fill="#ffffff" stroke="{CORAL}" stroke-width="2"/>')
    s.add(f'<text x="150" y="47" font-size="34" font-weight="900" fill="{CORAL}" text-anchor="middle" '
          f'transform="translate(300 0) scale(-1 1)" letter-spacing="1">AMBULANCE</text>')
    s.save("ambulance.svg")


if __name__ == "__main__":
    ambulance()
    reflection_law()
    plane_mirror_image()
    mirror_construction(False)
    mirror_construction(True)
    r = glass_block()
    c = tir_panels()
    optical_fibre()
    prism(False)
    prism(True)
    lens_beam()
    lens_rules()
    # concept diagrams (no grid): object beyond 2F, and object inside F (magnifying glass)
    lens_diagram("lens-case-far", f=4, u=10, h=2.4, px=14, xmin=-12, xmax=12, ymax=3.6, ymin=-3.2, show="answer",
                 label="Object beyond 2F: the image is real, inverted and diminished, between F and 2F on the other side", grid_on=False)
    lens_diagram("lens-case-magnifier", f=5, u=3, h=1.5, px=14, xmin=-10, xmax=8, ymax=4.6, ymin=-1.6, show="answer",
                 label="Object between F and the lens: the image is virtual, upright and magnified, on the same side as the object", grid_on=False)
    # worked example (scale drawing): f = 8 cm, u = 12 cm, h = 3 cm
    for mode in ("task", "answer"):
        lens_diagram(f"lens-we-{mode}", f=8, u=12, h=3, px=10, xmin=-18, xmax=28, ymax=5, ymin=-8, show=mode,
                     label="Grid for a scale ray diagram: converging lens of focal length 8 cm, object 3 cm tall placed 12 cm from the lens")
    # practice (magnifying glass): f = 6 cm, u = 4 cm, h = 2 cm
    for mode in ("task", "answer"):
        lens_diagram(f"lens-mag-{mode}", f=6, u=4, h=2, px=12, xmin=-16, xmax=14, ymax=8, ymin=-3, show=mode,
                     label="Grid for a scale ray diagram: converging lens of focal length 6 cm, object 2 cm tall placed 4 cm from the lens")
    cover()
    print(f"glass block r = {r:.1f} deg, critical angle = {c:.1f} deg")
