import type { NextConfig } from "next";
import path from "path";

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Allow up to 10 GB so large LAS/TIF uploads reach the route handler intact.
    proxyClientMaxBodySize: '10gb',
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
  async headers() {
    return [
      {
        source: "/potree_custom/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
  async rewrites() {
    // afterFiles: local route handlers (e.g. /api/upload-las) take precedence.
    // Everything else — static files and backend API routes — is proxied.
    return {
      beforeFiles: [],
      afterFiles: [
        // Potree libs bundled alongside each converted point cloud
        { source: '/nube_procesada/:path*',   destination: `${BACKEND}/nube_procesada/:path*`   },
        // Converted point cloud octrees
        { source: '/nubes_procesadas/:path*', destination: `${BACKEND}/nubes_procesadas/:path*` },
        // Uploaded raster imagery
        { source: '/ortofotos/:path*',        destination: `${BACKEND}/ortofotos/:path*`         },
        // Uploaded CAD/DXF files
        { source: '/planos/:path*',           destination: `${BACKEND}/planos/:path*`             },
        // /api/:path* is intentionally absent — the middleware (middleware.ts) handles
        // all API proxying so this rewrite would intercept dynamic route handlers.
      ],
      fallback: [],
    };
  },
};

export default nextConfig;
