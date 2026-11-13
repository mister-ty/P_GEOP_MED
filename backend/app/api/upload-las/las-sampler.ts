/**
 * las-sampler.ts
 * Reads a LAS 1.0–1.4 file, samples N evenly-spaced points, reprojects to
 * WGS84, and returns a GeoJSON FeatureCollection suitable for MapLibre.
 *
 * CRS auto-detection (covers common Colombian cases):
 *   offsets within Colombia bbox (lng -77…-72, lat 4…9)  → WGS84 EPSG:4326
 *   offsetY in [600 000, 900 000)                         → UTM Zone 18N  EPSG:32618
 *   offsetY in [900 000, 1 600 000)                       → MAGNA-SIRGAS  EPSG:3116
 *   otherwise                                             → local/unknown
 *
 * When CRS is unknown (e.g. ground-based scanner in a local frame):
 *   If fallbackLat/fallbackLng are provided the cloud is centred at those
 *   geographic coordinates and local metres are converted to degrees.
 */
import * as fs  from 'node:fs/promises';
import proj4    from 'proj4';
import type { FeatureCollection, Feature, Point } from 'geojson';

// ── Register Colombian projections once ────────────────────────────────────
proj4.defs(
  'EPSG:3116',
  '+proj=tmerc +lat_0=4.596200416 +lon_0=-74.0775 +k=1 +x_0=1000000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
);
proj4.defs(
  'EPSG:32618',
  '+proj=utm +zone=18 +datum=WGS84 +units=m +no_defs',
);
proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs');

// Colombia bounding box (with generous margin)
const COL_LNG_MIN = -77.5, COL_LNG_MAX = -72.0;
const COL_LAT_MIN =   3.5, COL_LAT_MAX =   9.0;

export interface LasPreviewPoint { z: number }
export interface LasPreview {
  geojson:    FeatureCollection<Point, LasPreviewPoint>;
  epsg:       number;
  zMin:       number;
  zMax:       number;
  pointCount: number;
}

function detectEpsg(ox: number, oy: number): number {
  // Projected Colombian systems
  if (oy >= 600_000 && oy < 900_000)   return 32618; // UTM Zone 18N
  if (oy >= 900_000 && oy < 1_600_000) return 3116;  // MAGNA-SIRGAS Bogotá

  // WGS84 — only accept if the offset is actually within Colombia's bbox.
  // Some scanners output local coordinates that happen to fall inside ±180/±90
  // but are NOT geographic; rejecting them here prevents placing the cloud in
  // the wrong hemisphere.
  if (
    Math.abs(ox) <= 180 && Math.abs(oy) <= 90 &&
    ox >= COL_LNG_MIN && ox <= COL_LNG_MAX &&
    oy >= COL_LAT_MIN && oy <= COL_LAT_MAX
  ) return 4326;

  return 0; // unknown / local coordinate system
}

