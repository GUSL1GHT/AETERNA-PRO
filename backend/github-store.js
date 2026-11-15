// Lectura y escritura en un repositorio de GitHub con el token del usuario.
// commitFiles agrupa varios archivos en un único commit y reintenta si otra escritura se adelanta.

const API = 'https://api.github.com';
const encodePath = (filePath) => filePath.split('/').map(encodeURIComponent).join('/');

const createGithubStore = ({ token, owner, repo, branch, fetchImpl = fetch }) => {
  const call = async (method, apiPath, body) => {
    const response = await fetchImpl(`${API}/repos/${owner}/${repo}${apiPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'AETERNA-PRO'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000)
    });
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(data?.message || `GitHub respondió con estado ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  };

  const getFile = async (filePath, ref = branch) => {
    try {
      const data = await call('GET', `/contents/${encodePath(filePath)}?ref=${encodeURIComponent(ref)}`);
      if (Array.isArray(data) || data?.type !== 'file') return null;
      return { sha: data.sha, content: Buffer.from(data.content || '', 'base64').toString('utf8') };
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  };

  const listDir = async (dirPath) => {
    try {
      const data = await call('GET', `/contents/${encodePath(dirPath)}?ref=${encodeURIComponent(branch)}`);
      return Array.isArray(data) ? data.map(item => ({ name: item.name, path: item.path, type: item.type })) : [];
    } catch (error) {
      if (error.status === 404) return [];
      throw error;
    }
  };

  const putFile = async (filePath, content, message) => {
    const existing = await getFile(filePath);
    return call('PUT', `/contents/${encodePath(filePath)}`, {
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch,
      ...(existing ? { sha: existing.sha } : {})
    });
  };

  const deleteFile = async (filePath, message) => {
    const existing = await getFile(filePath);
    if (!existing) return false;
    await call('DELETE', `/contents/${encodePath(filePath)}`, { message, sha: existing.sha, branch });
    return true;
  };

  // build(read) devuelve [{ path, content }] leyendo con read(path) la versión del commit actual.
  const commitFiles = async (build, message, attempts = 4) => {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const ref = await call('GET', `/git/ref/heads/${encodeURIComponent(branch)}`);
        const parentSha = ref.object.sha;
        const parent = await call('GET', `/git/commits/${parentSha}`);
        const files = await build((filePath) => getFile(filePath, parentSha));
        if (!files.length) return { commit: parentSha };
        const tree = await call('POST', '/git/trees', {
          base_tree: parent.tree.sha,
          tree: files.map(file => ({ path: file.path, mode: '100644', type: 'blob', content: file.content }))
        });
        const commit = await call('POST', '/git/commits', { message, tree: tree.sha, parents: [parentSha] });
        await call('PATCH', `/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha, force: false });
        return { commit: commit.sha };
      } catch (error) {
        lastError = error;
        if (error.status !== 409 && error.status !== 422) throw error;
      }
    }
    throw lastError;
  };

  const htmlUrl = (filePath) => `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/${encodePath(filePath)}`;

  return { getFile, listDir, putFile, deleteFile, commitFiles, htmlUrl };
};

module.exports = { createGithubStore };
