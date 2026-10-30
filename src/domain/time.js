import { BadRequestError } from '../errors.js';

const PORTAL_TS_REGEX = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/;
const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Validate day against month and leap year.
 */
function isValidDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const daysInMonth = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

/**
 * Parse portal timestamp format 'DD/MM/YYYY HH:mm' strictly.
 * Outputs an ISO 8601 string with the given timezone offset and epoch milliseconds.
 *
 * @param {string} str
 * @param {string} [tzOffset='+05:30']
 * @returns {{ iso: string, epochMs: number } | null} Returns null if timestamp is malformed
 */
export function parsePortalTimestamp(str, tzOffset = '+05:30') {
  if (typeof str !== 'string') return null;
  const match = str.trim().match(PORTAL_TS_REGEX);
  if (!match) return null;

  const [, dayStr, monthStr, yearStr, hourStr, minStr] = match;
  const day = parseInt(dayStr, 10);
  const month = parseInt(monthStr, 10);
  const year = parseInt(yearStr, 10);
  const hour = parseInt(hourStr, 10);
  const min = parseInt(minStr, 10);

  if (hour < 0 || hour > 23 || min < 0 || min > 59) return null;
  if (!isValidDate(year, month, day)) return null;

  const iso = `${yearStr}-${monthStr}-${dayStr}T${hourStr}:${minStr}:00${tzOffset}`;
  const epochMs = Date.parse(iso);
  if (Number.isNaN(epochMs)) return null;

  return { iso, epochMs };
}

/**
 * Parse a query timestamp parameter ('from' or 'to').
 * Accepts:
 * - Date-only 'YYYY-MM-DD' (interpreted as midnight in configured tzOffset)
 * - Full ISO 8601 string with timezone offset or 'Z'
 *
 * @param {string} str
 * @param {string} [tzOffset='+05:30']
 * @returns {{ iso: string, epochMs: number }}
 */
export function parseQueryInstant(str, tzOffset = '+05:30') {
  if (typeof str !== 'string' || !str.trim()) {
    throw new BadRequestError('Timestamp string must be a non-empty string');
  }

  const trimmed = str.trim();

  // 1. Date only: YYYY-MM-DD
  const dateMatch = trimmed.match(DATE_ONLY_REGEX);
  if (dateMatch) {
    const [, yearStr, monthStr, dayStr] = dateMatch;
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const day = parseInt(dayStr, 10);
    if (!isValidDate(year, month, day)) {
      throw new BadRequestError(`Invalid calendar date: "${trimmed}"`);
    }
    const iso = `${yearStr}-${monthStr}-${dayStr}T00:00:00${tzOffset}`;
    const epochMs = Date.parse(iso);
    return { iso, epochMs };
  }

  // 2. Full ISO 8601 string
  const epochMs = Date.parse(trimmed);
  if (Number.isNaN(epochMs)) {
    throw new BadRequestError(
      `Invalid ISO 8601 timestamp: "${trimmed}". Expected YYYY-MM-DD or full ISO 8601 with timezone offset.`
    );
  }

  return { iso: new Date(epochMs).toISOString(), epochMs };
}
