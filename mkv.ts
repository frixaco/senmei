import { ELEMENT_INFO, LEVEL_0_AND_1_ELEMENT_IDS, TRACK_TYPE, type ElementName } from "./constants";
import { parseBytesIntoFormat } from "./codec-parsers";
import { createBackend } from "./backend";
import { createBufferedReader, type BufferedReader } from "./buffered-reader";

export async function play(
  url: string,
  canvas: HTMLCanvasElement,
  ctx: GPUCanvasContext,
  device: GPUDevice,
) {
  const backend = await createBackend(url, "http");
  const reader = createBufferedReader(backend);
  const matroska = openMatroska(reader);

  const mkv = await matroska.init();

  await playVideoChunk(mkv, canvas, ctx, device);
}

async function playVideoChunk(
  mkv: any,
  canvas: HTMLCanvasElement,
  ctx: GPUCanvasContext,
  device: GPUDevice,
) {
  const decoder = new VideoDecoder({
    output(frame) {
      console.log("FRAME:", frame);

      if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
        canvas.width = frame.displayWidth;
        canvas.height = frame.displayHeight;
      }

      device.queue.copyExternalImageToTexture(
        { source: frame },
        { texture: ctx.getCurrentTexture() },
        {
          width: frame.displayWidth,
          height: frame.displayHeight,
        },
      );

      frame.close();
    },
    error(err) {
      throw err;
    },
  });

  const timestamp = 3;
  const chunk = await mkv.getVideoData(0, timestamp);

  decoder.configure({
    codec: chunk.codec,
    description: chunk.description,
  });

  decoder.decode(
    new EncodedVideoChunk({
      type: chunk.type, // as per spec
      data: chunk.data,
      timestamp: chunk.timestamp,
      duration: chunk.duration,
    }),
  );
}

export const MAX_SLOTS = 64;
// TODO: for playback use 512
export const CHUNK_SIZE = 32 * 1024;

type Element = {
  id: number;
  name: ElementName | (string & {});
  isMaster: boolean;
  size: number;
  dataStart: number;
  end: number;
  branches: Element[];
};

