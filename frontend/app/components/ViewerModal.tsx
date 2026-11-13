'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import {
    X, MapPin, CloudSnow, FileText, Activity, Maximize2,
    ChevronRight, Image, History, Download, Clock, Loader2,
} from 'lucide-react';

/* ── Potree rainbow palette (blue→cyan→green→yellow→red) ─────────────────── */
function rainbowRGB(t: number): [number, number, number] {
    const c = Math.max(0, Math.min(1, t));
    if (c < 0.25) return [0,                               Math.round(c * 4 * 255),       255];
    if (c < 0.50) return [0,                               255,                             Math.round((0.5 - c) * 4 * 255)];
    if (c < 0.75) return [Math.round((c - 0.5) * 4 * 255), 255,                            0];
    return                [255,                             Math.round((1 - c) * 4 * 255), 0];
}

const DxfViewer = dynamic(() => import('./DxfViewer'), { ssr: false });

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

interface HistoryItem {
    id: string;
    direccion: string;
    lat: number;
    lng: number;
    createdAt?: string;
}

interface ViewerModalProps {
    isOpen: boolean;
    onClose: () => void;
    intervencion: Intervencion | null;
}

type TabId = 'potree' | 'autocad' | 'ortofoto' | 'historial';

export default function ViewerModal({ isOpen, onClose, intervencion }: ViewerModalProps) {
    const [activeTab,      setActiveTab]      = useState<TabId>('potree');
    const [history,        setHistory]        = useState<HistoryItem[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [pdfGenerating,  setPdfGenerating]  = useState(false);

    // React-recommended pattern: reset derived state during render (not in effect)
    // to avoid a cascading render cycle.
    const [prevId, setPrevId] = useState<string | undefined>(undefined);
    if (intervencion?.id !== prevId) {
        setPrevId(intervencion?.id);
        setActiveTab('potree');
        setHistory([]);
    }

    /* Fetch commune history when the history tab is activated */
    useEffect(() => {
        if (activeTab !== 'historial' || !intervencion?.comunaId) return;
        if (history.length > 0) return; // already loaded
        const load = async () => {
            setHistoryLoading(true);
            try {
                const r = await fetch(`/api/intervenciones/${intervencion.comunaId}`);
                setHistory(await r.json() as HistoryItem[]);
            } catch (err) { console.error(err); }
            finally { setHistoryLoading(false); }
        };
        void load();
    }, [activeTab, intervencion?.comunaId, history.length]);

    if (!isOpen || !intervencion) return null;

    const tabs: { id: TabId; label: string; icon: React.ReactNode; hasContent: boolean; accent: string }[] = [
        { id: 'potree',   label: 'Nube de Puntos',  icon: <CloudSnow size={13} />, hasContent: !!intervencion.pointCloudUrl, accent: 'purple' },
        { id: 'autocad',  label: 'Planos AutoCAD',  icon: <FileText size={13} />,  hasContent: !!intervencion.autocadDwgUrl,  accent: 'blue'   },
        { id: 'ortofoto', label: 'Ortofoto',         icon: <Image size={13} />,     hasContent: !!intervencion.ortofotoUrl,   accent: 'green'  },
        { id: 'historial',label: 'Historial',        icon: <History size={13} />,   hasContent: true,                          accent: 'amber'  },
    ];

    const handleExportPDF = async () => {
        if (!intervencion) return;
        setPdfGenerating(true);
        try {
            // ── 1. Fetch preview.geojson y construir canvas ───────────────────
            interface PtFeature {
                geometry: { coordinates: [number, number] };
                properties: { z: number };
            }
            let cloudImgDataUrl = '';
            const stats = { points: 0, zMin: 0, zMax: 0, zRange: 0, widthM: 0, depthM: 0 };

            if (intervencion.pointCloudUrl) {
                const previewUrl = intervencion.pointCloudUrl.replace('metadata.json', 'preview.geojson');
                try {
                    const res = await fetch(previewUrl);
                    if (res.ok) {
                        const gj = await res.json() as { features: PtFeature[] };
                        const features = gj.features;
                        stats.points = features.length;

                        let minLng = Infinity, maxLng = -Infinity;
                        let minLat = Infinity, maxLat = -Infinity;
                        let minZ   = Infinity, maxZ   = -Infinity;
                        for (const f of features) {
                            const [lng, lat] = f.geometry.coordinates;
                            const z = f.properties.z;
                            if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
                            if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
                            if (z   < minZ)   minZ   = z;   if (z   > maxZ)   maxZ   = z;
                        }
                        const zRange = Math.max(maxZ - minZ, 0.01);
                        const midLat = (minLat + maxLat) / 2;
                        stats.zMin   = minZ; stats.zMax  = maxZ; stats.zRange = zRange;
                        stats.widthM = (maxLng - minLng) * 111_320 * Math.cos(midLat * Math.PI / 180);
                        stats.depthM = (maxLat - minLat) * 110_540;

                        const CW = 1200, CH = 540;
                        const canvas = document.createElement('canvas');
                        canvas.width = CW; canvas.height = CH;
                        const ctx = canvas.getContext('2d')!;
                        ctx.fillStyle = '#0d1117';
                        ctx.fillRect(0, 0, CW, CH);

                        const dLng = maxLng - minLng || 1e-10;
                        const dLat = maxLat - minLat || 1e-10;
                        const PAD  = 22;

                        type PanelXY = (f: PtFeature) => [number, number];
                        const drawPanel = (
                            ox: number, oy: number, pw: number, ph: number,
                            title: string, getXY: PanelXY,
                        ) => {
                            ctx.fillStyle = '#161b22';
                            ctx.fillRect(ox, oy, pw, ph);
                            ctx.strokeStyle = '#30363d'; ctx.lineWidth = 1;
                            ctx.strokeRect(ox, oy, pw, ph);
                            ctx.fillStyle = '#58a6ff'; ctx.font = 'bold 14px Arial';
                            ctx.textAlign = 'center';
                            ctx.fillText(title, ox + pw / 2, oy - 7);
                            for (const f of features) {
                                const t = (f.properties.z - minZ) / zRange;
                                const [r, g, b] = rainbowRGB(t);
                                const [nx, ny] = getXY(f);
                                ctx.fillStyle = `rgb(${r},${g},${b})`;
                                ctx.beginPath();
                                ctx.arc(ox + PAD + nx * (pw - PAD * 2), oy + PAD + ny * (ph - PAD * 2), 1.8, 0, Math.PI * 2);
                                ctx.fill();
                            }
                        };

                        drawPanel(10, 32, 580, 450, 'Vista en Planta (proyección horizontal)',
                            f => [(f.geometry.coordinates[0] - minLng) / dLng, 1 - (f.geometry.coordinates[1] - minLat) / dLat]);
                        drawPanel(610, 32, 580, 450, 'Perfil de Elevación (Z)',
                            f => [(f.geometry.coordinates[0] - minLng) / dLng, 1 - (f.properties.z - minZ) / zRange]);

                        const BX = 60, BY = 506, BW = 1080, BH = 14;
                        for (let i = 0; i <= BW; i++) {
                            const [r, g, b] = rainbowRGB(i / BW);
                            ctx.fillStyle = `rgb(${r},${g},${b})`;
                            ctx.fillRect(BX + i, BY, 1, BH);
                        }
                        ctx.fillStyle = '#8b949e'; ctx.font = '11px Arial';
                        ctx.textAlign = 'left';  ctx.fillText(`Z mín: ${minZ.toFixed(2)} m`, BX, BY + BH + 14);
                        ctx.textAlign = 'right'; ctx.fillText(`Z máx: ${maxZ.toFixed(2)} m`, BX + BW, BY + BH + 14);
                        ctx.textAlign = 'center'; ctx.fillText('Escala de elevación', BX + BW / 2, BY + BH + 14);
                        cloudImgDataUrl = canvas.toDataURL('image/png');
                    }
                } catch { /* preview no disponible */ }
            }

            // ── 2. Ortofoto → base64 ──────────────────────────────────────────
            let ortofotoSrc = '';
            if (intervencion.ortofotoUrl) {
                try {
                    const res  = await fetch(intervencion.ortofotoUrl);
                    const blob = await res.blob();
                    ortofotoSrc = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result as string);
                        reader.onerror   = reject;
                        reader.readAsDataURL(blob);
                    });
                } catch { /* ortofoto no disponible */ }
            }

            // ── 3. Letterhead → base64 (garantiza carga desde blob URL) ───────
            let lhSrc = '/alcaldia-letterhead.jpg';
            try {
                const lhRes  = await fetch('/alcaldia-letterhead.jpg');
                const lhBlob = await lhRes.blob();
                lhSrc = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.onerror   = reject;
                    reader.readAsDataURL(lhBlob);
                });
            } catch { /* usar ruta relativa como fallback */ }

            // ── 4. Calcular métricas adicionales ─────────────────────────────
            const areaM2   = stats.widthM > 0 ? stats.widthM * stats.depthM : 0;
            const densidad = areaM2 > 0 ? stats.points / areaM2 : 0;
            const radicado = `LiDAR-${intervencion.id.slice(-8).toUpperCase()}`;
            const dateStr  = new Date().toLocaleDateString('es-CO', {
                weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
            });
            const dateShort = new Date().toLocaleDateString('es-CO', {
                day: '2-digit', month: 'long', year: 'numeric',
            });

            const sectionNum = { n: 0 };
            const sec = (title: string) => `<p class="section-title">${++sectionNum.n}. ${title}</p>`;

            // ── Fila de archivos adjuntos ──────────────────────────────────────
            const adjuntos = [
                intervencion.pointCloudUrl ? '✓ Nube de Puntos LiDAR' : null,
                intervencion.ortofotoUrl   ? '✓ Ortofoto / Imagen aérea' : null,
                intervencion.autocadDwgUrl ? '✓ Plano / Levantamiento DXF' : null,
            ].filter(Boolean).join('&emsp;');

            const statsRows = stats.points > 0 ? `
                <tr><td>Total de puntos procesados</td><td>${stats.points.toLocaleString('es-CO')} pts</td></tr>
                <tr><td>Elevación mínima (Z mín)</td><td>${stats.zMin.toFixed(3)} m.s.n.m.</td></tr>
                <tr><td>Elevación máxima (Z máx)</td><td>${stats.zMax.toFixed(3)} m.s.n.m.</td></tr>
                <tr><td>Rango de elevación (ΔZ)</td><td>${stats.zRange.toFixed(3)} m</td></tr>
                <tr><td>Extensión horizontal E–O</td><td>${stats.widthM.toFixed(2)} m</td></tr>
                <tr><td>Extensión vertical N–S</td><td>${stats.depthM.toFixed(2)} m</td></tr>
                ${areaM2 > 0 ? `<tr><td>Área de cobertura estimada</td><td>${areaM2.toFixed(1)} m²</td></tr>` : ''}
                ${densidad > 0 ? `<tr><td>Densidad promedio de puntos</td><td>${densidad.toFixed(1)} pts/m²</td></tr>` : ''}
                <tr><td>Sistema de referencia</td><td>WGS 84 / EPSG:4326</td></tr>
                <tr><td>Software de conversión</td><td>PotreeConverter 2.1.1</td></tr>
            ` : '<tr><td colspan="2" style="color:#888">Estadísticas no disponibles</td></tr>';

            const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Informe Técnico LiDAR — ${intervencion.direccion}</title>
  <style>
    @page { size: letter portrait; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #1a1a1a; background: #fff; }

    /* Membrete Alcaldía de Medellín — se repite en cada página impresa */
    .lh-bg {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      z-index: -1; -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .lh-bg img { width: 100%; height: 100%; object-fit: fill; display: block; }

    /* Área de contenido con márgenes seguros para no pisar el membrete */
    .page { padding: 48mm 22mm 58mm 22mm; min-height: 279mm; }

    /* ── Encabezado del documento ── */
    .date-line { text-align: right; font-size: 9.5pt; color: #444; margin-bottom: 12px; }
    .radicado-chip {
      display: inline-block; background: #eef2ff; border: 1px solid #c7d2fe;
      color: #3730a3; font-size: 8pt; font-weight: bold;
      padding: 2px 8px; border-radius: 10px; margin-bottom: 10px;
    }
    .doc-title {
      font-size: 13pt; font-weight: bold; color: #1a3a6b;
      text-align: center; text-transform: uppercase;
      letter-spacing: 0.5px; margin-bottom: 3px;
    }
    .doc-sub {
      text-align: center; font-size: 9pt; color: #555;
      font-style: italic; margin-bottom: 20px;
    }
    .divider { height: 2px; background: linear-gradient(to right, #1a3a6b, #c8920a, #1a3a6b); margin-bottom: 14px; }

    /* ── Tablas de datos ── */
    .info-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 10pt; }
    .info-table th {
      background: #1a3a6b; color: #fff; padding: 6px 10px;
      text-align: left; font-size: 10pt;
    }
    .info-table td { padding: 5px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    .info-table tr:nth-child(even) td { background: #f4f7ff; }
    .info-table td:first-child { color: #374151; font-weight: 600; width: 42%; }

    .stats-table { width: 100%; border-collapse: collapse; font-size: 10pt; margin-bottom: 14px; }
    .stats-table td { padding: 4px 10px; border: 1px solid #e5e7eb; }
    .stats-table td:first-child { background: #f0f4ff; font-weight: 600; color: #1a3a6b; width: 60%; }

    /* ── Títulos de sección ── */
    .section-title {
      font-size: 10pt; font-weight: bold; color: #1a3a6b;
      margin: 16px 0 8px; padding-bottom: 4px;
      border-bottom: 1.5px solid #c8920a;
      text-transform: uppercase; letter-spacing: 0.3px;
    }

    /* ── Visualización nube de puntos ── */
    .cloud-section { page-break-inside: avoid; break-inside: avoid; }
    .cloud-img { width: 100%; border: 1px solid #ddd; border-radius: 3px; margin-bottom: 5px; }
    .img-caption { font-size: 8.5pt; color: #666; text-align: center; font-style: italic; margin-bottom: 10px; }

    /* ── Ortofoto — evita que se parta entre páginas ── */
    .ortofoto-section { page-break-inside: avoid; break-inside: avoid; }
    .ortofoto-wrap { text-align: center; margin: 6px 0; }
    .ortofoto-img {
      max-width: 100%; max-height: 145mm;
      border: 1px solid #ddd; border-radius: 3px;
      display: block; margin: 0 auto;
    }

    /* ── Adjuntos chip list ── */
    .adjuntos-row { font-size: 9pt; color: #059669; margin: 6px 0 12px; }

    /* ── Firmas ── */
    .firma-section { margin-top: 22px; page-break-inside: avoid; break-inside: avoid; }
    .firma-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; font-size: 9pt; }
    .firma-box { text-align: center; }
    .firma-line { height: 1px; background: #333; margin: 30px 10px 5px; }
    .firma-label { font-weight: bold; font-size: 9pt; color: #1a1a1a; }
    .firma-role { color: #666; font-size: 8.5pt; }
    .entity {
      text-align: center; margin-top: 14px; font-weight: bold; font-size: 10pt;
      color: #1a3a6b; text-transform: uppercase; letter-spacing: 0.3px; line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="lh-bg"><img src="${lhSrc}" /></div>

  <div class="page">
    <p class="date-line">Medellín, ${dateStr}</p>
    <span class="radicado-chip">Radicado: ${radicado}</span>

    <p class="doc-title">Informe Técnico de Inspección LiDAR</p>
    <p class="doc-sub">Sistema de Información Geoespacial — Secretaría de Infraestructura Física</p>
    <div class="divider"></div>

    <!-- ── 1. Datos del predio ─────────────────────────────────── -->
    <table class="info-table">
      <tr><th colspan="2">Datos del Predio / Intervención</th></tr>
      <tr><td>Dirección / Predio</td><td>${intervencion.direccion}</td></tr>
      <tr><td>Municipio</td><td>Medellín, Antioquia — Colombia</td></tr>
      <tr><td>Coordenadas geográficas</td>
          <td>${intervencion.lat.toFixed(6)}° N &nbsp;|&nbsp; ${Math.abs(intervencion.lng).toFixed(6)}° O &nbsp;
              <span style="font-size:8.5pt;color:#6b7280">(WGS 84)</span></td></tr>
      <tr><td>ID de intervención</td>
          <td><code style="font-size:8.5pt;background:#f3f4f6;padding:1px 5px;border-radius:3px;color:#374151">${intervencion.id}</code></td></tr>
      <tr><td>Fecha de emisión del informe</td><td>${dateShort}</td></tr>
      ${adjuntos ? `<tr><td>Archivos disponibles</td><td class="adjuntos-row">${adjuntos}</td></tr>` : ''}
    </table>

    <!-- ── 2. Parámetros LiDAR ─────────────────────────────────── -->
    ${stats.points > 0 ? `
    ${sec('Parámetros de la Nube de Puntos LiDAR')}
    <table class="stats-table">${statsRows}</table>` : ''}

    <!-- ── 3. Visualización ───────────────────────────────────── -->
    ${cloudImgDataUrl ? `
    <div class="cloud-section">
      ${sec('Visualización — Nube de Puntos')}
      <img class="cloud-img" src="${cloudImgDataUrl}" />
      <p class="img-caption">
        Izquierda: vista en planta (proyección horizontal, coloreada por elevación).&nbsp;
        Derecha: perfil de elevación (eje X = longitud, eje Y = altura Z).&nbsp;
        Escala de color: azul = cota mínima → rojo = cota máxima.
      </p>
    </div>` : ''}

    <!-- ── 4. Ortofoto — sección sin salto de página interno ─── -->
    ${ortofotoSrc ? `
    <div class="ortofoto-section">
      ${sec('Registro Fotogramétrico — Ortofoto')}
      <div class="ortofoto-wrap">
        <img class="ortofoto-img" src="${ortofotoSrc}" alt="Ortofoto — ${intervencion.direccion}" />
      </div>
      <p class="img-caption">Ortofoto del área de intervención. Imagen georeferenciada de la zona de levantamiento.</p>
    </div>` : ''}

    <!-- ── 5. Observaciones técnicas ─────────────────────────── -->
    ${sec('Observaciones Técnicas')}
    <table class="stats-table">
      <tr><td>Tipo de levantamiento</td><td>Escaneo LiDAR terrestre / aéreo</td></tr>
      <tr><td>Estándar de datos</td><td>Formato LAS/LAZ — ASPRS LAS Specification</td></tr>
      <tr><td>Visualizador 3D</td><td>Potree WebGL — renderizado en navegador</td></tr>
      <tr><td>Estado del procesamiento</td><td style="color:#059669;font-weight:600">✓ Completado y registrado en base de datos</td></tr>
    </table>

    <!-- ── Firmas ─────────────────────────────────────────────── -->
    <div class="firma-section">
      <div class="firma-grid">
        <div class="firma-box">
          <div class="firma-line"></div>
          <p class="firma-label">Proyectó</p>
          <p class="firma-role">Analista Geoespacial</p>
        </div>
        <div class="firma-box">
          <div class="firma-line"></div>
          <p class="firma-label">Revisó</p>
          <p class="firma-role">Coordinador Técnico</p>
        </div>
        <div class="firma-box">
          <div class="firma-line"></div>
          <p class="firma-label">Aprobó</p>
          <p class="firma-role">Secretario(a) de Infraestructura</p>
        </div>
      </div>
      <p class="entity">Secretaría de Infraestructura Física<br>Alcaldía de Medellín — Distrito de Ciencia, Tecnología e Innovación</p>
    </div>
  </div>
</body>
</html>`;

            const blobHtml = new Blob([html], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blobHtml);
            const win = window.open(url, '_blank', 'width=960,height=850');
            // Esperar a que el letthead se cargue antes de imprimir
            setTimeout(() => { win?.print(); setTimeout(() => URL.revokeObjectURL(url), 5000); }, 1400);

        } finally {
            setPdfGenerating(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="
                relative flex flex-col w-full max-w-5xl h-[88vh]
                bg-slate-950/95 backdrop-blur-3xl
                rounded-3xl border border-slate-700/50
                shadow-2xl shadow-blue-950/60
                overflow-hidden animate-in fade-in zoom-in-95 duration-200
            ">
                <div className="absolute top-0 left-12 right-12 h-px bg-gradient-to-r from-transparent via-indigo-500/70 to-transparent" />
                <div className="absolute top-0 left-0 right-0 h-40 bg-gradient-to-b from-indigo-900/10 to-transparent pointer-events-none" />

                {/* ── Header ────────────────────────────────────────────────── */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-sm shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-600/30 to-purple-600/30 border border-indigo-500/30 flex items-center justify-center">
                                <MapPin size={18} className="text-indigo-400" />
                            </div>
                            <div className="absolute inset-0 rounded-2xl border border-indigo-500/20 animate-ping opacity-30" />
                        </div>
                        <div>
                            <h2 className="text-white font-bold text-base leading-tight tracking-tight">{intervencion.direccion}</h2>
                            <div className="flex items-center gap-2 mt-0.5">
                                <p className="text-slate-400 text-xs">Visor geoespacial LiDAR & CAD</p>
                                <div className="flex items-center gap-1 text-[10px] text-green-400">
                                    <Activity size={9} className="animate-pulse" />
                                    <span>activo</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5">
                            {intervencion.pointCloudUrl && <Badge type="lidar" />}
                            {intervencion.autocadDwgUrl && <Badge type="dxf" />}
                            {intervencion.ortofotoUrl   && <Badge type="ortofoto" />}
                        </div>

                        {/* PDF export button */}
                        <button
                            onClick={() => { void handleExportPDF(); }}
                            disabled={pdfGenerating}
                            title="Exportar informe técnico PDF"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium
                                bg-slate-800/70 border border-slate-700/50 text-slate-400
                                hover:text-white hover:bg-slate-700/70 hover:border-slate-600
                                disabled:opacity-50 disabled:cursor-not-allowed
                                transition-all duration-200"
                        >
                            {pdfGenerating
                                ? <Loader2 size={12} className="animate-spin" />
                                : <Download size={12} />}
                            <span className="hidden sm:inline">{pdfGenerating ? 'Generando…' : 'PDF'}</span>
                        </button>

                        <button
                            onClick={onClose}
                            className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-500
                                hover:text-white hover:bg-slate-700/60 border border-transparent
                                hover:border-slate-600/50 transition-all duration-200"
                            aria-label="Cerrar"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>

                {/* ── Tab Bar ───────────────────────────────────────────────── */}
                <div className="flex items-center gap-1.5 px-6 py-3 bg-slate-900/40 border-b border-slate-800/60 shrink-0 overflow-x-auto">
                    {tabs.map((tab) => {
                        const isActive  = activeTab === tab.id;
                        const colorMap: Record<string, string> = {
                            purple: 'bg-purple-600/20 text-purple-300 border border-purple-500/40 shadow-lg shadow-purple-900/30',
                            blue:   'bg-blue-600/20 text-blue-300 border border-blue-500/40 shadow-lg shadow-blue-900/30',
                            green:  'bg-green-600/20 text-green-300 border border-green-500/40 shadow-lg shadow-green-900/30',
                            amber:  'bg-amber-600/20 text-amber-300 border border-amber-500/40 shadow-lg shadow-amber-900/30',
                        };
                        const inactive = 'bg-slate-800/50 text-slate-400 border border-slate-700/50 hover:bg-slate-700/60 hover:text-slate-200';

                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`
                                    flex items-center gap-2 px-4 py-1.5 rounded-xl text-sm font-medium
                                    transition-all duration-200 whitespace-nowrap
                                    ${isActive ? (colorMap[tab.accent] ?? inactive) : inactive}
                                `}
                            >
                                {tab.icon}
                                <span>{tab.label}</span>
                                {!tab.hasContent && tab.id !== 'historial' && (
                                    <span className="ml-1 px-1.5 py-0.5 text-[9px] rounded-full bg-slate-700/80 text-slate-500 border border-slate-600/30">
                                        Sin datos
                                    </span>
                                )}
                                {isActive && <ChevronRight size={11} className="opacity-60" />}
                            </button>
                        );
                    })}

                    <div className="ml-auto text-[10px] text-slate-600 flex items-center gap-1 shrink-0">
                        <Maximize2 size={10} />
                        <span>{intervencion.lat.toFixed(4)}, {intervencion.lng.toFixed(4)}</span>
                    </div>
                </div>

                {/* ── Content ───────────────────────────────────────────────── */}
                <div className="flex-1 relative overflow-hidden bg-slate-950">

                    {activeTab === 'potree' && (
                        <div className="w-full h-full">
                            {intervencion.pointCloudUrl ? (
                                <iframe
                                    src={`/potree_custom/viewer.html?cloud=${encodeURIComponent(intervencion.pointCloudUrl)}`}
                                    className="w-full h-full border-0"
                                    title="Visor de nube de puntos LiDAR"
                                    allowFullScreen
                                />
                            ) : (
                                <EmptyState icon={<CloudSnow size={40} className="text-slate-700" />} title="Sin nube de puntos" subtitle="No se ha cargado un archivo LiDAR para esta intervención." accent="purple" />
                            )}
                        </div>
                    )}

                    {activeTab === 'autocad' && (
                        <div className="w-full h-full">
                            {intervencion.autocadDwgUrl
                                ? <DxfViewer fileUrl={intervencion.autocadDwgUrl} />
                                : <EmptyState icon={<FileText size={40} className="text-slate-700" />} title="Sin plano DXF" subtitle="No se ha cargado un archivo .dxf para esta intervención." accent="blue" />
                            }
                        </div>
                    )}

                    {activeTab === 'ortofoto' && (
                        <div className="w-full h-full flex items-center justify-center overflow-auto bg-slate-950 p-4">
                            {intervencion.ortofotoUrl ? (
                                <img
                                    src={intervencion.ortofotoUrl}
                                    alt={`Ortofoto — ${intervencion.direccion}`}
                                    className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
                                />
                            ) : (
                                <EmptyState icon={<Image size={40} className="text-slate-700" />} title="Sin ortofoto" subtitle="No se ha cargado una imagen ortofoto para esta intervención." accent="green" />
                            )}
                        </div>
                    )}

                    {activeTab === 'historial' && (
                        <div className="w-full h-full overflow-y-auto p-6
                            [scrollbar-width:thin] [scrollbar-color:#334155_transparent]
                            [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-700">

                            <div className="max-w-2xl mx-auto space-y-3">
                                <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-4">
                                    Intervenciones en esta comuna
                                </p>

                                {historyLoading && (
                                    <div className="flex items-center justify-center py-16 gap-3 text-slate-500">
                                        <Loader2 size={18} className="animate-spin" />
                                        <span className="text-sm">Cargando historial…</span>
                                    </div>
                                )}

                                {!historyLoading && history.length === 0 && (
                                    <EmptyState icon={<History size={40} className="text-slate-700" />} title="Sin historial" subtitle="No hay otras intervenciones registradas en esta comuna." accent="amber" />
                                )}

                                {!historyLoading && history.map(item => {
                                    const isCurrent = item.id === intervencion.id;
                                    return (
                                        <div
                                            key={item.id}
                                            className={`flex items-start gap-3 p-4 rounded-xl border transition-all
                                                ${isCurrent
                                                    ? 'bg-indigo-500/15 border-indigo-500/40'
                                                    : 'bg-slate-800/50 border-slate-700/50 hover:border-slate-600/60'
                                                }`}
                                        >
                                            <div className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0
                                                ${isCurrent ? 'bg-indigo-500/30' : 'bg-slate-700/60'}`}>
                                                <MapPin size={14} className={isCurrent ? 'text-indigo-400' : 'text-slate-500'} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-sm font-medium truncate ${isCurrent ? 'text-indigo-300' : 'text-slate-300'}`}>
                                                    {item.direccion}
                                                    {isCurrent && <span className="ml-2 text-[10px] bg-indigo-500/30 text-indigo-300 px-1.5 py-0.5 rounded-full">actual</span>}
                                                </p>
                                                <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
                                                    <MapPin size={9} />
                                                    <span className="font-mono">{item.lat?.toFixed(4)}, {item.lng?.toFixed(4)}</span>
                                                    {item.createdAt && (
                                                        <>
                                                            <span>·</span>
                                                            <Clock size={9} />
                                                            <span>{new Date(item.createdAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                <div className="absolute bottom-0 left-12 right-12 h-px bg-gradient-to-r from-transparent via-slate-600/40 to-transparent" />
            </div>
        </div>
    );
}

/* ── Badges ──────────────────────────────────────────────────────────────── */
function Badge({ type }: { type: 'lidar' | 'dxf' | 'ortofoto' }) {
    if (type === 'lidar') return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/20 text-purple-400 border border-purple-500/30">
            <CloudSnow size={8} />LiDAR
        </span>
    );
    if (type === 'ortofoto') return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-500/20 text-green-400 border border-green-500/30">
            <Image size={8} />Ortofoto
        </span>
    );
    return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
            <FileText size={8} />DXF
        </span>
    );
}

/* ── Empty state ─────────────────────────────────────────────────────────── */
function EmptyState({ icon, title, subtitle, accent }: { icon: React.ReactNode; title: string; subtitle: string; accent: 'purple' | 'blue' | 'green' | 'amber' }) {
    const ring = { purple: 'border-purple-500/20', blue: 'border-blue-500/20', green: 'border-green-500/20', amber: 'border-amber-500/20' }[accent];
    const glow = { purple: 'shadow-purple-900/20', blue: 'shadow-blue-900/20', green: 'shadow-green-900/20', amber: 'shadow-amber-900/20' }[accent];

    return (
        <div className="flex items-center justify-center h-full">
            <div className="text-center">
                <div className={`w-20 h-20 mx-auto mb-5 rounded-3xl bg-slate-800/60 border ${ring} shadow-2xl ${glow} flex items-center justify-center`}>
                    {icon}
                </div>
                <p className="text-slate-300 text-base font-semibold">{title}</p>
                <p className="text-slate-600 text-sm mt-2 max-w-xs mx-auto leading-relaxed">{subtitle}</p>
            </div>
        </div>
    );
}
