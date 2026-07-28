/**
 * Test fixtures.
 *
 * These are hand-built element sets, not verbatim Celestrak downloads: the
 * epochs are pinned to 2024-001 so propagation assertions stay reproducible.
 * They still have to pass as real data (fixed column widths, valid mod-10
 * checksum) or the parser rejects them. Edit a line and you have to recompute
 * its last digit, or the tests quietly start exercising the reject branch.
 */

/** ISS (ZARYA), epoch 2024-01-01. Orbit: 51.64° / ~421 km / 92.9 min. */
export const ISS_TLE = {
  name: 'ISS (ZARYA)',
  noradId: 25544,
  line1: '1 25544U 98067A   24001.00000000  .00016717  00000-0  10270-3 0  9004',
  line2: '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49510402 25546',
};

/**
 * A Starlink v1.0 element set (STARLINK-1007, launched 2019-074A).
 * Orbit: 53.05° / ~548 km / 95.6 min, the original 550 km shell.
 *
 * Note this is one shell of several. The live constellation spans roughly
 * 43°, 53°, 53.2°, 70° and 97.6° inclinations, and altitudes from ~330 km
 * (Direct-to-Cell and the lowered broadband shells) up to ~570 km, so nothing
 * outside this file should assume "Starlink" means "53° at 550 km".
 */
export const STARLINK_TLE = {
  name: 'STARLINK-1007',
  noradId: 44713,
  line1: '1 44713U 19074A   24001.50000000  .00002182  00000-0  16465-3 0  9990',
  line2: '2 44713  53.0546 175.4381 0001367  91.2338 268.8819 15.06391320230193',
};

/**
 * A Direct-to-Cell element set in Celestrak's actual naming style
 * (`STARLINK-11095 [DTC]`). Orbit: 53.16° / ~355 km. The DTC shell sits well
 * below the broadband ones, which is why altitude must never be hard-coded.
 */
export const STARLINK_DTC_TLE = {
  name: 'STARLINK-11095 [DTC]',
  noradId: 59720,
  line1: '1 59720U 24048A   24001.50000000  .00012345  00000-0  55555-3 0  9996',
  line2: '2 59720  53.1600 120.0000 0001500  85.0000 275.0000 15.71000000 12340',
};

/** Junk input, for the parser-resilience tests. */
export const MALFORMED_TLE_TEXT = [
  'GOOD SAT',
  ISS_TLE.line1,
  ISS_TLE.line2,
  'TRUNCATED SAT',
  '1 99999U 20001A   24001.0000',
  '2 99999  53.0000',
  'MISMATCHED IDS',
  '1 11111U 20002A   24001.00000000  .00000000  00000-0  00000-0 0  9996',
  '2 22222  53.0000 000.0000 0000000 000.0000 000.0000 15.00000000000006',
  'SECOND GOOD SAT',
  STARLINK_TLE.line1,
  STARLINK_TLE.line2,
].join('\n');

export const VALID_TLE_TEXT = [
  ISS_TLE.name,
  ISS_TLE.line1,
  ISS_TLE.line2,
  STARLINK_TLE.name,
  STARLINK_TLE.line1,
  STARLINK_TLE.line2,
].join('\n');
