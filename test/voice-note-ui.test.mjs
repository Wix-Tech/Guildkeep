import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('voice notes record on hold, send on release, and cancel by sliding left', async () => {
  const [app, styles, chat] = await Promise.all([
    readSource('../src/live-app.mjs'),
    readSource('../src/live-styles.css'),
    readSource('../src/supabase-chat.mjs'),
  ]);

  assert.match(app, /addEventListener\('pointerdown', \(event\) => \{[\s\S]*?#voice-note/);
  assert.match(app, /event\.clientX <= hold\.startX - 64/);
  assert.match(app, /document\.addEventListener\('pointerup', \(event\) => \{[\s\S]*?state\.voiceRecorder\.stop\(\)/);
  assert.match(app, /Hold to record · release to send · slide left to cancel/);
  assert.match(app, /sampleRecordingWaveform\(analyser, samples\)/);
  assert.match(app, /void uploadPendingVoice\(optimisticId\)/);
  assert.match(app, /data-retry-pending-voice=/);
  assert.match(app, /data-discard-pending-voice=/);
  assert.match(app, /id="recording-status"/);
  assert.match(app, /voiceDurationMs: pending\.metadata\.durationMs/);
  assert.match(app, /voiceWaveform: pending\.metadata\.waveform/);
  assert.match(app, /URL\.revokeObjectURL\(pending\.optimistic\.media_url\)/);
  assert.match(styles, /\.voice-recording-waveform/);
  assert.match(styles, /\.voice-note-control \{ touch-action: none/);
  assert.match(chat, /voice_duration_ms: media\?\.voiceDurationMs/);
  assert.match(chat, /voice_waveform: media\?\.voiceWaveform/);
});

test('voice-note bubbles provide waveform scrubbing and persistent speed controls', async () => {
  const [app, styles] = await Promise.all([
    readSource('../src/live-app.mjs'),
    readSource('../src/live-styles.css'),
  ]);

  assert.match(app, /class="voice-waveform"/);
  assert.match(app, /class="voice-player-seek" type="range"/);
  assert.match(app, /const speeds = \[1, 1\.5, 2\]/);
  assert.match(app, /voice_duration_ms: durationMs/);
  assert.match(app, /voice_waveform: waveform/);
  assert.match(app, /const activeAudio = \[\.\.\.list\.querySelectorAll\('\.voice-player-audio'\)\]\.find\(\(audio\) => !audio\.paused\)/);
  assert.match(app, /audio\.playbackRate = resumePlayback\.playbackRate/);
  assert.match(styles, /\.voice-player-seek:focus-visible/);
  assert.match(styles, /@media \(max-width: 380px\)[\s\S]*?\.voice-player \{/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});
