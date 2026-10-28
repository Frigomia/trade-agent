// A small in-memory cache of the logos the route has already fetched and size-checked, shared by
// everyone on this server instance. It holds only accepted, bounded bytes (or a remembered miss), so
// it can sit in front of Logo.dev without Next's fetch cache, which reads whole upstream bodies.
// Best effort by design: a restart or another instance simply asks Logo.dev again.
const HIT_MS = 24 * 60 * 60 * 1000;
const MISS_MS = 60 * 60 * 1000;
const BUDGET_BYTES = 20_000_000;
// A remembered miss has no bytes, but it is still an entry: counting it keeps the map bounded.
const MISS_WEIGHT = 256;

export interface CachedLogo {
  /** null: Logo.dev has no logo for this ticker. */
  image: { type: string; bytes: Uint8Array<ArrayBuffer> } | null;
  until: number;
}

const store = new Map<string, CachedLogo>();
let total = 0;

const size = (entry: CachedLogo) => entry.image?.bytes.byteLength ?? MISS_WEIGHT;

function drop(key: string) {
  const entry = store.get(key);
  if (!entry) return;
  total -= size(entry);
  store.delete(key);
}

export function getLogo(key: string, now = Date.now()): CachedLogo | undefined {
  const entry = store.get(key);
  if (entry && entry.until <= now) {
    drop(key);
    return undefined;
  }
  return entry;
}

/** Remembers a logo for a day, or `null` (no logo) for an hour; the oldest entries go first when full. */
export function putLogo(key: string, image: CachedLogo["image"], now = Date.now()): void {
  drop(key);
  const entry = { image, until: now + (image ? HIT_MS : MISS_MS) };
  if (size(entry) > BUDGET_BYTES) return;
  store.set(key, entry);
  total += size(entry);
  for (const oldest of store.keys()) {
    if (total <= BUDGET_BYTES) break;
    drop(oldest);
  }
}

export function clearLogos(): void {
  store.clear();
  total = 0;
}
