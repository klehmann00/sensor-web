// lib/firebase/roadDatabase.ts
// Firebase database for aggregated road roughness data

import { database } from '@/lib/firebase';
import { ref, get, update } from 'firebase/database';
import { getPercentile, DANHistogram } from '@/lib/calibration/histogram';
import { RoadDANSegment } from '@/lib/calibration/types';

export interface RoadCell {
  geohash8: string;
  lat: number;
  lng: number;
  avgDAN: number;
  percentile: number;
  sampleCount: number;
  lastUpdated: number;
}

const UPLOADED_SESSIONS_KEY = 'uploadedRoadSessions';

// Get set of session IDs that have been uploaded
export function getUploadedSessions(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const stored = localStorage.getItem(UPLOADED_SESSIONS_KEY);
    if (!stored) return new Set();
    return new Set(JSON.parse(stored));
  } catch (e) {
    console.error('Failed to load uploaded sessions:', e);
    return new Set();
  }
}

// Mark a session as uploaded
export function markSessionUploaded(sessionId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const sessions = getUploadedSessions();
    sessions.add(sessionId);
    localStorage.setItem(UPLOADED_SESSIONS_KEY, JSON.stringify([...sessions]));
  } catch (e) {
    console.error('Failed to mark session uploaded:', e);
  }
}

// Upload road segments to Firebase, merging with existing data
export async function uploadSessionRoads(
  segments: RoadDANSegment[],
  histogram: DANHistogram | null
): Promise<{ cellsUpdated: number; error?: string }> {
  if (!database) {
    return { cellsUpdated: 0, error: 'Database not initialized' };
  }

  if (segments.length === 0) {
    return { cellsUpdated: 0, error: 'No segments to upload' };
  }

  // Group segments by geohash8, tracking sums for averaging
  const cellMap = new Map<string, { latSum: number; lngSum: number; danSum: number; count: number }>();

  for (const segment of segments) {
    const existing = cellMap.get(segment.geohash8);
    if (existing) {
      existing.latSum += segment.lat;
      existing.lngSum += segment.lng;
      existing.danSum += segment.roadDAN;
      existing.count++;
    } else {
      cellMap.set(segment.geohash8, {
        latSum: segment.lat,
        lngSum: segment.lng,
        danSum: segment.roadDAN,
        count: 1
      });
    }
  }

  try {
    // Batch read: get all existing road data in one call
    const snapshot = await get(ref(database, 'roads'));
    const existingRoads: Record<string, RoadCell> = snapshot.exists() ? snapshot.val() : {};

    // Build updates object
    const updates: Record<string, RoadCell> = {};
    const now = Date.now();

    for (const [geohash8, cellData] of cellMap) {
      const sessionAvgLat = cellData.latSum / cellData.count;
      const sessionAvgLng = cellData.lngSum / cellData.count;
      const sessionAvgDAN = cellData.danSum / cellData.count;

      const existing = existingRoads[geohash8];

      if (existing) {
        // Merge with existing data (weighted average for lat, lng, and DAN)
        const totalSamples = existing.sampleCount + cellData.count;
        const weightedLat = (existing.lat * existing.sampleCount + sessionAvgLat * cellData.count) / totalSamples;
        const weightedLng = (existing.lng * existing.sampleCount + sessionAvgLng * cellData.count) / totalSamples;
        const weightedDAN = (existing.avgDAN * existing.sampleCount + sessionAvgDAN * cellData.count) / totalSamples;
        const newPercentile = histogram ? getPercentile(histogram, weightedDAN) : existing.percentile;

        updates[`roads/${geohash8}`] = {
          geohash8,
          lat: weightedLat,
          lng: weightedLng,
          avgDAN: weightedDAN,
          percentile: newPercentile,
          sampleCount: totalSamples,
          lastUpdated: now
        };
      } else {
        // Create new cell
        const sessionPercentile = histogram ? getPercentile(histogram, sessionAvgDAN) : 50;

        updates[`roads/${geohash8}`] = {
          geohash8,
          lat: sessionAvgLat,
          lng: sessionAvgLng,
          avgDAN: sessionAvgDAN,
          percentile: sessionPercentile,
          sampleCount: cellData.count,
          lastUpdated: now
        };
      }
    }

    // Batch write: single update call for all cells
    await update(ref(database), updates);
    const cellsUpdated = Object.keys(updates).length;

    console.log(`Uploaded ${cellsUpdated} road cells to Firebase`);
    return { cellsUpdated };
  } catch (e) {
    console.error('Failed to upload road cells:', e);
    return { cellsUpdated: 0, error: 'Failed to upload road data' };
  }
}

// Get all road cells from Firebase
export async function getAllRoads(): Promise<RoadCell[]> {
  if (!database) {
    console.error('Database not initialized');
    return [];
  }

  try {
    const snapshot = await get(ref(database, 'roads'));

    if (!snapshot.exists()) {
      return [];
    }

    const data = snapshot.val();
    const roads: RoadCell[] = [];

    for (const geohash8 of Object.keys(data)) {
      const cell = data[geohash8];
      roads.push({
        geohash8,
        lat: cell.lat,
        lng: cell.lng,
        avgDAN: cell.avgDAN,
        percentile: cell.percentile,
        sampleCount: cell.sampleCount,
        lastUpdated: cell.lastUpdated
      });
    }

    console.log(`Loaded ${roads.length} road cells from Firebase`);
    return roads;
  } catch (e) {
    console.error('Failed to load roads:', e);
    return [];
  }
}
