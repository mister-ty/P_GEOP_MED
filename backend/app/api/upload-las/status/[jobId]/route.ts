import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export const dynamic = 'force-dynamic';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads_tmp');

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params;

    if (!jobId || !/^[a-z0-9_-]+$/i.test(jobId)) {
      return NextResponse.json({ ok: false, error: 'jobId inválido' }, { status: 400 });
    }

    const jobFile = path.join(UPLOADS_DIR, `${jobId}.job.json`);

    let raw: string;
    try {
      raw = await fs.readFile(jobFile, 'utf-8');
    } catch {
      // File doesn't exist yet — job is queued or ID is wrong
      return NextResponse.json(
        { ok: false, status: 'not_found', jobId, error: 'Job no encontrado' },
        { status: 404 },
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      console.error(`[upload-las/status] Job file corrupted: ${jobFile}`);
      return NextResponse.json(
        { ok: false, status: 'error', jobId, error: 'Archivo de estado corrupto' },
        { status: 500 },
      );
    }

    return NextResponse.json(data);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[upload-las/status] Unexpected error:', msg);
    return NextResponse.json(
      { ok: false, status: 'error', error: 'Error interno', details: msg },
      { status: 500 },
    );
  }
}
