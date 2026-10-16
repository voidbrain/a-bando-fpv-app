/**
 * Real dimensions of the site (measured with Google Maps), in metres, and the values derived from them.
 * Local frame: X across the store (+X = east side), Z along it (+Z = south end, towards Via Leonardo da Vinci),
 * origin = centre of the store.
 */
const BW = 55; // store width
const BL = 151.76; // store length
const AL = 56; // annex ("house") length
const AW = 20; // annex width
const GL = 50; // greenhouse length
const EXN = 20; // part of the store's north end that stays exposed

const AX1 = BW / 2 - EXN;
const AX0 = AX1 - AL;
const AZ1 = -BL / 2;
const AZ0 = AZ1 - AW;
const GX1 = AX0;
const GX0 = GX1 - GL;

export const SITE_DIMS = {
  BW, BL, AL, AW, GL, EXN,
  BX0: -BW / 2, BX1: BW / 2, BZ0: -BL / 2, BZ1: BL / 2,
  AX0, AX1, AZ0, AZ1, AX: (AX0 + AX1) / 2, AZ: (AZ0 + AZ1) / 2,
  GX0, GX1,
  /** Eaves height of the store and annex walls, ridge rise of the vaults (estimated by proportion from photos). */
  EH: 5.7,
  AH: 6.5,
  /** Open field between greenhouse and store: kept free of trees. */
  CLEAR: { x0: -100, x1: -26, z0: -76, z1: 76 },
} as const;

export const isInClearing = (x: number, z: number): boolean => {
  const c = SITE_DIMS.CLEAR;
  return x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1;
};
