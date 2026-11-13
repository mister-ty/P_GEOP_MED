/**
 * Autodesk Construction Cloud (ACC) — Data Management API client
 * Uses 2-legged OAuth (Client Credentials) for server-to-server access.
 *
 * Required env vars:
 *   APS_CLIENT_ID     — Application Client ID from Autodesk Developer Portal
 *   APS_CLIENT_SECRET — Application Client Secret
 */

const APS_BASE  = 'https://developer.api.autodesk.com';
const TOKEN_URL = `${APS_BASE}/authentication/v2/token`;

export function isAccConfigured(): boolean {
  return !!(process.env.APS_CLIENT_ID && process.env.APS_CLIENT_SECRET);
}

/* ── Token cache (in-process, resets on restart) ─────────────────────────── */
let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }

  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     process.env.APS_CLIENT_ID!,
    client_secret: process.env.APS_CLIENT_SECRET!,
    scope:         'data:read',
  });

  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ACC auth error ${res.status}: ${text}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = {
    value:     data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.value;
}

/* ── Generic authenticated GET ───────────────────────────────────────────── */
async function accGet<T>(path: string): Promise<T> {
  const token = await getToken();
  const res   = await fetch(`${APS_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ACC API ${res.status} at ${path}: ${text}`);
  }
  return res.json() as Promise<T>;
}

/* ── Types ───────────────────────────────────────────────────────────────── */
export interface AccHub {
  id:   string;
  name: string;
  type: string; // 'hubs' (ACC hubs start with 'b.')
}

export interface AccProject {
  id:   string;
  name: string;
  type: string;
}

export interface AccItem {
  id:          string;
  displayName: string;
  fileType:    string | null;
  objectId:    string | null; // OSS object ID for download
  size:        number | null;
  lastModified: string | null;
  isFolder:    boolean;
}

/* ── API wrappers ─────────────────────────────────────────────────────────── */

export async function listHubs(): Promise<AccHub[]> {
  const data = await accGet<{ data: { id: string; attributes: { name: string }; type: string }[] }>('/project/v1/hubs');
  return data.data.map((h) => ({ id: h.id, name: h.attributes.name, type: h.type }));
}

export async function listProjects(hubId: string): Promise<AccProject[]> {
  const data = await accGet<{ data: { id: string; attributes: { name: string }; type: string }[] }>(
    `/project/v1/hubs/${encodeURIComponent(hubId)}/projects`
  );
  return data.data.map((p) => ({ id: p.id, name: p.attributes.name, type: p.type }));
}

export async function listTopFolders(hubId: string, projectId: string): Promise<AccItem[]> {
  const data = await accGet<{ data: { id: string; attributes: { displayName: string; objectType?: string } }[] }>(
    `/project/v1/hubs/${encodeURIComponent(hubId)}/projects/${encodeURIComponent(projectId)}/topFolders`
  );
  return data.data.map((f) => ({
    id:           f.id,
    displayName:  f.attributes.displayName,
    fileType:     null,
    objectId:     null,
    size:         null,
    lastModified: null,
    isFolder:     true,
  }));
}

export async function listFolderContents(projectId: string, folderId: string): Promise<AccItem[]> {
  const data = await accGet<{
    data: {
      id:         string;
      type:       string;
      attributes: {
        displayName:   string;
        fileType?:     string;
        storageSize?:  number;
        lastModifiedTime?: string;
      };
      relationships?: {
        tip?: { data?: { id: string } };
        storage?: { data?: { id: string } };
      };
    }[];
  }>(`/data/v1/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(folderId)}/contents`);

  return data.data.map((item) => {
    const isFolder = item.type === 'folders';
    return {
      id:           item.id,
      displayName:  item.attributes.displayName,
      fileType:     item.attributes.fileType ?? null,
      objectId:     item.relationships?.storage?.data?.id ?? null,
      size:         item.attributes.storageSize ?? null,
      lastModified: item.attributes.lastModifiedTime ?? null,
      isFolder,
    };
  });
}

/**
 * Returns the signed download URL for a storage object.
 * objectId format: urn:adsk.objects:os.object:{bucket}/{object}
 */
export async function getDownloadUrl(objectId: string): Promise<string> {
  // Parse bucket and object from the objectId URN
  const withoutPrefix = objectId.replace('urn:adsk.objects:os.object:', '');
  const slashIdx = withoutPrefix.indexOf('/');
  if (slashIdx < 0) throw new Error(`Formato de objectId inválido: ${objectId}`);
  const bucket = withoutPrefix.slice(0, slashIdx);
  const object = withoutPrefix.slice(slashIdx + 1);

  const token  = await getToken();
  const url    = `${APS_BASE}/oss/v2/buckets/${encodeURIComponent(bucket)}/objects/${encodeURIComponent(object)}/signeds3download`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ACC download URL error ${res.status}: ${text}`);
  }
  const json = await res.json() as { url: string };
  return json.url;
}
