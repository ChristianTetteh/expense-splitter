"""Text drawing for the demo videos: Poppins, falling back to DejaVu Sans for
characters Poppins lacks (notably the cedi sign, U+20B5)."""
from fontTools.ttLib import TTFont
from PIL import ImageFont

GF = "/usr/share/fonts/truetype/google-fonts"
DV = "/usr/share/fonts/truetype/dejavu"
FACES = {
    "regular": (f"{GF}/Poppins-Regular.ttf", f"{DV}/DejaVuSans.ttf"),
    "medium": (f"{GF}/Poppins-Medium.ttf", f"{DV}/DejaVuSans.ttf"),
    "bold": (f"{GF}/Poppins-Bold.ttf", f"{DV}/DejaVuSans-Bold.ttf"),
}
_cmaps = {}


def _covered(path):
    if path not in _cmaps:
        _cmaps[path] = set(TTFont(path).getBestCmap())
    return _cmaps[path]


class Font:
    def __init__(self, face, size):
        main, fb = FACES[face]
        self.main = ImageFont.truetype(main, size)
        self.fb = ImageFont.truetype(fb, size)
        self.cover = _covered(main)
        self.size = size

    def runs(self, text):
        out = []
        for ch in text:
            f = self.main if ord(ch) in self.cover or ch == " " else self.fb
            if out and out[-1][1] is f:
                out[-1][0] += ch
            else:
                out.append([ch, f])
        return out

    def width(self, text):
        return sum(f.getlength(t) for t, f in self.runs(text))

    def draw(self, d, xy, text, fill):
        x, y = xy
        for t, f in self.runs(text):
            d.text((x, y), t, font=f, fill=fill)
            x += f.getlength(t)


def wrap(font, text, max_w):
    lines, cur = [], ""
    for word in text.split():
        trial = f"{cur} {word}".strip()
        if font.width(trial) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines
