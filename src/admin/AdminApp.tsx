/**
 * The operator console.
 *
 * Two sections behind `/admin`, code-split away from the guest bundle:
 *
 *   Hotels   properties, QR codes, partners, activities, events, analytics
 *   3D models the asset library and the map editor, exactly as before
 *
 * Both write through the same repositories the guest app reads from, so
 * publishing a model or attaching a partner changes what guests see with no
 * deploy and no code edit. That is the whole point of the registry, and the
 * hotel network now works the same way.
 */

import { ArrowLeft, Boxes, Building2, Plus } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "./ConfirmDialog";
import { HotelsSection } from "./hotels/HotelsSection";
import { ModelEditor } from "./ModelEditor";
import { ModelLibrary } from "./ModelLibrary";
import { LocationProvider } from "../state/location";
import { modelRepository } from "../data/modelRepository";
import { modelStorage } from "../data/storage";
import { useModels } from "../data/useModels";
import { experiences } from "../data/repositories/catalogue";
import type { MapModel } from "../data/types";

type Section = "hotels" | "models";
type ModelView = { mode: "library" } | { mode: "editor"; model: MapModel | null };

export default function AdminApp() {
  const { models, loading } = useModels("all");
  const [section, setSection] = useState<Section>("hotels");
  const [view, setView] = useState<ModelView>({ mode: "library" });
  const [pendingDelete, setPendingDelete] = useState<MapModel | null>(null);

  const published = models.filter((model) => model.status === "published" && model.visible).length;

  async function confirmDelete() {
    const model = pendingDelete;
    setPendingDelete(null);
    if (!model) return;

    // An experience pointing at a deleted model would render a blank space on
    // the map, so the reference is cleared with the record.
    const catalogue = await experiences.list();
    for (const experience of catalogue.filter((entry) => entry.modelId === model.id)) {
      await experiences.update(experience.id, { modelId: undefined });
    }

    await modelRepository.remove(model.id);
    // Uploaded bytes go with the record; a remote URL is not ours to delete.
    await modelStorage.deleteModel(model.modelUrl).catch(() => undefined);
  }

  async function toggleVisibility(model: MapModel) {
    const live = model.status === "published" && model.visible;
    await modelRepository.update(model.id, {
      status: live ? "hidden" : "published",
      visible: !live,
    });
  }

  const inEditor = section === "models" && view.mode === "editor";

  return (
    <LocationProvider>
      <div className="admin">
        <header className="admin__bar">
          {inEditor ? (
            <button
              type="button"
              className="admin__back"
              onClick={() => setView({ mode: "library" })}
            >
              <ArrowLeft size={15} aria-hidden="true" />
              Library
            </button>
          ) : (
            <a className="admin__back" href="/">
              <ArrowLeft size={15} aria-hidden="true" />
              Guest map
            </a>
          )}

          <nav className="admin__sections" aria-label="Console sections">
            <button
              type="button"
              className="admin__section"
              data-active={section === "hotels"}
              aria-current={section === "hotels"}
              onClick={() => setSection("hotels")}
            >
              <Building2 size={14} strokeWidth={2.2} aria-hidden="true" />
              Hotels
            </button>
            <button
              type="button"
              className="admin__section"
              data-active={section === "models"}
              aria-current={section === "models"}
              onClick={() => {
                setSection("models");
                setView({ mode: "library" });
              }}
            >
              <Boxes size={14} strokeWidth={2.2} aria-hidden="true" />
              3D models
              <span className="admin__count">
                {models.length}·{published}
              </span>
            </button>
          </nav>

          {section === "models" && view.mode === "library" ? (
            <button
              type="button"
              className="btn btn--sm btn--accent"
              onClick={() => setView({ mode: "editor", model: null })}
            >
              <Plus size={14} strokeWidth={2.6} aria-hidden="true" />
              Add 3D model
            </button>
          ) : (
            <span />
          )}
        </header>

        <div className="admin__body">
          {section === "hotels" ? <HotelsSection /> : null}

          {section === "models" ? (
            view.mode === "library" ? (
              <ModelLibrary
                models={models}
                loading={loading}
                onEdit={(model) => setView({ mode: "editor", model })}
                onPreview={(model) => {
                  window.location.href = `/#model=${model.id}`;
                }}
                onToggleVisibility={(model) => void toggleVisibility(model)}
                onDelete={setPendingDelete}
              />
            ) : (
              <ModelEditor model={view.model} onDone={() => setView({ mode: "library" })} />
            )
          ) : null}
        </div>

        <ConfirmDialog
          open={pendingDelete !== null}
          title={`Delete ${pendingDelete?.name ?? "this model"}?`}
          body="The record and its uploaded asset are removed for good, and any experience using it loses its 3D view. Guests stop seeing it immediately. This cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      </div>
    </LocationProvider>
  );
}
