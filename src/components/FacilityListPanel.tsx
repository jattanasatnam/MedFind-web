import {
  AlertCircle,
  Bookmark,
  CheckCircle2,
  Clock,
  ExternalLink,
  Navigation,
  Pill,
  RefreshCw,
} from 'lucide-react';
import type {
  AiPrioritizationResult,
  MedicalFacility,
  PriorityRankedFacility,
} from '../types/medfind.ts';
import { formatDistanceKm } from '../utils/facilityScoring.ts';
import { sanitizeExternalUrl } from '../utils/urlSafety.ts';

interface FacilityListPanelProps {
  facilities: Array<MedicalFacility & { scoring: PriorityRankedFacility }>;
  isLoading: boolean;
  error: string | null;
  selectedFacilityId: string | null;
  savedIds: Record<string, boolean>;
  aiAnalysis: AiPrioritizationResult | null;
  aiError: string | null;
  onSelectFacility: (facility: MedicalFacility) => void;
  onHoverFacility: (id: string | null) => void;
  onRequestRoute: (facility: MedicalFacility) => void;
  onToggleSave: (facility: MedicalFacility) => void;
  onCheckMedicineForFacility: (facility: MedicalFacility) => void;
  onRetry: () => void;
  onResetFilters: () => void;
}

function getAvailabilityTextClass(openNow: boolean | null): string {
  if (openNow === true) return 'text-emerald-700';
  if (openNow === false) return 'text-rose-700';
  return 'text-amber-700';
}

