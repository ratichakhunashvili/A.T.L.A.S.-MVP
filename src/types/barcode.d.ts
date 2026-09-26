/**
 * `BarcodeDetector` ships in Chrome and Edge but is not yet in the DOM lib.
 *
 * Declared once here so the scanner overlay and the reservation parser share a
 * single definition — two files each declaring their own global is a type
 * conflict, and the version skew it causes is worse than the missing types.
 */

interface DetectedBarcode {
  rawValue: string;
  format?: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource | ImageBitmap | Blob): Promise<DetectedBarcode[]>;
}

interface Window {
  BarcodeDetector?: new (options?: { formats: string[] }) => BarcodeDetectorLike;
}
