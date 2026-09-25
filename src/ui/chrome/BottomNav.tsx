/**
 * The floating bottom navigation: Mission, QR, Profile.
 *
 * These do not navigate. Each one toggles an overlay over the map, which is
 * why they carry `aria-expanded` rather than behaving like links — pressing
 * the same button twice returns the guest to the map.
 */

import { Compass, QrCode, User } from "lucide-react";

import { useOverlay, type OverlayId } from "../../state/overlay";

interface NavItemProps {
  id: OverlayId;
  label: string;
  icon: typeof Compass;
}

function NavItem({ id, label, icon: Icon }: NavItemProps) {
  const { toggle, isOpen } = useOverlay();
  const open = isOpen(id);

  return (
    <button
      type="button"
      className="nav-item"
      data-active={open}
      aria-label={`${label} panel`}
      aria-expanded={open}
      onClick={() => toggle(id)}
    >
      <Icon size={20} strokeWidth={open ? 2.4 : 2} aria-hidden="true" />
      <span className="nav-item__label">{label}</span>
    </button>
  );
}

export function BottomNav() {
  const { toggle, isOpen, bottomSheetOpen } = useOverlay();
  const qrOpen = isOpen("qr");

  return (
    <nav className="bottom-nav" data-inverted={bottomSheetOpen} aria-label="Primary">
      <div className="bottom-nav__bar">
        <NavItem id="mission" label="Mission" icon={Compass} />

        {/* The centre column is left empty; the QR action floats over it. */}
        <span aria-hidden="true" />

        <NavItem id="profile" label="Profile" icon={User} />

        <button
          type="button"
          className="qr-button"
          data-active={qrOpen}
          aria-label="Scan a QR code"
          aria-expanded={qrOpen}
          onClick={() => toggle("qr")}
        >
          <QrCode size={24} strokeWidth={2} aria-hidden="true" />
          <span className="qr-button__caption">Scan</span>
        </button>
      </div>
    </nav>
  );
}
