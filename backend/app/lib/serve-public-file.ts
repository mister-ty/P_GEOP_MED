import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';

const MIME: Record<string, string> = {
  '.json':  'application/json',
  '.bin':   'application/octet-stream',
  '.txt':   'text/plain; charset=utf-8',
  '.las':   'application/octet-stream',
  '.laz':   'application/octet-stream',
  '.tif':   'image/tiff',
  '.tiff':  'image/tiff',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.pdf':   'application/pdf',
  '.dxf':   'application/octet-stream',
  '.dwg':   'application/octet-stream',
};

function makeStream(fullPath: string, start?: number, end?: number): ReadableStream<Uint8Array> {
  const nodeStream = fs.createReadStream(fullPath, start !== undefined ? { start, end } : undefined);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on('data',  (chunk) => controller.enqueue(chunk as Uint8Array));
      nodeStream.on('end',   () => controller.close());
      nodeStream.on('error', (err) => controller.error(err));
    },
    cancel() { nodeStream.destroy(); },
  });
}

export function servePublicFile(dirName: string, pathParts: string[], req?: NextRequest) {
  const baseDir = path.join(process.cwd(), 'public', dirName);
  const fullPath = path.resolve(baseDir, pathParts.join('/'));

  // Guard against path traversal
  if (!fullPath.startsWith(baseDir + path.sep)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    return new NextResponse('Not Found', { status: 404 });
  }
  if (!stat.isFile()) return new NextResponse('Not Found', { status: 404 });

  const ext         = path.extname(fullPath).toLowerCase();
  const contentType = MIME[ext] ?? 'application/octet-stream';
  const totalSize   = stat.size;

  const rangeHeader = req?.headers.get('range');
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (match) {
      const start = match[1] !== '' ? parseInt(match[1], 10) : 0;
      const end   = match[2] !== '' ? parseInt(match[2], 10) : totalSize - 1;
      const chunkSize = end - start + 1;

      if (start < 0 || end >= totalSize || start > end) {
        return new NextResponse('Range Not Satisfiable', {
          status: 416,
          headers: { 'Content-Range': `bytes */${totalSize}` },
        });
      }

      return new NextResponse(makeStream(fullPath, start, end), {
        status: 206,
        headers: {
          'Content-Type':                contentType,
          'Content-Length':              String(chunkSize),
          'Content-Range':               `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges':               'bytes',
          'Cache-Control':               'no-store',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  }

  return new NextResponse(makeStream(fullPath), {
    headers: {
      'Content-Type':                contentType,
      'Content-Length':              String(totalSize),
      'Accept-Ranges':               'bytes',
      'Cache-Control':               'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
