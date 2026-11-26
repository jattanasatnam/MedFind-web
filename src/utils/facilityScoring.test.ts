import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDistanceKm,
  computeBayesianRating,
  computeFacilityPriorityScore,
  computeOpenNowFromPeriods,
  formatDistanceKm,
  getTodayHoursSummary,
  rankFacilitiesByAvailabilityAndRating,
  rankHospitalsByReviewsAndProximity,
} from './facilityScoring';
import { isSafePublicHttpUrl, sanitizeExternalUrl } from './urlSafety';
import type { MedicalFacility } from '../types/medfind';

function makeFacility(overrides: Partial<MedicalFacility>): MedicalFacility {
  return {
    id: 'fac-1',
    name: 'Test Medical Center',
    category: 'clinic',
    primaryTypeLabel: 'Medical Clinic',
    address: '100 Market St, San Francisco, CA',
    location: { lat: 37.7749, lng: -122.4194 },
    distanceKm: 1.0,
    rating: 4.5,
    userRatingCount: 100,
    openNow: true,
    hoursSummary: 'Open until 8:00 PM',
    weekdayDescriptions: [],
    phone: '(415) 555-0100',
    websiteUri: 'https://example.org',
    googleMapsUri: 'https://maps.google.com/?cid=123',
    directionsUri: 'https://maps.google.com/?daddr=37.7749,-122.4194',
    reviewsUri: null,
    reviews: [],
    businessStatus: 'OPERATIONAL',
    ...overrides,
  };
}

test('calculateDistanceKm computes accurate Haversine distance', () => {
  const sf = { lat: 37.7749, lng: -122.4194 };
  const oakland = { lat: 37.8044, lng: -122.2712 };
  const dist = calculateDistanceKm(sf, oakland);
  assert.ok(dist > 12 && dist < 15, `Expected ~13.4 km, got ${dist}`);
  assert.equal(calculateDistanceKm(sf, sf), 0);
});

test('formatDistanceKm formats sub-km in meters and >=1km in km', () => {
  assert.equal(formatDistanceKm(0.45), '450 m');
  assert.equal(formatDistanceKm(2.34), '2.3 km');
});

test('computeBayesianRating dampens single-review 5.0 ratings below high-volume 4.8', () => {
  const oneReviewFive = computeBayesianRating(5.0, 1);
  const manyReviewsFourEight = computeBayesianRating(4.8, 250);
  assert.ok(manyReviewsFourEight > oneReviewFive);
});

test('rankFacilitiesByAvailabilityAndRating prioritizes open high-rated nearby facilities over closed ones', () => {
  const closedHigh = makeFacility({
    id: 'closed-high',
    name: 'Closed High Rated',
    openNow: false,
    rating: 4.9,
    userRatingCount: 300,
    distanceKm: 0.3,
  });
  const openGood = makeFacility({
    id: 'open-good',
    name: 'Open Reliable Clinic',
    openNow: true,
    rating: 4.6,
    userRatingCount: 150,
    distanceKm: 1.2,
  });
  const openFar = makeFacility({
    id: 'open-far',
    name: 'Open Far Clinic',
    openNow: true,
    rating: 4.2,
    userRatingCount: 40,
    distanceKm: 11.0,
  });

  const ranked = rankFacilitiesByAvailabilityAndRating([closedHigh, openFar, openGood]);
  assert.equal(ranked[0].id, 'open-good');
  assert.equal(ranked[1].id, 'open-far');
  assert.equal(ranked[2].id, 'closed-high');
  assert.equal(ranked[2].scoring.tierLabel, 'Closed Now');
  assert.equal(computeFacilityPriorityScore(openGood).tierLabel, 'Top Priority');
});

test('rankHospitalsByReviewsAndProximity filters to hospitals and weights review volume', () => {
  const clinic = makeFacility({ id: 'c1', category: 'clinic' });
  const smallHospital = makeFacility({
    id: 'h-small',
    category: 'hospital',
    rating: 4.5,
    userRatingCount: 15,
    distanceKm: 2.0,
  });
  const majorHospital = makeFacility({
    id: 'h-major',
    category: 'hospital',
    rating: 4.6,
    userRatingCount: 420,
    distanceKm: 2.1,
  });

  const ranked = rankHospitalsByReviewsAndProximity([clinic, smallHospital, majorHospital]);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].id, 'h-major');
});

test('sanitizeExternalUrl and isSafePublicHttpUrl block unsafe schemes and private hosts', () => {
  assert.equal(sanitizeExternalUrl('https://clinic.example.com/pharmacy'), 'https://clinic.example.com/pharmacy');
  assert.equal(sanitizeExternalUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeExternalUrl('data:text/html,hi'), null);
  assert.equal(isSafePublicHttpUrl('https://walgreens.com/store'), true);
  assert.equal(isSafePublicHttpUrl('http://127.0.0.1:8080/admin'), false);
  assert.equal(isSafePublicHttpUrl('http://169.254.169.254/latest/meta-data'), false);
  assert.equal(isSafePublicHttpUrl('http://localhost:3000'), false);
});

test('computeOpenNowFromPeriods and getTodayHoursSummary evaluate real-time schedule accurately', () => {
  // 24-hour facility
  assert.equal(
    computeOpenNowFromPeriods([{ open: { day: 0, hour: 0, minute: 0 }, close: null }], -480),
    true
  );
  // Wednesday 10:00 AM PST (-480 min) => 2026-11-25T18:00:00Z is Wed 10:00 AM PST
  const wedMorning = new Date('2026-11-25T18:00:00Z');
  const wedNight = new Date('2026-11-26T05:00:00Z'); // Wed 9:00 PM PST
  const periods = [
    { open: { day: 3, hour: 9, minute: 0 }, close: { day: 3, hour: 18, minute: 30 } },
  ];
  assert.equal(computeOpenNowFromPeriods(periods, -480, wedMorning), true);
  assert.equal(computeOpenNowFromPeriods(periods, -480, wedNight), false);
  assert.equal(
    getTodayHoursSummary(['Wednesday: 9:00 AM – 6:30 PM'], -480, wedMorning),
    '9:00 AM – 6:30 PM'
  );
});
