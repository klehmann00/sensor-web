// lib/api/vehicleApi.ts
// NHTSA Vehicle API for make/model lookups

interface Make {
  MakeId: number;
  MakeName: string;
}

interface Model {
  Model_Name: string;
}

// In-memory cache for makes list
let makesCache: Make[] | null = null;

// Get all vehicle makes (cached)
export async function getAllMakes(): Promise<Make[]> {
  if (makesCache) {
    return makesCache;
  }

  try {
    const response = await fetch(
      'https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car?format=json'
    );
    const data = await response.json();

    const makes: Make[] = data.Results || [];

    // Sort alphabetically by MakeName
    makes.sort((a, b) => a.MakeName.localeCompare(b.MakeName));

    // Cache the results
    makesCache = makes;

    return makes;
  } catch (error) {
    console.error('Failed to fetch vehicle makes:', error);
    return [];
  }
}

// Get models for a specific make and year
export async function getModelsForMakeYear(make: string, year: number): Promise<Model[]> {
  try {
    const encodedMake = encodeURIComponent(make);
    const response = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/getmodelsformakeyear/make/${encodedMake}/modelyear/${year}?format=json`
    );
    const data = await response.json();

    const models: Model[] = data.Results || [];

    // Sort alphabetically by Model_Name
    models.sort((a, b) => a.Model_Name.localeCompare(b.Model_Name));

    return models;
  } catch (error) {
    console.error('Failed to fetch vehicle models:', error);
    return [];
  }
}
