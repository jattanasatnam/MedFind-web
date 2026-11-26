import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { MapPin, Search, Sparkles, X } from 'lucide-react';
import { useAutocompleteSuggestions } from '../hooks/useAutocompleteSuggestions.ts';
import type { AvailabilityFilter, LatLng } from '../types/medfind.ts';

interface LocationPreset {
  label: string;
  coords: LatLng;
}

const CITY_PRESETS: LocationPreset[] = [
  { label: 'San Francisco, CA', coords: { lat: 37.7749, lng: -122.4194 } },
  { label: 'New York, NY', coords: { lat: 40.758, lng: -73.9855 } },
  { label: 'Chicago, IL', coords: { lat: 41.8781, lng: -87.6298 } },
  { label: 'Austin, TX', coords: { lat: 30.2672, lng: -97.7431 } },
];

interface LocationSearchBarProps {
  locationLabel: string;
  onSelectLocation: (coords: LatLng, label: string) => void;
  careQuery: string;
  onCareQueryChange: (value: string) => void;
  onSubmitCareSearch: (query: string) => void;
  categoryFilter: AvailabilityFilter;
  onCategoryFilterChange: (filter: AvailabilityFilter) => void;
  openOnly: boolean;
  onToggleOpenOnly: () => void;
  radiusMeters: number;
  onRadiusChange: (radius: number) => void;
  onRunAiPrioritize: () => void;
  isAiAnalyzing: boolean;
}

const FILTER_TABS: Array<{ id: AvailabilityFilter; label: string }> = [
  { id: 'all', label: 'All Facilities' },
  { id: 'clinic', label: 'Clinics' },
  { id: 'pharmacy', label: 'Pharmacies' },
  { id: 'hospital', label: 'Hospitals' },
];

