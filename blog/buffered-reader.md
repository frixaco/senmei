# Designing a Buffered Reader for MKV Parsing

For local files, network streams, and GB-scale files.

---

## 1. Why the Naive Approach Breaks

Your current reader does one `handle.read()` per call. Each call is a syscall
(~1-10μs). Parsing one element needs 4+ reads, and a file has thousands of
elements. That's slow locally, but it **works**.

Over a network, each read becomes an HTTP request (~10-100ms). Those same 4
reads per element now take 400ms per element. The parser becomes unusable.

And with GB files, a single sequential buffer gets invalidated the moment a
video player seeks to a different timestamp. You refetch data you already had.

We need a reader that handles all three: local, network, and seeking.

---

## 2. The Core Idea: Chunk-Aligned Cache

Instead of a sliding window that starts at whatever offset you request, **divide
the entire file into a fixed grid of chunks** and cache them independently.

```
File (2 GB):
[chunk 0][chunk 1][chunk 2][chunk 3]...[chunk 8191]
 256KB    256KB    256KB    256KB        256KB

Cache (LRU, 16 slots = 4MB):
┌──────────────────────────────┐
│ slot 0: chunk 5    (hot)     │
│ slot 1: chunk 6    (hot)     │
│ slot 2: chunk 1402 (warm)    │  ← from a recent seek
│ slot 3: chunk 3    (cold)    │  ← will be evicted next
│ ...                          │
│ slot 15: chunk 7   (hot)     │
└──────────────────────────────┘
```

### Why chunk-aligned instead of a sliding window?

A sliding window refills starting at the exact requested offset. This means:

- Two reads 1 byte apart could trigger two completely different fetches
- Seeking backward re-fetches data you just had
- There's no reuse across nearby reads

Chunk-aligned caching fixes all of this:

- Every offset maps to exactly one chunk: `chunkIndex = floor(offset / CHUNK_SIZE)`
- Two reads in the same 256KB region always hit the same cached chunk
- Seeking back to a recently visited region often finds the chunk still cached
- The cache slots are independent — fetching one chunk doesn't evict another

### How a read works

```
read(offset, size):
  chunkIndex = floor(offset / CHUNK_SIZE)
  localOffset = offset % CHUNK_SIZE        // where inside the chunk

  1. Is chunk `chunkIndex` in the LRU cache?
     → Yes (cache hit): read from cached bytes. No I/O.
     → No (cache miss): fetch chunk from backend, store in cache,
       evict least-recently-used chunk if cache is full.

  2. Copy `size` bytes starting at `localOffset` from the cached chunk.

  3. (Edge case) If the read spans two chunks (localOffset + size > CHUNK_SIZE),
     also fetch chunkIndex+1 and stitch the bytes together.
     This is rare — most reads are 1-8 bytes.

  4. Trigger prefetch for chunkIndex+1 (explained below).

  return bytes
```

---

## 3. LRU Eviction: Staying Under a Memory Budget

You can't cache a 2GB file in memory. You pick a budget — say 16 slots × 256KB
= **4MB** — and evict the least recently used chunk when you need space.

**Why LRU works for MKV parsing:**

MKV has two access patterns:

1. **Sequential parsing** (reading element headers, metadata):
   You march forward through the file. Chunks are accessed in order.
   LRU keeps the recent chunks hot. Old chunks you'll never revisit get
   evicted first. Perfect.

2. **Seeking** (user jumps to 00:45:00 in the video):
   You jump to a distant file offset. The chunks near the new position get
   fetched and cached. The old playback-position chunks get evicted gradually.
   If the user seeks back, recently visited chunks might still be cached.

LRU naturally handles both patterns without any special-case logic.

### Implementation

An LRU cache is a **Map** (hash map) + **access-order tracking**. In JS, the
built-in `Map` iterates in insertion order, so you can use a trick:

```
get(chunkIndex):
  if map.has(chunkIndex):
    value = map.get(chunkIndex)
    map.delete(chunkIndex)     // remove from current position
    map.set(chunkIndex, value) // re-insert at end (= most recent)
    return value
  return null                  // cache miss

put(chunkIndex, data):
  if map.size >= MAX_SLOTS:
    oldest = map.keys().next().value  // first key = least recent
    map.delete(oldest)
  map.set(chunkIndex, data)
```

Every `get` moves the entry to the "end" of the map. The "beginning" is always
the oldest. Eviction deletes from the beginning. O(1) everything.

---

## 4. Prefetching: Hiding Latency

Caching helps with **repeat** reads. Prefetching helps with **first** reads.

The idea: when you access chunk N, **start fetching chunk N+1 in the
background** before anyone asks for it. By the time the parser finishes
processing chunk N's data and moves to N+1, the fetch is already done.

```
         time →

Without prefetch:
  [parse chunk 5]----[WAIT fetch 6]----[parse chunk 6]----[WAIT fetch 7]

With prefetch:
  [parse chunk 5]----[parse chunk 6]----[parse chunk 7]
       ↑                   ↑                   ↑
  fetch 6 starts      fetch 7 starts      fetch 8 starts
  in background       in background       in background
```

