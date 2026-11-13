import { NextResponse } from 'next/server';
import { prisma } from '@/prisma/client';

export async function GET() {
    try {
        const comunas = await prisma.$queryRaw<
            { id: string; nombre: string; codigo: string; geojson: string }[]
        >`
      SELECT
        id,
        nombre,
        codigo,
        ST_AsGeoJSON(geometria)::text as geojson
      FROM "Comuna"
    `;

        const featureCollection = {
            type: 'FeatureCollection' as const,
            features: comunas.map((comuna: { id: string; nombre: string; codigo: string; geojson: string }) => ({
                type: 'Feature' as const,
                properties: {
                    id: comuna.id,
                    nombre: comuna.nombre,
                    codigo: comuna.codigo,
                },
                geometry: JSON.parse(comuna.geojson),
            })),
        };

        return NextResponse.json(featureCollection);
    } catch (error) {
        console.error('Error fetching comunas:', error);
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json(
            { error: 'Error al obtener las comunas', details: message },
            { status: 500 }
        );
    }
}
