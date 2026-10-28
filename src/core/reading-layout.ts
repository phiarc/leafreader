export const MAX_PAGE_MARGIN = 35;
export function pageMarginValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.min(MAX_PAGE_MARGIN, Math.max(0, number)) * 10) / 10 : 0;
}
