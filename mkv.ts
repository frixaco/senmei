import { open, type FileReadResult } from "fs/promises";
import { ELEMENT_ID } from "./constants";

const filePath = "./data/fate08.mkv";

async function main() {
  const reader = await createFileReader(filePath);
  const mkv = await openMatroska(reader);
  console.log(JSON.stringify(mkv, null, 2));

  // const video = mkv.tracks.videos[0]!;
  // const audio = mkv.tracks.audios[0]!;
  // const subtitle = mkv.tracks.subtitles[0]!;

  // const msTimestamp = 752_000;
  //
  // const videoStream = video.stream();
  // await videoStream.seek(msTimestamp);
  // const videoCurrent = await videoStream.frameData();
  // const videoUpcoming = await videoStream.readAheadNs(1_000_000_000);
  //
  // const audioStream = audio.stream();
  // await audioStream.seek(msTimestamp);
  // const audioCurrent = await audioStream.frameData();
  // const audioUpcoming = await audioStream.readAheadNs(1_000_000_000);
  //
  // const subtitleStream = subtitle.stream();
  // await subtitleStream.seek(msTimestamp);
  // const subtitleCurrent = await subtitleStream.frameData();
  // const subtitleUpcoming = await subtitleStream.readAheadNs(1_000_000_000);
  //
  // console.log({
  //   videoCurrent,
  //   videoUpcoming,
  //   audioCurrent,
  //   audioUpcoming,
  //   subtitleCurrent,
  //   subtitleUpcoming,
  // });
}

type Reader = {
  read: (from: number, size: number) => Promise<Buffer<ArrayBuffer>>;
};

async function createFileReader(filePath: string) {
  const handle = await open(filePath, "r");

  async function read(
    from: number,
    size: number,
  ): Promise<Buffer<ArrayBuffer>> {
    const buffer = Buffer.alloc(size);

    const result = await handle.read(buffer, 0, size, from);
    console.log(result);

    return result.buffer;
  }

  return {
    read,
  };
}

type Element = {
  id: number;
  isMaster: boolean;
  size: number;
  start: number;
};

async function openMatroska(reader: Reader) {
  // TODO: create a map of all IDs, offets, core information, track info (name, length)
  let cursor = 0;
  let id;
  let size;

  let nextPart: "id" | "size" | "data" = "id";
  if (nextPart === "id") {
    let firstByte = (await reader.read(cursor, 1))[0]!;

    let width = 1;
    let mask = 0x80; // 1000 0000

    while ((firstByte & mask) === 0) {
      width++;
      mask >>= 1;
    }

    let bytes = await reader.read(cursor, width);

    let value = firstByte;
    for (let i = 1; i < width; i++) {
      value = value * 256 + bytes[i]!;
    }

    id = value;
    nextPart = "size";
    cursor += width;
  }

  if (nextPart === "size") {
    let firstByte = (await reader.read(cursor, 1))[0]!;

    let width = 1;
    let mask = 0x80; // 1000 0000

    while ((firstByte & mask) === 0) {
      width++;
      mask >>= 1;
    }
    let bytes = await reader.read(cursor, width);

    let value = firstByte & (mask - 1);
    for (let i = 1; i < width; i++) {
      value = value * 256 + bytes[i]!;
    }

    size = value;
    nextPart = "size";
    cursor += width;
  }

  console.log("First element:", {
    id: id?.toString(16),
    size,
  });

  return {
    tracks: {
      videos: [],
      audios: [],
      subtitles: [],
    },
  };
}

void main();
