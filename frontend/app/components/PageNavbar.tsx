'use client';

import Link from 'next/link';
import { Layers, BarChart2, Settings, Home, ChevronRight } from 'lucide-react';

interface PageNavbarProps {
    currentPage: 'admin' | 'stats';
}

export default function PageNavbar({ currentPage }: PageNavbarProps) {
    return (
        <header className="sticky top-0 z-50 flex items-center gap-3 px-6 py-3
            border-b border-white/10 bg-[#0a0f1e]/90 backdrop-blur-md">

            {/* ── Logo (link to home) ─────────────────────────────────────── */}
            <Link href="/" className="flex items-center gap-2.5 shrink-0 group">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center
                    bg-gradient-to-br from-indigo-600/40 to-purple-600/40
                    border border-indigo-500/40 shadow-lg shadow-indigo-900/30
                    group-hover:border-indigo-400/60 transition-colors">
                    <Layers size={15} className="text-indigo-300" />
                </div>
                <div className="leading-none hidden sm:block">
                    <p className="text-white font-bold text-sm tracking-tight">Geo-Portal Medellín</p>
                    <p className="text-slate-500 text-[10px] tracking-wide">LiDAR · DXF · Ortofotos</p>
                </div>
            </Link>

            {/* ── Breadcrumb ─────────────────────────────────────────────── */}
            <ChevronRight size={12} className="text-slate-700 shrink-0" />
            <span className="text-sm font-medium text-indigo-300 truncate">
                {currentPage === 'admin' ? 'Administración' : 'Estadísticas'}
            </span>

            {/* ── Spacer ─────────────────────────────────────────────────── */}
            <div className="flex-1" />

            {/* ── Navigation links ───────────────────────────────────────── */}
            <nav className="flex items-center gap-1.5">
                <Link
                    href="/"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium
                        text-slate-400 hover:text-white hover:bg-slate-800/80
                        border border-transparent hover:border-slate-700/60
                        transition-all duration-200"
                >
                    <Home size={12} />
                    <span className="hidden sm:inline">Mapa</span>
                </Link>

                <Link
                    href="/stats"
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium
                        border transition-all duration-200
                        ${currentPage === 'stats'
                            ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300'
                            : 'text-slate-400 hover:text-white hover:bg-slate-800/80 border-transparent hover:border-slate-700/60'
                        }`}
                >
                    <BarChart2 size={12} />
                    <span className="hidden sm:inline">Estadísticas</span>
                </Link>

                <Link
                    href="/admin"
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium
                        border transition-all duration-200
                        ${currentPage === 'admin'
                            ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300'
                            : 'text-slate-400 hover:text-white hover:bg-slate-800/80 border-transparent hover:border-slate-700/60'
                        }`}
                >
                    <Settings size={12} />
                    <span className="hidden sm:inline">Admin</span>
                </Link>
            </nav>
        </header>
    );
}
