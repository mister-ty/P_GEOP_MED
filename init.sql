-- ============================================================
-- Geoportal Medellín — Script de inicialización de la BD
-- Se ejecuta automáticamente al levantar el contenedor por
-- primera vez (montado en /docker-entrypoint-initdb.d/).
-- ============================================================

-- 1. Habilitar PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Tabla: Comuna
CREATE TABLE IF NOT EXISTS "Comuna" (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre      VARCHAR(120) NOT NULL,
    codigo      VARCHAR(10)  NOT NULL UNIQUE,
    geometria   geometry(MultiPolygon, 4326) NOT NULL
);

-- Índice espacial para consultas geográficas rápidas
CREATE INDEX IF NOT EXISTS idx_comuna_geometria
    ON "Comuna" USING GIST (geometria);

-- 3. Tabla: Intervencion
CREATE TABLE IF NOT EXISTS "Intervencion" (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "comunaId"      UUID NOT NULL
                        REFERENCES "Comuna"(id)
                        ON DELETE CASCADE,
    direccion       VARCHAR(255) NOT NULL,
    "autocadDwgUrl"  TEXT,
    "pointCloudUrl"  TEXT,
    "ortofotoUrl"    TEXT,
    coordenadas     geometry(Point, 4326) NOT NULL,
    "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice espacial para búsqueda por coordenadas
CREATE INDEX IF NOT EXISTS idx_intervencion_coordenadas
    ON "Intervencion" USING GIST (coordenadas);

-- Índice FK para consulta por comuna
CREATE INDEX IF NOT EXISTS idx_intervencion_comuna
    ON "Intervencion" ("comunaId");
