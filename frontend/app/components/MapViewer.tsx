'use client';

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import Map, { Source, Layer, MapRef } from 'react-map-gl/maplibre';
import { MercatorCoordinate } from 'maplibre-gl';
import type { LayerSpecification, MapMouseEvent, MapGeoJSONFeature, CustomLayerInterface } from 'maplibre-gl';
import type { FeatureCollection, Point, Feature } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';

/* ── Rainbow colour for point cloud (Potree palette) ─────────────────────── */
function rainbowRGB(t: number): [number, number, number] {
    const c = Math.max(0, Math.min(1, t));
    if (c < 0.25) return [0,                           Math.round(c * 4 * 255),         255];
    if (c < 0.50) return [0,                           255,                              Math.round((0.5 - c) * 4 * 255)];
    if (c < 0.75) return [Math.round((c - 0.5) * 4 * 255), 255,                         0];
    return                [255,                         Math.round((1 - c) * 4 * 255),   0];
}

/* ── Types ────────────────────────────────────────────────────────────────── */
export interface Intervencion {
    id: string; comunaId: string; direccion: string;
    autocadDwgUrl: string | null; pointCloudUrl: string | null; ortofotoUrl: string | null;
    lat: number; lng: number;
}

interface MapViewerProps {
    onOpenModal: (intervencion: Intervencion) => void;
    onComunaSelect?: (nombre: string, intervenciones: Intervencion[]) => void;
    onRegisterFlyAndOpen?: (fn: (interv: Intervencion) => void) => void;
    onRegisterFlyTo?: (fn: (lat: number, lng: number) => void) => void;
    show3D?: boolean;
    showSatellite?: boolean;
}

interface IntervencionProperties {
    id: string; comunaId: string; direccion: string;
    autocadDwgUrl: string | null; pointCloudUrl: string | null; ortofotoUrl: string | null;
    lat: number; lng: number;
}

/* ── Commune color expression (shared) ────────────────────────────────────── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const COMMUNE_COLOR: any = [
    'match', ['%', ['to-number', ['get', 'codigo']], 16],
    0,  '#f472b6', 1, '#fb923c', 2,  '#4ade80', 3,  '#60a5fa',
    4,  '#a78bfa', 5, '#f9a8d4', 6,  '#fbbf24', 7,  '#c084fc',
    8,  '#34d399', 9, '#67e8f9', 10, '#f87171', 11, '#facc15',
    12, '#6ee7b7', 13, '#7dd3fc', 14, '#e879f9', 15, '#f472b6',
    '#93c5fd',
];

/* ── Static 2D layers (always visible) ───────────────────────────────────── */
const comunaLabelLayer: LayerSpecification = {
    id: 'comunas-label',
    type: 'symbol',
    source: 'comunas',
    layout: {
        'text-field': ['get', 'nombre'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9, 15, 13],
        'text-anchor': 'center',
        'text-max-width': 8,
        'text-allow-overlap': false,
    },
    paint: {
        'text-color': '#ffffff',
        'text-opacity': 0.9,
        'text-halo-color': '#000000',
        'text-halo-width': 1.5,
    },
};

const comunaHoverLayer: LayerSpecification = {
    id: 'comunas-fill-hover',
    type: 'fill',
    source: 'comunas',
    paint: {
        'fill-color': '#ffffff',
        'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.12, 0],
    },
};

/* ── Cluster / point layers ───────────────────────────────────────────────── */
const clusterCircleLayer: LayerSpecification = {
    id: 'clusters', type: 'circle', source: 'intervenciones-source',
    filter: ['has', 'point_count'],
    paint: {
        'circle-color': ['step', ['get', 'point_count'], '#6366f1', 5, '#8b5cf6', 10, '#a855f7'],
        'circle-radius': ['step', ['get', 'point_count'], 18, 5, 22, 10, 28],
        'circle-opacity': 0.9,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': 0.5,
        'circle-pitch-alignment': 'viewport',
    },
};

const clusterCountLayer: LayerSpecification = {
    id: 'cluster-count', type: 'symbol', source: 'intervenciones-source',
    filter: ['has', 'point_count'],
    layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 13, 'text-allow-overlap': true },
    paint: { 'text-color': '#ffffff' },
};

