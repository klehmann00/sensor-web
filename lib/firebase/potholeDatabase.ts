// lib/firebase/potholeDatabase.ts
// Firebase database for pothole detection and tracking

import { ref, get, set, remove } from 'firebase/database';
import { database } from '@/lib/firebase';
import ngeohash from 'ngeohash';

export interface Pothole {
  id?: string;
  lat: number;
  lng: number;
  geohash: string;
  donValue: number;
  danValue: number;
  speedMph: number;
  timestamp: number;
  userId: string;
  vehicleId?: string;
  sessionId: string;
  confidence: number; // 1.0 = just hit, decays by 0.1 per clean pass
  lastUpdated: number;
}

// Upload detected potholes from a session
export async function uploadSessionPotholes(
  userId: string,
  sessionId: string,
  vehicleId: string | undefined,
  potholes: {
    lat: number;
    lng: number;
    donValue: number;
    danValue: number;
    speedMph: number;
    timestamp: number;
  }[]
): Promise<{ potholesAdded: number; potholesUpdated: number }> {
  if (!database || potholes.length === 0) {
    return { potholesAdded: 0, potholesUpdated: 0 };
  }

  let added = 0;
  let updated = 0;

  for (const pothole of potholes) {
    const geohash = ngeohash.encode(pothole.lat, pothole.lng, 8);
    const potholeRef = ref(database, `potholes/${geohash}`);
    const snapshot = await get(potholeRef);

    if (snapshot.exists()) {
      // Hit on existing pothole - reset confidence to 1.0
      const existing = snapshot.val();
      await set(potholeRef, {
        ...existing,
        confidence: 1.0,
        lastUpdated: Date.now(),
        donValue: Math.max(existing.donValue, pothole.donValue),
        danValue: Math.max(existing.danValue, pothole.danValue),
      });
      updated++;
    } else {
      // New pothole
      await set(potholeRef, {
        lat: pothole.lat,
        lng: pothole.lng,
        geohash,
        donValue: pothole.donValue,
        danValue: pothole.danValue,
        speedMph: pothole.speedMph,
        timestamp: pothole.timestamp,
        userId,
        vehicleId: vehicleId || null,
        sessionId,
        confidence: 1.0,
        lastUpdated: Date.now(),
      });
      added++;
    }
  }

  return { potholesAdded: added, potholesUpdated: updated };
}

// Record a clean pass through a pothole cell (no spike detected)
export async function recordCleanPass(geohash: string): Promise<void> {
  if (!database) return;

  const potholeRef = ref(database, `potholes/${geohash}`);
  const snapshot = await get(potholeRef);

  if (snapshot.exists()) {
    const pothole = snapshot.val();
    const newConfidence = Math.max(0, pothole.confidence - 0.1);

    if (newConfidence <= 0) {
      // 10 clean passes - remove pothole
      await remove(potholeRef);
    } else {
      await set(potholeRef, {
        ...pothole,
        confidence: newConfidence,
        lastUpdated: Date.now(),
      });
    }
  }
}

// Record clean passes for all potholes in cells that were driven through without detection
export async function recordCleanPasses(
  drivenGeohashes: string[],
  detectedGeohashes: string[]
): Promise<{ decayed: number; removed: number }> {
  if (!database) return { decayed: 0, removed: 0 };

  let decayed = 0;
  let removed = 0;

  // Find geohashes that were driven through but had no detection
  const cleanGeohashes = drivenGeohashes.filter(g => !detectedGeohashes.includes(g));

  for (const geohash of cleanGeohashes) {
    const potholeRef = ref(database, `potholes/${geohash}`);
    const snapshot = await get(potholeRef);

    if (snapshot.exists()) {
      const pothole = snapshot.val();
      const newConfidence = Math.max(0, pothole.confidence - 0.1);

      if (newConfidence <= 0) {
        await remove(potholeRef);
        removed++;
      } else {
        await set(potholeRef, {
          ...pothole,
          confidence: newConfidence,
          lastUpdated: Date.now(),
        });
        decayed++;
      }
    }
  }

  return { decayed, removed };
}

// Get all potholes in a bounding box
export async function getPotholesInBounds(
  bounds: { north: number; south: number; east: number; west: number }
): Promise<Pothole[]> {
  if (!database) return [];

  const potholesRef = ref(database, 'potholes');
  const snapshot = await get(potholesRef);

  if (!snapshot.exists()) return [];

  const potholes: Pothole[] = [];
  const data = snapshot.val();

  for (const [geohash, pothole] of Object.entries(data)) {
    const p = pothole as Pothole;
    if (p.lat >= bounds.south && p.lat <= bounds.north &&
        p.lng >= bounds.west && p.lng <= bounds.east) {
      potholes.push({ ...p, id: geohash });
    }
  }

  return potholes;
}
