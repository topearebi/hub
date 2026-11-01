/**
 * Hub Telemetry
 * -------------
 * Fetches the client IP + approximate location (ipwho.is) and current weather
 * (Open-Meteo), caching the result locally with a 30-minute TTL. All network
 * access is asynchronous and fail-silent: on error the last cached value (or
 * `null`) is returned so the UI can show an offline fallback badge.
 *
 * Pure helpers (`isFresh`, `weatherLabel`, `locationLabel`) are exported for
 * unit testing without any network or DOM.
 */

/** Local cache lifetime (30 minutes). */
export const TELEMETRY_TTL_MS = 30 * 60 * 1000;

const IP_ENDPOINT = 'https://ipwho.is/';
const WEATHER_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

/** Resolved telemetry snapshot. */
export interface TelemetryData {
  ip: string;
  location: string;
  latitude: number;
  longitude: number;
  temperature: number;
  weatherCode: number;
  weatherLabel: string;
  fetchedAt: number;
}

/** Minimal storage contract (satisfied by `localStorage`). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

/** True when a cached snapshot is still within its TTL. */
export function isFresh(fetchedAt: number, now: number, ttl: number = TELEMETRY_TTL_MS): boolean {
  return now - fetchedAt < ttl;
}

/** Build a human-readable location label from ipwho.is fields. */
export function locationLabel(city?: string, region?: string, country?: string): string {
  const parts = [city, region, country].map((part) => part?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'Unknown location';
}

/** Map a WMO weather code to a short human label. */
export function weatherLabel(code: number): string {
  if (code === 0) return 'Clear';
  if (code >= 1 && code <= 3) return 'Partly cloudy';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Unknown';
}

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

interface IpWhoResponse {
  success?: boolean;
  ip?: string;
  city?: string;
  region?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
}

interface OpenMeteoResponse {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
  };
}

export interface TelemetryOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  storage?: StorageLike | null;
  cacheKey?: string;
}

export class TelemetryService {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly storage: StorageLike | null;
  private readonly cacheKey: string;

  constructor(options: TelemetryOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => Date.now());
    this.storage = options.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    this.cacheKey = options.cacheKey ?? 'hub.telemetry';
  }

  /** Read the cached snapshot, if any and well-formed. */
  readCache(): TelemetryData | null {
    if (!this.storage) {
      return null;
    }
    try {
      const raw = this.storage.getItem(this.cacheKey);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as TelemetryData;
      return typeof parsed?.fetchedAt === 'number' ? parsed : null;
    } catch {
      return null;
    }
  }

  private writeCache(data: TelemetryData): void {
    if (!this.storage) {
      return;
    }
    try {
      this.storage.setItem(this.cacheKey, JSON.stringify(data));
    } catch {
      // Storage may be full or unavailable; caching is best-effort.
    }
  }

  /**
   * Resolve telemetry, preferring a fresh cache. On network failure the stale
   * cache (or `null`) is returned so callers can render a fallback.
   */
  async load(force = false): Promise<TelemetryData | null> {
    const cached = this.readCache();
    if (!force && cached && isFresh(cached.fetchedAt, this.now())) {
      return cached;
    }

    try {
      const data = await this.fetchAll();
      this.writeCache(data);
      return data;
    } catch {
      return cached;
    }
  }

  private async fetchAll(): Promise<TelemetryData> {
    const ipResponse = await this.fetchImpl(IP_ENDPOINT);
    if (!ipResponse.ok) {
      throw new Error('IP lookup failed.');
    }
    const ip = (await ipResponse.json()) as IpWhoResponse;
    if (ip.success === false) {
      throw new Error('IP lookup unsuccessful.');
    }

    const latitude = ip.latitude ?? 0;
    const longitude = ip.longitude ?? 0;

    const weatherUrl = `${WEATHER_ENDPOINT}?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code`;
    const weatherResponse = await this.fetchImpl(weatherUrl);
    if (!weatherResponse.ok) {
      throw new Error('Weather lookup failed.');
    }
    const weather = (await weatherResponse.json()) as OpenMeteoResponse;

    const code = weather.current?.weather_code ?? 0;

    return {
      ip: ip.ip ?? '',
      location: locationLabel(ip.city, ip.region, ip.country),
      latitude,
      longitude,
      temperature: weather.current?.temperature_2m ?? 0,
      weatherCode: code,
      weatherLabel: weatherLabel(code),
      fetchedAt: this.now(),
    };
  }
}
