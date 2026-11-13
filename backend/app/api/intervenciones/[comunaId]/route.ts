import { NextResponse } from 'next/server';
import { prisma } from '@/prisma/client';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ comunaId: string }> }
) {
    try {
        const { comunaId } = await params;

        // UUID validation (basic format check)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(comunaId)) {
            return NextResponse.json(
                { error: 'ID de comuna inválido' },
                { status: 400 }
            );
        }

        const intervenciones = await prisma.$queryRaw<
            {
                id: string;
                comunaId: string;
                direccion: string;
                autocadDwgUrl: string | null;
                pointCloudUrl: string | null;
                ortofotoUrl: string | null;
                lat: number;
                lng: number;
                createdAt: Date;
            }[]
        >`
      SELECT
        id,
        "comunaId",
        direccion,
        "autocadDwgUrl",
        "pointCloudUrl",
        "ortofotoUrl",
        ST_Y(coordenadas) as lat,
        ST_X(coordenadas) as lng,
        "createdAt"
      FROM "Intervencion"
      WHERE "comunaId" = ${comunaId}::uuid
    `;

        return NextResponse.json(intervenciones);
    } catch (error) {
        console.error('Error fetching intervenciones:', error);
        return NextResponse.json(
            { error: 'Error al obtener las intervenciones' },
            { status: 500 }
        );
    }
}
