# Mundaneum Reader

App web progressiva (PWA) per leggere EPUB e sincronizzare la lettura tramite Supabase. L’interfaccia è in italiano; Phase 0 include accesso email/password e PWA, Phase 1a l’elenco EPUB della sola categoria Società, Phase 1b il lettore EPUB con progresso cloud e Phase 1c le correzioni di metadati e gesti d’uso su iPhone. La registrazione non è prevista.

## Requisiti

- Node.js 22 o superiore e npm.
- Un progetto Supabase.
- Supabase CLI solo per applicare e verificare le migration.

## Configurazione locale

1. Copia `.env.example` in `.env.local`.
2. Inserisci nel file URL Supabase e publishable key (la vecchia anon key è compatibile).
3. Avvia `npm run dev` e apri l’indirizzo locale mostrato da Vite.

I file `.env.*` sono esclusi da Git (tranne l’esempio). Il browser contiene solo URL e publishable key: non inserire mai una service role key.

## Comandi

- `npm run dev` avvia il server locale.
- `npm run build` controlla i tipi e crea la versione pubblicabile in `dist/`.
- `npm run typecheck` controlla TypeScript in modalità strict.
- `npm run lint` controlla il codice con ESLint.
- `npx supabase@latest db push --remote` applica le migration al progetto Supabase collegato; eseguilo solo dopo il collegamento esplicito al progetto corretto.

Il lettore usa `epubjs` in flusso paginato a colonna singola e a schermo intero. Le posizioni CFI e le percentuali sono salvate nella tabella `progress`; gli EPUB scaricati sono memorizzati in IndexedDB, mentre le preferenze di lettura (tema e dimensione carattere) sono salvate sul dispositivo. La sincronizzazione Drive aggiorna solo categoria, nome file e dimensione per i libri già presenti, lasciando intatti titolo, autore e `metadata_read`. Le correzioni e i test manuali della Phase 1c sono descritti in `docs/testing.md`.

## Supabase

La migration in `supabase/migrations/` crea `books`, `progress` e `highlights` con RLS e policy per `auth.uid()`. In Supabase SQL Editor, esegui la query in `supabase/tests/anonymous_rls.sql`: tutti e tre i conteggi devono essere zero per il ruolo anonimo.

La funzione autonoma `supabase/functions/drive-proxy/index.ts` espone `GET /list`, `GET /list?folderId=...` e `GET /file?id=...`. La funzione verifica il JWT con `auth.getUser`, usa il service account Drive in sola lettura e limita l’accesso ai discendenti della cartella principale. Per il deploy dalla dashboard aggiungi i secrets `GOOGLE_SA_JSON` e `DRIVE_ROOT_FOLDER_ID` nelle impostazioni delle Edge Functions; `SUPABASE_URL` e `SUPABASE_ANON_KEY` sono forniti da Supabase. Quando incolli la funzione dalla dashboard, disattiva **Verify JWT**: l’autenticazione applicativa resta obbligatoria dentro il codice.

Il client carica e aggiorna `books` tramite i moduli `src/data/`, rispettando RLS. La categoria di test è configurata in `src/config.ts`.

Per il login magic link, aggiungi agli URL consentiti di Supabase l’URL locale e l’URL HTTPS GitHub Pages del repository. Su GitHub Pages, la home ha forma `https://<nome-utente>.github.io/<nome-repository>/`.

## Deploy GitHub Pages

Il workflow `.github/workflows/deploy.yml` pubblica a ogni push su `main`. Nelle **Settings → Secrets and variables → Actions → Variables** del repository, crea le variabili `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. Il workflow le passa alla build e costruisce il percorso del repository; non legge `.env.local`.

In **Settings → Pages**, imposta la sorgente su **GitHub Actions**. Il primo deploy può richiedere alcuni minuti.

## Fasi e test

Il progetto segue `SPEC.md` una fase alla volta. Le checklist Phase 0, Phase 1a, Phase 1b e Phase 1c con le verifiche su iPhone sono in `docs/testing.md`.
