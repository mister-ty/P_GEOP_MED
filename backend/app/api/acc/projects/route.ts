import { NextRequest, NextResponse } from 'next/server';
import { listProjects, isAccConfigured } from '@/app/lib/autodesk-acc';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isAccConfigured()) {
    return NextResponse.json({ error: 'ACC no configurado.' }, { status: 503 });
  }
  const hubId = req.nextUrl.searchParams.get('hubId');
  if (!hubId) return NextResponse.json({ error: 'Parámetro hubId requerido.' }, { status: 400 });

  try {
    const projects = await listProjects(hubId);
    return NextResponse.json(projects);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error';
    console.error('[acc/projects]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
