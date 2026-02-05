// Histogram for vehicle DAN distribution
// 100 bins covering 0.0 to 4.0 DAN range (0.04 per bin)

export interface DANHistogram {
  bins: number[];      // 100 bin counts
  totalSamples: number;
  minDAN: number;      // observed min
  maxDAN: number;      // observed max
}

const NUM_BINS = 100;
const MAX_DAN = 4.0;
const BIN_WIDTH = MAX_DAN / NUM_BINS;  // 0.04

export function createHistogram(): DANHistogram {
  return {
    bins: new Array(NUM_BINS).fill(0),
    totalSamples: 0,
    minDAN: Infinity,
    maxDAN: -Infinity,
  };
}

export function addSample(histogram: DANHistogram, roadDAN: number): void {
  // Clamp to valid range
  const clamped = Math.max(0, Math.min(roadDAN, MAX_DAN - 0.001));
  const binIndex = Math.floor(clamped / BIN_WIDTH);

  histogram.bins[binIndex]++;
  histogram.totalSamples++;
  histogram.minDAN = Math.min(histogram.minDAN, roadDAN);
  histogram.maxDAN = Math.max(histogram.maxDAN, roadDAN);
}

export function getPercentile(histogram: DANHistogram, roadDAN: number): number {
  if (histogram.totalSamples === 0) return 50; // No data, assume middle

  const clamped = Math.max(0, Math.min(roadDAN, MAX_DAN - 0.001));
  const targetBin = Math.floor(clamped / BIN_WIDTH);

  // Count samples below this bin
  let samplesBelow = 0;
  for (let i = 0; i < targetBin; i++) {
    samplesBelow += histogram.bins[i];
  }

  // Add half of current bin (assume uniform distribution within bin)
  samplesBelow += histogram.bins[targetBin] / 2;

  return Math.round((samplesBelow / histogram.totalSamples) * 100);
}

export function getStats(histogram: DANHistogram): {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
} {
  if (histogram.totalSamples === 0) {
    return { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 };
  }

  const findPercentileValue = (targetPercentile: number): number => {
    const targetCount = (targetPercentile / 100) * histogram.totalSamples;
    let cumulative = 0;

    for (let i = 0; i < NUM_BINS; i++) {
      cumulative += histogram.bins[i];
      if (cumulative >= targetCount) {
        // Return bin midpoint
        return (i + 0.5) * BIN_WIDTH;
      }
    }
    return MAX_DAN;
  };

  return {
    p10: findPercentileValue(10),
    p25: findPercentileValue(25),
    p50: findPercentileValue(50),
    p75: findPercentileValue(75),
    p90: findPercentileValue(90),
  };
}

// For debugging - get a text representation
export function histogramToString(histogram: DANHistogram): string {
  const stats = getStats(histogram);
  return `Samples: ${histogram.totalSamples}, Range: ${histogram.minDAN.toFixed(2)}-${histogram.maxDAN.toFixed(2)}, ` +
    `P10=${stats.p10.toFixed(2)}, P50=${stats.p50.toFixed(2)}, P90=${stats.p90.toFixed(2)}`;
}
