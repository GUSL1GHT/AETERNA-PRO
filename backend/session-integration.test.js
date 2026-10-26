const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');

const secret = 'local-integration-secret-never-used-in-production';
process.env.GITHUB_APP_CLIENT_SECRET = secret;
const { sealSession } = require('./session-seal');

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});

const start = async (port) => {
  const child = spawn(process.execPath, ['server-v11.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(port), GITHUB_APP_CLIENT_SECRET: secret },
    stdio: 'ignore'
  });
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null) throw new Error('El servidor no arrancó');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return child;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error('El servidor tardó demasiado en arrancar');
};

const stop = child => new Promise(resolve => {
  if (child.exitCode !== null) return resolve();
  child.once('exit', resolve);
  child.kill();
});

test('Gemini and GitHub sessions remain valid after a server restart', async () => {
  const port = await freePort();
  const gemini = sealSession('gemini', { apiKey: 'test-only', models: ['test-model'] }, 60000);
  const github = sealSession('github', { login: 'tester', accessToken: 'test-only', refreshToken: null, expiresAt: Date.now() + 3600000 }, 60000);
  const verify = async () => {
    const geminiResponse = await fetch(`http://127.0.0.1:${port}/api/gemini-auth/status`, { headers: { 'X-Aeterna-Gemini-Session': gemini } });
    assert.equal((await geminiResponse.json()).connected, true);
    const githubResponse = await fetch(`http://127.0.0.1:${port}/api/github-auth/status`, { headers: { Authorization: `Bearer ${github}` } });
    assert.equal((await githubResponse.json()).login, 'tester');
  };
  let child = await start(port);
  try {
    await verify();
    await stop(child);
    child = await start(port);
    await verify();
  } finally {
    await stop(child);
  }
});
