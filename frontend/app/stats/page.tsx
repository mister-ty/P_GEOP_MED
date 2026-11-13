'use client';

import { useEffect, useState, useCallback } from 'react';
import {
    CloudSnow, FileText, Image, MapPin, Activity, TrendingUp,
    Clock, BarChart2, RefreshCw, Award, AlertCircle, Zap,
} from 'lucide-react';
import PageNavbar from '../components/PageNavbar';

/* ── API contract ─────────────────────────────────────────────────────────── */
interface StatsData {
    total:        number;
    withLidar:    number;
    withDxf:      number;
    withOrtofoto: number;
    byComuna: { nombre: string; codigo: string; count: number }[];
    recent:   { id: string; direccion: string; nombre: string; createdAt: string | null }[];
}

/* ── Counter animation hook ───────────────────────────────────────────────── */
function useCountUp(target: number, duration = 1100, enabled = true): number {
    const [count, setCount] = useState(0);
    useEffect(() => {
        if (!enabled) { setCount(target); return; }
        if (target === 0) { setCount(0); return; }
        let raf: number;
        const start = performance.now();
        const tick = (now: number) => {
            const p = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - p, 3); // ease-out-cubic
            setCount(Math.round(eased * target));
            if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [target, duration, enabled]);
    return count;
}

/* ── Ring (donut) chart — pure SVG ───────────────────────────────────────── */
function RingChart({ pct, color, size = 72, stroke = 6 }: {
    pct: number; color: string; size?: number; stroke?: number;
}) {
    const r   = (size - stroke * 2) / 2;
    const cx  = size / 2;
    const circ = 2 * Math.PI * r;
    const [dash, setDash] = useState(0);
    useEffect(() => {
        const t = setTimeout(() => setDash((pct / 100) * circ), 80);
        return () => clearTimeout(t);
    }, [pct, circ]);
    return (
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
            <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
            <circle cx={cx} cy={cx} r={r} fill="none"
                stroke={color} strokeWidth={stroke} strokeLinecap="round"
                strokeDasharray={`${dash} ${circ}`}
                style={{ transition: 'stroke-dasharray 1.15s cubic-bezier(0.4,0,0.2,1)' }}
            />
        </svg>
    );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */
export default function StatsPage() {
    const [data,      setData]      = useState<StatsData | null>(null);
    const [loading,   setLoading]   = useState(true);
    const [error,     setError]     = useState('');
    const [lastFetch, setLastFetch] = useState<Date | null>(null);
    const [refreshing,setRefreshing]= useState(false);
    const [animated,  setAnimated]  = useState(false);

    const loadStats = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true); else setLoading(true);
        setError('');
        try {
            const d = await fetch('/api/stats').then(r => r.json()) as StatsData | { error: string };
            if ('error' in d) throw new Error((d as { error: string }).error);
            setData(d as StatsData);
            setLastFetch(new Date());
            setAnimated(false);
            setTimeout(() => setAnimated(true), 60);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => { void loadStats(); }, [loadStats]);

    /* Derived metrics */
    const maxCount    = data ? Math.max(...data.byComuna.map(c => c.count), 1) : 1;
    const sorted      = data ? [...data.byComuna].sort((a, b) => b.count - a.count) : [];
    const topComuna   = sorted[0];
    const emptyCnt    = data ? data.byComuna.filter(c => c.count === 0).length : 0;
    const score       = data && data.total > 0
        ? Math.round(((data.withLidar + data.withDxf + data.withOrtofoto) / (data.total * 3)) * 100)
        : 0;
    const lidarPct    = data && data.total > 0 ? (data.withLidar    / data.total) * 100 : 0;
    const dxfPct      = data && data.total > 0 ? (data.withDxf      / data.total) * 100 : 0;
    const ortoPct     = data && data.total > 0 ? (data.withOrtofoto / data.total) * 100 : 0;

    /* Elapsed text */
    const elapsed = lastFetch
        ? (() => {
            const s = Math.floor((Date.now() - lastFetch.getTime()) / 1000);
            if (s < 5)  return 'ahora mismo';
            if (s < 60) return `hace ${s}s`;
            return `hace ${Math.floor(s / 60)}m`;
        })()
        : '';

    return (
        <main className="h-screen flex flex-col bg-[#080d1a] text-slate-100 font-sans">
            <PageNavbar currentPage="stats" />

            <div className="flex-1 overflow-y-auto page-scroll">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">

                {/* ── Page header ─────────────────────────────────────────────── */}
                <div className="flex items-end justify-between gap-4 animate-slide-up">
                    <div>
                        <h1 className="text-2xl font-bold text-white tracking-tight">
                            Panel de Estadísticas
                        </h1>
                        <p className="text-slate-500 text-sm mt-1">
                            Cobertura LiDAR · DXF · Ortofotos — Medellín
                        </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                        {lastFetch && (
                            <span className="text-xs text-slate-600 hidden sm:inline select-none">
                                Actualizado {elapsed}
                            </span>
                        )}
                        <button
                            onClick={() => void loadStats(true)}
                            disabled={refreshing || loading}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium
                                bg-slate-800/70 border border-slate-700/50 text-slate-400
                                hover:text-white hover:bg-slate-700/70 hover:border-slate-600
                                disabled:opacity-40 disabled:cursor-not-allowed
                                transition-all duration-200"
                        >
                            <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
                            Actualizar
                        </button>
                    </div>
                </div>

                {/* ── Skeleton ────────────────────────────────────────────────── */}
                {loading && <LoadingSkeleton />}

                {/* ── Error ───────────────────────────────────────────────────── */}
                {error && (
                    <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20
                        rounded-2xl p-5 text-sm text-red-300 animate-slide-up">
                        <AlertCircle size={16} className="shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold">Error al cargar estadísticas</p>
                            <p className="text-red-400/60 mt-1 text-xs font-mono">{error}</p>
                        </div>
                    </div>
                )}

                {data && !loading && (
                    <>
                        {/* ── KPI cards ───────────────────────────────────────── */}
                        <section className="animate-slide-up" style={{ animationDelay: '50ms' }}>
                            <SectionTitle icon={<TrendingUp size={13} />} label="Resumen general" />
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
                                <KpiCard icon={<MapPin size={16} className="text-indigo-400" />}
                                    label="Intervenciones" value={data.total}
                                    pct={100} colorHex="#6366f1" borderCls="border-indigo-500/25 hover:border-indigo-500/45"
                                    animated={animated} />
                                <KpiCard icon={<CloudSnow size={16} className="text-purple-400" />}
                                    label="Con nube LiDAR" value={data.withLidar}
                                    pct={lidarPct} colorHex="#a855f7" borderCls="border-purple-500/25 hover:border-purple-500/45"
                                    animated={animated} />
                                <KpiCard icon={<FileText size={16} className="text-blue-400" />}
                                    label="Con plano DXF" value={data.withDxf}
                                    pct={dxfPct} colorHex="#3b82f6" borderCls="border-blue-500/25 hover:border-blue-500/45"
                                    animated={animated} />
                                <KpiCard icon={<Image size={16} className="text-emerald-400" />}
                                    label="Con ortofoto" value={data.withOrtofoto}
                                    pct={ortoPct} colorHex="#10b981" borderCls="border-emerald-500/25 hover:border-emerald-500/45"
                                    animated={animated} />
                            </div>
                        </section>

                        {/* ── Chart + Insights (two-col on lg) ────────────────── */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-slide-up"
                            style={{ animationDelay: '120ms' }}>

                            {/* Bar chart */}
                            <section className="lg:col-span-2">
                                <SectionTitle icon={<BarChart2 size={13} />} label="Intervenciones por comuna" />
                                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.025] p-5 space-y-2">
                                    {sorted.filter(c => c.count > 0).length === 0
                                        ? <EmptyChart />
                                        : sorted.map((c, i) => (
                                            <ComunaBar key={c.codigo}
                                                nombre={c.nombre} count={c.count} max={maxCount}
                                                rank={i + 1} animated={animated} delay={i * 35} />
                                        ))
                                    }
                                </div>
                            </section>

                            {/* Insights panel */}
                            <section className="flex flex-col gap-4">
                                <SectionTitle icon={<Zap size={13} />} label="Indicadores" />

                                {/* Coverage score */}
                                <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
                                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-4">
                                        Score de cobertura
                                    </p>
                                    <div className="flex items-center gap-4">
                                        <div className="relative shrink-0">
                                            <RingChart pct={animated ? score : 0}
                                                color={score >= 70 ? '#10b981' : score >= 40 ? '#f59e0b' : '#6366f1'}
                                                size={80} stroke={7} />
                                            <div className="absolute inset-0 flex items-center justify-center">
                                                <span className="text-lg font-bold text-white tabular-nums">{score}%</span>
                                            </div>
                                        </div>
                                        <div className="flex-1 space-y-2">
                                            <CoverageRow label="LiDAR"    pct={lidarPct} color="#a855f7" animated={animated} />
                                            <CoverageRow label="DXF"      pct={dxfPct}   color="#3b82f6" animated={animated} />
                                            <CoverageRow label="Ortofoto" pct={ortoPct}  color="#10b981" animated={animated} />
                                        </div>
                                    </div>
                                </div>

                                {/* Top commune */}
                                {topComuna && topComuna.count > 0 && (
                                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-5">
                                        <div className="flex items-center gap-1.5 mb-2">
                                            <Award size={12} className="text-amber-400" />
                                            <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">
                                                Comuna líder
                                            </span>
                                        </div>
                                        <p className="text-white font-bold text-sm leading-tight">
                                            {topComuna.nombre}
                                        </p>
                                        <p className="text-amber-300/60 text-xs mt-0.5">
                                            {topComuna.count} intervención{topComuna.count !== 1 ? 'es' : ''}
                                        </p>
                                    </div>
                                )}

                                {/* Zero-coverage communes */}
                                {emptyCnt > 0 && (
                                    <div className="rounded-2xl border border-slate-700/40 bg-white/[0.02] p-5">
                                        <div className="flex items-center gap-1.5 mb-2">
                                            <Activity size={12} className="text-slate-600" />
                                            <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                                                Sin cobertura
                                            </span>
                                        </div>
                                        <p className="text-white font-bold text-2xl tabular-nums">{emptyCnt}</p>
                                        <p className="text-slate-600 text-xs mt-0.5">
                                            comunas sin intervenciones
                                        </p>
                                    </div>
                                )}
                            </section>
                        </div>

                        {/* ── Recent activity ─────────────────────────────────── */}
                        <section className="animate-slide-up" style={{ animationDelay: '200ms' }}>
                            <SectionTitle icon={<Clock size={13} />} label="Actividad reciente" />
                            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.025] overflow-hidden">
                                {data.recent.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-600">
                                        <Activity size={32} className="opacity-30" />
                                        <p className="text-sm">Sin actividad registrada.</p>
                                        <p className="text-xs opacity-60">Sube archivos desde el panel de Admin.</p>
                                    </div>
                                ) : (
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-white/8 bg-white/[0.02]">
                                                <th className="text-left px-5 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider w-8">#</th>
                                                <th className="text-left px-5 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Dirección</th>
                                                <th className="text-left px-5 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider hidden sm:table-cell">Comuna</th>
                                                <th className="text-right px-5 py-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Fecha</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/[0.04]">
                                            {data.recent.map((r, i) => (
                                                <tr key={r.id}
                                                    className="hover:bg-white/[0.03] transition-colors group animate-slide-left"
                                                    style={{ animationDelay: `${250 + i * 45}ms` }}>
                                                    <td className="px-5 py-3.5 text-slate-700 text-xs font-mono">{i + 1}</td>
                                                    <td className="px-5 py-3.5">
                                                        <div className="flex items-center gap-2.5">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500/50
                                                                group-hover:bg-indigo-400 transition-colors shrink-0" />
                                                            <span className="text-slate-200 truncate max-w-[170px] sm:max-w-xs">
                                                                {r.direccion}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-5 py-3.5 hidden sm:table-cell">
                                                        <span className="text-[11px] text-slate-400
                                                            bg-white/5 border border-white/10
                                                            px-2 py-0.5 rounded-full whitespace-nowrap">
                                                            {r.nombre}
                                                        </span>
                                                    </td>
                                                    <td className="px-5 py-3.5 text-right">
                                                        <span className="text-xs text-slate-500 whitespace-nowrap">
                                                            {r.createdAt
                                                                ? new Date(r.createdAt).toLocaleDateString('es-CO', {
                                                                    day: '2-digit', month: 'short', year: 'numeric',
                                                                })
                                                                : '—'}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </section>
                    </>
                )}
            </div>
            </div>
        </main>
    );
}

/* ── Sub-components ───────────────────────────────────────────────────────── */

function SectionTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
    return (
        <div className="flex items-center gap-2 text-slate-500">
            {icon}
            <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
            <div className="flex-1 h-px bg-white/[0.07]" />
        </div>
    );
}

function KpiCard({ icon, label, value, pct, colorHex, borderCls, animated }: {
    icon: React.ReactNode; label: string; value: number; pct: number;
    colorHex: string; borderCls: string; animated: boolean;
}) {
    const displayValue = useCountUp(value, 1100, animated);
    return (
        <div className={`rounded-2xl border ${borderCls} bg-white/[0.025] p-5
            transition-all duration-200 hover:bg-white/[0.04] group`}>
            <div className="flex items-start justify-between mb-4">
                <div className="w-9 h-9 rounded-xl bg-black/30 border border-white/8
                    flex items-center justify-center">
                    {icon}
                </div>
                <div className="relative">
                    <RingChart pct={animated ? Math.round(pct) : 0} color={colorHex} size={48} stroke={4} />
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[9px] font-bold text-white/60 tabular-nums">
                            {Math.round(pct)}%
                        </span>
                    </div>
                </div>
            </div>
            <p className="text-3xl font-bold text-white tabular-nums mb-1">
                {displayValue.toLocaleString('es-CO')}
            </p>
            <p className="text-xs text-slate-500 leading-tight">{label}</p>
        </div>
    );
}

function ComunaBar({ nombre, count, max, rank, animated, delay }: {
    nombre: string; count: number; max: number; rank: number;
    animated: boolean; delay: number;
}) {
    const pct = max > 0 ? (count / max) * 100 : 0;
    return (
        <div className="flex items-center gap-3 group">
            <span className="text-[10px] text-slate-700 w-4 text-right shrink-0 font-mono tabular-nums">
                {rank}
            </span>
            <span className="text-xs text-slate-400 w-28 sm:w-36 shrink-0 truncate
                group-hover:text-slate-200 transition-colors duration-150">
                {nombre}
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-white/8 overflow-hidden">
                {count > 0 && (
                    <div
                        className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-purple-500"
                        style={{
                            width: animated ? `${pct}%` : '0%',
                            transition: 'width 0.7s cubic-bezier(0.4,0,0.2,1)',
                            transitionDelay: `${delay}ms`,
                        }}
                    />
                )}
            </div>
            <span className={`text-xs font-mono tabular-nums w-5 text-right shrink-0
                ${count > 0 ? 'text-white' : 'text-slate-700'}`}>
                {count}
            </span>
        </div>
    );
}

function CoverageRow({ label, pct, color, animated }: {
    label: string; pct: number; color: string; animated: boolean;
}) {
    return (
        <div className="flex items-center gap-2">
            <span className="w-12 text-[10px] text-slate-500">{label}</span>
            <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                <div
                    className="h-full rounded-full"
                    style={{
                        width: animated ? `${pct}%` : '0%',
                        background: color,
                        transition: 'width 1.1s cubic-bezier(0.4,0,0.2,1)',
                    }}
                />
            </div>
            <span className="text-[10px] text-slate-400 w-7 text-right tabular-nums">
                {Math.round(pct)}%
            </span>
        </div>
    );
}

function LoadingSkeleton() {
    return (
        <div className="space-y-6 animate-pulse">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-32 rounded-2xl bg-white/[0.04] border border-white/8" />
                ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 h-72 rounded-2xl bg-white/[0.04] border border-white/8" />
                <div className="space-y-4">
                    <div className="h-36 rounded-2xl bg-white/[0.04] border border-white/8" />
                    <div className="h-20 rounded-2xl bg-white/[0.04] border border-white/8" />
                </div>
            </div>
            <div className="h-56 rounded-2xl bg-white/[0.04] border border-white/8" />
        </div>
    );
}

function EmptyChart() {
    return (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-600">
            <BarChart2 size={32} className="opacity-25" />
            <div className="text-center">
                <p className="text-sm">Sin intervenciones registradas.</p>
                <p className="text-xs mt-1 opacity-60">Sube archivos desde el panel de Admin.</p>
            </div>
        </div>
    );
}
