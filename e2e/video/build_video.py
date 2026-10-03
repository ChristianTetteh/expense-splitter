"""Builds a finished demo video from a recording made by record-demo.js.

Layout (1920x1080): the app fills the top 1920x930; captions sit in their own
150px bar underneath, so they never cover the app. At each freeze moment the
picture pauses, everything except the feature is blurred and dimmed, and a
line leads from the feature to a card explaining it; then the demo resumes.

Usage: python3 build_video.py <config.json>
config: {"rec": dir, "out": file.mp4, "title", "tagline", "subtitle",
         "built_with", "points", "url"}
"""
import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(__file__))
from music import make as make_music  # noqa: E402
from textkit import Font, wrap  # noqa: E402

W, H, APP_H = 1920, 1080, 930
BAND = (15, 19, 32)
INK = (21, 26, 45)
MUTED = (86, 96, 116)
ACCENT = (29, 63, 187)
GLOW = (255, 214, 102)
FPS = 30
FADE_IN, FADE_OUT = 0.45, 0.45


def ff(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def enc():
    return ["-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-r", str(FPS)]


# ── Callout frame ───────────────────────────────────────────────────────

def rounded_mask(size, r):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], r, fill=255)
    return m


def callout_image(shot_path, box, title, body, out_path):
    shot = Image.open(shot_path).convert("RGB")
    x, y, w, h = box
    pad = 12
    x0, y0 = max(0, int(x - pad)), max(0, int(y - pad))
    x1, y1 = min(W, int(x + w + pad)), min(APP_H, int(y + h + pad))

    bg = shot.filter(ImageFilter.GaussianBlur(9))
    bg = Image.blend(bg, Image.new("RGB", bg.size, (8, 11, 22)), 0.58)
    crop = shot.crop((x0, y0, x1, y1))
    bg.paste(crop, (x0, y0), rounded_mask(crop.size, 14))
    d = ImageDraw.Draw(bg)
    d.rounded_rectangle([x0 - 3, y0 - 3, x1 + 2, y1 + 2], 16, outline=GLOW, width=4)

    eyebrow_f, title_f, body_f = Font("bold", 20), Font("bold", 40), Font("regular", 28)
    card_w, pad_c = 600, 36
    t_lines = wrap(title_f, title, card_w - 2 * pad_c)
    b_lines = wrap(body_f, body, card_w - 2 * pad_c)
    card_h = pad_c + 30 + len(t_lines) * 52 + 14 + len(b_lines) * 42 + pad_c - 6

    # Put the card where there is most room, then draw a leader line to it.
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    gap = 90
    space = {"right": W - x1, "left": x0, "below": APP_H - y1, "above": y0}
    if max(space["right"], space["left"]) >= card_w + gap + 40:
        side = "right" if space["right"] >= space["left"] else "left"
        kx = x1 + gap if side == "right" else x0 - gap - card_w
        ky = min(max(cy - card_h / 2, 30), APP_H - card_h - 30)
        a = (x1 + 2, cy) if side == "right" else (x0 - 3, cy)
        b = (kx, ky + card_h / 2) if side == "right" else (kx + card_w, ky + card_h / 2)
    else:
        side = "below" if space["below"] >= space["above"] else "above"
        kx = min(max(cx - card_w / 2, 40), W - card_w - 40)
        ky = y1 + gap if side == "below" else y0 - gap - card_h
        ky = min(max(ky, 20), APP_H - card_h - 20)
        a = (cx, y1 + 2) if side == "below" else (cx, y0 - 3)
        b = (kx + card_w / 2, ky) if side == "below" else (kx + card_w / 2, ky + card_h)
    d.line([a, b], fill=GLOW, width=4)
    for (px, py), r in ((a, 9), (b, 7)):
        d.ellipse([px - r, py - r, px + r, py + r], fill=GLOW)

    card = Image.new("RGBA", (card_w + 40, int(card_h) + 40), (0, 0, 0, 0))
    shadow = Image.new("RGBA", card.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([20, 26, card_w + 20, card_h + 26], 22, fill=(0, 0, 0, 120))
    shadow = shadow.filter(ImageFilter.GaussianBlur(12))
    bg.paste(shadow, (int(kx) - 20, int(ky) - 20), shadow)
    d.rounded_rectangle([kx, ky, kx + card_w, ky + card_h], 22, fill=(255, 255, 255))
    d.rectangle([kx, ky + 26, kx + 6, ky + 26 + 34], fill=ACCENT)
    ty = ky + pad_c - 4
    eyebrow_f.draw(d, (kx + pad_c, ty), "HOW IT WORKS", ACCENT)
    ty += 34
    for line in t_lines:
        title_f.draw(d, (kx + pad_c, ty), line, INK)
        ty += 52
    ty += 14
    for line in b_lines:
        body_f.draw(d, (kx + pad_c, ty), line, MUTED)
        ty += 42
    bg.save(out_path)


# ── Cards and caption bar ───────────────────────────────────────────────

def centered(d, font, text, y, fill):
    font.draw(d, ((W - font.width(text)) / 2, y), text, fill)


def title_card(cfg, path):
    im = Image.new("RGB", (W, H), BAND)
    d = ImageDraw.Draw(im)
    centered(d, Font("bold", 150), cfg["title"], 300, (255, 255, 255))
    centered(d, Font("regular", 50), cfg["tagline"], 520, (199, 210, 254))
    centered(d, Font("regular", 32), cfg["subtitle"], 610, (156, 163, 175))
    im.save(path)


def end_card(cfg, path):
    im = Image.new("RGB", (W, H), BAND)
    d = ImageDraw.Draw(im)
    centered(d, Font("bold", 38), "Built with", 240, (156, 163, 175))
    centered(d, Font("bold", 58), cfg["built_with"], 300, (255, 255, 255))
    centered(d, Font("regular", 34), cfg["points"], 430, (199, 210, 254))
    centered(d, Font("bold", 36), "Live demo", 620, (156, 163, 175))
    centered(d, Font("bold", 64), cfg["url"], 680, (255, 255, 255))
    im.save(path)


def caption_png(text, path):
    im = Image.new("RGBA", (W, H - APP_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    f = Font("medium", 40)
    lines = wrap(f, text, W - 240)
    y = (H - APP_H - len(lines) * 54) / 2 - 2
    for line in lines:
        f.draw(d, ((W - f.width(line)) / 2, y), line, (255, 255, 255))
        y += 54
    im.save(path)


# ── Assembly ────────────────────────────────────────────────────────────

def main(cfg_path):
    cfg = json.load(open(cfg_path))
    rec = cfg["rec"]
    work = os.path.join(rec, "build")
    os.makedirs(work, exist_ok=True)
    tl = json.load(open(os.path.join(rec, "timeline.json")))
    start, end = tl["start"], tl["end"]
    frames = [(f["file"], f["t"] - start) for f in tl["frames"]]
    freezes = sorted(tl["freezes"], key=lambda z: z["t"])

    def frames_between(s, e):
        """(file, duration) entries covering [s, e): the frame on screen at s, then each new frame."""
        cur = frames[0][0]
        for f, t in frames:
            if t <= s:
                cur = f
        seq = [(cur, s)] + [(f, t) for f, t in frames if s < t < e]
        return [(f, (seq[i + 1][1] if i + 1 < len(seq) else e) - t) for i, (f, t) in enumerate(seq)]

    pieces, offset_map = [], []
    bounds = [0.0] + [z["t"] - start for z in freezes] + [end - start]
    added = 0.0
    for i in range(len(bounds) - 1):
        s, e = bounds[i], bounds[i + 1]
        lst = os.path.join(work, f"seg{i}.txt")
        with open(lst, "w") as fh:
            fh.write("ffconcat version 1.0\n")
            entries = frames_between(s, e)
            for f, dur in entries:
                fh.write(f"file '{f}'\nduration {max(dur, 0.001):.4f}\n")
            fh.write(f"file '{entries[-1][0]}'\n")
        seg = os.path.join(work, f"seg{i}.mp4")
        ff("-f", "concat", "-safe", "0", "-i", lst, "-vf", f"fps={FPS},scale={W}:{APP_H}", *enc(), "-t", f"{e - s:.4f}", seg)
        pieces.append(seg)
        if i < len(freezes):
            z = freezes[i]
            words = len((z["title"] + " " + z["body"]).split())
            hold = min(7.0, max(3.4, words / 3.5 + 0.8))
            callout = os.path.join(work, f"callout{i}.png")
            callout_image(z["shot"], z["box"], z["title"], z["body"], callout)
            fz = os.path.join(work, f"freeze{i}.mp4")
            a1, b_len, a2 = 0.25 + FADE_IN, hold + FADE_IN + FADE_OUT, 0.6
            off2 = 0.25 + FADE_IN + hold
            total = off2 + a2
            ff("-loop", "1", "-t", f"{a1}", "-i", z["shot"], "-loop", "1", "-t", f"{b_len}", "-i", callout,
               "-loop", "1", "-t", f"{a2}", "-i", z["shot"],
               "-filter_complex",
               f"[0]scale={W}:{APP_H},fps={FPS},format=yuv420p[a];[1]scale={W}:{APP_H},fps={FPS},format=yuv420p[b];"
               f"[2]scale={W}:{APP_H},fps={FPS},format=yuv420p[c];"
               f"[a][b]xfade=fade:duration={FADE_IN}:offset=0.25[ab];[ab][c]xfade=fade:duration={FADE_OUT}:offset={off2}[v]",
               "-map", "[v]", *enc(), fz)
            pieces.append(fz)
            offset_map.append((z["t"] - start, total))
            added += total

    def out_t(t):
        return t + sum(d for ft, d in offset_map if ft <= t)

    app_list = os.path.join(work, "app.txt")
    with open(app_list, "w") as fh:
        fh.write("".join(f"file '{p}'\n" for p in pieces))
    app = os.path.join(work, "app.mp4")
    ff("-f", "concat", "-safe", "0", "-i", app_list, "-c", "copy", app)
    app_len = (end - start) + added

    # Captions in the bar below the app.
    caps = tl["captions"]
    inputs, filters, last = ["-i", app], [f"[0]pad={W}:{H}:0:0:color=0x{BAND[0]:02x}{BAND[1]:02x}{BAND[2]:02x}[base]"], "base"
    for i, c in enumerate(caps):
        a = out_t(c["t"] - start)
        b = out_t(caps[i + 1]["t"] - start) if i + 1 < len(caps) else app_len
        png = os.path.join(work, f"cap{i}.png")
        caption_png(c["text"], png)
        inputs += ["-loop", "1", "-t", f"{app_len:.3f}", "-i", png]
        filters.append(f"[{i + 1}]format=rgba,fade=in:st={a:.3f}:d=0.3:alpha=1,fade=out:st={max(a, b - 0.3):.3f}:d=0.3:alpha=1[c{i}]")
        filters.append(f"[{last}][c{i}]overlay=0:{APP_H}:enable='between(t,{a:.3f},{b:.3f})'[o{i}]")
        last = f"o{i}"
    filters.append(f"[{last}]fade=in:d=0.5,fade=out:st={app_len - 0.6:.3f}:d=0.6[v]")
    main_mp4 = os.path.join(work, "main.mp4")
    ff(*inputs, "-filter_complex", ";".join(filters), "-map", "[v]", *enc(), "-t", f"{app_len:.3f}", main_mp4)

    # Title and end cards.
    for name, fn, dur in (("intro", title_card, 4.0), ("outro", end_card, 6.0)):
        png = os.path.join(work, f"{name}.png")
        fn(cfg, png)
        ff("-loop", "1", "-t", f"{dur}", "-i", png, "-vf", f"fps={FPS},format=yuv420p,fade=in:d=0.6,fade=out:st={dur - 0.6}:d=0.6",
           *enc(), os.path.join(work, f"{name}.mp4"))
    full_list = os.path.join(work, "full.txt")
    with open(full_list, "w") as fh:
        fh.write("".join(f"file '{os.path.join(work, p)}'\n" for p in ("intro.mp4", "main.mp4", "outro.mp4")))
    silent = os.path.join(work, "silent.mp4")
    ff("-f", "concat", "-safe", "0", "-i", full_list, "-c", "copy", silent)

    total = 4.0 + app_len + 6.0
    chimes = [4.0 + out_t(ft) + 0.25 for ft, _ in offset_map]
    # out_t(ft) includes this freeze's own pause; the chime belongs at its start.
    chimes = [c - d for c, (_, d) in zip(chimes, offset_map)]
    wav = os.path.join(work, "music.wav")
    make_music(total, chimes, wav)
    ff("-i", silent, "-i", wav, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
       "-shortest", "-movflags", "+faststart", cfg["out"])
    print(f"wrote {cfg['out']} ({total:.1f}s, {len(freezes)} callouts)")


if __name__ == "__main__":
    main(sys.argv[1])
