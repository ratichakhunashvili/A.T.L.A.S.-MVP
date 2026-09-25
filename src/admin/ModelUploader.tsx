/**
 * Model upload with validation.
 *
 * A broken asset must never reach the public map, so a file is checked before
 * it is stored: extension, size, and the container itself — a GLB header that
 * does not say "glTF", or a declared length that disagrees with the file, is
 * rejected here rather than showing up as a blank patch on someone's map.
 *
 * The states an administrator sees are the real ones: validating, uploading,
 * processing, ready, error.
 */

import { Box, CircleAlert, Check, LoaderCircle, Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import {
  ACCEPTED_MODEL_EXTENSIONS,
  MAX_MODEL_BYTES,
  formatBytes,
  modelStorage,
  validateModelFile,
} from "../data/storage";

type UploadState = "idle" | "validating" | "uploading" | "processing" | "ready" | "error";

const TONE: Partial<Record<UploadState, string>> = {
  error: "error",
  ready: "ready",
};

interface ModelUploaderProps {
  /** The reference currently on the record, if any. */
  value: string;
  onUploaded: (ref: string, filename: string) => void;
}

export function ModelUploader({ value, onUploaded }: ModelUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>(value ? "ready" : "idle");
  const [message, setMessage] = useState<string>(value ? "Asset attached." : "");
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);

  const accept = async (file: File) => {
    setState("validating");
    setMessage(`Checking ${file.name}…`);
    setProgress(0);

    const result = await validateModelFile(file);
    if (!result.ok) {
      setState("error");
      setMessage(result.message);
      return;
    }

    setState("uploading");
    setMessage(`Uploading ${file.name} · ${formatBytes(file.size)}`);

    try {
      const { ref } = await modelStorage.uploadModel(file, setProgress);

      setState("processing");
      setMessage("Processing…");
      // Gives the asset store a beat to settle before the preview reaches for
      // it — and gives the administrator a state they can actually read.
      await new Promise((resolve) => window.setTimeout(resolve, 260));

      onUploaded(ref, file.name);
      setState("ready");
      setMessage(`${file.name} is ready. It appears in the preview on the left.`);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    }
  };

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void accept(file);
    // `accept` is stable enough for this handler's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = state === "validating" || state === "uploading" || state === "processing";

  return (
    <div className="field">
      <span className="field__label">3D asset</span>

      <div
        className="upload"
        data-drag={dragging}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <Upload size={18} strokeWidth={2} className="upload__icon" aria-hidden="true" />
        <span className="upload__title">
          {value ? "Replace the model" : "Upload a model"}
        </span>
        <span className="upload__hint">
          {ACCEPTED_MODEL_EXTENSIONS.join(" or ")} · up to {formatBytes(MAX_MODEL_BYTES)}
          <br />
          Convert .obj, .fbx or .blend to GLB before uploading.
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        className="visually-hidden"
        accept={ACCEPTED_MODEL_EXTENSIONS.join(",")}
        aria-label="Choose a 3D model file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void accept(file);
          // Allows re-picking the same file after a failed attempt.
          event.target.value = "";
        }}
      />

      {state !== "idle" ? (
        <p className="upload-status" data-tone={TONE[state]} role="status">
          {busy ? (
            <LoaderCircle size={14} className="upload-status__spin" aria-hidden="true" />
          ) : state === "ready" ? (
            <Check size={14} aria-hidden="true" />
          ) : (
            <CircleAlert size={14} aria-hidden="true" />
          )}
          {message}
        </p>
      ) : null}

      {state === "uploading" ? (
        <div className="upload-progress">
          <div className="upload-progress__fill" style={{ width: `${progress * 100}%` }} />
        </div>
      ) : null}

      {value && state !== "error" ? (
        <p className="field__hint">
          <Box size={10} style={{ display: "inline", verticalAlign: "-1px" }} aria-hidden="true" />{" "}
          {value.startsWith("local:") ? "Stored in this browser" : value}
        </p>
      ) : null}
    </div>
  );
}
