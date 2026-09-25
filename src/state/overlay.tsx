/**
 * Overlay state.
 *
 * The whole product is one screen, so "navigation" is a single value: which
 * overlay is currently on top of the map. At most one is ever active, which is
 * what keeps z-index behaviour predictable — opening anything closes whatever
 * was open, and every panel reads its open state from here rather than owning
 * a boolean of its own.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** Long enough for a sheet to finish leaving. Matches --dur-panel. */
const EXIT_MS = 360;

export type OverlayId =
  | "notifications"
  | "chatbot"
  | "mission"
  | "profile"
  | "qr"
  /** Details for a tapped marker or 3D model. */
  | "place";

/** Panels that enter from the top edge. */
export const TOP_OVERLAYS: readonly OverlayId[] = ["notifications", "chatbot"];
/** Panels that enter from the bottom edge. */
export const BOTTOM_OVERLAYS: readonly OverlayId[] = ["mission", "profile", "place"];

/** What the details sheet is currently describing. */
export interface Selection {
  kind: "place" | "model";
  id: string;
}

interface OverlayContextValue {
  activeOverlay: OverlayId | null;
  selection: Selection | null;
  open: (id: OverlayId) => void;
  close: () => void;
  toggle: (id: OverlayId) => void;
  /** Opens the details sheet for a marker or model. */
  select: (selection: Selection) => void;
  isOpen: (id: OverlayId) => boolean;
  /** True while any bottom sheet is up — the nav inverts against it. */
  bottomSheetOpen: boolean;
}

const OverlayContext = createContext<OverlayContextValue | null>(null);

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [activeOverlay, setActiveOverlay] = useState<OverlayId | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const clearTimer = useRef<number | undefined>(undefined);

  const open = useCallback((id: OverlayId) => {
    window.clearTimeout(clearTimer.current);
    setActiveOverlay(id);
  }, []);

  const close = useCallback(() => setActiveOverlay(null), []);

  const toggle = useCallback((id: OverlayId) => {
    window.clearTimeout(clearTimer.current);
    setActiveOverlay((current) => (current === id ? null : id));
  }, []);

  const select = useCallback((next: Selection) => {
    window.clearTimeout(clearTimer.current);
    setSelection(next);
    setActiveOverlay("place");
  }, []);

  /**
   * Deselect once the details sheet has finished leaving, not while it is on
   * screen — otherwise the sheet empties mid-animation and the marker snaps
   * back before the panel has gone.
   */
  useEffect(() => {
    if (activeOverlay === "place" || !selection) return;
    clearTimer.current = window.setTimeout(() => setSelection(null), EXIT_MS);
    return () => window.clearTimeout(clearTimer.current);
  }, [activeOverlay, selection]);

  const value = useMemo<OverlayContextValue>(
    () => ({
      activeOverlay,
      selection,
      open,
      close,
      toggle,
      select,
      isOpen: (id) => activeOverlay === id,
      bottomSheetOpen: activeOverlay !== null && BOTTOM_OVERLAYS.includes(activeOverlay),
    }),
    [activeOverlay, selection, open, close, toggle, select],
  );

  return <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>;
}

export function useOverlay(): OverlayContextValue {
  const value = useContext(OverlayContext);
  if (!value) throw new Error("useOverlay must be used inside <OverlayProvider>");
  return value;
}
