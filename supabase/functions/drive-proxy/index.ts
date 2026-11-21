import { createClient } from 'npm:@supabase/supabase-js@2';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
const ALLOWED_ORIGINS = new Set([
  'https://turri00.github.io',
  'http://localhost:5173',
]);

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  size?: string;
  modifiedTime?: string;
  trashed?: boolean;
}

interface DriveListResponse {
  files?: DriveFile[];
  nextPageToken?: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

let cachedToken: CachedToken | null = null;
let tokenRequest: Promise<string> | null = null;

function jsonResponse(
  request: Request,
  status: number,
  payload: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function corsHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  const origin = request.headers.get('origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function pemToBytes(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/\\n/gu, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/gu, '')
    .replace(/-----END PRIVATE KEY-----/gu, '')
    .replace(/\s/gu, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function createGoogleAssertion(serviceAccount: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = base64Url(new TextEncoder().encode(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: DRIVE_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })));
  const unsignedAssertion = `${header}.${claims}`;
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(unsignedAssertion),
  );
  return `${unsignedAssertion}.${base64Url(new Uint8Array(signature))}`;
}

async function getGoogleAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  if (tokenRequest) return tokenRequest;

  tokenRequest = (async () => {
    const serviceAccountSecret = Deno.env.get('GOOGLE_SA_JSON');
    if (!serviceAccountSecret) throw new HttpError(500, 'Configurazione Drive incompleta.');

    let serviceAccount: ServiceAccount;
    try {
      serviceAccount = JSON.parse(serviceAccountSecret) as ServiceAccount;
    } catch {
      throw new HttpError(500, 'Configurazione Drive non valida.');
    }
    if (!serviceAccount.client_email || !serviceAccount.private_key) {
      throw new HttpError(500, 'Configurazione Drive non valida.');
    }

    const assertion = await createGoogleAssertion(serviceAccount);
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!response.ok) throw new HttpError(502, 'Autenticazione con Google Drive non riuscita.');

    const token = await response.json() as GoogleTokenResponse;
    if (!token.access_token) throw new HttpError(502, 'Google Drive non ha restituito un token valido.');
    const lifetimeSeconds = Math.max(60, token.expires_in ?? 3600);
    cachedToken = {
      value: token.access_token,
      expiresAt: Date.now() + lifetimeSeconds * 1000,
    };
    return token.access_token;
  })();

  try {
    return await tokenRequest;
  } finally {
    tokenRequest = null;
  }
}

async function driveJson<T>(path: string, parameters: URLSearchParams): Promise<T> {
  const accessToken = await getGoogleAccessToken();
  const response = await fetch(`${DRIVE_API}/${path}?${parameters.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 404) throw new HttpError(404, 'Elemento Drive non trovato.');
  if (!response.ok) throw new HttpError(502, 'Google Drive non è al momento disponibile.');
  return await response.json() as T;
}

async function getDriveFile(id: string): Promise<DriveFile> {
  const parameters = new URLSearchParams({
    fields: 'id,name,mimeType,parents,size,modifiedTime,trashed',
    supportsAllDrives: 'true',
  });
  return await driveJson<DriveFile>(`files/${encodeURIComponent(id)}`, parameters);
}

async function listDriveFiles(folderId: string, query: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const parameters = new URLSearchParams({
      q: query,
      pageSize: '1000',
      orderBy: 'name',
      fields: 'nextPageToken,files(id,name,mimeType,parents,size,modifiedTime,trashed)',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (pageToken) parameters.set('pageToken', pageToken);
    const page = await driveJson<DriveListResponse>('files', parameters);
    files.push(...(page.files ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  return files.filter((file) => !file.trashed && file.parents?.includes(folderId));
}

async function isBelowRoot(file: DriveFile, rootId: string): Promise<boolean> {
  if (file.id === rootId) return true;

  const queue = (file.parents ?? []).map((id) => ({ id, depth: 1 }));
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.id) || current.depth > 32) continue;
    if (current.id === rootId) return true;
    visited.add(current.id);

    const parent = await getDriveFile(current.id);
    if (parent.trashed || parent.mimeType !== FOLDER_MIME) continue;
    for (const parentId of parent.parents ?? []) {
      queue.push({ id: parentId, depth: current.depth + 1 });
    }
  }
  return false;
}

function escapeDriveQuery(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

async function requireDriveRoot(rootId: string): Promise<DriveFile> {
  const root = await getDriveFile(rootId);
  if (root.trashed || root.mimeType !== FOLDER_MIME) {
    throw new HttpError(500, 'La cartella principale di Drive non è valida.');
  }
  return root;
}

async function listRoute(request: Request, rootId: string): Promise<Response> {
  const url = new URL(request.url);
  const folderId = url.searchParams.get('folderId');
  const root = await requireDriveRoot(rootId);

  if (!folderId) {
    const folders = await listDriveFiles(
      rootId,
      `'${escapeDriveQuery(rootId)}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
    );
    return jsonResponse(request, 200, {
      items: folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        size: null,
        modifiedTime: folder.modifiedTime ?? null,
        parentId: folder.parents?.[0] ?? root.id,
      })),
    });
  }

  const folder = folderId === rootId ? root : await getDriveFile(folderId);
  if (folder.trashed || folder.mimeType !== FOLDER_MIME || !(await isBelowRoot(folder, rootId))) {
    throw new HttpError(403, 'La cartella richiesta non appartiene alla biblioteca.');
  }

  const entries = await listDriveFiles(
    folderId,
    `'${escapeDriveQuery(folderId)}' in parents and trashed=false`,
  );
  const epubs = entries.filter((file) =>
    file.mimeType !== FOLDER_MIME &&
    file.mimeType !== SHORTCUT_MIME &&
    file.name.toLocaleLowerCase('en-US').endsWith('.epub')
  );

  return jsonResponse(request, 200, {
    items: epubs.map((file) => ({
      id: file.id,
      name: file.name,
      size: file.size ? Number(file.size) : null,
      modifiedTime: file.modifiedTime ?? null,
      parentId: file.parents?.[0] ?? folderId,
    })),
  });
}

