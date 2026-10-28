export const VOICE_WAVEFORM_BARS = 48;

export function buildVoiceWaveform(samples, barCount = VOICE_WAVEFORM_BARS) {
  if (!Array.isArray(samples) || !samples.length) {
    throw new Error('Voice recording did not contain waveform samples.');
  }
  if (!Number.isInteger(barCount) || barCount < 1 || barCount > VOICE_WAVEFORM_BARS) {
    throw new RangeError(`Waveforms must contain between 1 and ${VOICE_WAVEFORM_BARS} bars.`);
  }

  const cleanSamples = samples
    .map(Number)
    .filter((sample) => Number.isFinite(sample))
    .map((sample) => Math.min(1, Math.max(0, sample)));
  if (!cleanSamples.length) {
    throw new Error('Voice recording did not contain valid waveform samples.');
  }

  const actualBarCount = Math.min(barCount, cleanSamples.length);
  const peaks = Array.from({ length: actualBarCount }, (_, index) => {
    const start = Math.floor(index * cleanSamples.length / actualBarCount);
    const end = Math.max(start + 1, Math.floor((index + 1) * cleanSamples.length / actualBarCount));
    return Math.max(...cleanSamples.slice(start, end));
  });
  const maxPeak = Math.max(...peaks, 0.001);
  return peaks.map((peak) => Math.round(Math.max(0.08, peak / maxPeak) * 100) / 100);
}

export function formatVoiceDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds) / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}
