import { describe, expect, it } from 'vitest';
import { isDirectToCell, parseTleText, starlinkBlock } from '../lib/math/tle';
import {
  ISS_TLE,
  MALFORMED_TLE_TEXT,
  STARLINK_DTC_TLE,
  STARLINK_TLE,
  VALID_TLE_TEXT,
} from './fixtures';

describe('parseTleText', () => {
  it('parses a well-formed 3LE document', () => {
    const records = parseTleText(VALID_TLE_TEXT);
    expect(records).toHaveLength(2);
    expect(records[0]!.name).toBe(ISS_TLE.name);
    expect(records[0]!.noradId).toBe(25544);
    expect(records[1]!.noradId).toBe(44713);
  });

  it('tolerates CRLF and trailing whitespace', () => {
    const records = parseTleText(VALID_TLE_TEXT.replace(/\n/g, '\r\n') + '\r\n\r\n');
    expect(records).toHaveLength(2);
    // Compare against the fixture itself rather than a hard-coded checksum
    // suffix: the point is that the trailing \r is gone, and an assertion that
    // has to be updated whenever a fixture is recomputed will silently rot.
    expect(records[0]!.line1).toBe(ISS_TLE.line1);
    expect(records[1]!.line2).toBe(STARLINK_TLE.line2);
  });

  it('skips malformed entries and recovers on the next valid one', () => {
    const records = parseTleText(MALFORMED_TLE_TEXT);
    const ids = records.map((r) => r.noradId);
    expect(ids).toContain(25544);
    expect(ids).toContain(44713);
    // Truncated and ID-mismatched entries must not appear.
    expect(ids).not.toContain(99999);
    expect(ids).not.toContain(11111);
    expect(ids).not.toContain(22222);
  });

  it('deduplicates repeated catalogue numbers', () => {
    const doubled = `${VALID_TLE_TEXT}\n${VALID_TLE_TEXT}`;
    expect(parseTleText(doubled)).toHaveLength(2);
  });

  it('returns nothing for empty or junk input', () => {
    expect(parseTleText('')).toHaveLength(0);
    expect(parseTleText('not a tle at all\njust text\nmore text')).toHaveLength(0);
  });

  it('falls back to a synthetic name when the name line is blank', () => {
    const records = parseTleText(`\n${STARLINK_TLE.line1}\n${STARLINK_TLE.line2}`);
    expect(records).toHaveLength(1);
    expect(records[0]!.name).toBe('NORAD 44713');
  });
});

describe('starlinkBlock', () => {
  it('groups by hundred', () => {
    expect(starlinkBlock('STARLINK-1007')).toBe('1000');
    expect(starlinkBlock('STARLINK-1099')).toBe('1000');
    expect(starlinkBlock('STARLINK-1100')).toBe('1100');
    expect(starlinkBlock('STARLINK-30123')).toBe('30100');
  });

  it('returns null for non-Starlink names', () => {
    expect(starlinkBlock('ISS (ZARYA)')).toBeNull();
    expect(starlinkBlock('')).toBeNull();
  });

  it('handles the bracketed Direct-to-Cell naming Celestrak actually uses', () => {
    expect(starlinkBlock(STARLINK_DTC_TLE.name)).toBe('11000');
  });
});

describe('isDirectToCell', () => {
  it('recognises Celestrak\'s bracketed [DTC] suffix', () => {
    expect(isDirectToCell('STARLINK-11095 [DTC]')).toBe(true);
    expect(isDirectToCell(STARLINK_DTC_TLE.name)).toBe(true);
  });

  it('does not flag ordinary broadband satellites', () => {
    expect(isDirectToCell(STARLINK_TLE.name)).toBe(false);
    expect(isDirectToCell('STARLINK-30123')).toBe(false);
    expect(isDirectToCell('ISS (ZARYA)')).toBe(false);
  });

  it('does not match DTC as a substring of a longer token', () => {
    expect(isDirectToCell('STARLINK-1 DTCX')).toBe(false);
  });
});

describe('multi-shell parsing', () => {
  /**
   * The constellation spans ~330 to 570 km across five inclinations. A document
   * mixing shells must come back intact. A parser that assumed one shell, or
   * a name format without brackets, would silently drop the DTC fleet.
   */
  it('parses broadband and Direct-to-Cell records from one document', () => {
    const doc = [
      STARLINK_TLE.name,
      STARLINK_TLE.line1,
      STARLINK_TLE.line2,
      STARLINK_DTC_TLE.name,
      STARLINK_DTC_TLE.line1,
      STARLINK_DTC_TLE.line2,
    ].join('\n');
    const records = parseTleText(doc);
    expect(records.map((r) => r.noradId)).toEqual([44713, 59720]);
    expect(records.filter((r) => isDirectToCell(r.name))).toHaveLength(1);
  });
});
