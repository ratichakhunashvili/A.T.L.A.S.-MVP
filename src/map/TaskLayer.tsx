/**
 * Today's plan, on the map.
 *
 * Numbered markers in the order the day runs, joined by a dashed line, so the
 * map answers "where am I going and in what order" without the guest opening
 * a panel. On-property tasks collapse onto the hotel, so a spa and a rooftop
 * drink do not stack two identical pins on one roof — the hotel pin carries
 * the count instead.
 *
 * Built on the existing `MapMarker` portal and a plain Mapbox line layer. It
 * adds nothing to the camera, the model layer or the existing markers.
 */

import { memo, useEffect } from "react";

import { MapMarker } from "./MapMarker";
import { useMap } from "./MapProvider";
import { isTerminal, type Task } from "../data/domain";

const ROUTE_SOURCE = "task-route";
const ROUTE_LAYER = "task-route-line";

interface TaskLayerProps {
  tasks: Task[];
  selectedTaskId: string | null;
  onSelect: (taskId: string) => void;
  /** Hidden while a panel covers the map. */
  hidden?: boolean;
}

function TaskLayerImpl({ tasks, selectedTaskId, onSelect, hidden }: TaskLayerProps) {
  const map = useMap();

  /* -- The route line ---------------------------------------------------- */
  useEffect(() => {
    if (!map) return;

    const coordinates = tasks
      .filter((task) => !isTerminal(task.state) || task.state === "COMPLETED" || task.state === "VERIFIED")
      .map((task) => [task.longitude, task.latitude] as [number, number]);

    const data: GeoJSON.Feature<GeoJSON.LineString> = {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates },
    };

    const install = () => {
      if (!map.getSource(ROUTE_SOURCE)) {
        map.addSource(ROUTE_SOURCE, { type: "geojson", data });
      } else {
        (map.getSource(ROUTE_SOURCE) as mapboxgl.GeoJSONSource).setData(data);
      }

      if (!map.getLayer(ROUTE_LAYER)) {
        map.addLayer({
          id: ROUTE_LAYER,
          type: "line",
          source: ROUTE_SOURCE,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            // The system's action blue: this is the guest's own route, and it
            // belongs to the same family as every other thing they can press.
            "line-color": "#184E77",
            "line-width": 2.4,
            "line-opacity": 0.55,
            "line-dasharray": [1.4, 1.8],
          },
        });
      }

      map.setLayoutProperty(
        ROUTE_LAYER,
        "visibility",
        hidden || coordinates.length < 2 ? "none" : "visible",
      );
    };

    /*
     * Installing is a race, and losing it silently is how a layer goes
     * missing.
     *
     * With the Standard style, `isStyleLoaded()` stays false while the basemap
     * import resolves, so a first attempt can be too early — and by the time
     * the component re-runs, `style.load` may already have fired, so listening
     * for it alone can be too late. Listening for `idle` as well closes the
     * gap: whichever happens first installs, and `install` is idempotent.
     */
    const attempt = () => {
      if (!map.isStyleLoaded()) return;
      install();
      map.off("idle", attempt);
    };

    attempt();
    // A style reload drops every custom source, so the line is re-installed
    // the same way the model layer re-installs itself.
    map.on("style.load", install);
    map.on("idle", attempt);
    return () => {
      map.off("style.load", install);
      map.off("idle", attempt);
    };
  }, [map, tasks, hidden]);

  useEffect(
    () => () => {
      if (!map) return;
      try {
        if (map.getLayer(ROUTE_LAYER)) map.removeLayer(ROUTE_LAYER);
        if (map.getSource(ROUTE_SOURCE)) map.removeSource(ROUTE_SOURCE);
      } catch {
        /*
         * The guest map is unmounted wholesale when the console opens, and
         * this cleanup can run after `map.remove()` has already torn the style
         * down — at which point `getLayer` throws from inside Mapbox. There is
         * nothing left to clean up in that case, which is the outcome we
         * wanted anyway.
         */
      }
    },
    [map],
  );

  if (hidden) return null;

  /*
   * Several on-property tasks share one coordinate. Rendering each would
   * stack identical pins; instead the first one carries the marker and the
   * rest are represented by its count.
   */
  const seen = new Map<string, number>();
  const rendered: { task: Task; order: number; stacked: number }[] = [];

  tasks.forEach((task, index) => {
    const key = `${task.latitude.toFixed(5)},${task.longitude.toFixed(5)}`;
    const existing = seen.get(key);
    if (existing !== undefined) {
      rendered[existing].stacked += 1;
      return;
    }
    seen.set(key, rendered.length);
    rendered.push({ task, order: index + 1, stacked: 1 });
  });

  return (
    <>
      {rendered.map(({ task, order, stacked }) => (
        <MapMarker
          key={task.id}
          longitude={task.longitude}
          latitude={task.latitude}
          zIndex={selectedTaskId === task.id ? 40 : 30 - order}
        >
          <button
            type="button"
            className="task-marker"
            data-state={task.state}
            data-selected={selectedTaskId === task.id}
            data-wildcard={task.isWildcard}
            data-property={task.distanceM === null}
            aria-label={`${order}. ${task.title} at ${task.startTime}`}
            onClick={() => onSelect(task.id)}
          >
            <span className="task-marker__pin">{stacked > 1 ? `${order}+` : order}</span>
            <span className="task-marker__label">{task.title}</span>
          </button>
        </MapMarker>
      ))}
    </>
  );
}

export const TaskLayer = memo(TaskLayerImpl);
