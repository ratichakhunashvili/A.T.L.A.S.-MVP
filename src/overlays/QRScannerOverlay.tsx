/**
 * The QR scanner — the product's primary gesture.
 *
 * One sentence, one frame, one way out. Scanning the hotel's code is what
 * turns a stranger into a guest, so this overlay stays deliberately empty of
 * everything else.
 *
 * Where the platform ships `BarcodeDetector` (Chrome and Edge, desktop and
 * Android) this decodes for real. Everywhere else the camera still opens and
 * the frame still works; only the decode step is missing, and
 * `detectFromVideo` is the single function a library such as zxing-wasm would
 * replace.
 */

import { Camera, Check, QrCode, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { CenterModal } from "../ui/sheets/Sheets";
import { STAY } from "../data/seed";

/* `BarcodeDetector` is not in the DOM lib yet. */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats: string[] }) => BarcodeDetectorLike;
  }
}

type ScannerState = "idle" | "starting" | "live" | "denied" | "unsupported" | "success";

const STATUS_COPY: Record<ScannerState, string> = {
  idle: "The code is on the card at reception, and inside your room door.",
  starting: "Opening the camera…",
  live: "Hold the code inside the frame.",
  denied: "Camera access was blocked. Allow it in your browser settings, or type the code from your key card.",
  unsupported: "This browser cannot open a camera here. Type the code from your key card instead.",
  success: "Guest Mode confirmed.",
};

interface QRScannerOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function QRScannerOverlay({ open, onClose }: QRScannerOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef(0);
  const [state, setState] = useState<ScannerState>("idle");
  const [code, setCode] = useState<string | null>(null);

  const stop = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  /** The seam a real decoder plugs into. */
  const detectFromVideo = useCallback(
    (detector: BarcodeDetectorLike) => {
      let lastRun = 0;

      const tick = (time: number) => {
        frameRef.current = requestAnimationFrame(tick);
        const video = videoRef.current;
        if (!video || video.readyState < 2) return;

        // Six samples a second is plenty, and leaves the phone's GPU alone.
        if (time - lastRun < 160) return;
        lastRun = time;

        void detector
          .detect(video)
          .then((results) => {
            if (results.length === 0) return;
            setCode(results[0].rawValue);
            setState("success");
            stop();
          })
          .catch(() => {
            /* a dropped frame is not worth reporting */
          });
      };

      frameRef.current = requestAnimationFrame(tick);
    },
    [stop],
  );

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return;
    }

    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      setState("live");

      if (window.BarcodeDetector) {
        detectFromVideo(new window.BarcodeDetector({ formats: ["qr_code"] }));
      }
    } catch {
      setState("denied");
    }
  }, [detectFromVideo]);

  // The modal unmounts on close, so this covers both close and navigation.
  useEffect(() => stop, [stop]);

  return (
    <CenterModal open={open} onClose={onClose} label="Scan a QR code">
      <div className="qr">
        <div className="qr__head">
          <div style={{ flex: 1 }}>
            <p className="qr__title">Scan QR code</p>
            <p className="qr__lede">
              Scan the QR code at your hotel to unlock your {STAY.hotelName} experience.
            </p>
          </div>
          <button type="button" className="sheet__close" onClick={onClose} aria-label="Close scanner">
            <X size={16} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>

        <div className="qr__stage">
          <video
            ref={videoRef}
            className="qr__video"
            playsInline
            muted
            aria-hidden="true"
            style={{ opacity: state === "live" ? 1 : 0 }}
          />

          {state === "success" ? (
            <div className="qr__hint" style={{ inset: 0, alignContent: "center" }}>
              <span
                className="chat__avatar"
                style={{ width: 52, height: 52, background: "var(--yellow)", color: "var(--accent-ink)" }}
              >
                <Check size={26} strokeWidth={3} aria-hidden="true" />
              </span>
              <p className="qr__hint-text" style={{ color: "var(--ivory)" }}>
                {code}
              </p>
            </div>
          ) : (
            <>
              <div className="qr__frame" aria-hidden="true">
                <span className="qr__corner qr__corner--tl" />
                <span className="qr__corner qr__corner--tr" />
                <span className="qr__corner qr__corner--bl" />
                <span className="qr__corner qr__corner--br" />
                <span className="qr__scanline" />
              </div>

              {state !== "live" ? (
                <div className="qr__hint">
                  <QrCode size={30} strokeWidth={1.4} color="var(--ivory-34)" aria-hidden="true" />
                  <p className="qr__hint-text">
                    {state === "starting" ? "Opening the camera…" : "Camera is off"}
                  </p>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="qr__footer">
          <p
            className="qr__status"
            data-tone={state === "denied" || state === "unsupported" ? "error" : undefined}
            role="status"
          >
            {STATUS_COPY[state]}
          </p>

          {state === "success" ? (
            <button type="button" className="btn btn--sm btn--accent" onClick={onClose}>
              Done
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--sm"
              onClick={
                state === "live"
                  ? () => {
                      stop();
                      setState("idle");
                    }
                  : start
              }
              disabled={state === "starting" || state === "unsupported"}
            >
              <Camera size={14} strokeWidth={2.2} aria-hidden="true" />
              {state === "live" ? "Stop" : "Start camera"}
            </button>
          )}
        </div>
      </div>
    </CenterModal>
  );
}
