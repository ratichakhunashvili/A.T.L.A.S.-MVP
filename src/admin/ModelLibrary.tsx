/**
 * The model library.
 *
 * Every record an administrator has created, whatever its state, with the four
 * actions that matter: open it, see it on the guest map, take it down or put
 * it back up, and delete it — behind a confirmation.
 */

import { ArrowUpRight, Box, Eye, EyeOff, Pencil, Trash2 } from "lucide-react";

import { CATEGORY_ICON } from "../ui/icons";
import { CATEGORY_LABEL, type MapModel } from "../data/types";

interface ModelLibraryProps {
  models: MapModel[];
  loading: boolean;
  onEdit: (model: MapModel) => void;
  onPreview: (model: MapModel) => void;
  onToggleVisibility: (model: MapModel) => void;
  onDelete: (model: MapModel) => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function ModelLibrary({
  models,
  loading,
  onEdit,
  onPreview,
  onToggleVisibility,
  onDelete,
}: ModelLibraryProps) {
  if (loading) {
    return (
      <div className="library">
        <p className="empty-state__body" style={{ margin: "40px auto" }}>
          Loading models…
        </p>
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="library">
        <div className="empty-state">
          <span className="empty-state__icon">
            <Box size={19} strokeWidth={2} aria-hidden="true" />
          </span>
          <p className="empty-state__title">No models yet</p>
          <p className="empty-state__body">
            Add a 3D model to place it on the guest map. GLB files work best.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="library">
      <ul className="library__grid">
        {models.map((model) => {
          const Icon = CATEGORY_ICON[model.category];
          const live = model.status === "published" && model.visible;

          return (
            <li key={model.id} className="model-card">
              <div className="model-card__preview">
                <span className="model-card__status" data-status={model.status}>
                  {model.status}
                </span>
                <Icon size={34} strokeWidth={1.2} aria-hidden="true" />
              </div>

              <div className="model-card__main">
                <p className="model-card__name">{model.name}</p>
                <p className="model-card__meta">
                  {CATEGORY_LABEL[model.category]} · {model.latitude.toFixed(4)},{" "}
                  {model.longitude.toFixed(4)}
                </p>
                <p className="model-card__meta">Updated {formatDate(model.updatedAt)}</p>
              </div>

              <div className="model-card__actions">
                <button type="button" className="btn btn--sm" onClick={() => onEdit(model)}>
                  <Pencil size={13} strokeWidth={2.2} aria-hidden="true" />
                  Edit
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => onPreview(model)}
                  /* The guest map only ever renders live records, so previewing
                     a draft there would show nothing. */
                  disabled={!live}
                  aria-label={`Preview ${model.name} on the guest map`}
                  title={live ? "Preview on the guest map" : "Publish it first to preview"}
                >
                  <ArrowUpRight size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => onToggleVisibility(model)}
                  aria-label={live ? `Hide ${model.name}` : `Publish ${model.name}`}
                  title={live ? "Hide from the guest map" : "Publish to the guest map"}
                >
                  {live ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  data-danger="true"
                  onClick={() => onDelete(model)}
                  aria-label={`Delete ${model.name}`}
                  title="Delete"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
