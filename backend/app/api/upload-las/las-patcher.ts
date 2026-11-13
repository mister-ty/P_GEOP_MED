/**
 * las-patcher.ts
 * Strips "extra bytes" records from a LAS/LAZ file before feeding it to
 * PotreeConverter 2.1, which crashes (0xC0000409 stack-buffer-overrun) when
 * the LAS point record contains non-standard extra attributes (e.g. "HasColor").
 *
 * Spec references:
 *   ASPRS LAS 1.2 / 1.3 header offsets
 *   Standard LAS Point Data Record Formats 0-5
 */
import * as fs from 'node:fs/promises';

/** Expected byte size for each LAS point data format (0–10). */
const STANDARD_RECORD_LENGTHS: Record<number, number> = {
  0: 20,   // x, y, z, intensity, bit_fields(1), class(1), scan_angle(1), user_data(1), source_id(2)
  1: 28,   // format 0 + gps_time(8)
  2: 26,   // format 0 + rgb(6)
  3: 34,   // format 0 + gps_time(8) + rgb(6)
  4: 57,   // format 1 + wave packet (29)
  5: 63,   // format 3 + wave packet (29)
  6: 30,   // LAS 1.4 base
  7: 36,   // LAS 1.4 + rgb
  8: 38,   // LAS 1.4 + rgb + nir
  9: 59,   // LAS 1.4 + wave packet
  10: 67,  // LAS 1.4 + rgb + nir + wave packet
};

/**
 * Returns the number of extra bytes per point record, or 0 if none.
 * Reads only the LAS header — does not load point data.
 */
export async function detectExtraBytes(lasPath: string): Promise<number> {
  const fd = await fs.open(lasPath, 'r');
  try {
    const header = Buffer.allocUnsafe(108);
    await fd.read(header, 0, 108, 0);

    const sig = header.slice(0, 4).toString('ascii');
    if (sig !== 'LASF') throw new Error('Not a valid LAS/LASF file');

    const pointFormatId     = header.readUInt8(104);
    const recordLength      = header.readUInt16LE(105);
    const expected          = STANDARD_RECORD_LENGTHS[pointFormatId];

    if (expected === undefined) {
      throw new Error(`Unknown LAS point format ID: ${pointFormatId}`);
    }
    return Math.max(0, recordLength - expected);
  } finally {
    await fd.close();
  }
}

/**
 * Strips all extra bytes from every point record in a LAS 1.0–1.3 file, then
 * writes the sanitized result to `outputPath`.
 *
 * For files with zero extra bytes this is effectively a fast copy.
 * For large files (200+ MB) this runs in streaming chunks to stay within memory.
 *
 * @returns `true` if stripping was required, `false` if the file was already clean.
 */
export async function stripLasExtraBytes(
  inputPath: string,
  outputPath: string,
): Promise<boolean> {
  // --- Read full header to get geometry ---
  const headerBuf = Buffer.allocUnsafe(200);
  const fdIn = await fs.open(inputPath, 'r');
  try {
    await fdIn.read(headerBuf, 0, 200, 0);
  } finally {
    await fdIn.close();
  }

  const sig = headerBuf.slice(0, 4).toString('ascii');
  if (sig !== 'LASF') throw new Error('Not a valid LAS/LASF file');

  const versionMajor      = headerBuf.readUInt8(24);
  const versionMinor      = headerBuf.readUInt8(25);
  const offsetToPointData = headerBuf.readUInt32LE(96);   // bytes 96-99
  const pointFormatId     = headerBuf.readUInt8(104);
  const recordLength      = headerBuf.readUInt16LE(105);  // bytes 105-106

  const expectedLength = STANDARD_RECORD_LENGTHS[pointFormatId];
  if (expectedLength === undefined) {
    throw new Error(`Unknown LAS point format ID: ${pointFormatId}`);
  }

  const extraBytes = recordLength - expectedLength;
  if (extraBytes <= 0) {
    console.log('[las-patcher] No extra bytes found — skipping patch');
    await fs.copyFile(inputPath, outputPath);
    return false;
  }

  console.log(
    `[las-patcher] Found ${extraBytes} extra byte(s)/point in format ${pointFormatId}. ` +
    `Patching ${inputPath} → ${outputPath}`
  );

  // --- Determine number of points ---
  let numPoints: number;
  if (versionMajor === 1 && versionMinor <= 3) {
    numPoints = headerBuf.readUInt32LE(107);              // bytes 107-110
  } else {
    // LAS 1.4 stores the true count as uint64 at byte 247
    const extHeader = Buffer.allocUnsafe(8);
    const fd2 = await fs.open(inputPath, 'r');
    try { await fd2.read(extHeader, 0, 8, 247); } finally { await fd2.close(); }
    numPoints = Number(extHeader.readBigUInt64LE(0));
  }

  // --- Build new header (same as original but with updated record length) ---
  const headerAndVLRsSize = offsetToPointData;
  const headerAndVLRsBuf  = Buffer.allocUnsafe(headerAndVLRsSize);
  const fd3 = await fs.open(inputPath, 'r');
  try {
    await fd3.read(headerAndVLRsBuf, 0, headerAndVLRsSize, 0);
  } finally {
    await fd3.close();
  }
  headerAndVLRsBuf.writeUInt16LE(expectedLength, 105);   // patch record length

  // --- Stream-process point data in 50 MB chunks to avoid OOM ---
  const CHUNK_POINTS   = Math.max(1, Math.floor((50 * 1024 * 1024) / recordLength));
  const chunkBufIn     = Buffer.allocUnsafe(CHUNK_POINTS * recordLength);
  const chunkBufOut    = Buffer.allocUnsafe(CHUNK_POINTS * expectedLength);

  const fdRead  = await fs.open(inputPath, 'r');
  const fdWrite = await fs.open(outputPath, 'w');
  try {
    // Write patched header + VLRs
    await fdWrite.write(headerAndVLRsBuf);

    let pointsRemaining = numPoints;
    let readOffset = offsetToPointData;

    while (pointsRemaining > 0) {
      const batch    = Math.min(CHUNK_POINTS, pointsRemaining);
      const readSize = batch * recordLength;

      const { bytesRead } = await fdRead.read(chunkBufIn, 0, readSize, readOffset);
      if (bytesRead === 0) break;

      // Copy each point, dropping the trailing extra bytes
      for (let i = 0; i < batch; i++) {
        chunkBufIn.copy(chunkBufOut, i * expectedLength, i * recordLength, i * recordLength + expectedLength);
      }

      await fdWrite.write(chunkBufOut, 0, batch * expectedLength);

      readOffset      += bytesRead;
      pointsRemaining -= batch;
    }
  } finally {
    await fdRead.close();
    await fdWrite.close();
  }

  console.log(`[las-patcher] ✅ Done: stripped ${extraBytes} extra byte(s)/point from ${numPoints.toLocaleString()} points`);
  return true;
}
