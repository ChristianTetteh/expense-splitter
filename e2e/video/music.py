"""Background bed for the demo videos: a calm, slow ambient pad with a soft
bass and a quiet pulse. No melody, so it doesn't compete with the screen.
Also places a soft chime at each freeze-frame callout.
Usage: python3 music.py <seconds> <out.wav> [chime_time ...]"""
import sys
import wave

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

SR = 44100
rng = np.random.default_rng(7)


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def lowpass(x, hz, order=2):
    return sosfilt(butter(order, hz, fs=SR, output="sos"), x)


def soft_saw(f, t, harmonics=6):
    # A few harmonics with steep roll-off: warm, not buzzy.
    return sum(np.sin(2 * np.pi * f * k * t) / k ** 1.6 for k in range(1, harmonics + 1))


def make(dur, chimes=(), out="music.wav"):
    n = int(SR * dur)
    t = np.arange(n) / SR
    bar = 3.0                     # 80 bpm in 4/4
    chord_len = 2 * bar           # each chord lasts two bars
    # Fmaj9, Am7, Dm9, Bbmaj7: warm and unresolved, so it loops without "arriving".
    chords = [
        (41, [57, 60, 64, 67]),
        (45, [57, 60, 64, 67]),
        (38, [57, 60, 64, 65]),
        (46, [57, 62, 65, 69]),
    ]
    pad = np.zeros(n)
    bass = np.zeros(n)
    pulse = np.zeros(n)
    for i in range(int(dur // chord_len) + 2):
        root, notes = chords[i % len(chords)]
        s = int(i * chord_len * SR)
        if s >= n:
            break
        L = min(n - s, int((chord_len + 2.5) * SR))
        tt = np.arange(L) / SR
        env = np.minimum(1, tt / 1.6) * np.where(tt < chord_len, 1, np.exp(-(tt - chord_len) / 0.9))
        for m in notes:
            for cents in (-6, 0, 7):
                f = midi(m) * 2 ** (cents / 1200)
                pad[s:s + L] += soft_saw(f, tt + rng.random()) * env * 0.022
        bass[s:s + L] += np.sin(2 * np.pi * midi(root) * tt) * env * 0.16
        # Quiet pulse: chord tones on the eighth notes, each a short muted tone.
        for k in range(int(chord_len / (bar / 8))):
            ps = s + int(k * (bar / 8) * SR)
            if ps >= n:
                break
            m = notes[[0, 2, 1, 3, 2, 1, 3, 2][k % 8]] + 12
            pl = min(n - ps, int(0.5 * SR))
            pt = np.arange(pl) / SR
            accent = 1.0 if k % 2 == 0 else 0.7
            tone = (np.sin(2 * np.pi * midi(m) * pt) + 0.25 * np.sin(4 * np.pi * midi(m) * pt)) * np.exp(-pt * 9)
            pulse[ps:ps + pl] += tone * 0.03 * accent
    pad = lowpass(pad, 1400, 2)
    pulse = lowpass(pulse, 2200, 2)
    mix = pad + bass + pulse
    # Small room reverb: decaying noise impulse response.
    ir_t = np.arange(int(1.6 * SR)) / SR
    ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t / 0.45)
    ir = lowpass(ir, 3500) / np.sqrt(np.sum(ir ** 2))
    wet = fftconvolve(mix, ir)[:n]
    mix = 0.8 * mix + 0.35 * wet

    for c in chimes:
        cs = int(c * SR)
        if cs >= n:
            continue
        cl = min(n - cs, int(1.6 * SR))
        ct = np.arange(cl) / SR
        bell = (np.sin(2 * np.pi * 1046.5 * ct) + 0.5 * np.sin(2 * np.pi * 1568 * ct) + 0.2 * np.sin(2 * np.pi * 2093 * ct))
        mix[cs:cs + cl] += bell * np.exp(-ct * 3.2) * np.minimum(1, ct / 0.01) * 0.05

    fade = np.minimum(1, np.minimum(t / 2.5, (dur - t) / 3.0))
    mix *= np.clip(fade, 0, 1)
    mix = mix / (np.abs(mix).max() + 1e-9) * 0.19   # quiet bed: sits well under the screen action
    left = mix
    right = np.roll(mix, int(0.012 * SR)) * 0.96 + mix * 0.04
    st = np.stack([left, right], 1)
    with wave.open(out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((st * 32767).astype(np.int16).tobytes())


if __name__ == "__main__":
    make(float(sys.argv[1]), [float(x) for x in sys.argv[3:]], sys.argv[2])
