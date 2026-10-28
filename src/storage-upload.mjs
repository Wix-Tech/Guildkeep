function responseBody(xhr) {
  try {
    return JSON.parse(xhr.responseText);
  } catch {
    return null;
  }
}

export function uploadStorageObject({
  url,
  headers,
  body,
  onProgress = () => {},
  signal,
  xhrFactory = () => new XMLHttpRequest(),
}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error('Media upload was canceled.');
      error.name = 'AbortError';
      reject(error);
      return;
    }
    const xhr = xhrFactory();
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => {
      xhr.abort();
      const error = new Error('Media upload was canceled.');
      error.name = 'AbortError';
      finish(reject, error);
    };

    xhr.open('POST', url);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    });
    xhr.onload = () => {
      const body = responseBody(xhr);
      if (xhr.status >= 200 && xhr.status < 300) {
        finish(resolve, body);
        return;
      }
      finish(reject, new Error(body?.message ?? body?.error ?? `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => finish(reject, new Error('Network error while uploading media.'));
    xhr.onabort = () => {
      const error = new Error('Media upload was canceled.');
      error.name = 'AbortError';
      finish(reject, error);
    };

    signal?.addEventListener('abort', abort, { once: true });
    try {
      xhr.send(body);
    } catch (error) {
      finish(reject, error);
    }
  });
}
