import { NextRequest, NextResponse } from 'next/server';

interface NominatimResult {
    lat: string;
    lon: string;
    display_name: string;
}

export async function GET(req: NextRequest) {
    const q = req.nextUrl.searchParams.get('q');
    if (!q?.trim()) return NextResponse.json([], { status: 400 });

    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', `${q}, Medellín, Colombia`);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '5');
    url.searchParams.set('countrycodes', 'co');
    url.searchParams.set('bounded', '1');
    url.searchParams.set('viewbox', '-75.82,6.42,-75.41,6.10');

    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'GeoPortalMedellin/1.0' },
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return NextResponse.json([], { status: 502 });

        const data = await res.json() as NominatimResult[];
        return NextResponse.json(
            data.map(r => ({
                lat:  parseFloat(r.lat),
                lng:  parseFloat(r.lon),
                name: r.display_name,
            })),
            { headers: { 'Cache-Control': 'public, max-age=300' } },
        );
    } catch {
        return NextResponse.json([], { status: 504 });
    }
}
