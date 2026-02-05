'use client';

import { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { RoadCell } from '@/lib/firebase/roadDatabase';

interface RoadsMapProps {
  roads: RoadCell[];
}

// Color based on percentile: green (smooth) -> yellow -> red (rough)
function getColorByPercentile(percentile: number): string {
  const normalized = percentile / 100;
  if (normalized < 0.33) {
    const t = normalized / 0.33;
    const r = Math.round(34 + t * (234 - 34));
    const g = Math.round(197 + t * (179 - 197));
    const b = Math.round(94 + t * (8 - 94));
    return `rgb(${r},${g},${b})`;
  } else if (normalized < 0.66) {
    const t = (normalized - 0.33) / 0.33;
    const r = Math.round(234 + t * (249 - 234));
    const g = Math.round(179 - t * (179 - 115));
    const b = Math.round(8 + t * (22 - 8));
    return `rgb(${r},${g},${b})`;
  } else {
    const t = (normalized - 0.66) / 0.34;
    const r = Math.round(249 - t * (249 - 239));
    const g = Math.round(115 - t * (115 - 68));
    const b = Math.round(22 + t * (68 - 22));
    return `rgb(${r},${g},${b})`;
  }
}

// Calculate distance between two points in meters (Haversine formula)
function getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const MAX_SEGMENT_DISTANCE = 500; // meters - only connect points within this distance

export default function RoadsMap({ roads }: RoadsMapProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Sort roads by geohash8 to group nearby cells, then create line segments
  const { lineSegments, sortedRoads } = useMemo(() => {
    if (roads.length === 0) {
      return { lineSegments: [], sortedRoads: [] };
    }

    // Sort by geohash8 to group nearby cells
    const sorted = [...roads].sort((a, b) => a.geohash8.localeCompare(b.geohash8));

    // Create line segments between consecutive close points
    const segments: { positions: [number, number][]; color: string; percentile: number }[] = [];

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];

      const distance = getDistanceMeters(current.lat, current.lng, next.lat, next.lng);

      // Only connect if within max distance
      if (distance <= MAX_SEGMENT_DISTANCE) {
        segments.push({
          positions: [[current.lat, current.lng], [next.lat, next.lng]],
          color: getColorByPercentile(current.percentile),
          percentile: current.percentile
        });
      }
    }

    return { lineSegments: segments, sortedRoads: sorted };
  }, [roads]);

  if (!isMounted) {
    return <div className="h-full min-h-[400px] bg-gray-100 flex items-center justify-center">Loading map...</div>;
  }

  if (roads.length === 0) {
    return <div className="h-full min-h-[400px] bg-gray-100 flex items-center justify-center">No road data available</div>;
  }

  // Calculate center from all roads
  const avgLat = roads.reduce((sum, r) => sum + r.lat, 0) / roads.length;
  const avgLng = roads.reduce((sum, r) => sum + r.lng, 0) / roads.length;

  return (
    <MapContainer
      center={[avgLat, avgLng]}
      zoom={13}
      style={{ height: '100%', width: '100%', minHeight: '400px' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {/* Polyline segments connecting nearby points */}
      {lineSegments.map((seg, idx) => (
        <Polyline
          key={`line-${idx}`}
          positions={seg.positions}
          color={seg.color}
          weight={6}
          opacity={0.8}
        />
      ))}
      {/* Small semi-transparent markers at each point for visibility + popups */}
      {sortedRoads.map((road) => (
        <CircleMarker
          key={road.geohash8}
          center={[road.lat, road.lng]}
          radius={3}
          fillColor={getColorByPercentile(road.percentile)}
          color="#333"
          weight={1}
          opacity={0.6}
          fillOpacity={0.5}
        >
          <Popup>
            <div className="text-sm">
              <div><strong>Cell:</strong> {road.geohash8}</div>
              <div><strong>DAN:</strong> {road.avgDAN.toFixed(3)}</div>
              <div><strong>Percentile:</strong> {road.percentile}%</div>
              <div><strong>Samples:</strong> {road.sampleCount}</div>
              <div className="text-xs text-gray-500 mt-1">
                Updated: {new Date(road.lastUpdated).toLocaleDateString()}
              </div>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
