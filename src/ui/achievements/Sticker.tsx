/**
 * An achievement sticker.
 *
 * Renders real art when an admin has uploaded it, and a themed placeholder
 * when they have not — so the system works end to end before a single sticker
 * has been drawn, and swapping in the real assets later changes nothing but
 * the image.
 *
 * The placeholder is not a grey box. It is a small designed object built from
 * the product palette, because an achievement that looks unfinished is worse
 * than no achievement at all.
 */

import {
  Award,
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

import type { Achievement, AchievementTone } from "../../data/domain";
import "./achievements.css";

/**
 * The icons an admin can pick from.
 *
 * A closed set rather than a free string: the sticker is drawn from it, and
 * an unknown name would render nothing at all.
 */
export const STICKER_ICONS: Record<string, LucideIcon> = {
  Award,
  CableCar,
  Castle,
  FerrisWheel,
  Hotel,
  Landmark,
  Music,
  Trees,
  UtensilsCrossed,
  Wine,
};

export const STICKER_ICON_NAMES = Object.keys(STICKER_ICONS);

export const TONE_LABEL: Record<AchievementTone, string> = {
  property: "Blue",
  highlight: "Lime",
  success: "Green",
  warning: "Coral",
  music: "Mint",
};

interface StickerProps {
  achievement: Pick<Achievement, "name" | "icon" | "tone" | "stickerUrl">;
  /** Diameter in pixels. */
  size?: number;
  /** Dimmed, for an achievement the guest has not earned. */
  locked?: boolean;
}

export function Sticker({ achievement, size = 64, locked = false }: StickerProps) {
  const Icon = STICKER_ICONS[achievement.icon] ?? Award;

  return (
    <span
      className="sticker"
      data-tone={achievement.tone}
      data-locked={locked}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {achievement.stickerUrl ? (
        <img className="sticker__art" src={achievement.stickerUrl} alt="" />
      ) : (
        <>
          {/* The notched ring is what makes it read as a sticker rather than
              as another round icon button. */}
          <span className="sticker__ring" />
          <Icon size={Math.round(size * 0.42)} strokeWidth={1.9} />
        </>
      )}
    </span>
  );
}

/**
 * The profile's three, overlapped.
 *
 * They sit on top of one another but stay individually readable — the point is
 * that a guest can see all three at a glance, not that the newest hides the
 * rest. Empty slots are drawn rather than omitted, so the row does not jump
 * around as a collection grows.
 */
export function StickerStack({
  entries,
  size = 52,
  slots = 3,
}: {
  entries: Pick<Achievement, "name" | "icon" | "tone" | "stickerUrl">[];
  size?: number;
  slots?: number;
}) {
  const overlap = Math.round(size * 0.34);

  return (
    <span className="sticker-stack" style={{ paddingLeft: overlap }}>
      {Array.from({ length: slots }, (_, index) => {
        const entry = entries[index];
        return (
          <span
            key={entry?.name ?? `empty-${index}`}
            className="sticker-stack__slot"
            style={{ marginLeft: -overlap, zIndex: slots - index }}
          >
            {entry ? (
              <Sticker achievement={entry} size={size} />
            ) : (
              <span className="sticker sticker--empty" style={{ width: size, height: size }} />
            )}
          </span>
        );
      })}
    </span>
  );
}
