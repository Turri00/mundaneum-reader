# Phase 0: checklist di verifica

## Verifiche automatiche

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- Query RLS anonima in Supabase SQL Editor: i tre conteggi devono essere zero.

## Verifiche manuali su iPhone reale

1. Apri il sito HTTPS in Safari e verifica che compaiano la pagina di accesso e il campo email.
2. Inserisci email e password dell’utente già esistente in Supabase e tocca **Accedi**.
3. Verifica che appaia la libreria vuota con il tuo indirizzo email. In alternativa, prova **Invia un link di accesso** e aprilo dall’email.
4. In Safari, usa **Condividi → Aggiungi alla schermata Home**; avvia l’icona dalla schermata Home e verifica la modalità a schermo intero.
5. Tocca **Esci**; la schermata di accesso deve riapparire.
6. Dopo un nuovo deploy, verifica l’avviso **Aggiornamento disponibile** e che **Aggiorna** carichi la nuova versione.

## Verifica RLS senza utente

Apri il progetto Supabase → **SQL Editor**, incolla il contenuto di `supabase/tests/anonymous_rls.sql` ed eseguilo. I conteggi di `books`, `progress` e `highlights` devono essere zero.
