'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import DxfParser from 'dxf-parser';

// ── Types ────────────────────────────────────────────────────────────────────
interface DxfEntity {
    type: string;
    vertices?: { x: number; y: number; z?: number }[];
    startPoint?: { x: number; y: number; z?: number };
    endPoint?: { x: number; y: number; z?: number };
    center?: { x: number; y: number; z?: number };
    radius?: number;
}
interface DxfData { entities?: DxfEntity[]; }
interface DxfViewerProps { fileUrl: string; }

// ── Helpers ──────────────────────────────────────────────────────────────────
const LINE_MAT = new THREE.LineBasicMaterial({ color: 0x60a5fa });

function buildLines(entities: DxfEntity[]): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];

    for (const ent of entities) {
        if (ent.type === 'LINE' && ent.vertices && ent.vertices.length >= 2) {
            const geo = new THREE.BufferGeometry().setFromPoints(
                ent.vertices.map(v => new THREE.Vector3(v.x, v.y, v.z ?? 0))
            );
            out.push(new THREE.Line(geo, LINE_MAT));
        } else if ((ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') && ent.vertices && ent.vertices.length > 1) {
            const geo = new THREE.BufferGeometry().setFromPoints(
                ent.vertices.map(v => new THREE.Vector3(v.x, v.y, v.z ?? 0))
            );
            out.push(new THREE.Line(geo, LINE_MAT));
        } else if (ent.type === 'CIRCLE' && ent.center && ent.radius !== undefined) {
            const pts: THREE.Vector3[] = [];
            for (let i = 0; i <= 72; i++) {
                const a = (i / 72) * Math.PI * 2;
                pts.push(new THREE.Vector3(
                    ent.center.x + ent.radius * Math.cos(a),
                    ent.center.y + ent.radius * Math.sin(a), 0
                ));
            }
            out.push(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), LINE_MAT));
        }
    }
    return out;
}

