import type { Backend } from "./backend";
import { CHUNK_SIZE, MAX_SLOTS } from "./mkv";

class LRU<K = number, T = Uint8Array<ArrayBuffer>> {
  map = new Map<K, T>();

  get(chunkIndex: K) {
    if (this.map.has(chunkIndex)) {
      const value = this.map.get(chunkIndex)!;
      this.map.delete(chunkIndex);
      this.map.set(chunkIndex, value);
      return value;
    }
    return null;
  }

  put(chunkIndex: K, data: T) {
    if (this.map.size >= MAX_SLOTS) {
      const oldest = this.map.keys().next().value!;
      this.map.delete(oldest);
    }

    this.map.set(chunkIndex, data);
  }
}

export type BufferedReader = {
  read: (from: number, size: number) => Uint8Array | Promise<Uint8Array>;
};

// TODO: disable prefetching for .init()
export function createBufferedReader(backend: Backend): BufferedReader {
  const cache = new LRU();
  const prefetched = new LRU<number, Promise<Uint8Array<ArrayBuffer>>>();

  async function fetchAndCache(
    chunkIndex: number,
    localOffset: number,
    size: number,
  ): Promise<Uint8Array> {
    let chunk: Uint8Array<ArrayBuffer>;
    const pending = prefetched.get(chunkIndex);
    if (pending) {
      chunk = await pending;
      prefetched.map.delete(chunkIndex);
    } else {
      chunk = await backend.fetchBytes(chunkIndex * CHUNK_SIZE, CHUNK_SIZE);
    }
    cache.put(chunkIndex, chunk);

    if (!cache.get(chunkIndex + 1) && !prefetched.get(chunkIndex + 1)) {
      prefetched.put(chunkIndex + 1, backend.fetchBytes((chunkIndex + 1) * CHUNK_SIZE, CHUNK_SIZE));
    }

    return chunk.slice(localOffset, localOffset + size);
  }

  async function read(offset: number, size: number): Promise<Uint8Array> {
    const chunkIndex = Math.floor(offset / CHUNK_SIZE);
    const localOffset = offset % CHUNK_SIZE;

    if (localOffset + size > CHUNK_SIZE) {
      const chunks: Uint8Array[] = [];
      const initialPartialChunkBytes = CHUNK_SIZE - localOffset;
      const wholeChunkCount = Math.floor((size - initialPartialChunkBytes) / CHUNK_SIZE);
      const lastPartialOffset = (offset + size) % CHUNK_SIZE;

      chunks.push(
        cache.get(chunkIndex)?.slice(localOffset) ??
          (await fetchAndCache(chunkIndex, localOffset, initialPartialChunkBytes)),
      );

      for (let i = 1; i <= wholeChunkCount; i++) {
        chunks.push(
          cache.get(chunkIndex + i) ?? (await fetchAndCache(chunkIndex + i, 0, CHUNK_SIZE)),
        );
      }

      if (lastPartialOffset > 0) {
        const lastChunkIndex = chunkIndex + wholeChunkCount + 1;
        chunks.push(
          cache.get(lastChunkIndex)?.slice(0, lastPartialOffset) ??
            (await fetchAndCache(lastChunkIndex, 0, lastPartialOffset)),
        );
      }

      const result = new Uint8Array(size);
      let resultOffset = 0;
      for (const chunk of chunks) {
        result.set(chunk, resultOffset);
        resultOffset += chunk.length;
      }
      return result;
    }

    const chunk = cache.get(chunkIndex);
    if (chunk !== null) {
      return chunk.slice(localOffset, localOffset + size);
    }

    return fetchAndCache(chunkIndex, localOffset, size);
  }

  return {
    read,
  };
}
