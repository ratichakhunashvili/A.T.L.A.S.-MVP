/**
 * One icon system, one mapping.
 *
 * Every surface that shows a category — markers, the details sheet, missions,
 * the admin library — resolves its glyph here, so a category never picks up
 * two different looks in two different places.
 */

import {
  CableCar,
  Castle,
  FerrisWheel,
  Hotel,
  Landmark,
  Music,
  Trees,
  UtensilsCrossed,
  Wine,
  type LucideIcon,
} from "lucide-react";

import type { NotificationKind, PlaceCategory } from "../data/types";

/**
 * Markers are coloured by *family*, not by individual category.
 *
 * Nine categories would mean nine colours, and nine colours on one map is
 * noise. Five families — where you sleep, where you eat, what you taste, what
 * you look at, what you do — is a legend a guest can hold in their head.
 */
export type CategoryFamily = "hotel" | "food" | "tasting" | "culture" | "nature" | "active";

export const CATEGORY_FAMILY: Record<PlaceCategory, CategoryFamily> = {
  hotel: "hotel",
  restaurant: "food",
  experience: "tasting",
  museum: "culture",
  landmark: "culture",
  nature: "nature",
  adventure: "active",
  entertainment: "active",
  event: "active",
};

export const CATEGORY_ICON: Record<PlaceCategory, LucideIcon> = {
  hotel: Hotel,
  restaurant: UtensilsCrossed,
  experience: Wine,
  museum: Landmark,
  landmark: Castle,
  nature: Trees,
  adventure: CableCar,
  entertainment: FerrisWheel,
  event: Music,
};

export const NOTIFICATION_ICON: Record<NotificationKind, LucideIcon> = {
  event: Music,
  booking: Hotel,
  discovery: Wine,
  mission: Castle,
};
