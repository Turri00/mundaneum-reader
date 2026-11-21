export type ReaderTheme = 'light' | 'sepia' | 'dark';

export interface ReaderPreferences {
  theme: ReaderTheme;
  fontSize: number;
}

const PREFERENCES_KEY = 'mundaneum-reader-preferences';
const DEVICE_ID_KEY = 'mundaneum-reader-device-id';
const PROGRESS_SEEN_KEY = 'mundaneum-reader-progress-seen:';
const DEFAULT_PREFERENCES: ReaderPreferences = { theme: 'light', fontSize: 18 };

export function loadReaderPreferences(): ReaderPreferences {
  try {
    const saved = localStorage.getItem(PREFERENCES_KEY);
    if (!saved) return { ...DEFAULT_PREFERENCES };
    const parsed: unknown = JSON.parse(saved);
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_PREFERENCES };
    const candidate = parsed as Partial<ReaderPreferences>;
    return {
      theme: candidate.theme === 'sepia' || candidate.theme === 'dark' ? candidate.theme : 'light',
      fontSize: typeof candidate.fontSize === 'number' && Number.isFinite(candidate.fontSize)
        ? Math.max(14, Math.min(30, candidate.fontSize))
        : DEFAULT_PREFERENCES.fontSize,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function saveReaderPreferences(preferences: ReaderPreferences): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Reader controls remain usable if Safari storage is unavailable.
  }
}

export function getDeviceId(): string {
  try {
    const savedId = localStorage.getItem(DEVICE_ID_KEY);
    if (savedId) return savedId;
  } catch {
    return createDeviceId();
  }

  const deviceId = createDeviceId();
  try {
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  } catch {
    // The id lasts for the current session if Safari storage is unavailable.
  }
  return deviceId;
}

export function getProgressSeenAt(bookId: string): string | null {
  try {
    return localStorage.getItem(`${PROGRESS_SEEN_KEY}${bookId}`);
  } catch {
    return null;
  }
}

export function markProgressSeen(bookId: string, updatedAt: string): void {
  try {
    localStorage.setItem(`${PROGRESS_SEEN_KEY}${bookId}`, updatedAt);
  } catch {
    // The remote progress remains authoritative if Safari storage is unavailable.
  }
}

function createDeviceId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
