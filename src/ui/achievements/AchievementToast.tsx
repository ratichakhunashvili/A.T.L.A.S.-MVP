/**
 * The unlock notification.
 *
 * Slides down from the top edge over whatever is on screen, stays a few
 * seconds, and leaves on its own. It sits above the overlay stack because an
 * unlock can land while a sheet is open, and it is the one thing that should
 * not wait its turn.
 *
 * It appears only for a *new* unlock. Scanning somewhere you have already been
 * shows nothing at all — the provider never queues a repeat.
 */

import { Trophy, X } from "lucide-react";
import { useRef } from "react";

import { Sticker } from "./Sticker";
import { useAchievements } from "../../state/achievements";
import { usePresence } from "../sheets/hooks";

/** Must match the transition on .ach-toast. */
const EXIT_MS = 340;

export function AchievementToast() {
  const { notice, dismissNotice } = useAchievements();
  const { mounted, active } = usePresence(notice !== null, EXIT_MS);

  // Kept mounted through the exit so the panel animates out rather than
  // vanishing; the content is held over from the last notice while it leaves.
  const shown = useLastNonNull(notice);
  if (!mounted || !shown) return null;

  return (
    <div className="ach-toast" data-active={active} role="status" aria-live="polite">
      <Sticker achievement={shown.achievement} size={52} />

      <div className="ach-toast__body">
        <p className="ach-toast__eyebrow">
          <Trophy size={11} strokeWidth={2.6} aria-hidden="true" />
          Achievement unlocked
        </p>
        <p className="ach-toast__title">{shown.achievement.name}</p>
        <p className="ach-toast__where">Completed at {shown.attraction.name}</p>
      </div>

      <button
        type="button"
        className="ach-toast__close"
        onClick={dismissNotice}
        aria-label="Dismiss"
      >
        <X size={15} strokeWidth={2.4} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Holds the last non-null value.
 *
 * The notice is cleared the moment it is dismissed, but the panel needs its
 * content for the length of the exit animation.
 */
function useLastNonNull<T>(value: T | null): T | null {
  const held = useRef<T | null>(null);
  if (value !== null) held.current = value;
  return value ?? held.current;
}