function openMatroska(reader: BufferedReader) {
  let firstClusterOffset = 0;

  async function parseElement(cursor: number): Promise<Element> {
    const { id, width, info, name } = await parseIdAt(cursor);
    cursor += width;

    const { size, width: sizeWidth } = await parseSizeAt(cursor);
    cursor += sizeWidth;

    const isMaster = info?.isMaster ?? false;
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
            firstClusterOffset = offset;
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

    if (!info.unknownSizeAllowed && size === -1) {
      throw new Error(`${info.name} is not allowed to have unknown size`);
    }

    // NOTE: generally SEGMENT is known size, so this branch is mostly useless
    if (info.unknownSizeAllowed && size === -1) {
      let offset = cursor;
      while (true) {
        if (info.name === "CLUSTER") {
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
        if (info.name === "SEGMENT") {
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

  async function parseClusterAt(offset: number) {
    const cluster = await peekElementAt(offset);
    if (cluster.name !== "CLUSTER") {
      throw new Error(`Expected Cluster at offset ${offset}, found ${cluster.name}`);
    }

    let cursor = cluster.dataStart;
    let timestamp: number | null = null;
    const blocks: Element[] = [];
    const knownEnd = cluster.size === -1 ? null : cluster.end;

    while (knownEnd === null || cursor < knownEnd) {
      // if (knownEnd === null && (await reader.read(cursor, 1)).length === 0) {
      //   break;
      // }

      const child = await peekElementAt(cursor);

      if (LEVEL_0_AND_1_ELEMENT_IDS.some((id) => id === child.id)) {
        if (knownEnd === null) {
          break;
        }
        throw new Error(`${child.name} cannot be nested inside a known-sized Cluster`);
      }

      if (child.size === -1) {
        throw new Error(`${child.name} inside Cluster has unknown size`);
      }

      if (knownEnd !== null && child.end > knownEnd) {
        throw new Error(`${child.name} extends past the end of its Cluster`);
      }

      if (child.name === "TIMESTAMP") {
        if (timestamp !== null) {
          throw new Error("Cluster contains more than one Timestamp");
        }
        timestamp = await parseNumberAt(child.dataStart, child.size);
      }

      if (child.name === "SIMPLE_BLOCK" || child.name === "BLOCK_GROUP") {
        blocks.push(await parseElement(cursor));
      }

      cursor = child.end;
    }

    if (knownEnd !== null && cursor !== knownEnd) {
      throw new Error("Cluster children do not end at the Cluster boundary");
    }

    if (timestamp === null) {
      throw new Error("Cluster does not contain a Timestamp");
    }

    return { timestamp, blocks, end: cursor };
  }

  async function parseIdAt(offset: number) {
    const firstByte = (await reader.read(offset, 1))[0];
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
    const bytes = await reader.read(offset, width);
    if (bytes.length < width) {
      throw new Error(`Truncated element ID at offset ${offset}`);
    }
    let id = firstByte;
    for (let i = 1; i < width; i++) {
      id = id * 256 + bytes[i]!;
    }
    const info = ELEMENT_INFO[id]!;
    const name = info?.name ?? `UNKNOWN(0x${id.toString(16)})`;

    return {
      id,
      width,
      info,
      name,
    };
  }

  async function parseSizeAt(offset: number) {
    const firstByte = (await reader.read(offset, 1))[0];
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
    const bytes = await reader.read(offset, width);
    if (bytes.length < width) {
      throw new Error(`Truncated element size at offset ${offset}`);
    }
    let size = firstByte & (mask - 1);
    for (let i = 1; i < width; i++) {
      size = size * 256 + bytes[i]!;
    }

    // Applies to only EBML element sizes, not TrackNumber VINT, but should be safe to re-use
    const firstByteAllOnes = (firstByte & (mask - 1)) === mask - 1;
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
    const { id, width: idWidth, name } = await parseIdAt(offset);
    const { size, width: sizeWidth } = await parseSizeAt(offset + idWidth);
    const dataStart = offset + idWidth + sizeWidth;

    return {
      id,
      name,
      size,
      dataStart,
      end: size >= 0 ? dataStart + size : -1,
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

        const { name } = await parseIdAt(seekIdElement.dataStart);
        if (
          segment.branches.some((branch) => branch.name === name) ||
          name === "ATTACHMENTS" ||
          name === "CLUSTER"
        ) {
          continue;
        }

        const element = await parseElement(offset);
        segment.branches.push(element);
      }

      const audios = [];
      const videos = [];
      const subtitles = [];

      const tracks = segment.branches.find((b) => b.name === "TRACKS")!.branches;

      for (const t of tracks) {
        const track = await parseTrack(t);

        switch (track.type) {
          case "video":
            videos.push(track);
            break;
          case "audio":
            audios.push(track);
            break;
          case "subtitle":
            subtitles.push(track);
            break;
        }
      }

      async function parseTrack(t: Element) {
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
          if (codecFormat.kind !== "video") {
            throw new Error(`Unsupported video codec: ${codecId ?? "unknown"}`);
          }

          const video = t.branches.find((b) => b.name === "VIDEO");
          const pixelWidthElement = video?.branches.find((b) => b.name === "PIXEL_WIDTH");
          const pixelHeightElement = video?.branches.find((b) => b.name === "PIXEL_HEIGHT");
          const displayWidthElement = video?.branches.find((b) => b.name === "DISPLAY_WIDTH");
          const displayHeightElement = video?.branches.find((b) => b.name === "DISPLAY_HEIGHT");
          return {
            entry: t,
            number: trackNumber,
            uid: trackUid,
            type: "video" as const,
            label: name ?? usefulLanguage ?? `Video ${videos.length + 1}`,
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
          };
        }

        if (trackType === TRACK_TYPE.AUDIO) {
          if (codecFormat.kind !== "audio") {
            throw new Error(`Unsupported audio codec: ${codecId ?? "unknown"}`);
          }

          const audio = t.branches.find((b) => b.name === "AUDIO");
          const channelsElement = audio?.branches.find((b) => b.name === "CHANNELS");
          const samplingFrequencyElement = audio?.branches.find(
            (b) => b.name === "SAMPLING_FREQUENCY",
          );
          const bitDepthElement = audio?.branches.find((b) => b.name === "BIT_DEPTH");
          return {
            entry: t,
            number: trackNumber,
            uid: trackUid,
            type: "audio" as const,
            label: name ?? usefulLanguage ?? `Audio ${audios.length + 1}`,
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
          };
        }

        if (trackType === TRACK_TYPE.SUBTITLE) {
          if (codecFormat.kind !== "subtitle") {
            throw new Error(`Unsupported subtitle codec: ${codecId ?? "unknown"}`);
          }

          return {
            entry: t,
            number: trackNumber,
            uid: trackUid,
            type: "subtitle" as const,
            label: name ?? usefulLanguage ?? `Subtitle ${subtitles.length + 1}`,
            name,
            language,
            codecId,
            codecPrivate,
            codecFormat,
            enabled,
            default: isDefault,
            forced,
          };
        }

        return {
          entry: t,
          type: "unsupported" as const,
        };
      }

      return {
        tree: { header, segment },
        audios,
        videos,
        subtitles,
        async getVideoData(
          index: number,
          timestampSec: number = 0,
        ): Promise<{
          codec: string;
          description?: Uint8Array<ArrayBufferLike>;
          type: "key" | "delta";
          data: Uint8Array<ArrayBufferLike>;
          timestamp: number;
          duration?: number;
        }> {
          const track = this.videos[index]!;

          const timestampScaleElement = segment.branches
            .find((b) => b.name === "INFO")
            ?.branches.find((b) => b.name === "TIMESTAMP_SCALE");
          const timestampeScale = timestampScaleElement
            ? await parseNumberAt(timestampScaleElement.dataStart, timestampScaleElement.size)
            : 1_000_000;

          const targetTimestamp = (timestampSec * 1_000_000_000) / timestampeScale;
          let targetCluster: null | {
            timestamp: number;
            blocks: Element[];
            end: number;
          } = null;

          let notFound = true;
          let cursor = firstClusterOffset;
          while (notFound) {
            targetCluster = await parseClusterAt(cursor);
            const nextCluster = await parseClusterAt(targetCluster.end);
            if (
              targetCluster.timestamp <= targetTimestamp &&
              targetTimestamp < nextCluster.timestamp
            ) {
              notFound = false;
            }

            cursor = targetCluster.end;
          }

          async function parseBlock(b: Element) {
            const { width, size: trackNumber } = await parseSizeAt(b.dataStart);

            const unsigned = await parseNumberAt(b.dataStart + width, 2);
            const relativeTimestamp = unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned;
            const flagsOffset = b.dataStart + width + 2;
            const flagsByte = await parseNumberAt(flagsOffset, 1);
            const lacing = (flagsByte & 0x06) >> 1;

            if (lacing !== 0) return null;

            return {
              trackNumber,
              relativeTimestamp,
              flags: {
                keyframe: (flagsByte & 0x80) !== 0,
                invisible: (flagsByte & 0x08) !== 0,
                lacing,
                discardable: (flagsByte & 0x01) !== 0,
              },
              lacingMetadata: {},
              dataRange: [flagsOffset + 1, b.end] as const,
            };
          }

          // starting from first cluster using firstClusterOffset
          // find the cluster with timestampSec * 1b / scale
          // find Blocks in blockgroups or SimpleBlock with track number
          // if block has refblock - go to that simple/block
          // no refblock - key
          // first few bytes - tracknumber
          // 2 bytes - reltmsp (cluster tmsp + rel tmsp, * scale)
          // 1 byte - flags, if bits 2-1 00 - next bytes are video bytes
          // optional variable size lacing metadata
          // frame data

          for (const b of targetCluster!.blocks) {
            const block =
              b.name === "BLOCK_GROUP" ? b.branches.find((element) => element.name === "BLOCK") : b;
            if (!block) throw new Error("BlockGroup does not contain a Block");

            const parsed = await parseBlock(block);
            if (!parsed) continue;

            if (b.name === "BLOCK_GROUP") {
              parsed.flags.keyframe = !b.branches.some(
                (element) => element.name === "REFERENCE_BLOCK",
              );
              parsed.flags.discardable = false;
            }

            const { trackNumber, relativeTimestamp, flags, dataRange } = parsed;
            if (trackNumber !== track.number) continue;

            return {
              codec: track.codecFormat.codec,
              description: track.codecPrivate ?? undefined,
              type: flags.keyframe ? "key" : "delta",
              data: await reader.read(dataRange[0], dataRange[1] - dataRange[0]),
              timestamp: ((targetCluster!.timestamp + relativeTimestamp) * timestampeScale) / 1_000,
            };
          }

          throw new Error("Target Cluster does not contain an unlaced video Block");
        },
      };
    },
  };

  async function parseNumberAt(offset: number, size: number) {
    const bytes = await reader.read(offset, size);
    let value = 0;
    for (const b of bytes) {
      value = value * 256 + b;
    }
    return value;
  }

  async function parseStringAt(offset: number, size: number) {
    const bytes = await reader.read(offset, size);
    const str = new TextDecoder("utf-8").decode(bytes);

    return str;
  }

  async function parseFloatAt(offset: number, size: number) {
    const bytes = await reader.read(offset, size);
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
    return await reader.read(offset, size);
  }
}
