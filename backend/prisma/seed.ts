import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

/* ──────────────────────────────────────────────────────────────────────────── *
 *  Seed data — 30 intervenciones distributed across 3 communes:               *
 *    • El Poblado (14) → 12 pts, tight cluster on Cll 10                      *
 *    • Laureles-Estadio (11) → 10 pts, scattered around Parque Laureles       *
 *    • La Candelaria (10) → 8 pts, around Plaza de Cisneros                   *
 * ──────────────────────────────────────────────────────────────────────────── */
const CLOUD_URL   = '/nube_procesada/pointclouds/page/metadata.json';
const DXF_URL     = '/plano-muestra.dxf';
const ORTOFOTO_URL = '/ortofoto-muestra.jpg';

type RawInv = { direccion: string; lat: number; lon: number; cad: string | null; laz: string | null; orto: string | null };

const POBLADO_INVS: RawInv[] = [
  { direccion: 'Cll 16sur-CRISTAL',                lat: 6.2086, lon: -75.5677, cad: DXF_URL,  laz: CLOUD_URL,   orto: ORTOFOTO_URL  },
  { direccion: 'Cll 10 # 43B-25 Parque Bello Horizonte', lat: 6.2102, lon: -75.5658, cad: DXF_URL, laz: CLOUD_URL, orto: null },
  { direccion: 'Cra 43B # 11-30 Sector Manila',    lat: 6.2095, lon: -75.5671, cad: DXF_URL,  laz: null,        orto: ORTOFOTO_URL  },
  { direccion: 'Cll 8 # 43-10 Provenza',           lat: 6.2079, lon: -75.5685, cad: null,     laz: CLOUD_URL,   orto: null          },
  { direccion: 'Cra 44 # 10-05 La Frontera',       lat: 6.2118, lon: -75.5650, cad: DXF_URL,  laz: CLOUD_URL,   orto: ORTOFOTO_URL  },
  { direccion: 'Av El Poblado # 14-20 Santamaría', lat: 6.2088, lon: -75.5680, cad: null,     laz: CLOUD_URL,   orto: null          },
  { direccion: 'Cll 12 # 43A-50 Patio Bonito',     lat: 6.2111, lon: -75.5661, cad: DXF_URL,  laz: null,        orto: null          },
  { direccion: 'Cra 43 # 9-65 El Tesoro',          lat: 6.2075, lon: -75.5690, cad: DXF_URL,  laz: CLOUD_URL,   orto: ORTOFOTO_URL  },
  { direccion: 'Cll 7Sur # 44-10 Astorga',         lat: 6.2060, lon: -75.5695, cad: null,     laz: CLOUD_URL,   orto: null          },
  { direccion: 'Cra 45 # 13-80 Castropol',         lat: 6.2125, lon: -75.5643, cad: DXF_URL,  laz: CLOUD_URL,   orto: ORTOFOTO_URL  },
  { direccion: 'Cll 15 # 43C-12 San Lucas',        lat: 6.2141, lon: -75.5638, cad: null,     laz: null,        orto: null          },
  { direccion: 'Cra 42 # 8-30 Los Balsos',         lat: 6.2052, lon: -75.5702, cad: DXF_URL,  laz: CLOUD_URL,   orto: ORTOFOTO_URL  },
];

const LAURELES_INVS: RawInv[] = [
  { direccion: 'Primer Parque Laureles',            lat: 6.2465, lon: -75.5961, cad: DXF_URL,  laz: null,        orto: ORTOFOTO_URL  },
  { direccion: 'Cra 76 # 33-20 Segundo Parque',    lat: 6.2471, lon: -75.5950, cad: DXF_URL,  laz: CLOUD_URL,   orto: null          },
  { direccion: 'Cll 34A # 75-15 Lorena',           lat: 6.2458, lon: -75.5973, cad: null,     laz: CLOUD_URL,   orto: ORTOFOTO_URL  },
  { direccion: 'Cra 74 # 36-40 San Joaquín',       lat: 6.2490, lon: -75.5945, cad: DXF_URL,  laz: null,        orto: null          },
  { direccion: 'Cll 37 # 76-08 Estadio',           lat: 6.2502, lon: -75.5960, cad: DXF_URL,  laz: CLOUD_URL,   orto: ORTOFOTO_URL  },
  { direccion: 'Cra 70 # 44B-30 Carlos E. Restrepo', lat: 6.2475, lon: -75.5980, cad: null,   laz: CLOUD_URL,   orto: null          },
  { direccion: 'Av Nutibara # 71-50 Nutibara',     lat: 6.2440, lon: -75.5970, cad: DXF_URL,  laz: CLOUD_URL,   orto: ORTOFOTO_URL  },
  { direccion: 'Cll 33 # 74-22 Bolivariana',       lat: 6.2450, lon: -75.5956, cad: null,     laz: CLOUD_URL,   orto: null          },
  { direccion: 'Cra 77 # 35-10 Las Acacias',       lat: 6.2485, lon: -75.5939, cad: DXF_URL,  laz: null,        orto: null          },
  { direccion: 'Cll 39A # 73-44 Conquistadores',   lat: 6.2511, lon: -75.5952, cad: DXF_URL,  laz: CLOUD_URL,   orto: ORTOFOTO_URL  },
];

