/**
 * Node.js-runtime streaming proxy for LAS/LAZ + ortofoto + plano uploads.
 *
 * Why this exists:
 *   Next.js middleware runs in the Edge Runtime, which has an effective ~4 MB
 *   body cap for proxied requests.  Large multipart uploads (LAS + TIF) were
 *   aborted by the Edge layer before the backend could finish reading the body.
 *
 * Why http.request instead of fetch:
 *   undici (Node's fetch) hits a hard 4 GiB cap when streaming request bodies
 *   (RangeError ERR_OUT_OF_RANGE at 2^32 bytes) and buffers the incoming body
 *   in memory without backpressure.  Node's http.request + pipe streams bodies
 *   of any size chunk-by-chunk with real backpressure, so memory stays flat.
 */
import { NextRequest, NextResponse } from 'next/server';
import http from 'node:http';
import { Readable } from 'node:stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:3001';

export async function POST(req: NextRequest) {
  try {
    if (!req.body) {
      return NextResponse.json({ error: 'Cuerpo de petición vacío' }, { status: 400 });
    }

    const target = new URL('/api/upload-las', BACKEND);

    // Forward Content-Length from the browser so the backend receives a
    // properly-sized multipart body. Without it the request goes out as
    // Transfer-Encoding:chunked, which busboy also accepts, but keeping the
    // length lets the backend reject truncated uploads.
    const headers: Record<string, string> = {
      'content-type': req.headers.get('content-type') ?? '',
    };
    const cl = req.headers.get('content-length');
    if (cl) headers['content-length'] = cl;

    const body = Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0]);

    const backendRes = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const proxyReq = http.request(
        {
          hostname: target.hostname,
          port: target.port || 80,
          path: target.pathname,
          method: 'POST',
          headers,
          timeout: 600_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve({
            status: res.statusCode ?? 502,
            text: Buffer.concat(chunks).toString('utf8'),
          }));
          res.on('error', reject);
        },
      );
      proxyReq.on('timeout', () => proxyReq.destroy(new Error('Timeout esperando al backend')));
      proxyReq.on('error', reject);
      body.on('error', reject);
      body.pipe(proxyReq);
    });

    let data: unknown;
    try {
      data = JSON.parse(backendRes.text);
    } catch {
      data = { error: backendRes.text || 'Respuesta no válida del backend' };
    }
    return NextResponse.json(data, { status: backendRes.status });
  } catch (err: unknown) {
    console.error('[upload-las proxy] error:', err);
    let msg = err instanceof Error ? err.message : 'Error de proxy';
    if (err instanceof Error && err.cause) {
      const cause = err.cause as { code?: string; message?: string };
      const detail = [cause.code, cause.message].filter(Boolean).join(' — ');
      if (detail) msg += ` (causa: ${detail})`;
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