export function LocationSearchBar({
  locationLabel,
  onSelectLocation,
  careQuery,
  onCareQueryChange,
  onSubmitCareSearch,
  categoryFilter,
  onCategoryFilterChange,
  openOnly,
  onToggleOpenOnly,
  radiusMeters,
  onRadiusChange,
  onRunAiPrioritize,
  isAiAnalyzing,
}: LocationSearchBarProps) {
  const placesLib = useMapsLibrary('places');
  const [addressInput, setAddressInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const { suggestions, resetSession } = useAutocompleteSuggestions(addressInput);

  const handleSelectPrediction = async (
    suggestion: google.maps.places.AutocompleteSuggestion
  ) => {
    if (!placesLib || !suggestion.placePrediction) return;
    try {
      const place = suggestion.placePrediction.toPlace();
      await place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location'],
      });
      const loc = place.location;
      if (loc) {
        const lat = typeof loc.lat === 'function' ? loc.lat() : Number(loc.lat);
        const lng = typeof loc.lng === 'function' ? loc.lng() : Number(loc.lng);
        const label =
          place.formattedAddress ||
          place.displayName ||
          suggestion.placePrediction.text.text;
        onSelectLocation({ lat, lng }, label);
      }
      setAddressInput('');
      setShowSuggestions(false);
      resetSession();
    } catch {
      setShowSuggestions(false);
    }
  };

  const handleLocationSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = addressInput.trim();
    if (!trimmed) return;
    if (suggestions[0]?.placePrediction) {
      await handleSelectPrediction(suggestions[0]);
      return;
    }
    if (!placesLib?.Place) return;
    try {
      const res = await placesLib.Place.searchByText({
        fields: ['displayName', 'formattedAddress', 'location'],
        textQuery: trimmed,
        maxResultCount: 1,
      });
      const place = res.places?.[0];
      const loc = place?.location;
      if (loc) {
        const lat = typeof loc.lat === 'function' ? loc.lat() : Number(loc.lat);
        const lng = typeof loc.lng === 'function' ? loc.lng() : Number(loc.lng);
        const label = place.formattedAddress || place.displayName || trimmed;
        onSelectLocation({ lat, lng }, label);
        setAddressInput('');
        setShowSuggestions(false);
        resetSession();
      }
    } catch {
      setShowSuggestions(false);
    }
  };

  const handleSearchFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmitCareSearch(careQuery);
  };

  return (
    <section
      aria-label="Search and filter medical facilities"
      className="bg-white border-b border-slate-200 px-4 lg:px-6 py-3"
    >
      <div className="flex flex-col xl:flex-row xl:items-center gap-3">
        {/* Location input with Places Autocomplete */}
        <div className="relative w-full xl:w-72 shrink-0">
          <label htmlFor="location-search-input" className="sr-only">
            Change search area or neighborhood
          </label>
          <form onSubmit={(e) => void handleLocationSubmit(e)} className="flex items-center border border-slate-300 rounded-lg bg-slate-50 focus-within:bg-white focus-within:border-teal-700 focus-within:ring-2 focus-within:ring-teal-700/20">
            <MapPin className="w-4 h-4 text-teal-700 ml-3 shrink-0" aria-hidden="true" />
            <input
              id="location-search-input"
              type="text"
              value={addressInput}
              onFocus={() => setShowSuggestions(true)}
              onChange={(e) => {
                setAddressInput(e.target.value);
                setShowSuggestions(true);
              }}
              placeholder={locationLabel}
              className="w-full bg-transparent px-2.5 py-2 text-sm text-slate-900 placeholder:text-slate-600 focus:outline-none"
            />
            {addressInput && (
              <button
                type="button"
                aria-label="Clear location input"
                onClick={() => {
                  setAddressInput('');
                  resetSession();
                }}
                className="p-1.5 mr-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </form>

          {showSuggestions && (suggestions.length > 0 || addressInput.trim() === '') && (
            <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-30 max-h-64 overflow-y-auto">
              {suggestions.length > 0 ? (
                <ul role="listbox" aria-label="Location suggestions">
                  {suggestions.map((s, idx) => (
                    <li key={idx}>
                      <button
                        type="button"
                        onClick={() => void handleSelectPrediction(s)}
                        className="w-full text-left px-3 py-2 text-sm text-slate-800 hover:bg-slate-50 flex items-start gap-2 cursor-pointer"
                      >
                        <MapPin className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" aria-hidden="true" />
                        <span>{s.placePrediction?.text.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="p-2">
                  <div className="px-2 py-1 text-xs font-medium text-slate-500">
                    Quick Metro Areas
                  </div>
                  {CITY_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        onSelectLocation(preset.coords, preset.label);
                        setShowSuggestions(false);
                      }}
                      className="w-full text-left px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50 rounded cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="border-t border-slate-100 px-2 py-1.5 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowSuggestions(false)}
                  className="text-xs text-slate-500 hover:text-slate-800 px-2 py-0.5 cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Care / Symptom / Pharmacy search */}
        <form onSubmit={handleSearchFormSubmit} className="flex-1 flex items-center gap-2 min-w-0">
          <label htmlFor="care-search-input" className="sr-only">
            Search clinics, urgent care, or pharmacy services
          </label>
          <div className="relative flex-1 min-w-[230px] flex items-center border border-slate-300 rounded-lg bg-white focus-within:border-teal-700 focus-within:ring-2 focus-within:ring-teal-700/20">
            <Search className="w-4 h-4 text-slate-400 ml-3 shrink-0" aria-hidden="true" />
            <input
              id="care-search-input"
              type="text"
              value={careQuery}
              onChange={(e) => onCareQueryChange(e.target.value)}
              placeholder="Search clinic, symptom, or pharmacy…"
              className="w-full bg-transparent px-2.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
            {careQuery && (
              <button
                type="button"
                aria-label="Clear search query"
                onClick={() => {
                  onCareQueryChange('');
                  onSubmitCareSearch('');
                }}
                className="p-1.5 mr-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Search
          </button>
        </form>

        {/* Segmented Filter Tabs + Open Now + Radius + AI Priority */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div
            role="tablist"
            aria-label="Filter by facility type"
            className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
          >
            {FILTER_TABS.map((tab) => {
              const active = categoryFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onCategoryFilterChange(tab.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            aria-pressed={openOnly}
            onClick={onToggleOpenOnly}
            className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
              openOnly
                ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            Open Now
          </button>

          <label htmlFor="radius-select" className="sr-only">
            Search radius
          </label>
          <select
            id="radius-select"
            value={radiusMeters}
            onChange={(e) => onRadiusChange(Number(e.target.value))}
            className="px-2.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer focus:outline-none focus:ring-2 focus:ring-teal-700"
          >
            <option value={3000}>Within 3 km</option>
            <option value={5000}>Within 5 km</option>
            <option value={10000}>Within 10 km</option>
            <option value={20000}>Within 20 km</option>
          </select>

          <button
            type="button"
            onClick={onRunAiPrioritize}
            disabled={isAiAnalyzing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{isAiAnalyzing ? 'Analyzing…' : 'Prioritize Availability'}</span>
          </button>
        </div>
      </div>
    </section>
  );
}
