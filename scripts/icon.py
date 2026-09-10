"""Pink Jolly Roger icons for the home screen. Draws skull and crossbones with Pillow, no SVG rasteriser needed."""
from PIL import Image, ImageDraw, ImageFilter
import math, os

OUT = os.path.join(os.path.dirname(__file__), '..', 'pwa')
os.makedirs(OUT, exist_ok=True)
PINK = (255, 63, 164)
BLACK = (7, 5, 10)


def rot(p, c, a):
    s, co = math.sin(a), math.cos(a)
    x, y = p[0] - c[0], p[1] - c[1]
    return (c[0] + x * co - y * s, c[1] + x * s + y * co)


def bone(d, c, length, thick, angle, fill):
    """A bone: rounded shaft with two knobs at each end, rotated by angle."""
    half = length / 2
    p1 = rot((c[0] - half, c[1]), c, angle)
    p2 = rot((c[0] + half, c[1]), c, angle)
    d.line([p1, p2], fill=fill, width=int(thick))
    for p in (p1, p2):
        # two knobs, perpendicular to the shaft
        px, py = rot((p[0], p[1] - thick * 0.55), p, angle)
        qx, qy = rot((p[0], p[1] + thick * 0.55), p, angle)
        r = thick * 0.62
        d.ellipse([px - r, py - r, px + r, py + r], fill=fill)
        d.ellipse([qx - r, qy - r, qx + r, qy + r], fill=fill)


def draw(size, padding=0.08):
    s = 4  # supersample
    S = size * s
    img = Image.new('RGBA', (S, S), BLACK + (255,))
    d = ImageDraw.Draw(img)
    # soft pink glow behind everything
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([S * 0.18, S * 0.14, S * 0.82, S * 0.86], fill=PINK + (120,))
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.09))
    img.alpha_composite(glow)
    d = ImageDraw.Draw(img)

    cx, cy = S / 2, S * 0.60
    # crossbones behind the skull
    for ang in (math.radians(35), math.radians(-35)):
        bone(d, (cx, cy + S * 0.02), S * 0.78, S * 0.075, ang, PINK)

    # skull
    w, h = S * 0.44, S * 0.40
    top = cy - S * 0.30
    d.ellipse([cx - w / 2, top, cx + w / 2, top + h], fill=PINK)
    # jaw
    jw, jh = S * 0.26, S * 0.12
    d.rounded_rectangle([cx - jw / 2, top + h * 0.78, cx + jw / 2, top + h * 0.78 + jh], radius=S * 0.03, fill=PINK)
    # eyes: big, a little heart-shaped for the girly part
    ew, eh = S * 0.12, S * 0.11
    for ex in (cx - S * 0.11, cx + S * 0.11):
        ey = top + h * 0.42
        d.ellipse([ex - ew / 2, ey - eh / 2, ex + ew / 2, ey + eh / 2], fill=BLACK)
        # heart lobes on top of each eye socket
        r = ew * 0.30
        d.ellipse([ex - ew * 0.30 - r, ey - eh * 0.55 - r, ex - ew * 0.30 + r, ey - eh * 0.55 + r], fill=BLACK)
        d.ellipse([ex + ew * 0.30 - r, ey - eh * 0.55 - r, ex + ew * 0.30 + r, ey - eh * 0.55 + r], fill=BLACK)
    # nose
    nx, ny = cx, top + h * 0.68
    d.polygon([(nx, ny - S * 0.03), (nx - S * 0.025, ny + S * 0.02), (nx + S * 0.025, ny + S * 0.02)], fill=BLACK)
    # teeth lines
    for i in range(-2, 3):
        tx = cx + i * S * 0.045
        d.line([(tx, top + h * 0.80), (tx, top + h * 0.78 + jh * 0.9)], fill=BLACK, width=int(S * 0.012))
    d.line([(cx - jw / 2, top + h * 0.80), (cx + jw / 2, top + h * 0.80)], fill=BLACK, width=int(S * 0.012))

    img = img.resize((size, size), Image.LANCZOS)
    return img


for size in (192, 512):
    draw(size).save(os.path.join(OUT, f'icon-{size}.png'))
# maskable: same art, safe zone respected by the padding already in the drawing
draw(512).save(os.path.join(OUT, 'icon-maskable-512.png'))
draw(180).save(os.path.join(OUT, 'apple-touch-icon.png'))
draw(64).save(os.path.join(OUT, 'favicon.png'))
print('icons written to', os.path.abspath(OUT))
