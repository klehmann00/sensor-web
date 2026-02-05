'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Polyline, Popup, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { RoadDANSegment } from '@/lib/calibration/types';
import { getPercentile } from '@/lib/calibration/histogram';

interface RoadDANMapProps {
  segments: RoadDANSegment[];
  histogram?: { bins: number[]; totalSamples: number; minDAN: number; maxDAN: number } | null;
}

// Color based on absolute DAN value: green (smooth) -> yellow -> red (rough)
function getColorByAbsolute(dan: number): string {
  const normalized = Math.min(dan / 2.0, 1);
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

// Color based on percentile: green (smooth for this session) -> yellow -> red (rough for this session)
function getColorByPercentile(percentile: number): string {
  const normalized = percentile / 100; // 0-1 range
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

export default function RoadDANMap({ segments, histogram }: RoadDANMapProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return <div className="h-64 bg-gray-100 flex items-center justify-center">Loading map...</div>;
  }

  if (segments.length === 0) {
    return <div className="h-64 bg-gray-100 flex items-center justify-center">No GPS segments available</div>;
  }

  // Calculate center from segments
  const avgLat = segments.reduce((sum, s) => sum + s.lat, 0) / segments.length;
  const avgLng = segments.reduce((sum, s) => sum + s.lng, 0) / segments.length;

  // Create line segments between consecutive points
  const lineSegments: { positions: [number, number][]; color: string; dan: number; speed: number; percentile?: number }[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const current = segments[i];
    const next = segments[i + 1];
    const percentile = histogram ? getPercentile(histogram, current.roadDAN) : null;
    lineSegments.push({
      positions: [[current.lat, current.lng], [next.lat, next.lng]],
      color: percentile !== null ? getColorByPercentile(percentile) : getColorByAbsolute(current.roadDAN),
      dan: current.roadDAN,
      speed: current.speedMph,
      percentile: percentile ?? undefined
    });
  }

  return (
    <div className="h-64 w-full rounded border">
      <MapContainer
        center={[avgLat, avgLng]}
        zoom={15}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {lineSegments.map((seg, idx) => (
          <Polyline
            key={idx}
            positions={seg.positions}
            color={seg.color}
            weight={6}
            opacity={0.8}
          />
        ))}
        {/* Start and end markers */}
        {segments.length > 0 && (
          <>
            <CircleMarker
              center={[segments[0].lat, segments[0].lng]}
              radius={8}
              fillColor="#22c55e"
              color="#166534"
              weight={2}
              fillOpacity={1}
            >
              <Popup>Start</Popup>
            </CircleMarker>
            <CircleMarker
              center={[segments[segments.length - 1].lat, segments[segments.length - 1].lng]}
              radius={8}
              fillColor="#ef4444"
              color="#991b1b"
              weight={2}
              fillOpacity={1}
            >
              <Popup>End</Popup>
            </CircleMarker>
          </>
        )}
      </MapContainer>
    </div>
  );
}
