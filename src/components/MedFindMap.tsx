import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { ExternalLink, Navigation, X } from 'lucide-react';
import type {
  LatLng,
  MedicalFacility,
  RouteSummaryInfo,
} from '../types/medfind.ts';
import { formatDistanceKm } from '../utils/facilityScoring.ts';
import { sanitizeExternalUrl } from '../utils/urlSafety.ts';

interface AdvancedMarkerWithRefProps {
  facility: MedicalFacility;
  isSelected: boolean;
  isHovered: boolean;
  zIndex: number;
  onSelect: (
    facility: MedicalFacility,
    marker: google.maps.marker.AdvancedMarkerElement
  ) => void;
  onHover: (id: string | null) => void;
}

function getPinPalette(category: MedicalFacility['category'], isSelected: boolean) {
  if (isSelected) {
    return {
      background: '#0F172A',
      borderColor: '#0F766E',
      glyphColor: '#FFFFFF',
    };
  }
  switch (category) {
    case 'pharmacy':
      return {
        background: '#0F766E',
        borderColor: '#115E59',
        glyphColor: '#FFFFFF',
      };
    case 'hospital':
      return {
        background: '#BE123C',
        borderColor: '#9F1239',
        glyphColor: '#FFFFFF',
      };
    default:
      return {
        background: '#1D4ED8',
        borderColor: '#1E40AF',
        glyphColor: '#FFFFFF',
      };
  }
}

function getPinGlyph(category: MedicalFacility['category']): string {
  switch (category) {
    case 'pharmacy':
      return 'Rx';
    case 'hospital':
      return 'H';
    default:
      return '+';
  }
}

function AdvancedMarkerWithRef({
  facility,
  isSelected,
  isHovered,
  zIndex,
  onSelect,
  onHover,
}: AdvancedMarkerWithRefProps) {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const palette = getPinPalette(facility.category, isSelected || isHovered);

  return (
    <AdvancedMarker
      ref={markerRef}
      position={facility.location}
      zIndex={zIndex}
      title={facility.name}
      onClick={() => {
        if (marker) {
          onSelect(facility, marker);
        }
      }}
      onMouseEnter={() => onHover(facility.id)}
      onMouseLeave={() => onHover(null)}
    >
      <Pin
        background={palette.background}
        borderColor={palette.borderColor}
        glyphColor={palette.glyphColor}
        glyphText={getPinGlyph(facility.category)}
        scale={isSelected ? 1.25 : isHovered ? 1.12 : 1.0}
      />
    </AdvancedMarker>
  );
}

interface RouteOverlayProps {
  origin: LatLng;
  destination: MedicalFacility;
  travelMode: 'DRIVING' | 'WALKING';
  onRouteComputed: (summary: RouteSummaryInfo | null) => void;
  onRouteError: (msg: string | null) => void;
}

function RouteOverlay({
  origin,
  destination,
  travelMode,
  onRouteComputed,
  onRouteError,
}: RouteOverlayProps) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    if (!routesLib || !map) return;

    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];
    onRouteError(null);

    let cancelled = false;

    const request = {
      origin: { lat: origin.lat, lng: origin.lng },
      destination: {
        lat: destination.location.lat,
        lng: destination.location.lng,
      },
      travelMode,
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport'],
    };

    const RouteClass = routesLib.Route as unknown as {
      computeRoutes: (req: unknown) => Promise<{
        routes?: Array<{
          createPolylines: () => google.maps.Polyline[];
          viewport?: google.maps.LatLngBounds;
          distanceMeters?: number;
          durationMillis?: number;
        }>;
      }>;
    };

    RouteClass.computeRoutes(request)
      .then((res) => {
        if (cancelled) return;
        const primaryRoute = res.routes?.[0];
        if (!primaryRoute) {
          onRouteComputed(null);
          onRouteError('No route found between your location and this facility.');
          return;
        }

        const newPolylines = primaryRoute.createPolylines();
        newPolylines.forEach((poly) => {
          poly.setOptions({
            strokeColor: '#0F766E',
            strokeWeight: 5,
            strokeOpacity: 0.9,
          });
          poly.setMap(map);
        });
        polylinesRef.current = newPolylines;

        if (primaryRoute.viewport) {
          map.fitBounds(primaryRoute.viewport);
        }

        onRouteComputed({
          facilityId: destination.id,
          facilityName: destination.name,
          distanceMeters: primaryRoute.distanceMeters ?? 0,
          durationMillis: primaryRoute.durationMillis ?? 0,
          travelMode,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes('OVER_QUERY_LIMIT') ||
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('429')
        ) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        onRouteComputed(null);
        onRouteError('Unable to calculate live route right now.');
      });

    return () => {
      cancelled = true;
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [
    routesLib,
    map,
    origin.lat,
    origin.lng,
    destination.id,
    destination.name,
    destination.location.lat,
    destination.location.lng,
    travelMode,
    onRouteComputed,
    onRouteError,
  ]);

  return null;
}

