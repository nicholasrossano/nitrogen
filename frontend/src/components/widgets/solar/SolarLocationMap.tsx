'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Search, MapPin, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

import 'leaflet/dist/leaflet.css';

// Custom accent-colored div icon (replaces default blue Leaflet marker)
function makeAccentPin(): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [22, 30],
    iconAnchor: [11, 30],
    popupAnchor: [0, -30],
    html: `<svg width="22" height="30" viewBox="0 0 22 30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M11 0C4.925 0 0 4.925 0 11C0 19.25 11 30 11 30C11 30 22 19.25 22 11C22 4.925 17.075 0 11 0Z" fill="var(--color-accent,#2563eb)"/>
      <circle cx="11" cy="11" r="4.5" fill="white"/>
    </svg>`,
  });
}

interface Suggestion {
  lat: number;
  lon: number;
  display_name: string;
  zoom?: number;
}

interface SolarLocationMapProps {
  lat: number | null;
  lon: number | null;
  address?: string | null;
  onLocationChange: (lat: number, lon: number, address?: string) => void;
  disabled?: boolean;
}

function DraggableMarker({
  lat,
  lon,
  onDragEnd,
}: {
  lat: number;
  lon: number;
  onDragEnd: (lat: number, lon: number) => void;
}) {
  const markerRef = useRef<L.Marker>(null);
  const iconRef = useRef<L.DivIcon>(makeAccentPin());

  const handleDragEnd = useCallback(() => {
    const marker = markerRef.current;
    if (marker) {
      const pos = marker.getLatLng();
      onDragEnd(pos.lat, pos.lng);
    }
  }, [onDragEnd]);

  return (
    <Marker
      draggable
      icon={iconRef.current}
      position={[lat, lon]}
      ref={markerRef}
      eventHandlers={{ dragend: handleDragEnd }}
    />
  );
}

function MapClickHandler({ onClick }: { onClick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function RecenterMap({ lat, lon, zoom }: { lat: number; lon: number; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    requestAnimationFrame(() => {
      try {
        map.invalidateSize();
        map.setView([lat, lon], zoom);
      } catch {
        // Leaflet panes not ready yet
      }
    });
  }, [lat, lon, zoom, map]);
  return null;
}

function InvalidateSizeOnMount() {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => {
      try { map.invalidateSize(); } catch { /* noop */ }
    }, 100);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
}

