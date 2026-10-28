export async function restartTurnAnimation(
  active: { value: boolean }, flush: () => Promise<unknown>,
  isCurrent: () => boolean, measure: () => void
): Promise<boolean> {
  active.value = false;
  // Vue must remove the old class before layout is forced; otherwise it merges
  // false -> true into one update and the incoming page never restarts.
  await flush();
  if (!isCurrent()) return false;
  measure();
  active.value = true;
  return true;
}
