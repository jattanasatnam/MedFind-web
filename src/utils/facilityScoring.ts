import type {
  LatLng,
  MedicalFacility,
  PriorityRankedFacility,
} from '../types/medfind.ts';

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Computes Haversine distance in kilometers between two coordinates.
 */
export function calculateDistanceKm(origin: LatLng, target: LatLng): number {
  const dLat = toRadians(target.lat - origin.lat);
  const dLng = toRadians(target.lng - origin.lng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(origin.lat)) *
      Math.cos(toRadians(target.lat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_KM * c * 100) / 100;
}

export function formatDistanceKm(km: number): string {
  if (!Number.isFinite(km) || km < 0) return '—';
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  }
  return `${km.toFixed(1)} km`;
}

export interface OpeningPoint {
  day: number;
  hour: number;
  minute: number;
}

export interface OpeningPeriodInput {
  open: OpeningPoint;
  close?: OpeningPoint | null;
}

/**
 * Computes real-time open/closed status from Google Places opening periods
 * and UTC offset minutes when place.isOpen() is unavailable.
 */
export function computeOpenNowFromPeriods(
  periods: OpeningPeriodInput[] | undefined | null,
  utcOffsetMinutes: number | undefined | null,
  nowDate: Date = new Date()
): boolean | null {
  if (!periods || periods.length === 0) return null;

  // Open 24 hours
  if (
    periods.length === 1 &&
    periods[0].open.day === 0 &&
    periods[0].open.hour === 0 &&
    periods[0].open.minute === 0 &&
    !periods[0].close
  ) {
    return true;
  }

  const offsetMin = typeof utcOffsetMinutes === 'number' ? utcOffsetMinutes : -nowDate.getTimezoneOffset();
  const localMs = nowDate.getTime() + offsetMin * 60_000;
  const local = new Date(localMs);
  const currentDay = local.getUTCDay(); // 0 = Sunday
  const currentMinutes = currentDay * 1440 + local.getUTCHours() * 60 + local.getUTCMinutes();
  const WEEK_MINUTES = 7 * 1440;

  for (const period of periods) {
    if (!period.open) continue;
    const openMin = period.open.day * 1440 + period.open.hour * 60 + period.open.minute;
    if (!period.close) {
      return true;
    }
    let closeMin = period.close.day * 1440 + period.close.hour * 60 + period.close.minute;
    if (closeMin <= openMin) {
      closeMin += WEEK_MINUTES;
    }
    if (
      (currentMinutes >= openMin && currentMinutes < closeMin) ||
      (currentMinutes + WEEK_MINUTES >= openMin && currentMinutes + WEEK_MINUTES < closeMin)
    ) {
      return true;
    }
  }

  return false;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function getTodayHoursSummary(
  weekdayDescriptions: string[] | undefined | null,
  utcOffsetMinutes?: number | null,
  nowDate: Date = new Date()
): string | null {
  if (!weekdayDescriptions || weekdayDescriptions.length === 0) return null;
  const offsetMin = typeof utcOffsetMinutes === 'number' ? utcOffsetMinutes : -nowDate.getTimezoneOffset();
  const local = new Date(nowDate.getTime() + offsetMin * 60_000);
  const dayName = WEEKDAY_NAMES[local.getUTCDay()];
  const match = weekdayDescriptions.find((line) => line.startsWith(dayName));
  if (!match) return null;
  const parts = match.split(': ');
  return parts.length > 1 ? parts.slice(1).join(': ') : match;
}

/**
 * Bayesian weighted rating to prevent low-review-count distortion.
 */
export function computeBayesianRating(
  rating: number | null,
  reviewCount: number,
  priorMean = 4.1,
  priorWeight = 20
): number {
  if (rating === null || !Number.isFinite(rating) || rating <= 0) {
    return priorMean * 0.85;
  }
  const safeCount = Math.max(0, reviewCount);
  return (safeCount * rating + priorWeight * priorMean) / (safeCount + priorWeight);
}

/**
 * Computes deterministic priority score (0-100) balancing:
 * - Real-time open availability (40 pts)
 * - Bayesian patient rating quality (35 pts)
 * - Proximity decay up to 15 km (25 pts)
 */
export function computeFacilityPriorityScore(
  facility: MedicalFacility
): PriorityRankedFacility {
  const availabilityScore =
    facility.openNow === true ? 40 : facility.openNow === null ? 20 : 4;

  const bayesian = computeBayesianRating(
    facility.rating,
    facility.userRatingCount
  );
  const ratingScore = Math.min(35, Math.max(0, ((bayesian - 2.0) / 3.0) * 35));

  const clampedDist = Math.max(0, Math.min(15, facility.distanceKm));
  const proximityScore = ((15 - clampedDist) / 15) * 25;

  const total = Math.round(availabilityScore + ratingScore + proximityScore);

  const reasons: string[] = [];
  if (facility.openNow === true) {
    reasons.push('Open now');
  } else if (facility.openNow === false) {
    reasons.push('Currently closed');
  } else {
    reasons.push('Hours unconfirmed');
  }

  if (facility.rating !== null && facility.rating >= 4.4 && facility.userRatingCount >= 20) {
    reasons.push(`Rated ${facility.rating.toFixed(1)} (${facility.userRatingCount} reviews)`);
  } else if (facility.rating !== null) {
    reasons.push(`Rated ${facility.rating.toFixed(1)}`);
  }

  if (facility.distanceKm <= 2.0) {
    reasons.push(`Nearby (${formatDistanceKm(facility.distanceKm)})`);
  }

  let tierLabel: PriorityRankedFacility['tierLabel'] = 'Alternative';
  if (facility.openNow === false) {
    tierLabel = 'Closed Now';
  } else if (total >= 78) {
    tierLabel = 'Top Priority';
  } else if (total >= 60) {
    tierLabel = 'Recommended';
  }

  return {
    facilityId: facility.id,
    priorityScore: Math.max(0, Math.min(100, total)),
    tierLabel,
    reasons,
  };
}

/**
 * Ranks facilities prioritizing real-time open status, weighted patient rating, and proximity.
 */
export function rankFacilitiesByAvailabilityAndRating(
  facilities: MedicalFacility[]
): Array<MedicalFacility & { scoring: PriorityRankedFacility }> {
  return facilities
    .map((facility) => ({
      ...facility,
      scoring: computeFacilityPriorityScore(facility),
    }))
    .sort((a, b) => {
      if (b.scoring.priorityScore !== a.scoring.priorityScore) {
        return b.scoring.priorityScore - a.scoring.priorityScore;
      }
      return a.distanceKm - b.distanceKm;
    });
}

/**
 * Ranks hospitals specifically by patient review confidence (rating + volume) and proximity.
 */
export function rankHospitalsByReviewsAndProximity(
  facilities: MedicalFacility[]
): Array<MedicalFacility & { scoring: PriorityRankedFacility }> {
  const hospitals = facilities.filter((f) => f.category === 'hospital');
  return hospitals
    .map((hospital) => {
      const base = computeFacilityPriorityScore(hospital);
      // Extra review-volume confidence adjustment for hospitals
      const volumeBonus =
        hospital.userRatingCount >= 200
          ? 6
          : hospital.userRatingCount >= 50
            ? 3
            : 0;
      const adjustedScore = Math.min(100, base.priorityScore + volumeBonus);
      return {
        ...hospital,
        scoring: {
          ...base,
          priorityScore: adjustedScore,
        },
      };
    })
    .sort((a, b) => {
      if (b.scoring.priorityScore !== a.scoring.priorityScore) {
        return b.scoring.priorityScore - a.scoring.priorityScore;
      }
      return a.distanceKm - b.distanceKm;
    });
}