/** Compute 2D bounding box from raw DXF entities. */
function getBounds(entities: DxfEntity[]) {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const e of entities) {
        for (const v of e.vertices ?? []) {
            minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
            minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
        }
        if (e.startPoint) {
            minX = Math.min(minX, e.startPoint.x); maxX = Math.max(maxX, e.startPoint.x);
            minY = Math.min(minY, e.startPoint.y); maxY = Math.max(maxY, e.startPoint.y);
        }
        if (e.endPoint) {
            minX = Math.min(minX, e.endPoint.x); maxX = Math.max(maxX, e.endPoint.x);
            minY = Math.min(minY, e.endPoint.y); maxY = Math.max(maxY, e.endPoint.y);
        }
        if (e.center && e.radius !== undefined) {
            minX = Math.min(minX, e.center.x - e.radius); maxX = Math.max(maxX, e.center.x + e.radius);
            minY = Math.min(minY, e.center.y - e.radius); maxY = Math.max(maxY, e.center.y + e.radius);
        }
    }

    if (!isFinite(minX)) { minX = -50; maxX = 50; minY = -50; maxY = 50; }
    return { minX, maxX, minY, maxY };
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function DxfViewer({ fileUrl }: DxfViewerProps) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
    const [errorMsg, setErrorMsg] = useState('');

    useEffect(() => {
        if (!wrapRef.current) return;

        const wrap = wrapRef.current;
        let renderer: THREE.WebGLRenderer | null = null;
        let controls: OrbitControls | null = null;
        let rafId = 0;
        let ro: ResizeObserver | null = null;
        let started = false;

        const start = (w: number, h: number) => {
            if (started || w === 0 || h === 0) return;
            started = true;

            (async () => {
                try {
                    setStatus('loading');

                    // ── 1. Fetch + parse ──────────────────────────────────
                    const resp = await fetch(fileUrl);
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const text = await resp.text();
                    const parser = new DxfParser();
                    const dxf = parser.parseSync(text) as DxfData;
                    const entities = dxf.entities ?? [];

                    // ── 2. Scene ─────────────────────────────────────────
                    const scene = new THREE.Scene();
                    scene.background = new THREE.Color(0x0f172a);
                    buildLines(entities).forEach(o => scene.add(o));

                    // ── 3. Camera from bounds ────────────────────────────
                    const { minX, maxX, minY, maxY } = getBounds(entities);
                    const cx = (minX + maxX) / 2;
                    const cy = (minY + maxY) / 2;
                    const PAD = 1.15;
                    const dX = ((maxX - minX) / 2) * PAD;
                    const dY = ((maxY - minY) / 2) * PAD;
                    const aspect = w / h;
                    const hW = Math.max(dX, dY * aspect);
                    const hH = hW / aspect;

                    const cam = new THREE.OrthographicCamera(
                        cx - hW, cx + hW, cy + hH, cy - hH, -1e5, 1e5
                    );
                    // For 2D top-down view: identity quaternion + position directly above the scene
                    cam.position.set(cx, cy, 100);
                    cam.quaternion.set(0, 0, 0, 1); // identity — no rotation, looking straight down -Z
                    cam.updateProjectionMatrix();

                    // ── 4. Renderer ──────────────────────────────────────
                    renderer = new THREE.WebGLRenderer({ antialias: true });
                    renderer.setPixelRatio(window.devicePixelRatio);
                    renderer.setSize(w, h);
                    wrap.appendChild(renderer.domElement);

                    // ── 5. Controls ──────────────────────────────────────
                    controls = new OrbitControls(cam, renderer.domElement);
                    controls.enableRotate = false;
                    controls.screenSpacePanning = true;
                    controls.enableDamping = true;
                    controls.dampingFactor = 0.08;
                    controls.mouseButtons = {
                        LEFT: THREE.MOUSE.PAN,
                        MIDDLE: THREE.MOUSE.DOLLY,
                        RIGHT: THREE.MOUSE.PAN,
                    };
                    controls.touches = {
                        ONE: THREE.TOUCH.PAN,
                        TWO: THREE.TOUCH.DOLLY_PAN,
                    };

                    // ── 6. ResizeObserver → camera + renderer update ─────
                    ro = new ResizeObserver(([entry]) => {
                        if (!renderer) return;
                        const nW = entry.contentRect.width;
                        const nH = entry.contentRect.height;
                        if (nW === 0 || nH === 0) return;
                        const nA = nW / nH;
                        const nHW = Math.max(dX, dY * nA);
                        const nHH = nHW / nA;
                        cam.left = cx - nHW; cam.right = cx + nHW;
                        cam.top = cy + nHH; cam.bottom = cy - nHH;
                        cam.updateProjectionMatrix();
                        renderer.setSize(nW, nH);
                    });
                    ro.observe(wrap);

                    // ── 7. Render loop ───────────────────────────────────
                    const loop = () => {
                        rafId = requestAnimationFrame(loop);
                        controls?.update();
                        renderer?.render(scene, cam);
                    };
                    loop();

                    setStatus('ready');
                } catch (err: unknown) {
                    setErrorMsg(err instanceof Error ? err.message : 'Error desconocido');
                    setStatus('error');
                }
            })();
        };

        // Trigger once we know real dimensions (use ResizeObserver)
        const initObs = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            if (width > 0 && height > 0) {
                start(width, height);
            }
        });
        initObs.observe(wrap);

        return () => {
            initObs.disconnect();
            ro?.disconnect();
            cancelAnimationFrame(rafId);
            controls?.dispose();
            renderer?.dispose();
            renderer?.domElement.remove();
        };
    }, [fileUrl]);

    return (
        <div className="relative w-full h-full bg-slate-900">
            <div ref={wrapRef} className="w-full h-full" />

            {status === 'loading' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
                    <div className="animate-spin h-10 w-10 rounded-full border-2 border-blue-400 border-t-transparent" />
                    <p className="text-slate-400 text-sm">Procesando plano DXF…</p>
                </div>
            )}

            {status === 'error' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6">
                    <span className="text-4xl">⚠️</span>
                    <p className="text-red-400 font-medium">No se pudo cargar el plano</p>
                    <p className="text-slate-500 text-xs text-center max-w-sm">{errorMsg}</p>
                    <p className="text-slate-600 text-xs mt-1 text-center">
                        La URL debe apuntar a un archivo <code>.dxf</code> sin restricciones CORS.
                    </p>
                </div>
            )}

            {status === 'ready' && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-slate-400 text-xs px-3 py-1.5 rounded-full pointer-events-none select-none">
                    🖱️ Arrastrar para mover · Rueda para zoom
                </div>
            )}
        </div>
    );
}
