import {
  Bookmark,
  Clock,
  ExternalLink,
  Globe,
  Navigation,
  Phone,
  Pill,
  Star,
  X,
} from 'lucide-react';
import type { MedicalFacility } from '../types/medfind.ts';
import { formatDistanceKm } from '../utils/facilityScoring.ts';
import { sanitizeExternalUrl } from '../utils/urlSafety.ts';

interface FacilityDetailDrawerProps {
  facility: MedicalFacility;
  isSaved: boolean;
  onClose: () => void;
  onRequestRoute: (facility: MedicalFacility) => void;
  onToggleSave: (facility: MedicalFacility) => void;
  onCheckMedicine: (facility: MedicalFacility) => void;
}

export function FacilityDetailDrawer({
  facility,
  isSaved,
  onClose,
  onRequestRoute,
  onToggleSave,
  onCheckMedicine,
}: FacilityDetailDrawerProps) {
  const safeWebsite = sanitizeExternalUrl(facility.websiteUri);
  const safeMapsUri = sanitizeExternalUrl(facility.googleMapsUri);

  return (
    <aside
      aria-label={`Details for ${facility.name}`}
      className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="font-medium text-teal-800">{facility.primaryTypeLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {formatDistanceKm(facility.distanceKm)}
            </span>
            {facility.rating !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 font-mono tabular-nums text-slate-800">
                  <Star className="w-3 h-3 text-amber-500 fill-amber-500" aria-hidden="true" />
                  {facility.rating.toFixed(1)} ({facility.userRatingCount} reviews)
                </span>
              </>
            )}
          </div>
          <h3 className="font-display text-lg font-bold text-slate-900 mt-1">
            {facility.name}
          </h3>
          <p className="text-sm text-slate-600 mt-0.5">{facility.address}</p>
        </div>

        <button
          type="button"
          aria-label="Close facility details"
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {/* Primary actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onRequestRoute(facility)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer"
        >
          <Navigation className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Show Route on Map</span>
        </button>
        <button
          type="button"
          onClick={() => onCheckMedicine(facility)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg cursor-pointer"
        >
          <Pill className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Check Medicine Availability</span>
        </button>
        <button
          type="button"
          onClick={() => onToggleSave(facility)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
        >
          <Bookmark
            className="w-3.5 h-3.5"
            fill={isSaved ? 'currentColor' : 'none'}
            aria-hidden="true"
          />
          <span>{isSaved ? 'Saved' : 'Save'}</span>
        </button>
      </div>

      {/* Contact & Attribution links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-100 text-xs">
        {facility.phone && (
          <div className="flex items-center gap-2 text-slate-700">
            <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
            <a href={`tel:${facility.phone}`} className="hover:underline font-mono tabular-nums">
              {facility.phone}
            </a>
          </div>
        )}
        {safeWebsite && (
          <div className="flex items-center gap-2 text-slate-700 truncate">
            <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
            <a
              href={safeWebsite}
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-800 hover:underline truncate"
            >
              Visit Official Website
            </a>
          </div>
        )}
        {safeMapsUri && (
          <div className="flex items-center gap-2 text-slate-700">
            <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
            <a
              href={safeMapsUri}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-700 hover:underline"
            >
              View Place & Reviews on Google Maps
            </a>
          </div>
        )}
      </div>

      {/* Hours */}
      {facility.weekdayDescriptions.length > 0 && (
        <div className="pt-3 border-t border-slate-100">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 mb-2">
            <Clock className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            <span>Operating Hours</span>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs text-slate-600 font-mono tabular-nums">
            {facility.weekdayDescriptions.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Patient Reviews */}
      {facility.reviews.length > 0 && (
        <div className="pt-3 border-t border-slate-100 space-y-2.5">
          <div className="text-xs font-semibold text-slate-800">
            Recent Patient Reviews
          </div>
          {facility.reviews.slice(0, 3).map((review, idx) => (
            <div key={idx} className="bg-slate-50 rounded-lg p-3 border border-slate-100">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-medium text-slate-800">{review.authorName}</span>
                <span className="font-mono tabular-nums">
                  {review.rating.toFixed(1)} / 5
                  {review.relativePublishTimeDescription
                    ? ` · ${review.relativePublishTimeDescription}`
                    : ''}
                </span>
              </div>
              <p className="text-xs text-slate-700 mt-1 leading-relaxed line-clamp-3">
                {review.text}
              </p>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
