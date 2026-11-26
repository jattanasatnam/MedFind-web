import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertCircle,
  ExternalLink,
  Globe,
  Navigation,
  Phone,
  Pill,
  Search,
} from 'lucide-react';
import type { LatLng, MedicalFacility, MedicineSearchResult } from '../types/medfind.ts';
import { formatDistanceKm } from '../utils/facilityScoring.ts';
import { sanitizeExternalUrl } from '../utils/urlSafety.ts';

interface MedicineFinderPanelProps {
  facilities: MedicalFacility[];
  origin: LatLng;
  locationLabel: string;
  radiusMeters: number;
  initialMedicine?: string;
  onSelectFacility: (facility: MedicalFacility) => void;
  onRequestRoute?: (facility: MedicalFacility) => void;
}

const COMMON_MEDICINES = [
  'Amoxicillin 500mg',
  'Albuterol Inhaler',
  'Insulin Glargine',
  'Pediatric Ibuprofen',
  'EpiPen Auto-Injector',
];

function getStatusAccent(status: string): string {
  if (status === 'Listed on Clinic/Pharmacy Page') return 'text-emerald-700';
  if (status === 'Pharmacy Department Confirmed') return 'text-teal-800';
  if (status === 'Call Pharmacy to Confirm') return 'text-amber-700';
  return 'text-slate-600';
}

