/**
 * Shown in place of the map when there is no usable Mapbox token.
 *
 * The map is the application, so this is the one state worth explaining
 * properly rather than failing silently to a black screen.
 */

import { CircleAlert } from "lucide-react";

import { BrandLogo } from "./BrandLogo";
import { useMapStatus } from "../map/MapProvider";

export function TokenNotice() {
  const { error } = useMapStatus();
  if (!error) return null;

  const invalid = error === "invalid-token";

  return (
    <div className="notice-layer">
      <div className="notice">
        <BrandLogo height={22} className="brand-logo--stacked" />
        <span className="notice__icon">
          <CircleAlert size={20} strokeWidth={2} aria-hidden="true" />
        </span>
        <h1 className="notice__title">
          {invalid ? "That Mapbox token was rejected" : "Add your Mapbox token"}
        </h1>
        <p className="notice__body">
          {invalid
            ? "Mapbox returned 401 for this token. Check that it is a public token and that its URL restrictions allow this origin."
            : "The map needs a public access token to load."}
        </p>
        <pre className="notice__code">
          <code>
            # .env.local{"\n"}
            VITE_MAPBOX_TOKEN=pk.…
          </code>
        </pre>
        <p className="notice__footnote">Restart the dev server after editing the file.</p>
      </div>
    </div>
  );
}
