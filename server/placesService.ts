import type { FacilityCategory, LatLng, MedicalFacility, PlaceReviewItem } from '../src/types/medfind.ts';
import { calculateDistanceKm } from '../src/utils/facilityScoring.ts';
import { sanitizeExternalUrl } from '../src/utils/urlSafety.ts';

interface GooglePlacesApiPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  currentOpeningHours?: {
    openNow?: boolean;
    weekdayDescriptions?: string[];
  };
  regularOpeningHours?: {
    openNow?: boolean;
    weekdayDescriptions?: string[];
  };
  nationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  googleMapsLinks?: {
    directionsUri?: string;
    reviewsUri?: string;
  };
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  types?: string[];
  businessStatus?: string;
  reviews?: Array<{
    authorAttribution?: { displayName?: string };
    rating?: number;
    text?: { text?: string };
    relativePublishTimeDescription?: string;
  }>;
}

function inferCategory(types: string[] = [], primaryType = '', requested?: FacilityCategory): FacilityCategory {
  if (requested) return requested;
  const all = [primaryType, ...types].join(' ').toLowerCase();
  if (all.includes('pharmacy') || all.includes('drugstore')) return 'pharmacy';
  if (all.includes('hospital') || all.includes('emergency')) return 'hospital';
  return 'clinic';
}

function mapApiPlaceToFacility(
  place: GooglePlacesApiPlace,
  origin: LatLng,
  requestedCategory?: FacilityCategory
): MedicalFacility | null {
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  const location = { lat, lng };
  const distanceKm = calculateDistanceKm(origin, location);
  const category = inferCategory(place.types, place.primaryType, requestedCategory);

  const openNow =
    typeof place.currentOpeningHours?.openNow === 'boolean'
      ? place.currentOpeningHours.openNow
      : typeof place.regularOpeningHours?.openNow === 'boolean'
        ? place.regularOpeningHours.openNow
        : null;

  const weekdayDescriptions =
    place.currentOpeningHours?.weekdayDescriptions ??
    place.regularOpeningHours?.weekdayDescriptions ??
    [];

  const reviews: PlaceReviewItem[] = (place.reviews ?? [])
    .slice(0, 5)
    .map((r) => ({
      authorName: r.authorAttribution?.displayName || 'Verified Patient',
      rating: typeof r.rating === 'number' ? r.rating : 0,
      text: r.text?.text || '',
      relativePublishTimeDescription: r.relativePublishTimeDescription,
    }))
    .filter((r) => r.text.length > 0);

  return {
    id: place.id || `${lat}-${lng}`,
    name: place.displayName?.text || 'Medical Facility',
    category,
    primaryTypeLabel:
      place.primaryTypeDisplayName?.text ||
      (category === 'pharmacy'
        ? 'Pharmacy'
        : category === 'hospital'
          ? 'Hospital'
          : 'Medical Clinic'),
    address: place.shortFormattedAddress || place.formattedAddress || 'Address unavailable',
    location,
    distanceKm,
    rating: typeof place.rating === 'number' ? place.rating : null,
    userRatingCount: typeof place.userRatingCount === 'number' ? place.userRatingCount : 0,
    openNow,
    hoursSummary: openNow === true ? 'Open now' : openNow === false ? 'Closed now' : null,
    weekdayDescriptions,
    phone: place.nationalPhoneNumber || null,
    websiteUri: sanitizeExternalUrl(place.websiteUri),
    googleMapsUri: sanitizeExternalUrl(place.googleMapsUri),
    directionsUri: sanitizeExternalUrl(place.googleMapsLinks?.directionsUri),
    reviewsUri: sanitizeExternalUrl(place.googleMapsLinks?.reviewsUri),
    reviews,
    businessStatus: place.businessStatus || null,
  };
}

const PLACES_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.shortFormattedAddress',
  'places.location',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.types',
  'places.businessStatus',
  'places.rating',
  'places.userRatingCount',
  'places.currentOpeningHours',
  'places.regularOpeningHours',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.googleMapsLinks',
  'places.reviews',
].join(',');

