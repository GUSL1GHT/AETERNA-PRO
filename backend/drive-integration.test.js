const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.GOOGLE_DRIVE_CLIENT_ID = 'test-client';
process.env.GOOGLE_DRIVE_CLIENT_SECRET = 'test-secret';
process.env.SESSION_ENCRYPTION_SECRET = 'test-session-secret';
const { sealSession } = require('./session-seal');
const { registerDriveRoutes } = require('./drive-integration');

test('Drive connection and save create a Google document in the user folder', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/drive/v3/files?q=')) return Response.json({ files: [{ id: 'own-folder', name: 'AETERNA' }] });
    if (String(url).includes('/upload/drive/v3/files')) return Response.json({ id: 'document-1', name: 'Prueba', webViewLink: 'https://docs.google.com/document/d/document-1/edit' });
    throw new Error(`Unexpected request: ${url}`);
  };
  const app = express();
  app.use(express.json());
  registerDriveRoutes(app);
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = sealSession('drive', { accessToken: 'test-access', refreshToken: 'test-refresh', expiresAt: Date.now() + 3600000, displayName: 'Persona' }, 60000);
  try {
    const config = await (await originalFetch(`${base}/api/drive-auth/config`)).json();
    assert.equal(config.configured, true);
    const status = await (await originalFetch(`${base}/api/drive-auth/status`, { headers: { Authorization: `Bearer ${token}` } })).json();
    assert.equal(status.displayName, 'Persona');
    const response = await originalFetch(`${base}/api/save-transcript-to-drive`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: 'Prueba', transcription: 'Contenido de prueba', sourceUrl: 'https://example.com/video' })
    });
    const saved = await response.json();
    assert.equal(saved.success, true);
    assert.equal(saved.url, 'https://docs.google.com/document/d/document-1/edit');
    const upload = calls.find(call => call.url.includes('/upload/drive/v3/files'));
    assert.match(upload.options.body.toString(), /"parents":\["own-folder"\]/);
    assert.match(upload.options.body.toString(), /Contenido de prueba/);
  } finally {
    global.fetch = originalFetch;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
