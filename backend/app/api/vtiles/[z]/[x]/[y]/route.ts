import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/prisma/client';

/**
 * GET /api/vtiles/{z}/{x}/{y}
 *
 * Serves Mapbox Vector Tiles (MVT / .pbf) of our custom building
 * dataset imported from Overpass into the `ms_buildings` PostGIS table.
 *
 * MapLibre source definition:
 *   type: 'vector'
 *   tiles: ['/api/vtiles/{z}/{x}/{y}']
 *   minzoom: 12, maxzoom: 16
 * Source-layer name in expressions: 'building'
 */
export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ z: string; x: string; y: string }> },
) {
    const { z, x, y } = await params;
    const zi = parseInt(z), xi = parseInt(x), yi = parseInt(y);

    if ([zi, xi, yi].some(n => !Number.isFinite(n))) {
        return new NextResponse('Invalid tile coords', { status: 400 });
    }

    try {
        // ST_TileEnvelope requires PostGIS ≥ 3.0 (included with postgis:15-3.4)
        const rows = await prisma.$queryRawUnsafe<[{ tile: Buffer }]>(`
            SELECT ST_AsMVT(q, 'building', 4096, 'geom') AS tile
            FROM (
                SELECT
                    ST_AsMVTGeom(
                        geom,
                        ST_TileEnvelope(${zi}, ${xi}, ${yi}),
                        4096, 64, true
                    ) AS geom,
                    height        AS render_height,
                    0             AS render_min_height,
                    b_type        AS type
                FROM ms_buildings
                WHERE geom && ST_TileEnvelope(${zi}, ${xi}, ${yi}, margin => 0.125)
                  AND ST_AsMVTGeom(geom, ST_TileEnvelope(${zi}, ${xi}, ${yi}), 4096, 64, true) IS NOT NULL
            ) q
        `);

        const tile = rows[0]?.tile;
        if (!tile || tile.length === 0) {
            return new NextResponse(null, { status: 204 });
        }

        return new NextResponse(tile.buffer as ArrayBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/x-protobuf',
                'Cache-Control': 'public, max-age=3600',
                'Access-Control-Allow-Origin': '*',
            },
        });
    } catch (err) {
        // Table not yet created → return empty tile (no buildings imported yet)
        const msg = String(err);
        if (msg.includes('ms_buildings') && msg.includes('does not exist')) {
            return new NextResponse(null, { status: 204 });
        }
        console.error('[vtiles]', err);
        return new NextResponse('Tile error', { status: 500 });
    }
}