export async function searchNearbyMedicalPlaces(params: {
  origin: LatLng;
  radiusMeters: number;
  query?: string;
  apiKey: string;
}): Promise<MedicalFacility[]> {
  const { origin, radiusMeters, query, apiKey } = params;
  const clampedRadius = Math.max(500, Math.min(25000, radiusMeters));

  if (query && query.trim().length > 0) {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': PLACES_FIELD_MASK,
        'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
      },
      body: JSON.stringify({
        textQuery: `${query.trim()} clinic pharmacy hospital medical`,
        pageSize: 18,
        locationBias: {
          circle: {
            center: { latitude: origin.lat, longitude: origin.lng },
            radius: clampedRadius,
          },
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Places Text Search failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as { places?: GooglePlacesApiPlace[] };
    return (data.places ?? [])
      .map((p) => mapApiPlaceToFacility(p, origin))
      .filter((f): f is MedicalFacility => f !== null);
  }

  const searches: Array<{ types: string[]; category: FacilityCategory; count: number }> = [
    { types: ['pharmacy', 'drugstore'], category: 'pharmacy', count: 10 },
    { types: ['medical_clinic', 'doctor'], category: 'clinic', count: 8 },
    { types: ['hospital'], category: 'hospital', count: 6 },
  ];

  const results = await Promise.all(
    searches.map(async ({ types, category, count }) => {
      const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': PLACES_FIELD_MASK,
          'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
        },
        body: JSON.stringify({
          includedPrimaryTypes: types,
          maxResultCount: count,
          rankPreference: 'DISTANCE',
          locationRestriction: {
            circle: {
              center: { latitude: origin.lat, longitude: origin.lng },
              radius: clampedRadius,
            },
          },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Places Nearby Search failed (${response.status}): ${text}`);
      }

      const data = (await response.json()) as { places?: GooglePlacesApiPlace[] };
      return (data.places ?? [])
        .map((p) => mapApiPlaceToFacility(p, origin, category))
        .filter((f): f is MedicalFacility => f !== null);
    })
  );

  // Deduplicate by facility id
  const seen: Record<string, boolean> = {};
  const merged: MedicalFacility[] = [];
  for (const list of results) {
    for (const item of list) {
      if (!seen[item.id]) {
        seen[item.id] = true;
        merged.push(item);
      }
    }
  }
  return merged;
}

export async function searchMedicineShopsNearby(params: {
  origin: LatLng;
  radiusMeters: number;
  locationLabel?: string;
  apiKey: string;
}): Promise<MedicalFacility[]> {
  const { origin, radiusMeters, locationLabel, apiKey } = params;
  const clampedRadius = Math.max(2000, Math.min(25000, radiusMeters));

  const locationHint =
    locationLabel && locationLabel !== 'Current Location' ? ` near ${locationLabel}` : '';

  const [nearbyRes, textRes] = await Promise.allSettled([
    fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': PLACES_FIELD_MASK,
        'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
      },
      body: JSON.stringify({
        includedPrimaryTypes: ['pharmacy', 'drugstore'],
        maxResultCount: 10,
        rankPreference: 'DISTANCE',
        locationRestriction: {
          circle: {
            center: { latitude: origin.lat, longitude: origin.lng },
            radius: clampedRadius,
          },
        },
      }),
    }),
    fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': PLACES_FIELD_MASK,
        'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
      },
      body: JSON.stringify({
        textQuery: `pharmacy medical store chemist${locationHint}`,
        pageSize: 10,
        locationBias: {
          circle: {
            center: { latitude: origin.lat, longitude: origin.lng },
            radius: clampedRadius,
          },
        },
      }),
    }),
  ]);

  const collected: MedicalFacility[] = [];
  const seen: Record<string, boolean> = {};

  for (const settled of [nearbyRes, textRes]) {
    if (settled.status !== 'fulfilled' || !settled.value.ok) continue;
    try {
      const data = (await settled.value.json()) as { places?: GooglePlacesApiPlace[] };
      for (const p of data.places ?? []) {
        const mapped = mapApiPlaceToFacility(p, origin, 'pharmacy');
        if (mapped && !seen[mapped.id]) {
          seen[mapped.id] = true;
          collected.push(mapped);
        }
      }
    } catch {
      // Ignore partial parse failure
    }
  }

  return collected.sort((a, b) => a.distanceKm - b.distanceKm);
}

