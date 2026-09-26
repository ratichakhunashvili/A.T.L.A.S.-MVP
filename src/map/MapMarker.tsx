/**
 * A Mapbox marker whose contents are rendered by React.
 *
 * Mapbox owns the positioning (it has to — it runs on every frame of a pan),
 * React owns what is inside. The bridge is a portal into a plain div that the
 * marker holds. Creating the element once in a ref keeps the marker from being
 * torn down and rebuilt whenever the parent re-renders.
 */

import mapboxgl from "mapbox-gl";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useMap } from "./MapProvider";

interface MapMarkerProps {
  longitude: number;
  latitude: number;
  children: ReactNode;
  anchor?: mapboxgl.Anchor;
  /** Markers later in the stacking order sit in front. */
  zIndex?: number;
  /** Used by the admin editor to place a model by hand. */
  draggable?: boolean;
  /**
   * False for decoration. A marker element is clickable by default, so a
   * purely informational one would silently swallow map clicks underneath it.
   */
  interactive?: boolean;
  onDragEnd?: (position: { longitude: number; latitude: number }) => void;
}

export function MapMarker({
  longitude,
  latitude,
  children,
  anchor = "bottom",
  zIndex = 1,
  draggable = false,
  interactive = true,
  onDragEnd,
}: MapMarkerProps) {
  const map = useMap();
  const elementRef = useRef<HTMLDivElement | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  // Held in a ref so a new callback identity never rebuilds the marker.
  const dragEndRef = useRef(onDragEnd);
  dragEndRef.current = onDragEnd;

  if (!elementRef.current) {
    elementRef.current = document.createElement("div");
    elementRef.current.className = "marker-host";
  }

  useEffect(() => {
    const element = elementRef.current;
    if (!map || !element) return;

    const marker = new mapboxgl.Marker({
      element,
      anchor,
      draggable,
      // Markers hidden behind terrain fade rather than floating on top of it.
      occludedOpacity: 0.28,
    })
      .setLngLat([longitude, latitude])
      .addTo(map);

    const handleDragEnd = () => {
      const { lng, lat } = marker.getLngLat();
      dragEndRef.current?.({ longitude: lng, latitude: lat });
    };
    marker.on("dragend", handleDragEnd);

    markerRef.current = marker;
    return () => {
      marker.off("dragend", handleDragEnd);
      marker.remove();
      markerRef.current = null;
    };
    // Position is applied by the effect below, so dragging never rebuilds the
    // marker and a parent re-render never resets a gesture in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, anchor, draggable]);

  useEffect(() => {
    markerRef.current?.setLngLat([longitude, latitude]);
  }, [longitude, latitude]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.style.zIndex = String(zIndex);
    element.style.pointerEvents = interactive ? "" : "none";
  }, [zIndex, interactive]);

  return createPortal(children, elementRef.current);
}
