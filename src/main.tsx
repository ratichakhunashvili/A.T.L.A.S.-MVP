import { StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import "./styles/app.css";
import App from "./App";

/**
 * The guest app has no routes — it is one screen with overlays.
 *
 * The administrator's map editor is a different audience and a different
 * surface, so it lives behind `#/admin` and is code-split: a guest never
 * downloads it. This is the only branch in the application.
 */
const AdminApp = lazy(() => import("./admin/AdminApp"));

function Root() {
  const [isAdmin, setIsAdmin] = useState(() => window.location.hash.startsWith("#/admin"));

  useEffect(() => {
    const onHashChange = () => setIsAdmin(window.location.hash.startsWith("#/admin"));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (isAdmin) {
    return (
      <Suspense fallback={<div className="admin-boot">Loading editor…</div>}>
        <AdminApp />
      </Suspense>
    );
  }

  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
