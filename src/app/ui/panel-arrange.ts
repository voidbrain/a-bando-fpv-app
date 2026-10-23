/**
 * Where panels opened together go: in rows, centred in the free part of the window (`area`), side by side, never on top
 * of each other. Pure.
 */
export function arrangeRows(sizes: readonly { w: number; h: number }[], area: { x: number; y: number; w: number; h: number }, gap = 12): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let i = 0, y = area.y;
  while (i < sizes.length) {
    // as many as fit in this row (at least one)
    let rowW = sizes[i]!.w, j = i + 1;
    while (j < sizes.length && rowW + gap + sizes[j]!.w <= area.w) rowW += gap + sizes[j++]!.w;
    let x = area.x + Math.max(0, (area.w - rowW) / 2), rowH = 0;
    for (let k = i; k < j; k++) {
      out.push({ x: Math.round(x), y: Math.round(Math.min(y, Math.max(area.y, area.y + area.h - sizes[k]!.h))) });
      x += sizes[k]!.w + gap;
      rowH = Math.max(rowH, sizes[k]!.h);
    }
    y += rowH + gap;
    i = j;
  }
  return out;
}
