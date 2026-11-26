import { useCallback, useEffect, useMemo, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import type {
  AiPrioritizationResult,
  AvailabilityFilter,
  LatLng,
  MedicalFacility,
  WorkspaceView,
} from './types/medfind.ts';
import {
  rankFacilitiesByAvailabilityAndRating,
  rankHospitalsByReviewsAndProximity,
} from './utils/facilityScoring.ts';
import { useNearbyFacilities } from './hooks/useNearbyFacilities.ts';
import { TopBar } from './components/TopBar.tsx';
import { LocationSearchBar } from './components/LocationSearchBar.tsx';
import { FacilityListPanel } from './components/FacilityListPanel.tsx';
import { MedFindMap } from './components/MedFindMap.tsx';
import { FacilityDetailDrawer } from './components/FacilityDetailDrawer.tsx';
import { MedicineFinderPanel } from './components/MedicineFinderPanel.tsx';
import { HospitalRankingPanel } from './components/HospitalRankingPanel.tsx';
import { SavedCarePanel } from './components/SavedCarePanel.tsx';

const DEFAULT_ORIGIN: LatLng = { lat: 37.7749, lng: -122.4194 };
const SAVED_STORAGE_KEY = 'medfind_saved_facilities_v1';

function loadSavedFacilities(): MedicalFacility[] {
  try {
    const raw = window.localStorage.getItem(SAVED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MedicalFacility[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

interface WorkspaceProps {
  mapsReady: boolean;
}

function MedFindWorkspace({ mapsReady }: WorkspaceProps) {
  const [activeView, setActiveView] = useState<WorkspaceView>('map');
  const [origin, setOrigin] = useState<LatLng>(DEFAULT_ORIGIN);
  const [locationLabel, setLocationLabel] = useState('San Francisco, CA');
  const [isLocating, setIsLocating] = useState(false);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);

  const [careQueryInput, setCareQueryInput] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<AvailabilityFilter>('all');
  const [openOnly, setOpenOnly] = useState(false);
  const [radiusMeters, setRadiusMeters] = useState(5000);

  const [selectedFacility, setSelectedFacility] = useState<MedicalFacility | null>(
    null
  );
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [routeTarget, setRouteTarget] = useState<MedicalFacility | null>(null);
  const [travelMode, setTravelMode] = useState<'DRIVING' | 'WALKING'>('DRIVING');

  const [aiAnalysis, setAiAnalysis] = useState<AiPrioritizationResult | null>(null);
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [medicinePrefill, setMedicinePrefill] = useState('');
  const [savedFacilities, setSavedFacilities] = useState<MedicalFacility[]>(() =>
    loadSavedFacilities()
  );

  const { facilities, isLoading, error, refresh } = useNearbyFacilities(
    origin,
    radiusMeters,
    submittedQuery,
    mapsReady
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SAVED_STORAGE_KEY,
        JSON.stringify(savedFacilities)
      );
    } catch {
      // Ignore storage quota errors
    }
  }, [savedFacilities]);

  const savedIds = useMemo(() => {
    const record: Record<string, boolean> = {};
    for (const f of savedFacilities) {
      record[f.id] = true;
    }
    return record;
  }, [savedFacilities]);

  const handleToggleSave = useCallback((facility: MedicalFacility) => {
    setSavedFacilities((prev) => {
      const exists = prev.some((item) => item.id === facility.id);
      if (exists) {
        return prev.filter((item) => item.id !== facility.id);
      }
      return [facility, ...prev];
    });
  }, []);

  const handleUseMyLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setLocationNotice('Browser geolocation is unavailable; search a city or address instead.');
      return;
    }
    setIsLocating(true);
    setLocationNotice(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setLocationLabel('Current Location');
        setIsLocating(false);
        setAiAnalysis(null);
      },
      () => {
        setLocationNotice('Location permission declined. Showing results for San Francisco, CA.');
        setIsLocating(false);
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }, []);

  const rankedFacilities = useMemo(() => {
    const filtered = facilities.filter((f) => {
      if (categoryFilter !== 'all' && f.category !== categoryFilter) return false;
      if (openOnly && f.openNow !== true) return false;
      return true;
    });
    const ranked = rankFacilitiesByAvailabilityAndRating(filtered);
    if (aiAnalysis && aiAnalysis.rankedFacilities.length > 0) {
      const rankOrder: Record<string, number> = {};
      aiAnalysis.rankedFacilities.forEach((item) => {
        rankOrder[item.facilityId] = item.priorityRank;
      });
      return [...ranked].sort((a, b) => {
        const ra = rankOrder[a.id] ?? 999;
        const rb = rankOrder[b.id] ?? 999;
        if (ra !== rb) return ra - rb;
        return b.scoring.priorityScore - a.scoring.priorityScore;
      });
    }
    return ranked;
  }, [facilities, categoryFilter, openOnly, aiAnalysis]);

  const rankedHospitals = useMemo(
    () => rankHospitalsByReviewsAndProximity(facilities),
    [facilities]
  );

  const handleRunAiPrioritize = useCallback(async () => {
    const pool = rankedFacilities.slice(0, 15);
    if (pool.length === 0) {
      setAiError('No facilities available to analyze.');
      return;
    }
    setIsAiAnalyzing(true);
    setAiError(null);
    setActiveView('map');
    try {
      const response = await fetch('/api/ai/prioritize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facilities: pool,
          needQuery: careQueryInput.trim() || undefined,
        }),
      });
      const data = (await response.json()) as AiPrioritizationResult & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || 'AI analysis failed.');
      }
      setAiAnalysis(data);
      if (data.topPickId) {
        const top = facilities.find((f) => f.id === data.topPickId);
        if (top) setSelectedFacility(top);
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Unable to run AI analysis.');
    } finally {
      setIsAiAnalyzing(false);
    }
  }, [rankedFacilities, careQueryInput, facilities]);

  const handleCheckMedicineForFacility = useCallback((facility: MedicalFacility) => {
    setSelectedFacility(facility);
    setMedicinePrefill('');
    setActiveView('medicines');
  }, []);

  const handleRequestRoute = useCallback((facility: MedicalFacility) => {
    setSelectedFacility(facility);
    setRouteTarget(facility);
  }, []);

  return (
    <div id="top" className="min-h-screen flex flex-col bg-slate-50">
      <TopBar
        activeView={activeView}
        onSelectView={setActiveView}
        onUseMyLocation={handleUseMyLocation}
        isLocating={isLocating}
        savedCount={savedFacilities.length}
      />

      {/* Mobile workspace tabs */}
      <nav
        aria-label="Mobile workspace tabs"
        className="md:hidden bg-white border-b border-slate-200 px-3 py-2 flex items-center gap-1 overflow-x-auto"
      >
        {(
          [
            { id: 'map', label: 'Map' },
            { id: 'medicines', label: 'Medicines' },
            { id: 'hospitals', label: 'Hospitals' },
            { id: 'saved', label: `Saved (${savedFacilities.length})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveView(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === tab.id
                ? 'bg-teal-700 text-white'
                : 'text-slate-700 bg-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <LocationSearchBar
        locationLabel={locationLabel}
        onSelectLocation={(coords, label) => {
          setOrigin(coords);
          setLocationLabel(label);
          setAiAnalysis(null);
          setRouteTarget(null);
          setSelectedFacility(null);
        }}
        careQuery={careQueryInput}
        onCareQueryChange={setCareQueryInput}
        onSubmitCareSearch={(q) => {
          setSubmittedQuery(q);
          setAiAnalysis(null);
        }}
        categoryFilter={categoryFilter}
        onCategoryFilterChange={setCategoryFilter}
        openOnly={openOnly}
        onToggleOpenOnly={() => setOpenOnly((v) => !v)}
        radiusMeters={radiusMeters}
        onRadiusChange={setRadiusMeters}
        onRunAiPrioritize={() => void handleRunAiPrioritize()}
        isAiAnalyzing={isAiAnalyzing}
      />

      {locationNotice && (
        <div className="bg-slate-100 border-b border-slate-200 px-4 lg:px-6 py-2 text-xs text-slate-700 flex items-center justify-between">
          <span>{locationNotice}</span>
          <button
            type="button"
            onClick={() => setLocationNotice(null)}
            className="text-xs font-medium text-slate-900 underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Split Workspace */}
      <main className="flex-1 px-4 lg:px-6 py-4 max-w-[1600px] w-full mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          {/* Left Workspace Column */}
          <div className="lg:col-span-5 xl:col-span-4 h-[620px] lg:h-[calc(100vh-190px)] min-h-[540px]">
            {activeView === 'map' && (
              <FacilityListPanel
                facilities={rankedFacilities}
                isLoading={isLoading}
                error={error}
                selectedFacilityId={selectedFacility?.id ?? null}
                savedIds={savedIds}
                aiAnalysis={aiAnalysis}
                aiError={aiError}
                onSelectFacility={setSelectedFacility}
                onHoverFacility={setHoveredId}
                onRequestRoute={handleRequestRoute}
                onToggleSave={handleToggleSave}
                onCheckMedicineForFacility={handleCheckMedicineForFacility}
                onRetry={() => void refresh()}
                onResetFilters={() => {
                  setCategoryFilter('all');
                  setOpenOnly(false);
                  setCareQueryInput('');
                  setSubmittedQuery('');
                }}
              />
            )}

            {activeView === 'medicines' && (
              <MedicineFinderPanel
                facilities={facilities}
                origin={origin}
                locationLabel={locationLabel}
                radiusMeters={radiusMeters}
                initialMedicine={medicinePrefill}
                onSelectFacility={(f) => setSelectedFacility(f)}
                onRequestRoute={handleRequestRoute}
              />
            )}

            {activeView === 'hospitals' && (
              <HospitalRankingPanel
                hospitals={rankedHospitals}
                onSelectFacility={(f) => setSelectedFacility(f)}
                onRequestRoute={handleRequestRoute}
              />
            )}

            {activeView === 'saved' && (
              <SavedCarePanel
                savedFacilities={savedFacilities}
                onSelectFacility={(f) => setSelectedFacility(f)}
                onRequestRoute={handleRequestRoute}
                onRemoveSaved={handleToggleSave}
              />
            )}
          </div>

          {/* Right Map + Selected Facility Detail Column */}
          <div className="lg:col-span-7 xl:col-span-8 flex flex-col gap-4">
            <div
              className={
                selectedFacility
                  ? 'h-[400px] lg:h-[calc(100vh-370px)] min-h-[360px]'
                  : 'h-[480px] lg:h-[calc(100vh-190px)] min-h-[540px]'
              }
            >
              {mapsReady ? (
                <MedFindMap
                  origin={origin}
                  facilities={
                    activeView === 'hospitals'
                      ? rankedHospitals
                      : rankedFacilities
                  }
                  selectedFacility={selectedFacility}
                  hoveredId={hoveredId}
                  routeTarget={routeTarget}
                  travelMode={travelMode}
                  onTravelModeChange={setTravelMode}
                  onSelectFacility={setSelectedFacility}
                  onHoverFacility={setHoveredId}
                  onClearRoute={() => setRouteTarget(null)}
                  onRequestRoute={handleRequestRoute}
                />
              ) : (
                <div className="w-full h-full rounded-xl border border-slate-200 bg-slate-100 flex items-center justify-center p-6 text-center">
                  <div className="max-w-sm space-y-2">
                    <h3 className="font-display text-sm font-semibold text-slate-900">
                      Map Viewport Initializing
                    </h3>
                    <p className="text-xs text-slate-600">
                      Google Maps Platform key is required to display the interactive map canvas. Nearby facility search and AI clinical analysis remain available.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {selectedFacility && (
              <FacilityDetailDrawer
                facility={selectedFacility}
                isSaved={Boolean(savedIds[selectedFacility.id])}
                onClose={() => setSelectedFacility(null)}
                onRequestRoute={handleRequestRoute}
                onToggleSave={handleToggleSave}
                onCheckMedicine={handleCheckMedicineForFacility}
              />
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 lg:px-6 py-3 text-xs text-slate-500 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <span>
          For life-threatening emergencies, call local emergency services immediately. MedFind provides facility discovery and webpage availability checks, not medical diagnosis.
        </span>
        <span className="shrink-0">
          Map & place data powered by Google Maps Platform
        </span>
      </footer>
    </div>
  );
}

export default function App() {
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  );
  const [configLoaded, setConfigLoaded] = useState(
    Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY)
  );

  useEffect(() => {
    const handleQuota = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', handleQuota);
  }, []);

  useEffect(() => {
    if (mapsApiKey) return;
    let active = true;
    fetch('/api/maps-config')
      .then((res) => res.json())
      .then((data: { mapsApiKey?: string }) => {
        if (active && data.mapsApiKey) {
          setMapsApiKey(data.mapsApiKey);
        }
      })
      .catch(() => {
        // Handled gracefully by mapsReady=false fallback
      })
      .finally(() => {
        if (active) setConfigLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [mapsApiKey]);

  const quotaBanner = quotaExceeded ? (
    <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
      <span>
        Google Maps Platform quota reached. If you are the app owner, visit{' '}
        <a
          href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
          target="_blank"
          rel="noopener noreferrer"
          className="underline font-semibold text-amber-950 hover:text-amber-800"
        >
          maps developer site
        </a>{' '}
        for instructions to update your account.
      </span>
    </div>
  ) : null;

  if (!configLoaded) {
    return (
      <>
        {quotaBanner}
        <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-600">
          Loading MedFind…
        </div>
      </>
    );
  }

  if (!mapsApiKey) {
    return (
      <>
        {quotaBanner}
        <MedFindWorkspace mapsReady={false} />
      </>
    );
  }

  return (
    <>
      {quotaBanner}
      <APIProvider
        apiKey={mapsApiKey}
        language="en"
        libraries={['places', 'marker', 'routes']}
      >
        <MedFindWorkspace mapsReady={true} />
      </APIProvider>
    </>
  );
}
