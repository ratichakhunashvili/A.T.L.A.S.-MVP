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
