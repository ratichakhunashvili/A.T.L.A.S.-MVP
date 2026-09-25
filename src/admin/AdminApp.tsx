/**
 * The administrator's surface.
 *
 * Two views — a library and a map editor — behind `#/admin`, code-split away
 * from the guest bundle. It writes through exactly the same repository the
 * public map reads from, so publishing a model here changes that map with no
 * deploy and no code edit, which is the whole point of the registry.
 */

import { ArrowLeft, Plus } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "./ConfirmDialog";
import { ModelEditor } from "./ModelEditor";
import { ModelLibrary } from "./ModelLibrary";
import { modelRepository } from "../data/modelRepository";
import { modelStorage } from "../data/storage";
import { useModels } from "../data/useModels";
import type { MapModel } from "../data/types";

type View = { mode: "library" } | { mode: "editor"; model: MapModel | null };

export default function AdminApp() {
  const { models, loading } = useModels("all");
  const [view, setView] = useState<View>({ mode: "library" });
  const [pendingDelete, setPendingDelete] = useState<MapModel | null>(null);

  const published = models.filter((model) => model.status === "published" && model.visible).length;

  async function confirmDelete() {
    const model = pendingDelete;
    setPendingDelete(null);
    if (!model) return;

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

  return (
    <div className="admin">
      <header className="admin__bar">
        {view.mode === "editor" ? (
          <button
            type="button"
            className="admin__back"
            onClick={() => setView({ mode: "library" })}
          >
            <ArrowLeft size={15} aria-hidden="true" />
            Library
          </button>
        ) : (
          <a className="admin__back" href="#/">
            <ArrowLeft size={15} aria-hidden="true" />
            Guest map
          </a>
        )}

        <span className="admin__title">
          3D models{" "}
          <span className="admin__count">
            · {models.length} total, {published} live
          </span>
        </span>

        {view.mode === "library" ? (
          <button
            type="button"
            className="btn btn--sm btn--accent"
            onClick={() => setView({ mode: "editor", model: null })}
          >
            <Plus size={14} strokeWidth={2.6} aria-hidden="true" />
            Add 3D model
          </button>
        ) : null}
      </header>

      <div className="admin__body">
        {view.mode === "library" ? (
          <ModelLibrary
            models={models}
            loading={loading}
            onEdit={(model) => setView({ mode: "editor", model })}
            onPreview={(model) => {
              window.location.hash = `#model=${model.id}`;
            }}
            onToggleVisibility={(model) => void toggleVisibility(model)}
            onDelete={setPendingDelete}
          />
        ) : (
          <ModelEditor model={view.model} onDone={() => setView({ mode: "library" })} />
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.name ?? "this model"}?`}
        body="The record and its uploaded asset are removed for good. Guests stop seeing it immediately. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
