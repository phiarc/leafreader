export function tapZone(x, left, width) {
  if (!Number.isFinite(x) || !Number.isFinite(left) || !(width > 0)) return 'none';
  const ratio = (x - left) / width;
  if (ratio < 0 || ratio > 1) return 'none';
  if (ratio <= .3) return 'previous';
  if (ratio >= .7) return 'next';
  return 'center';
}
