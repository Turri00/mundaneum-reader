import type { Book, Contents, Location as EpubLocation, NavItem, Rendition } from 'epubjs';
import { updateBookMetadata } from './data/books';
import { getCachedEpub, cacheEpub } from './data/epubCache';
import { downloadDriveEpub } from './data/driveProxy';
import { getProgress, saveProgress } from './data/progress';
import type { ProgressRow, ProgressUpdate } from './data/progress';
import type { BookRow } from './data/books';
import {
  getDeviceId,
  getProgressSeenAt,
  loadReaderPreferences,
  markProgressSeen,
  saveReaderPreferences,
  type ReaderPreferences,
  type ReaderTheme,
} from './readerSettings';

type CloseReader = () => void;

interface ThemeStyle {
  body: Record<string, string>;
  p: Record<string, string>;
  a: Record<string, string>;
}

const READER_THEMES: Record<ReaderTheme, ThemeStyle> = {
  light: {
    body: { color: '#252a2f', background: '#fffefa', 'font-family': 'Georgia, serif', 'line-height': '1.65' },
    p: { 'line-height': '1.65' },
    a: { color: '#315a67' },
  },
  sepia: {
    body: { color: '#493d2f', background: '#f4ecd8', 'font-family': 'Georgia, serif', 'line-height': '1.7' },
    p: { 'line-height': '1.7' },
    a: { color: '#76532e' },
  },
  dark: {
    body: { color: '#e4e2dc', background: '#202629', 'font-family': 'Georgia, serif', 'line-height': '1.7' },
    p: { 'line-height': '1.7' },
    a: { color: '#a9cbd2' },
  },
};

