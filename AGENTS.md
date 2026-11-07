# AGENTS.md

Instructions for coding agents working on Mundaneum Reader. Read `SPEC.md` first; it is the source of truth.

## Workflow

- Work on **one phase at a time**, as defined in `SPEC.md`. Stop at the end of a phase and summarise what to test on a real iPhone.
- Before changing the data model, the auth approach or the hosting, stop and ask. Do not silently deviate from the spec.
- Prefer small commits with clear messages. One concern per commit.
- If something in the spec is ambiguous or impossible on iOS Safari, explain the trade-off and propose options instead of guessing.

## Code conventions

- TypeScript strict mode. No `any` unless commented why.
- Vanilla TS and DOM, small modules. Do not add a UI framework or state library without asking.
- All database and Drive access goes through `src/data/`. UI code never imports `@supabase/supabase-js` directly.
- UI language: **Italian** (labels, errors, prompts). Code, comments and commit messages: English.
- Keep dependencies minimal. Every new dependency must be free and maintained.

## Commands

Keep these working and documented in `README.md`:

- `npm run dev` : local dev server
- `npm run build` : production build
- `npm run typecheck`
- `npm run lint`
- `supabase db push` : apply migrations (documented, run by the human)

## Security rules (non-negotiable)

- **Never** commit secrets: service account JSON, Supabase service role key, `.env` files. Add them to `.gitignore` from the first commit.
- The client only ever holds the Supabase URL and anon key.
- The `drive-proxy` Edge Function must verify the Supabase JWT and restrict file access to descendants of `DRIVE_ROOT_FOLDER_ID`.
- RLS must be enabled on every table. Add a test or SQL check that a request without a valid user returns nothing.

## Testing

- Unit-test pure logic (CFI helpers, filename fallback parser, conflict resolution, sync queue).
- For the reader, test manually on a **real iPhone Safari and installed PWA**; desktop Chrome is not enough.
- Each phase ends with a short manual test checklist in `docs/testing.md`.

## Definition of done (per phase)

1. Acceptance criteria in `SPEC.md` pass.
2. `typecheck`, `lint` and `build` pass.
3. Deployed to GitHub Pages and verified as an installed PWA.
4. `README.md` and `docs/testing.md` updated.
