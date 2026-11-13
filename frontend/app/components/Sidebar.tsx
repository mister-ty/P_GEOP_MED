'use client';

import { useState } from 'react';
import { MapPin, Box, FileText, ChevronRight, CloudSnow, X, Search, Layers, Zap, Image } from 'lucide-react';

interface Intervencion {
    id: string;
    comunaId: string;
    direccion: string;
    autocadDwgUrl: string | null;
    pointCloudUrl: string | null;
    ortofotoUrl: string | null;
    lat: number;
    lng: number;
}

interface SidebarProps {
    comunaNombre?: string;
    intervenciones: Intervencion[];
    onSelectIntervencion: (interv: Intervencion) => void;
    onClose?: () => void;
}

export default function Sidebar({ comunaNombre, intervenciones, onSelectIntervencion, onClose }: SidebarProps) {
    const [filter, setFilter] = useState('');

    const filtered = intervenciones.filter((i) =>
        i.direccion.toLowerCase().includes(filter.toLowerCase())
    );

    const withLidar    = intervenciones.filter(i => i.pointCloudUrl).length;
    const withDxf      = intervenciones.filter(i => i.autocadDwgUrl).length;
    const withOrtofoto = intervenciones.filter(i => i.ortofotoUrl).length;

    return (
        <aside className="
            absolute top-3 right-3 bottom-3 z-[1000]
            w-[22rem] flex flex-col
            bg-slate-900/90 backdrop-blur-2xl
            border border-slate-700/50
            rounded-2xl shadow-2xl shadow-black/40
            overflow-hidden
        ">
            {/* ── Glowing top edge ─────────────────────────────────────────── */}
            <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-indigo-500/60 to-transparent" />

            {/* ── Header ───────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-700/60 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="relative w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
                        <MapPin size={16} className="text-indigo-400" />
                        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-green-400 border-2 border-slate-900 animate-pulse" />
                    </div>
                    <div>
                        <p className="text-white font-semibold text-sm leading-tight tracking-tight">
                            {comunaNombre ?? 'Selecciona una comuna'}
                        </p>
                        <p className="text-slate-400 text-[11px] mt-0.5">
                            {intervenciones.length} intervención{intervenciones.length !== 1 ? 'es' : ''}
                        </p>
                    </div>
                </div>
                {onClose && (
                    <button
                        onClick={onClose}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-700/60 transition-all duration-150"
                        aria-label="Cerrar panel"
                    >
                        <X size={14} />
                    </button>
                )}
            </div>

            {/* ── Stats bar ────────────────────────────────────────────────── */}
            {intervenciones.length > 0 && (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-800/40 border-b border-slate-700/40 shrink-0">
                    <div className="flex items-center gap-1.5 text-[11px] text-purple-400 font-medium">
                        <CloudSnow size={11} />
                        <span>{withLidar} LiDAR</span>
                    </div>
                    <div className="w-px h-3 bg-slate-600" />
                    <div className="flex items-center gap-1.5 text-[11px] text-blue-400 font-medium">
                        <FileText size={11} />
                        <span>{withDxf} DXF</span>
                    </div>
                    <div className="w-px h-3 bg-slate-600" />
                    <div className="flex items-center gap-1.5 text-[11px] text-green-400 font-medium">
                        <Image size={11} />
                        <span>{withOrtofoto} Ortofoto</span>
                    </div>
                    <div className="ml-auto flex items-center gap-1 text-[11px] text-slate-500">
                        <Layers size={10} />
                        <span>{intervenciones.length} total</span>
                    </div>
                </div>
            )}

            {/* ── Search ───────────────────────────────────────────────────── */}
            {intervenciones.length > 3 && (
                <div className="px-3 pt-3 shrink-0">
                    <div className="flex items-center gap-2 bg-slate-800/70 rounded-xl px-3 py-2 border border-slate-700/60 focus-within:border-indigo-500/50 transition-colors duration-200">
                        <Search size={12} className="text-slate-500 shrink-0" />
                        <input
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            placeholder="Buscar intervención…"
                            className="flex-1 bg-transparent text-slate-200 text-xs placeholder-slate-500 outline-none"
                        />
                        {filter && (
                            <button onClick={() => setFilter('')} className="text-slate-500 hover:text-slate-300">
                                <X size={11} />
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* ── Cards list ───────────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5
                [scrollbar-width:thin] [scrollbar-color:#334155_transparent]
                [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:transparent
                [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-700
            ">
                {filtered.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-40 text-slate-600 text-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-slate-800/60 flex items-center justify-center">
                            <MapPin size={22} className="text-slate-600" />
                        </div>
                        <p className="text-xs text-slate-500">
                            {intervenciones.length === 0
                                ? 'Haz clic en una comuna del mapa.'
                                : 'Sin resultados para tu búsqueda.'}
                        </p>
                    </div>
                )}

                {filtered.map((interv) => (
                    <IntervencionCard
                        key={interv.id}
                        interv={interv}
                        onSelect={onSelectIntervencion}
                    />
                ))}
            </div>

            {/* ── Footer ───────────────────────────────────────────────────── */}
            <div className="px-4 py-2.5 border-t border-slate-700/40 shrink-0 flex items-center justify-between">
                <p className="text-slate-600 text-[10px] tracking-widest uppercase font-medium">
                    Geo-Portal Medellín
                </p>
                <div className="flex items-center gap-1 text-[10px] text-green-500/70">
                    <Zap size={9} />
                    <span>Live</span>
                </div>
            </div>
        </aside>
    );
}

/* ── Individual card ─────────────────────────────────────────────────────── */
function IntervencionCard({ interv, onSelect }: { interv: Intervencion; onSelect: (i: Intervencion) => void }) {
    return (
        <button
            onClick={() => onSelect(interv)}
            className="
                w-full text-left group
                flex items-start gap-3 p-3
                bg-slate-800/50 hover:bg-slate-800
                border border-slate-700/50 hover:border-blue-500/50
                rounded-xl
                hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/30
                transition-all duration-300
                relative overflow-hidden
            "
        >
            {/* Hover shimmer */}
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300
                bg-gradient-to-r from-transparent via-blue-500/5 to-transparent pointer-events-none" />

            {/* Icon */}
            <div className="flex-shrink-0 w-9 h-9 rounded-lg
                bg-gradient-to-br from-indigo-600/20 to-purple-600/20
                border border-indigo-500/20 group-hover:border-indigo-500/40
                flex items-center justify-center transition-all duration-300">
                <Box size={15} className="text-indigo-400 group-hover:text-indigo-300 transition-colors" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
                <p className="text-slate-200 text-xs font-semibold truncate leading-tight group-hover:text-white transition-colors">
                    {interv.direccion}
                </p>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {interv.pointCloudUrl && <Badge type="lidar"    />}
                    {interv.autocadDwgUrl && <Badge type="dxf"     />}
                    {interv.ortofotoUrl   && <Badge type="ortofoto" />}
                    {!interv.pointCloudUrl && !interv.autocadDwgUrl && !interv.ortofotoUrl && (
                        <span className="text-[10px] text-slate-600 italic">Sin archivos</span>
                    )}
                </div>
            </div>

            <ChevronRight
                size={13}
                className="text-slate-600 group-hover:text-blue-400 mt-1 shrink-0 group-hover:translate-x-0.5 transition-all duration-300"
            />
        </button>
    );
}

/* ── Badges ──────────────────────────────────────────────────────────────── */
function Badge({ type }: { type: 'lidar' | 'dxf' | 'ortofoto' }) {
    if (type === 'lidar') return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium
            bg-purple-500/20 text-purple-400 border border-purple-500/30">
            <CloudSnow size={8} />LiDAR
        </span>
    );
    if (type === 'ortofoto') return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium
            bg-green-500/20 text-green-400 border border-green-500/30">
            <Image size={8} />Ortofoto
        </span>
    );
    return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium
            bg-blue-500/20 text-blue-400 border border-blue-500/30">
            <FileText size={8} />DXF
        </span>
    );
}
