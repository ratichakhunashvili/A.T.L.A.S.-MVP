/**
 * Seed content for the demo.
 *
 * Places, missions, notifications and the profile live here until there is a
 * backend to serve them. 3D models deliberately do not: they are fetched from
 * `public/models.seed.json` through the repository, because an administrator
 * has to be able to add one without a developer editing a file.
 */

import type {
  ChatMessage,
  GuestProfile,
  GuestStay,
  Mission,
  NotificationItem,
  Place,
} from "./types";

/** Old Tbilisi — the stay the demo opens into. */
export const STAY: GuestStay = {
  hotelName: "Hotel Veli",
  checkIn: "12 Oct",
  checkOut: "16 Oct",
  nights: 4,
  daysLeft: 3,
  // Sits on a real mapped building just off Freedom Square, so the basemap
  // building highlight has something to land on under the marker.
  longitude: 44.80217,
  latitude: 41.69314,
};

/**
 * Opening camera. Pitched enough to read the 3D city and the slope it sits on,
 * shallow enough that the street grid stays legible as a map.
 */
export const INITIAL_CAMERA = {
  center: [STAY.longitude, STAY.latitude] as [number, number],
  zoom: 15.6,
  pitch: 46,
  bearing: -18,
};

export const PLACES: Place[] = [
  {
    id: "hotel-veli",
    name: "Hotel Veli",
    category: "hotel",
    longitude: 44.80217,
    latitude: 41.69314,
    description: "Your stay. Guest Mode is active until check-out on 16 October.",
    unlocked: true,
  },
  {
    id: "riverside-table",
    name: "Riverside Table",
    category: "restaurant",
    longitude: 44.8064,
    latitude: 41.6902,
    description:
      "Kakhetian cooking on a terrace over the Mtkvari. The clay-oven bread arrives first, always.",
    rating: 4.7,
    reviewCount: 214,
    distanceKm: 0.6,
    durationMin: 90,
    price: 60,
    openHours: "Open 12:00–23:00",
    unlocked: true,
  },
  {
    id: "wine-cellar",
    name: "Qvevri Wine Cellar",
    category: "experience",
    longitude: 44.8042,
    latitude: 41.6925,
    description:
      "A local winemaker walks you through the qvevri tradition and pours five varieties.",
    rating: 4.9,
    reviewCount: 128,
    distanceKm: 1.8,
    durationMin: 120,
    price: 45,
    openHours: "Open 11:00–20:00",
    missionId: "old-tbilisi",
  },
  {
    id: "history-museum",
    name: "Museum of History",
    category: "museum",
    longitude: 44.7998,
    latitude: 41.6967,
    description:
      "Two floors of Caucasian goldwork, and the quietest hour in the old town is right after opening.",
    rating: 4.5,
    reviewCount: 96,
    distanceKm: 0.4,
    durationMin: 75,
    price: 15,
    openHours: "Open 10:00–18:00",
    unlocked: true,
    missionId: "old-tbilisi",
  },
  {
    id: "narikala",
    name: "Narikala Fortress",
    category: "landmark",
    longitude: 44.8075,
    latitude: 41.6877,
    description:
      "Fourth-century walls above the sulphur baths. Go for the last hour of light.",
    rating: 4.8,
    reviewCount: 1840,
    distanceKm: 1.1,
    durationMin: 60,
    openHours: "Always open",
    missionId: "old-tbilisi",
  },
  {
    id: "cable-car",
    name: "Ridge Cable Car",
    category: "adventure",
    longitude: 44.8092,
    latitude: 41.6897,
    description:
      "Three minutes from the river to the ridge, with the whole old town underneath you.",
    rating: 4.6,
    reviewCount: 520,
    distanceKm: 1.3,
    durationMin: 25,
    price: 5,
    openHours: "Open 11:00–23:00",
    missionId: "above-the-city",
  },
  {
    id: "ferris-wheel",
    name: "Mtatsminda Wheel",
    category: "entertainment",
    longitude: 44.7873,
    latitude: 41.6951,
    description:
      "The observation wheel on the park plateau — the city reads as one piece from the top.",
    rating: 4.4,
    reviewCount: 680,
    distanceKm: 2.6,
    durationMin: 40,
    price: 12,
    openHours: "Open 12:00–22:00",
    missionId: "above-the-city",
  },
  {
    id: "turtle-lake",
    name: "Turtle Lake",
    category: "nature",
    longitude: 44.7605,
    latitude: 41.7095,
    description:
      "A walkable loop in the pines above the city, twenty minutes out and worth the climb.",
    rating: 4.5,
    reviewCount: 312,
    distanceKm: 5.2,
    durationMin: 120,
    openHours: "Always open",
  },
  {
    id: "rooftop-jazz",
    name: "Rooftop Jazz Night",
    category: "event",
    // Far enough from the hotel that the two markers do not collide.
    longitude: 44.7985,
    latitude: 41.6955,
    description:
      "A resident trio plays the terrace across the square every Thursday. Starts in 30 minutes.",
    rating: 4.8,
    reviewCount: 74,
    distanceKm: 0.3,
    durationMin: 150,
    openHours: "Tonight, 21:00",
  },
];

