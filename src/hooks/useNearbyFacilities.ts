import { useCallback, useEffect, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import type { FacilityCategory, LatLng, MedicalFacility, PlaceReviewItem } from '../types/medfind.ts';
import {
  calculateDistanceKm,
  computeOpenNowFromPeriods,
  getTodayHoursSummary,
} from '../utils/facilityScoring.ts';
import { sanitizeExternalUrl } from '../utils/urlSafety.ts';

function inferCategoryFromTypes(
  types: string[] = [],
  primaryType = '',
  fallback?: FacilityCategory
): FacilityCategory {
  if (fallback) return fallback;
  const joined = [primaryType, ...types].join(' ').toLowerCase();
  if (joined.includes('pharmacy') || joined.includes('drugstore')) return 'pharmacy';
  if (joined.includes('hospital') || joined.includes('emergency')) return 'hospital';
  return 'clinic';
}

async function convertJsPlaceToFacility(
  place: google.maps.places.Place,
  origin: LatLng,
  fallbackCategory?: FacilityCategory
): Promise<MedicalFacility | null> {
  const loc = place.location;
  if (!loc) return null;

  const lat = typeof loc.lat === 'function' ? loc.lat() : Number(loc.lat);
  const lng = typeof loc.lng === 'function' ? loc.lng() : Number(loc.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const weekdayDescriptions = place.regularOpeningHours?.weekdayDescriptions ?? [];
  let openNow: boolean | null = null;
  try {
    if (typeof place.isOpen === 'function') {
      const openResult = await place.isOpen();
      if (typeof openResult === 'boolean') {
        openNow = openResult;
      }
    }
  } catch {
    openNow = null;
  }

  if (openNow === null && place.regularOpeningHours?.periods) {
    openNow = computeOpenNowFromPeriods(
      place.regularOpeningHours.periods as Array<{
        open: { day: number; hour: number; minute: number };
        close?: { day: number; hour: number; minute: number } | null;
      }>,
      place.utcOffsetMinutes
    );
  }

  const todayHours = getTodayHoursSummary(
    weekdayDescriptions,
    place.utcOffsetMinutes
  );

  const category = inferCategoryFromTypes(
    place.types ?? [],
    place.primaryType ?? '',
    fallbackCategory
  );

  const reviews: PlaceReviewItem[] = (place.reviews ?? [])
    .slice(0, 5)
    .map((r) => ({
      authorName: r.authorAttribution?.displayName || 'Verified Patient',
      rating: typeof r.rating === 'number' ? r.rating : 0,
      text: r.text || '',
      relativePublishTimeDescription: r.relativePublishTimeDescription ?? undefined,
    }))
    .filter((r) => r.text.length > 0);

  return {
    id: place.id || `${lat.toFixed(5)}-${lng.toFixed(5)}`,
    name: place.displayName || 'Medical Facility',
    category,
    primaryTypeLabel:
      place.primaryTypeDisplayName ||
      (category === 'pharmacy'
        ? 'Pharmacy'
        : category === 'hospital'
          ? 'Hospital'
          : 'Medical Clinic'),
    address: place.formattedAddress || 'Address unavailable',
    location: { lat, lng },
    distanceKm: calculateDistanceKm(origin, { lat, lng }),
    rating: typeof place.rating === 'number' ? place.rating : null,
    userRatingCount: typeof place.userRatingCount === 'number' ? place.userRatingCount : 0,
    openNow,
    hoursSummary: todayHours,
    weekdayDescriptions,
    phone: place.nationalPhoneNumber || null,
    websiteUri: sanitizeExternalUrl(place.websiteURI),
    googleMapsUri: sanitizeExternalUrl(place.googleMapsURI),
    directionsUri: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
    reviewsUri: sanitizeExternalUrl(place.googleMapsURI),
    reviews,
    businessStatus: place.businessStatus ?? null,
  };
}

const JS_PLACE_FIELDS: string[] = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'rating',
  'userRatingCount',
  'regularOpeningHours',
  'utcOffsetMinutes',
  'websiteURI',
  'nationalPhoneNumber',
  'googleMapsURI',
  'reviews',
  'primaryType',
  'primaryTypeDisplayName',
  'types',
  'businessStatus',
];

export function useNearbyFacilities(
  origin: LatLng,
  radiusMeters: number,
  searchQuery: string,
  mapsReady = true
) {
  const placesLib = useMapsLibrary('places');
  const [facilities, setFacilities] = useState<MedicalFacility[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFacilities = useCallback(async () => {
    if (mapsReady && !placesLib) {
      setIsLoading(true);
      return;
    }
    setIsLoading(true);
    setError(null);

    try {
      // Prefer client-side Places JS SDK when loaded so HTTP-referrer keys work seamlessly
      if (placesLib?.Place) {
        const trimmed = searchQuery.trim();
        let rawResults: Array<{ place: google.maps.places.Place; category?: FacilityCategory }> = [];

        if (trimmed.length > 0) {
          const textRes = await placesLib.Place.searchByText({
            fields: JS_PLACE_FIELDS,
            textQuery: `${trimmed} pharmacy medical store clinic hospital`,
            maxResultCount: 18,
            locationBias: {
              center: origin,
              radius: Math.min(25000, Math.max(1000, radiusMeters)),
            },
          });
          rawResults = (textRes.places ?? []).map((place) => ({ place }));
        } else {
          const groups: Array<{ types: string[]; category: FacilityCategory; count: number }> = [
            { types: ['pharmacy', 'drugstore'], category: 'pharmacy', count: 10 },
            { types: ['medical_clinic', 'doctor'], category: 'clinic', count: 8 },
            { types: ['hospital'], category: 'hospital', count: 6 },
          ];

          const groupResponses = await Promise.all(
            groups.map(async ({ types, category, count }) => {
              const res = await placesLib.Place.searchNearby({
                fields: JS_PLACE_FIELDS,
                locationRestriction: {
                  center: origin,
                  radius: Math.min(25000, Math.max(1000, radiusMeters)),
                },
                includedPrimaryTypes: types,
                maxResultCount: count,
                rankPreference: placesLib.SearchNearbyRankPreference.DISTANCE,
              });
              return (res.places ?? []).map((place) => ({ place, category }));
            })
          );
          rawResults = groupResponses.flat();

          const pharmacyCount = rawResults.filter((r) => r.category === 'pharmacy').length;
          if (pharmacyCount < 3) {
            try {
              const shopTextRes = await placesLib.Place.searchByText({
                fields: JS_PLACE_FIELDS,
                textQuery: 'pharmacy medical store chemist',
                maxResultCount: 8,
                locationBias: {
                  center: origin,
                  radius: Math.min(25000, Math.max(2000, radiusMeters)),
                },
              });
              for (const place of shopTextRes.places ?? []) {
                rawResults.push({ place, category: 'pharmacy' });
              }
            } catch {
              // Keep primary nearby results
            }
          }
        }

        const converted = await Promise.all(
          rawResults.map(({ place, category }) =>
            convertJsPlaceToFacility(place, origin, category)
          )
        );

        const seen: Record<string, boolean> = {};
        const deduped: MedicalFacility[] = [];
        for (const item of converted) {
          if (item && !seen[item.id]) {
            seen[item.id] = true;
            deduped.push(item);
          }
        }
        setFacilities(deduped);
        setIsLoading(false);
        return;
      }

      // Fallback to server-side Places API (New) REST proxy if JS Places library isn't ready
      const res = await fetch('/api/places/nearby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: origin.lat,
          lng: origin.lng,
          radiusMeters,
          query: searchQuery.trim() || undefined,
        }),
      });

      if (res.status === 429) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      }

      const data = (await res.json()) as { facilities?: MedicalFacility[]; error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load nearby medical facilities.');
      }
      setFacilities(data.facilities ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('OVER_QUERY_LIMIT') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('429')
      ) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      }
      // Attempt server proxy fallback once if client Places call failed
      if (placesLib?.Place) {
        try {
          const fallbackRes = await fetch('/api/places/nearby', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lat: origin.lat,
              lng: origin.lng,
              radiusMeters,
              query: searchQuery.trim() || undefined,
            }),
          });
          if (fallbackRes.ok) {
            const fallbackData = (await fallbackRes.json()) as {
              facilities?: MedicalFacility[];
            };
            setFacilities(fallbackData.facilities ?? []);
            setIsLoading(false);
            return;
          }
        } catch {
          // Proceed to surface original error
        }
      }
      setError(msg || 'Unable to locate nearby facilities right now.');
    } finally {
      setIsLoading(false);
    }
  }, [placesLib, origin.lat, origin.lng, radiusMeters, searchQuery]);

  useEffect(() => {
    void fetchFacilities();
  }, [fetchFacilities]);

  return {
    facilities,
    isLoading,
    error,
    refresh: fetchFacilities,
  };
}
