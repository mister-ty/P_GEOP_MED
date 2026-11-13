import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import * as path from 'node:path';
import busboy from 'busboy';
import sharp from 'sharp';
import { prisma } from '@/prisma/client';
import { stripLasExtraBytes, detectExtraBytes } from './las-patcher';
import { sampleLasToGeoJSON } from './las-sampler';

export const maxDuration = 600;
export const dynamic = 'force-dynamic';

const UPLOADS_DIR   = path.join(process.cwd(), 'uploads_tmp');
const OUTPUT_BASE   = path.join(process.cwd(), 'public', 'nubes_procesadas');
const ORTOFOTOS_DIR = path.join(process.cwd(), 'public', 'ortofotos');
const PLANOS_DIR    = path.join(process.cwd(), 'public', 'planos');

function sanitize(str: string) {
  return str.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
}

interface UploadedFile {
  tmpPath: string;
  filename: string;
  size: number;
}

/**
 * Streams a multipart request to disk with busboy.
 * req.formData() buffers every part in memory, which exhausts the Node heap
 * with GB-sized LAS files (the whole upload + copies live in RAM at once).
 * Here file parts are piped straight to UPLOADS_DIR as they arrive.
 */
async function parseMultipartToDisk(req: NextRequest, tmpDir: string): Promise<{
  fields: Record<string, string>;
  files: Record<string, UploadedFile>;
}> {
  const contentType = req.headers.get('content-type') ?? '';
  if (!req.body || !contentType.includes('multipart/form-data')) {
    throw new Error('Se esperaba una petición multipart/form-data');
  }

  const bb = busboy({ headers: { 'content-type': contentType } });
  const fields: Record<string, string> = {};
  const files: Record<string, UploadedFile> = {};
  const writes: Promise<void>[] = [];

  const parsed = new Promise<void>((resolve, reject) => {
    bb.on('field', (name, value) => { fields[name] = value; });
    bb.on('file', (name, stream, info) => {
      // Empty optional <input type=file> arrives with filename "" — drain and skip.
      if (!info.filename) { stream.resume(); return; }
      const tmpPath = path.join(tmpDir, `part_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      const ws = createWriteStream(tmpPath);
      let size = 0;
      stream.on('data', (c: Buffer) => { size += c.length; });
      writes.push(new Promise<void>((res, rej) => {
        ws.on('finish', () => { files[name] = { tmpPath, filename: info.filename, size }; res(); });
        ws.on('error', rej);
        stream.on('error', rej);
      }));
      stream.pipe(ws);
    });
    bb.on('error', reject);
    bb.on('close', resolve);
  });

  Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0]).pipe(bb);
  await parsed;
  await Promise.all(writes);
  return { fields, files };
}

/** Best-effort delete of any part files that were not consumed (renamed/moved). */
async function discardParts(files: Record<string, UploadedFile>): Promise<void> {
  await Promise.all(
    Object.values(files).map(f => fs.unlink(f.tmpPath).catch(() => {})),
  );
}

/** Move that tolerates crossing bind-mount boundaries (rename → EXDEV → copy). */
async function moveFile(src: string, dest: string): Promise<void> {
  try {
    await fs.rename(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      await fs.copyFile(src, dest);
      await fs.unlink(src);
    } else {
      throw err;
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    await fs.mkdir(UPLOADS_DIR,   { recursive: true });
    await fs.mkdir(ORTOFOTOS_DIR, { recursive: true });
    await fs.mkdir(PLANOS_DIR,    { recursive: true });

    // ── 1. Stream multipart body to disk ─────────────────────────────────────
    const { fields, files } = await parseMultipartToDisk(req, UPLOADS_DIR);

    const file      = files['file']     ?? null;
    const comunaId  = fields['comunaId']  ?? null;
    const direccion = fields['direccion'] ?? null;
    const latStr    = fields['lat']       ?? null;
    const lngStr    = fields['lng']       ?? null;
    const notas     = fields['notas']     ?? '';
    const ortofotoFile = files['ortofoto'] ?? null;
    const planoFile    = files['plano']    ?? null;

    if (!file || !comunaId || !direccion) {
      await discardParts(files);
      return NextResponse.json(
        { error: 'Se requieren: file, comunaId, direccion' },
        { status: 400 },
      );
    }

    const lat = latStr ? parseFloat(latStr) : 6.2442;
    const lng = lngStr ? parseFloat(lngStr) : -75.5812;

    // ── 2. Validate PotreeConverter path ─────────────────────────────────────
    const converterPath = process.env.POTREE_CONVERTER_PATH?.trim();
    if (!converterPath) {
      await discardParts(files);
      return NextResponse.json(
        { error: 'POTREE_CONVERTER_PATH no está configurado en .env' },
        { status: 500 },
      );
    }

    const timestamp  = Date.now();
    const folderName = sanitize(direccion) + '_' + timestamp;
    const direccionFull = notas.trim() ? `${direccion} — ${notas.trim()}` : direccion;

    // ── 3. Move .las into place (same mount → instant rename) ───────────────
    const tmpFilePath = path.join(UPLOADS_DIR, `${folderName}.las`);
    await moveFile(file.tmpPath, tmpFilePath);
    console.log(`[upload-las] LAS guardado: ${tmpFilePath} (${(file.size / 1e6).toFixed(1)} MB)`);

    // ── 4. Save ortofoto (optional) ──────────────────────────────────────────
    let ortofotoUrl: string | null = null;
    if (ortofotoFile && ortofotoFile.size > 0) {
      const origExt  = path.extname(ortofotoFile.filename).toLowerCase();
      const isTiff   = origExt === '.tif' || origExt === '.tiff';

      if (isTiff) {
        // Convertir TIFF a JPEG para visualización en browser
        const jpegName = `${folderName}.jpg`;
        await sharp(ortofotoFile.tmpPath)
          .jpeg({ quality: 90, mozjpeg: true })
          .toFile(path.join(ORTOFOTOS_DIR, jpegName));
        await fs.unlink(ortofotoFile.tmpPath).catch(() => {});
        ortofotoUrl = `/ortofotos/${jpegName}`;
      } else {
        const ext  = origExt || '.jpg';
        const name = `${folderName}${ext}`;
        await moveFile(ortofotoFile.tmpPath, path.join(ORTOFOTOS_DIR, name));
        ortofotoUrl = `/ortofotos/${name}`;
      }
      console.log(`[upload-las] Ortofoto guardada: ${ortofotoUrl}`);
    }

    // ── 5. Save plano/DWG (optional) ─────────────────────────────────────────
    let planoUrl: string | null = null;
    if (planoFile && planoFile.size > 0) {
      const ext  = path.extname(planoFile.filename) || '.dwg';
      const name = `${folderName}${ext}`;
      await moveFile(planoFile.tmpPath, path.join(PLANOS_DIR, name));
      planoUrl = `/planos/${name}`;
      console.log(`[upload-las] Plano guardado: ${planoUrl}`);
    }

    // Delete any part files that ended up unused (e.g. zero-byte uploads)
    await discardParts(files);

    // ── 6. Write initial job file ─────────────────────────────────────────────
    const jobId   = folderName;
    const jobFile = path.join(UPLOADS_DIR, `${jobId}.job.json`);
    await fs.writeFile(jobFile, JSON.stringify({
      status: 'processing', jobId, direccion: direccionFull, comunaId, lat, lng,
      ortofotoUrl, planoUrl,
      startedAt: new Date().toISOString(),
    }));

    // ── 7. Background: patch → convert → DB ──────────────────────────────────
    (async () => {
      let inputForConverter = tmpFilePath;
      let patchedPath: string | null = null;

      try {
        const extraBytes = await detectExtraBytes(tmpFilePath);
        if (extraBytes > 0) {
          patchedPath       = path.join(UPLOADS_DIR, `${folderName}_patched.las`);
          await stripLasExtraBytes(tmpFilePath, patchedPath);
          inputForConverter = patchedPath;
        }

        const outputDir = path.join(OUTPUT_BASE, folderName);
        await fs.mkdir(outputDir, { recursive: true });

        // ── Generate preview GeoJSON (before deleting the LAS) ─────────────
        try {
          const preview = await sampleLasToGeoJSON(inputForConverter, 50_000, lat, lng);
          await fs.writeFile(
            path.join(outputDir, 'preview.geojson'),
            JSON.stringify(preview.geojson),
          );
          console.log(
            `[upload-las] Preview: ${preview.geojson.features.length} pts, ` +
            `EPSG:${preview.epsg}, Z=[${preview.zMin.toFixed(1)}, ${preview.zMax.toFixed(1)}]`,
          );
        } catch (samplerErr) {
          console.warn('[upload-las] Preview generation skipped:', (samplerErr as Error).message);
        }

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

        const metadataUrl   = `/nubes_procesadas/${folderName}/metadata.json`;
        const nubeOutputDir = `/nubes_procesadas/${folderName}/`;

        await prisma.$executeRaw`
          INSERT INTO "Intervencion"
            ("comunaId", direccion, "pointCloudUrl", "ortofotoUrl", "autocadDwgUrl", coordenadas)
          VALUES (
            ${comunaId}::uuid,
            ${direccionFull},
            ${metadataUrl},
            ${ortofotoUrl},
            ${planoUrl},
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)
          )
        `;

        await fs.unlink(tmpFilePath).catch(() => {});
        if (patchedPath) await fs.unlink(patchedPath).catch(() => {});

        await fs.writeFile(jobFile, JSON.stringify({
          status: 'done', jobId, direccion: direccionFull, comunaId,
          metadataUrl, nubeOutputDir, ortofotoUrl, planoUrl,
          completedAt: new Date().toISOString(),
        }));
        console.log(`[upload-las] ✅ Completo: ${folderName}`);

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[upload-las] ERROR:', msg);
        await fs.writeFile(jobFile, JSON.stringify({
          status: 'error', jobId, error: msg, failedAt: new Date().toISOString(),
        })).catch(() => {});
        if (patchedPath) await fs.unlink(patchedPath).catch(() => {});
      }
    })();

    return NextResponse.json({
      message: 'Procesamiento iniciado.',
      jobId,
      pollUrl: `/api/upload-las/status/${jobId}`,
      fileSizeMB: (file.size / 1e6).toFixed(1),
    }, { status: 202 });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    console.error('[upload-las] error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
