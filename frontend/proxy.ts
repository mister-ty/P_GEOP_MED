import { NextRequest, NextResponse } from 'next/server';

const PROXIED = ['/api/', '/nubes_procesadas/', '/nube_procesada/', '/ortofotos/', '/planos/'];

// Routes handled by dedicated Node.js runtime route handlers in app/api/upload-las/.
// They must NOT be rewritten here — Next.js must reach the local file handler.
const BYPASS = ['/api/upload-las'];

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (BYPASS.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  if (!PROXIED.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const backend = process.env.BACKEND_URL ?? 'http://localhost:3001';
  const target = new URL(pathname + request.nextUrl.search, backend);

  return NextResponse.rewrite(target);
}

export const config = {
  matcher: [
    // /api/upload-las se excluye DESDE el matcher (no basta el bypass de arriba):
    // si la ruta matchea, Next bufferea todo el body en RAM para hacerlo clonable,
    // lo que revienta con archivos > 4 GiB (límite de Buffer) y agota la memoria.
    '/api/((?!upload-las).*)',
    '/nubes_procesadas/:path*',
    '/nube_procesada/:path*',
    '/ortofotos/:path*',
    '/planos/:path*',
  ],
};
