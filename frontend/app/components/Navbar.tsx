'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Settings, Box, Layers, Activity, Building2, Map, Satellite, Search, X, BarChart2, MapPin, Loader2 } from 'lucide-react';

interface GeoResult { lat: number; lng: number; name: string; }

interface NavbarProps {
    show3D: boolean;
    onToggle3D: () => void;
    showSatellite?: boolean;
    onToggleSatellite?: () => void;
    onSearch?: (lat: number, lng: number) => void;
    totalIntervenciones?: number;
}

export default function Navbar({ show3D, onToggle3D, showSatellite, onToggleSatellite, onSearch, totalIntervenciones }: NavbarProps) {
    return (
        <header className="
            absolute top-0 left-0 right-0 z-[1100]
            h-14 px-4 flex items-center justify-between
            pointer-events-none
        ">
            {/* ── Left: logo ──────────────────────────────────────────────── */}
            <div className="flex items-center gap-3 pointer-events-auto">
                <div className="
                    w-8 h-8 rounded-xl flex items-center justify-center
                    bg-gradient-to-br from-indigo-600/40 to-purple-600/40
                    border border-indigo-500/40 shadow-lg shadow-indigo-900/30
                ">
                    <Layers size={15} className="text-indigo-300" />
                </div>
                <div className="leading-none">
                    <p className="text-white font-bold text-sm tracking-tight drop-shadow">Geo-Portal Medellín</p>
                    <p className="text-slate-500 text-[10px] tracking-wide">LiDAR · DXF · Ortofotos</p>
                </div>
            </div>

            {/* ── Center: status pills + search ─────────────────────────── */}
            <div className="hidden sm:flex items-center gap-2 pointer-events-auto">
                <Pill icon={<Activity size={9} className="text-green-400 animate-pulse" />} label="16 comunas" />
                {totalIntervenciones !== undefined && (
                    <Pill icon={<Box size={9} className="text-indigo-400" />} label={`${totalIntervenciones} intervenciones`} />
                )}
                {onSearch && <SearchBar onSearch={onSearch} />}
            </div>

            {/* ── Right: controls ──────────────────────────────────────────── */}
            <div className="flex items-center gap-2 pointer-events-auto">

                {/* Satellite toggle */}
                {onToggleSatellite && (
                    <button
                        onClick={onToggleSatellite}
                        title={showSatellite ? 'Ocultar satélite' : 'Imagen satelital'}
                        className={`
                            flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold
                            border transition-all duration-300
                            ${showSatellite
                                ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300 shadow-lg shadow-emerald-900/30'
                                : 'bg-slate-900/80 border-slate-700/60 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                            }
                        `}
                    >
                        <Satellite size={13} />
                        <span className="hidden md:inline">Satélite</span>
                    </button>
                )}

                {/* 3D toggle */}
                <button
                    onClick={onToggle3D}
                    title={show3D ? 'Volver a vista 2D' : 'Activar Gemelo Digital 3D'}
                    className={`
                        relative flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold
                        border transition-all duration-300
                        ${show3D
                            ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-300 shadow-lg shadow-cyan-900/40'
                            : 'bg-slate-900/80 border-slate-700/60 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                        }
                    `}
                >
                    {show3D
                        ? <Building2 size={13} className="text-cyan-400" />
                        : <Map size={13} />
                    }
                    <span>{show3D ? 'Gemelo Digital' : '2D'}</span>
                    {show3D && (
                        <span className="flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-cyan-400 opacity-75 top-1.5 right-1.5" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400 top-1.5 right-1.5" />
                        </span>
                    )}
                </button>

                {/* Stats link */}
                <Link
                    href="/stats"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium
                        bg-slate-900/80 border border-slate-700/60 text-slate-400
                        hover:text-white hover:bg-slate-800/90 hover:border-slate-600
                        transition-all duration-200"
                    title="Panel de estadísticas"
                >
                    <BarChart2 size={12} />
                    <span className="hidden md:inline">Stats</span>
                </Link>

                {/* Admin link */}
                <Link
                    href="/admin"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium
                        bg-slate-900/80 border border-slate-700/60 text-slate-400
                        hover:text-white hover:bg-slate-800/90 hover:border-slate-600
                        transition-all duration-200"
                >
                    <Settings size={12} />
                    <span className="hidden sm:inline">Admin</span>
                </Link>
            </div>
        </header>
    );
}

