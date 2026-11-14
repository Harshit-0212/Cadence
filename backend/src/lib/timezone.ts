/**
 * Timezone validation, alias normalization, and local date computation.
 * Validates against Intl.DateTimeFormat try/catch per spec.
 */

const ALIAS_MAP: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Ulan_Bator': 'Asia/Ulaanbaatar',
  'Asia/Macao': 'Asia/Macau',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Europe/Kiev': 'Europe/Kyiv',
  'Europe/Uzhgorod': 'Europe/Kyiv',
  'Europe/Zaporozhye': 'Europe/Kyiv',
  'US/Eastern': 'America/New_York',
  'US/Central': 'America/Chicago',
  'US/Mountain': 'America/Denver',
  'US/Pacific': 'America/Los_Angeles',
  'US/Hawaii': 'Pacific/Honolulu',
  'US/Alaska': 'America/Anchorage',
  'US/Arizona': 'America/Phoenix',
  'Etc/UTC': 'UTC',
  'Etc/GMT': 'UTC',
  'GMT': 'UTC',
  'UTC': 'UTC',
};

export interface TimezoneValidationResult {
  valid: boolean;
  normalized: string;
  error?: string;
}

/**
 * Validates any IANA timezone or legacy alias by trying to construct
 * Intl.DateTimeFormat(undefined, { timeZone }) in a try/catch.
 * Normalizes legacy aliases (e.g. Asia/Calcutta -> Asia/Kolkata).
 */
export function validateAndNormalizeTimezone(tz?: string | null): TimezoneValidationResult {
  if (!tz || typeof tz !== 'string' || !tz.trim()) {
    return {
      valid: false,
      normalized: '',
      error: 'Timezone parameter is missing or empty.',
    };
  }

  const clean = tz.trim();

  // Test validity using Intl.DateTimeFormat constructor
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: clean });
  } catch {
    return {
      valid: false,
      normalized: '',
      error: `Invalid IANA timezone: "${tz}". Please supply a valid timezone identifier.`,
    };
  }

  // Canonicalize legacy aliases for reliable DB storage
  const normalized = ALIAS_MAP[clean] || clean;
  return { valid: true, normalized };
}

/**
 * Single source of truth helper for computing local YYYY-MM-DD dateKey
 * from any instant (Date object or epoch ms) in the target timezone.
 * Uses en-CA locale to guarantee strict YYYY-MM-DD output format.
 */
export function getDateKeyForTimezone(instant: Date | number = new Date(), timezone = 'Asia/Kolkata'): string {
  const d = typeof instant === 'number' ? new Date(instant) : instant;
  const { normalized } = validateAndNormalizeTimezone(timezone);
  const targetTz = normalized || 'Asia/Kolkata';

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: targetTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Resolves the effective timezone for an incoming request.
 * If requestedTz is invalid, returns valid: false with clear error.
 * If omitted, falls back to the user's saved profile timezone, never silently to UTC.
 */
export function resolveEffectiveTimezone(
  requestedTz?: string | null,
  userProfileTz?: string | null
): { timezone: string; error?: string } {
  if (requestedTz && requestedTz.trim()) {
    const res = validateAndNormalizeTimezone(requestedTz);
    if (!res.valid) {
      return { timezone: '', error: res.error };
    }
    return { timezone: res.normalized };
  }

  if (userProfileTz && userProfileTz.trim()) {
    const res = validateAndNormalizeTimezone(userProfileTz);
    if (res.valid) {
      return { timezone: res.normalized };
    }
  }

  // Fallback to primary application default (Asia/Kolkata)
  return { timezone: 'Asia/Kolkata' };
}