export function MedicineFinderPanel({
  facilities,
  origin,
  locationLabel,
  radiusMeters,
  initialMedicine = '',
  onSelectFacility,
  onRequestRoute,
}: MedicineFinderPanelProps) {
  const [medicineInput, setMedicineInput] = useState(initialMedicine);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MedicineSearchResult | null>(null);

  const runMedicineScan = async (queryText: string) => {
    const trimmed = queryText.trim();
    if (trimmed.length < 2) {
      setError('Enter a medication name (at least 2 characters).');
      return;
    }

    setIsScanning(true);
    setError(null);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 45000);

    try {
      const response = await fetch('/api/ai/medicines', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          medicineQuery: trimmed,
          facilities: facilities.slice(0, 12),
          origin,
          locationLabel,
          radiusMeters,
        }),
      });
      const data = (await response.json()) as MedicineSearchResult & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || 'Unable to search nearby pharmacies and web data.');
      }
      setResult(data);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Medicine search timed out. Please try again.');
      } else {
        setError(
          err instanceof Error ? err.message : 'Medicine webpage and shop search failed.'
        );
      }
    } finally {
      window.clearTimeout(timeoutId);
      setIsScanning(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void runMedicineScan(medicineInput);
  };

  const facilityLookup: Record<string, MedicalFacility> = {};
  for (const f of facilities) {
    facilityLookup[f.id] = f;
  }

  return (
    <div className="flex flex-col h-full bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-slate-200 bg-slate-50/70">
        <h2 className="font-display text-base font-semibold text-slate-900">
          Medicine & Pharmacy Webpage Checker
        </h2>
        <p className="text-xs text-slate-600 mt-1">
          Searches nearby pharmacies, medical stores, clinic webpages, and Google web listings around{' '}
          <span className="font-medium text-slate-800">{locationLabel}</span>.
        </p>

        <form onSubmit={handleSubmit} className="mt-3 flex items-center gap-2">
          <label htmlFor="medicine-query-input" className="sr-only">
            Medication name or formulation
          </label>
          <div className="flex-1 flex items-center border border-slate-300 rounded-lg bg-white focus-within:border-teal-700 focus-within:ring-2 focus-within:ring-teal-700/20">
            <Pill className="w-4 h-4 text-teal-700 ml-3 shrink-0" aria-hidden="true" />
            <input
              id="medicine-query-input"
              type="text"
              value={medicineInput}
              onChange={(e) => setMedicineInput(e.target.value)}
              placeholder="Enter medicine (e.g., Amoxicillin 500mg, Albuterol)…"
              className="w-full px-2.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={isScanning}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Search className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isScanning ? 'Searching…' : 'Check Availability'}</span>
          </button>
        </form>

        {/* Quick medication presets */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-500 mr-1">Common:</span>
          {COMMON_MEDICINES.map((med) => (
            <button
              key={med}
              type="button"
              onClick={() => {
                setMedicineInput(med);
                void runMedicineScan(med);
              }}
              className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md transition-colors cursor-pointer"
            >
              {med}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {isScanning ? (
          <div className="space-y-3" aria-label="Searching nearby pharmacies and web data">
            {[1, 2, 3].map((idx) => (
              <div key={idx} className="animate-pulse p-3 border border-slate-200 rounded-lg space-y-2">
                <div className="h-3 bg-slate-200 rounded w-1/3" />
                <div className="h-4 bg-slate-200 rounded w-2/3" />
                <div className="h-3 bg-slate-100 rounded w-full" />
              </div>
            ))}
          </div>
        ) : result ? (
          <>
            <div className="p-3 bg-teal-50/70 border border-teal-200 rounded-lg">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-teal-900">
                  Clinical & Availability Guidance — {result.medicineQuery}
                </div>
                <span className="text-xs text-teal-800 font-mono tabular-nums">
                  {result.findings.length} shop{result.findings.length === 1 ? '' : 's'}{' '}
                  {result.webSearchUsed ? '· Google Web' : ''}
                </span>
              </div>
              <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                {result.clinicalGuidance}
              </p>
            </div>

            {result.findings.length === 0 ? (
              <div className="p-4 border border-slate-200 rounded-lg text-xs text-slate-600">
                No pharmacies or medical shops were returned within this radius. Try increasing the search radius to 20 km or entering a nearby city in the location bar above.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                {result.findings.map((finding) => {
                  const matched = facilityLookup[finding.facilityId] ?? finding.facility ?? null;
                  const safeWebsite = sanitizeExternalUrl(finding.websiteUri);
                  const safeMaps = sanitizeExternalUrl(finding.googleMapsUri ?? matched?.googleMapsUri);
                  const phone = finding.phone ?? matched?.phone ?? null;
                  const address = finding.address ?? matched?.address ?? null;
                  const distanceKm =
                    typeof finding.distanceKm === 'number'
                      ? finding.distanceKm
                      : matched?.distanceKm ?? null;
                  const openNow =
                    typeof finding.openNow === 'boolean'
                      ? finding.openNow
                      : matched?.openNow ?? null;

                  return (
                    <div key={finding.facilityId} className="p-3.5 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => matched && onSelectFacility(matched)}
                            className="text-left font-display text-sm font-semibold text-slate-900 hover:text-teal-800 cursor-pointer"
                          >
                            {finding.facilityName}
                          </button>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs mt-0.5">
                            <span className={`font-semibold ${getStatusAccent(finding.availabilityStatus)}`}>
                              {finding.availabilityStatus}
                            </span>
                            <span aria-hidden="true" className="text-slate-300">·</span>
                            <span className="text-slate-500">
                              {finding.confidenceLabel}
                            </span>
                            {distanceKm !== null && (
                              <>
                                <span aria-hidden="true" className="text-slate-300">·</span>
                                <span className="font-mono tabular-nums text-slate-600">
                                  {formatDistanceKm(distanceKm)}
                                </span>
                              </>
                            )}
                            {openNow !== null && (
                              <>
                                <span aria-hidden="true" className="text-slate-300">·</span>
                                <span className={openNow ? 'text-emerald-700 font-medium' : 'text-slate-500'}>
                                  {openNow ? 'Open now' : 'Closed now'}
                                </span>
                              </>
                            )}
                          </div>
                          {address && (
                            <p className="text-xs text-slate-500 mt-0.5">{address}</p>
                          )}
                        </div>
                      </div>

                      <p className="text-xs text-slate-700 leading-relaxed">
                        {finding.evidenceSummary}
                      </p>

                      {finding.dosageOrFormNote && (
                        <p className="text-xs text-slate-600">
                          Formulation / Rx note: {finding.dosageOrFormNote}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
                        {matched && onRequestRoute && (
                          <button
                            type="button"
                            onClick={() => onRequestRoute(matched)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <Navigation className="w-3 h-3" aria-hidden="true" />
                            <span>Show Route</span>
                          </button>
                        )}
                        {phone && (
                          <a
                            href={`tel:${phone}`}
                            className="inline-flex items-center gap-1 text-slate-700 hover:underline font-mono tabular-nums whitespace-nowrap shrink-0"
                          >
                            <Phone className="w-3 h-3" aria-hidden="true" />
                            <span>{phone}</span>
                          </a>
                        )}
                        {safeWebsite && (
                          <a
                            href={safeWebsite}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-teal-800 hover:underline whitespace-nowrap shrink-0"
                          >
                            <Globe className="w-3 h-3" aria-hidden="true" />
                            <span>Shop Page</span>
                          </a>
                        )}
                        {safeMaps && (
                          <a
                            href={safeMaps}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0 ml-auto"
                          >
                            <span>Google Maps</span>
                            <ExternalLink className="w-3 h-3" aria-hidden="true" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {result.groundingSources.length > 0 && (
              <div className="pt-2">
                <div className="text-xs font-semibold text-slate-700 mb-1.5">
                  Google Web & Pharmacy Sources Checked
                </div>
                <ul className="space-y-1">
                  {result.groundingSources.map((src, i) => {
                    const safeUri = sanitizeExternalUrl(src.uri);
                    if (!safeUri) return null;
                    return (
                      <li key={i} className="text-xs">
                        <a
                          href={safeUri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-teal-800 hover:underline"
                        >
                          <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                          <span className="truncate max-w-md">{src.title}</span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
              Enter any medication above to scan nearby pharmacy webpages and Google web listings.
            </div>
            {facilities.filter((f) => f.category === 'pharmacy').length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-700">
                  Nearby Pharmacies & Medical Stores ({facilities.filter((f) => f.category === 'pharmacy').length})
                </div>
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                  {facilities
                    .filter((f) => f.category === 'pharmacy')
                    .slice(0, 6)
                    .map((shop) => {
                      const safeSite = sanitizeExternalUrl(shop.websiteUri);
                      const safeMaps = sanitizeExternalUrl(shop.googleMapsUri);
                      return (
                        <div key={shop.id} className="p-3 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => onSelectFacility(shop)}
                              className="text-left font-display text-sm font-semibold text-slate-900 hover:text-teal-800 cursor-pointer"
                            >
                              {shop.name}
                            </button>
                            <span className="text-xs font-mono tabular-nums text-slate-600 shrink-0">
                              {formatDistanceKm(shop.distanceKm)}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500">{shop.address}</p>
                          <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
                            {onRequestRoute && (
                              <button
                                type="button"
                                onClick={() => onRequestRoute(shop)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <Navigation className="w-3 h-3" aria-hidden="true" />
                                <span>Show Route</span>
                              </button>
                            )}
                            {shop.phone && (
                              <a
                                href={`tel:${shop.phone}`}
                                className="inline-flex items-center gap-1 text-slate-700 hover:underline font-mono tabular-nums whitespace-nowrap shrink-0"
                              >
                                <Phone className="w-3 h-3" aria-hidden="true" />
                                <span>{shop.phone}</span>
                              </a>
                            )}
                            {safeSite && (
                              <a
                                href={safeSite}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-teal-800 hover:underline whitespace-nowrap shrink-0"
                              >
                                <Globe className="w-3 h-3" aria-hidden="true" />
                                <span>Shop Page</span>
                              </a>
                            )}
                            {safeMaps && (
                              <a
                                href={safeMaps}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0 ml-auto"
                              >
                                <span>Google Maps</span>
                                <ExternalLink className="w-3 h-3" aria-hidden="true" />
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