export function FacilityListPanel({
  facilities,
  isLoading,
  error,
  selectedFacilityId,
  savedIds,
  aiAnalysis,
  aiError,
  onSelectFacility,
  onHoverFacility,
  onRequestRoute,
  onToggleSave,
  onCheckMedicineForFacility,
  onRetry,
  onResetFilters,
}: FacilityListPanelProps) {
  const aiById: Record<string, AiPrioritizationResult['rankedFacilities'][number]> = {};
  if (aiAnalysis) {
    for (const item of aiAnalysis.rankedFacilities) {
      aiById[item.facilityId] = item;
    }
  }

  return (
    <div className="flex flex-col h-full bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50/70">
        <div>
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Nearby Medical Facilities
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
            {isLoading
              ? 'Scanning nearby clinics, pharmacies & hospitals…'
              : `${facilities.length} facilities ranked by real-time availability, rating & distance`}
          </p>
        </div>
      </div>

      {/* AI Prioritization Summary */}
      {aiAnalysis && (
        <div className="px-4 py-3 bg-teal-50/60 border-b border-teal-200/80">
          <div className="text-xs font-semibold text-teal-900">
            AI Availability Prioritization
          </div>
          <p className="text-xs text-slate-700 mt-1 leading-relaxed">
            {aiAnalysis.overview}
          </p>
        </div>
      )}

      {aiError && (
        <div className="px-4 py-2.5 bg-rose-50 border-b border-rose-200 text-xs text-rose-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{aiError}</span>
        </div>
      )}

      {/* List Content */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-200">
        {isLoading ? (
          <div className="p-4 space-y-4" aria-label="Loading facilities">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="animate-pulse space-y-2 pb-3 border-b border-slate-100">
                <div className="h-3 bg-slate-200 rounded w-1/3" />
                <div className="h-4 bg-slate-200 rounded w-3/4" />
                <div className="h-3 bg-slate-100 rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-center">
            <AlertCircle className="w-8 h-8 text-rose-600 mx-auto" aria-hidden="true" />
            <h3 className="mt-2 text-sm font-semibold text-slate-900">
              Could not load nearby facilities
            </h3>
            <p className="mt-1 text-xs text-slate-600">{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Retry Search</span>
            </button>
          </div>
        ) : facilities.length === 0 ? (
          <div className="p-6 text-center">
            <h3 className="text-sm font-semibold text-slate-900">
              No facilities match your current filters
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              Try expanding the search radius or disabling the Open Now filter.
            </p>
            <button
              type="button"
              onClick={onResetFilters}
              className="mt-4 px-4 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          facilities.map((facility) => {
            const isSelected = selectedFacilityId === facility.id;
            const isSaved = Boolean(savedIds[facility.id]);
            const aiEntry = aiById[facility.id];
            const safeMapsUri = sanitizeExternalUrl(facility.googleMapsUri);

            return (
              <article
                key={facility.id}
                onMouseEnter={() => onHoverFacility(facility.id)}
                onMouseLeave={() => onHoverFacility(null)}
                className={`p-4 transition-colors duration-150 ${
                  isSelected ? 'bg-teal-50/40' : 'hover:bg-slate-50/80'
                }`}
              >
                {/* Unboxed metadata line */}
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="font-medium text-slate-700">
                      {facility.primaryTypeLabel}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {formatDistanceKm(facility.distanceKm)}
                    </span>
                    {facility.rating !== null && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums text-slate-700">
                          {facility.rating.toFixed(1)} ({facility.userRatingCount})
                        </span>
                      </>
                    )}
                  </div>
                  <span className="font-mono tabular-nums text-xs font-medium text-slate-700 shrink-0">
                    Score {facility.scoring.priorityScore}
                  </span>
                </div>

                {/* Facility Title */}
                <div className="mt-1 flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectFacility(facility)}
                    className="text-left font-display text-base font-semibold text-slate-900 hover:text-teal-800 transition-colors cursor-pointer"
                  >
                    {facility.name}
                  </button>
                  <button
                    type="button"
                    aria-label={isSaved ? `Remove ${facility.name} from saved care` : `Save ${facility.name}`}
                    onClick={() => onToggleSave(facility)}
                    className={`p-1.5 rounded-md transition-colors cursor-pointer shrink-0 ${
                      isSaved
                        ? 'text-teal-700 bg-teal-50'
                        : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Bookmark
                      className="w-4 h-4"
                      fill={isSaved ? 'currentColor' : 'none'}
                      aria-hidden="true"
                    />
                  </button>
                </div>

                <p className="text-xs text-slate-600 mt-0.5">{facility.address}</p>

                {/* Real-time Availability Line */}
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  <span
                    className={`inline-flex items-center gap-1 font-medium whitespace-nowrap ${getAvailabilityTextClass(
                      facility.openNow
                    )}`}
                  >
                    {facility.openNow === true ? (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    ) : (
                      <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    )}
                    <span>
                      {facility.openNow === true
                        ? 'Open now'
                        : facility.openNow === false
                          ? 'Closed now'
                          : 'Confirm hours'}
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                  <span className="text-slate-600">
                    {facility.hoursSummary || facility.scoring.tierLabel}
                  </span>
                </div>

                {/* AI Summary if present */}
                {aiEntry && (
                  <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-700 space-y-1">
                    <div className="font-medium text-teal-900">
                      #{aiEntry.priorityRank} — {aiEntry.availabilityVerdict}
                    </div>
                    <p>{aiEntry.clinicalSummary}</p>
                    {aiEntry.watchout && (
                      <p className="text-amber-800">Note: {aiEntry.watchout}</p>
                    )}
                  </div>
                )}

                {/* Action buttons */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectFacility(facility)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Details
                  </button>
                  <button
                    type="button"
                    onClick={() => onRequestRoute(facility)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Navigation className="w-3 h-3 shrink-0" aria-hidden="true" />
                    <span>Show Route</span>
                  </button>
                  {(facility.category === 'pharmacy' || facility.category === 'clinic') && (
                    <button
                      type="button"
                      onClick={() => onCheckMedicineForFacility(facility)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Pill className="w-3 h-3 shrink-0" aria-hidden="true" />
                      <span>Check Medicine</span>
                    </button>
                  )}
                  {safeMapsUri && (
                    <a
                      href={safeMapsUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0 ml-auto"
                    >
                      <span>Maps</span>
                      <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
