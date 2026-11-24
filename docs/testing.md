# Checklist di verifica

## Phase 1c: correzioni lettore su iPhone

1. Apri un libro, torna alla libreria e verifica che titolo e autore EPUB compaiano. Tocca **Aggiorna libreria**: titolo, autore e `metadata_read` devono restare invariati; possono cambiare categoria, nome file e dimensione.
2. Se possibile, verifica anche una riga con `metadata_read = true` e titolo vuoto: aprire il libro deve riempire titolo/autore, poi la libreria deve mostrarli al ritorno.
3. Apri il libro: il lettore deve occupare tutto lo schermo senza card, cornici o pulsanti di cambio pagina visibili. La percentuale resta discreta in basso.
4. Tocca il terzo sinistro per tornare indietro e il terzo destro per avanzare; prova anche swipe verso destra e verso sinistra. La pagina deve scorrere con un breve movimento.
5. Tocca al centro per mostrare/nascondere le barre. Da quelle barre prova **Libreria**, **Indice**, A−/A+ e i tre temi. Le preferenze devono restare salvate dopo aver riaperto il libro.
6. Prova lo scroll verticale e la selezione del testo con pressione lunga: la selezione deve continuare a funzionare e non deve cambiare pagina.
7. Prova pinch zoom e doppio tocco nel testo e nell’interfaccia: l’app non deve ingrandirsi. Cambia carattere con A−/A+.
8. Verifica che **Aggiorna libreria** non azzeri i metadati, che il ritorno dal lettore aggiorni la lista, e che gli errori Supabase dei metadati appaiano nel lettore.
9. Ripeti il test di progresso Phase 1b, il ripristino su secondo dispositivo, la cache offline, i due orientamenti e le aree sicure descritti sotto.

## Phase 1b: lettore EPUB e progresso

1. Dalla libreria, tocca un libro EPUB: si apre il lettore senza scaricare nuovamente un file già in cache.
2. Usa zone di tocco e swipe per cambiare pagina.
3. Apri **Indice** e salta a un capitolo.
4. Riduci e aumenta il carattere; cambia tra **Chiaro**, **Seppia** e **Scuro**. Chiudi e riapri il libro: tema e dimensione devono restare salvati su quel dispositivo.
5. Leggi alcune pagine, attendi almeno 2 secondi e manda l’app in background. In Supabase `progress` controlla che siano valorizzati CFI, percentuale, `device_id` e `updated_at`.
6. Chiudi e riapri il libro sullo stesso dispositivo: deve riprendere senza prompt. La percentuale in libreria deve aggiornarsi.
7. Su un secondo dispositivo, apri lo stesso libro: deve comparire **Continua da dove eri su un altro dispositivo?** con **Sì** e **No**. Prova **Sì** per riprendere il CFI remoto. Per verificare **No**, torna sul primo dispositivo, salva un’altra posizione e riapri il libro sul secondo: il prompt deve riapparire e **No** deve iniziare dall’inizio.
8. Con il libro già scaricato e la libreria ancora aperta, disattiva la rete e riapri il libro: l’EPUB deve arrivare dalla cache IndexedDB. Il progresso non viene salvato offline; riattiva la rete per continuare la sincronizzazione.
9. Prova il lettore in verticale e in orizzontale; contenuto e controlli non devono finire sotto le aree sicure dell’iPhone.

Il CFI e il progresso non sono salvati localmente. In modalità offline resta disponibile la copia EPUB già scaricata; il progresso cloud non viene messo in coda sul dispositivo.

## Phase 1a: libreria EPUB e funzione Drive

1. Dalla dashboard Supabase, chiama la funzione `drive-proxy` con `GET /list` senza header `Authorization`: deve restituire **401**.
2. Accedi alla PWA con l’utente esistente e tocca **Aggiorna libreria**.
3. Verifica che compaia solo la categoria **Società** e che la lista contenga soltanto file `.epub`.
4. Tocca **Aggiorna libreria** una seconda volta. Non devono apparire duplicati; il conteggio deve restare stabile.
5. In Supabase **Table Editor → books**, verifica che le righe abbiano categoria `Società`, nome file, `drive_file_id` e `user_id` dell’utente.
6. Controlla che documenti e cartelle esterni alla cartella Drive configurata non vengano elencati o scaricati.

## Verifica manuale Phase 1a su iPhone reale

1. Apri la PWA installata e accedi con email e password.
2. Tocca **Aggiorna libreria** e verifica che la categoria Società e i suoi EPUB siano leggibili sullo schermo senza overflow orizzontale.
3. Ripeti l’aggiornamento e verifica che la lista non duplichi i libri.
4. Esci e accedi nuovamente; i libri salvati devono ricomparire prima di un nuovo aggiornamento Drive.

## Phase 0: checklist di verifica

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
