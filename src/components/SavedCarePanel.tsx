import { Bookmark, ExternalLink, Navigation, Trash2 } from 'lucide-react';
import type { MedicalFacility } from '../types/medfind.ts';
import { formatDistanceKm } from '../utils/facilityScoring.ts';
import { sanitizeExternalUrl } from '../utils/urlSafety.ts';

interface SavedCarePanelProps {
  savedFacilities: MedicalFacility[];
  onSelectFacility: (facility: MedicalFacility) => void;
  onRequestRoute: (facility: MedicalFacility) => void;
  onRemoveSaved: (facility: MedicalFacility) => void;
}

export function SavedCarePanel({
  savedFacilities,
  onSelectFacility,
  onRequestRoute,
  onRemoveSaved,
}: SavedCarePanelProps) {
  return (
    <div className="flex flex-col h-full bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-slate-200 bg-slate-50/70">
        <h2 className="font-display text-base font-semibold text-slate-900">
          Saved Care Directory
        </h2>
        <p className="text-xs text-slate-600 mt-0.5">
          Bookmarked clinics, pharmacies, and hospitals for quick access.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-200">
        {savedFacilities.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <Bookmark className="w-7 h-7 text-slate-300 mx-auto" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-slate-900">No saved facilities yet</h3>
            <p className="text-xs text-slate-600 max-w-xs mx-auto">
              Bookmark any clinic, pharmacy, or hospital from the Facility Map to keep its hours and route one click away.
            </p>
          </div>
        ) : (
          savedFacilities.map((facility) => {
            const safeMapsUri = sanitizeExternalUrl(facility.googleMapsUri);
            return (
              <article key={facility.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span>
                    {facility.primaryTypeLabel} ·{' '}
                    <span className="font-mono tabular-nums">
                      {formatDistanceKm(facility.distanceKm)}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${facility.name} from saved care`}
                    onClick={() => onRemoveSaved(facility)}
                    className="p-1 text-slate-400 hover:text-rose-700 rounded cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectFacility(facility)}
                  className="text-left font-display text-sm font-semibold text-slate-900 hover:text-teal-800 cursor-pointer"
                >
                  {facility.name}
                </button>
                <p className="text-xs text-slate-600">{facility.address}</p>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onRequestRoute(facility)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-md cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Navigation className="w-3 h-3" aria-hidden="true" />
                    <span>Show Route</span>
                  </button>
                  {safeMapsUri && (
                    <a
                      href={safeMapsUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 ml-auto whitespace-nowrap shrink-0"
                    >
                      <span>Google Maps</span>
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />
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
