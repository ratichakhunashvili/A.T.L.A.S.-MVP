/**
 * Behaviour shared by every overlay: how it enters and leaves, how it handles
 * the keyboard, and how a bottom sheet follows a thumb.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keeps a panel mounted through its exit animation.
 *
 * `mounted` says whether to render at all; `active` drives the open class.
 * Two animation frames separate them on the way in, because the browser has to
 * paint the closed state once before it will animate away from it.
 */
export function usePresence(open: boolean, duration: number) {
  const [mounted, setMounted] = useState(open);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setActive(true));
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }

    setActive(false);
    const timer = window.setTimeout(() => setMounted(false), duration);
    return () => window.clearTimeout(timer);
  }, [open, duration]);

  return { mounted, active };
}

/** Escape closes the topmost overlay. */
export function useEscapeKey(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onEscape();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [active, onEscape]);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Moves focus into the panel, keeps Tab inside it, and hands focus back to
 * whatever opened it on close.
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  active: boolean,
) {
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;

    restoreRef.current = document.activeElement as HTMLElement | null;

    // Focus the dialog itself rather than its first control: a screen reader
    // announces the panel, Tab still lands on the first control, and a touch
    // user is not met with a focus ring around a button they did not press.
    const focusTimer = window.setTimeout(() => {
      container.focus({ preventScroll: true });
    }, 60);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;

      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null,
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;

      if (event.shiftKey && (current === first || current === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      container.removeEventListener("keydown", onKeyDown);
      restoreRef.current?.focus({ preventScroll: true });
    };
  }, [active, containerRef]);
}

/* ------------------------------------------------------------------------ */
/* Drag to dismiss                                                           */
/* ------------------------------------------------------------------------ */

const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 0.6; // px per ms

/**
 * Lets a bottom sheet follow the thumb and fall away when it is thrown down.
 *
 * The transform is written straight to the node during the gesture — routing
 * sixty pointer events a second through React state would drop frames on the
 * devices this matters most on.
 */
export function useDragToDismiss(
  sheetRef: React.RefObject<HTMLElement | null>,
  onDismiss: () => void,
) {
  const stateRef = useRef({ dragging: false, startY: 0, lastY: 0, lastT: 0, delta: 0 });

  const settle = useCallback(
    (dismiss: boolean) => {
      const sheet = sheetRef.current;
      if (!sheet) return;

      sheet.style.transition = "";
      sheet.style.transform = "";
      sheet.removeAttribute("data-dragging");
      if (dismiss) onDismiss();
    },
    [onDismiss, sheetRef],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Ignore secondary buttons and anything starting on an interactive child.
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest("button, a, input, textarea")) return;

      const sheet = sheetRef.current;
      if (!sheet) return;

      stateRef.current = {
        dragging: true,
        startY: event.clientY,
        lastY: event.clientY,
        lastT: event.timeStamp,
        delta: 0,
      };
      sheet.setAttribute("data-dragging", "true");
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    },
    [sheetRef],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const state = stateRef.current;
      const sheet = sheetRef.current;
      if (!state.dragging || !sheet) return;

      const delta = event.clientY - state.startY;
      // Upward drag is resisted rather than blocked, which feels like rubber.
      const applied = delta < 0 ? delta / 4 : delta;

      state.delta = applied;
      state.lastY = event.clientY;
      state.lastT = event.timeStamp;

      sheet.style.transition = "none";
      sheet.style.transform = `translate3d(0, ${applied}px, 0)`;
    },
    [sheetRef],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const state = stateRef.current;
      if (!state.dragging) return;
      state.dragging = false;

      const elapsed = Math.max(event.timeStamp - state.lastT, 1);
      const velocity = (event.clientY - state.lastY) / elapsed;

      settle(state.delta > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY);
    },
    [settle],
  );

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
}
