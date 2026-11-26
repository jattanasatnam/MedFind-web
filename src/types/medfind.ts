export type FacilityCategory = 'clinic' | 'pharmacy' | 'hospital';

export type AvailabilityFilter = 'all' | FacilityCategory;

export type WorkspaceView = 'map' | 'medicines' | 'hospitals' | 'saved';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PlaceReviewItem {
  authorName: string;
  rating: number;
  text: string;
  relativePublishTimeDescription?: string;
}

export interface MedicalFacility {
  id: string;
  name: string;
  category: FacilityCategory;
  primaryTypeLabel: string;
  address: string;
  location: LatLng;
  distanceKm: number;
  rating: number | null;
  userRatingCount: number;
  openNow: boolean | null;
  hoursSummary: string | null;
  weekdayDescriptions: string[];
  phone: string | null;
  websiteUri: string | null;
  googleMapsUri: string | null;
  directionsUri: string | null;
  reviewsUri: string | null;
  reviews: PlaceReviewItem[];
  businessStatus: string | null;
}

export interface PriorityRankedFacility {
  facilityId: string;
  priorityScore: number;
  tierLabel: 'Top Priority' | 'Recommended' | 'Alternative' | 'Closed Now';
  reasons: string[];
}

export interface AiFacilityAnalysisItem {
  facilityId: string;
  facilityName: string;
  priorityRank: number;
  availabilityVerdict: string;
  clinicalSummary: string;
  watchout: string | null;
}

export interface AiPrioritizationResult {
  overview: string;
  topPickId: string | null;
  rankedFacilities: AiFacilityAnalysisItem[];
}

export type MedicineStockStatus =
  | 'Listed on Clinic/Pharmacy Page'
  | 'Pharmacy Department Confirmed'
  | 'Call Pharmacy to Confirm'
  | 'Not Listed Online';

export interface MedicineSourceLink {
  title: string;
  uri: string;
}

export interface MedicineFacilityFinding {
  facilityId: string;
  facilityName: string;
  address?: string | null;
  distanceKm?: number | null;
  openNow?: boolean | null;
  phone?: string | null;
  websiteUri: string | null;
  googleMapsUri?: string | null;
  facility?: MedicalFacility | null;
  availabilityStatus: MedicineStockStatus;
  confidenceLabel: 'High' | 'Moderate' | 'Verify by Phone';
  evidenceSummary: string;
  dosageOrFormNote: string | null;
  sourceLinks: MedicineSourceLink[];
}

export interface MedicineSearchResult {
  medicineQuery: string;
  clinicalGuidance: string;
  findings: MedicineFacilityFinding[];
  groundingSources: MedicineSourceLink[];
  nearbyShopsCount?: number;
  webSearchUsed?: boolean;
}

export interface HospitalRecommendationItem {
  facilityId: string;
  hospitalName: string;
  rank: number;
  reviewSentimentScore: string;
  proximityNote: string;
  patientReviewHighlights: string[];
  potentialDrawback: string | null;
  bestFor: string;
}

export interface HospitalRecommendationResult {
  summary: string;
  recommendations: HospitalRecommendationItem[];
}

export interface RouteSummaryInfo {
  facilityId: string;
  facilityName: string;
  distanceMeters: number;
  durationMillis: number;
  travelMode: 'DRIVING' | 'WALKING';
}
