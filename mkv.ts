import { open } from "fs/promises";
import { ELEMENT_INFO, TRACK_TYPE, type ElementName } from "./constants";
import { parseBytesIntoFormat } from "./codec-parsers";

// const filePath = "./data/fate08.mkv";
const filePath =
  "https://rqbit.anitrack.frixaco.com/torrents/0/stream/0/[SubsPlease]%20Tensei%20Shitara%20Slime%20Datta%20Ken%20S4%20-%2013%20(1080p)%20[C3528385].mkv";

async function main() {
  const backend = await createBackend(filePath, "http");
  const reader = await createBufferedReader(backend);
  const matroska = await openMatroska(reader);

  const mkv = await matroska.init();
  console.log("codecid", mkv.videos[0]?.codecId);
}

type Backend = {
  fetchBytes: (offset: number, size?: number) => Promise<Uint8Array<ArrayBuffer>>;
};

const MAX_SLOTS = 64;
// TODO: for playback use 512
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
    const stats = await handle.stat();
    const fileSize = stats.size;

    async function fetchBytes(offset: number, size: number = CHUNK_SIZE) {
      if (offset >= fileSize) {
        return new Uint8Array(0);
      }
      const bytesToRead = Math.max(0, Math.min(size, fileSize - offset));

      const buf = new Uint8Array(bytesToRead);
      const { bytesRead } = await handle.read(buf, 0, bytesToRead, offset);
      return buf.slice(0, bytesRead);
    }

    return {
      fetchBytes,
    };
  }

  if (source === "http") {
    let fileSize = 0;

    const response = await fetch(filePath, {
      headers: {
        Range: `bytes=0-0`,
      },
    });
    if (response.status === 206 && response.headers.has("content-range")) {
      const endByte = response.headers.get("content-range")!.split("/")?.[1];
      if (endByte) {
        fileSize = Number(endByte);
      }
    }

    async function fetchBytes(offset: number, size: number = CHUNK_SIZE) {
      if (offset >= fileSize) {
        return new Uint8Array(0);
      }

      const start = offset;
      const end = offset + size - 1;
      // handle content-range final byte number
      const rangeEnd = Math.min(fileSize - 1, end);

      const response = await fetch(filePath, {
        headers: {
          Range: `bytes=${start}-${rangeEnd}`,
        },
      });

      if (response.status === 206) {
        return new Uint8Array(await response.arrayBuffer());
      }

      // we need to stream
      if (response.status === 200) {
        throw new Error("Can't stream");
      }

      // TODO: handle 416

      throw new Error("Unexpected");
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

// TODO: disable prefetching for .init()
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
  branches: Element[];
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

  async function parseNumberAt(offset: number, size: number) {
    let result = reader.read(offset, size);
    let bytes = result instanceof Uint8Array ? result : await result;
    let value = 0;
    for (const b of bytes) {
      value = value * 256 + b;
    }
    return value;
  }

  async function parseStringAt(offset: number, size: number) {
    let result = reader.read(offset, size);
    let bytes = result instanceof Uint8Array ? result : await result;
    const str = new TextDecoder("utf-8").decode(bytes);

    return str;
  }

  async function parseFloatAt(offset: number, size: number) {
    let result = reader.read(offset, size);
    let bytes = result instanceof Uint8Array ? result : await result;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (size === 4) {
      return view.getFloat32(0, false);
    }

    if (size === 8) {
      return view.getFloat64(0, false);
    }

    return null;
  }

  async function parseBytesAt(offset: number, size: number) {
    let result = reader.read(offset, size);
    let bytes = result instanceof Uint8Array ? result : await result;
    return bytes;
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

    // NOTE: generally SEGMENT is known size, so this branch is mostly useless
    if (elementInfo.unknownSizeAllowed && size === -1) {
      let offset = cursor;
      while (true) {
        if (elementInfo.name === "CLUSTER") {
          break;

          // NOTE: This **kinda** skips full CLUSTER tree check, I went with full break on CLUSTER as it is still slow (~30s)
          // const { id: nextId, width: idWidth } = await parseIdAt(offset);
          // if (LEVEL_0_AND_1_ELEMENT_IDS.includes(nextId)) {
          //   break;
          // }
          //
          // offset += idWidth;
          // const { size, width: sizeWidth } = await parseSizeAt(offset);
          // if (size === -1) {
          //   throw new Error("Size is -1 inside CLUSTER: not handled yet")
          // }
          // offset += sizeWidth + size;
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

      const seekHeadChildren = segment.branches.find((s) => s.name === "SEEK_HEAD")!.branches;

      let seekTargets = [];

      for (const el of seekHeadChildren) {
        const seekPositionElement = el.branches.find((b) => b.name === "SEEK_POSITION")!;
        const position = await parseNumberAt(
          seekPositionElement.dataStart,
          seekPositionElement.size,
        );

        seekTargets.push({
          seek: el,
          offset: segment.dataStart + position,
        });
      }

      // File-order seeks avoid jumping around, making chunk cache hits/prefetch more likely.
      seekTargets.sort((a, b) => a.offset - b.offset);

      for (const { seek: el, offset } of seekTargets) {
        const seekIdElement = el.branches[0]!;

        const { id } = await parseIdAt(seekIdElement!.dataStart);
        const elementInfo = ELEMENT_INFO[id]!;
        const name = elementInfo?.name ?? `UNKNOWN(0x${id.toString(16)})`;
        if (
          segment.branches.map((b) => b.name).includes(name) ||
          name === "ATTACHMENTS" ||
          name === "CLUSTER"
        ) {
          continue;
        }

        const element = await parseElement(offset);
        segment.branches.push(element);
      }

      let audios = [];
      let videos = [];
      let subtitles = [];
      let audioIndex = 0;
      let videoIndex = 0;
      let subtitleIndex = 0;

      const tracks = segment.branches.find((b) => b.name === "TRACKS")!.branches;

      for (const t of tracks) {
        const tte = t.branches.find((b) => b.name === "TRACK_TYPE")!;
        const trackType = await parseNumberAt(tte.dataStart, tte.size);
        const trackNumberElement = t.branches.find((b) => b.name === "TRACK_NUMBER");
        const trackUidElement = t.branches.find((b) => b.name === "TRACK_UID");
        const nameElement = t.branches.find((b) => b.name === "NAME");
        const languageBcp47Element = t.branches.find((b) => b.name === "LANGUAGE_BCP47");
        const languageElement = t.branches.find((b) => b.name === "LANGUAGE");
        const codecIdElement = t.branches.find((b) => b.name === "CODEC_ID");
        const codecPrivateElement = t.branches.find((b) => b.name === "CODEC_PRIVATE");
        const enabledElement = t.branches.find((b) => b.name === "FLAG_ENABLED");
        const defaultElement = t.branches.find((b) => b.name === "FLAG_DEFAULT");
        const forcedElement = t.branches.find((b) => b.name === "FLAG_FORCED");
        const name = nameElement
          ? await parseStringAt(nameElement.dataStart, nameElement.size)
          : null;
        const languageBcp47 = languageBcp47Element
          ? await parseStringAt(languageBcp47Element.dataStart, languageBcp47Element.size)
          : null;
        const language =
          languageBcp47 ??
          (languageElement
            ? await parseStringAt(languageElement.dataStart, languageElement.size)
            : null);
        const usefulLanguage = language && language !== "und" ? language : null;
        const trackNumber = trackNumberElement
          ? await parseNumberAt(trackNumberElement.dataStart, trackNumberElement.size)
          : 0;
        const trackUid = trackUidElement
          ? await parseNumberAt(trackUidElement.dataStart, trackUidElement.size)
          : null;
        const codecId = codecIdElement
          ? await parseStringAt(codecIdElement.dataStart, codecIdElement.size)
          : null;
        const codecPrivate = codecPrivateElement
          ? await parseBytesAt(codecPrivateElement.dataStart, codecPrivateElement.size)
          : null;
        const codecFormat = parseBytesIntoFormat(codecId, codecPrivate);
        const enabled = enabledElement
          ? (await parseNumberAt(enabledElement.dataStart, enabledElement.size)) !== 0
          : true;
        const isDefault = defaultElement
          ? (await parseNumberAt(defaultElement.dataStart, defaultElement.size)) !== 0
          : false;
        const forced = forcedElement
          ? (await parseNumberAt(forcedElement.dataStart, forcedElement.size)) !== 0
          : false;

        if (trackType === TRACK_TYPE.VIDEO) {
          videoIndex++;
          const video = t.branches.find((b) => b.name === "VIDEO");
          const pixelWidthElement = video?.branches.find((b) => b.name === "PIXEL_WIDTH");
          const pixelHeightElement = video?.branches.find((b) => b.name === "PIXEL_HEIGHT");
          const displayWidthElement = video?.branches.find((b) => b.name === "DISPLAY_WIDTH");
          const displayHeightElement = video?.branches.find((b) => b.name === "DISPLAY_HEIGHT");
          videos.push({
            entry: t,
            number: trackNumber,
            uid: trackUid,
            type: "video",
            label: name ?? usefulLanguage ?? `Video ${videoIndex}`,
            name,
            language,
            codecId,
            codecPrivate,
            codecFormat,
            enabled,
            default: isDefault,
            forced,
            pixelWidth: pixelWidthElement
              ? await parseNumberAt(pixelWidthElement.dataStart, pixelWidthElement.size)
              : null,
            pixelHeight: pixelHeightElement
              ? await parseNumberAt(pixelHeightElement.dataStart, pixelHeightElement.size)
              : null,
            displayWidth: displayWidthElement
              ? await parseNumberAt(displayWidthElement.dataStart, displayWidthElement.size)
              : null,
            displayHeight: displayHeightElement
              ? await parseNumberAt(displayHeightElement.dataStart, displayHeightElement.size)
              : null,
          });
        }

        if (trackType === TRACK_TYPE.AUDIO) {
          audioIndex++;
          const audio = t.branches.find((b) => b.name === "AUDIO");
          const channelsElement = audio?.branches.find((b) => b.name === "CHANNELS");
          const samplingFrequencyElement = audio?.branches.find(
            (b) => b.name === "SAMPLING_FREQUENCY",
          );
          const bitDepthElement = audio?.branches.find((b) => b.name === "BIT_DEPTH");
          audios.push({
            entry: t,
            number: trackNumber,
            uid: trackUid,
            type: "audio",
            label: name ?? usefulLanguage ?? `Audio ${audioIndex}`,
            name,
            language,
            codecId,
            codecPrivate,
            codecFormat,
            enabled,
            default: isDefault,
            forced,
            channels: channelsElement
              ? await parseNumberAt(channelsElement.dataStart, channelsElement.size)
              : null,
            samplingFrequency: samplingFrequencyElement
              ? await parseFloatAt(
                  samplingFrequencyElement.dataStart,
                  samplingFrequencyElement.size,
                )
              : null,
            bitDepth: bitDepthElement
              ? await parseNumberAt(bitDepthElement.dataStart, bitDepthElement.size)
              : null,
          });
        }

        if (trackType === TRACK_TYPE.SUBTITLE) {
          subtitleIndex++;
          subtitles.push({
            entry: t,
            number: trackNumber,
            uid: trackUid,
            type: "subtitle",
            label: name ?? usefulLanguage ?? `Subtitle ${subtitleIndex}`,
            name,
            language,
            codecId,
            codecPrivate,
            codecFormat,
            enabled,
            default: isDefault,
            forced,
          });
        }
      }

      return {
        tree: { header, segment },
        audios,
        videos,
        subtitles,
      };
    },
  };
}

void main();
