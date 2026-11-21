import type { Session } from '@supabase/supabase-js';
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
  app.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div><p class="eyebrow">La tua biblioteca</p><h1>Mundaneum</h1></div>
        <button class="secondary" id="sign-out" type="button">Esci</button>
      </header>
      <section class="card empty-state" aria-labelledby="empty-title">
        <div class="book-mark" aria-hidden="true">M</div>
        <h2 id="empty-title">La biblioteca è pronta</h2>
        <p class="muted">Ciao ${escapeHtml(email)}. I tuoi libri appariranno qui quando collegheremo Google Drive.</p>
        <span class="badge">Nessun libro ancora</span>
      </section>
    </main>`;

  app.querySelector<HTMLButtonElement>('#sign-out')?.addEventListener('click', async () => {
    const { error } = await supabase?.auth.signOut() ?? { error: new Error('Supabase non configurato') };
    if (error) showLibraryError(error.message);
  });
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
