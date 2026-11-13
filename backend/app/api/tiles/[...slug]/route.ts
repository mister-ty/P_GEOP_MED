import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side proxy for MapTiler vector tiles.
 * Client requests to /api/tiles/{z}/{x}/{y}.pbf are forwarded to MapTiler
 * without exposing the API key or triggering referrer restrictions.
 */
export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ slug: string[] }> },
) {
    const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
    if (!key) {
        return new NextResponse('Tile key not configured', { status: 500 });
    }

    const { slug } = await params;
    const path = slug.join('/');
    const upstream = `https://api.maptiler.com/tiles/v3/${path}?key=${key}`;

    try {
        const res = await fetch(upstream, {
            headers: { 'User-Agent': 'GeoPortal-Medellin/1.0' },
            next: { revalidate: 86400 },
        });

        if (!res.ok) {
            return new NextResponse(`Upstream ${res.status}`, { status: res.status });
        }

        const body = await res.arrayBuffer();

        const headers: Record<string, string> = {
            'Content-Type': res.headers.get('Content-Type') ?? 'application/x-protobuf',
            'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
            'Access-Control-Allow-Origin': '*',
        };
        const enc = res.headers.get('Content-Encoding');
        if (enc) headers['Content-Encoding'] = enc;

        return new NextResponse(body, { status: 200, headers });
    } catch (err) {
        console.error('[TileProxy]', err);
        return new NextResponse('Tile proxy error', { status: 502 });
    }
}
