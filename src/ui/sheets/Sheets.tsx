/**
 * The three overlay containers.
 *
 * Top sheets fall from behind the header, bottom sheets rise from the bottom
 * edge, and the QR modal scales up in the centre. They share presence,
 * dismissal and focus behaviour so every overlay in the product opens, closes
 * and reads to a screen reader the same way.
 */

import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";

import { useDragToDismiss, useEscapeKey, useFocusTrap, usePresence } from "./hooks";

/** Must match --dur-panel in sheets.css. */
const PANEL_MS = 340;

interface BackdropProps {
  active: boolean;
  onClick: () => void;
}

function Backdrop({ active, onClick }: BackdropProps) {
  return (
    <button
      type="button"
      className="backdrop"
      data-active={active}
      aria-label="Close"
      tabIndex={-1}
      onClick={onClick}
    />
  );
}

interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. */
  label: string;
  children: ReactNode;
}

export function TopSheet({ open, onClose, label, children }: SheetProps) {
  const sheetRef = useRef<HTMLElement>(null);
  const { mounted, active } = usePresence(open, PANEL_MS);

  useEscapeKey(open, onClose);
  useFocusTrap(sheetRef, open);

  if (!mounted) return null;

  return (
    <>
      <Backdrop active={active} onClick={onClose} />
      <div className="sheet-viewport sheet-viewport--top">
        <section
          ref={sheetRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className="sheet sheet--top"
          data-active={active}
        >
          {children}
        </section>
      </div>
    </>
  );
}

export function BottomSheet({ open, onClose, label, children }: SheetProps) {
  const sheetRef = useRef<HTMLElement>(null);
  const { mounted, active } = usePresence(open, PANEL_MS);
  const drag = useDragToDismiss(sheetRef, onClose);

  useEscapeKey(open, onClose);
  useFocusTrap(sheetRef, open);

  if (!mounted) return null;

  return (
    <>
      <Backdrop active={active} onClick={onClose} />
      <div className="sheet-viewport sheet-viewport--bottom">
        <section
          ref={sheetRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className="sheet sheet--bottom"
          data-active={active}
        >
          {/* Drag starts on the handle and the header, never on the body —
              so a downward flick inside a scrolling list still scrolls. */}
          <div className="sheet__grabber" {...drag} aria-hidden="true">
            <span className="sheet__handle" />
          </div>
          {children}
        </section>
      </div>
    </>
  );
}

export function CenterModal({ open, onClose, label, children }: SheetProps) {
  const modalRef = useRef<HTMLElement>(null);
  const { mounted, active } = usePresence(open, PANEL_MS);

  useEscapeKey(open, onClose);
  useFocusTrap(modalRef, open);

  if (!mounted) return null;

  return (
    <>
      <Backdrop active={active} onClick={onClose} />
      <div className="modal-viewport">
        <section
          ref={modalRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className="modal"
          data-active={active}
        >
          {children}
        </section>
      </div>
    </>
  );
}

interface SheetHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  onClose?: () => void;
  /** Rendered in place of the close button — e.g. a filter or an action. */
  action?: ReactNode;
}

export function SheetHeader({ eyebrow, title, subtitle, onClose, action }: SheetHeaderProps) {
  return (
    <header className="sheet__header">
      <div className="sheet__titles">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2 className="sheet__title">{title}</h2>
        {subtitle ? <p className="sheet__subtitle">{subtitle}</p> : null}
      </div>
      {action}
      {onClose ? (
        <button type="button" className="sheet__close" onClick={onClose} aria-label="Close panel">
          <X size={16} strokeWidth={2.4} aria-hidden="true" />
        </button>
      ) : null}
    </header>
  );
}
