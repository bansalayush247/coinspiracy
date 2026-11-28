import { describe, expect, it } from 'vitest';
import { BUILDING_DOORS, CITY_BUILDINGS, buildingName } from '../src/city/index.js';

describe('building names', () => {
  it('gives every building in the city its own name', () => {
    const names = CITY_BUILDINGS.map((b) => buildingName(b.seed));
    expect(names.every((n) => n.length > 0 && n.length <= 64)).toBe(true);
    expect(new Set(names).size).toBe(CITY_BUILDINGS.length);
  });

  it('names a building the same way every time', () => {
    for (const b of CITY_BUILDINGS) expect(buildingName(b.seed)).toBe(buildingName(b.seed));
  });

  it('gives houses a street address and the one-of-a-kind buildings their proper names', () => {
    for (const b of CITY_BUILDINGS.filter((x) => x.kind === 'house')) expect(buildingName(b.seed)).toMatch(/^\d{1,2} \S/);
    const named = (kind: string): string => buildingName(CITY_BUILDINGS.find((b) => b.kind === kind)?.seed ?? -1);
    expect(named('cityHall')).toBe('Port Concord City Hall');
    expect(named('mintHall')).toBe('The Mint Hall');
    expect(named('fishMarket')).toBe('Saltmarket Fish Hall');
    expect(named('temple')).toBe('Tidewater Temple');
    const mandir = (district: string): string => buildingName(CITY_BUILDINGS.find((b) => b.kind === 'mandir' && b.district === district)?.seed ?? -1);
    expect(mandir('signet')).toBe('Shri Ram Mandir');
    expect(mandir('shallows')).toBe('Shri Shiv Mandir');
  });

  it('has no name for a building that does not exist', () => {
    expect(buildingName(-12345)).toBe('');
  });

  it('names every door a guardian can walk through', () => {
    for (const d of BUILDING_DOORS) expect(buildingName(d.building.seed)).not.toBe('');
  });
});
