// lib/firebase/roadDatabase.ts
// Firebase database for aggregated road roughness data

import { database } from '@/lib/firebase';
import { ref, set, get, child } from 'firebase/database';
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

  // Group segments by geohash8
  const cellMap = new Map<string, { lat: number; lng: number; danSum: number; count: number }>();

  for (const segment of segments) {
    const existing = cellMap.get(segment.geohash8);
    if (existing) {
      existing.danSum += segment.roadDAN;
      existing.count++;
    } else {
      cellMap.set(segment.geohash8, {
        lat: segment.lat,
        lng: segment.lng,
        danSum: segment.roadDAN,
        count: 1
      });
    }
  }

  let cellsUpdated = 0;
  const dbRef = ref(database);

  for (const [geohash8, cellData] of cellMap) {
    try {
      const sessionAvgDAN = cellData.danSum / cellData.count;
      const sessionPercentile = histogram ? getPercentile(histogram, sessionAvgDAN) : 50;

      // Read existing data for this cell
      const snapshot = await get(child(dbRef, `roads/${geohash8}`));

      let newCell: RoadCell;

      if (snapshot.exists()) {
        // Merge with existing data (weighted average)
        const existing = snapshot.val() as RoadCell;
        const totalSamples = existing.sampleCount + cellData.count;
        const weightedDAN = (existing.avgDAN * existing.sampleCount + sessionAvgDAN * cellData.count) / totalSamples;
        const newPercentile = histogram ? getPercentile(histogram, weightedDAN) : existing.percentile;

        newCell = {
          geohash8,
          lat: cellData.lat,
          lng: cellData.lng,
          avgDAN: weightedDAN,
          percentile: newPercentile,
          sampleCount: totalSamples,
          lastUpdated: Date.now()
        };
      } else {
        // Create new cell
        newCell = {
          geohash8,
          lat: cellData.lat,
          lng: cellData.lng,
          avgDAN: sessionAvgDAN,
          percentile: sessionPercentile,
          sampleCount: cellData.count,
          lastUpdated: Date.now()
        };
      }

      // Write to Firebase
      await set(ref(database, `roads/${geohash8}`), newCell);
      cellsUpdated++;
    } catch (e) {
      console.error(`Failed to update cell ${geohash8}:`, e);
    }
  }

  console.log(`Uploaded ${cellsUpdated} road cells to Firebase`);
  return { cellsUpdated };
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
