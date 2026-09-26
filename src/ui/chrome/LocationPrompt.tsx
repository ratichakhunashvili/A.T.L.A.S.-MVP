/**
 * The in-app ask for location, and the explanation when it does not work.
 *
 * A browser permission dialog on its own gives no reason, so this explains
 * what the permission buys before the browser's prompt appears. It is a card,
 * not a sheet: no backdrop, nothing blocked, and the map stays usable behind
 * it whether the guest says yes, no, or nothing at all.
 *
 * Every outcome the browser can produce has copy here, because "denied",
 * "timed out" and "only accurate to 25 km" are all normal answers on a
 * desktop, and a product that goes quiet on any of them leaves the guest
 * staring at a map centred on somewhere they have never been.
 */

import { Compass, LocateFixed, MapPinned, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { useLocation } from "../../state/location";

interface LocationPromptProps {
  open: boolean;
  onClose: () => void;
  /** Frames a coarse fix, only ever on an explicit request. */
  onShowArea: () => void;
}

function metres(value: number): string {
  return value >= 1000 ? `${Math.round(value / 1000)} km` : `${Math.round(value)} m`;
}

export function LocationPrompt({ open, onClose, onShowArea }: LocationPromptProps) {
  const { status, quality, accuracy, errorCode, secureContext, request, dismiss } = useLocation();

  // A fix the product can stand behind closes the card. A coarse one does
  // not: the guest is owed an explanation of why the dot is where it is.
  const coarse = quality === "coarse";

  useEffect(() => {
    if (status === "granted" && !coarse && open) onClose();
  }, [status, coarse, open, onClose]);

  const blocked = status === "denied" || status === "unavailable";
  const timedOut = errorCode === "timeout" && !coarse;
  const busy = status === "locating";
  const warn = blocked || timedOut || coarse;

  const title = !secureContext
    ? "Location needs a secure connection"
    : blocked
      ? "Location is turned off"
      : coarse
        ? "Only an approximate location"
        : timedOut
          ? "Your browser could not get a location"
          : "Use your location";

  const body = !secureContext
    ? "Browsers only share a location over https, or on localhost. This page is being served insecurely, so the request cannot be made."
    : coarse && accuracy !== null
      ? `Your device could only place you within about ${metres(accuracy)}. That is a network estimate rather than your device, so it is not being used as your position.`
      : blocked
        ? "Location is blocked for this site. Turn it back on in your browser's site settings, then try again."
        : timedOut
          ? "The request timed out, which usually means device location services are switched off. On Windows: Settings → Privacy & security → Location."
          : "Allow location access to discover attractions and experiences near you.";

  return (
    <div
      className="location-prompt"
      data-open={open}
      aria-hidden={!open}
      /* Closed, it stays mounted for the transition but must not be reachable
         by tab or announced by a screen reader. */
      inert={!open}
      aria-live="polite"
    >
      {/*
       * A region, not a dialog: it is non-modal, traps nothing, and blocks
       * nothing. Calling it a dialog would both overstate it to assistive
       * technology and leave a permanent phantom dialog in the document.
       */}
      <div className="location-prompt__card" role="region" aria-label="Use your location">
        <span className="location-prompt__icon" data-tone={warn ? "warn" : "default"}>
          {warn ? (
            <TriangleAlert size={18} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Compass size={18} strokeWidth={2} aria-hidden="true" />
          )}
        </span>

        <div className="location-prompt__body">
          <p className="location-prompt__title">{title}</p>
          <p className="location-prompt__text">{body}</p>
        </div>

        <div className="location-prompt__actions">
          {blocked || !secureContext ? (
            <button type="button" className="btn btn--sm btn--ghost" onClick={onClose}>
              Close
            </button>
          ) : coarse ? (
            <>
              {/* Never moved to automatically — only ever offered. */}
              <button type="button" className="btn btn--sm btn--ghost" onClick={onShowArea}>
                <MapPinned size={13} strokeWidth={2.4} aria-hidden="true" />
                Show that area
              </button>
              <button
                type="button"
                className="btn btn--sm"
                disabled={busy}
                onClick={() => request()}
              >
                <LocateFixed size={13} strokeWidth={2.4} aria-hidden="true" />
                {busy ? "Locating…" : "Try again"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => {
                  dismiss();
                  onClose();
                }}
              >
                Not now
              </button>
              <button
                type="button"
                className="btn btn--sm"
                disabled={busy}
                onClick={() => request()}
              >
                <LocateFixed size={13} strokeWidth={2.4} aria-hidden="true" />
                {busy ? "Locating…" : timedOut ? "Try again" : "Allow"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
