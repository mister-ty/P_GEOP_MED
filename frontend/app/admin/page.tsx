'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import Map, { Marker, type MapRef } from 'react-map-gl/maplibre';
import type { MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
    Upload, RefreshCw, Play, CheckCircle, AlertCircle,
    FileBox, Loader2, FolderOpen, ChevronRight, Home,
    HardHat, MapPin, X, Terminal, Search,
} from 'lucide-react';
import PageNavbar from '../components/PageNavbar';

/* ── Types ────────────────────────────────────────────────────────────────── */
interface Comuna    { id: string; nombre: string; codigo: string; }
type UploadPhase  = 'idle' | 'uploading' | 'processing' | 'done' | 'error';
type AdminTab     = 'local' | 'acc';

interface JobStatus {
    status:         'processing' | 'done' | 'error';
    jobId:          string;
    direccion?:     string;
    metadataUrl?:   string;
    nubeOutputDir?: string;
    ortofotoUrl?:   string;
    planoUrl?:      string;
    error?:         string;
}

interface AccHub     { id: string; name: string; }
interface AccProject { id: string; name: string; }
interface AccItem    {
    id: string; displayName: string; isFolder: boolean;
    objectId: string | null; size: number | null; lastModified: string | null;
}

/* ── Page ─────────────────────────────────────────────────────────────────── */
export default function AdminPage() {
    const [activeTab,  setActiveTab]  = useState<AdminTab>('local');
    const [comunas,    setComunas]    = useState<Comuna[]>([]);

    /* ── Shared fields (local + ACC) ────────────────────────────────────── */
    const [comunaId,  setComunaId]  = useState('');
    const [direccion, setDireccion] = useState('');
    const [notas,     setNotas]     = useState('');
    const [lat,       setLat]       = useState<number | null>(null);
    const [lng,       setLng]       = useState<number | null>(null);

    /* ── Local upload state ─────────────────────────────────────────────── */
    const [file,      setFile]      = useState<File | null>(null);
    const [ortofoto,  setOrtofoto]  = useState<File | null>(null);
    const [plano,     setPlano]     = useState<File | null>(null);
    const [phase,     setPhase]     = useState<UploadPhase>('idle');
    const [jobId,     setJobId]     = useState<string | null>(null);
    const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
    const [progress,  setProgress]  = useState(0);
    const [errorMsg,  setErrorMsg]  = useState('');
    const fileRef  = useRef<HTMLInputElement>(null);
    const pollRef  = useRef(null) as React.MutableRefObject<ReturnType<typeof setInterval> | null>;

    /* ── ACC browser state ──────────────────────────────────────────────── */
    const [accHubs,      setAccHubs]      = useState<AccHub[]>([]);
    const [accProjects,  setAccProjects]  = useState<AccProject[]>([]);
    const [accItems,     setAccItems]     = useState<AccItem[]>([]);
    const [accLoading,   setAccLoading]   = useState(false);
    const [accError,     setAccError]     = useState('');
    const [selectedHub,  setSelectedHub]  = useState<AccHub | null>(null);
    const [selectedProj, setSelectedProj] = useState<AccProject | null>(null);
    const [folderStack,  setFolderStack]  = useState<{ id: string; name: string }[]>([]);
    const [selectedFile, setSelectedFile] = useState<AccItem | null>(null);
    const [accPhase,     setAccPhase]     = useState<UploadPhase>('idle');
    const [accProgress,  setAccProgress]  = useState(0);
    const [accErrMsg,    setAccErrMsg]    = useState('');
    const accPollRef = useRef(null) as React.MutableRefObject<ReturnType<typeof setInterval> | null>;

    /* ── Building sync state ────────────────────────────────────────────── */
    const [syncState, setSyncState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
    const [syncCount, setSyncCount] = useState<number | null>(null);
    const [syncError, setSyncError] = useState('');

    /* ── Load communes ──────────────────────────────────────────────────── */
    useEffect(() => {
        fetch('/api/comunas')
            .then(r => r.json())
            .then(data => {
                if (data?.features) {
                    const sorted: Comuna[] = data.features
                        .map((f: { properties: { id: string; nombre: string; codigo: string } }) => ({
                            id: f.properties.id,
                            nombre: f.properties.nombre,
                            codigo: f.properties.codigo,
                        }))
                        .sort((a: Comuna, b: Comuna) => a.nombre.localeCompare(b.nombre));
                    setComunas(sorted);
                    if (sorted.length) setComunaId(sorted[0].id);
                }
            }).catch(console.error);
    }, []);

    useEffect(() => {
        fetch('/api/admin/sync-buildings')
            .then(r => r.json())
            .then((d: { count?: number }) => { if (d.count !== undefined) setSyncCount(d.count); })
            .catch(() => {});
    }, []);

    useEffect(() => () => {
        if (pollRef.current)    clearInterval(pollRef.current);
        if (accPollRef.current) clearInterval(accPollRef.current);
    }, []);

    /* ── Polling ────────────────────────────────────────────────────────── */
    const startPolling = useCallback((
        id: string,
        setP: (n: number) => void,
        setPh: (p: UploadPhase) => void,
        setJs: (j: JobStatus) => void,
        setE: (s: string) => void,
        ref: React.MutableRefObject<ReturnType<typeof setInterval> | null>,
    ) => {
        let ticks = 0;
        let consecutiveErrors = 0;
        const MAX_TICKS = 150;           // 10 min at 4 s intervals
        const MAX_ERRORS = 5;            // stop after 5 consecutive network errors

        ref.current = setInterval(async () => {
            ticks++;
            setP(Math.min(90, ticks * 3));

            if (ticks > MAX_TICKS) {
                setE('Tiempo de espera agotado. El procesamiento tardó demasiado.');
                setPh('error');
                clearInterval(ref.current!);
                return;
            }

            try {
                const res = await fetch(`/api/upload-las/status/${id}`);

                if (!res.ok) {
                    // 404 = job not found yet (can happen in the first tick)
                    if (res.status === 404) { consecutiveErrors = 0; return; }

                    let errMsg = `Error del servidor (${res.status})`;
                    try {
                        const body = await res.json() as { error?: string; details?: string };
                        errMsg = body.error ?? errMsg;
                    } catch { /* response was not JSON */ }

                    consecutiveErrors++;
                    console.warn(`[poll] tick=${ticks} status=${res.status} consecutive=${consecutiveErrors}`);
                    if (consecutiveErrors >= MAX_ERRORS) {
                        setE(`${errMsg} (${MAX_ERRORS} errores consecutivos)`);
                        setPh('error');
                        clearInterval(ref.current!);
                    }
                    return;
                }

                consecutiveErrors = 0;
                const data: JobStatus = await res.json();
                setJs(data);

                if (data.status === 'done') {
                    setP(100); setPh('done'); clearInterval(ref.current!);
                } else if (data.status === 'error') {
                    setE(data.error ?? 'Error durante el procesamiento.');
                    setPh('error');
                    clearInterval(ref.current!);
                }
                // 'processing' → keep polling
            } catch (err) {
                consecutiveErrors++;
                console.warn('[poll]', err);
                if (consecutiveErrors >= MAX_ERRORS) {
                    setE('No se pudo contactar el servidor de procesamiento.');
                    setPh('error');
                    clearInterval(ref.current!);
                }
            }
        }, 4000);
    }, []);

    /* ── Local upload ───────────────────────────────────────────────────── */
    const handleLocalSubmit = async (e: React.SyntheticEvent) => {
        e.preventDefault();
        if (!file || !comunaId || !direccion.trim()) return;
        setPhase('uploading'); setProgress(0); setErrorMsg(''); setJobStatus(null);
        try {
            const fd = new FormData();
            fd.append('file',      file);
            fd.append('comunaId',  comunaId);
            fd.append('direccion', direccion.trim());
            fd.append('notas',     notas.trim());
            if (lat !== null) fd.append('lat', String(lat));
            if (lng !== null) fd.append('lng', String(lng));
            if (ortofoto) fd.append('ortofoto', ortofoto);
            if (plano)    fd.append('plano',    plano);
            setProgress(20);
            const res  = await fetch('/api/upload-las', { method: 'POST', body: fd });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
            setJobId(data.jobId); setProgress(30); setPhase('processing');
            startPolling(data.jobId, setProgress, setPhase, setJobStatus, setErrorMsg, pollRef);
        } catch (err: unknown) {
            setErrorMsg(err instanceof Error ? err.message : 'Error al subir.');
            setPhase('error');
        }
    };

    const handleLocalReset = () => {
        setPhase('idle'); setFile(null); setOrtofoto(null); setPlano(null);
        setJobId(null); setJobStatus(null);
        setProgress(0); setErrorMsg(''); setNotas(''); setLat(null); setLng(null);
        if (fileRef.current) fileRef.current.value = '';
    };

    /* ── ACC browser ────────────────────────────────────────────────────── */
    const accFetch = useCallback(async <T,>(url: string): Promise<T | null> => {
        setAccLoading(true); setAccError('');
        try {
            const res  = await fetch(url);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
            return data as T;
        } catch (err: unknown) {
            setAccError(err instanceof Error ? err.message : 'Error de conexión con ACC.');
            return null;
        } finally {
            setAccLoading(false);
        }
    }, []);

    const loadHubs = useCallback(async () => {
        const data = await accFetch<AccHub[]>('/api/acc/hubs');
        if (data) { setAccHubs(data); setSelectedHub(null); setSelectedProj(null); setAccItems([]); setFolderStack([]); }
    }, [accFetch]);

    useEffect(() => { if (activeTab === 'acc') loadHubs(); }, [activeTab, loadHubs]);

    const selectHub = useCallback(async (hub: AccHub) => {
        setSelectedHub(hub); setSelectedProj(null); setAccItems([]); setFolderStack([]);
        const data = await accFetch<AccProject[]>(`/api/acc/projects?hubId=${encodeURIComponent(hub.id)}`);
        if (data) setAccProjects(data);
    }, [accFetch]);

    const selectProject = useCallback(async (proj: AccProject) => {
        setSelectedProj(proj); setAccItems([]); setFolderStack([]); setSelectedFile(null);
        const data = await accFetch<AccItem[]>(`/api/acc/browse?hubId=${encodeURIComponent(selectedHub!.id)}&projectId=${encodeURIComponent(proj.id)}`);
        if (data) setAccItems(data);
    }, [accFetch, selectedHub]);

    const openFolder = useCallback(async (item: AccItem) => {
        setFolderStack(prev => [...prev, { id: item.id, name: item.displayName }]);
        setSelectedFile(null);
        const data = await accFetch<AccItem[]>(`/api/acc/browse?projectId=${encodeURIComponent(selectedProj!.id)}&folderId=${encodeURIComponent(item.id)}`);
        if (data) setAccItems(data);
    }, [accFetch, selectedProj]);

    const navigateBreadcrumb = useCallback(async (idx: number) => {
        const newStack = folderStack.slice(0, idx + 1);
        setFolderStack(newStack); setSelectedFile(null);
        const folderId = newStack[newStack.length - 1]?.id;
        if (folderId) {
            const data = await accFetch<AccItem[]>(`/api/acc/browse?projectId=${encodeURIComponent(selectedProj!.id)}&folderId=${encodeURIComponent(folderId)}`);
            if (data) setAccItems(data);
        } else {
            const data = await accFetch<AccItem[]>(`/api/acc/browse?hubId=${encodeURIComponent(selectedHub!.id)}&projectId=${encodeURIComponent(selectedProj!.id)}`);
            if (data) setAccItems(data);
        }
    }, [accFetch, folderStack, selectedHub, selectedProj]);

    const handleAccProcess = async () => {
        if (!selectedFile?.objectId || !comunaId || !direccion.trim()) return;
        setAccPhase('processing'); setAccProgress(0); setAccErrMsg('');
        try {
            const res = await fetch('/api/acc/process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    objectId: selectedFile.objectId,
                    fileName: selectedFile.displayName,
                    comunaId,
                    direccion: direccion.trim(),
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
            startPolling(data.jobId, setAccProgress, setAccPhase, () => {}, setAccErrMsg, accPollRef);
        } catch (err: unknown) {
            setAccErrMsg(err instanceof Error ? err.message : 'Error.'); setAccPhase('error');
        }
    };

    /* ── Building sync ──────────────────────────────────────────────────── */
    const handleSync = async () => {
        setSyncState('running'); setSyncError('');
        try {
            const res  = await fetch('/api/admin/sync-buildings', { method: 'POST' });
            const data = await res.json() as { ok: boolean; total?: number; error?: string };
            if (!data.ok) throw new Error(data.error ?? 'Error desconocido');
            setSyncCount(data.total ?? null);
            setSyncState('done');
        } catch (err: unknown) {
            setSyncError(err instanceof Error ? err.message : 'Error'); setSyncState('error');
        }
    };

    const fmtSize = (bytes: number | null) => !bytes ? '—' : bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${(bytes / 1e3).toFixed(0)} KB`;
    const fmtDate = (s: string | null) => !s ? '—' : new Date(s).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });

    /* ── Render ─────────────────────────────────────────────────────────── */
    return (
        <main className="h-screen flex flex-col bg-[#080d1a] text-slate-100 font-sans">

            {/* ── Navbar ── */}
            <PageNavbar currentPage="admin" />

            <div className="flex-1 overflow-y-auto admin-scroll page-scroll">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">

                {/* ── Building sync card ── */}
                <div className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden animate-slide-up">
                    <div className="flex items-center justify-between gap-4 px-5 py-4">
                        <div className="flex items-center gap-4 min-w-0">
                            {/* Metric badge */}
                            <div className="shrink-0 text-center">
                                <p className="text-2xl font-bold text-white tabular-nums leading-none">
                                    {syncCount !== null ? syncCount.toLocaleString('es-CO') : '—'}
                                </p>
                                <p className="text-[9px] text-slate-600 uppercase tracking-wider mt-0.5 font-semibold">
                                    edificios
                                </p>
                            </div>
                            <div className="w-px h-8 bg-white/10 shrink-0" />
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-200 leading-tight">
                                    Gemelo Digital — Cobertura de Edificios
                                </p>
                                <p className="text-xs text-slate-500 mt-0.5 leading-snug">
                                    Importa edificios de Medellín desde OpenStreetMap · Overpass API
                                </p>
                                {syncError && (
                                    <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                                        <AlertCircle size={10} />{syncError}
                                    </p>
                                )}
                            </div>
                        </div>
                        <button onClick={handleSync} disabled={syncState === 'running'}
                            className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200
                                ${syncState === 'running'  ? 'bg-indigo-900/50 text-indigo-400 cursor-wait'
                                : syncState === 'done'     ? 'bg-green-900/40 border border-green-600/40 text-green-300'
                                : 'bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/50'}`}>
                            {syncState === 'running' ? <><Loader2 size={12} className="animate-spin" /> Importando…</>
                                : syncState === 'done' ? <><CheckCircle size={12} /> Sincronizado</>
                                : <><RefreshCw size={12} /> Sincronizar</>}
                        </button>
                    </div>
                    {/* Progress strip when running */}
                    {syncState === 'running' && (
                        <div className="h-0.5 bg-white/5 w-full">
                            <div className="h-full bg-indigo-500 animate-pulse w-full" />
                        </div>
                    )}
                </div>

                {/* ── Tabs ── */}
                <div className="flex gap-2 mb-8 p-1 bg-white/5 rounded-xl border border-white/10 w-fit">
                    <TabBtn active={activeTab === 'local'} onClick={() => setActiveTab('local')} icon={<Upload size={13} />} label="Subir archivo local" />
                    <TabBtn active={activeTab === 'acc'}   onClick={() => setActiveTab('acc')}   icon={<HardHat size={13} />} label="Autodesk ACC" accent />
                </div>

                {/* ═══════════ LOCAL UPLOAD ═══════════ */}
                {activeTab === 'local' && (
                    <>
                        <div className="mb-6">
                            <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                                Subir Nube de Puntos LiDAR
                            </h1>
                            <p className="mt-1.5 text-slate-400 text-sm">
                                Sube un <Code>.las</Code> o <Code>.laz</Code> local. El servidor ejecutará PotreeConverter y registrará la intervención en el mapa.
                            </p>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm overflow-hidden">
                            <ProgressBar phase={phase} progress={progress} />
                            <div className="p-8">
                                {phase === 'idle' && (
                                    <form onSubmit={handleLocalSubmit} className="space-y-6">

                                        {/* LAS file */}
                                        <SectionLabel label="Archivo principal" step={1} />
                                        <FileDropZone file={file} fileRef={fileRef} onChange={setFile} />

                                        {/* Optional media files */}
                                        <SectionLabel label="Archivos adicionales" step={2} />
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <MediaDropZone
                                                label="Ortofoto"
                                                accept=".jpg,.jpeg,.png,.tif,.tiff,.webp,.jp2"
                                                hint="JPG · PNG · TIF · JP2"
                                                icon="🛰️"
                                                file={ortofoto}
                                                onChange={setOrtofoto}
                                            />
                                            <MediaDropZone
                                                label="Plano / Levantamiento"
                                                accept=".dwg,.dxf,.pdf"
                                                hint="DWG · DXF · PDF"
                                                icon="📐"
                                                file={plano}
                                                onChange={setPlano}
                                            />
                                        </div>

                                        {/* Divider */}
                                        <SectionLabel label="Datos de la intervención" step={3} />

                                        {/* Commune + Address */}
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <ComunaSelector comunas={comunas} value={comunaId} onChange={setComunaId} />
                                            <DireccionInput value={direccion} onChange={setDireccion} />
                                        </div>

                                        {/* Notes */}
                                        <div>
                                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                                Notas adicionales <span className="text-slate-600 font-normal">(opcional)</span>
                                            </label>
                                            <textarea
                                                value={notas} onChange={e => setNotas(e.target.value)}
                                                rows={2}
                                                placeholder="Descripción del levantamiento, equipo utilizado, condiciones del terreno…"
                                                className="w-full bg-white/5 border border-white/15 rounded-lg px-4 py-3 text-slate-200
                                                    placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1
                                                    focus:ring-indigo-500 transition-colors resize-none text-sm"
                                            />
                                        </div>

                                        {/* Coordinate picker */}
                                        <SectionLabel label="Ubicación en el mapa" required step={4} />
                                        <CoordPicker lat={lat} lng={lng} direccion={direccion} onChange={(la, lo) => {
                            setLat(isNaN(la) ? null : la);
                            setLng(isNaN(lo) ? null : lo);
                        }} />

                                        {/* Info */}
                                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 flex gap-3 text-sm">
                                            <span className="text-xl shrink-0">⏱️</span>
                                            <div className="text-amber-200/80">
                                                El procesamiento con PotreeConverter puede tardar <strong>varios minutos</strong> según el tamaño del archivo.
                                            </div>
                                        </div>

                                        <button type="submit"
                                            disabled={!file || !comunaId || !direccion.trim() || lat === null}
                                            className="w-full py-3.5 rounded-xl font-semibold text-white
                                                bg-gradient-to-r from-indigo-600 to-purple-600
                                                hover:from-indigo-500 hover:to-purple-500
                                                disabled:opacity-40 disabled:cursor-not-allowed
                                                transition-all duration-200 shadow-lg shadow-indigo-500/20">
                                            {lat === null
                                                ? 'Selecciona la ubicación en el mapa para continuar'
                                                : 'Subir y Procesar'}
                                        </button>
                                    </form>
                                )}
                                {phase === 'uploading'  && <UploadingState filename={file?.name} progress={progress} />}
                                {phase === 'processing' && <ProcessingState filename={file?.name} progress={progress} jobId={jobId} />}
                                {phase === 'done'       && <DoneState direccion={direccion} jobStatus={jobStatus} onReset={handleLocalReset} />}
                                {phase === 'error'      && <ErrorState msg={errorMsg} onReset={handleLocalReset} />}
                            </div>
                        </div>
                    </>
                )}

                {/* ═══════════ ACC BROWSER ═══════════ */}
                {activeTab === 'acc' && (
                    <>
                        <div className="mb-6 flex items-start justify-between gap-4">
                            <div>
                                <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent">
                                    Autodesk Construction Cloud
                                </h1>
                                <p className="mt-1 text-slate-400 text-sm">
                                    Navega tus proyectos ACC y procesa archivos <Code>.las</Code> directamente en el portal.
                                </p>
                            </div>
                            <button onClick={loadHubs} disabled={accLoading}
                                className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm
                                    bg-orange-600/20 border border-orange-500/40 text-orange-300
                                    hover:bg-orange-600/30 disabled:opacity-50 transition-all">
                                <RefreshCw size={13} className={accLoading ? 'animate-spin' : ''} />
                                Reconectar
                            </button>
                        </div>

                        <div className="mb-5 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-sm text-amber-200/80">
                            Configura en <Code dark>.env</Code>:
                            <code className="mx-1 bg-black/30 px-1.5 rounded text-amber-300">APS_CLIENT_ID</code> y
                            <code className="mx-1 bg-black/30 px-1.5 rounded text-amber-300">APS_CLIENT_SECRET</code>
                            — obtenlos en{' '}
                            <span className="text-amber-300 underline cursor-pointer"
                                onClick={() => window.open('https://aps.autodesk.com/myapps/', '_blank')}>
                                aps.autodesk.com/myapps
                            </span>
                        </div>

                        {accError && (
                            <div className="mb-4 flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-300">
                                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                                <span>{accError}</span>
                            </div>
                        )}

                        {accHubs.length > 0 && !selectedHub && (
                            <BrowserPanel title="Selecciona un Hub (cuenta ACC)" loading={accLoading}>
                                {accHubs.map(h => (
                                    <BrowserRow key={h.id} icon={<HardHat size={15} className="text-orange-400" />}
                                        label={h.name} onClick={() => selectHub(h)} isFolder />
                                ))}
                            </BrowserPanel>
                        )}

                        {selectedHub && !selectedProj && (
                            <BrowserPanel title={`Proyectos en "${selectedHub.name}"`} loading={accLoading}
                                onBack={() => { setSelectedHub(null); setAccProjects([]); }}>
                                {accProjects.length === 0 && !accLoading && (
                                    <EmptyBrowser msg="No se encontraron proyectos en este hub." />
                                )}
                                {accProjects.map(p => (
                                    <BrowserRow key={p.id} icon={<FolderOpen size={15} className="text-amber-400" />}
                                        label={p.name} onClick={() => selectProject(p)} isFolder />
                                ))}
                            </BrowserPanel>
                        )}

                        {selectedProj && (
                            <>
                                <BrowserPanel title={`Archivos en "${selectedProj.name}"`} loading={accLoading}
                                    onBack={() => { setSelectedProj(null); setAccItems([]); setFolderStack([]); setSelectedFile(null); }}
                                    breadcrumb={folderStack}
                                    onBreadcrumb={navigateBreadcrumb}
                                    onBreadcrumbRoot={() => selectedProj && selectProject(selectedProj)}>
                                    {accItems.length === 0 && !accLoading && (
                                        <EmptyBrowser msg="Carpeta vacía o sin archivos .las / .laz." />
                                    )}
                                    {accItems.map(item => (
                                        <BrowserRow key={item.id}
                                            icon={item.isFolder
                                                ? <FolderOpen size={15} className="text-amber-400" />
                                                : <FileBox size={15} className={selectedFile?.id === item.id ? 'text-orange-400' : 'text-slate-500'} />
                                            }
                                            label={item.displayName}
                                            meta={!item.isFolder ? `${fmtDate(item.lastModified)} · ${fmtSize(item.size)}` : undefined}
                                            isFolder={item.isFolder}
                                            selected={!item.isFolder && selectedFile?.id === item.id}
                                            onClick={() => item.isFolder ? openFolder(item) : setSelectedFile(item)}
                                        />
                                    ))}
                                </BrowserPanel>

                                {accPhase === 'idle' && (
                                    <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-6 space-y-5">
                                        <div className="flex items-center gap-2">
                                            <h2 className="text-sm font-semibold text-slate-300">Procesar archivo en portal</h2>
                                            {selectedFile && (
                                                <span className="flex items-center gap-1 text-xs text-orange-300 bg-orange-500/15 border border-orange-500/30 px-2 py-0.5 rounded-full">
                                                    <CheckCircle size={10} /> {selectedFile.displayName}
                                                </span>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <ComunaSelector comunas={comunas} value={comunaId} onChange={setComunaId} />
                                            <DireccionInput value={direccion} onChange={setDireccion} />
                                        </div>
                                        <button onClick={handleAccProcess}
                                            disabled={!selectedFile?.objectId || !comunaId || !direccion.trim()}
                                            className="w-full py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2
                                                bg-gradient-to-r from-orange-600 to-amber-600
                                                hover:from-orange-500 hover:to-amber-500
                                                disabled:opacity-40 disabled:cursor-not-allowed
                                                transition-all duration-200 shadow-lg shadow-orange-500/20">
                                            <Play size={15} />
                                            {selectedFile ? `Procesar "${selectedFile.displayName}"` : 'Selecciona un archivo .las primero'}
                                        </button>
                                    </div>
                                )}
                                {accPhase === 'processing' && (
                                    <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
                                        <ProgressBar phase={accPhase} progress={accProgress} accent="orange" />
                                        <div className="p-6">
                                            <ProcessingState filename={selectedFile?.displayName} progress={accProgress} jobId={null} source="Autodesk ACC" />
                                        </div>
                                    </div>
                                )}
                                {accPhase === 'done' && (
                                    <div className="mt-5 rounded-2xl border border-white/10 bg-white/5">
                                        <DoneState direccion={direccion} jobStatus={null} onReset={() => { setAccPhase('idle'); setSelectedFile(null); }} />
                                    </div>
                                )}
                                {accPhase === 'error' && (
                                    <div className="mt-5 rounded-2xl border border-white/10 bg-white/5">
                                        <ErrorState msg={accErrMsg} onReset={() => { setAccPhase('idle'); setAccErrMsg(''); }} />
                                    </div>
                                )}
                            </>
                        )}

                        {accLoading && accHubs.length === 0 && (
                            <div className="flex items-center justify-center py-16 gap-3 text-slate-500">
                                <Loader2 size={20} className="animate-spin" />
                                <span className="text-sm">Conectando con Autodesk ACC…</span>
                            </div>
                        )}
                        {!accLoading && !accError && accHubs.length === 0 && (
                            <div className="text-center py-16">
                                <HardHat size={40} className="mx-auto mb-3 text-slate-700" />
                                <p className="text-slate-500 text-sm">No se encontraron Hubs de ACC.</p>
                                <p className="text-slate-700 text-xs mt-1">Verifica que las credenciales tengan acceso a proyectos ACC.</p>
                            </div>
                        )}
                    </>
                )}
            </div>
            </div>
        </main>
    );
}

/* ── Sub-components ───────────────────────────────────────────────────────── */

function Code({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
    return (
        <code className={`px-1 py-0.5 rounded text-xs ${dark ? 'bg-black/30 text-amber-300' : 'bg-white/10 text-indigo-300'}`}>
            {children}
        </code>
    );
}

let _stepCounter = 0;
function resetStepCounter() { _stepCounter = 0; }

function SectionLabel({ label, required, step }: { label: string; required?: boolean; step?: number }) {
    return (
        <div className="flex items-center gap-3">
            {step !== undefined && (
                <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-600/30 border border-indigo-500/40
                    text-[10px] font-bold text-indigo-400 flex items-center justify-center">
                    {step}
                </span>
            )}
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                {label}
                {required && <span className="ml-1 text-indigo-400">*</span>}
            </span>
            <div className="h-px flex-1 bg-white/10" />
        </div>
    );
}
// suppress unused warning
void resetStepCounter;

function TabBtn({ active, onClick, icon, label, accent }: {
    active: boolean; onClick: () => void; icon: React.ReactNode; label: string; accent?: boolean;
}) {
    return (
        <button onClick={onClick}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
                ${active
                    ? accent
                        ? 'bg-orange-600/30 text-orange-300 border border-orange-500/40'
                        : 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'}`}>
            {icon}{label}
        </button>
    );
}

function ProgressBar({ phase, progress, accent = 'indigo' }: { phase: UploadPhase; progress: number; accent?: string }) {
    if (phase === 'idle') return null;
    const color = phase === 'error' ? 'bg-red-500'
        : phase === 'done'          ? 'bg-emerald-500'
        : accent === 'orange'       ? 'bg-orange-500'
        : 'bg-indigo-500';
    return (
        <div className="h-1 bg-white/10 w-full">
            <div className={`h-full transition-all duration-700 ease-out ${color}`} style={{ width: `${progress}%` }} />
        </div>
    );
}

/* ── Coordinate picker mini-map ─────────────────────────────────────────── */
function CoordPicker({ lat, lng, onChange, direccion }: {
    lat: number | null; lng: number | null;
    onChange: (lat: number, lng: number) => void;
    direccion?: string;
}) {
    const mapRef = useRef<MapRef>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [geocoding, setGeocoding] = useState(false);
    const [geocodeError, setGeocodeError] = useState('');
    const [geocodeSuccess, setGeocodeSuccess] = useState('');

    // Pre-populate search when direccion changes (only if pin not yet placed)
    useEffect(() => {
        if (direccion && lat === null) setSearchQuery(direccion);
    }, [direccion, lat]);

    const handleGeocode = useCallback(async () => {
        const q = searchQuery.trim();
        if (!q) return;
        setGeocoding(true); setGeocodeError(''); setGeocodeSuccess('');
        try {
            const encoded = encodeURIComponent(`${q}, Medellín, Antioquia, Colombia`);
            const res = await fetch(
                `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1&countrycodes=co`,
                { headers: { 'Accept-Language': 'es' } },
            );
            const data = await res.json();
            if (!Array.isArray(data) || data.length === 0) {
                setGeocodeError('No se encontró la dirección. Intenta con una referencia más específica.');
                return;
            }
            const newLat = parseFloat(data[0].lat);
            const newLng = parseFloat(data[0].lon);
            onChange(newLat, newLng);
            mapRef.current?.flyTo({ center: [newLng, newLat], zoom: 16, duration: 1200 });
            setGeocodeSuccess(data[0].display_name);
        } catch {
            setGeocodeError('Error al conectar con el servicio de geocodificación.');
        } finally {
            setGeocoding(false);
        }
    }, [searchQuery, onChange]);

    const handleClick = useCallback((e: MapMouseEvent) => {
        setGeocodeSuccess('');
        onChange(e.lngLat.lat, e.lngLat.lng);
    }, [onChange]);

    const clear = (ev: React.MouseEvent) => {
        ev.stopPropagation();
        setGeocodeSuccess('');
        onChange(NaN, NaN);
    };

    const hasPin = lat !== null && !isNaN(lat);

    return (
        <div className="space-y-2">
            {/* Address geocoding search */}
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => { setSearchQuery(e.target.value); setGeocodeError(''); setGeocodeSuccess(''); }}
                        onKeyDown={e => e.key === 'Enter' && handleGeocode()}
                        placeholder="Buscar dirección o lugar en Medellín…"
                        className="w-full bg-white/5 border border-white/15 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-200
                            placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                    />
                </div>
                <button
                    type="button"
                    onClick={handleGeocode}
                    disabled={!searchQuery.trim() || geocoding}
                    className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium
                        bg-indigo-600/30 border border-indigo-500/40 text-indigo-300
                        hover:bg-indigo-600/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                    {geocoding
                        ? <Loader2 size={13} className="animate-spin" />
                        : <Search size={13} />}
                    Buscar
                </button>
            </div>

            {/* Geocode feedback */}
            {geocodeError && (
                <p className="text-xs text-amber-400 flex items-center gap-1.5">
                    <AlertCircle size={11} className="shrink-0" />{geocodeError}
                </p>
            )}
            {geocodeSuccess && (
                <p className="text-xs text-emerald-400 flex items-center gap-1.5 truncate">
                    <CheckCircle size={11} className="shrink-0" />
                    <span className="truncate">{geocodeSuccess}</span>
                </p>
            )}

            {/* Map */}
            <div className="relative rounded-xl overflow-hidden border border-white/15 h-56">
                <Map
                    ref={mapRef}
                    initialViewState={{ longitude: -75.5812, latitude: 6.2442, zoom: 12 }}
                    style={{ width: '100%', height: '100%' }}
                    mapStyle="https://tiles.openfreemap.org/styles/dark"
                    onClick={handleClick}
                    cursor="crosshair"
                >
                    {hasPin && (
                        <Marker longitude={lng!} latitude={lat!} anchor="bottom">
                            <div className="flex flex-col items-center">
                                <div className="w-5 h-5 rounded-full bg-indigo-500 border-2 border-white shadow-lg shadow-indigo-500/60 flex items-center justify-center">
                                    <MapPin size={10} className="text-white" />
                                </div>
                                <div className="w-0.5 h-2 bg-indigo-400" />
                            </div>
                        </Marker>
                    )}
                </Map>

                {/* Hint overlay when no pin */}
                {!hasPin && (
                    <div className="absolute inset-0 flex items-end justify-center pb-4 pointer-events-none">
                        <span className="text-xs text-white/70 bg-black/60 px-3 py-1.5 rounded-full backdrop-blur-sm border border-white/10">
                            Busca la dirección arriba o haz clic en el mapa para colocar el pin
                        </span>
                    </div>
                )}
            </div>

            {/* Coordinate readout */}
            {hasPin ? (
                <div className="flex items-center justify-between bg-indigo-500/10 border border-indigo-500/30 rounded-lg px-4 py-2.5">
                    <div className="flex items-center gap-2 text-sm">
                        <MapPin size={13} className="text-indigo-400" />
                        <span className="font-mono text-indigo-300">
                            {lat!.toFixed(6)}, {lng!.toFixed(6)}
                        </span>
                    </div>
                    <button onClick={clear}
                        className="text-slate-500 hover:text-red-400 transition-colors"
                        title="Quitar pin">
                        <X size={14} />
                    </button>
                </div>
            ) : (
                <p className="text-xs text-slate-600 text-center">
                    Coordenadas requeridas — el pin determina dónde aparecerá el punto en el mapa principal.
                </p>
            )}
        </div>
    );
}

/* ── Form fields ────────────────────────────────────────────────────────── */
function FileDropZone({ file, fileRef, onChange }: {
    file: File | null;
    fileRef: React.RefObject<HTMLInputElement | null>;
    onChange: (f: File | null) => void;
}) {
    const [dragging, setDragging] = useState(false);

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault(); setDragging(false);
        const dropped = e.dataTransfer.files[0];
        if (dropped && /\.(las|laz)$/i.test(dropped.name)) onChange(dropped);
    };

    return (
        <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
                Archivo LiDAR <span className="text-indigo-400">*</span>
            </label>
            <div
                onClick={() => fileRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200
                    ${file        ? 'border-indigo-500 bg-indigo-500/10'
                    : dragging    ? 'border-indigo-400 bg-indigo-500/5 scale-[1.01]'
                    : 'border-white/20 hover:border-indigo-400 hover:bg-white/5'}`}
            >
                <div className="text-4xl mb-3">{file ? '📦' : dragging ? '📂' : '☁️'}</div>
                {file ? (
                    <div>
                        <p className="font-semibold text-indigo-300">{file.name}</p>
                        <p className="text-xs text-slate-500 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                        <button type="button" onClick={e => { e.stopPropagation(); onChange(null); if (fileRef.current) fileRef.current.value = ''; }}
                            className="mt-2 text-xs text-slate-500 hover:text-red-400 transition-colors underline">
                            Quitar archivo
                        </button>
                    </div>
                ) : (
                    <div>
                        <p className="text-slate-400">Arrastra el archivo aquí o <span className="text-indigo-400 underline">haz clic para explorar</span></p>
                        <p className="text-xs text-slate-600 mt-1">Formatos admitidos: .las · .laz</p>
                    </div>
                )}
                <input ref={fileRef} type="file" accept=".las,.laz" className="hidden"
                    onChange={e => onChange(e.target.files?.[0] ?? null)} />
            </div>
        </div>
    );
}

function MediaDropZone({ label, accept, hint, icon, file, onChange }: {
    label: string; accept: string; hint: string; icon: string;
    file: File | null; onChange: (f: File | null) => void;
}) {
    const ref = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault(); setDragging(false);
        const dropped = e.dataTransfer.files[0];
        if (dropped) onChange(dropped);
    };

    return (
        <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
                {label} <span className="text-slate-600 font-normal text-xs">(opcional)</span>
            </label>
            <div
                onClick={() => ref.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                className={`relative border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all duration-200
                    ${file     ? 'border-indigo-500/60 bg-indigo-500/8'
                    : dragging ? 'border-indigo-400 bg-indigo-500/5'
                    : 'border-white/15 hover:border-indigo-400/50 hover:bg-white/3'}`}
            >
                <div className="text-2xl mb-1">{file ? '✅' : icon}</div>
                {file ? (
                    <div>
                        <p className="text-xs font-medium text-indigo-300 truncate max-w-full">{file.name}</p>
                        <p className="text-[10px] text-slate-600 mt-0.5">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                ) : (
                    <div>
                        <p className="text-xs text-slate-500">Arrastra o haz clic</p>
                        <p className="text-[10px] text-slate-700 mt-0.5">{hint}</p>
                    </div>
                )}
                {file && (
                    <button type="button"
                        onClick={e => { e.stopPropagation(); onChange(null); if (ref.current) ref.current.value = ''; }}
                        className="absolute top-1.5 right-1.5 text-slate-600 hover:text-red-400 transition-colors">
                        <X size={12} />
                    </button>
                )}
                <input ref={ref} type="file" accept={accept} className="hidden"
                    onChange={e => onChange(e.target.files?.[0] ?? null)} />
            </div>
        </div>
    );
}

function ComunaSelector({ comunas, value, onChange }: { comunas: Comuna[]; value: string; onChange: (v: string) => void }) {
    return (
        <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
                Comuna <span className="text-indigo-400">*</span>
            </label>
            <select value={value} onChange={e => onChange(e.target.value)} required
                className="w-full bg-white/5 border border-white/15 rounded-lg px-4 py-3 text-slate-200
                    focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors appearance-none">
                {comunas.map(c => (
                    <option key={c.id} value={c.id} className="bg-[#0a0f1e]">{c.nombre} ({c.codigo})</option>
                ))}
            </select>
        </div>
    );
}

function DireccionInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
                Dirección / Nombre <span className="text-indigo-400">*</span>
            </label>
            <input type="text" value={value} onChange={e => onChange(e.target.value)} required
                placeholder="Ej: Cll 16sur-CRISTAL, Parque la Flora…"
                className="w-full bg-white/5 border border-white/15 rounded-lg px-4 py-3 text-slate-200
                    placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors" />
        </div>
    );
}

/* ── Status screens ─────────────────────────────────────────────────────── */
function BrowserPanel({ title, loading, children, onBack, breadcrumb, onBreadcrumb, onBreadcrumbRoot }: {
    title: string; loading: boolean; children: React.ReactNode;
    onBack?: () => void; breadcrumb?: { id: string; name: string }[];
    onBreadcrumb?: (idx: number) => void; onBreadcrumbRoot?: () => void;
}) {
    return (
        <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden mb-4">
            <div className="px-5 py-3 border-b border-white/8 flex items-center gap-3">
                {onBack && (
                    <button onClick={onBack} className="text-slate-500 hover:text-slate-300 transition-colors">
                        <ChevronRight size={14} className="rotate-180" />
                    </button>
                )}
                <div className="flex items-center gap-1 text-xs text-slate-400 min-w-0 flex-1">
                    <button onClick={onBreadcrumbRoot} className="hover:text-slate-200 shrink-0"><Home size={11} /></button>
                    {breadcrumb?.map((seg, i) => (
                        <span key={seg.id} className="flex items-center gap-1 min-w-0">
                            <ChevronRight size={10} className="shrink-0 text-slate-600" />
                            <button onClick={() => onBreadcrumb?.(i)}
                                className={`truncate max-w-[120px] hover:text-slate-200 ${i === breadcrumb.length - 1 ? 'text-slate-300 font-medium' : ''}`}>
                                {seg.name}
                            </button>
                        </span>
                    ))}
                    {(breadcrumb?.length ?? 0) === 0 && (
                        <span className="ml-1 text-slate-300 font-medium truncate">{title}</span>
                    )}
                </div>
                {loading && <Loader2 size={13} className="animate-spin text-slate-500 shrink-0" />}
            </div>
            <div className="divide-y divide-white/5 max-h-64 overflow-y-auto">{children}</div>
        </div>
    );
}

function BrowserRow({ icon, label, meta, isFolder, selected, onClick }: {
    icon: React.ReactNode; label: string; meta?: string;
    isFolder?: boolean; selected?: boolean; onClick: () => void;
}) {
    return (
        <button onClick={onClick}
            className={`w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors
                ${selected
                    ? 'bg-orange-600/20 border-l-2 border-orange-500'
                    : 'hover:bg-white/5 border-l-2 border-transparent'}`}>
            {icon}
            <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-200 truncate">{label}</p>
                {meta && <p className="text-[10px] text-slate-500 mt-0.5">{meta}</p>}
            </div>
            {isFolder && <ChevronRight size={12} className="text-slate-600 shrink-0" />}
            {selected && <CheckCircle size={13} className="text-orange-400 shrink-0" />}
        </button>
    );
}

function EmptyBrowser({ msg }: { msg: string }) {
    return (
        <div className="py-8 text-center text-slate-600">
            <FileBox size={28} className="mx-auto mb-2 opacity-40" />
            <p className="text-xs">{msg}</p>
        </div>
    );
}

function UploadingState({ filename, progress }: { filename?: string; progress: number }) {
    return (
        <div className="text-center py-10 space-y-4">
            <div className="text-5xl animate-bounce">📤</div>
            <h2 className="text-xl font-semibold text-slate-200">Subiendo archivo…</h2>
            <p className="text-slate-500 text-sm">Transfiriendo <strong className="text-slate-300">{filename}</strong></p>
            <div className="text-indigo-400 font-mono text-2xl">{progress}%</div>
        </div>
    );
}

function ProcessingState({ filename, progress, jobId, source }: {
    filename?: string; progress: number; jobId: string | null; source?: string;
}) {
    const [dots, setDots] = useState('');
    useEffect(() => {
        const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 500);
        return () => clearInterval(t);
    }, []);

    return (
        <div className="py-10 space-y-6 px-6">
            {/* Spinner + title */}
            <div className="flex items-center gap-4">
                <div className="relative w-12 h-12 shrink-0">
                    <div className="absolute inset-0 rounded-full border-[3px] border-indigo-500/15" />
                    <div className="absolute inset-0 rounded-full border-[3px] border-t-indigo-500 animate-spin" />
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Terminal size={16} className="text-indigo-400" />
                    </div>
                </div>
                <div>
                    <h2 className="text-base font-semibold text-slate-200 leading-tight">
                        Procesando nube de puntos{dots}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                        {source ? `Fuente: ${source}` : 'PotreeConverter en ejecución'}
                        {' · '}{progress}% completado
                    </p>
                </div>
            </div>

            {/* Terminal */}
            <div className="rounded-xl bg-black/60 border border-white/10 overflow-hidden">
                <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-white/8 bg-white/[0.02]">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                    <span className="ml-2 text-[10px] text-slate-600 font-mono">PotreeConverter — stdout</span>
                </div>
                <div className="p-4 font-mono text-xs space-y-1.5 min-h-[90px]">
                    <p className="text-slate-500">
                        <span className="text-green-500/70">▶</span>
                        {' '}<span className="text-slate-400">PotreeConverter</span>
                        {' '}<span className="text-amber-300/80">&quot;{filename}&quot;</span>
                        {' '}<span className="text-slate-500">-o nubes_procesadas/</span>
                    </p>
                    <p className="text-indigo-300/80">
                        Loading points{dots}
                    </p>
                    <p className="text-slate-500">
                        <span className="animate-blink text-indigo-400">▋</span>
                        {' '}Writing octree nodes ({progress}%)
                    </p>
                    {jobId && (
                        <p className="text-slate-700 text-[10px]">job: {jobId}</p>
                    )}
                </div>
            </div>

            {/* Progress */}
            <div>
                <div className="flex justify-between text-[10px] text-slate-600 mb-1.5">
                    <span>Progreso</span>
                    <span className="tabular-nums">{progress}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
                    <div
                        className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-700"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            </div>
        </div>
    );
}

function DoneState({ direccion, jobStatus, onReset }: {
    direccion: string; jobStatus: JobStatus | null; onReset: () => void;
}) {
    const files = [
        jobStatus?.nubeOutputDir && { label: 'Nube de puntos', url: jobStatus.nubeOutputDir, icon: '☁️', color: 'indigo' },
        jobStatus?.ortofotoUrl   && { label: 'Ortofoto',       url: jobStatus.ortofotoUrl,   icon: '🛰️', color: 'cyan'   },
        jobStatus?.planoUrl      && { label: 'Plano',          url: jobStatus.planoUrl,       icon: '📐', color: 'violet' },
    ].filter(Boolean) as { label: string; url: string; icon: string; color: string }[];

    return (
        <div className="py-10 space-y-5 px-8">
            <div className="text-center space-y-2">
                <div className="text-5xl">✅</div>
                <h2 className="text-2xl font-bold text-emerald-400">¡Procesamiento completado!</h2>
                <p className="text-slate-400 text-sm">
                    <strong className="text-white">{direccion}</strong> fue registrado en la BD y aparecerá como pin en el mapa.
                </p>
            </div>

            {files.length > 0 && (
                <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Archivos guardados</p>
                    {files.map(f => (
                        <div key={f.url} className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-lg px-4 py-3">
                            <span className="text-lg shrink-0">{f.icon}</span>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs text-slate-400 font-medium">{f.label}</p>
                                <p className="text-xs font-mono text-emerald-300 truncate">{f.url}</p>
                            </div>
                            <a href={f.url} target="_blank" rel="noreferrer"
                                className="shrink-0 text-[10px] px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-slate-400 hover:text-white transition-colors">
                                Abrir
                            </a>
                        </div>
                    ))}
                </div>
            )}

            <div className="flex gap-3 justify-center pt-2">
                <button onClick={onReset}
                    className="px-5 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-medium transition-colors">
                    Procesar otro
                </button>
                <Link href="/"
                    className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium transition-colors">
                    Ver en el mapa →
                </Link>
            </div>
        </div>
    );
}

function ErrorState({ msg, onReset }: { msg: string; onReset: () => void }) {
    return (
        <div className="text-center py-10 space-y-4 px-8">
            <div className="text-5xl">❌</div>
            <h2 className="text-xl font-semibold text-red-400">Error en el procesamiento</h2>
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-sm text-red-300 font-mono text-left">
                {msg || 'Error desconocido.'}
            </div>
            <button onClick={onReset}
                className="px-5 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-medium transition-colors">
                Intentar de nuevo
            </button>
        </div>
    );
}