const CANDELARIA_INVS: RawInv[] = [
  { direccion: 'Plaza Botero',                      lat: 6.2520, lon: -75.5682, cad: null,     laz: null,        orto: ORTOFOTO_URL  },
  { direccion: 'Museo de Antioquia Cra 52 # 52-43', lat: 6.2529, lon: -75.5688, cad: DXF_URL,  laz: CLOUD_URL,   orto: null          },
  { direccion: 'Plaza de Cisneros Cll 44 # 53-30',  lat: 6.2540, lon: -75.5695, cad: null,     laz: CLOUD_URL,   orto: ORTOFOTO_URL  },
  { direccion: 'Parque de Berrío Cra 49 # 51-28',   lat: 6.2514, lon: -75.5672, cad: DXF_URL,  laz: null,        orto: null          },
  { direccion: 'Catedral Metropolitana Cll 56 # 48-70', lat: 6.2560, lon: -75.5680, cad: null, laz: CLOUD_URL,   orto: ORTOFOTO_URL  },
  { direccion: 'Cra 51 # 53-20 Guayaquil',          lat: 6.2533, lon: -75.5700, cad: DXF_URL,  laz: CLOUD_URL,   orto: null          },
  { direccion: 'Av Ferrocarril # 52-15 Alpujarra',  lat: 6.2508, lon: -75.5710, cad: DXF_URL,  laz: null,        orto: ORTOFOTO_URL  },
  { direccion: 'Cll 58 # 49-40 Villa Nueva',        lat: 6.2572, lon: -75.5668, cad: null,     laz: CLOUD_URL,   orto: null          },
];

async function main() {
  console.log('🔄 Iniciando poblado de la base de datos...');

  // ── 1. Comunas (skip if existing) ────────────────────────────────────────
  const geojsonPath = path.join(__dirname, 'data', 'comunas_medellin.json');
  const data = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
  const comunasReales = data.features.filter(
    (f: any) => f.properties.SUBTIPO_COMUNACORREGIMIENTO === 1 || parseInt(f.properties.CODIGO) <= 16
  );
  console.log(`📍 ${comunasReales.length} comunas en GeoJSON...`);

  for (const feature of comunasReales) {
    const codigo = String(feature.properties.CODIGO);
    const nombre = String(feature.properties.NOMBRE);
    const exists = await prisma.$queryRaw<any[]>`SELECT id FROM "Comuna" WHERE codigo = ${codigo}`;
    if (exists.length === 0) {
      await prisma.$executeRaw`
        INSERT INTO "Comuna" (nombre, codigo, geometria)
        VALUES (
          ${nombre}, ${codigo},
          ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON(${JSON.stringify(feature.geometry)})), 4326)
        )`;
      console.log(`  ✅ Insertada: ${nombre}`);
    } else {
      console.log(`  ⏭️  Existe: ${nombre}`);
    }
  }

  // ── 2. Intervenciones — delete all and re-seed for a clean state ──────────
  const currentCount = await prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) as count FROM "Intervencion"`;
  const currentN = Number(currentCount[0].count);

  if (currentN >= 25) {
    console.log(`🚀 Ya hay ${currentN} intervenciones. Saltando seed de intervenciones.`);
  } else {
    // Remove old stubs so we can repopulate cleanly
    await prisma.$executeRaw`DELETE FROM "Intervencion"`;
    console.log('🗑️  Intervenciones anteriores eliminadas. Insertando 30 nuevas...');

    const poblado    = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Comuna" WHERE codigo = '14' LIMIT 1`;
    const laureles   = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Comuna" WHERE codigo = '11' LIMIT 1`;
    const candelaria = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Comuna" WHERE codigo = '10' LIMIT 1`;

    const groups = [
      { comunaId: poblado[0]?.id,    label: 'El Poblado',        invs: POBLADO_INVS    },
      { comunaId: laureles[0]?.id,   label: 'Laureles-Estadio',  invs: LAURELES_INVS   },
      { comunaId: candelaria[0]?.id, label: 'La Candelaria',     invs: CANDELARIA_INVS },
    ];

    let total = 0;
    for (const { comunaId, label, invs } of groups) {
      if (!comunaId) { console.warn(`  ⚠️  No se encontró la comuna ${label}`); continue; }
      for (const inv of invs) {
        await prisma.$executeRaw`
          INSERT INTO "Intervencion" ("comunaId", direccion, "autocadDwgUrl", "pointCloudUrl", "ortofotoUrl", coordenadas)
          VALUES (
            ${comunaId}::uuid,
            ${inv.direccion},
            ${inv.cad},
            ${inv.laz},
            ${inv.orto},
            ST_SetSRID(ST_MakePoint(${inv.lon}, ${inv.lat}), 4326)
          )`;
        total++;
      }
      console.log(`  ✅ ${label}: ${invs.length} intervenciones`);
    }
    console.log(`\n🎉 Insertadas ${total} intervenciones en total.`);
  }

  console.log('✅ Seed finalizado!');
}

main()
  .catch((e) => { console.error('❌ Error en seed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