export default function SolarLocationMap({
  lat,
  lon,
  address,
  onLocationChange,
  disabled = false,
}: SolarLocationMapProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [targetZoom, setTargetZoom] = useState(13);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const hasCoords = lat !== null && lon !== null;
  const displayLat = lat ?? 0;
  const displayLon = lon ?? 0;

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    setSearching(true);
    try {
      const resp = await api.autocompleteSolarAddress(query.trim());
      setSuggestions(resp.results || []);
      setShowSuggestions(true);
      setSearchError('');
    } catch {
      setSuggestions([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleInputChange = useCallback((value: string) => {
    setSearchQuery(value);
    setSearchError('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 350);
  }, [fetchSuggestions]);

  const handleSelectSuggestion = useCallback((suggestion: Suggestion) => {
    setTargetZoom(suggestion.zoom ?? 13);
    onLocationChange(suggestion.lat, suggestion.lon, suggestion.display_name);
    setSearchQuery('');
    setSuggestions([]);
    setShowSuggestions(false);
  }, [onLocationChange]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!searchQuery.trim() || disabled) return;
    if (suggestions.length > 0) {
      handleSelectSuggestion(suggestions[0]);
      return;
    }
    setSearching(true);
    setSearchError('');
    try {
      const result = await api.geocodeSolarAddress(searchQuery.trim());
      setTargetZoom(result.zoom ?? 13);
      onLocationChange(result.lat, result.lon, result.display_name);
      setSearchQuery('');
      setSuggestions([]);
      setShowSuggestions(false);
    } catch {
      setSearchError('Location not found. Try a more specific address.');
    } finally {
      setSearching(false);
    }
  }, [searchQuery, suggestions, onLocationChange, disabled, handleSelectSuggestion]);

  const handleMapClick = useCallback((newLat: number, newLon: number) => {
    if (!disabled) onLocationChange(newLat, newLon);
  }, [disabled, onLocationChange]);

  return (
    <div className="rounded-lg border border-stroke-subtle overflow-hidden bg-surface-primary">
      {/* Leaflet custom styles */}
      <style>{`
        .solar-map .leaflet-control-zoom {
          border: 1px solid var(--color-stroke-subtle, #e5e7eb) !important;
          border-radius: 8px !important;
          overflow: hidden;
          box-shadow: 0 1px 4px rgba(0,0,0,0.08) !important;
        }
        .solar-map .leaflet-control-zoom a {
          background: var(--color-surface-primary, #fff) !important;
          color: var(--color-text-secondary, #374151) !important;
          border-bottom: 1px solid var(--color-stroke-subtle, #e5e7eb) !important;
          width: 28px !important;
          height: 28px !important;
          line-height: 28px !important;
          font-size: 14px !important;
          font-weight: 400 !important;
        }
        .solar-map .leaflet-control-zoom a:last-child {
          border-bottom: none !important;
        }
        .solar-map .leaflet-control-zoom a:hover {
          background: var(--color-surface-subtle, #f9fafb) !important;
          color: var(--color-accent, #2563eb) !important;
        }
      `}</style>

      {/* Search bar with autocomplete */}
      <div ref={wrapperRef} className="relative">
        <form onSubmit={handleSubmit} className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-stroke-subtle bg-surface-subtle">
          <Search className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
            placeholder="Search address, city, or place..."
            disabled={disabled}
            className="flex-1 text-xs bg-transparent outline-none text-text-primary placeholder:text-text-tertiary"
          />
          {searching && <Loader2 className="w-3 h-3 text-text-tertiary animate-spin shrink-0" />}
        </form>

        {/* Suggestions dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-[1000] bg-white border border-stroke-subtle border-t-0 rounded-b-lg shadow-lg max-h-[200px] overflow-y-auto">
            {suggestions.map((s, i) => (
              <button
                key={`${s.lat}-${s.lon}-${i}`}
                type="button"
                onClick={() => handleSelectSuggestion(s)}
                className="w-full text-left px-3 py-2 text-[11px] text-text-secondary hover:bg-surface-subtle transition-colors border-b border-stroke-subtle/50 last:border-b-0"
              >
                <div className="flex items-start gap-2">
                  <MapPin className="w-3 h-3 text-text-tertiary shrink-0 mt-0.5" />
                  <span className="line-clamp-2">{s.display_name}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {searchError && (
        <div className="px-2.5 py-1 text-[10px] text-red-500 bg-red-50">{searchError}</div>
      )}

      {/* Map */}
      <div className="h-[180px] relative">
        {hasCoords ? (
          <MapContainer
            center={[displayLat, displayLon]}
            zoom={targetZoom}
            scrollWheelZoom={false}
            style={{ height: '100%', width: '100%' }}
            attributionControl={false}
            className="solar-map"
          >
            <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
            <InvalidateSizeOnMount />
            <DraggableMarker lat={displayLat} lon={displayLon} onDragEnd={handleMapClick} />
            <MapClickHandler onClick={handleMapClick} />
            <RecenterMap lat={displayLat} lon={displayLon} zoom={targetZoom} />
          </MapContainer>
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-text-tertiary bg-surface-subtle">
            <MapPin className="w-6 h-6" />
            <p className="text-xs">Search for a location or enter coordinates</p>
          </div>
        )}
      </div>

      {/* Coordinates display */}
      {hasCoords && (
        <div className="px-2.5 py-1.5 border-t border-stroke-subtle flex items-center gap-3 text-[11px] text-text-secondary bg-surface-subtle">
          <span className="font-medium text-text-tertiary">Lat:</span>
          <span>{displayLat.toFixed(4)}</span>
          <span className="font-medium text-text-tertiary">Lon:</span>
          <span>{displayLon.toFixed(4)}</span>
          {address && (
            <>
              <span className="text-stroke-subtle">|</span>
              <span className="truncate text-text-tertiary" title={address}>{address}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
