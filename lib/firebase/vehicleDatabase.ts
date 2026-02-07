// lib/firebase/vehicleDatabase.ts
// Firebase database for user vehicle management

import { database } from '@/lib/firebase';
import { ref, get, set, update, remove, push } from 'firebase/database';

export interface Vehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  nickname?: string;
  isDefault: boolean;
  createdAt: number;
  experienceMinDAN?: number;
  experienceMaxDAN?: number;
  experienceTotalSegments?: number;
}

// Fetch all vehicles for a user
export async function getUserVehicles(userId: string): Promise<Vehicle[]> {
  if (!database) {
    console.error('Database not initialized');
    return [];
  }

  try {
    const snapshot = await get(ref(database, `users/${userId}/vehicles`));

    if (!snapshot.exists()) {
      return [];
    }

    const data = snapshot.val();
    const vehicles: Vehicle[] = [];

    for (const id of Object.keys(data)) {
      vehicles.push({
        id,
        ...data[id]
      });
    }

    return vehicles;
  } catch (e) {
    console.error('Failed to load vehicles:', e);
    return [];
  }
}

// Add a new vehicle, returns the new vehicle ID
export async function addVehicle(
  userId: string,
  vehicle: Omit<Vehicle, 'id' | 'createdAt'>
): Promise<string> {
  if (!database) {
    throw new Error('Database not initialized');
  }

  // Check if this is the user's first vehicle
  const existingVehicles = await getUserVehicles(userId);
  const isFirstVehicle = existingVehicles.length === 0;

  const vehiclesRef = ref(database, `users/${userId}/vehicles`);
  const newVehicleRef = push(vehiclesRef);
  const vehicleId = newVehicleRef.key!;

  const vehicleData = {
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    nickname: vehicle.nickname || null,
    isDefault: isFirstVehicle ? true : vehicle.isDefault,
    createdAt: Date.now()
  };

  await set(newVehicleRef, vehicleData);

  return vehicleId;
}

// Update an existing vehicle
export async function updateVehicle(
  userId: string,
  vehicleId: string,
  updates: Partial<Vehicle>
): Promise<void> {
  if (!database) {
    throw new Error('Database not initialized');
  }

  // Remove id from updates if present (shouldn't be updated)
  const { id, ...safeUpdates } = updates as Vehicle;

  await update(ref(database, `users/${userId}/vehicles/${vehicleId}`), safeUpdates);
}

// Delete a vehicle
export async function deleteVehicle(userId: string, vehicleId: string): Promise<void> {
  if (!database) {
    throw new Error('Database not initialized');
  }

  await remove(ref(database, `users/${userId}/vehicles/${vehicleId}`));
}

// Set a vehicle as the default (and unset any other default)
export async function setDefaultVehicle(userId: string, vehicleId: string): Promise<void> {
  if (!database) {
    throw new Error('Database not initialized');
  }

  // Get all vehicles
  const vehicles = await getUserVehicles(userId);

  // Build updates object to set all isDefault to false except the target
  const updates: Record<string, boolean> = {};
  for (const vehicle of vehicles) {
    updates[`users/${userId}/vehicles/${vehicle.id}/isDefault`] = vehicle.id === vehicleId;
  }

  await update(ref(database), updates);
}

// Get the default vehicle or null
export async function getDefaultVehicle(userId: string): Promise<Vehicle | null> {
  const vehicles = await getUserVehicles(userId);
  return vehicles.find(v => v.isDefault) || null;
}

// Update vehicle experience (min/max DAN bounds)
export async function updateVehicleExperience(
  userId: string,
  vehicleId: string,
  sessionMinDAN: number,
  sessionMaxDAN: number,
  segmentCount: number
): Promise<void> {
  if (!database) return;

  const vehicleRef = ref(database, `users/${userId}/vehicles/${vehicleId}`);
  const snapshot = await get(vehicleRef);

  if (!snapshot.exists()) return;

  const vehicle = snapshot.val() as Vehicle;

  // Experience bounds can only EXPAND, never contract
  const newMinDAN = vehicle.experienceMinDAN !== undefined
    ? Math.min(vehicle.experienceMinDAN, sessionMinDAN)
    : sessionMinDAN;

  const newMaxDAN = vehicle.experienceMaxDAN !== undefined
    ? Math.max(vehicle.experienceMaxDAN, sessionMaxDAN)
    : sessionMaxDAN;

  const newTotalSegments = (vehicle.experienceTotalSegments || 0) + segmentCount;

  await update(vehicleRef, {
    experienceMinDAN: newMinDAN,
    experienceMaxDAN: newMaxDAN,
    experienceTotalSegments: newTotalSegments
  });

  console.log('Vehicle experience updated:', {
    minDAN: newMinDAN.toFixed(2),
    maxDAN: newMaxDAN.toFixed(2),
    totalSegments: newTotalSegments
  });
}

// Reset vehicle experience (for testing/debugging)
export async function resetVehicleExperience(
  userId: string,
  vehicleId: string
): Promise<void> {
  if (!database) return;

  const vehicleRef = ref(database, `users/${userId}/vehicles/${vehicleId}`);
  await update(vehicleRef, {
    experienceMinDAN: null,
    experienceMaxDAN: null,
    experienceTotalSegments: null
  });

  console.log('Vehicle experience reset for:', vehicleId);
}
