import { NextResponse } from 'next/server';
import { listHubs, isAccConfigured } from '@/app/lib/autodesk-acc';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isAccConfigured()) {
    return NextResponse.json(
      { error: 'ACC no configurado. Agrega APS_CLIENT_ID y APS_CLIENT_SECRET en .env' },
      { status: 503 }
    );
  }
  try {
    const hubs = await listHubs();
    return NextResponse.json(hubs);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    console.error('[acc/hubs]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