const unclusteredPointLayer: LayerSpecification = {
    id: 'unclustered-point', type: 'circle', source: 'intervenciones-source',
    filter: ['!', ['has', 'point_count']],
    paint: {
        'circle-color': '#6366f1', 'circle-radius': 10,
        'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff',
        'circle-opacity': 0.95,
        'circle-pitch-alignment': 'viewport',
    },
};

const unclusteredLabelLayer: LayerSpecification = {
    id: 'unclustered-label', type: 'symbol', source: 'intervenciones-source',
    filter: ['!', ['has', 'point_count']],
    layout: { 'text-field': '📍', 'text-size': 14, 'text-allow-overlap': true, 'text-ignore-placement': true },
};

/* ── Component ────────────────────────────────────────────────────────────── */
export default function MapViewer({
    onOpenModal, onComunaSelect, onRegisterFlyAndOpen, onRegisterFlyTo,
    show3D = false, showSatellite = false,
}: MapViewerProps) {
    const mapRef          = useRef<MapRef>(null);
    const hoveredComunaId = useRef<string | null>(null);
    const flyPending      = useRef(false);
    const cloud3dLayerId  = useRef<string | null>(null);

    const [comunasGeoJSON, setComunasGeoJSON] = useState<FeatureCollection | null>(null);
    const [intervenciones, setIntervenciones] = useState<Intervencion[]>([]);
    const [mapLoaded,      setMapLoaded]      = useState(false);
    const [cloudPreview,   setCloudPreview]   = useState<{
        id: string; geojson: FeatureCollection; zMin: number; zMax: number;
    } | null>(null);

    /* ── Intervenciones GeoJSON ──────────────────────────────────────────── */
    const intervencionesGeoJSON = useMemo<FeatureCollection<Point>>(() => ({
        type: 'FeatureCollection',
        features: intervenciones.map((inv) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [inv.lng, inv.lat] },
            properties: {
                id: inv.id, comunaId: inv.comunaId, direccion: inv.direccion,
                autocadDwgUrl: inv.autocadDwgUrl, pointCloudUrl: inv.pointCloudUrl,
                ortofotoUrl: inv.ortofotoUrl, lat: inv.lat, lng: inv.lng,
            } satisfies IntervencionProperties,
        })),
    }), [intervenciones]);

    /* ── Load point cloud preview (non-blocking) ─────────────────────────── */
    const loadCloudPreview = useCallback(async (interv: Intervencion) => {
        if (!interv.pointCloudUrl) return;
        if (cloudPreview?.id === interv.id) return; // already loaded
        const previewUrl = interv.pointCloudUrl.replace('metadata.json', 'preview.geojson');
        try {
            const res = await fetch(previewUrl);
            if (!res.ok) return;
            const geojson = await res.json() as FeatureCollection;
            const zValues = geojson.features.map(f => (f.properties as { z: number }).z);
            const zMin = Math.min(...zValues);
            const zMax = Math.max(...zValues);
            setCloudPreview({ id: interv.id, geojson, zMin, zMax });
        } catch { /* preview no disponible */ }
    }, [cloudPreview?.id]);

    /* ── Fly + open modal ────────────────────────────────────────────────── */
    const flyAndOpen = useCallback((interv: Intervencion) => {
        const map = mapRef.current?.getMap();
        if (!map) return;
        loadCloudPreview(interv);
        if (flyPending.current) map.off('moveend', map as unknown as Parameters<typeof map.off>[1]);
        flyPending.current = true;
        map.flyTo({ center: [interv.lng, interv.lat], zoom: 18, pitch: 65, bearing: -25, duration: 2000, essential: true });
        map.once('moveend', () => { flyPending.current = false; onOpenModal(interv); });
    }, [onOpenModal, loadCloudPreview]);

    /* ── Fly to coords (for search) ──────────────────────────────────────── */
    const flyTo = useCallback((lat: number, lng: number) => {
        const map = mapRef.current?.getMap();
        if (!map) return;
        map.flyTo({ center: [lng, lat], zoom: 16, duration: 1400, essential: true });
    }, []);

    useEffect(() => { onRegisterFlyAndOpen?.(flyAndOpen); }, [flyAndOpen, onRegisterFlyAndOpen]);
    useEffect(() => { onRegisterFlyTo?.(flyTo); },         [flyTo,       onRegisterFlyTo]);

    /* ── 3D point cloud custom WebGL layer ──────────────────────────────────
     * Converts the preview GeoJSON to Mercator coordinates and renders the
     * points as gl.POINTS in 3D space on top of the pitched map.
     * The terrain-exaggeration factor (1.8×) is applied to the base altitude
     * so the cloud sits at the visual terrain surface rather than below it.
     * ─────────────────────────────────────────────────────────────────────── */
    useEffect(() => {
        const map = mapRef.current?.getMap();
        if (!map || !mapLoaded) return;

        // ── Remove previous layer ──────────────────────────────────────────
        if (cloud3dLayerId.current) {
            try { if (map.getLayer(cloud3dLayerId.current)) map.removeLayer(cloud3dLayerId.current); }
            catch { /* ignore if already removed */ }
            cloud3dLayerId.current = null;
        }
        if (!cloudPreview) return;

        const { geojson, zMin, zMax } = cloudPreview;
        const features = geojson.features as Feature<Point, { z: number }>[];
        if (features.length === 0) return;

        const zRange = Math.max(zMax - zMin, 0.01);

        // Centre of cloud (for terrain elevation query)
        let sumLng = 0, sumLat = 0;
        for (const f of features) { sumLng += f.geometry.coordinates[0]; sumLat += f.geometry.coordinates[1]; }
        const cx = sumLng / features.length;
        const cy = sumLat / features.length;

        // queryTerrainElevation already returns elevation × exaggeration factor
        // internally (MapLibre multiplies by terrain.exaggeration() before returning).
        // Using the value directly places the cloud at the visual terrain surface.
        // Fallback: Medellín avg ~1550 m × 1.8 exaggeration = 2790.
        const baseAlt = map.queryTerrainElevation([cx, cy]) ?? (1550 * 1.8);

        // Vertical exaggeration applied to the LiDAR Z values so a 19 m scan
        // reads as ~95 m visually — enough to recognise the 3-D form clearly.
        const Z_EXG = 5;

        // ── Pre-compute Mercator positions + colours ───────────────────────
        const n = features.length;
        const posBuf = new Float32Array(n * 3);
        const colBuf = new Float32Array(n * 3);

        features.forEach((f, i) => {
            const [lng, lat] = f.geometry.coordinates;
            const z          = f.properties.z;
            const mc = MercatorCoordinate.fromLngLat([lng, lat], baseAlt + (z - zMin) * Z_EXG);
            posBuf[i * 3]     = mc.x;
            posBuf[i * 3 + 1] = mc.y;
            posBuf[i * 3 + 2] = mc.z;

            const [r, g, b] = rainbowRGB((z - zMin) / zRange);
            colBuf[i * 3]     = r / 255;
            colBuf[i * 3 + 1] = g / 255;
            colBuf[i * 3 + 2] = b / 255;
        });

        // ── GLSL shaders ──────────────────────────────────────────────────
        const VERT = `
            attribute vec3 aPos;
            attribute vec3 aCol;
            uniform   mat4 uMatrix;
            uniform   float uPointSize;
            varying   vec3 vCol;
            void main() {
                gl_Position  = uMatrix * vec4(aPos, 1.0);
                gl_PointSize = uPointSize;
                vCol = aCol;
            }`;
        const FRAG = `
            precision mediump float;
            varying vec3 vCol;
            void main() {
                if (length(gl_PointCoord - vec2(0.5)) > 0.5) discard;
                gl_FragColor = vec4(vCol, 0.90);
            }`;

        const layerId = `cloud-3d-${cloudPreview.id}`;
        let   prog: WebGLProgram | null = null;
        let   posGL: WebGLBuffer | null = null;
        let   colGL: WebGLBuffer | null = null;

        const capturedMap = map;

        const layer: CustomLayerInterface = {
            id:             layerId,
            type:           'custom',
            renderingMode:  '3d',

            onAdd(_m, gl) {
                const compileShader = (type: number, src: string) => {
                    const s = gl.createShader(type)!;
                    gl.shaderSource(s, src);
                    gl.compileShader(s);
                    return s;
                };
                prog = gl.createProgram()!;
                gl.attachShader(prog, compileShader(gl.VERTEX_SHADER,   VERT));
                gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, FRAG));
                gl.linkProgram(prog);

                posGL = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, posGL);
                gl.bufferData(gl.ARRAY_BUFFER, posBuf, gl.STATIC_DRAW);

                colGL = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, colGL);
                gl.bufferData(gl.ARRAY_BUFFER, colBuf, gl.STATIC_DRAW);
            },

            render(gl, args) {
                if (!prog || !posGL || !colGL) return;

                // Support both MapLibre 3.x (defaultProjectionData.mainMatrix)
                // and older versions where the matrix was the direct second arg.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const a = args as any;
                const raw: ArrayLike<number> =
                    a?.defaultProjectionData?.mainMatrix ??
                    a?.projectionMatrix ??
                    a;
                const matrix = raw instanceof Float32Array
                    ? raw
                    : new Float32Array(raw as number[]);

                const zoom      = capturedMap.getZoom();
                // Larger points at high zoom so the cloud surface looks filled-in.
                const pointSize = Math.max(3, Math.min(18, (zoom - 12) * 2.5));

                gl.useProgram(prog);
                gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uMatrix'),    false, matrix);
                gl.uniform1f(       gl.getUniformLocation(prog, 'uPointSize'), pointSize);

                const posLoc = gl.getAttribLocation(prog, 'aPos');
                gl.bindBuffer(gl.ARRAY_BUFFER, posGL);
                gl.enableVertexAttribArray(posLoc);
                gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);

                const colLoc = gl.getAttribLocation(prog, 'aCol');
                gl.bindBuffer(gl.ARRAY_BUFFER, colGL);
                gl.enableVertexAttribArray(colLoc);
                gl.vertexAttribPointer(colLoc, 3, gl.FLOAT, false, 0, 0);

                gl.enable(gl.DEPTH_TEST);
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                gl.drawArrays(gl.POINTS, 0, n);
            },
        };

        try {
            map.addLayer(layer as unknown as LayerSpecification);
            cloud3dLayerId.current = layerId;
        } catch (e) {
            console.warn('[cloud-3d] Error adding layer:', e);
        }

        return () => {
            try {
                if (capturedMap.getLayer(layerId)) capturedMap.removeLayer(layerId);
            } catch { /* map may already be destroyed */ }
            cloud3dLayerId.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cloudPreview, mapLoaded]);

    /* ── Fetch communes ──────────────────────────────────────────────────── */
    useEffect(() => {
        fetch('/api/comunas')
            .then(r => r.json())
            .then((data: unknown) => {
                if (data !== null && typeof data === 'object' && (data as { type?: string }).type === 'FeatureCollection')
                    setComunasGeoJSON(data as FeatureCollection);
            }).catch(console.error);
    }, []);

    const fetchIntervenciones = useCallback(async (comunaId: string, nombre: string) => {
        try {
            const data = await fetch(`/api/intervenciones/${comunaId}`).then(r => r.json()) as Intervencion[];
            setIntervenciones(data);
            onComunaSelect?.(nombre, data);
        } catch (err) { console.error(err); }
    }, [onComunaSelect]);

    const hasLayer = useCallback((id: string) => !!(mapRef.current?.getMap().getStyle()?.layers ?? []).find(l => l.id === id), []);

    /* ── 3D buildings toggle ─────────────────────────────────────────────── */
    useEffect(() => {
        const map = mapRef.current?.getMap();
        if (!map || !mapLoaded) return;

        const layers3D = ['buildings-3d-base', 'buildings-3d-fallback', 'buildings-3d', 'buildings-3d-rim', 'roads-3d-glow', 'roads-3d-core'] as const;

        if (show3D) {
            try { map.setLayoutProperty('building', 'visibility', 'none'); } catch { /* layer optional */ }
            try { map.setTerrain({ source: 'terrain-dem', exaggeration: 2.5 }); } catch { /* terrain optional */ }

            if (!map.getLayer('buildings-3d')) {
                const firstSymbol = map.getStyle()?.layers.find(l => l.type === 'symbol')?.id;

                if (!map.getSource('custom-buildings')) {
                    map.addSource('custom-buildings', {
                        type: 'vector',
                        tiles: [`${window.location.origin}/api/vtiles/{z}/{x}/{y}`],
                        minzoom: 12, maxzoom: 16,
                    });
                }

                map.addLayer({
                    id: 'buildings-3d-base', type: 'fill',
                    source: 'custom-buildings', 'source-layer': 'building',
                    paint: { 'fill-color': '#06152a', 'fill-opacity': 0.95 } as LayerSpecification['paint'],
                } as LayerSpecification, firstSymbol);

                map.addLayer({
                    id: 'buildings-3d', type: 'fill-extrusion',
                    source: 'custom-buildings', 'source-layer': 'building',
                    paint: {
                        'fill-extrusion-color': [
                            'interpolate', ['linear'],
                            ['max', ['coalesce', ['get', 'render_height'], 0], 0],
                            0, '#071a2e', 3, '#0c2440', 8, '#0d2744',
                            15, '#113257', 25, '#163d6e', 50, '#1b5090',
                            100, '#2268b8', 200, '#2a82de',
                        ],
                        'fill-extrusion-height':  ['max', ['coalesce', ['get', 'render_height'],     0], 3],
                        'fill-extrusion-base':    ['max', ['coalesce', ['get', 'render_min_height'], 0], 0],
                        'fill-extrusion-opacity': 0.95,
                        'fill-extrusion-vertical-gradient': true,
                    } as LayerSpecification['paint'],
                } as LayerSpecification, firstSymbol);

                map.addLayer({
                    id: 'buildings-3d-fallback', type: 'fill-extrusion',
                    source: 'openmaptiles', 'source-layer': 'building',
                    paint: {
                        'fill-extrusion-color': '#071828',
                        'fill-extrusion-height':  ['max', ['coalesce', ['get', 'render_height'],     0], 3],
                        'fill-extrusion-base':    ['max', ['coalesce', ['get', 'render_min_height'], 0], 0],
                        'fill-extrusion-opacity': 0.6,
                        'fill-extrusion-vertical-gradient': true,
                    } as LayerSpecification['paint'],
                } as LayerSpecification, 'buildings-3d-base');

                map.addLayer({
                    id: 'buildings-3d-rim', type: 'fill-extrusion',
                    source: 'custom-buildings', 'source-layer': 'building',
                    paint: {
                        'fill-extrusion-color': '#00d4ff',
                        'fill-extrusion-height': ['max', ['coalesce', ['get', 'render_height'], 0], 3],
                        'fill-extrusion-base': [
                            'max',
                            ['-', ['max', ['coalesce', ['get', 'render_height'], 0], 3], 2],
                            ['max', ['coalesce', ['get', 'render_min_height'], 0], 0],
                        ],
                        'fill-extrusion-opacity': 0.22,
                    } as LayerSpecification['paint'],
                } as LayerSpecification, firstSymbol);

                map.addLayer({
                    id: 'roads-3d-glow', type: 'line',
                    source: 'openmaptiles', 'source-layer': 'transportation',
                    filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary']]],
                    paint: {
                        'line-color': '#00c8ff',
                        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 17, 7],
                        'line-opacity': 0.18, 'line-blur': 4,
                    } as LayerSpecification['paint'],
                } as LayerSpecification, firstSymbol);

                map.addLayer({
                    id: 'roads-3d-core', type: 'line',
                    source: 'openmaptiles', 'source-layer': 'transportation',
                    filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]],
                    paint: {
                        'line-color': '#50e8ff',
                        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 17, 2],
                        'line-opacity': 0.55,
                    } as LayerSpecification['paint'],
                } as LayerSpecification, firstSymbol);

            } else {
                layers3D.forEach(id => {
                    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
                });
            }

            const currentZoom  = map.getZoom();
            const currentPitch = map.getPitch();
            map.jumpTo({ zoom: Math.max(currentZoom, 15.8) });
            map.easeTo({ pitch: Math.max(currentPitch, 60), bearing: map.getBearing(), duration: 1200 });

        } else {
            try { map.setLayoutProperty('building', 'visibility', 'visible'); } catch { /* layer optional */ }
            try { map.setTerrain({ source: 'terrain-dem', exaggeration: 1.8 }); } catch { /* terrain optional */ }
            layers3D.forEach(id => {
                if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
            });
            map.easeTo({ pitch: Math.min(map.getPitch(), 55), duration: 900 });
        }
    }, [show3D, mapLoaded]);

    /* ── Map click ───────────────────────────────────────────────────────── */
    const handleMapClick = useCallback((e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
        const map = mapRef.current?.getMap();
        if (!map) return;

        const clusterHits = hasLayer('clusters')          ? map.queryRenderedFeatures(e.point, { layers: ['clusters'] })          : [];
        const pinHits     = hasLayer('unclustered-point') ? map.queryRenderedFeatures(e.point, { layers: ['unclustered-point'] }) : [];
        const comunaHits  = hasLayer('comunas-click')     ? map.queryRenderedFeatures(e.point, { layers: ['comunas-click'] })     : [];

        if (clusterHits.length) {
            const coords = (clusterHits[0].geometry as GeoJSON.Point).coordinates as [number, number];
            map.easeTo({ center: coords, zoom: map.getZoom() + 2.5, duration: 500 });
            return;
        }
        if (pinHits.length) { flyAndOpen(pinHits[0].properties as IntervencionProperties); return; }
        if (comunaHits.length) {
            const { id, nombre } = (comunaHits[0].properties ?? {}) as { id?: string; nombre?: string };
            if (id && nombre) fetchIntervenciones(id, nombre);
        }
    }, [flyAndOpen, fetchIntervenciones, hasLayer]);

    /* ── Mouse move / hover ──────────────────────────────────────────────── */
    const handleMouseMove = useCallback((e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
        const map = mapRef.current?.getMap();
        if (!map) return;
        const comunaHits = hasLayer('comunas-click') ? map.queryRenderedFeatures(e.point, { layers: ['comunas-click'] }) : [];
        const pinLayers  = (['clusters', 'unclustered-point'] as const).filter(hasLayer);
        const pinHits    = pinLayers.length ? map.queryRenderedFeatures(e.point, { layers: pinLayers }) : [];

        map.getCanvas().style.cursor = (comunaHits.length || pinHits.length) ? 'pointer' : '';

        if (comunaHits.length) {
            const newId = String(comunaHits[0].id ?? (comunaHits[0].properties as { id?: string })?.id);
            if (hoveredComunaId.current && hoveredComunaId.current !== newId)
                map.setFeatureState({ source: 'comunas', id: hoveredComunaId.current }, { hover: false });
            hoveredComunaId.current = newId;
            map.setFeatureState({ source: 'comunas', id: newId }, { hover: true });
        } else if (hoveredComunaId.current) {
            map.setFeatureState({ source: 'comunas', id: hoveredComunaId.current }, { hover: false });
            hoveredComunaId.current = null;
        }
    }, [hasLayer]);

    const handleMouseLeave = useCallback(() => {
        const map = mapRef.current?.getMap();
        if (!map) return;
        if (hoveredComunaId.current) {
            map.setFeatureState({ source: 'comunas', id: hoveredComunaId.current }, { hover: false });
            hoveredComunaId.current = null;
        }
        map.getCanvas().style.cursor = '';
    }, []);

    /* ── Map load ─────────────────────────────────────────────────────────── */
    const handleMapLoad = useCallback(() => {
        const map = mapRef.current?.getMap();
        if (!map) return;

        // Calling preventDefault() on webglcontextlost tells the browser we
        // want it to attempt context restoration once GPU memory is available
        // again (e.g., after the Potree iframe closes). Without this, Chrome
        // marks the context permanently lost and blocks all new contexts on
        // the page ("Web page caused context loss and was blocked").
        const canvas = map.getCanvas();
        canvas.addEventListener('webglcontextlost', (e: Event) => {
            e.preventDefault();
            console.warn('[MapLibre] WebGL context lost — waiting for restoration');
        }, false);
        canvas.addEventListener('webglcontextrestored', () => {
            console.info('[MapLibre] WebGL context restored');
            map.triggerRepaint();
        }, false);

        map.on('error', (e: { error?: { message?: string } }) => {
            const msg = e?.error?.message ?? '';
            if (msg.includes('openfreemap.org') || msg.includes('404')) return;
            console.error('[MapLibre]', msg || e);
        });

        try {
            map.addSource('terrain-dem', {
                type: 'raster-dem',
                tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
                encoding: 'terrarium',
                tileSize: 256,
                maxzoom: 14,
            });
            map.setTerrain({ source: 'terrain-dem', exaggeration: 1.8 });
        } catch (err) { console.warn('[MapViewer] Terrain unavailable:', err); }

        setMapLoaded(true);
    }, []);

    /* ── Render ───────────────────────────────────────────────────────────── */
    return (
        <Map
            ref={mapRef}
            initialViewState={{ longitude: -75.5812, latitude: 6.2442, zoom: 13, pitch: 60, bearing: -15 }}
            style={{ width: '100%', height: '100%' }}
            mapStyle="https://tiles.openfreemap.org/styles/dark"
            onLoad={handleMapLoad}
            onClick={handleMapClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            interactiveLayerIds={['comunas-click', 'comunas-fill-flat', 'comunas-fill-3d', 'clusters', 'unclustered-point']}
            maxBounds={[[-75.82, 6.10], [-75.41, 6.42]]}
        >
            {/* Satellite imagery — declared first so it renders BELOW all vector layers */}
            <Source
                id="satellite"
                type="raster"
                tiles={['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}']}
                tileSize={256}
                attribution="© Esri, Maxar, Earthstar Geographics"
            >
                <Layer
                    id="satellite-layer"
                    type="raster"
                    layout={{ visibility: showSatellite ? 'visible' : 'none' }}
                    paint={{ 'raster-opacity': 0.92 }}
                />
            </Source>

            {comunasGeoJSON && (
                <Source id="comunas" type="geojson" data={comunasGeoJSON} promoteId="id">

                    {!show3D && (
                        <Layer
                            id="comunas-fill-flat"
                            type="fill"
                            source="comunas"
                            paint={{ 'fill-color': COMMUNE_COLOR as string, 'fill-opacity': 0.38 }}
                        />
                    )}

                    {show3D && (
                        <Layer
                            id="comunas-fill-3d"
                            type="fill"
                            source="comunas"
                            paint={{ 'fill-color': COMMUNE_COLOR as string, 'fill-opacity': 0.12 }}
                        />
                    )}

                    <Layer id="comunas-click" type="fill" source="comunas" paint={{ 'fill-opacity': 0 }} />
                    <Layer {...comunaHoverLayer} />

                    {!show3D && (
                        <Layer
                            id="comunas-line-2d"
                            type="line"
                            source="comunas"
                            paint={{ 'line-color': '#ffffff', 'line-width': 0.8, 'line-opacity': 0.4 }}
                        />
                    )}

                    {show3D && (
                        <>
                            <Layer
                                id="comunas-glow-outer"
                                type="line"
                                source="comunas"
                                paint={{ 'line-color': COMMUNE_COLOR as string, 'line-width': 20, 'line-opacity': 0.12, 'line-blur': 14 }}
                            />
                            <Layer
                                id="comunas-glow-mid"
                                type="line"
                                source="comunas"
                                paint={{ 'line-color': COMMUNE_COLOR as string, 'line-width': 5, 'line-opacity': 0.70, 'line-blur': 2 }}
                            />
                            <Layer
                                id="comunas-glow-core"
                                type="line"
                                source="comunas"
                                paint={{ 'line-color': '#ffffff', 'line-width': 1.4, 'line-opacity': 0.95 }}
                            />
                        </>
                    )}

                    <Layer {...comunaLabelLayer} />
                </Source>
            )}

            {mapLoaded && (
                <Source
                    id="intervenciones-source"
                    type="geojson"
                    data={intervencionesGeoJSON}
                    cluster={true}
                    clusterMaxZoom={14}
                    clusterRadius={50}
                >
                    <Layer {...clusterCircleLayer} />
                    <Layer {...clusterCountLayer} />
                    <Layer {...unclusteredPointLayer} />
                    <Layer {...unclusteredLabelLayer} />
                </Source>
            )}

            {/* The 3D point cloud is rendered by the custom WebGL layer added
                imperatively in the useEffect above — no JSX needed here. */}
        </Map>
    );
}
