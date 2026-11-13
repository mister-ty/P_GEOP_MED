import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:3001';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;

  // Basic sanitization before forwarding
  if (!jobId || !/^[a-z0-9_-]+$/i.test(jobId)) {
    return NextResponse.json({ ok: false, error: 'jobId inválido' }, { status: 400 });
  }

  try {
    const res = await fetch(`${BACKEND}/api/upload-las/status/${jobId}`, {
      // Abort if backend takes more than 15 s to respond
      signal: AbortSignal.timeout(15_000),
    });

    // Backend should always return JSON, but guard against HTML error pages
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      console.error(`[status-proxy] Backend returned non-JSON (${res.status}) for job ${jobId}`);
      return NextResponse.json(
        { ok: false, error: 'Backend no devolvió JSON', status: res.status },
        { status: 502 },
      );
    }

    const data: unknown = await res.json();
    return NextResponse.json(data, { status: res.status });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error de proxy';
    console.error(`[status-proxy] Error consultando job ${jobId}:`, msg);
    return NextResponse.json(
      { ok: false, error: 'No se pudo contactar el backend', details: msg },
      { status: 503 },
    );
  }
}
