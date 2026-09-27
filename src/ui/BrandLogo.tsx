/**
 * The Atlas wordmark.
 *
 * One component so the asset path and its intrinsic size live in a single
 * place. The artwork is navy and gold on transparency, so it needs no plate
 * behind it and sits directly on any surface in the system.
 */

/** The trimmed artwork's own pixel size, given to the browser so a slow load
 *  reserves the right box instead of reflowing the layout around it. */
const INTRINSIC_WIDTH = 2129;
const INTRINSIC_HEIGHT = 866;

interface BrandLogoProps {
  /** Rendered height in pixels. Width follows the artwork's ratio. */
  height?: number;
  className?: string;
}

export function BrandLogo({ height = 28, className }: BrandLogoProps) {
  return (
    <img
      src="/atlas-logo.png"
      alt="Atlas"
      width={INTRINSIC_WIDTH}
      height={INTRINSIC_HEIGHT}
      style={{ height: `${height}px` }}
      className={className ? `brand-logo ${className}` : "brand-logo"}
      decoding="async"
    />
  );
}
