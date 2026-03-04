const filePath = "./data/fate08.mkv";

type TrackKind = "video" | "audio" | "subtitle";

interface Reader {
  readAt(offset: number, length: number): Promise<Uint8Array>;
}

interface TrackMetadata {
  id: number;
  kind: TrackKind;
  title: string;
}

interface TrackItemBase {
  trackId: number;
  kind: TrackKind;
  timestampMs: number;
  durationNs: number;
}

interface VideoFrameData extends TrackItemBase {
  kind: "video";
  data: Uint8Array;
  keyframe: boolean;
}

interface AudioFrameData extends TrackItemBase {
  kind: "audio";
  data: Uint8Array;
}

interface SubtitleCueData {
  trackId: number;
  kind: "subtitle";
  startMs: number;
  endMs: number;
  text: string;
}

type TrackItem = VideoFrameData | AudioFrameData | SubtitleCueData;

interface TrackStream {
  seekMs(ms: number): Promise<void>;
  current(): Promise<TrackItem>;
  readAheadNs(ns: number): Promise<TrackItem[]>;
}

interface Track extends TrackMetadata {
  stream(): TrackStream;
}

interface MatroskaFile {
  tracks: {
    videos: Track[];
    audios: Track[];
    subtitles: Track[];
  };
}

async function main() {
  const reader = createFileReader(filePath);
  const mkv = await openMatroska(reader);

  const video = mkv.tracks.videos[0]!;
  const audio = mkv.tracks.audios[0]!;
  const subtitle = mkv.tracks.subtitles[0]!;

  const msTimestamp = 752_000;

  const videoStream = video.stream();
  await videoStream.seekMs(msTimestamp);
  const videoCurrent = await videoStream.current();
  const videoUpcoming = await videoStream.readAheadNs(1_000_000_000);

  const audioStream = audio.stream();
  await audioStream.seekMs(msTimestamp);
  const audioCurrent = await audioStream.current();
  const audioUpcoming = await audioStream.readAheadNs(1_000_000_000);

  const subtitleStream = subtitle.stream();
  await subtitleStream.seekMs(msTimestamp);
  const subtitleCurrent = await subtitleStream.current();
  const subtitleUpcoming = await subtitleStream.readAheadNs(1_000_000_000);

  console.log({
    videoCurrent,
    videoUpcoming,
    audioCurrent,
    audioUpcoming,
    subtitleCurrent,
    subtitleUpcoming,
  });
}

function createFileReader(path: string): Reader {
  return {
    async readAt(offset: number, length: number) {
      void path;
      void offset;
      return new Uint8Array(length);
    },
  };
}

async function openMatroska(reader: Reader): Promise<MatroskaFile> {
  let cursor = 0;

  await reader.readAt(cursor, 16);
  cursor += 16;

  function createStream(track: TrackMetadata): TrackStream {
    let currentMs = 0;

    function createCurrentItem(durationNs: number): TrackItem {
      if (track.kind === "video") {
        return {
          trackId: track.id,
          kind: "video",
          timestampMs: currentMs,
          durationNs,
          data: new Uint8Array([0, 0, 1]),
          keyframe: true,
        };
      }

      if (track.kind === "audio") {
        return {
          trackId: track.id,
          kind: "audio",
          timestampMs: currentMs,
          durationNs,
          data: new Uint8Array([0xad, 0x00]),
        };
      }

      return {
        trackId: track.id,
        kind: "subtitle",
        startMs: currentMs,
        endMs: currentMs + durationNs / 1_000_000,
        text: "sample subtitle",
      };
    }

    return {
      async seekMs(ms: number) {
        currentMs = ms;
      },
      async current() {
        return createCurrentItem(16_666_667);
      },
      async readAheadNs(ns: number) {
        if (track.kind === "subtitle") {
          return [createCurrentItem(ns)];
        }

        const itemDurationNs = track.kind === "video" ? 16_666_667 : 23_219_955;
        const itemCount = Math.max(1, Math.ceil(ns / itemDurationNs));
        const items: TrackItem[] = [];

        for (let index = 0; index < itemCount; index += 1) {
          const nextMs = currentMs + (index * itemDurationNs) / 1_000_000;

          if (track.kind === "video") {
            items.push({
              trackId: track.id,
              kind: "video",
              timestampMs: nextMs,
              durationNs: itemDurationNs,
              data: new Uint8Array([0, 0, 1, index]),
              keyframe: index === 0,
            });
            continue;
          }

          items.push({
            trackId: track.id,
            kind: "audio",
            timestampMs: nextMs,
            durationNs: itemDurationNs,
            data: new Uint8Array([0xad, index]),
          });
        }

        return items;
      },
    };
  }

  function createTrack(track: TrackMetadata): Track {
    return {
      ...track,
      stream() {
        return createStream(track);
      },
    };
  }

  return {
    tracks: {
      videos: [
        createTrack({
          id: 1,
          kind: "video",
          title: "main",
        }),
      ],
      audios: [
        createTrack({
          id: 2,
          kind: "audio",
          title: "jp",
        }),
      ],
      subtitles: [
        createTrack({
          id: 3,
          kind: "subtitle",
          title: "en",
        }),
        createTrack({
          id: 4,
          kind: "subtitle",
          title: "jp",
        }),
      ],
    },
  };
}

void main();
