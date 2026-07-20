/**
 * Pure, dependency-free audio helpers for the local speech-to-text pipeline.
 *
 * These run on plain `Float32Array`/`ArrayBuffer` values so they are trivially
 * unit-testable with synthetic buffers (no Web Audio, no DOM). The browser side
 * (mic capture, `AudioContext.decodeAudioData`) lives in the hook; everything
 * here is math on samples.
 *
 * PRIVACY: these helpers only transform in-memory audio samples. They perform
 * no I/O and send nothing anywhere.
 */

/**
 * Downmix one-or-more equal-length channels to a single mono channel by
 * averaging. Returns a new buffer; inputs are not mutated.
 */
export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0].slice();

  const length = channels[0].length;
  const out = new Float32Array(length);
  const channelCount = channels.length;

  for (let c = 0; c < channelCount; c++) {
    const channel = channels[c];
    for (let i = 0; i < length; i++) {
      out[i] += channel[i];
    }
  }
  for (let i = 0; i < length; i++) {
    out[i] /= channelCount;
  }
  return out;
}

/**
 * Resample a mono PCM buffer to a new sample rate using linear interpolation.
 *
 * Linear interpolation is inexpensive and more than adequate for speech that is
 * about to be fed to Whisper. The output length is `round(N * target / input)`.
 */
export function resampleLinear(
  input: Float32Array,
  inputRate: number,
  targetRate: number,
): Float32Array {
  if (inputRate <= 0 || targetRate <= 0) {
    throw new Error("Sample rates must be positive");
  }
  if (inputRate === targetRate) return input.slice();
  if (input.length === 0) return new Float32Array(0);

  const ratio = targetRate / inputRate;
  const outLength = Math.max(1, Math.round(input.length * ratio));
  const out = new Float32Array(outLength);
  // How many input samples advance per output sample.
  const step = inputRate / targetRate;
  const lastIndex = input.length - 1;

  for (let i = 0; i < outLength; i++) {
    const pos = i * step;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, lastIndex);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

/** Root-mean-square amplitude of a buffer (roughly 0..1 for normalized PCM). */
export function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    sum += s * s;
  }
  return Math.sqrt(sum / samples.length);
}

export interface TrimSilenceOptions {
  /** RMS below this (per window) counts as silence. Default 0.01. */
  threshold?: number;
  /** Analysis window length in seconds. Default 0.02 (20 ms). */
  windowSeconds?: number;
  /** Extra audio kept either side of the detected speech. Default 0.1 s. */
  padSeconds?: number;
}

/**
 * Trim leading/trailing near-silence from a mono buffer using windowed RMS.
 *
 * If the whole clip is below threshold (e.g. no speech at all) the original
 * buffer is returned unchanged so callers never end up with empty audio by
 * surprise.
 */
export function trimSilence(
  samples: Float32Array,
  sampleRate: number,
  options: TrimSilenceOptions = {},
): Float32Array {
  const threshold = options.threshold ?? 0.01;
  const windowSeconds = options.windowSeconds ?? 0.02;
  const padSeconds = options.padSeconds ?? 0.1;

  if (samples.length === 0) return samples.slice();

  const windowSize = Math.max(1, Math.round(sampleRate * windowSeconds));
  const pad = Math.max(0, Math.round(sampleRate * padSeconds));

  let firstActive = -1;
  let lastActive = -1;

  for (let start = 0; start < samples.length; start += windowSize) {
    const end = Math.min(start + windowSize, samples.length);
    const window = samples.subarray(start, end);
    if (computeRms(window) >= threshold) {
      if (firstActive === -1) firstActive = start;
      lastActive = end;
    }
  }

  if (firstActive === -1) return samples.slice();

  const from = Math.max(0, firstActive - pad);
  const to = Math.min(samples.length, lastActive + pad);
  return samples.slice(from, to);
}

/**
 * Encode a mono Float32 PCM buffer as a 16-bit PCM WAV file.
 * Samples are clamped to [-1, 1].
 */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample; // mono
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // audio format: PCM
  view.setUint16(22, 1, true); // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

export interface DecodedWav {
  sampleRate: number;
  channels: number;
  /** Mono Float32 samples (multi-channel input is averaged to mono). */
  samples: Float32Array;
}

/**
 * Decode a 16-bit PCM WAV file to mono Float32 samples. Walks the RIFF chunks
 * so it tolerates extra chunks (LIST/fact/…) before the data chunk.
 */
export function decodeWav(buffer: ArrayBuffer): DecodedWav {
  const view = new DataView(buffer);
  if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") {
    throw new Error("Not a RIFF/WAVE file");
  }

  let channels = 1;
  let sampleRate = 0;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataSize = 0;

  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (chunkId === "fmt ") {
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (chunkId === "data") {
      dataOffset = body;
      dataSize = chunkSize;
    }
    // Chunks are word-aligned: sizes are padded to even byte counts.
    offset = body + chunkSize + (chunkSize % 2);
  }

  if (dataOffset === -1) throw new Error("No data chunk found");
  if (bitsPerSample !== 16) {
    throw new Error(`Unsupported bit depth: ${bitsPerSample} (only 16-bit PCM)`);
  }

  const totalSamples = Math.floor(dataSize / 2);
  const frameCount = Math.floor(totalSamples / channels);
  const mono = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const sampleIndex = frame * channels + c;
      sum += view.getInt16(dataOffset + sampleIndex * 2, true) / 0x8000;
    }
    mono[frame] = sum / channels;
  }

  return { sampleRate, channels, samples: mono };
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += String.fromCharCode(view.getUint8(offset + i));
  }
  return out;
}
