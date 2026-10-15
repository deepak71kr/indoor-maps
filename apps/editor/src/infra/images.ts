/**
 * Floor-plan images live in the browser (IndexedDB), NOT in the map file: visitors never
 * download them. A floor's `image` field holds a reference like `img-k3f9-ground.png`.
 */
const DB = 'im-editor';
const STORE = 'images';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = fn(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

/** Saves the file and returns the reference to put in `level.image`. */
export async function saveImage(file: File): Promise<string> {
  const safeName = file.name.replace(/[^\w.-]+/g, '-').slice(-40);
  const ref = `img-${Date.now().toString(36)}-${safeName}`;
  await run('readwrite', (store) => store.put(file, ref));
  return ref;
}

export interface LoadedImage {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

const loaded = new Map<string, Promise<LoadedImage | null>>();

/** Object URL + pixel size for a reference (cached; null if missing). */
export function loadImage(ref: string): Promise<LoadedImage | null> {
  let promise = loaded.get(ref);
  if (!promise) {
    promise = run<Blob | undefined>('readonly', (store) => store.get(ref))
      .then(async (blob) => {
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.src = url;
        await img.decode();
        return { url, width: img.naturalWidth, height: img.naturalHeight };
      })
      .catch(() => null);
    loaded.set(ref, promise);
  }
  return promise;
}
