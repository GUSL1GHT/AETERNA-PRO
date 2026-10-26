const test = require('node:test');
const assert = require('node:assert/strict');
const { sealSession, openSession } = require('./session-seal');

test('encrypted sessions survive a module reload and reject tampering or wrong purpose', () => {
  const prior = process.env.GITHUB_APP_CLIENT_SECRET;
  process.env.GITHUB_APP_CLIENT_SECRET = 'local-test-secret-never-used-in-production';
  try {
    const token = sealSession('gemini', { apiKey: 'test-only', models: ['test-model'] }, 60000);
    assert.match(token, /^aet1\./);
    assert.equal(token.includes('test-only'), false);
    assert.deepEqual(openSession(token, 'gemini'), { apiKey: 'test-only', models: ['test-model'] });
    assert.equal(openSession(token, 'github'), null);
    assert.equal(openSession(token.slice(0, -2) + 'AA', 'gemini'), null);
    delete require.cache[require.resolve('./session-seal')];
    assert.deepEqual(require('./session-seal').openSession(token, 'gemini'), { apiKey: 'test-only', models: ['test-model'] });
  } finally {
    if (prior === undefined) delete process.env.GITHUB_APP_CLIENT_SECRET;
    else process.env.GITHUB_APP_CLIENT_SECRET = prior;
  }
});

test('expired sessions are rejected', () => {
  const prior = process.env.GITHUB_APP_CLIENT_SECRET;
  process.env.GITHUB_APP_CLIENT_SECRET = 'local-test-secret-never-used-in-production';
  try {
    const token = sealSession('github', { login: 'tester' }, -1);
    assert.equal(openSession(token, 'github'), null);
  } finally {
    if (prior === undefined) delete process.env.GITHUB_APP_CLIENT_SECRET;
    else process.env.GITHUB_APP_CLIENT_SECRET = prior;
  }
});
