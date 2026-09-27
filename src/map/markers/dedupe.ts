/**
 * Collapsing markers that share a coordinate.
 *
 * Several records routinely sit on one doorway — a hotel's spa and its rooftop
 * bar, or a 3D model standing on the attraction it depicts. Drawing each one
 * stacks identical pins that cannot be told apart or pressed individually, so
 * the first record carries the marker and the rest are represented by a count.
 *
 * Rounding rather than exact equality is the point: two records typed in from
 * different sources are never bit-identical, but at five decimal places they
 * agree if and only if they are the same spot.
 */

/**
 * Five decimals is about 1.1 m of latitude — close enough that two records
 * sharing this key are the same doorway, coarse enough that neighbouring
 * buildings keep their own markers.
 */
export function coordinateKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
}

export interface Collapsed<T> {
  /** The record that carries the marker: the first one seen at this key. */
  item: T;
  /** How many records share the coordinate, including this one. */
  stacked: number;
  /** The records it stands for, in input order, excluding itself. */
  covered: T[];
}

/**
 * Groups records by rounded coordinate, preserving input order.
 *
 * Order matters to the caller: whoever is passed first wins the marker, so a
 * caller that wants models to beat places simply concatenates them that way.
 */
export function collapseByCoordinate<T>(
  items: readonly T[],
  at: (item: T) => { latitude: number; longitude: number },
): Collapsed<T>[] {
  const index = new Map<string, number>();
  const out: Collapsed<T>[] = [];

  for (const item of items) {
    const { latitude, longitude } = at(item);
    const key = coordinateKey(latitude, longitude);
    const existing = index.get(key);

    if (existing !== undefined) {
      out[existing].stacked += 1;
      out[existing].covered.push(item);
      continue;
    }

    index.set(key, out.length);
    out.push({ item, stacked: 1, covered: [] });
  }

  return out;
}
