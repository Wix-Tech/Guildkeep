import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVoiceWaveform, formatVoiceDuration, VOICE_WAVEFORM_BARS } from '../src/voice-notes.mjs';

test('voice waveform peaks are normalized, bounded, and useful for silent samples', () => {
  const waveform = buildVoiceWaveform([0, 0.1, 0.5, 0.25, 0.9, 0.2], 3);

  assert.deepEqual(waveform, [0.11, 0.56, 1]);
  assert.ok(waveform.length <= VOICE_WAVEFORM_BARS);
  assert.ok(buildVoiceWaveform([0, 0, 0]).every((peak) => peak === 0.08));
  assert.throws(() => buildVoiceWaveform([]), /did not contain waveform samples/);
  assert.throws(() => buildVoiceWaveform([Number.NaN]), /did not contain valid waveform samples/);
  assert.throws(() => buildVoiceWaveform([1], VOICE_WAVEFORM_BARS + 1), RangeError);
});

test('voice durations format as zero-padded minutes and seconds', () => {
  assert.equal(formatVoiceDuration(0), '00:00');
  assert.equal(formatVoiceDuration(67_900), '01:07');
  assert.equal(formatVoiceDuration(300_000), '05:00');
});
