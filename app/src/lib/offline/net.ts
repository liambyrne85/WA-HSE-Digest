/** True when an error means "no coverage" rather than "the server said no". */
export function isNetworkError(e: unknown) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /failed to fetch|networkerror|network error|load failed|network request failed|fetch failed|timed? ?out|ERR_INTERNET_DISCONNECTED/i.test(msg);
}
export const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
