import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAndNormalizeTimezone,
  getDateKeyForTimezone,
  resolveEffectiveTimezone,
} from '../src/lib/timezone.js';

describe('Timezone Resolution and Normalization Tests', () => {
  it('1. Validates and normalizes legacy alias Asia/Calcutta to Asia/Kolkata', () => {
    const res = validateAndNormalizeTimezone('Asia/Calcutta');
    assert.equal(res.valid, true);
    assert.equal(res.normalized, 'Asia/Kolkata');
  });

  it('2. Accepts canonical Asia/Kolkata and preserves it', () => {
    const res = validateAndNormalizeTimezone('Asia/Kolkata');
    assert.equal(res.valid, true);
    assert.equal(res.normalized, 'Asia/Kolkata');
  });

  it('3. Accepts UTC and America/New_York', () => {
    const utc = validateAndNormalizeTimezone('UTC');
    assert.equal(utc.valid, true);
    assert.equal(utc.normalized, 'UTC');

    const ny = validateAndNormalizeTimezone('America/New_York');
    assert.equal(ny.valid, true);
    assert.equal(ny.normalized, 'America/New_York');

    const usEast = validateAndNormalizeTimezone('US/Eastern');
    assert.equal(usEast.valid, true);
    assert.equal(usEast.normalized, 'America/New_York');
  });

  it('4. Rejects invalid timezone and returns descriptive error', () => {
    const res = validateAndNormalizeTimezone('Moon/Base_Alpha');
    assert.equal(res.valid, false);
    assert.match(res.error || '', /Invalid IANA timezone/);
  });

  it('5. Fallback logic prioritizes user profile timezone before default', () => {
    // If request timezone is valid, use it
    const reqRes = resolveEffectiveTimezone('Asia/Calcutta', 'UTC');
    assert.equal(reqRes.timezone, 'Asia/Kolkata');

    // If request timezone is omitted, fall back to profile timezone
    const profRes = resolveEffectiveTimezone(undefined, 'America/New_York');
    assert.equal(profRes.timezone, 'America/New_York');

    // If request timezone is invalid, return error immediately
    const errRes = resolveEffectiveTimezone('Invalid/Zone', 'Asia/Kolkata');
    assert.equal(errRes.timezone, '');
    assert.ok(errRes.error);
  });

  it('6. Handles local midnight crossovers accurately across timezones', () => {
    // 2026-11-14 23:59:00 in Asia/Kolkata (UTC+5:30) is 2026-11-14T18:29:00.000Z
    const justBeforeMidnight = new Date('2026-11-14T18:29:00.000Z');
    // 2026-11-15 00:01:00 in Asia/Kolkata (UTC+5:30) is 2026-11-14T18:31:00.000Z
    const justAfterMidnight = new Date('2026-11-14T18:31:00.000Z');

    // In Asia/Calcutta (normalized to Kolkata):
    assert.equal(getDateKeyForTimezone(justBeforeMidnight, 'Asia/Calcutta'), '2026-11-14');
    assert.equal(getDateKeyForTimezone(justAfterMidnight, 'Asia/Calcutta'), '2026-11-15');

    // In Asia/Kolkata:
    assert.equal(getDateKeyForTimezone(justBeforeMidnight, 'Asia/Kolkata'), '2026-11-14');
    assert.equal(getDateKeyForTimezone(justAfterMidnight, 'Asia/Kolkata'), '2026-11-15');

    // In UTC, both instants are still on 2026-11-14:
    assert.equal(getDateKeyForTimezone(justBeforeMidnight, 'UTC'), '2026-11-14');
    assert.equal(getDateKeyForTimezone(justAfterMidnight, 'UTC'), '2026-11-14');

    // In America/New_York (UTC-5):
    // 18:29 UTC is 13:29 EST (2026-11-14)
    assert.equal(getDateKeyForTimezone(justBeforeMidnight, 'America/New_York'), '2026-11-14');
    assert.equal(getDateKeyForTimezone(justAfterMidnight, 'America/New_York'), '2026-11-14');
  });
});
