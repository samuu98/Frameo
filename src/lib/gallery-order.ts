/** Round-robin across galleries before pagination, preserving order within each gallery.
 * Multi-gallery videos go into the least populated matching bucket and appear once.
 */
export function alternateGalleries<T>(items: readonly T[], galleriesFor: (item: T) => readonly string[]): T[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const keys = [...new Set(galleriesFor(item))].sort();
    const key = keys.length
      ? keys.reduce((best, candidate) => (buckets.get(candidate)?.length ?? 0) < (buckets.get(best)?.length ?? 0) ? candidate : best)
      : "";
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }
  const result: T[] = [];
  const queues = [...buckets.values()];
  for (let index = 0; queues.length; index += 1) {
    for (let queue = 0; queue < queues.length;) {
      const bucket = queues[queue];
      if (index < bucket.length) { result.push(bucket[index]); queue += 1; }
      else queues.splice(queue, 1);
    }
  }
  return result;
}