export async function openBookReader(
  app: HTMLDivElement,
  bookRow: BookRow,
  onClose: CloseReader,
): Promise<void> {
  const preferences = loadReaderPreferences();
  app.innerHTML = readerMarkup(bookRow, preferences);

  const stage = app.querySelector<HTMLDivElement>('#epub-stage');
  const title = app.querySelector<HTMLHeadingElement>('#reader-title');
  const author = app.querySelector<HTMLParagraphElement>('#reader-author');
  const status = app.querySelector<HTMLParagraphElement>('#reader-status');
  const progressLabel = app.querySelector<HTMLSpanElement>('#reader-progress');
  const closeButton = app.querySelector<HTMLButtonElement>('#reader-close');
  const readerShell = app.querySelector<HTMLElement>('.reader-shell');
  const fontDownButton = app.querySelector<HTMLButtonElement>('#font-down');
  const fontUpButton = app.querySelector<HTMLButtonElement>('#font-up');
  const fontSizeLabel = app.querySelector<HTMLSpanElement>('#font-size-label');
  const themeSelect = app.querySelector<HTMLSelectElement>('#reader-theme');
  const tableOfContents = app.querySelector<HTMLDivElement>('#reader-toc');
  if (!stage || !title || !author || !status || !progressLabel || !closeButton || !readerShell ||
      !fontDownButton || !fontUpButton || !fontSizeLabel || !themeSelect || !tableOfContents) {
    return;
  }

  let epubBook: Book | null = null;
  let rendition: Rendition | null = null;
  let closed = false;
  let ignoreFirstRelocation = true;
  let timer: number | null = null;
  let pendingProgress: ProgressUpdate | null = null;
  let lastCfi: string | null = null;
  let cancelResumePrompt: (() => void) | null = null;
  let saveQueue = Promise.resolve();
  let savedPreferences = preferences;
  let openingNotice = '';
  const deviceId = getDeviceId();

  const setStatus = (message: string): void => {
    status.textContent = message;
    readerShell.classList.toggle('reader-warning', Boolean(message && /(non è stato possibile|non salvati|non disponibile)/iu.test(message)));
  };

  const updateProgressDisplay = (cfi: string): number => {
    if (!epubBook) return 0;
    const fraction = epubBook.locations.percentageFromCfi(cfi);
    const safeFraction = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
    progressLabel.textContent = `${Math.round(safeFraction * 100)}%`;
    return safeFraction;
  };

  const flushProgress = (): Promise<void> => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    const update = pendingProgress;
    pendingProgress = null;
    if (!update) return saveQueue;
    if (!navigator.onLine) {
      setStatus('Sei offline: il progresso resta sul cloud e non è stato salvato.');
      return saveQueue;
    }
    saveQueue = saveQueue.then(async () => {
      try {
        const updatedAt = await saveProgress(update);
        markProgressSeen(bookRow.id, updatedAt);
        setStatus(`Progresso salvato nel cloud · ${Math.round(update.percentage * 100)}%.`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Non è stato possibile salvare il progresso.');
      }
    });
    return saveQueue;
  };

  const scheduleProgress = (cfi: string, immediate = false): void => {
    lastCfi = cfi;
    const percentage = updateProgressDisplay(cfi);
    pendingProgress = {
      bookId: bookRow.id,
      cfi,
      percentage,
      deviceId,
    };
    if (timer !== null) window.clearTimeout(timer);
    timer = immediate ? null : window.setTimeout(() => void flushProgress(), 2000);
    if (immediate) void flushProgress();
  };

  const flushCurrentProgress = async (): Promise<void> => {
    if (rendition) {
      try {
        const location = await rendition.currentLocation();
        if (location?.cfi) scheduleProgress(location.cfi, true);
      } catch {
        // The current location may not be available while epub.js is changing sections.
      }
    }
    await flushProgress();
  };

  const handleVisibility = (): void => {
    if (document.visibilityState === 'hidden') void flushCurrentProgress();
  };
  const handlePageHide = (): void => void flushCurrentProgress();
  const handleOnline = (): void => {
    if (lastCfi) scheduleProgress(lastCfi);
  };

  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('online', handleOnline);

  const closeReader = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    cancelResumePrompt?.();
    closeButton.disabled = true;
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('pagehide', handlePageHide);
    window.removeEventListener('online', handleOnline);
    if (rendition) await flushCurrentProgress();
    rendition?.destroy();
    epubBook?.destroy();
    app.innerHTML = '';
    onClose();
  };

  closeButton.addEventListener('click', () => void closeReader());
  const turnPage = (direction: 'previous' | 'next'): void => {
    readerShell.classList.remove('turn-next', 'turn-previous');
    void readerShell.offsetWidth;
    readerShell.classList.add(direction === 'next' ? 'turn-next' : 'turn-previous');
    const operation = direction === 'previous' ? rendition?.prev() : rendition?.next();
    void operation?.catch(() => setStatus('Non è stato possibile cambiare pagina.'));
  };
  const toggleControls = (): void => {
    readerShell.classList.toggle('controls-visible');
  };

  const applyPreferences = (next: ReaderPreferences, reportLocation = true): void => {
    savedPreferences = next;
    saveReaderPreferences(next);
    readerShell.dataset.theme = next.theme;
    applyStatusBarTheme(next.theme);
    fontSizeLabel.textContent = `${next.fontSize}px`;
    if (rendition) {
      rendition.themes.select(next.theme);
      rendition.themes.fontSize(`${next.fontSize}px`);
      if (reportLocation) {
        void rendition.reportLocation().catch(() => setStatus('Impostazione aggiornata.'));
      }
    }
  };

  fontDownButton.addEventListener('click', () => {
    applyPreferences({ ...savedPreferences, fontSize: Math.max(14, savedPreferences.fontSize - 1) });
  });
  fontUpButton.addEventListener('click', () => {
    applyPreferences({ ...savedPreferences, fontSize: Math.min(30, savedPreferences.fontSize + 1) });
  });
  themeSelect.addEventListener('change', () => {
    const theme = themeSelect.value as ReaderTheme;
    if (theme === 'light' || theme === 'sepia' || theme === 'dark') {
      applyPreferences({ ...savedPreferences, theme });
    }
  });
  applyStatusBarTheme(preferences.theme);
  themeSelect.addEventListener('change', () => applyStatusBarTheme(savedPreferences.theme));
  enableReaderGestures(readerShell, stage, () => turnPage('previous'), () => turnPage('next'), toggleControls);

  try {
    setStatus('Apro il libro…');
    const cached = await getCachedEpub(bookRow.drive_file_id).catch(() => null);
    let epubBytes = cached;
    if (!epubBytes) {
      setStatus('Scarico l’EPUB da Google Drive…');
      epubBytes = await downloadDriveEpub(bookRow.drive_file_id);
      try {
        await cacheEpub(bookRow.drive_file_id, epubBytes.slice(0));
      } catch {
        openingNotice = 'Questo dispositivo non ha potuto salvare una copia offline dell’EPUB.';
      }
    } else {
      setStatus('Apro l’EPUB salvato su questo dispositivo…');
    }
    if (closed) return;

    const epubModule = await import('epubjs');
    if (closed) return;
    epubBook = epubModule.default(epubBytes);
    await epubBook.ready;
    if (closed) return;
    const metadata = await epubBook.loaded.metadata;
    if (closed) return;
    const bookTitle = metadata.title?.trim() || bookRow.filename.replace(/\.epub$/iu, '');
    const bookAuthor = metadata.creator?.trim() || null;
    title.textContent = bookTitle;
    author.textContent = bookAuthor ?? '';
    if (!bookRow.metadata_read || !bookRow.title?.trim()) {
      try {
        await updateBookMetadata(bookRow.id, bookTitle, bookAuthor);
      } catch {
        openingNotice = 'Metadati non salvati nel cloud: controlla la connessione e i permessi Supabase.';
      }
    }
    if (closed) return;

    setStatus('Preparo la posizione di lettura…');
    await epubBook.locations.generate(1000);
    if (closed) return;
    const toc = await epubBook.loaded.navigation;
    if (closed) return;
    renderToc(tableOfContents, toc.toc, (href) => {
      void rendition?.display(href).catch(() => setStatus('Non è stato possibile aprire questa sezione.'));
    });
    rendition = epubBook.renderTo(stage, {
      flow: 'paginated',
      spread: 'none',
      width: '100%',
      height: '100%',
    });
    registerThemes(rendition);
    applyPreferences(savedPreferences, false);
    rendition.hooks.content.register((contents: Contents) => {
      enableIframeGestures(contents, () => turnPage('previous'), () => turnPage('next'), toggleControls);
    });
    rendition.on('relocated', (location: EpubLocation) => {
      updateProgressDisplay(location.start.cfi);
      if (ignoreFirstRelocation) {
        ignoreFirstRelocation = false;
        return;
      }
      scheduleProgress(location.start.cfi);
    });

    let remoteProgress: ProgressRow | null = null;
    try {
      remoteProgress = await getProgress(bookRow.id);
    } catch {
      openingNotice = 'Progresso cloud non disponibile; il libro si apre dall’inizio.';
      setStatus(openingNotice);
    }
    if (closed) return;

    let startCfi: string | undefined;
    if (remoteProgress) {
      const lastSeenAt = getProgressSeenAt(bookRow.id);
      const remoteUpdatedAt = Date.parse(remoteProgress.updated_at);
      const lastSeenTimestamp = lastSeenAt ? Date.parse(lastSeenAt) : Number.NaN;
      const remoteIsNewer = !lastSeenAt || !Number.isFinite(remoteUpdatedAt) ||
        !Number.isFinite(lastSeenTimestamp) || remoteUpdatedAt > lastSeenTimestamp;
      if (remoteProgress.device_id !== deviceId) {
        if (remoteIsNewer) {
          const resume = await askToResume(app, (cancel) => {
            cancelResumePrompt = cancel;
          });
          cancelResumePrompt = null;
          if (resume) startCfi = remoteProgress.cfi;
        }
      } else {
        startCfi = remoteProgress.cfi;
      }
      markProgressSeen(bookRow.id, remoteProgress.updated_at);
    }
    if (closed) return;

    try {
      await rendition.display(startCfi);
    } catch {
      if (!startCfi) throw new Error('Non è stato possibile aprire questo EPUB.');
      openingNotice = 'La posizione salvata non è più disponibile; il libro si apre dall’inizio.';
      await rendition.display();
    }
    if (closed) return;
    setStatus([openingNotice, remoteProgress && startCfi ? 'Progresso ripristinato dal cloud.' : '']
      .filter(Boolean).join(' · '));
    window.requestAnimationFrame(() => rendition?.resize(stage.clientWidth, stage.clientHeight));
  } catch {
    if (!closed) {
      setStatus('Non è stato possibile aprire il libro. Verifica che l’EPUB sia valido e riprova.');
      stage.innerHTML = '<p class="reader-error">Controlla la connessione e riprova. Il libro resta disponibile nella libreria.</p>';
    }
  }
}

