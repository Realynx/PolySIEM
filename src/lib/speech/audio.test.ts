import { describe, expect, it } from "vitest";
import {
  computeRms,
  decodeWav,
  downmixToMono,
  encodeWav,
  resampleLinear,
  trimSilence,
} from "./audio";

/** Build a mono sine wave for a given frequency/rate/duration. */
function sine(freq: number, sampleRate: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(sampleRate * seconds));
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

describe("resampleLinear", () => {
  it("downsamples 48 kHz to 16 kHz with a 1/3 length ratio", () => {
    const input = sine(440, 48000, 1); // 48000 samples
    const out = resampleLinear(input, 48000, 16000);
    expect(out.length).toBe(16000);
  });

  it("upsamples 8 kHz to 16 kHz by doubling length", () => {
    const input = new Float32Array(8000);
    const out = resampleLinear(input, 8000, 16000);
    expect(out.length).toBe(16000);
  });

  it("returns a copy (not the same ref) when rates match", () => {
    const input = sine(200, 16000, 0.1);
    const out = resampleLinear(input, 16000, 16000);
    expect(out).not.toBe(input);
    expect(Array.from(out)).toEqual(Array.from(input));
  });

  it("preserves a constant signal's value after resampling", () => {
    const input = new Float32Array(1000).fill(0.5);
    const out = resampleLinear(input, 44100, 16000);
    expect(out.length).toBe(Math.round(1000 * (16000 / 44100)));
    for (const v of out) expect(v).toBeCloseTo(0.5, 5);
  });

  it("handles empty input", () => {
    expect(resampleLinear(new Float32Array(0), 44100, 16000).length).toBe(0);
  });

  it("rejects non-positive rates", () => {
    expect(() => resampleLinear(new Float32Array(4), 0, 16000)).toThrow();
    expect(() => resampleLinear(new Float32Array(4), 16000, -1)).toThrow();
  });
});

describe("downmixToMono", () => {
  it("averages two channels element-wise", () => {
    const left = new Float32Array([1, 0, -1, 0.5]);
    const right = new Float32Array([0, 1, 1, -0.5]);
    const mono = downmixToMono([left, right]);
    expect(Array.from(mono)).toEqual([0.5, 0.5, 0, 0]);
  });

  it("returns a copy for a single channel", () => {
    const only = new Float32Array([0.1, 0.2]);
    const mono = downmixToMono([only]);
    expect(mono).not.toBe(only);
    expect(mono[0]).toBeCloseTo(0.1, 6);
    expect(mono[1]).toBeCloseTo(0.2, 6);
  });

  it("does not mutate the input channels", () => {
    const left = new Float32Array([1, 1]);
    const right = new Float32Array([0, 0]);
    downmixToMono([left, right]);
    expect(Array.from(left)).toEqual([1, 1]);
    expect(Array.from(right)).toEqual([0, 0]);
  });

  it("handles no channels", () => {
    expect(downmixToMono([]).length).toBe(0);
  });
});

describe("computeRms", () => {
  it("is 0 for silence and ~0.707 for a full-scale sine", () => {
    expect(computeRms(new Float32Array(100))).toBe(0);
    expect(computeRms(sine(440, 16000, 1))).toBeCloseTo(Math.SQRT1_2, 2);
  });
});

describe("trimSilence", () => {
  it("removes leading and trailing silence but keeps the speech", () => {
    const rate = 16000;
    const silence = new Float32Array(rate); // 1 s of zeros
    const tone = sine(300, rate, 0.5); // 0.5 s of signal
    const clip = new Float32Array(silence.length + tone.length + silence.length);
    clip.set(silence, 0);
    clip.set(tone, silence.length);
    clip.set(silence, silence.length + tone.length);

    const trimmed = trimSilence(clip, rate, { padSeconds: 0 });
    // Should be close to the tone length (within one analysis window).
    expect(trimmed.length).toBeLessThan(clip.length);
    expect(trimmed.length).toBeGreaterThanOrEqual(tone.length - rate * 0.02);
    expect(trimmed.length).toBeLessThanOrEqual(tone.length + rate * 0.04);
  });

  it("returns the original clip when it is entirely silent", () => {
    const clip = new Float32Array(8000);
    const trimmed = trimSilence(clip, 16000);
    expect(trimmed.length).toBe(clip.length);
  });
});

describe("encodeWav / decodeWav round-trip", () => {
  it("round-trips mono samples within 16-bit quantization error", () => {
    const rate = 16000;
    const original = sine(440, rate, 0.25);
    const wav = encodeWav(original, rate);
    const decoded = decodeWav(wav);

    expect(decoded.sampleRate).toBe(rate);
    expect(decoded.channels).toBe(1);
    expect(decoded.samples.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(decoded.samples[i]).toBeCloseTo(original[i], 3);
    }
  });

  it("produces a 44-byte header + 2 bytes per sample", () => {
    const samples = new Float32Array([0, 0.5, -0.5]);
    const wav = encodeWav(samples, 16000);
    expect(wav.byteLength).toBe(44 + samples.length * 2);
  });

  it("clamps out-of-range samples", () => {
    const wav = encodeWav(new Float32Array([2, -2]), 16000);
    const decoded = decodeWav(wav);
    expect(decoded.samples[0]).toBeCloseTo(1, 3);
    expect(decoded.samples[1]).toBeCloseTo(-1, 3);
  });

  it("averages a stereo WAV down to mono on decode", () => {
    // Hand-build a tiny 2-channel, 16-bit WAV: L=+1.0, R=-1.0 -> mono 0.
    const frames = 4;
    const channels = 2;
    const dataSize = frames * channels * 2;
    const buf = new ArrayBuffer(44 + dataSize);
    const v = new DataView(buf);
    const put = (o: number, s: string) => {
      for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
    };
    put(0, "RIFF");
    v.setUint32(4, 36 + dataSize, true);
    put(8, "WAVE");
    put(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, channels, true);
    v.setUint32(24, 16000, true);
    v.setUint32(28, 16000 * channels * 2, true);
    v.setUint16(32, channels * 2, true);
    v.setUint16(34, 16, true);
    put(36, "data");
    v.setUint32(40, dataSize, true);
    let o = 44;
    for (let f = 0; f < frames; f++) {
      v.setInt16(o, 0x7fff, true); // left ~ +1
      v.setInt16(o + 2, -0x8000, true); // right = -1
      o += 4;
    }
    const decoded = decodeWav(buf);
    expect(decoded.channels).toBe(2);
    expect(decoded.samples.length).toBe(frames);
    for (const s of decoded.samples) expect(s).toBeCloseTo(0, 2);
  });
});
