import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('password reset walks the user through forgot, reset request, and recovery', async () => {
  const [html, app, api, styles] = await Promise.all([
    readSource('../index.html'),
    readSource('../src/live-app.mjs'),
    readSource('../src/supabase-chat.mjs'),
    readSource('../src/live-styles.css'),
  ]);

  assert.match(app, /const resetRequest = mode === 'reset-request';/);
  assert.match(app, /const passwordRecovery = mode === 'password-recovery';/);
  assert.match(app, /\$\('auth-forgot-password'\)\.addEventListener/);
  assert.match(app, /\$\('auth-back'\)\.addEventListener/);
  assert.match(app, /setAuthMode\('reset-request'\);/);
  assert.match(app, /setAuthMode\('password-recovery'\);/);
  assert.match(app, /isResetRequest/);
  assert.match(app, /isPasswordRecovery/);
  assert.match(app, /requestPasswordReset\(email\)/);
  assert.match(app, /updatePassword\(\{ password \}\)/);
  assert.match(app, /await signOut\(\);/);
  assert.match(app, /PASSWORD_RECOVERY/);
  assert.match(app, /auth-panel'\)\.hidden = false/);
  assert.match(api, /resetPasswordForEmail/);
  assert.match(api, /updateUser\(\{ password \}\)/);
  assert.match(html, /id="auth-forgot-password"/);
  assert.match(html, /id="auth-back"/);
  assert.match(html, /id="password-confirm-field"/);
  assert.match(html, /id="auth-status"/);
  assert.match(styles, /\.form-status/);
});
