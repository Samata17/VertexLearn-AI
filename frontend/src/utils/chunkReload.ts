/**
 * Every deploy gives the page files (JS "chunks") new names. A tab that was opened before the deploy
 * still asks for the old names, which no longer exist — "Failed to fetch dynamically imported module".
 * The cure is loading the new version of the app, so we reload the page once, automatically.
 * A short guard stops a reload loop if the file is missing for some other reason (e.g. offline).
 */
const KEY = 'vl-chunk-reload';
const GUARD_MS = 10_000;

export const isChunkError = (err: unknown) =>
  /dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload CSS/i
    .test(String((err as Error)?.message ?? err));

/** Reloads the page once. Returns false if we already reloaded moments ago (so the caller should show an error). */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < GUARD_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* storage blocked: still try once */ }
  window.location.reload();
  return true;
}

/** Wraps a lazy import: on a stale-chunk error, reload instead of crashing. */
export function importWithReload<T>(factory: () => Promise<T>): Promise<T> {
  return factory().catch((err) => {
    if (isChunkError(err) && reloadForNewVersion()) return new Promise<T>(() => {}); // page is reloading
    throw err;
  });
}
