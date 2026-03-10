import { open } from "fs/promises";
import { ELEMENT_INFO, type ElementName } from "./constants";

const filePath = "./data/fate08.mkv";
// const filePath = "./data/hellmode07.mkv";

async function main() {
  const backend = await createBackend(filePath, "local");
  const reader = await createBufferedReader(backend);
  const mkv = await openMatroska(reader);
  console.log(mkv);

  const tree = await mkv.tree();
  // const trackTree = tree.segment.branches?.find((v) => v.name === "TRACKS");
  // const tracks = trackTree?.branches?.map((b) => {
  //   const element = b.branches?.find((c) => c.name === "TRACK_UID");
  //   return element;
  // });
  //
  console.log(JSON.stringify(tree, null, 2));
}

type Backend = {
  fetchBytes: (
    offset: number,
    size?: number,
  ) => Promise<Uint8Array<ArrayBuffer>>;
};

const MAX_SLOTS = 64;

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

async function createBackend(
  filePath: string,
  source: "local" | "http",
): Promise<Backend> {
  if (source === "local") {
    const handle = await open(filePath, "r");

    async function fetchBytes(offset: number, size: number = CHUNK_SIZE) {
      const buf = new Uint8Array(size);
      await handle.read(buf, 0, size, offset);
      return buf;
    }

    return {
      fetchBytes,
    };
  }

  if (source === "http") {
    async function fetchBytes(offset: number, size: number = CHUNK_SIZE) {
      let fileSize = 1_441_987_969;
      let end = Math.min(offset + size - 1, fileSize - 1);
      let response = await fetch(filePath, {
        headers: {
          Range: `bytes=${offset}-${end}`,
        },
      });

      if (response.status !== 206) {
        throw new Error(
          `Status: ${response.status}; Message: ${response.text()}`,
        );
      }

      return new Uint8Array(await response.arrayBuffer());
    }

    return {
      fetchBytes,
    };
  }

  return {
    fetchBytes: () => new Promise(() => new Uint8Array(0)),
  };
}

type BufferedReader = {
  read: (from: number, size: number) => Uint8Array | Promise<Uint8Array>;
};

const CHUNK_SIZE = 256 * 1024;

async function createBufferedReader(backend: Backend): Promise<BufferedReader> {
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
      prefetched.put(
        chunkIndex + 1,
        backend.fetchBytes((chunkIndex + 1) * CHUNK_SIZE, CHUNK_SIZE),
      );
    }

    return chunk.slice(localOffset, localOffset + size);
  }

  function read(
    offset: number,
    size: number,
  ): Uint8Array | Promise<Uint8Array> {
    const chunkIndex = Math.floor(offset / CHUNK_SIZE);
    const localOffset = offset % CHUNK_SIZE;

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

type Element = {
  id: number;
  name: ElementName | (string & {});
  isMaster: boolean;
  size: number;
  dataStart: number;
  // end: number;
  branches?: Element[];
};

async function openMatroska(reader: BufferedReader) {
  async function parseElement(cursor: number): Promise<Element> {
    async function parseId() {
      let result = reader.read(cursor, 1);
      let firstByte = (
        result instanceof Uint8Array ? result : await result
      )[0]!;
      let width = 1;
      let mask = 0x80;
      while ((firstByte & mask) === 0) {
        width++;
        mask >>= 1;
      }
      result = reader.read(cursor, width);
      let bytes = result instanceof Uint8Array ? result : await result;
      let id = firstByte;
      for (let i = 1; i < width; i++) {
        id = id * 256 + bytes[i]!;
      }
      cursor += width;

      return id;
    }

    async function parseSize() {
      let result = reader.read(cursor, 1);
      let firstByte = (
        result instanceof Uint8Array ? result : await result
      )[0]!;
      let width = 1;
      let mask = 0x80;
      while ((firstByte & mask) === 0) {
        width++;
        mask >>= 1;
      }
      result = reader.read(cursor, width);
      let bytes = result instanceof Uint8Array ? result : await result;
      let size = firstByte & (mask - 1);
      for (let i = 1; i < width; i++) {
        size = size * 256 + bytes[i]!;
      }
      cursor += width;

      result = reader.read(cursor, width);
      bytes = result instanceof Uint8Array ? result : await result;
      if (bytes.toHex() === "ff") {
        return -1;
      }

      return size;
    }

    const id = await parseId();
    const size = await parseSize();

    const elementInfo = ELEMENT_INFO[id];
    const name = elementInfo?.name ?? `UNKNOWN(0x${id.toString(16)})`;
    const isMaster = elementInfo?.isMaster ?? false;
    let branches: Element[] = [];

    if (isMaster) {
      // Read element header.
      //
      // If size is known:
      //   for a master element, parse children until cursor reaches
      // dataStart + size.
      //
      // If size is unknown:
      //   reject unless schema says this element allows unknown
      // size.
      //
      // If unknown-size element is Segment:
      //   keep reading Segment children until EOF / stream end.
      //
      // If unknown-size element is Cluster:
      //   keep reading Cluster children until the next element
      // begins whose ID is in LEVEL_0_AND_1_ELEMENT_IDS.
      //   Stop before consuming that next element.
      //   That next element belongs after the current Cluster.
      //
      // Do not stop when a nested child begins.
      // A nested child is part of the current element.

      let offset = cursor;
      while (offset < cursor + size) {
        const child = await parseElement(offset);
        branches.push(child);
        offset = child.dataStart + child.size;
      }
    }

    return {
      id,
      name,
      isMaster,
      size,
      dataStart: cursor,
      branches,
    };
  }

  async function getTree() {
    const header = await parseElement(0);
    const segment = await parseElement(header.dataStart + header.size);
    return {
      header,
      segment,
    };
  }

  return {
    tree: getTree,
    audio: [],
    video: [],
    subtitles: [],
  };
}

void main();
