/**
 * Destructive actions ask first. Nothing in the admin deletes on one tap.
 */

import { CenterModal } from "../ui/sheets/Sheets";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <CenterModal open={open} onClose={onCancel} label={title}>
      <div className="confirm">
        <h2 className="confirm__title">{title}</h2>
        <p className="confirm__body">{body}</p>
        <div className="confirm__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn--danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </CenterModal>
  );
}
