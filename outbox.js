// Bandeja de salida de AETERNA: guarda en el dispositivo los enlaces compartidos y los envía
// a la cola del servidor en cuanto hay conexión. La usan la app y el service worker (sw.js),
// así que los envíos pendientes siguen saliendo aunque la app esté cerrada (Background Sync).
(function (scope) {
  const DB_NAME = 'aeterna-outbox';
  const STORE = 'items';
  const SYNC_TAG = 'aeterna-outbox';

  const openDb = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  const withStore = async (mode, action) => {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const result = action(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  };

  const pad = (n) => String(n).padStart(2, '0');
  const newId = (date = new Date()) => {
    const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    const random = Array.from(crypto.getRandomValues(new Uint8Array(6)), byte => 'abcdefghijklmnopqrstuvwxyz0123456789'[byte % 36]).join('');
    return `${stamp}-${random}`;
  };

  const list = () => withStore('readonly', store => store.getAll()).then(items => (items || []).sort((a, b) => b.id.localeCompare(a.id)));
  const put = (item) => withStore('readwrite', store => store.put(item));
  const remove = (id) => withStore('readwrite', store => store.delete(id));

  const add = async ({ url, repository, geminiSession, githubSession }) => {
    const item = { id: newId(), url, repository, geminiSession: geminiSession || '', githubSession: githubSession || '', createdAt: new Date().toISOString(), state: 'enviando', error: '' };
    await put(item);
    return item;
  };

  const registerSync = async () => {
    try {
      const registration = await navigator.serviceWorker?.ready;
      await registration?.sync?.register(SYNC_TAG);
    } catch (_) { /* Sin Background Sync: se reintenta al abrir la app. */ }
  };

  // Envía cada elemento; devuelve los trabajos aceptados. Lanza si queda algo por reintentar,
  // para que el navegador vuelva a intentarlo más tarde.
  const flushUnlocked = async (backendUrl, sessions) => {
    const accepted = [];
    let retryLater = false;
    for (const item of await list()) {
      if (item.state === 'error') continue;
      const geminiSession = sessions?.geminiSession ?? item.geminiSession;
      const githubSession = sessions?.githubSession ?? item.githubSession;
      try {
        const response = await fetch(`${backendUrl}/api/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Aeterna-Gemini-Session': geminiSession, 'X-Aeterna-Github-Session': githubSession, Authorization: `Bearer ${githubSession}` },
          body: JSON.stringify({ id: item.id, url: item.url, repository: item.repository })
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data.success) {
          await remove(item.id);
          accepted.push(data.job);
        } else if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
          await put({ ...item, state: 'error', error: data.error || `El servidor rechazó el enlace (${response.status}).` });
        } else {
          retryLater = true;
        }
      } catch (_) {
        retryLater = true;
      }
    }
    if (retryLater) throw new Error('Quedan enlaces por enviar.');
    return accepted;
  };

  const flush = (backendUrl, sessions) => (scope.navigator?.locks
    ? scope.navigator.locks.request(SYNC_TAG, () => flushUnlocked(backendUrl, sessions))
    : flushUnlocked(backendUrl, sessions));

  const retry = async (id) => {
    const item = (await list()).find(entry => entry.id === id);
    if (item) await put({ ...item, state: 'enviando', error: '' });
  };

  scope.AeternaOutbox = { SYNC_TAG, add, list, remove, retry, flush, registerSync };
})(self);