export const MISSIONS: Mission[] = [
  {
    id: "old-tbilisi",
    title: "Explore Old Tbilisi",
    subtitle: "Five places that explain the city",
    category: "landmark",
    distanceKm: 1.1,
    active: true,
    steps: [
      {
        id: "s1",
        title: "Museum of History",
        detail: "Visited · 12 Oct",
        done: true,
        placeId: "history-museum",
      },
      {
        id: "s2",
        title: "Sulphur bath district",
        detail: "Visited · 13 Oct",
        done: true,
      },
      {
        id: "s3",
        title: "Riverside Table",
        detail: "Visited · 13 Oct",
        done: true,
        placeId: "riverside-table",
      },
      {
        id: "s4",
        title: "Narikala Fortress",
        detail: "1.1 km · about 1 hour",
        done: false,
        placeId: "narikala",
      },
      {
        id: "s5",
        title: "Qvevri Wine Cellar",
        detail: "1.8 km · tasting for five",
        done: false,
        placeId: "wine-cellar",
      },
    ],
  },
  {
    id: "above-the-city",
    title: "Above the City",
    subtitle: "Cable car, ridge walk, the wheel",
    category: "adventure",
    distanceKm: 1.3,
    steps: [
      { id: "s1", title: "Ridge Cable Car", detail: "1.3 km", done: false, placeId: "cable-car" },
      { id: "s2", title: "Mtatsminda Wheel", detail: "2.6 km", done: false, placeId: "ferris-wheel" },
    ],
  },
  {
    id: "table-of-kakheti",
    title: "Table of Kakheti",
    subtitle: "Three tastings, one region",
    category: "restaurant",
    distanceKm: 0.6,
    steps: [
      { id: "s1", title: "Qvevri Wine Cellar", detail: "1.8 km", done: false, placeId: "wine-cellar" },
      { id: "s2", title: "Riverside Table", detail: "0.6 km", done: false, placeId: "riverside-table" },
    ],
  },
];

export const NOTIFICATIONS: NotificationItem[] = [
  {
    id: "n1",
    kind: "event",
    title: "Hotel event starts in 30 minutes",
    description: "Rooftop jazz night on the sixth floor terrace.",
    time: "Just now",
    unread: true,
  },
  {
    id: "n2",
    kind: "mission",
    title: "Mission available nearby",
    description: "Narikala Fortress is 1.1 km away — two steps left on Explore Old Tbilisi.",
    time: "12 min ago",
    unread: true,
  },
  {
    id: "n3",
    kind: "booking",
    title: "Your reservation is confirmed",
    description: "Riverside Table, tomorrow at 19:30 for two.",
    time: "1 h ago",
    unread: false,
  },
  {
    id: "n4",
    kind: "discovery",
    title: "New experience near your hotel",
    description: "A qvevri cellar opened tastings four minutes from reception.",
    time: "Yesterday",
    unread: false,
  },
];

export const PROFILE: GuestProfile = {
  name: "Nino Beridze",
  initials: "NB",
  memberSince: "Traveller since 2024",
  completedMissions: 12,
  savedPlaces: 8,
  reviews: 21,
};

/** Earlier stays, newest first — the part of the profile that outlives a trip. */
export const TRIPS = [
  { id: "t1", city: "Tbilisi", detail: "4 nights · 6 places", when: "Sep 2026" },
  { id: "t2", city: "Sighnaghi", detail: "2 nights · 3 places", when: "Jul 2026" },
  { id: "t3", city: "Stepantsminda", detail: "3 nights · 5 places", when: "May 2026" },
];

export const CHAT_GREETING: ChatMessage = {
  id: "greeting",
  author: "assistant",
  text: "How can I make your time here better?",
};

export const CHAT_SUGGESTIONS = [
  "Show me something nearby",
  "What can I do tonight?",
  "Find something inside the hotel",
  "Plan my free time",
];
