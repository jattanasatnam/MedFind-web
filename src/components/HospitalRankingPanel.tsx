import { useState } from 'react';
import { AlertCircle, ExternalLink, Navigation, Sparkles, Star } from 'lucide-react';
import type {
  HospitalRecommendationResult,
  MedicalFacility,
  PriorityRankedFacility,
} from '../types/medfind.ts';
import { formatDistanceKm } from '../utils/facilityScoring.ts';
import { sanitizeExternalUrl } from '../utils/urlSafety.ts';

interface HospitalRankingPanelProps {
  hospitals: Array<MedicalFacility & { scoring: PriorityRankedFacility }>;
  onSelectFacility: (facility: MedicalFacility) => void;
  onRequestRoute: (facility: MedicalFacility) => void;
}

export function HospitalRankingPanel({
  hospitals,
  onSelectFacility,
  onRequestRoute,
}: HospitalRankingPanelProps) {
  const [analysis, setAnalysis] = useState<HospitalRecommendationResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runHospitalAnalysis = async () => {
    if (hospitals.length === 0) {
      setError('No nearby hospitals found in the current radius.');
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      const response = await fetch('/api/ai/hospitals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hospitals }),
      });
      const data = (await response.json()) as HospitalRecommendationResult & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || 'Failed to analyze hospital reviews.');
      }
      setAnalysis(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to analyze hospital reviews.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const recById: Record<
    string,
    HospitalRecommendationResult['recommendations'][number]
  > = {};
  if (analysis) {
    for (const rec of analysis.recommendations) {
      recById[rec.facilityId] = rec;
    }
  }

  return (
    <div className="flex flex-col h-full bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            Best Hospital Recommendations
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Ranked by verified patient reviews, rating confidence, and proximity.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void runHospitalAnalysis()}
          disabled={isAnalyzing || hospitals.length === 0}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{isAnalyzing ? 'Analyzing Reviews…' : 'Analyze Patient Reviews'}</span>
        </button>
      </div>

      {analysis && (
        <div className="px-4 py-3 bg-teal-50/60 border-b border-teal-200">
          <div className="text-xs font-semibold text-teal-900">
            Patient Review & Proximity Summary
          </div>
          <p className="text-xs text-slate-700 mt-1 leading-relaxed">
            {analysis.summary}
          </p>
        </div>
      )}

      {error && (
        <div className="px-4 py-2.5 bg-rose-50 border-b border-rose-200 text-xs text-rose-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto divide-y divide-slate-200">
        {hospitals.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-600">
            No hospitals found within the current search radius. Try increasing the radius in the search bar.
          </div>
        ) : (
          hospitals.map((hospital, idx) => {
            const rec = recById[hospital.id];
            const safeMapsUri = sanitizeExternalUrl(hospital.googleMapsUri);
            return (
              <article key={hospital.id} className="p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                  <div className="flex items-center gap-2">
                    <span className="font-mono tabular-nums font-semibold text-slate-900">
                      0{rec?.rank ?? idx + 1}.
                    </span>
                    <span className="font-mono tabular-nums">
                      {formatDistanceKm(hospital.distanceKm)}
                    </span>
                    {hospital.rating !== null && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 font-mono tabular-nums text-slate-800">
                          <Star className="w-3 h-3 text-amber-500 fill-amber-500" aria-hidden="true" />
                          {hospital.rating.toFixed(1)} ({hospital.userRatingCount} reviews)
                        </span>
                      </>
                    )}
                  </div>
                  <span className="font-mono tabular-nums text-slate-700 font-medium">
                    Score {hospital.scoring.priorityScore}
                  </span>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() => onSelectFacility(hospital)}
                    className="text-left font-display text-base font-semibold text-slate-900 hover:text-teal-800 cursor-pointer"
                  >
                    {hospital.name}
                  </button>
                  <p className="text-xs text-slate-600 mt-0.5">{hospital.address}</p>
                </div>

                {rec ? (
                  <div className="pt-2 border-t border-slate-100 space-y-1.5 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-teal-900">
                        {rec.reviewSentimentScore}
                      </span>
                      <span aria-hidden="true" className="text-slate-300">·</span>
                      <span className="text-slate-700">Best for: {rec.bestFor}</span>
                    </div>
                    {rec.patientReviewHighlights.length > 0 && (
                      <ul className="list-disc list-inside text-slate-700 space-y-0.5">
                        {rec.patientReviewHighlights.map((hl, i) => (
                          <li key={i}>{hl}</li>
                        ))}
                      </ul>
                    )}
                    {rec.potentialDrawback && (
                      <p className="text-amber-800">
                        Review watchout: {rec.potentialDrawback}
                      </p>
                    )}
                  </div>
                ) : (
                  hospital.reviews[0] && (
                    <p className="text-xs text-slate-600 italic line-clamp-2">
                      “{hospital.reviews[0].text}”
                    </p>
                  )
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onRequestRoute(hospital)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Navigation className="w-3 h-3 shrink-0" aria-hidden="true" />
                    <span>Show Route</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectFacility(hospital)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Inspect Reviews
                  </button>
                  {safeMapsUri && (
                    <a
                      href={safeMapsUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0 ml-auto"
                    >
                      <span>Google Maps</span>
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
