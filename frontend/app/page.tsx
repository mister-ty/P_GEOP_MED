'use client';

import { useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import ViewerModal from './components/ViewerModal';
import Sidebar from './components/Sidebar';
import Navbar from './components/Navbar';
import type { Intervencion } from './components/MapViewer';

const MapViewer = dynamic(() => import('./components/MapViewer'), {
    ssr: false,
    loading: () => (
        <div className="flex items-center justify-center w-screen h-screen bg-[#0a0f1e]">
            <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500 mx-auto mb-4" />
                <p className="text-indigo-300 text-sm font-medium">Iniciando visor 3D de Medellín…</p>
            </div>
        </div>
    ),
});

export default function Home() {
    const [selectedIntervencion, setSelectedIntervencion] = useState<Intervencion | null>(null);
    const [comunaNombre,         setComunaNombre]         = useState<string | undefined>(undefined);
    const [comunaIntervenciones, setComunaIntervenciones] = useState<Intervencion[]>([]);
    const [sidebarVisible,       setSidebarVisible]       = useState(false);
    const [show3D,               setShow3D]               = useState(false);
    const [showSatellite,        setShowSatellite]        = useState(false);
    const [totalIntervenciones,  setTotalIntervenciones]  = useState<number | undefined>(undefined);

    const flyAndOpenRef = useRef<((interv: Intervencion) => void) | null>(null);
    const flyToRef      = useRef<((lat: number, lng: number) => void) | null>(null);

    const handleRegisterFlyAndOpen = useCallback((fn: (interv: Intervencion) => void) => {
        flyAndOpenRef.current = fn;
    }, []);

    const handleRegisterFlyTo = useCallback((fn: (lat: number, lng: number) => void) => {
        flyToRef.current = fn;
    }, []);

    const handleSidebarSelect = useCallback((interv: Intervencion) => {
        if (flyAndOpenRef.current) {
            flyAndOpenRef.current(interv);
        } else {
            setSelectedIntervencion(interv);
        }
    }, []);

    const handleComunaSelect = useCallback((nombre: string, intervenciones: Intervencion[]) => {
        setComunaNombre(nombre);
        setComunaIntervenciones(intervenciones);
        setSidebarVisible(true);
        setTotalIntervenciones((prev) => Math.max(prev ?? 0, intervenciones.length));
    }, []);

    const handleSearch = useCallback((lat: number, lng: number) => {
        flyToRef.current?.(lat, lng);
    }, []);

    return (
        <main className="w-screen h-screen overflow-hidden relative bg-[#0a0f1e]">
            {/* ── Floating top navbar ──────────────────────────────────────── */}
            <Navbar
                show3D={show3D}
                onToggle3D={() => setShow3D((v) => !v)}
                showSatellite={showSatellite}
                onToggleSatellite={() => setShowSatellite((v) => !v)}
                onSearch={handleSearch}
                totalIntervenciones={totalIntervenciones}
            />

            {/* ── 3D map ───────────────────────────────────────────────────── */}
            {/* Hidden (not unmounted) while the viewer modal is open so the
                MapLibre WebGL context is not destroyed and recreated. Hiding
                with visibility:hidden lets the browser stop GPU rendering
                for the canvas, freeing VRAM for the Potree point-cloud viewer. */}
            <div style={{ visibility: selectedIntervencion ? 'hidden' : 'visible', position: 'absolute', inset: 0 }}>
                <MapViewer
                    onOpenModal={setSelectedIntervencion}
                    onComunaSelect={handleComunaSelect}
                    onRegisterFlyAndOpen={handleRegisterFlyAndOpen}
                    onRegisterFlyTo={handleRegisterFlyTo}
                    show3D={show3D}
                    showSatellite={showSatellite}
                />
            </div>

            {/* ── Commune sidebar ──────────────────────────────────────────── */}
            {sidebarVisible && (
                <Sidebar
                    comunaNombre={comunaNombre}
                    intervenciones={comunaIntervenciones}
                    onSelectIntervencion={handleSidebarSelect}
                    onClose={() => setSidebarVisible(false)}
                />
            )}

            {/* ── Asset viewer modal ───────────────────────────────────────── */}
            <ViewerModal
                isOpen={!!selectedIntervencion}
                onClose={() => setSelectedIntervencion(null)}
                intervencion={selectedIntervencion}
            />
        </main>
    );
}
