import { NextResponse } from 'next/server';
import { prisma } from '@/prisma/client';

/**
 * POST /api/admin/sync-buildings
 *
 * Fetches ALL building footprints for Medellín from the Overpass API
 * (complete OSM dataset — includes small buildings that vector tile
 * generators filter out at zoom 14) and stores them in PostGIS.
 *
 * Creates the `ms_buildings` table on first run.
 * Safe to re-run — uses ON CONFLICT DO NOTHING to skip duplicates.
 */

const BBOX = { south: 6.10, west: -75.82, north: 6.42, east: -75.41 };

// Overpass QL — get all buildings with their geometry and key tags
const overpassQuery = `
[out:json][timeout:120];
(
  way["building"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
);
out body geom;
`;

function estimateHeight(tags: Record<string, string>): number {
    if (tags.height)        return parseFloat(tags.height) || 3;
    if (tags['building:levels']) return parseFloat(tags['building:levels']) * 3.2 || 3;
    switch (tags.building) {
        case 'house':
        case 'residential': return 6;
        case 'apartments':  return 12;
        case 'commercial':  return 8;
        case 'industrial':  return 7;
        case 'school':      return 9;
        case 'church':      return 10;
        default:            return 3;
    }
}

export async function POST() {
    try {
        // Ensure table exists
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS ms_buildings (
                id        BIGINT PRIMARY KEY,
                geom      geometry(Polygon, 4326) NOT NULL,
                height    REAL NOT NULL DEFAULT 3,
                b_type    VARCHAR(60)
            );
            CREATE INDEX IF NOT EXISTS idx_ms_buildings_geom
                ON ms_buildings USING GIST (geom);
        `);

        // Fetch from Overpass
        const res = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `data=${encodeURIComponent(overpassQuery)}`,
            signal: AbortSignal.timeout(130_000),
        });

        if (!res.ok) throw new Error(`Overpass error ${res.status}`);

        interface OverpassNode { lat: number; lon: number }
        interface OverpassElement {
            id: number;
            geometry?: OverpassNode[];
            tags?: Record<string, string>;
        }
        interface OverpassResponse { elements: OverpassElement[] }

        const data = await res.json() as OverpassResponse;
        const ways = data.elements.filter(
            e => e.geometry && e.geometry.length >= 4
        );

        let inserted = 0;
        const BATCH = 500;

        for (let i = 0; i < ways.length; i += BATCH) {
            const batch = ways.slice(i, i + BATCH);

            // Build VALUES for bulk insert
            const values = batch
                .map(way => {
                    const pts = way.geometry!
                        .map(p => `${p.lon} ${p.lat}`)
                        .join(',');
                    const h = estimateHeight(way.tags ?? {});
                    const type = (way.tags?.building ?? '').replace(/'/g, "''");
                    return `(${way.id}, ST_GeomFromText('POLYGON((${pts}))',4326), ${h}, '${type}')`;
                })
                .join(',\n');

            await prisma.$executeRawUnsafe(`
                INSERT INTO ms_buildings (id, geom, height, b_type)
                VALUES ${values}
                ON CONFLICT (id) DO UPDATE
                  SET geom = EXCLUDED.geom,
                      height = EXCLUDED.height,
                      b_type = EXCLUDED.b_type;
            `);

            inserted += batch.length;
        }

        return NextResponse.json({ ok: true, total: ways.length, inserted });
    } catch (err) {
        console.error('[sync-buildings]', err);
        return NextResponse.json(
            { ok: false, error: String(err) },
            { status: 500 }
        );
    }
}

export async function GET() {
    try {
        const row = await prisma.$queryRaw<[{ count: bigint }]>`
            SELECT COUNT(*) as count FROM ms_buildings
        `;
        return NextResponse.json({ count: Number(row[0].count) });
    } catch {
        return NextResponse.json({ count: 0 });
    }
}