export async function sampleLasToGeoJSON(
  lasPath:      string,
  targetPoints: number  = 10_000,
  fallbackLat?: number,
  fallbackLng?: number,
): Promise<LasPreview> {
  const fd = await fs.open(lasPath, 'r');
  try {
    // ── 1. Read LAS header (375 bytes covers 1.0-1.4 in full) ──────────────
    const hdr = Buffer.allocUnsafe(375);
    await fd.read(hdr, 0, 375, 0);

    const sig = hdr.slice(0, 4).toString('ascii');
    if (sig !== 'LASF') throw new Error('Not a valid LAS file');

    const versionMinor = hdr.readUInt8(25);
    const offsetToData = hdr.readUInt32LE(96);
    const pointFormat  = hdr.readUInt8(104);
    const recordLength = hdr.readUInt16LE(105);

    // Point count (LAS 1.4 stores true count as uint64 at byte 247)
    let numPoints: number;
    if (versionMinor <= 3) {
      numPoints = hdr.readUInt32LE(107);
    } else {
      numPoints = Number(hdr.readBigUInt64LE(247));
    }

    if (numPoints === 0) throw new Error('LAS file reports 0 points');

    const scaleX  = hdr.readDoubleLE(131);
    const scaleY  = hdr.readDoubleLE(139);
    const scaleZ  = hdr.readDoubleLE(147);
    const offsetX = hdr.readDoubleLE(155);
    const offsetY = hdr.readDoubleLE(163);
    const offsetZ = hdr.readDoubleLE(171);

    const epsg = detectEpsg(offsetX, offsetY);
    const step = Math.max(1, Math.floor(numPoints / targetPoints));

    console.log(
      `[las-sampler] ${numPoints.toLocaleString()} pts, fmt=${pointFormat}, ` +
      `rec=${recordLength}B, step=${step}, EPSG:${epsg || 'unknown'}`,
    );

    const ptBuf = Buffer.allocUnsafe(recordLength);
    let   zMin = Infinity, zMax = -Infinity;

    // ── 2a. Known CRS → reproject on the fly ──────────────────────────────
    if (epsg !== 0) {
      const features: Feature<Point, LasPreviewPoint>[] = [];

      for (let i = 0; i < numPoints; i += step) {
        const pos = offsetToData + i * recordLength;
        const { bytesRead } = await fd.read(ptBuf, 0, recordLength, pos);
        if (bytesRead < 12) continue;

        const x = ptBuf.readInt32LE(0) * scaleX + offsetX;
        const y = ptBuf.readInt32LE(4) * scaleY + offsetY;
        const z = ptBuf.readInt32LE(8) * scaleZ + offsetZ;

        let lng: number, lat: number;
        if (epsg === 4326) {
          lng = x; lat = y;
        } else {
          const [rx, ry] = proj4(`EPSG:${epsg}`, 'EPSG:4326', [x, y]);
          lng = rx; lat = ry;
        }

        if (!isFinite(lng) || !isFinite(lat) || lat < -90 || lat > 90) continue;

        if (z < zMin) zMin = z;
        if (z > zMax) zMax = z;

        features.push({
          type:       'Feature',
          geometry:   { type: 'Point', coordinates: [lng, lat] },
          properties: { z },
        });
      }

      if (features.length === 0) throw new Error('No valid WGS84 points could be extracted');

      return {
        geojson:    { type: 'FeatureCollection', features },
        epsg,
        zMin,
        zMax,
        pointCount: numPoints,
      };
    }

    // ── 2b. Unknown/local CRS ─────────────────────────────────────────────
    // Collect raw (local) xyz values, then recentre on the fallback location.
    if (fallbackLat === undefined || fallbackLng === undefined) {
      throw new Error(
        'Unknown CRS and no fallback lat/lng supplied — cannot place cloud on map',
      );
    }

    type LocalPt = { lx: number; ly: number; z: number };
    const localPts: LocalPt[] = [];
    let sumLx = 0, sumLy = 0;

    for (let i = 0; i < numPoints; i += step) {
      const pos = offsetToData + i * recordLength;
      const { bytesRead } = await fd.read(ptBuf, 0, recordLength, pos);
      if (bytesRead < 12) continue;

      const lx = ptBuf.readInt32LE(0) * scaleX + offsetX;
      const ly = ptBuf.readInt32LE(4) * scaleY + offsetY;
      const z  = ptBuf.readInt32LE(8) * scaleZ + offsetZ;

      if (!isFinite(lx) || !isFinite(ly) || !isFinite(z)) continue;

      localPts.push({ lx, ly, z });
      sumLx += lx;
      sumLy += ly;
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }

    if (localPts.length === 0) throw new Error('No valid local points could be read');

    const cx = sumLx / localPts.length;
    const cy = sumLy / localPts.length;

    // Convert metres → degrees (approximation valid for Medellín's latitude).
    // 1° lat ≈ 110 540 m   1° lng ≈ 111 320 m × cos(lat)
    const latRad   = fallbackLat * (Math.PI / 180);
    const mPerDegLat = 110_540;
    const mPerDegLng = 111_320 * Math.cos(latRad);

    const features: Feature<Point, LasPreviewPoint>[] = localPts.map(({ lx, ly, z }) => ({
      type:     'Feature',
      geometry: {
        type:        'Point',
        coordinates: [
          fallbackLng + (lx - cx) / mPerDegLng,
          fallbackLat + (ly - cy) / mPerDegLat,
        ],
      },
      properties: { z },
    }));

    console.log(
      `[las-sampler] Local CRS: centred cloud at (${fallbackLat.toFixed(5)}, ${fallbackLng.toFixed(5)}), ` +
      `local extent X=[${(Math.min(...localPts.map(p => p.lx)) - cx).toFixed(1)}, ` +
      `${(Math.max(...localPts.map(p => p.lx)) - cx).toFixed(1)}]m`,
    );

    return {
      geojson:    { type: 'FeatureCollection', features },
      epsg:       0,
      zMin,
      zMax,
      pointCount: numPoints,
    };

  } finally {
    await fd.close();
  }
}
