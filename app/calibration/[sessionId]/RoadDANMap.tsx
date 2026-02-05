'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { RoadDANSegment } from '@/lib/calibration/types';

interface RoadDANMapProps {
  segments: RoadDANSegment[];
}

// Color based on DAN value: green (smooth) -> yellow -> red (rough)
function getColor(dan: number): string {
  // Typical range: 0.2 (smooth) to 2.0+ (rough)
  const normalized = Math.min(dan / 2.0, 1); // 0-1 range
  if (normalized < 0.33) {
    // Green to Yellow
    const t = normalized / 0.33;
    const r = Math.round(34 + t * (234 - 34));
    const g = Math.round(197 + t * (179 - 197));
    const b = Math.round(8 + t * (8 - 94));
    return `rgb(${r},${g},${b})`;
  } else if (normalized < 0.66) {
    // Yellow to Orange
    const t = (normalized - 0.33) / 0.33;
    const r = Math.round(234 + t * (249 - 234));
    const g = Math.round(179 - t * (179 - 115));
    const b = Math.round(8 + t * (22 - 8));
    return `rgb(${r},${g},${b})`;
  } else {
    // Orange to Red
    const t = (normalized - 0.66) / 0.34;
    const r = Math.round(249 - t * (249 - 239));
    const g = Math.round(115 - t * (115 - 68));
    const b = Math.round(22 + t * (68 - 22));
    return `rgb(${r},${g},${b})`;
  }
}

export default function RoadDANMap({ segments }: RoadDANMapProps) {
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
        {segments.map((segment, idx) => (
          <CircleMarker
            key={`${segment.geohash8}-${idx}`}
            center={[segment.lat, segment.lng]}
            radius={8}
            fillColor={getColor(segment.roadDAN)}
            color="#333"
            weight={1}
            opacity={0.8}
            fillOpacity={0.7}
          >
            <Popup>
              <div className="text-sm">
                <div><strong>DAN:</strong> {segment.roadDAN.toFixed(2)}</div>
                <div><strong>Speed:</strong> {segment.speedMph.toFixed(1)} mph</div>
                <div><strong>Cell:</strong> {segment.geohash8}</div>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