For sequential parsing, prefetching makes network latency nearly invisible.
The parser never waits because the next chunk is always ready.

### Implementation

```
prefetching: Map<chunkIndex, Promise>   // in-flight fetches

after every cache miss for chunk N:
  if chunk N+1 is NOT in cache and NOT in prefetching:
    prefetching.set(N+1, backend.fetchChunk(N+1))

when fetching chunk N:
  if prefetching.has(N):
    data = await prefetching.get(N)   // await the in-flight fetch
    prefetching.delete(N)
    cache.put(N, data)
    return data
  else:
    data = await backend.fetchChunk(N) // cold fetch
    cache.put(N, data)
    return data
```

Key subtlety: the prefetch is a **Promise stored in a Map**. When you later
need that chunk, you `await` the existing promise instead of starting a new
fetch. If it already resolved, the await returns immediately.

### When NOT to prefetch

After a **seek**, the next sequential chunk isn't necessarily useful — the user
might seek again immediately. You could add a heuristic: only prefetch after
2+ sequential chunk accesses. But for a first pass, always prefetching is fine —
the wasted fetch is just one 256KB read.

---

## 5. Abstract I/O Backend

The reader shouldn't know whether data comes from a local file or the network.
Define a backend interface:

```
Backend:
  fetchBytes(offset: number, size: number) → Promise<Uint8Array>
  fileSize() → Promise<number>   // may be unknown for live streams
```

Two implementations:

### Local file backend

```
fetchBytes(offset, size):
  buf = new Uint8Array(size)
  handle.read(buf, 0, size, offset)  // one syscall for the whole chunk
  return buf
```

### HTTP Range backend

```
fetchBytes(offset, size):
  end = min(offset + size - 1, fileSize - 1)
  response = fetch(url, {
    headers: { "Range": `bytes=${offset}-${end}` }
  })
  // Server responds with 206 Partial Content
  return new Uint8Array(await response.arrayBuffer())
```

HTTP Range requests tell the server "give me bytes 1048576 through 1310719."
Most CDNs and static file servers support this. It's how browsers do video
seeking — they don't download the whole file, they request byte ranges.

The **reader layer** (chunk cache + prefetch) sits on top of either backend.
It calls `backend.fetchBytes(chunkIndex * CHUNK_SIZE, CHUNK_SIZE)` and doesn't
care how the bytes arrive.

```
┌──────────────────────────────────┐
│         parseElement()           │  ← your parser
├──────────────────────────────────┤
│     reader.read(offset, size)    │  ← simple interface
├──────────────────────────────────┤
│  Chunk Cache (LRU) + Prefetch    │  ← this doc
├──────────────────────────────────┤
│  Backend: local file  |  HTTP    │  ← swappable
└──────────────────────────────────┘
```

---

## 6. Choosing Parameters

### Chunk size

| Size  | Sequential parsing     | Seeking                            | Network             |
| ----- | ---------------------- | ---------------------------------- | ------------------- |
| 64KB  | Good, frequent refills | Wastes little on overshoot         | Many small requests |
| 256KB | Great, rare refills    | Acceptable overshoot               | Good request size   |
| 1MB   | Overkill for headers   | Wasteful — fetches 1MB to read 20B | Fewer requests      |

**256KB** is the sweet spot. Large enough to amortize I/O overhead, small enough
that seeking doesn't waste much bandwidth. Matches common HTTP CDN chunk sizes
and OS readahead windows.

### Cache slots

| Slots | Memory | Use case                                  |
| ----- | ------ | ----------------------------------------- |
| 4     | 1MB    | Minimal. Fine for metadata-only parsing.  |
| 16    | 4MB    | Comfortable. Handles seeks + sequential.  |
| 64    | 16MB   | Generous. Keeps more history after seeks. |

**16 slots (4MB)** for a parser. If building a full player with subtitle tracks
and seeking, bump to 32-64.

---

## 7. Putting It Together: What to Build

```
1. Backend interface
   - LocalFileBackend (wraps fs handle)
   - HttpBackend (wraps fetch + Range headers)
   Both implement: fetchBytes(offset, size) → Promise<Uint8Array>

2. ChunkCache
   - LRU map: chunkIndex → Uint8Array
   - Max slots configurable (default 16)
   - get(index), put(index, data), evicts oldest on overflow

3. BufferedReader
   - Holds a Backend + ChunkCache + prefetch map
   - read(offset, size) → Promise<Uint8Array>
     - compute chunkIndex, check cache, fetch on miss
     - trigger prefetch for next chunk
   - This is the only thing parseElement sees
```

Your `parseElement` code doesn't change at all. You replace `createFileReader`
with a `BufferedReader` that takes a backend, and everything else stays the same.

---

## 8. Quick Wins vs Full Implementation

If you want something working in 30 minutes:

**Phase 1**: Just the chunk cache with local file backend. No prefetch, no HTTP.
This alone will take your parse time from seconds to milliseconds. The LRU cache
with 16 slots is ~40 lines of code.

**Phase 2**: Add prefetching. Another ~15 lines. Makes network viable.

**Phase 3**: Add HTTP backend. Another ~20 lines. Now it works in the browser
with remote files.
