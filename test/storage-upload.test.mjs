import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadStorageObject } from '../src/storage-upload.mjs';

class FakeXMLHttpRequest {
  uploadListeners = new Map();
  headers = {};
  upload = {
    addEventListener: (type, listener) => this.uploadListeners.set(type, listener),
  };

  open(method, url) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name, value) {
    this.headers[name] = value;
  }

  send(body) {
    this.body = body;
  }

  abort() {
    this.onabort?.();
  }

  progress(loaded, total) {
    this.uploadListeners.get('progress')?.({ lengthComputable: true, loaded, total });
  }
}

test('storage upload reports byte progress and resolves successful responses', async () => {
  const xhr = new FakeXMLHttpRequest();
  const progress = [];
  const body = new FormData();
  body.append('cacheControl', '3600');
  body.append('', new Blob(['media']));
  const resultPromise = uploadStorageObject({
    url: 'https://project.supabase.co/storage/v1/object/chat-media/path/file.png',
    headers: { authorization: 'Bearer test-token' },
    body,
    xhrFactory: () => xhr,
    onProgress: (ratio) => progress.push(ratio),
  });

  assert.equal(xhr.method, 'POST');
  assert.equal(xhr.body, body);
  assert.equal(xhr.headers.authorization, 'Bearer test-token');
  xhr.progress(50, 100);
  xhr.status = 200;
  xhr.responseText = '{"Key":"chat-media/path/file.png"}';
  xhr.onload();

  assert.deepEqual(progress, [0.5]);
  assert.deepEqual(await resultPromise, { Key: 'chat-media/path/file.png' });
});

test('storage upload surfaces server and network errors', async () => {
  const xhr = new FakeXMLHttpRequest();
  const request = uploadStorageObject({
    url: 'https://project.supabase.co/storage/v1/object/chat-media/path/file.png',
    headers: {},
    body: new Blob(['media']),
    xhrFactory: () => xhr,
  });
  xhr.status = 403;
  xhr.responseText = '{"message":"Storage policy denied the upload."}';
  xhr.onload();
  await assert.rejects(request, /Storage policy denied the upload/);

  const failedXhr = new FakeXMLHttpRequest();
  const failedRequest = uploadStorageObject({
    url: 'https://project.supabase.co/storage/v1/object/chat-media/path/file.png',
    headers: {},
    body: new Blob(['media']),
    xhrFactory: () => failedXhr,
  });
  failedXhr.onerror();
  await assert.rejects(failedRequest, /Network error while uploading/);
});

test('storage upload aborts when its signal is canceled', async () => {
  const xhr = new FakeXMLHttpRequest();
  const controller = new AbortController();
  const request = uploadStorageObject({
    url: 'https://project.supabase.co/storage/v1/object/chat-media/path/file.png',
    headers: {},
    file: new Blob(['media']),
    signal: controller.signal,
    xhrFactory: () => xhr,
  });
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
});
