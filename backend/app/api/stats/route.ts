import { NextResponse } from 'next/server';
import { prisma } from '@/prisma/client';

export async function GET() {
    try {
        const [totalsRaw, byComunaRaw, recentRaw] = await Promise.all([
            prisma.$queryRaw<[{
                total: bigint; with_lidar: bigint; with_dxf: bigint; with_ortofoto: bigint;
            }]>`
                SELECT
                    COUNT(*)                    AS total,
                    COUNT("pointCloudUrl")      AS with_lidar,
                    COUNT("autocadDwgUrl")      AS with_dxf,
                    COUNT("ortofotoUrl")        AS with_ortofoto
                FROM "Intervencion"
            `,
            prisma.$queryRaw<{ nombre: string; codigo: string; count: bigint }[]>`
                SELECT c.nombre, c.codigo, COUNT(i.id) AS count
                FROM "Comuna" c
                LEFT JOIN "Intervencion" i ON i."comunaId" = c.id
                GROUP BY c.id, c.nombre, c.codigo
                ORDER BY count DESC
            `,
            prisma.$queryRaw<{ id: string; direccion: string; nombre: string; createdAt: Date }[]>`
                SELECT i.id, i.direccion, c.nombre, i."createdAt"
                FROM "Intervencion" i
                JOIN "Comuna" c ON c.id = i."comunaId"
                ORDER BY i."createdAt" DESC
                LIMIT 10
            `,
        ]);

        const t = totalsRaw[0];
        return NextResponse.json({
            total:        Number(t?.total        ?? 0),
            withLidar:    Number(t?.with_lidar   ?? 0),
            withDxf:      Number(t?.with_dxf     ?? 0),
            withOrtofoto: Number(t?.with_ortofoto ?? 0),
            byComuna: byComunaRaw.map(r => ({
                nombre: r.nombre,
                codigo: r.codigo,
                count:  Number(r.count),
            })),
            recent: recentRaw.map(r => ({
                id:         r.id,
                direccion:  r.direccion,
                nombre:     r.nombre,
                createdAt:  (r.createdAt as Date)?.toISOString?.() ?? null,
            })),
        });
    } catch (err) {
        console.error('[stats]', err);
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}
