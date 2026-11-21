const DATABASE_NAME = 'mundaneum-reader-epubs';
const STORE_NAME = 'books';
const DATABASE_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('La cache locale non è disponibile su questo dispositivo.'));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Non è stato possibile aprire la cache EPUB.'));
    request.onblocked = () => reject(new Error('La cache EPUB è occupata da un’altra scheda.'));
  });
}

export async function getCachedEpub(fileId: string): Promise<ArrayBuffer | null> {
  const database = await openDatabase();
  return await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(fileId) as IDBRequest<ArrayBuffer | undefined>;
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(new Error('Non è stato possibile leggere la cache EPUB.'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(new Error('Non è stato possibile leggere la cache EPUB.'));
    };
  });
}

export async function cacheEpub(fileId: string, contents: ArrayBuffer): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(contents, fileId);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(new Error('Non è stato possibile salvare l’EPUB nella cache.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(new Error('Il salvataggio dell’EPUB nella cache è stato interrotto.'));
    };
  });
}
