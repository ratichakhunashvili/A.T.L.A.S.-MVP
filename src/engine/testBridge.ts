/**
 * A dev-only handle on the engine.
 *
 * The recommendation pipeline is pure and deterministic, which makes it
 * genuinely testable — but it lives in a browser bundle, so a test runner
 * needs some way in. This exposes it on `window.__engine` behind
 * `import.meta.env.DEV`, a compile-time constant, so the whole module and
 * everything it pulls in is dropped from a production build.
 *
 * Tests drive the real engine with synthetic records rather than a
 * re-implementation of it, which is the only version of this worth having.
 */

import {
  computeEngagement,
  computeMomentum,
  determineTaskCount,
  stateForScore,
} from "./engagement";
import { generateDailyPlan, type PlanInput, type PlanResult } from "./plan";
import { calculateFreeWindows, findSlot, totalFreeMinutes, travelMinutes } from "./time";
import { screenCandidates, validateSchedule } from "./rules";
import { scoreAll } from "./scoring";
import { mergeRanking } from "../ai/enhance";
import { parseRankingResponse } from "../ai/provider";
import {
  normaliseDate,
  parseQRPayload,
  parseReservationText,
} from "../join/reservationParse";
import { nightsBetween, validateReservation } from "../data/repositories/guests";
import {
  deleteHotel,
  generateHotelToken,
  hotels,
  hotelQRCodes,
  previewHotelDeletion,
  resolveHotelToken,
} from "../data/repositories/hotels";
import {
  attachPartner,
  detachPartner,
  eligiblePartnerExperiences,
  experiences,
  hotelEvents,
  hotelPartners,
} from "../data/repositories/catalogue";
import { activityEvents } from "../data/repositories/activity";
import {
  achievements,
  collectionFor,
  featuredFor,
  isDevelopmentAccount,
  setFeatured,
  unlockByAttraction,
  userAchievements,
  visitedAttractions,
} from "../data/repositories/achievements";
import { dailyPlans } from "../data/repositories/plans";
import { reservations } from "../data/repositories/guests";
import { modelRepository } from "../data/modelRepository";
import { generatePlanForGuest } from "./service";

export interface EngineBridge {
  generateDailyPlan(input: PlanInput): PlanResult;
  generatePlanForGuest: typeof generatePlanForGuest;
  computeEngagement: typeof computeEngagement;
  determineTaskCount: typeof determineTaskCount;
  stateForScore: typeof stateForScore;
  calculateFreeWindows: typeof calculateFreeWindows;
  totalFreeMinutes: typeof totalFreeMinutes;
  travelMinutes: typeof travelMinutes;
  findSlot: typeof findSlot;
  screenCandidates: typeof screenCandidates;
  validateSchedule: typeof validateSchedule;
  scoreAll: typeof scoreAll;
  mergeRanking: typeof mergeRanking;
  parseRankingResponse: typeof parseRankingResponse;
  parseReservationText: typeof parseReservationText;
  parseQRPayload: typeof parseQRPayload;
  normaliseDate: typeof normaliseDate;
  nightsBetween: typeof nightsBetween;
  validateReservation: typeof validateReservation;
  generateHotelToken: typeof generateHotelToken;
  resolveHotelToken: typeof resolveHotelToken;
  eligiblePartnerExperiences: typeof eligiblePartnerExperiences;
  previewHotelDeletion: typeof previewHotelDeletion;
  deleteHotel: typeof deleteHotel;
  attachPartner: typeof attachPartner;
  detachPartner: typeof detachPartner;
  unlockByAttraction: typeof unlockByAttraction;
  collectionFor: typeof collectionFor;
  featuredFor: typeof featuredFor;
  setFeatured: typeof setFeatured;
  visitedAttractions: typeof visitedAttractions;
  isDevelopmentAccount: typeof isDevelopmentAccount;
  computeMomentum: typeof computeMomentum;
  /**
   * The repositories themselves.
   *
   * A test that reaches them through its own `import()` gets a *second* module
   * instance under Vite dev — it writes to the same storage but keeps its own
   * in-memory cache, so the running app never sees the change and the test
   * measures the wrong object. Handing out the application's instances is the
   * only way a test can mutate what the app is actually reading.
   */
  repositories: {
    hotels: typeof hotels;
    hotelQRCodes: typeof hotelQRCodes;
    experiences: typeof experiences;
    hotelPartners: typeof hotelPartners;
    hotelEvents: typeof hotelEvents;
    achievements: typeof achievements;
    userAchievements: typeof userAchievements;
    reservations: typeof reservations;
    dailyPlans: typeof dailyPlans;
    activityEvents: typeof activityEvents;
    /**
     * The 3D model registry, for the same reason as the rest: a test that
     * writes `hospitality-map.models.v1` directly has to reload the page
     * before the app notices, and one that imports the module gets a second
     * instance with its own cache.
     */
    models: typeof modelRepository;
  };
}

declare global {
  interface Window {
    __engine?: EngineBridge;
  }
}

export function installEngineBridge(): void {
  if (!import.meta.env.DEV) return;

  window.__engine = {
    generateDailyPlan,
    generatePlanForGuest,
    computeEngagement,
    determineTaskCount,
    stateForScore,
    calculateFreeWindows,
    totalFreeMinutes,
    travelMinutes,
    findSlot,
    screenCandidates,
    validateSchedule,
    scoreAll,
    mergeRanking,
    parseRankingResponse,
    parseReservationText,
    parseQRPayload,
    normaliseDate,
    nightsBetween,
    validateReservation,
    generateHotelToken,
    resolveHotelToken,
    eligiblePartnerExperiences,
    previewHotelDeletion,
    deleteHotel,
    attachPartner,
    detachPartner,
    unlockByAttraction,
    collectionFor,
    featuredFor,
    setFeatured,
    visitedAttractions,
    isDevelopmentAccount,
    computeMomentum,
    repositories: {
      hotels,
      hotelQRCodes,
      experiences,
      hotelPartners,
      hotelEvents,
      achievements,
      userAchievements,
      reservations,
      dailyPlans,
      activityEvents,
      models: modelRepository,
    },
  };
}
