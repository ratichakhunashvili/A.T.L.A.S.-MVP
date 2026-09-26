/**
 * Routing, such as it is.
 *
 * The guest experience remains one screen with overlays — that has not
 * changed. What has changed is that printed QR codes have to point at real,
 * shareable URLs, and `#/admin` was never that. So the application now
 * recognises exactly four surfaces:
 *
 *   /join/hotel/:token          onboarding, reached by scanning at reception
 *   /scan/attraction/:id        an attraction's code, reached by scanning there
 *   /admin  (or #/admin)        the operator console
 *   everything else             the guest map
 *
 * No router library: three shapes do not need one, and adding one would mean
 * restructuring an application whose whole architecture is "no routes".
 */

export type Route =
  | { name: "map" }
  | { name: "join"; token: string }
  /** An attraction's printed code. Unlocks its achievement, then the map. */
  | { name: "scan"; attractionId: string }
  | { name: "admin" };

const JOIN_PATTERN = /^\/join\/hotel\/([A-Za-z0-9_-]{6,64})\/?$/;
const SCAN_PATTERN = /^\/scan\/attraction\/([A-Za-z0-9_-]{3,64})\/?$/;

/** Reads the current URL. Hash `#/admin` is kept working for old bookmarks. */
export function readRoute(
  pathname = window.location.pathname,
  hash = window.location.hash,
): Route {
  if (hash.startsWith("#/admin")) return { name: "admin" };
  if (/^\/admin\/?$/.test(pathname)) return { name: "admin" };

  const join = JOIN_PATTERN.exec(pathname);
  if (join) return { name: "join", token: join[1].toUpperCase() };

  // Attraction ids are case-sensitive, unlike hotel tokens: they come from the
  // database rather than from someone reading a card aloud.
  const scan = SCAN_PATTERN.exec(pathname);
  if (scan) return { name: "scan", attractionId: scan[1] };

  return { name: "map" };
}

/** Navigates without a reload, and tells the app to re-read the URL. */
export function navigate(path: string, options: { replace?: boolean } = {}): void {
  const method = options.replace ? "replaceState" : "pushState";
  window.history[method](null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Subscribes to every navigation the app can produce. */
export function subscribeToRoute(listener: () => void): () => void {
  window.addEventListener("popstate", listener);
  window.addEventListener("hashchange", listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener("hashchange", listener);
  };
}
