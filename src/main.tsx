import { StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import "./styles/app.css";
import App from "./App";
import { readRoute, subscribeToRoute, type Route } from "./routing";
import { installEngineBridge } from "./engine/testBridge";

// Dev only, and a compile-time constant, so this and everything it imports
// disappear from a production build.
installEngineBridge();

/**
 * Three surfaces, one bundle boundary each.
 *
 * The guest map is still routeless — one screen with overlays. What sits
 * beside it now is onboarding, which needs a real URL because it is reached by
 * scanning a printed QR, and the operator console, which a guest should never
 * download. Both are code-split: a guest arriving at the map gets neither.
 */
const AdminApp = lazy(() => import("./admin/AdminApp"));
const JoinFlow = lazy(() =>
  import("./join/JoinFlow").then((module) => ({ default: module.JoinFlow })),
);

function Root() {
  const [route, setRoute] = useState<Route>(() => readRoute());

  useEffect(() => subscribeToRoute(() => setRoute(readRoute())), []);

  if (route.name === "admin") {
    return (
      <Suspense fallback={<div className="admin-boot">Loading console…</div>}>
        <AdminApp />
      </Suspense>
    );
  }

  if (route.name === "join") {
    return (
      <Suspense fallback={<div className="admin-boot">Finding your hotel…</div>}>
        <JoinFlow token={route.token} />
      </Suspense>
    );
  }

  /*
   * An attraction's code is not a page.
   *
   * It renders the map like any other visit and hands the id to the unlock
   * flow, so a guest scanning a sign in the street lands where they would
   * expect — on the map, with their new sticker sliding down from the top.
   */
  return <App scanAttractionId={route.name === "scan" ? route.attractionId : undefined} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
