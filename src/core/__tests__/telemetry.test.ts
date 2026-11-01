import { describe, expect, it, vi } from 'vitest';

import {
  TELEMETRY_TTL_MS,
  TelemetryService,
  isFresh,
  locationLabel,
  weatherLabel,
} from '../telemetry';
import type { StorageLike } from '../telemetry';

/** In-memory `StorageLike` for tests. */
function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe('isFresh', () => {
  it('is fresh within the TTL', () => {
    expect(isFresh(1000, 1000 + TELEMETRY_TTL_MS - 1)).toBe(true);
  });

  it('is stale at or after the TTL', () => {
    expect(isFresh(1000, 1000 + TELEMETRY_TTL_MS)).toBe(false);
  });
});

describe('weatherLabel', () => {
  it('maps representative WMO codes', () => {
    expect(weatherLabel(0)).toBe('Clear');
    expect(weatherLabel(2)).toBe('Partly cloudy');
    expect(weatherLabel(61)).toBe('Rain');
    expect(weatherLabel(95)).toBe('Thunderstorm');
  });
});

describe('locationLabel', () => {
  it('joins the available parts', () => {
    expect(locationLabel('London', 'England', 'UK')).toBe('London, England, UK');
  });

  it('falls back when nothing is available', () => {
    expect(locationLabel()).toBe('Unknown location');
  });
});

describe('TelemetryService', () => {
  it('fetches, caches, and reuses telemetry within the TTL', async () => {
    const storage = memoryStorage();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          ip: '1.2.3.4',
          city: 'London',
          region: 'England',
          country: 'UK',
          latitude: 51.5,
          longitude: -0.1,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ current: { temperature_2m: 12.3, weather_code: 2 } }),
      });

    const service = new TelemetryService({
      fetchImpl: fetchMock as unknown as typeof fetch,
      storage,
      now: () => 1000,
    });

    const data = await service.load();
    expect(data?.ip).toBe('1.2.3.4');
    expect(data?.location).toBe('London, England, UK');
    expect(data?.weatherLabel).toBe('Partly cloudy');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // A second load within the TTL is served from cache (no new fetch).
    const again = await service.load();
    expect(again?.ip).toBe('1.2.3.4');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns the stale cache when the network fails', async () => {
    const storage = memoryStorage();
    storage.setItem(
      'hub.telemetry',
      JSON.stringify({
        ip: '9.9.9.9',
        location: 'Cached',
        latitude: 0,
        longitude: 0,
        temperature: 1,
        weatherCode: 0,
        weatherLabel: 'Clear',
        fetchedAt: 0,
      }),
    );

    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    const service = new TelemetryService({
      fetchImpl: fetchMock as unknown as typeof fetch,
      storage,
      now: () => TELEMETRY_TTL_MS + 1,
    });

    const data = await service.load();
    expect(data?.ip).toBe('9.9.9.9');
  });
});