function readerMarkup(book: BookRow, preferences: ReaderPreferences): string {
  const fallbackTitle = book.title?.trim() || book.filename.replace(/\.epub$/iu, '');
  return `
    <main class="reader-shell" data-theme="${preferences.theme}">
      <header class="reader-header reader-controls">
        <div class="reader-book-heading">
          <h1 id="reader-title">${escapeHtml(fallbackTitle)}</h1>
          <p id="reader-author" class="reader-author">${escapeHtml(book.author ?? '')}</p>
        </div>
        <button id="reader-close" class="reader-close" type="button" aria-label="Torna alla libreria">Chiudi</button>
      </header>
      <div class="reader-toolbar reader-controls">
        <details class="reader-toc">
          <summary>Indice</summary>
          <div id="reader-toc" class="reader-toc-list"><p>Caricamento dell’indice…</p></div>
        </details>
        <div class="reader-settings" aria-label="Impostazioni di lettura">
          <div class="font-controls" aria-label="Dimensione del testo">
            <button id="font-down" type="button" aria-label="Riduci carattere">A−</button>
            <span id="font-size-label">${preferences.fontSize}px</span>
            <button id="font-up" type="button" aria-label="Ingrandisci carattere">A+</button>
          </div>
          <label class="theme-control" for="reader-theme">
            <span>Tema</span>
            <select id="reader-theme" aria-label="Tema di lettura">
              <option value="light"${preferences.theme === 'light' ? ' selected' : ''}>Chiaro</option>
              <option value="sepia"${preferences.theme === 'sepia' ? ' selected' : ''}>Seppia</option>
              <option value="dark"${preferences.theme === 'dark' ? ' selected' : ''}>Scuro</option>
            </select>
          </label>
        </div>
      </div>
      <p id="reader-status" class="reader-status" role="status" aria-live="polite">Caricamento dell’EPUB…</p>
      <section class="reader-view" aria-label="Pagina del libro">
        <div id="epub-stage" class="epub-stage"></div>
      </section>
      <footer class="reader-footer">
        <span id="reader-progress" class="reader-progress">0%</span>
      </footer>
    </main>`;
}

