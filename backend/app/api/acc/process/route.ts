import { NextRequest, NextResponse } from 'next/server';
import { getDownloadUrl, isAccConfigured } from '@/app/lib/autodesk-acc';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import * as path from 'node:path';
import { prisma } from '@/prisma/client';
import { stripLasExtraBytes, detectExtraBytes } from '@/app/api/upload-las/las-patcher';

export const dynamic     = 'force-dynamic';
export const maxDuration = 600;

const UPLOADS_DIR = path.join(process.cwd(), 'uploads_tmp');
const OUTPUT_BASE = path.join(process.cwd(), 'public', 'nubes_procesadas');

function sanitize(s: string) { return s.replace(/[^a-z0-9_-]/gi, '_').toLowerCase(); }

export async function POST(req: NextRequest) {
  if (!isAccConfigured()) {
    return NextResponse.json({ error: 'ACC no configurado.' }, { status: 503 });
  }

  const converterPath = process.env.POTREE_CONVERTER_PATH?.trim();
  if (!converterPath) {
    return NextResponse.json({ error: 'POTREE_CONVERTER_PATH no configurado.' }, { status: 500 });
  }

  const body = await req.json() as {
    objectId?: string;   // ACC OSS object URN
    fileName?:  string;  // original file name for display
    comunaId?:  string;
    direccion?: string;
  };

  const { objectId, fileName, comunaId, direccion } = body;
  if (!objectId || !fileName || !comunaId || !direccion) {
    return NextResponse.json(
      { error: 'Se requieren: objectId, fileName, comunaId, direccion' },
      { status: 400 }
    );
  }

  const timestamp  = Date.now();
  const folderName = sanitize(direccion) + '_' + timestamp;
  const jobFile    = path.join(UPLOADS_DIR, `${folderName}.job.json`);

  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.writeFile(jobFile, JSON.stringify({
    status: 'processing', jobId: folderName, direccion, comunaId,
    source: 'acc', fileName,
    startedAt: new Date().toISOString(),
  }));

  // Background: download ACC → patch → convert → DB
  (async () => {
    const tmpFilePath = path.join(UPLOADS_DIR, `${folderName}.las`);
    let patchedPath: string | null = null;

    try {
      // 1. Get signed download URL from ACC
      const downloadUrl = await getDownloadUrl(objectId);

      // 2. Stream to disk
      const resp = await fetch(downloadUrl);
      if (!resp.ok || !resp.body) throw new Error(`Error descargando de ACC: ${resp.status}`);

      await new Promise<void>((resolve, reject) => {
        const ws = createWriteStream(tmpFilePath);
        const reader = resp.body!.getReader();

        const pump = async () => {
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) { ws.end(); break; }
              ws.write(Buffer.from(value));
            }
            ws.on('finish', resolve);
            ws.on('error',  reject);
          } catch (e) { reject(e); }
        };
        pump();
      });

      console.log(`[acc/process] Descargado: ${tmpFilePath}`);

      // 3. Patch extra bytes if needed
      let inputForConverter = tmpFilePath;
      const extraBytes = await detectExtraBytes(tmpFilePath);
      if (extraBytes > 0) {
        patchedPath       = path.join(UPLOADS_DIR, `${folderName}_patched.las`);
        await stripLasExtraBytes(tmpFilePath, patchedPath);
        inputForConverter = patchedPath;
      }

      // 4. Run PotreeConverter
      const outputDir = path.join(OUTPUT_BASE, folderName);
      await fs.mkdir(outputDir, { recursive: true });

      const exitCode = await new Promise<number | null>((resolve, reject) => {
        const proc = spawn(converterPath, [inputForConverter, '-o', outputDir], {
          windowsHide: true, stdio: 'pipe',
        });
        proc.stdout?.on('data', (c: Buffer) => process.stdout.write(`[PC] ${c}`));
        proc.stderr?.on('data', (c: Buffer) => process.stderr.write(`[PC] ${c}`));
        proc.on('close', resolve);
        proc.on('error', reject);
      });

      if (exitCode !== 0) throw new Error(`PotreeConverter salió con código ${exitCode}`);

      // 5. Register in DB
      const metadataUrl = `/nubes_procesadas/${folderName}/metadata.json`;
      await prisma.$executeRaw`
        INSERT INTO "Intervencion" ("comunaId", direccion, "pointCloudUrl", coordenadas)
        VALUES (
          ${comunaId}::uuid, ${direccion}, ${metadataUrl},
          ST_SetSRID(ST_MakePoint(0, 0), 4326)
        )
      `;

      // 6. Cleanup
      await fs.unlink(tmpFilePath).catch(() => {});
      if (patchedPath) await fs.unlink(patchedPath).catch(() => {});

      await fs.writeFile(jobFile, JSON.stringify({
        status: 'done', jobId: folderName, direccion, comunaId,
        metadataUrl, source: 'acc', fileName,
        completedAt: new Date().toISOString(),
      }));

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      console.error('[acc/process] ERROR:', msg);
      await fs.writeFile(jobFile, JSON.stringify({
        status: 'error', jobId: folderName, error: msg,
        failedAt: new Date().toISOString(),
      })).catch(() => {});
      if (patchedPath) await fs.unlink(patchedPath).catch(() => {});
    }
  })();

  return NextResponse.json({
    message: 'Procesamiento iniciado desde ACC.',
    jobId:   folderName,
    pollUrl: `/api/upload-las/status/${folderName}`,
  }, { status: 202 });
}
