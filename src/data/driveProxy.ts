import { supabase } from './supabase';

export interface DriveEntry {
  id: string;
  name: string;
  size: number | null;
  modifiedTime: string | null;
  parentId: string | null;
}

interface DriveListResponse {
  items: DriveEntry[];
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

async function requestDrive(route: string, parameters?: Record<string, string>): Promise<Response> {
  if (!supabase || !supabaseUrl || !publishableKey) {
    throw new Error('La connessione a Supabase non è configurata.');
  }

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error('La sessione è scaduta. Accedi di nuovo.');
  }

  const url = new URL(`/functions/v1/drive-proxy/${route}`, supabaseUrl);
  for (const [key, value] of Object.entries(parameters ?? {})) {
    url.searchParams.set(key, value);
  }
  try {
    return await fetch(url, {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${data.session.access_token}`,
        Accept: route === 'file' ? 'application/epub+zip' : 'application/json',
      },
    });
  } catch {
    throw new Error('Connessione a Google Drive non disponibile.');
  }
}

async function throwDriveError(response: Response): Promise<never> {
  const payload: unknown = await response.json().catch(() => null);
  const message = typeof payload === 'object' && payload !== null && 'error' in payload &&
      typeof payload.error === 'string'
    ? payload.error
    : 'Richiesta a Google Drive non riuscita.';
  throw new Error(message);
}

export async function listDriveFolders(): Promise<DriveEntry[]> {
  const response = await requestDrive('list');
  if (!response.ok) return await throwDriveError(response);
  const payload = await response.json() as DriveListResponse;
  return payload.items;
}

export async function listDriveEpubs(folderId: string): Promise<DriveEntry[]> {
  const response = await requestDrive('list', { folderId });
  if (!response.ok) return await throwDriveError(response);
  const payload = await response.json() as DriveListResponse;
  return payload.items;
}

export async function downloadDriveEpub(fileId: string): Promise<ArrayBuffer> {
  const response = await requestDrive('file', { id: fileId });
  if (!response.ok) return await throwDriveError(response);
  return await response.arrayBuffer();
}
