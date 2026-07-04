import { open } from "fs/promises";
import { ELEMENT_INFO, type ElementName } from "./constants";

// const filePath = "./data/fate08.mkv";
// const filePath = "./data/hellmode07.mkv";
// const filePath = "./data/unknown-size-segment-clusters.mkv";
const filePath =
  "https://rqbit.anitrack.frixaco.com/torrents/0/stream/0/[SubsPlease]%20Tensei%20Shitara%20Slime%20Datta%20Ken%20S4%20-%2013%20(1080p)%20[C3528385].mkv";

async function main() {
  const backend = await createBackend(filePath, "http");
  const reader = await createBufferedReader(backend);
  const mkv = await openMatroska(reader);
  // console.log(mkv);

  const tree = await mkv.init();
  console.log(JSON.stringify(tree, null, 2));
}

type Backend = {
  fetchBytes: (offset: number, size?: number) => Promise<Uint8Array<ArrayBuffer>>;
};

const MAX_SLOTS = 64;
const CHUNK_SIZE = 32 * 1024;

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

async function createBackend(filePath: string, source: "local" | "http"): Promise<Backend> {
  if (source === "local") {
    const handle = await open(filePath, "r");

    async function fetchBytes(offset: number, size: number = CHUNK_SIZE) {
      const buf = new Uint8Array(size);
      const { bytesRead } = await handle.read(buf, 0, size, offset);
      return buf.slice(0, bytesRead);
    }

    return {
      fetchBytes,
    };
  }

  if (source === "http") {
    async function fetchBytes(offset: number, size: number = CHUNK_SIZE) {
      const start = offset;
      const end = offset + size - 1;
      const response = await fetch(filePath, {
        headers: {
          Range: `bytes=${start}-${end}`,
        },
      });

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
      prefetched.put(chunkIndex + 1, backend.fetchBytes((chunkIndex + 1) * CHUNK_SIZE, CHUNK_SIZE));
    }

    return chunk.slice(localOffset, localOffset + size);
  }

  function read(offset: number, size: number): Uint8Array | Promise<Uint8Array> {
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
  end: number;
  branches?: Element[];
};

async function openMatroska(reader: BufferedReader) {
  async function parseIdAt(offset: number) {
    let result = reader.read(offset, 1);
    let firstByte = (result instanceof Uint8Array ? result : await result)[0];
    if (firstByte === undefined) {
      throw new Error("Unexpected EOF while reading element ID");
    }
    let width = 1;
    let mask = 0x80;
    while ((firstByte & mask) === 0) {
      width++;
      mask >>= 1;
      if (mask === 0) {
        throw new Error(`Invalid element ID at offset ${offset}`);
      }
    }
    result = reader.read(offset, width);
    let bytes = result instanceof Uint8Array ? result : await result;
    if (bytes.length < width) {
      throw new Error(`Truncated element ID at offset ${offset}`);
    }
    let id = firstByte;
    for (let i = 1; i < width; i++) {
      id = id * 256 + bytes[i]!;
    }

    return {
      id,
      width,
    };
  }

  async function parseSizeAt(offset: number) {
    let result = reader.read(offset, 1);
    let firstByte = (result instanceof Uint8Array ? result : await result)[0];
    if (firstByte === undefined) {
      throw new Error("Unexpected EOF while reading element size");
    }
    let width = 1;
    let mask = 0x80;
    while ((firstByte & mask) === 0) {
      width++;
      mask >>= 1;
      if (mask === 0) {
        throw new Error(`Invalid element size at offset ${offset}`);
      }
    }
    result = reader.read(offset, width);
    let bytes = result instanceof Uint8Array ? result : await result;
    if (bytes.length < width) {
      throw new Error(`Truncated element size at offset ${offset}`);
    }
    let size = firstByte & (mask - 1);
    for (let i = 1; i < width; i++) {
      size = size * 256 + bytes[i]!;
    }

    let firstByteAllOnes = (firstByte & (mask - 1)) === mask - 1;
    if (firstByteAllOnes && bytes.slice(1).every((b) => b === 0xff)) {
      return {
        width,
        size: -1,
      };
    }

    return {
      width,
      size,
    };
  }

  async function peekElementAt(offset: number) {
    const { id, width: idWidth } = await parseIdAt(offset);
    const { size, width: sizeWidth } = await parseSizeAt(offset + idWidth);
    const elementInfo = ELEMENT_INFO[id];
    const name = elementInfo?.name ?? `UNKNOWN(0x${id.toString(16)})`;
    const dataStart = offset + idWidth + sizeWidth;

    return {
      id,
      name,
      size,
      dataStart,
      end: size >= 0 ? dataStart + size : -1,
    };
  }

  async function parseElement(cursor: number): Promise<Element> {
    const { id, width } = await parseIdAt(cursor);
    cursor += width;

    const { size, width: sizeWidth } = await parseSizeAt(cursor);
    cursor += sizeWidth;

    const elementInfo = ELEMENT_INFO[id]!;
    const name = elementInfo?.name ?? `UNKNOWN(0x${id.toString(16)})`;
    const isMaster = elementInfo?.isMaster ?? false;
    let branches: Element[] = [];

    if (!isMaster) {
      return {
        id,
        name,
        isMaster,
        size,
        dataStart: cursor,
        branches,
        end: cursor + size,
      };
    }

    let end = 0;

    if (size >= 0) {
      let offset = cursor;
      while (offset < cursor + size) {
        if (name === "SEGMENT") {
          const childHeader = await peekElementAt(offset);

          if (childHeader.name === "CLUSTER") {
            break;
          }

          if (childHeader.name === "ATTACHMENTS") {
            offset = childHeader.end;
            continue;
          }
        }

        const child = await parseElement(offset);
        branches.push(child);
        offset = child.end;
      }
      end = offset;
    }

    if (!elementInfo.unknownSizeAllowed && size === -1) {
      throw new Error(`${elementInfo.name} is not allowed to have unknown size`);
    }

    if (elementInfo.unknownSizeAllowed && size === -1) {
      let offset = cursor;
      while (true) {
        if (elementInfo.name === "CLUSTER") {
          break;
        }
        if (elementInfo.name === "SEGMENT") {
          try {
            const child = await parseElement(offset);
            branches.push(child);
            offset = child.end;
          } catch {
            break;
          }
        }
      }
      end = offset;
    }

    return {
      id,
      name,
      isMaster,
      size,
      dataStart: cursor,
      branches,
      end,
    };
  }

  return {
    async init() {
      const header = await parseElement(0);
      const segment = await parseElement(header.dataStart + header.size);
      return {
        header,
        segment,
      };
    },
  };
}

void main();
