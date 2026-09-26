/**
 * The QR scanner — the product's primary gesture.
 *
 * One sentence, one frame, one way out. Scanning the hotel's code is what
 * turns a stranger into a guest, so this overlay stays deliberately empty of
 * everything else.
 *
 * A decoded code is acted on rather than displayed. Three things are
 * recognised, in order:
 *
 *   · a hotel onboarding link  → starts onboarding for that hotel
 *   · an activity code          → verifies the matching task as completed
 *   · anything else             → shown as-is, since it is not ours
 *
 * Where the platform ships `BarcodeDetector` (Chrome and Edge, desktop and
 * Android) this decodes for real. Everywhere else the camera still opens and
 * the frame still works; only the decode step is missing.
 */

import { Camera, Check, QrCode, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { CenterModal } from "../ui/sheets/Sheets";
import { navigate } from "../routing";
import { useAchievements } from "../state/achievements";
import { useGuest } from "../state/guest";
import { ensureGuestSession } from "../data/repositories/guests";
import { transitionTask } from "../data/repositories/plans";
import type { Task } from "../data/domain";

type ScannerState = "idle" | "starting" | "live" | "denied" | "unsupported" | "success";

const STATUS_COPY: Record<ScannerState, string> = {
  idle: "The code is on the card at reception, and inside your room door.",
  starting: "Opening the camera…",
  live: "Hold the code inside the frame.",
  denied:
    "Camera access was blocked. Allow it in your browser settings, or type the code from your key card.",
  unsupported: "This browser cannot open a camera here. Type the code from your key card instead.",
  success: "Done.",
};

/** What a decoded code turned out to mean. */
type Outcome =
  | { kind: "hotel"; token: string }
  | { kind: "achievement"; name: string; place: string }
  /** Scanned somewhere already collected — deliberately says so quietly. */
  | { kind: "repeat"; place: string }
  | { kind: "verified"; task: Task }
  | { kind: "unknown"; value: string };

interface QRScannerOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function QRScannerOverlay({ open, onClose }: QRScannerOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef(0);
  const [state, setState] = useState<ScannerState>("idle");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const { plan, hotel, refresh } = useGuest();
  const { unlock } = useAchievements();

  const stop = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  /**
   * Interprets one decoded payload.
   *
   * Verification is matched against the guest's own plan, so a partner's code
   * can only ever complete a task that was actually scheduled for them — it is
   * not a way to mark arbitrary activities done.
   */
  const interpret = useCallback(
    async (raw: string): Promise<Outcome> => {
      const value = raw.trim();

      const join = value.match(/\/join\/hotel\/([A-Za-z0-9_-]{6,64})/);
      if (join) return { kind: "hotel", token: join[1].toUpperCase() };

      // An attraction's printed code. Unlocking happens here rather than by
      // navigating, so the guest stays on the map with the scanner open.
      const attraction = value.match(/\/scan\/attraction\/([A-Za-z0-9_-]{3,64})/);
      if (attraction) {
        ensureGuestSession();
        const outcome = await unlock(attraction[1]);
        if (outcome.status === "unlocked") {
          return { kind: "achievement", name: outcome.achievement.name, place: outcome.attraction.name };
        }
        if (outcome.status === "already") return { kind: "repeat", place: outcome.attraction.name };
        return { kind: "unknown", value };
      }

      // `atlas:activity:<id>` is the code a hotel or partner prints beside a
      // spa door or a ticket desk.
      const activity = value.match(/^atlas:activity:([A-Za-z0-9-]+)$/i);
      if (activity && plan) {
        const target = plan.tasks.find(
          (task) =>
            task.activityId === activity[1] &&
            task.state !== "COMPLETED" &&
            task.state !== "VERIFIED",
        );
        if (target) {
          const result = await transitionTask(
            plan.id,
            target.id,
            target.state === "STARTED" ? "VERIFIED" : "STARTED",
          );
          if (result) {
            // A code scanned on arrival starts the task; scanned again on the
            // way out it verifies it, which is the natural gesture.
            const finished =
              result.task.state === "STARTED"
                ? await transitionTask(plan.id, target.id, "VERIFIED")
                : result;
            await refresh();
            return { kind: "verified", task: finished?.task ?? result.task };
          }
        }
      }

      return { kind: "unknown", value };
    },
    [plan, refresh, unlock],
  );

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
          .then(async (results) => {
            if (results.length === 0) return;
            stop();
            const decided = await interpret(results[0].rawValue);
            setOutcome(decided);
            setState("success");

            // A hotel code is an instruction, not a result to read.
            if (decided.kind === "hotel") {
              window.setTimeout(() => navigate(`/join/hotel/${decided.token}`), 600);
            }
          })
          .catch(() => {
            /* a dropped frame is not worth reporting */
          });
      };

      frameRef.current = requestAnimationFrame(tick);
    },
    [interpret, stop],
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

  const successLine =
    outcome?.kind === "verified"
      ? `${outcome.task.title} — completed`
      : outcome?.kind === "hotel"
        ? "Opening your hotel…"
        : outcome?.kind === "achievement"
          ? outcome.name
          : outcome?.kind === "repeat"
            ? `You've already been to ${outcome.place}`
            : (outcome?.value ?? "");

  return (
    <CenterModal open={open} onClose={onClose} label="Scan a QR code">
      <div className="qr">
        <div className="qr__head">
          <div style={{ flex: 1 }}>
            <p className="qr__title">Scan QR code</p>
            <p className="qr__lede">
              {hotel
                ? `Scan a code at ${hotel.name} or at a partner to check in to an activity.`
                : "Scan the QR code at your hotel to start your stay."}
            </p>
          </div>
          <button
            type="button"
            className="sheet__close"
            onClick={onClose}
            aria-label="Close scanner"
          >
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
                style={{
                  width: 52,
                  height: 52,
                  background:
                    outcome?.kind === "unknown"
                      ? "var(--color-warning)"
                      : outcome?.kind === "repeat"
                        ? "var(--color-property)"
                        : "var(--color-success)",
                  color: "var(--color-white)",
                }}
              >
                <Check size={26} strokeWidth={3} aria-hidden="true" />
              </span>
              <p className="qr__hint-text" style={{ color: "var(--color-white)" }}>
                {successLine}
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
            {state === "success" && outcome?.kind === "unknown"
              ? "That code isn't one of ours."
              : state === "success" && outcome?.kind === "repeat"
                ? "Nothing new — this one is already in your collection."
                : state === "success" && outcome?.kind === "achievement"
                  ? `Collected at ${outcome.place}.`
                  : STATUS_COPY[state]}
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
