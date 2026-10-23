/**
 * One stacking order for the editor's float boxes and toolbars: whatever was opened or clicked last comes on top. Menus
 * and pickers live above all of it (z 9000), the toast above everything (z 100000).
 */
const BASE = 1200;
const LIMIT = 8000;
let top = BASE;
let last: object | null = null;

/** The z-index that puts `owner` on top (the same one again while it already is). */
export function raiseZ(owner: object): number {
  if (last === owner) return top;
  if (top >= LIMIT) top = BASE; // after thousands of clicks: start again (the order of older boxes may shuffle once)
  last = owner;
  return ++top;
}
