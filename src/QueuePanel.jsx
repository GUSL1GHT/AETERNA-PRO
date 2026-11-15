import React from 'react';
const { useCallback, useEffect, useRef, useState } = React;

const STATUS = {
    enviando: { label: 'Enviando', className: 'border-sky-700 bg-sky-950/60 text-sky-200' },
    pendiente: { label: 'Pendiente', className: 'border-slate-600 bg-slate-800 text-slate-200' },
    procesando: { label: 'Procesando', className: 'border-cyan-600 bg-cyan-950/60 text-cyan-200' },
    hecho: { label: 'Hecho', className: 'border-emerald-700 bg-emerald-950/60 text-emerald-200' },
    revisar: { label: 'Para revisar', className: 'border-amber-600 bg-amber-950/60 text-amber-200' },
    error: { label: 'Error', className: 'border-red-700 bg-red-950/60 text-red-200' }
};

const shortUrl = (url) => {
    try { const parsed = new URL(url); return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname}`.slice(0, 60); } catch (_) { return url; }
};

const whenText = (iso) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

// Lista de vídeos en cola: los que aún están en el móvil y los que ya tiene el servidor.
export default function QueuePanel({ backendUrl, geminiSession, githubSession, repository, refreshKey, onSessionRenewed }) {
    const [jobs, setJobs] = useState([]);
    const [outbox, setOutbox] = useState([]);
    const [loadError, setLoadError] = useState('');
    const [loaded, setLoaded] = useState(false);
    const timer = useRef(null);

    const headers = { 'Content-Type': 'application/json', 'X-Aeterna-Gemini-Session': geminiSession, 'X-Aeterna-Github-Session': githubSession, Authorization: `Bearer ${githubSession}` };

    const refresh = useCallback(async () => {
        try { setOutbox(await self.AeternaOutbox.list()); } catch (_) {}
        if (!repository || !githubSession) return;
        try {
            const response = await fetch(`${backendUrl}/api/jobs?repository=${encodeURIComponent(repository)}`, { headers });
            onSessionRenewed?.(response);
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'No se pudo cargar la cola.');
            setJobs(data.jobs || []);
            setLoadError('');
        } catch (error) {
            setLoadError(error instanceof TypeError ? 'Sin conexión con el servidor; se reintentará solo.' : error.message);
        } finally {
            setLoaded(true);
        }
    }, [backendUrl, geminiSession, githubSession, repository]);

    useEffect(() => { refresh(); }, [refresh, refreshKey]);

    // Mientras haya trabajo en marcha, consulta cada 10 s; si no, cada minuto.
    const busy = outbox.some(item => item.state === 'enviando') || jobs.some(job => job.status === 'pendiente' || job.status === 'procesando');
    useEffect(() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(function tick() {
            if (document.visibilityState === 'visible') refresh();
            timer.current = setTimeout(tick, busy ? 10000 : 60000);
        }, busy ? 10000 : 60000);
        return () => clearTimeout(timer.current);
    }, [busy, refresh]);

    const retryJob = async (id) => {
        try {
            const response = await fetch(`${backendUrl}/api/jobs/${encodeURIComponent(id)}/retry`, { method: 'POST', headers, body: JSON.stringify({ repository }) });
            onSessionRenewed?.(response);
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'No se pudo reintentar.');
        } catch (error) {
            setLoadError(error.message);
        }
        refresh();
    };

    const retryOutbox = async (id) => {
        await self.AeternaOutbox.retry(id);
        self.AeternaOutbox.registerSync();
        try { await self.AeternaOutbox.flush(backendUrl, { geminiSession, githubSession }); } catch (_) {}
        refresh();
    };

    const discardOutbox = async (id) => {
        await self.AeternaOutbox.remove(id);
        refresh();
    };

    const serverIds = new Set(jobs.map(job => job.id));
    const rows = [
        ...outbox.filter(item => !serverIds.has(item.id)).map(item => ({ id: item.id, url: item.url, status: item.state === 'error' ? 'error' : 'enviando', error: item.error, when: item.createdAt, local: true })),
        ...jobs.map(job => ({ id: job.id, url: job.url, status: job.status === 'hecho' && job.result?.review ? 'revisar' : job.status, error: job.error, note: job.note, when: job.createdAt, result: job.result }))
    ].sort((a, b) => b.id.localeCompare(a.id));

    if (!rows.length && !loadError) {
        return loaded ? <p className="text-xs text-slate-400 text-left">La cola está vacía. Comparte un vídeo con AETERNA y se guardará aquí al instante.</p> : null;
    }

    return (
        <div className="text-left space-y-2">
            {loadError && <p className="text-xs text-amber-300" role="status">{loadError}</p>}
            <ul className="space-y-2" aria-label="Vídeos en cola">
                {rows.map(row => {
                    const status = STATUS[row.status] || STATUS.pendiente;
                    return (
                        <li key={row.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="text-sm text-slate-100 break-words">{row.result?.title || shortUrl(row.url)}</p>
                                    <p className="text-[11px] text-slate-400">{whenText(row.when)}{row.result?.topic ? ` · ${row.result.topic}` : ''}</p>
                                </div>
                                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${status.className}`}>{status.label}</span>
                            </div>
                            {row.note && row.status === 'procesando' && <p className="mt-1 text-[11px] text-cyan-300">{row.note}</p>}
                            {row.status === 'revisar' && <p className="mt-1 text-[11px] text-amber-300">Guardado en transcripts/ para que lo revises: tema dudoso o texto incompleto.</p>}
                            {row.error && <p className="mt-1 text-[11px] text-red-300 break-words">{row.error}</p>}
                            <div className="mt-1.5 flex flex-wrap gap-3 text-xs">
                                {row.result?.url && <a href={row.result.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-cyan-300 hover:underline">Abrir en GitHub</a>}
                                {row.status === 'error' && !row.local && <button type="button" onClick={() => retryJob(row.id)} className="font-semibold text-cyan-300 hover:underline">Reintentar</button>}
                                {row.status === 'error' && row.local && <>
                                    <button type="button" onClick={() => retryOutbox(row.id)} className="font-semibold text-cyan-300 hover:underline">Reintentar</button>
                                    <button type="button" onClick={() => discardOutbox(row.id)} className="text-slate-400 hover:underline">Quitar</button>
                                </>}
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
