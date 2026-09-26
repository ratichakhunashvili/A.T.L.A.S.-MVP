/**
 * A printable QR code for anything that has a link.
 *
 * Hotels and attractions both need the same five actions — preview, copy,
 * download PNG, download SVG, print — and neither needs its own
 * implementation of them. The only difference is what the link points at.
 *
 * Print opens a sheet with the code, the name and a line of instruction,
 * sized for a card on a desk or a sign by a door.
 */

import { Check, Copy, Download, Loader2, Printer, RefreshCw } from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";

/** Big enough that a laser printer and a phone camera both cope. */
const PRINT_PIXELS = 1024;

const QR_OPTIONS = {
  errorCorrectionLevel: "M" as const,
  margin: 2,
  color: {
    // The product's navy on its control surface. A printed code is a piece of
    // the product, not a black-and-white afterthought.
    dark: "#00355E",
    light: "#FFFDF3",
  },
};

interface QRCardProps {
  /** What the code encodes. */
  url: string;
  /** Shown beside the code and used for the download filename. */
  name: string;
  /** One line under the name on the printed card. */
  instruction: string;
  /** Rendered between the link and the actions — scan counts, for example. */
  children?: React.ReactNode;
  onRegenerate?: () => void;
  regenerateLabel?: string;
}

export function QRCard({
  url,
  name,
  instruction,
  children,
  onRegenerate,
  regenerateLabel = "Regenerate",
}: QRCardProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(url, { ...QR_OPTIONS, width: 512 }).then((data) => {
      if (!cancelled) setPreview(data);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const download = useCallback(
    async (format: "png" | "svg") => {
      const blob =
        format === "png"
          ? await (
              await fetch(await QRCode.toDataURL(url, { ...QR_OPTIONS, width: PRINT_PIXELS }))
            ).blob()
          : new Blob([await QRCode.toString(url, { ...QR_OPTIONS, type: "svg" })], {
              type: "image/svg+xml",
            });

      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `${slug(name)}-qr.${format}`;
      anchor.click();
      URL.revokeObjectURL(href);
    },
    [name, url],
  );

  /**
   * Prints via a detached iframe rather than a popup.
   *
   * A popup is blocked by default in most browsers, and an admin pressing
   * Print should get a print dialog, not a blocked-popup notice.
   */
  const print = useCallback(async () => {
    const image = await QRCode.toDataURL(url, { ...QR_OPTIONS, width: PRINT_PIXELS });

    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(frame);

    const doc = frame.contentDocument;
    if (!doc) {
      frame.remove();
      return;
    }

    doc.open();
    doc.write(`<!doctype html><html><head><title>${escapeHtml(name)}</title><style>
      @page { margin: 18mm; }
      body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
             color: #00355E; text-align: center; }
      .card { display: flex; flex-direction: column; align-items: center; gap: 14px;
              padding: 24px; }
      img { width: 76mm; height: 76mm; image-rendering: pixelated; }
      h1 { margin: 0; font-size: 22pt; letter-spacing: -0.02em; }
      p  { margin: 0; font-size: 12pt; color: #506A67; max-width: 90mm; line-height: 1.4; }
    </style></head><body><div class="card">
      <img src="${image}" alt="">
      <h1>${escapeHtml(name)}</h1>
      <p>${escapeHtml(instruction)}</p>
    </div></body></html>`);
    doc.close();

    const run = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      // Left long enough for the dialog to take its own copy of the document.
      window.setTimeout(() => frame.remove(), 1000);
    };

    if (frame.contentWindow?.document.readyState === "complete") run();
    else frame.onload = run;
  }, [name, url]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be refused; the link is on screen and selectable.
    }
  }

  return (
    <>
      <div className="hp__qr-card">
        <div className="hp__qr-art">
          {preview ? (
            <img src={preview} alt={`QR code for ${name}`} className="hp__qr-image" />
          ) : (
            <Loader2 size={24} className="day__spin" aria-hidden="true" />
          )}
        </div>

        <div className="hp__qr-side">
          <p className="eyebrow">Scan link</p>
          <code className="hp__link">{url}</code>
          {children}
        </div>
      </div>

      <div className="hp__actions">
        <button type="button" className="btn btn--sm" onClick={() => void copyLink()}>
          {copied ? (
            <Check size={14} strokeWidth={2.6} aria-hidden="true" />
          ) : (
            <Copy size={14} strokeWidth={2.2} aria-hidden="true" />
          )}
          {copied ? "Copied" : "Copy link"}
        </button>

        <button type="button" className="btn btn--sm btn--ghost" onClick={() => void download("png")}>
          <Download size={14} strokeWidth={2.2} aria-hidden="true" />
          PNG
        </button>

        <button type="button" className="btn btn--sm btn--ghost" onClick={() => void download("svg")}>
          <Download size={14} strokeWidth={2.2} aria-hidden="true" />
          SVG
        </button>

        <button type="button" className="btn btn--sm btn--ghost" onClick={() => void print()}>
          <Printer size={14} strokeWidth={2.2} aria-hidden="true" />
          Print
        </button>

        {onRegenerate ? (
          <button type="button" className="btn btn--sm btn--danger" onClick={onRegenerate}>
            <RefreshCw size={14} strokeWidth={2.2} aria-hidden="true" />
            {regenerateLabel}
          </button>
        ) : null}
      </div>
    </>
  );
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "code";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );
}
