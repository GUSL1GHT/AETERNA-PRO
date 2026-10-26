const crypto = require('crypto');
const { sealSession, openSession } = require('./session-seal');

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SESSION_MS = 90 * 24 * 60 * 60 * 1000;
const pendingStates = new Map();

const configured = () => !!(process.env.GOOGLE_DRIVE_CLIENT_ID && process.env.GOOGLE_DRIVE_CLIENT_SECRET);
const backendUrl = () => process.env.PUBLIC_BACKEND_URL || 'https://aeterna-pro-backend.onrender.com';
const frontendUrl = () => process.env.PUBLIC_FRONTEND_URL || 'https://gusl1ght.github.io/AETERNA-PRO/';
const callbackUrl = () => `${backendUrl()}/api/drive-auth/callback`;

const tokenRequest = async params => {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, client_id: process.env.GOOGLE_DRIVE_CLIENT_ID, client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET }),
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error('Google no pudo completar la conexión con Drive.');
  return data;
};

const driveRequest = async (url, token, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error?.message || `Google Drive respondió con estado ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
};

const sessionFromRequest = async (req, res) => {
  const token = /^Bearer (.+)$/.exec(req.get('Authorization') || '')?.[1];
  const session = openSession(token, 'drive');
  if (!session || !configured()) return null;
  if (session.expiresAt && Date.now() > session.expiresAt - 60000) {
    if (!session.refreshToken) return null;
    try {
      const refreshed = await tokenRequest({ grant_type: 'refresh_token', refresh_token: session.refreshToken });
      session.accessToken = refreshed.access_token;
      session.refreshToken = refreshed.refresh_token || session.refreshToken;
      session.expiresAt = Date.now() + refreshed.expires_in * 1000;
      const renewed = sealSession('drive', session, SESSION_MS);
      if (renewed) res.set('X-Aeterna-Drive-Session', renewed);
    } catch (_) { return null; }
  }
  return session;
};

const ensureFolder = async token => {
  const query = encodeURIComponent("name = 'AETERNA' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
  const listed = await driveRequest(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&pageSize=20`, token);
  if (listed.files?.length) return listed.files[0].id;
  const created = await driveRequest('https://www.googleapis.com/drive/v3/files?fields=id', token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'AETERNA', mimeType: 'application/vnd.google-apps.folder' })
  });
  return created.id;
};

const uploadDocument = async (token, folderId, title, content) => {
  const boundary = `aeterna_${crypto.randomBytes(12).toString('hex')}`;
  const metadata = { name: title, mimeType: 'application/vnd.google-apps.document', parents: [folderId] };
  const body = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--\r\n`);
  return driveRequest('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', token, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
  });
};

const registerDriveRoutes = app => {
  app.get('/api/drive-auth/config', (req, res) => res.json({ configured: configured() }));

  app.get('/api/drive-auth/start', (req, res) => {
    if (!configured()) return res.status(503).send('Google Drive aún no está configurado.');
    const state = crypto.randomBytes(32).toString('hex');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    for (const [key, value] of pendingStates) if (value.expiresAt < Date.now()) pendingStates.delete(key);
    pendingStates.set(state, { verifier, expiresAt: Date.now() + 10 * 60 * 1000 });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for (const [key, value] of Object.entries({
      client_id: process.env.GOOGLE_DRIVE_CLIENT_ID, redirect_uri: callbackUrl(), response_type: 'code',
      scope: SCOPE, state, access_type: 'offline', prompt: 'consent',
      code_challenge: challenge, code_challenge_method: 'S256'
    })) url.searchParams.set(key, value);
    res.redirect(url.toString());
  });

  app.get('/api/drive-auth/callback', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    const state = String(req.query.state || '');
    const pending = pendingStates.get(state);
    pendingStates.delete(state);
    if (!pending || pending.expiresAt < Date.now() || !req.query.code) return res.status(400).send('Conexión con Drive cancelada o caducada. Vuelve a AETERNA e inténtalo de nuevo.');
    try {
      const token = await tokenRequest({ grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: callbackUrl(), code_verifier: pending.verifier });
      if (!token.scope?.split(' ').includes(SCOPE)) return res.status(403).send('AETERNA necesita permiso para guardar sus documentos en Drive.');
      const about = await driveRequest('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)', token.access_token);
      const session = sealSession('drive', {
        accessToken: token.access_token, refreshToken: token.refresh_token || null,
        expiresAt: Date.now() + token.expires_in * 1000,
        displayName: about.user?.displayName || about.user?.emailAddress || 'Google Drive'
      }, SESSION_MS);
      if (!session) return res.status(503).send('No se pudo guardar la conexión con Drive.');
      const destination = new URL(frontendUrl());
      destination.hash = `drive_session=${encodeURIComponent(session)}`;
      res.redirect(destination.toString());
    } catch (_) { res.status(502).send('Google Drive no pudo completar la conexión. Vuelve a intentarlo.'); }
  });

  app.get('/api/drive-auth/status', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const session = await sessionFromRequest(req, res);
    if (!session) return res.status(401).json({ connected: false });
    res.json({ connected: true, displayName: session.displayName });
  });

  app.post('/api/save-transcript-to-drive', async (req, res) => {
    const session = await sessionFromRequest(req, res);
    if (!session) return res.status(401).json({ success: false, error: 'Conecta Google Drive para guardar.' });
    const transcription = String(req.body?.transcription || '').trim();
    if (!transcription || transcription.length > 500000) return res.status(400).json({ success: false, error: 'La transcripción está vacía o es demasiado larga para guardar.' });
    const title = String(req.body?.title || 'Transcripción AETERNA').replace(/[\r\n\t]/g, ' ').trim().slice(0, 120) || 'Transcripción AETERNA';
    const sourceUrl = String(req.body?.sourceUrl || '').slice(0, 2000);
    const content = `${title}\n\nFuente: ${sourceUrl}\nFecha: ${new Date().toISOString()}\n\nTRANSCRIPCIÓN\n\n${transcription}\n`;
    try {
      const folderId = await ensureFolder(session.accessToken);
      const document = await uploadDocument(session.accessToken, folderId, title, content);
      res.json({ success: true, name: document.name, url: document.webViewLink || `https://drive.google.com/open?id=${document.id}` });
    } catch (error) {
      const status = error.status === 401 ? 401 : error.status === 403 ? 403 : 502;
      res.status(status).json({ success: false, error: status === 403 ? 'Google Drive no permite guardar. Vuelve a conectar la cuenta.' : 'No se pudo guardar en Google Drive. Inténtalo de nuevo.' });
    }
  });
};

module.exports = { registerDriveRoutes };
