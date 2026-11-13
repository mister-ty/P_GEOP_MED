import { NextRequest, NextResponse } from 'next/server';
import { listTopFolders, listFolderContents, isAccConfigured } from '@/app/lib/autodesk-acc';

export const dynamic = 'force-dynamic';

/**
 * GET /api/acc/browse?hubId=...&projectId=...
 *   → top folders for the project
 *
 * GET /api/acc/browse?projectId=...&folderId=...
 *   → contents of a specific folder (filtered to .las/.laz + subfolders)
 */
export async function GET(req: NextRequest) {
  if (!isAccConfigured()) {
    return NextResponse.json({ error: 'ACC no configurado.' }, { status: 503 });
  }

  const { searchParams } = req.nextUrl;
  const hubId     = searchParams.get('hubId');
  const projectId = searchParams.get('projectId');
  const folderId  = searchParams.get('folderId');

  if (!projectId) {
    return NextResponse.json({ error: 'Parámetro projectId requerido.' }, { status: 400 });
  }

  try {
    if (folderId) {
      const items = await listFolderContents(projectId, folderId);
      // Return folders + only .las/.laz files
      const filtered = items.filter((item) => {
        if (item.isFolder) return true;
        const lower = item.displayName.toLowerCase();
        return lower.endsWith('.las') || lower.endsWith('.laz');
      });
      return NextResponse.json(filtered);
    }

    if (hubId) {
      const folders = await listTopFolders(hubId, projectId);
      return NextResponse.json(folders);
    }

    return NextResponse.json({ error: 'Se requiere hubId (top folders) o folderId (contenido).' }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error';
    console.error('[acc/browse]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
