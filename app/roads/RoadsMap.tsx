'use client';

import { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { RoadCell } from '@/lib/firebase/roadDatabase';

interface RoadsMapProps {
  roads: RoadCell[];
}

// Connection threshold - geohash8 cells are ~38m × 19m
const MAX_CHAIN_GAP = 60; // meters

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

// Build chains using nearest-neighbor algorithm
function buildChains(roads: RoadCell[]): RoadCell[][] {
  if (roads.length === 0) return [];

  const chains: RoadCell[][] = [];
  const unvisited = new Set<number>(roads.map((_, i) => i));

  while (unvisited.size > 0) {
    // Start a new chain with first unvisited cell
    const startIdx = unvisited.values().next().value as number;
    unvisited.delete(startIdx);
    const chain: RoadCell[] = [roads[startIdx]];

    // Grow chain by finding nearest neighbors
    let growing = true;
    while (growing && unvisited.size > 0) {
      const lastCell = chain[chain.length - 1];
      let nearestIdx = -1;
      let nearestDist = Infinity;

      // Find closest unvisited cell
      for (const idx of unvisited) {
        const dist = getDistanceMeters(lastCell.lat, lastCell.lng, roads[idx].lat, roads[idx].lng);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = idx;
        }
      }

      // Add to chain if within threshold, otherwise end chain
      if (nearestIdx !== -1 && nearestDist <= MAX_CHAIN_GAP) {
        unvisited.delete(nearestIdx);
        chain.push(roads[nearestIdx]);
      } else {
        growing = false;
      }
    }

    chains.push(chain);
  }

  return chains;
}

export default function RoadsMap({ roads }: RoadsMapProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Build chains using nearest-neighbor algorithm
  const chains = useMemo(() => buildChains(roads), [roads]);

  // Calculate individual segments for rendering (each segment colored by starting cell)
  const segments = useMemo(() => {
    const result: { positions: [[number, number], [number, number]]; color: string; key: string }[] = [];
    for (const chain of chains) {
      for (let i = 0; i < chain.length - 1; i++) {
        const startCell = chain[i];
        const endCell = chain[i + 1];
        result.push({
          positions: [[startCell.lat, startCell.lng], [endCell.lat, endCell.lng]],
          color: getColorByPercentile(startCell.percentile),
          key: `${startCell.geohash8}-${endCell.geohash8}`
        });
      }
    }
    return result;
  }, [chains]);

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
      {/* Render individual segments, each colored by starting cell's percentile */}
      {segments.map((segment) => (
        <Polyline
          key={segment.key}
          positions={segment.positions}
          color={segment.color}
          weight={6}
          opacity={1}
        />
      ))}
      {/* Render each cell as a small marker for popup interaction */}
      {roads.map((road) => (
        <CircleMarker
          key={road.geohash8}
          center={[road.lat, road.lng]}
          radius={4}
          fillColor={getColorByPercentile(road.percentile)}
          color="#333"
          weight={0}
          opacity={1}
          fillOpacity={1}
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
