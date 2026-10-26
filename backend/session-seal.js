const crypto = require('crypto');

const PREFIX = 'aet1.';
const MAX_TOKEN_LENGTH = 8192;

const sessionKey = () => {
  const secret = process.env.GITHUB_APP_CLIENT_SECRET;
  if (!secret) return null;
  return crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.from('aeterna-session-v1'), Buffer.from('browser-session'), 32);
};

const sealSession = (type, data, lifetimeMs) => {
  const key = sessionKey();
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.from(JSON.stringify({ type, data, exp: Date.now() + lifetimeMs }));
  const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
};

const openSession = (token, type) => {
  if (typeof token !== 'string' || !token.startsWith(PREFIX) || token.length > MAX_TOKEN_LENGTH) return null;
  const key = sessionKey();
  if (!key) return null;
  try {
    const bytes = Buffer.from(token.slice(PREFIX.length), 'base64url');
    if (bytes.length < 29) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const payload = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
    if (payload.type !== type || !Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
    return payload.data;
  } catch (_) {
    return null;
  }
};

module.exports = { sealSession, openSession };