function MapCameraSync({ center }: { center: LatLng }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    map.panTo(center);
  }, [map, center.lat, center.lng]);
  return null;
}

interface MedFindMapProps {
  origin: LatLng;
  facilities: MedicalFacility[];
  selectedFacility: MedicalFacility | null;
  hoveredId: string | null;
  routeTarget: MedicalFacility | null;
  travelMode: 'DRIVING' | 'WALKING';
  onTravelModeChange: (mode: 'DRIVING' | 'WALKING') => void;
  onSelectFacility: (facility: MedicalFacility) => void;
  onHoverFacility: (id: string | null) => void;
  onClearRoute: () => void;
  onRequestRoute: (facility: MedicalFacility) => void;
}

export function MedFindMap({
  origin,
  facilities,
  selectedFacility,
  hoveredId,
  routeTarget,
  travelMode,
  onTravelModeChange,
  onSelectFacility,
  onHoverFacility,
  onClearRoute,
  onRequestRoute,
}: MedFindMapProps) {
  const [selectedMarker, setSelectedMarker] =
    useState<google.maps.marker.AdvancedMarkerElement | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [routeSummary, setRouteSummary] = useState<RouteSummaryInfo | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  const sortedMarkers = useMemo(() => {
    return [...facilities]
      .sort((a, b) => b.location.lat - a.location.lat)
      .map((item, idx) => ({ item, baseZIndex: idx + 1 }));
  }, [facilities]);

  const handleMarkerSelect = useCallback(
    (
      facility: MedicalFacility,
      marker: google.maps.marker.AdvancedMarkerElement
    ) => {
      setSelectedMarker(marker);
      setInfoOpen(true);
      onSelectFacility(facility);
    },
    [onSelectFacility]
  );

  useEffect(() => {
    if (!selectedFacility) {
      setInfoOpen(false);
    }
  }, [selectedFacility]);

  useEffect(() => {
    if (!routeTarget) {
      setRouteSummary(null);
      setRouteError(null);
    }
  }, [routeTarget]);

  const safeMapsUrl = selectedFacility
    ? sanitizeExternalUrl(selectedFacility.googleMapsUri)
    : null;

  return (
    <div
      data-testid="medfind-map-container"
      className="relative w-full h-full min-h-[420px] bg-slate-100 rounded-xl overflow-hidden border border-slate-200"
    >
      <GoogleMap
        defaultCenter={origin}
        defaultZoom={13}
        mapId="DEMO_MAP_ID"
        gestureHandling="greedy"
        disableDefaultUI={false}
        mapTypeControl={false}
        streetViewControl={false}
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        style={{ width: '100%', height: '100%' }}
      >
        <MapCameraSync center={origin} />

        {/* Origin user marker */}
        <AdvancedMarker position={origin} zIndex={500} title="Search origin">
          <div className="w-4 h-4 rounded-full bg-teal-700 border-2 border-white shadow-md" />
        </AdvancedMarker>

        {sortedMarkers.map(({ item, baseZIndex }) => {
          const isSelected = selectedFacility?.id === item.id;
          const isHovered = hoveredId === item.id;
          const zIndex = isSelected ? 1000 : isHovered ? 950 : baseZIndex;
          return (
            <AdvancedMarkerWithRef
              key={item.id}
              facility={item}
              isSelected={isSelected}
              isHovered={isHovered}
              zIndex={zIndex}
              onSelect={handleMarkerSelect}
              onHover={onHoverFacility}
            />
          );
        })}

        {infoOpen && selectedMarker && selectedFacility && (
          <InfoWindow
            anchor={selectedMarker}
            pixelOffset={[0, -4]}
            onCloseClick={() => setInfoOpen(false)}
          >
            <div className="max-w-xs p-1 text-slate-900">
              <div className="text-xs font-medium text-teal-800">
                {selectedFacility.primaryTypeLabel}
              </div>
              <h3 className="font-display text-sm font-semibold text-slate-900 mt-0.5">
                {selectedFacility.name}
              </h3>
              <p className="text-xs text-slate-600 mt-1">
                {selectedFacility.address}
              </p>
              <div className="mt-1.5 flex items-center gap-2 text-xs font-mono tabular-nums text-slate-700">
                <span>{formatDistanceKm(selectedFacility.distanceKm)}</span>
                {selectedFacility.rating !== null && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      {selectedFacility.rating.toFixed(1)} (
                      {selectedFacility.userRatingCount})
                    </span>
                  </>
                )}
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onRequestRoute(selectedFacility)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded cursor-pointer"
                >
                  <Navigation className="w-3 h-3" aria-hidden="true" />
                  <span>Route</span>
                </button>
                {safeMapsUrl && (
                  <a
                    href={safeMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded"
                  >
                    <span>Google Maps</span>
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                )}
              </div>
            </div>
          </InfoWindow>
        )}

        {routeTarget && (
          <RouteOverlay
            origin={origin}
            destination={routeTarget}
            travelMode={travelMode}
            onRouteComputed={setRouteSummary}
            onRouteError={setRouteError}
          />
        )}
      </GoogleMap>

      {/* Map legend */}
      <div className="absolute top-3 right-16 bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg px-3 py-1.5 shadow-sm text-xs text-slate-700 hidden sm:flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-blue-700 inline-block" />
          Clinics
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-teal-700 inline-block" />
          Pharmacies
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-rose-700 inline-block" />
          Hospitals
        </span>
      </div>

      {/* Active route summary HUD */}
      {routeTarget && (
        <div className="absolute top-3 left-3 right-3 sm:right-auto sm:max-w-sm bg-white border border-slate-200 rounded-lg p-3 shadow-md">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-teal-800">Active Route</div>
              <div className="text-sm font-semibold text-slate-900 truncate">
                {routeTarget.name}
              </div>
            </div>
            <button
              type="button"
              aria-label="Clear active route"
              onClick={onClearRoute}
              className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {routeSummary ? (
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="text-xs font-mono tabular-nums text-slate-700">
                {(routeSummary.distanceMeters / 1000).toFixed(1)} km ·{' '}
                {Math.max(1, Math.round(routeSummary.durationMillis / 60000))} min
              </div>
              <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-md">
                <button
                  type="button"
                  onClick={() => onTravelModeChange('DRIVING')}
                  className={`px-2 py-1 text-xs rounded cursor-pointer ${
                    travelMode === 'DRIVING'
                      ? 'bg-white text-slate-900 font-medium shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  Drive
                </button>
                <button
                  type="button"
                  onClick={() => onTravelModeChange('WALKING')}
                  className={`px-2 py-1 text-xs rounded cursor-pointer ${
                    travelMode === 'WALKING'
                      ? 'bg-white text-slate-900 font-medium shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  Walk
                </button>
              </div>
            </div>
          ) : routeError ? (
            <p className="mt-1.5 text-xs text-rose-700">{routeError}</p>
          ) : (
            <p className="mt-1.5 text-xs text-slate-500">Calculating route…</p>
          )}
        </div>
      )}
    </div>
  );
}
