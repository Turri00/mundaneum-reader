# Mundaneum Reader: SPEC

Personal EPUB reader (PWA) with cloud-synced reading progress, highlights and notes.
Single user, used on iPhone and iPad (Safari, installed to Home Screen). Italian UI.

## Why this exists

Apple Books keeps reading state only on the device, so iPhone and iPad drift apart.
This app stores progress, highlights and notes in a cloud database so both devices stay aligned.

## Hard constraints

- **Cost: 0 EUR.** Free tiers only (GitHub Pages, Supabase free, Supabase Edge Functions).
- **EPUB only.** No PDF support.
- **No secrets in the repo or in the client bundle.** The Google service account key lives only in Supabase secrets.
- **Single user.** Row Level Security still on, every row carries `user_id`.
- **Primary target: iOS Safari / installed PWA.** Test there first, desktop Chrome second.
- Data access is isolated in `src/data/` so the backend can be swapped later.

## Stack

- Vite + TypeScript, vanilla (no UI framework unless a phase clearly needs it).
- `epubjs` for rendering. Use `flow: "paginated"`, `spread: "none"`.
- `@supabase/supabase-js` for DB and auth.
- PWA: `manifest.webmanifest` + service worker (Workbox or hand-written). App shell cached; **never cache Supabase API responses**.
- Hosting: GitHub Pages, deployed by GitHub Actions on push to `main`.
- Server side: Supabase Edge Function `drive-proxy` (Deno).

## Architecture

```
iPhone/iPad PWA ──(Supabase JWT)──> Edge Function drive-proxy ──(service account)──> Google Drive (folder "Libri", read-only)
        │
        └──(Supabase JS, RLS)──> Postgres: books, progress, highlights
```

- Drive folder `Libri` is shared read-only with the service account email.
- Each direct subfolder of `Libri` is a **category** (Società, Business, Economia, ...).
- Only `.epub` files are listed. Ignore everything else.

### Edge Function `drive-proxy`

Requires a valid Supabase JWT (reject otherwise). Routes:

- `GET /list?folderId=<id>` returns subfolders, or EPUB files in a folder: `{ id, name, size, modifiedTime, parentId }`.
- `GET /file?id=<fileId>` streams the EPUB bytes, with `Content-Type: application/epub+zip`.
- Secrets: `GOOGLE_SA_JSON` (service account key), `DRIVE_ROOT_FOLDER_ID`.
- Only allow file IDs that are descendants of `DRIVE_ROOT_FOLDER_ID`.
- CORS restricted to the GitHub Pages origin and `localhost`.

## Data model (Postgres)

```sql
create table books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  drive_file_id text not null,
  category text,
  title text,
  author text,
  filename text not null,
  size_bytes bigint,
  metadata_read boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, drive_file_id)
);

create table progress (
  book_id uuid primary key references books(id) on delete cascade,
  user_id uuid not null references auth.users(id) default auth.uid(),
  cfi text not null,
  percentage real not null check (percentage between 0 and 1),
  device_id text not null,
  updated_at timestamptz not null default now()
);

create table highlights (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  user_id uuid not null references auth.users(id) default auth.uid(),
  cfi_range text not null,
  text_excerpt text not null,
  color text not null default 'yellow',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
```

RLS on all tables: `user_id = auth.uid()` for select/insert/update/delete.
Provide migrations in `supabase/migrations/`.

## Behaviour rules

- **Position = EPUB CFI**, never page numbers. This keeps iPhone and iPad aligned despite different layouts.
- **Progress sync:** save on `relocated` event, debounced (about 2 s) and on `visibilitychange` to hidden. Conflict policy: last write wins by `updated_at`. On opening a book, if remote progress is newer than local and from another `device_id`, show a prompt: "Continua da dove eri su un altro dispositivo?" with Yes / No.
- **Metadata:** on first open of a book, read title and author from the EPUB OPF via epubjs and save to `books`; set `metadata_read = true`. Before that, fall back to the filename without extension.
- **Highlights:** soft delete via `deleted_at`. Re-render stored highlights on book open using `rendition.annotations.highlight`.
- **Offline:** downloaded EPUBs cached in IndexedDB (Cache API is not reliable on iOS). Progress and highlights are written to a local queue when offline and flushed when back online. Safari may evict storage, so the cloud DB is the only source of truth for user data.

## iOS pitfalls (must handle)

- Text selection inside the epubjs iframe is the hardest part. Test early on a real device. Listen to `selected` events on the rendition and build a custom action bar (Evidenzia / Nota / Copia) because the native iOS menu conflicts.
- Use `100dvh` and `env(safe-area-inset-*)` for layout.
- Disable pinch zoom inside the reader, keep font-size controls in-app.
- Service worker must never cause stale app shells: version the cache and show "Aggiornamento disponibile".
- Do not rely on the Web Speech API in standalone mode.

## Phases

Work one phase at a time. Do not start the next until the current one passes its acceptance criteria on a real iPhone.

### Phase 0: Scaffold

- Vite + TS project, PWA manifest and icons, GitHub Actions deploy to Pages.
- Supabase project config, migrations applied, magic link or email+password login.
- **Accept:** installable on iPhone Home Screen, login works, empty library screen shows.

### Phase 1: Library + reader + progress sync (MVP)

- `drive-proxy` Edge Function deployed and working.
- Library screen: categories (subfolders) then book list. Pull-to-refresh runs a sync that upserts `books`.
- Reader: open EPUB, paginated reading, table of contents, font size and theme (light/sepia/dark).
- Progress saved and restored using CFI, with the cross-device prompt.
- Test scope: folder "Società" only (16 books). Full library comes after.
- **Accept:** read 5 pages on iPhone, close the app, open on iPad, get the prompt and land on the same passage. Works after force-quit. Auth required for every API call.

### Phase 2: Highlights and text notes

- Select text, choose a color, optionally add a note. List of highlights per book with tap-to-jump.
- Sync across devices, soft delete, edit note.
- **Accept:** highlight on iPhone appears on iPad within one refresh; deleting it removes it on both.

### Phase 3: Voice notes, search, polish

- Note field uses native iOS dictation (microphone key on keyboard), `lang="it"`.
- Search across all notes and highlights (Postgres `ilike` is enough).
- Reading stats: books in progress, percentage, last opened.
- Export notes per book to Markdown.
- **Accept:** dictate a note in Italian on iPhone; search finds it.

## Out of scope

PDF, audio transcription via paid API, social features, multi-user, native app.