function registerThemes(rendition: Rendition): void {
  for (const [name, style] of Object.entries(READER_THEMES)) {
    rendition.themes.register(name, style);
  }
}

function renderToc(
  container: HTMLDivElement,
  items: NavItem[],
  onSelect: (href: string) => void,
): void {
  if (items.length === 0) {
    container.innerHTML = '<p>Questo libro non contiene un indice.</p>';
    return;
  }
  container.innerHTML = `<ul class="toc-list">${items.map((item) => renderTocItem(item)).join('')}</ul>`;
  container.querySelectorAll<HTMLButtonElement>('[data-toc-href]').forEach((button) => {
    button.addEventListener('click', () => {
      const href = button.dataset.tocHref;
      if (href) onSelect(href);
      container.closest('details')?.removeAttribute('open');
    });
  });
}

function renderTocItem(item: NavItem): string {
  const children = item.subitems?.length
    ? `<ul>${item.subitems.map(renderTocItem).join('')}</ul>`
    : '';
  return `<li><button type="button" data-toc-href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</button>${children}</li>`;
}

async function askToResume(
  app: HTMLDivElement,
  registerCancel: (cancel: () => void) => void,
): Promise<boolean> {
  return await new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'resume-overlay';
    overlay.innerHTML = `
      <section class="resume-dialog" role="dialog" aria-modal="true" aria-labelledby="resume-title">
        <h2 id="resume-title">Continua da dove eri su un altro dispositivo?</h2>
        <p>È stato trovato un progresso salvato su un altro dispositivo.</p>
        <div class="resume-actions">
          <button type="button" data-resume="yes">Sì</button>
          <button type="button" class="secondary" data-resume="no">No</button>
        </div>
      </section>`;
    const finish = (resume: boolean): void => {
      overlay.remove();
      resolve(resume);
    };
    overlay.querySelector<HTMLButtonElement>('[data-resume="yes"]')?.addEventListener('click', () => finish(true));
    overlay.querySelector<HTMLButtonElement>('[data-resume="no"]')?.addEventListener('click', () => {
      finish(false);
    });
    registerCancel(() => finish(false));
    app.append(overlay);
    overlay.querySelector<HTMLButtonElement>('[data-resume="yes"]')?.focus();
  });
}

