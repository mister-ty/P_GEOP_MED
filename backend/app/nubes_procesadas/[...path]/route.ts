import { NextRequest } from 'next/server';
import { servePublicFile } from '@/app/lib/serve-public-file';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return servePublicFile('nubes_procesadas', path, _req);
}
