export function parseBytesIntoFormat(
  codecId: string | null,
  codecPrivate: Uint8Array<ArrayBufferLike> | null,
): ParsedCodecFormat {
  if (codecPrivate === null) {
    switch (codecId) {
      case "V_MPEG4/ISO/AVC":
      case "V_MPEGH/ISO/HEVC":
      case "A_AAC":
      case "S_TEXT/ASS":
        throw new Error(`Missing CodecPrivate for ${codecId}`);
      default:
        return { kind: "unsupported", codecId };
    }
  }

  switch (codecId) {
    case "V_MPEG4/ISO/AVC":
      return parseAvcCodecPrivate(codecPrivate);
    case "V_MPEGH/ISO/HEVC":
      return parseHevcCodecPrivate(codecPrivate);
    case "A_AAC":
      return parseAacCodecPrivate(codecPrivate);
    case "S_TEXT/ASS":
      return parseAssCodecPrivate(codecPrivate);
    default:
      return { kind: "unsupported", codecId };
  }
}

type ParsedCodecFormat =
  | {
      kind: "video";
      format: "avc";
      codec: string;
      description: Uint8Array<ArrayBufferLike>;
      nalLengthSize: number;
    }
  | {
      kind: "video";
      format: "hevc";
      codec: string;
      description: Uint8Array<ArrayBufferLike>;
      nalLengthSize: number;
    }
  | {
      kind: "audio";
      format: "aac";
      codec: string;
      description: Uint8Array<ArrayBufferLike>;
      sampleRate: number;
      numberOfChannels: number;
      framesPerPacket: 1024 | 960;
    }
  | {
      kind: "subtitle";
      format: "ass";
      header: string;
    }
  | {
      kind: "unsupported";
      codecId: string | null;
    };

function parseAvcCodecPrivate(codecPrivate: Uint8Array<ArrayBufferLike>): ParsedCodecFormat {
  if (codecPrivate.length < 6) {
    throw new Error("AVC CodecPrivate is too short");
  }

  const configurationVersion = codecPrivate[0]!;
  if (configurationVersion !== 1) {
    throw new Error("Unsupported AVC config version");
  }

  const profileHex = byteHex(codecPrivate[1]!);
  const compatibilityHex = byteHex(codecPrivate[2]!);
  const levelHex = byteHex(codecPrivate[3]!);
  const nalLengthSize = (codecPrivate[4]! & 0b00000011) + 1;

  return {
    kind: "video",
    format: "avc",
    codec: `avc1.${profileHex}${compatibilityHex}${levelHex}`,
    description: codecPrivate,
    nalLengthSize,
  };
}

function parseHevcCodecPrivate(codecPrivate: Uint8Array<ArrayBufferLike>): ParsedCodecFormat {
  if (codecPrivate.length < 23) {
    throw new Error("HEVC CodecPrivate is too short");
  }

  const configurationVersion = codecPrivate[0]!;
  if (configurationVersion !== 1) {
    throw new Error("Unsupported HEVC config version");
  }

  const profileByte = codecPrivate[1]!;
  const profileSpace = profileByte >> 6;
  const tierFlag = (profileByte & 0b00100000) >> 5;
  const profileIdc = profileByte & 0b00011111;
  const profileCompatibility = reverseBits32(readU32BE(codecPrivate, 2));
  const constraintBytes = codecPrivate.slice(6, 12);
  const levelIdc = codecPrivate[12]!;
  const nalLengthSize = (codecPrivate[21]! & 0b00000011) + 1;

  return {
    kind: "video",
    format: "hevc",
    codec: `hvc1.${HEVC_PROFILE_SPACES[profileSpace]}${profileIdc}.${profileCompatibility.toString(16).toUpperCase()}.${tierFlag === 0 ? "L" : "H"}${levelIdc}${formatHevcConstraints(constraintBytes)}`,
    description: codecPrivate,
    nalLengthSize,
  };
}

function parseAacCodecPrivate(codecPrivate: Uint8Array<ArrayBufferLike>): ParsedCodecFormat {
  const bits = createBitReader(codecPrivate);
  const audioObjectType = readAacAudioObjectType(bits);
  if (audioObjectType !== 2) {
    throw new Error(`Unsupported AAC audioObjectType ${audioObjectType}; expected AAC-LC (2)`);
  }

  const samplingFrequencyIndex = bits.read(4);
  const sampleRate =
    samplingFrequencyIndex === 0x0f ? bits.read(24) : AAC_SAMPLE_RATES[samplingFrequencyIndex];
  if (sampleRate === undefined) {
    throw new Error(`Unsupported AAC samplingFrequencyIndex ${samplingFrequencyIndex}`);
  }

  const channelConfiguration = bits.read(4);
  const numberOfChannels = AAC_CHANNELS[channelConfiguration];
  if (numberOfChannels === undefined) {
    throw new Error(`Unsupported AAC channelConfiguration ${channelConfiguration}`);
  }

  const frameLengthFlag = bits.read(1);
  const framesPerPacket = frameLengthFlag === 0 ? 1024 : 960;

  return {
    kind: "audio",
    format: "aac",
    codec: `mp4a.40.${audioObjectType}`,
    description: codecPrivate,
    sampleRate,
    numberOfChannels,
    framesPerPacket,
  };
}

function parseAssCodecPrivate(codecPrivate: Uint8Array<ArrayBufferLike>): ParsedCodecFormat {
  return {
    kind: "subtitle",
    format: "ass",
    header: new TextDecoder().decode(codecPrivate),
  };
}

function byteHex(byte: number): string {
  return byte.toString(16).padStart(2, "0");
}

function readU32BE(bytes: Uint8Array<ArrayBufferLike>, offset: number): number {
  if (offset + 4 > bytes.length) {
    throw new Error("Unexpected EOF while reading uint32");
  }

  return (
    (((bytes[offset]! << 24) >>> 0) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

function reverseBits32(value: number): number {
  let input = value >>> 0;
  let output = 0;

  for (let i = 0; i < 32; i++) {
    output = (output << 1) | (input & 1);
    input >>>= 1;
  }

  return output >>> 0;
}

function formatHevcConstraints(bytes: Uint8Array<ArrayBufferLike>): string {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) {
    end--;
  }

  return Array.from(bytes.slice(0, end))
    .map((byte) => `.${byte.toString(16).toUpperCase()}`)
    .join("");
}

function createBitReader(bytes: Uint8Array<ArrayBufferLike>) {
  let bitOffset = 0;

  return {
    read(size: number): number {
      let value = 0;

      for (let i = 0; i < size; i++) {
        const byteIndex = Math.floor(bitOffset / 8);
        const bitIndex = 7 - (bitOffset % 8);
        const byte = bytes[byteIndex];
        if (byte === undefined) {
          throw new Error("Unexpected EOF while reading bits");
        }

        value = (value << 1) | ((byte >> bitIndex) & 1);
        bitOffset++;
      }

      return value;
    },
  };
}

function readAacAudioObjectType(bits: ReturnType<typeof createBitReader>): number {
  const audioObjectType = bits.read(5);
  if (audioObjectType === 31) {
    return 32 + bits.read(6);
  }

  return audioObjectType;
}

const HEVC_PROFILE_SPACES = ["", "A", "B", "C"] as const;

const AAC_SAMPLE_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
] as const;

const AAC_CHANNELS: Record<number, number | undefined> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 8,
};
