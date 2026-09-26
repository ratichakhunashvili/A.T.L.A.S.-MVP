/**
 * Reading the guest's booking.
 *
 * Camera first, because a QR on a confirmation is the one path that is exact.
 * Upload second, for a screenshot or a forwarded email. Manual entry is always
 * one tap away and is never presented as a failure — it is frequently the
 * fastest route and is offered as such.
 *
 * Nothing the guest hands over is uploaded or stored. The file is read in the
 * browser; only extracted text is ever sent anywhere, and only when the local
 * parser could not manage on its own.
 */

import { Camera, FileUp, Keyboard, Loader2, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { parseQRPayload, parseReservationFile } from "./reservationParse";
import type { ParsedReservation } from "../data/domain";

type State = "idle" | "starting" | "live" | "reading" | "denied" | "unsupported" | "failed";

interface ReservationScannerProps {
  onParsed: (result: ParsedReservation, source: "scan" | "upload") => void;
  onManual: () => void;
}

export function ReservationScanner({ onParsed, onManual }: ReservationScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef(0);
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const stop = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  /** Samples the video for a QR six times a second. */
  const scanLoop = useCallback(
    (detector: BarcodeDetectorLike) => {
      let lastRun = 0;

      const tick = (time: number) => {
        frameRef.current = requestAnimationFrame(tick);
        const video = videoRef.current;
        if (!video || video.readyState < 2) return;
        if (time - lastRun < 160) return;
        lastRun = time;

        void detector
          .detect(video)
          .then((results) => {
            if (results.length === 0) return;
            const parsed = parseQRPayload(results[0].rawValue);
            if (!parsed || parsed.fields.length === 0) {
              // A QR that is not a booking — a wifi code, a menu. Keep looking
              // rather than claiming the reservation could not be read.
              return;
            }
            stop();
            onParsed(parsed, "scan");
          })
          .catch(() => undefined);
      };

      frameRef.current = requestAnimationFrame(tick);
    },
    [onParsed, stop],
  );

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.BarcodeDetector) {
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
      scanLoop(new window.BarcodeDetector({ formats: ["qr_code"] }));
    } catch {
      setState("denied");
    }
  }, [scanLoop]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    stop();
    setState("reading");
    setMessage(null);

    const outcome = await parseReservationFile(file);
    if (outcome.status === "parsed") {
      onParsed(outcome.result, "upload");
      return;
    }

    setState("failed");
    setMessage(outcome.reason);
  }

  return (
    <section className="join__card">
      <h1 className="join__title">Scan your booking</h1>
      <p className="join__body">
        If your confirmation has a QR code, point the camera at it. Otherwise upload a screenshot.
      </p>

      <div className="join__scanner">
        <video
          ref={videoRef}
          className="join__video"
          playsInline
          muted
          aria-hidden="true"
          style={{ opacity: state === "live" ? 1 : 0 }}
        />

        {state === "live" ? (
          <div className="join__frame" aria-hidden="true">
            <span className="join__corner join__corner--tl" />
            <span className="join__corner join__corner--tr" />
            <span className="join__corner join__corner--bl" />
            <span className="join__corner join__corner--br" />
          </div>
        ) : (
          <div className="join__scanner-idle">
            {state === "reading" || state === "starting" ? (
              <Loader2 className="join__spinner" size={26} aria-hidden="true" />
            ) : (
              <Camera size={26} strokeWidth={1.6} aria-hidden="true" />
            )}
            <p className="join__scanner-text">
              {state === "starting"
                ? "Opening the camera…"
                : state === "reading"
                  ? "Reading your booking…"
                  : state === "denied"
                    ? "Camera access was blocked"
                    : state === "unsupported"
                      ? "This browser can't scan here"
                      : "Camera is off"}
            </p>
          </div>
        )}
      </div>

      {message ? (
        <p className="field__error" role="alert">
          {message}
        </p>
      ) : null}

      <div className="join__scan-actions">
        {state === "live" ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              stop();
              setState("idle");
            }}
          >
            <X size={14} aria-hidden="true" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => void start()}
            disabled={state === "starting" || state === "reading" || state === "unsupported"}
          >
            <Camera size={14} strokeWidth={2.2} aria-hidden="true" />
            Start camera
          </button>
        )}

        <label className="btn btn--ghost btn--sm join__upload">
          <FileUp size={14} strokeWidth={2.2} aria-hidden="true" />
          Upload
          <input
            type="file"
            accept="image/*,application/pdf,text/plain,.eml,.ics"
            className="visually-hidden"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </label>
      </div>

      <p className="join__privacy">
        <ShieldCheck size={13} strokeWidth={2.2} aria-hidden="true" />
        Your booking is read on this device. We keep only your dates.
      </p>

      <button type="button" className="btn btn--block btn--ghost" onClick={onManual}>
        <Keyboard size={16} strokeWidth={2.2} aria-hidden="true" />
        Enter my stay instead
      </button>
    </section>
  );
}
