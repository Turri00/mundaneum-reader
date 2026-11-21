import type { Session } from '@supabase/supabase-js';
import { LIBRARY_CATEGORIES } from './config';
import { getBooks, upsertDriveBooks } from './data/books';
import { listDriveEpubs, listDriveFolders } from './data/driveProxy';
import { supabase, supabaseConfigured } from './data/supabase';
import './style.css';

function getAppRoot(): HTMLDivElement {
  const element = document.querySelector<HTMLDivElement>('#app');
  if (!element) throw new Error('App root element was not found.');
  return element;
}

const app = getAppRoot();

function showConfigurationError(): void {
  app.innerHTML = `
    <main class="shell">
      <section class="card" aria-labelledby="config-title">
        <p class="eyebrow">Mundaneum Reader</p>
        <h1 id="config-title">Configurazione necessaria</h1>
        <p class="muted">Mancano le impostazioni di Supabase. Aggiungi URL e publishable key nel file locale <code>.env.local</code> oppure nelle variabili del repository GitHub per il sito pubblicato.</p>
      </section>
    </main>`;
}

function showLogin(message = ''): void {
  app.innerHTML = `
    <main class="shell">
      <section class="card login-card" aria-labelledby="login-title">
        <p class="eyebrow">La tua biblioteca personale</p>
        <h1 id="login-title">Mundaneum</h1>
        <p class="muted">Accedi con l’email e la password del tuo account.</p>
        <form id="login-form">
          <label for="email">Indirizzo email</label>
          <input id="email" name="email" type="email" autocomplete="email" required placeholder="nome@esempio.it" />
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required />
          <button id="login-submit" type="submit">Accedi</button>
        </form>
        <div class="login-options">
          <p class="muted">In alternativa, puoi ricevere un link via email.</p>
          <button class="text-button" id="magic-link" type="button">Invia un link di accesso</button>
        </div>
        <p class="status" role="status" aria-live="polite">${message}</p>
      </section>
    </main>`;

  const form = app.querySelector<HTMLFormElement>('#login-form');
  const emailInput = app.querySelector<HTMLInputElement>('#email');
  const passwordInput = app.querySelector<HTMLInputElement>('#password');
  const status = app.querySelector<HTMLParagraphElement>('.status');
  const submitButton = app.querySelector<HTMLButtonElement>('#login-submit');
  const magicLinkButton = app.querySelector<HTMLButtonElement>('#magic-link');

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!supabase || !emailInput || !passwordInput || !status || !submitButton || !magicLinkButton) return;

    submitButton.disabled = true;
    magicLinkButton.disabled = true;
    status.textContent = 'Accesso in corso…';
    const { error } = await supabase.auth.signInWithPassword({
      email: emailInput.value.trim(),
      password: passwordInput.value,
    });
    if (error) {
      submitButton.disabled = false;
      magicLinkButton.disabled = false;
      status.textContent = 'Email o password non corretti. Controlla i dati e riprova.';
    }
  });

  magicLinkButton?.addEventListener('click', async () => {
    if (!supabase || !emailInput || !status || !submitButton || !magicLinkButton) return;
    if (!emailInput.checkValidity()) {
      emailInput.reportValidity();
      return;
    }

    submitButton.disabled = true;
    magicLinkButton.disabled = true;
    status.textContent = 'Invio del link in corso…';
    const { error } = await supabase.auth.signInWithOtp({
      email: emailInput.value.trim(),
      options: {
        emailRedirectTo: window.location.href,
        shouldCreateUser: false,
      },
    });
    submitButton.disabled = false;
    magicLinkButton.disabled = false;
    status.textContent = error
      ? 'Non è stato possibile inviare il link. Controlla l’indirizzo e riprova.'
      : 'Controlla la tua email e apri il link per accedere.';
  });
}

