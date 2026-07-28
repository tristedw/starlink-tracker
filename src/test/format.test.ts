import { describe, expect, it } from 'vitest';
import {
  compassPoint,
  formatAzimuth,
  formatCountdown,
  formatDeg,
  formatDuration,
  formatKm,
  formatSpeed,
} from '../lib/format';

describe('compassPoint', () => {
  it.each([
    [0, 'N'],
    [45, 'NE'],
    [90, 'E'],
    [180, 'S'],
    [270, 'W'],
    [359, 'N'],
    [360, 'N'],
  ])('maps %i° to %s', (deg, expected) => {
    expect(compassPoint(deg)).toBe(expected);
  });

  it('handles negative and out-of-range bearings', () => {
    expect(compassPoint(-90)).toBe('W');
    expect(compassPoint(450)).toBe('E');
  });

  it('returns a dash for non-finite input', () => {
    expect(compassPoint(Number.NaN)).toBe('n/a');
  });
});

describe('formatAzimuth', () => {
  it('combines the compass point and the degrees', () => {
    expect(formatAzimuth(91.4)).toBe('E 91°');
  });
});

describe('formatDuration', () => {
  it.each([
    [5000, '5s'],
    [65_000, '1m 5s'],
    [3_900_000, '1h 5m'],
  ])('formats %ims', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it('treats negatives as zero', () => {
    expect(formatDuration(-1000)).toBe('0s');
  });
});

describe('formatCountdown', () => {
  it('says "now" for past instants', () => {
    expect(formatCountdown(1000, 5000)).toBe('now');
  });

  it('counts down to future instants', () => {
    expect(formatCountdown(65_000, 0)).toBe('1m 5s');
  });
});

describe('numeric formatters', () => {
  it('renders a dash rather than NaN', () => {
    expect(formatKm(Number.NaN)).toBe('n/a');
    expect(formatSpeed(Number.NaN)).toBe('n/a');
    expect(formatDeg(Number.NaN)).toBe('n/a');
  });

  it('respects the requested precision', () => {
    expect(formatSpeed(7.6612)).toBe('7.66 km/s');
    expect(formatDeg(23.456, 2)).toBe('23.46°');
  });
});