function enableIframeGestures(
  contents: Contents,
  previous: () => void,
  next: () => void,
  toggleControls: () => void,
): void {
  const document = contents.document;
  const root = document.documentElement;
  root.style.touchAction = 'pan-y';
  document.body.style.touchAction = 'pan-y';
  blockZoom(document);
  wirePageGestures(document, previous, next, toggleControls);
}

function enableReaderGestures(
  shell: HTMLElement,
  stage: HTMLElement,
  previous: () => void,
  next: () => void,
  toggleControls: () => void,
): void {
  shell.style.touchAction = 'pan-y';
  stage.style.touchAction = 'pan-y';
  blockZoom(document);
  wirePageGestures(document, previous, next, toggleControls);
}

function blockZoom(target: Document): void {
  for (const eventName of ['gesturestart', 'gesturechange', 'gestureend']) {
    target.addEventListener(eventName, (event) => event.preventDefault(), { passive: false });
    target.defaultView?.addEventListener(eventName, (event) => event.preventDefault(), { passive: false });
  }
  target.addEventListener('touchstart', (event) => {
    if (event.touches.length > 1) event.preventDefault();
  }, { passive: false });
  target.addEventListener('touchmove', (event) => {
    if (event.touches.length > 1) event.preventDefault();
  }, { passive: false });
}

function wirePageGestures(
  target: Document,
  previous: () => void,
  next: () => void,
  toggleControls: () => void,
): void {
  let touchStart: { x: number; y: number; time: number; target: EventTarget | null } | null = null;
  target.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) {
      touchStart = null;
      return;
    }
    const touch = event.touches[0];
    touchStart = { x: touch.clientX, y: touch.clientY, time: Date.now(), target: event.target };
  }, { passive: true });
  target.addEventListener('touchend', (event) => {
    if (!touchStart || event.changedTouches.length !== 1) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStart.x;
    const deltaY = touch.clientY - touchStart.y;
    const elapsed = Date.now() - touchStart.time;
    const distance = Math.abs(deltaX);
    const moved = Math.hypot(deltaX, deltaY);
    if (elapsed < 700 && distance > 56 && distance > Math.abs(deltaY) * 1.5) {
      if (deltaX > 0) previous();
      else next();
      touchStart = null;
      return;
    }
    if (elapsed < 350 && moved < 14 && !isControlTarget(touchStart.target)) {
      const bounds = target.documentElement.getBoundingClientRect();
      const x = touch.clientX;
      if (x < bounds.width / 3) previous();
      else if (x > bounds.width * 2 / 3) next();
      else toggleControls();
    }
    touchStart = null;
  }, { passive: true });
}

function isControlTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('button, select, summary, a, input, textarea, .reader-controls'));
}

function applyStatusBarTheme(theme: ReaderTheme): void {
  const themeColors: Record<ReaderTheme, string> = {
    light: '#fffefa',
    sepia: '#f4ecd8',
    dark: '#202629',
  };
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) themeColor.content = themeColors[theme];
  const statusBar = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (statusBar) statusBar.content = theme === 'dark' ? 'black-translucent' : 'default';
}

function escapeHtml(value: string): string {
  const element = document.createElement('span');
  element.textContent = value;
  return element.innerHTML;
}