function showLibrary(session: Session): void {
  const email = session.user.email ?? 'Utente';
  const activeCategory = LIBRARY_CATEGORIES[0];
  app.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div><p class="eyebrow">La tua biblioteca</p><h1>Mundaneum</h1></div>
        <button class="secondary" id="sign-out" type="button">Esci</button>
      </header>
      <p class="muted greeting">Ciao ${escapeHtml(email)}.</p>
      <section class="card library-card" aria-labelledby="library-title">
        <div class="library-heading">
          <div><p class="eyebrow">Libreria EPUB</p><h2 id="library-title">Categorie</h2></div>
          <button id="refresh-library" type="button">Aggiorna libreria</button>
        </div>
        <nav class="category-list" aria-label="Categorie">
          ${LIBRARY_CATEGORIES.map((category) => `<span class="category-chip" aria-current="true">${escapeHtml(category)}</span>`).join('')}
        </nav>
        <p id="library-status" class="status" role="status" aria-live="polite">Caricamento dei libri salvati…</p>
        <ul id="book-list" class="book-list" aria-label="Libri EPUB"></ul>
      </section>
    </main>`;

  const refreshButton = app.querySelector<HTMLButtonElement>('#refresh-library');
  const status = app.querySelector<HTMLParagraphElement>('#library-status');
  const bookList = app.querySelector<HTMLUListElement>('#book-list');

  if (status && bookList) {
    void loadSavedBooks(activeCategory, status, bookList);
  }
  refreshButton?.addEventListener('click', async () => {
    if (!status || !bookList || !refreshButton) return;
    refreshButton.disabled = true;
    status.textContent = 'Aggiornamento della libreria in corso…';
    try {
      const folders = await listDriveFolders();
      const targetFolder = folders.find((folder) => normalizeCategory(folder.name) === normalizeCategory(activeCategory));
      if (!targetFolder) throw new Error(`La categoria “${activeCategory}” non è stata trovata in Google Drive.`);

      const driveBooks = await listDriveEpubs(targetFolder.id);
      await upsertDriveBooks(activeCategory, driveBooks);
      await loadSavedBooks(activeCategory, status, bookList, `${driveBooks.length} EPUB sincronizzati.`);
    } catch (error) {
      status.textContent = getErrorMessage(error, 'Non è stato possibile aggiornare la libreria.');
    } finally {
      refreshButton.disabled = false;
    }
  });

  app.querySelector<HTMLButtonElement>('#sign-out')?.addEventListener('click', async () => {
    const { error } = await supabase?.auth.signOut() ?? { error: new Error('Supabase non configurato') };
    if (error) showLibraryError(error.message);
  });
}

async function loadSavedBooks(
  category: string,
  status: HTMLParagraphElement,
  bookList: HTMLUListElement,
  successMessage?: string,
): Promise<void> {
  try {
    const books = await getBooks(category);
    bookList.innerHTML = books.length > 0
      ? books.map((book) => `
          <li class="book-row">
            <div class="book-cover" aria-hidden="true">EPUB</div>
            <div class="book-details">
              <h3>${escapeHtml(book.title || book.filename.replace(/\.epub$/iu, ''))}</h3>
              ${book.author ? `<p>${escapeHtml(book.author)}</p>` : ''}
            </div>
            <span class="book-size">${formatFileSize(book.size_bytes)}</span>
          </li>`).join('')
      : '<li class="empty-books">Nessun EPUB in questa categoria. Tocca “Aggiorna libreria” per cercare i libri.</li>';
    status.textContent = successMessage ?? `${books.length} ${books.length === 1 ? 'libro' : 'libri'} salvati.`;
  } catch (error) {
    status.textContent = getErrorMessage(error, 'Non è stato possibile caricare i libri salvati.');
  }
}

function normalizeCategory(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/giu, '').toLocaleLowerCase('it');
}

function formatFileSize(size: number | null): string {
  if (size === null || !Number.isFinite(size)) return '';
  if (size < 1_000_000) return `${Math.max(1, Math.round(size / 1000))} kB`;
  return `${(size / 1_000_000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function showLibraryError(message: string): void {
  const header = app.querySelector('header');
  if (!header) return;
  const alert = document.createElement('p');
  alert.className = 'status error';
  alert.setAttribute('role', 'alert');
  alert.textContent = `Errore durante l’uscita: ${message}`;
  header.after(alert);
}

function escapeHtml(value: string): string {
  const element = document.createElement('span');
  element.textContent = value;
  return element.innerHTML;
}

async function start(): Promise<void> {
  if (!supabaseConfigured || !supabase) {
    showConfigurationError();
    return;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    showLogin('Non è stato possibile verificare la sessione. Riprova.');
  } else if (data.session) {
    showLibrary(data.session);
  } else {
    showLogin();
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) showLibrary(session);
    else showLogin();
  });
}

void start();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', async () => {
    const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    });

    const updateBanner = (): void => {
      const banner = document.createElement('div');
      banner.className = 'update-banner';
      banner.innerHTML = '<span>Aggiornamento disponibile</span><button type="button">Aggiorna</button>';
      banner.querySelector('button')?.addEventListener('click', () => {
        registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
      });
      app.prepend(banner);
    };

    if (registration.waiting) updateBanner();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) updateBanner();
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
    void registration.update();
  });
}