async function fileRoute(request: Request, rootId: string): Promise<Response> {
  const url = new URL(request.url);
  const fileId = url.searchParams.get('id');
  if (!fileId) throw new HttpError(400, 'Manca il parametro id.');

  const root = await requireDriveRoot(rootId);
  const file = await getDriveFile(fileId);
  if (
    file.trashed ||
    file.mimeType === FOLDER_MIME ||
    file.mimeType === SHORTCUT_MIME ||
    !file.name.toLocaleLowerCase('en-US').endsWith('.epub') ||
    !(await isBelowRoot(file, root.id))
  ) {
    throw new HttpError(403, 'Il file richiesto non è un EPUB della biblioteca.');
  }

  const accessToken = await getGoogleAccessToken();
  const mediaUrl = new URL(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`);
  mediaUrl.searchParams.set('alt', 'media');
  mediaUrl.searchParams.set('supportsAllDrives', 'true');
  const response = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (response.status === 404) throw new HttpError(404, 'EPUB non trovato.');
  if (!response.ok) throw new HttpError(502, 'Non è stato possibile scaricare l’EPUB.');

  const headers = new Headers(corsHeaders(request));
  headers.set('Content-Type', 'application/epub+zip');
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, { status: 200, headers });
}

Deno.serve(async (request: Request): Promise<Response> => {
  const origin = request.headers.get('origin');
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse(request, 403, { error: 'Origine non consentita.' });
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request),
    });
  }
  if (request.method !== 'GET') {
    return jsonResponse(request, 405, { error: 'Metodo non consentito.' });
  }

  const authorization = request.headers.get('authorization');
  const bearer = authorization?.match(/^Bearer\s+(.+)$/iu)?.[1];
  if (!bearer) return jsonResponse(request, 401, { error: 'Accesso non autorizzato.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const rootId = Deno.env.get('DRIVE_ROOT_FOLDER_ID');
  if (!supabaseUrl || !supabaseAnonKey || !rootId) {
    return jsonResponse(request, 500, { error: 'Configurazione della funzione incompleta.' });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  let authenticated = false;
  try {
    const { data, error } = await supabase.auth.getUser(bearer);
    authenticated = !error && Boolean(data.user);
  } catch {
    authenticated = false;
  }
  if (!authenticated) {
    return jsonResponse(request, 401, { error: 'Sessione non valida. Accedi di nuovo.' });
  }

  try {
    const path = new URL(request.url).pathname.replace(/\/+$/u, '').split('/').at(-1);
    if (path === 'list') return await listRoute(request, rootId);
    if (path === 'file') return await fileRoute(request, rootId);
    return jsonResponse(request, 404, { error: 'Percorso non trovato.' });
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse(request, error.status, { error: error.message });
    }
    return jsonResponse(request, 500, { error: 'Errore interno durante la richiesta a Drive.' });
  }
});
