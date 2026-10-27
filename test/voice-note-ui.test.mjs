import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('voice notes can be timed, previewed, discarded, and explicitly sent', async () => {
  const [app, styles] = await Promise.all([
    readSource('../src/live-app.mjs'),
    readSource('../src/live-styles.css'),
  ]);
  const stopHandler = app.match(/recorder\.addEventListener\('stop', async \(\) => \{([\s\S]*?)\}, \{ once: true \}\)/)?.[1];

  assert.ok(stopHandler);
  assert.match(stopHandler, /URL\.createObjectURL\(blob\)/);
  assert.doesNotMatch(stopHandler, /sendChatMedia/);
  assert.match(app, /id="voice-note-preview" controls/);
  assert.match(app, /id="voice-note-preview-status"/);
  assert.match(app, /id="voice-note-discard"/);
  assert.match(app, /id="voice-note-send"/);
  assert.match(app, /formatVoiceDuration/);
  assert.match(app, /elapsed >= 5 \* 60 \* 1000/);
  assert.match(app, /await sendChatMedia\(state\.voiceFile, true, '', state\.voiceChat\)/);
  assert.match(app, /URL\.revokeObjectURL\(state\.voicePreviewUrl\)/);
  assert.match(styles, /\.voice-note-preview audio/);
  assert.match(styles, /\.recording-controls\[hidden\]/);
});