/* ── Search bar ──────────────────────────────────────────────────────────── */
function SearchBar({ onSearch }: { onSearch: (lat: number, lng: number) => void }) {
    const [open,    setOpen]    = useState(false);
    const [query,   setQuery]   = useState('');
    const [results, setResults] = useState<GeoResult[]>([]);
    const [loading, setLoading] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (open) inputRef.current?.focus();
    }, [open]);

    /* Close on outside click */
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
                setResults([]);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const handleSearch = useCallback(async () => {
        if (!query.trim()) return;
        setLoading(true);
        try {
            const res  = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
            const data = await res.json() as GeoResult[];
            setResults(data);
        } catch {
            setResults([]);
        } finally {
            setLoading(false);
        }
    }, [query]);

    const handleKey = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleSearch();
        if (e.key === 'Escape') { setOpen(false); setResults([]); }
    };

    const pick = (r: GeoResult) => {
        onSearch(r.lat, r.lng);
        setOpen(false);
        setQuery('');
        setResults([]);
    };

    return (
        <div ref={containerRef} className="relative">
            {!open ? (
                <button
                    onClick={() => setOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium
                        bg-slate-900/80 border border-slate-700/60 text-slate-400
                        hover:text-white hover:bg-slate-800/90 hover:border-slate-600
                        transition-all duration-200"
                    title="Buscar dirección"
                >
                    <Search size={12} />
                    <span>Buscar</span>
                </button>
            ) : (
                <div className="flex items-center gap-1.5
                    bg-slate-900/95 border border-indigo-500/40 rounded-xl px-3 py-1.5
                    shadow-lg shadow-black/40">
                    <Search size={12} className="text-indigo-400 shrink-0" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKey}
                        placeholder="Buscar en Medellín…"
                        className="w-44 bg-transparent text-slate-200 text-xs placeholder-slate-500 outline-none"
                    />
                    {loading
                        ? <Loader2 size={12} className="text-indigo-400 animate-spin shrink-0" />
                        : query
                            ? <button onClick={() => { setQuery(''); setResults([]); }} className="text-slate-500 hover:text-slate-300"><X size={12} /></button>
                            : null
                    }
                    <button
                        onClick={handleSearch}
                        className="shrink-0 text-[10px] bg-indigo-600/40 hover:bg-indigo-600/70 border border-indigo-500/40
                            text-indigo-300 px-2 py-0.5 rounded-lg transition-colors"
                    >
                        Ir
                    </button>
                </div>
            )}

            {/* Results dropdown */}
            {results.length > 0 && (
                <div className="absolute top-full left-0 mt-2 w-72 rounded-xl
                    bg-slate-900/98 border border-slate-700/60 shadow-2xl shadow-black/60
                    overflow-hidden z-[1200]">
                    {results.map((r, i) => (
                        <button
                            key={i}
                            onClick={() => pick(r)}
                            className="w-full flex items-start gap-2.5 px-4 py-3 text-left
                                hover:bg-slate-800/80 border-b border-slate-800/60 last:border-0 transition-colors"
                        >
                            <MapPin size={13} className="text-indigo-400 mt-0.5 shrink-0" />
                            <span className="text-xs text-slate-300 leading-snug line-clamp-2">{r.name}</span>
                        </button>
                    ))}
                </div>
            )}

            {open && results.length === 0 && !loading && query && (
                <div className="absolute top-full left-0 mt-2 w-64 rounded-xl
                    bg-slate-900/98 border border-slate-700/60 shadow-2xl shadow-black/60
                    px-4 py-3 text-xs text-slate-500 z-[1200]">
                    Sin resultados en Medellín.
                </div>
            )}
        </div>
    );
}

function Pill({ icon, label }: { icon: React.ReactNode; label: string }) {
    return (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full
            bg-slate-900/80 border border-slate-700/50 text-[11px] text-slate-400 backdrop-blur-sm">
            {icon}
            <span>{label}</span>
        </span>
    );
}
