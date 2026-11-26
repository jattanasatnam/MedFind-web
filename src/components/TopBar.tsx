import { LocateFixed } from 'lucide-react';
import type { WorkspaceView } from '../types/medfind.ts';

interface TopBarProps {
  activeView: WorkspaceView;
  onSelectView: (view: WorkspaceView) => void;
  onUseMyLocation: () => void;
  isLocating: boolean;
  savedCount: number;
}

const NAV_ITEMS: Array<{ id: WorkspaceView; label: string }> = [
  { id: 'map', label: 'Facility Map' },
  { id: 'medicines', label: 'Medicine Finder' },
  { id: 'hospitals', label: 'Hospital Ranking' },
  { id: 'saved', label: 'Saved Care' },
];

export function TopBar({
  activeView,
  onSelectView,
  onUseMyLocation,
  isLocating,
  savedCount,
}: TopBarProps) {
  return (
    <header className="bg-white border-b border-slate-200 px-4 lg:px-6 h-16 flex items-center justify-between gap-8">
      {/* Zone 1: Single-element brand wordmark */}
      <a
        href="#top"
        onClick={(e) => {
          e.preventDefault();
          onSelectView('map');
        }}
        className="font-display text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 rounded"
      >
        MedFind
      </a>

      {/* Zone 2: Clean single-line navigation links */}
      <nav aria-label="Primary workspace navigation" className="hidden md:flex items-center gap-6">
        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.id;
          const label =
            item.id === 'saved' && savedCount > 0
              ? `${item.label} (${savedCount})`
              : item.label;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`relative py-5 text-sm font-medium transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 rounded ${
                isActive
                  ? 'text-teal-800 font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-teal-700"
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Single primary action */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onUseMyLocation}
          disabled={isLocating}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-teal-700"
        >
          <LocateFixed className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{isLocating ? 'Locating…' : 'Use My Location'}</span>
        </button>
      </div>
    </header>
  );
}
