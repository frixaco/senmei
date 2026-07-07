# CodecPrivate Parser Reading List

This is the shortest official-source path for writing the three `CodecPrivate`
parsers yourself:

- `V_MPEG4/ISO/AVC` -> H.264 / AVC, WebCodecs string like `avc1.640028`
- `A_AAC` -> AAC, WebCodecs string like `mp4a.40.2`
- `S_TEXT/ASS` -> ASS subtitle header text

The goal is not to become a full media-spec expert first. Read these sections in
order and keep asking: "Given this `CodecID`, what does Matroska promise these
private bytes contain, and what does WebCodecs expect me to pass along?"

## 1. Container-Level Meaning

### Matroska Element Specification

Source:
https://www.matroska.org/technical/elements.html

Read:

- `TrackEntry`
- `CodecID`
- `CodecPrivate`

Exact lines in the current generated HTML:

- `CodecID`: line 164
- `CodecPrivate`: line 165

Why this matters:

- `CodecID` is the string that tells you which codec mapping to use.
- `CodecPrivate` is binary data. The Matroska element type is `b`, meaning
  binary, not string and not number.
- Matroska itself does not parse these bytes for you. The codec mapping decides
  what those bytes mean.

Implementation lesson:

Do not decode `CodecPrivate` generically as UTF-8. Keep it as `Uint8Array`.
Only a codec-specific parser is allowed to interpret it.

## 2. The Concept of a Codec Mapping

### IETF CELLAR Matroska Codec Mappings Draft

Source:
https://datatracker.ietf.org/doc/html/draft-ietf-cellar-codec-19

Read:

- Section 1, `Introduction`
- Section 3, `Codec Mapping`

Exact paragraphs:

- Section 1 says Matroska stores interleaved/timestamped audiovisual data using
  many codecs, and a mapping is needed between how the data is stored in
  Matroska and how the codec understands it.
- Section 3 says each `TrackEntry` must reference a defined codec mapping using
  `CodecID`, and some encodings require codec initialization data.

Useful current HTML lines:

- Lines 720-722: why codec mappings exist.
- Lines 726-729: `CodecID` selects the mapping, and some codecs need
  initialization data.

Why this matters:

This is the "routing table" idea. You do not build a codec string from nothing.
You switch on `CodecID`, then apply that codec's official mapping.

Implementation lesson:

Your helper should be shaped roughly like:

```ts
function parseBytesIntoFormat(codecId: string, bytes: Uint8Array | null) {
  switch (codecId) {
    case "V_MPEG4/ISO/AVC":
      return parseAvcCodecPrivate(bytes);
    case "A_AAC":
      return parseAacCodecPrivate(bytes);
    case "S_TEXT/ASS":
      return parseAssCodecPrivate(bytes);
    default:
      return { kind: "unsupported", codecId };
  }
}
```

## 3. H.264 / AVC Parser

### Matroska Mapping for `V_MPEG4/ISO/AVC`

Source:
https://datatracker.ietf.org/doc/html/draft-ietf-cellar-codec-19#section-3.3.13

Read:

- Section 3.3.13, `V_MPEG4/ISO/AVC`

Exact paragraphs:

- `Codec ID: V_MPEG4/ISO/AVC`
- `Codec Name: AVC/H.264`
- `Description`
- `Initialization`

Useful current HTML lines:

- Lines 917-923.

The key sentence:

`CodecPrivate` contains an `AVCDecoderConfigurationRecord`.

Why this matters:

The bytes are not a raw H.264 frame. They are a small configuration record,
commonly called `avcC`, containing decoder setup information such as profile,
level, NAL length size, SPS, and PPS.

### ISO/IEC 14496-15

Source:
https://www.iso.org/standard/87828.html

Read:

- Section 5.3.3.1, `AVCDecoderConfigurationRecord`
- Section 5.3.2, AVC sample / canonical format, if you want to understand why
  MKV samples are usually length-prefixed instead of Annex B start-code format.

Important note:

This ISO spec is the canonical definition of the binary layout, but it is
paywalled. The public specs above tell you that this is the structure you must
parse; this ISO section is the official byte layout source.

Fields your parser needs from `AVCDecoderConfigurationRecord`:

- `configurationVersion`
- `AVCProfileIndication`
- `profile_compatibility`
- `AVCLevelIndication`
- `lengthSizeMinusOne`
- `numOfSequenceParameterSets`
- each SPS length and SPS bytes
- `numOfPictureParameterSets`
- each PPS length and PPS bytes
- optional high-profile extension fields, which can exist after PPS

Implementation lesson:

- The WebCodecs codec string for ordinary H.264 is `avc1.` plus three bytes as
  uppercase or lowercase hex.
- For `avcC`, those three bytes are usually bytes 1, 2, and 3:
  `AVCProfileIndication`, `profile_compatibility`, `AVCLevelIndication`.
- Example: bytes `64 00 28` become `avc1.640028`.
- `lengthSizeMinusOne` tells you how many bytes prefix each NAL unit in samples:
  `(lengthSizeMinusOne & 0x03) + 1`.

### RFC 6381 Codec Strings

Source:
https://www.rfc-editor.org/rfc/rfc6381.html#section-3.3

Read:

- Section 3.3, ISO Base Media File Format Name Space
- The AVC paragraph beginning "When the first element of a value is a code
  indicating a codec from the Advanced Video Coding specification..."

Useful current HTML lines:

- Lines 391-406: AVC codec string suffix is the hex representation of
  `profile_idc`, constraint flags / compatibility byte, and `level_idc`.
- Line 500: example `video/mp4; codecs="avc1.640028"`.

Why this matters:

This explains why `64 00 28` turns into `avc1.640028`. That string is not made
up by your project. It is a standardized codec identifier.

### WebCodecs AVC Registration

Source:
https://www.w3.org/TR/webcodecs-avc-codec-registration/

Read:

- Section 1, `Fully qualified codec strings`
- Section 2, `EncodedVideoChunk data`
- Section 3, `VideoDecoderConfig description`
- Section 4, `EncodedVideoChunk type`
- Section 5.2, `AvcBitstreamFormat`

Useful current HTML lines:

- Lines 71-73: codec string begins with `avc1.` or `avc3.`.
- Lines 76-81: encoded chunk data expectations.
- Lines 84-90: if `description` is present, it is an
  `AVCDecoderConfigurationRecord`, and the bitstream is `avc` format.
- Lines 94-96: key chunks in `avc` format are expected to be IDR pictures, and
  parameter sets are in `description`.

Why this matters:

This is the bridge from Matroska to browser decoding. Matroska says
`CodecPrivate` contains `AVCDecoderConfigurationRecord`; WebCodecs says
`VideoDecoderConfig.description` should contain `AVCDecoderConfigurationRecord`.
So for H.264, you usually pass those same bytes as `description`.

Minimum H.264 output from your parser:

```ts
{
  kind: "video",
  format: "avc",
  codec: "avc1.640028",
  description: codecPrivate,
  nalLengthSize: 4,
}
```

## 4. AAC Parser

### Matroska Mapping for `A_AAC`

Source:
https://datatracker.ietf.org/doc/html/draft-ietf-cellar-codec-19#section-3.4.1

Read:

- Section 3.4.1, `A_AAC`
- Sections 3.4.2 through 3.4.10 only for contrast with old superseded AAC
  `CodecID`s.

Exact paragraphs:

- `Codec ID: A_AAC`
- `Codec Name: Advanced Audio Coding (AAC)`
- `Description`
- `Initialization`

Useful current HTML lines:

- Lines 1117-1123: `A_AAC` stores AAC `raw_data_block()` frames and
  `CodecPrivate` contains `AudioSpecificConfig`.
- Lines 1124-1222: older AAC IDs are superseded by `A_AAC`.

The key sentence:

`CodecPrivate` contains an `AudioSpecificConfig`.

Why this matters:

AAC `CodecPrivate` is tiny because it is bit-packed configuration. In your file,
two bytes like `12 10` can contain audio object type, sample-rate index, and
channel config.

### ISO/IEC 14496-3

Source:
https://www.iso.org/standard/53943.html

Read:

- Section 1.6.2.1, `AudioSpecificConfig`
- Table 1.19, `AudioSpecificConfig`
- The tables defining:
  - `audioObjectType`
  - `samplingFrequencyIndex`
  - `channelConfiguration`

Important note:

This ISO spec is the canonical AAC byte/bit layout source, but it is paywalled.
The W3C AAC registration points directly to Section 1.6.2.1, Table 1.19.

Fields your parser needs from `AudioSpecificConfig`:

- first 5 bits: `audioObjectType`
- next 4 bits: `samplingFrequencyIndex`
- if `samplingFrequencyIndex === 0x0f`, next 24 bits are explicit sample rate
- next 4 bits: `channelConfiguration`
- handle extended object type escape value `31` if you want robustness
- handle SBR/PS extension cases if you go beyond AAC-LC

Implementation lesson:

- `audioObjectType = 2` means AAC-LC.
- `mp4a.40.2` means MPEG-4 audio object type 2.
- `samplingFrequencyIndex = 4` means 44100 Hz.
- `channelConfiguration = 2` means stereo.

### RFC 6381 Codec Strings

Source:
https://www.rfc-editor.org/rfc/rfc6381.html#section-3.3

Read:

- Section 3.3, especially the `mp4a` paragraphs.

Useful current HTML lines:

- Lines 376-382: `mp4a.40.<audio object type>`, with AAC-LC example
  `mp4a.40.2`.

Why this matters:

This explains why AAC-LC with audio object type `2` becomes `mp4a.40.2`.

### WebCodecs AAC Registration

Source:
https://www.w3.org/TR/webcodecs-aac-codec-registration/

Read:

- Section 1, `Fully qualified codec strings`
- Section 2, `EncodedAudioChunk data`
- Section 3, `AudioDecoderConfig description`
- Section 4, `EncodedAudioChunk type`
- Section 5.2, `AacBitstreamFormat`

Useful current HTML lines:

- Lines 71-84: accepted AAC codec strings, including `mp4a.40.2`.
- Lines 87-89: `aac` chunks are raw AAC frames.
- Lines 90-96: if `description` is present, it is `AudioSpecificConfig`, and
  the bitstream is `aac` format.
- Lines 97-101: AAC `EncodedAudioChunk` type is always `key`.
- Lines 119-131: `aac` vs `adts` bitstream formats.

Why this matters:

Matroska says `CodecPrivate` is `AudioSpecificConfig`; WebCodecs says
`AudioDecoderConfig.description` should be `AudioSpecificConfig`. So for AAC,
you usually pass the same bytes as `description`.

Minimum AAC output from your parser:

```ts
{
  kind: "audio",
  format: "aac",
  codec: "mp4a.40.2",
  description: codecPrivate,
  sampleRate: 44100,
  numberOfChannels: 2,
}
```

## 5. ASS Subtitle Parser

### Matroska Mapping for `S_TEXT/ASS`

Source:
https://datatracker.ietf.org/doc/html/draft-ietf-cellar-codec-19#section-5.3

Read:

- Section 5.2, `SRT Subtitles`, for contrast.
- Section 5.3, `SSA/ASS Subtitles`.

Useful current HTML lines:

- Lines 1918-1919: SRT leaves `CodecPrivate` blank, then ASS section starts.
- Lines 1921-1928: ASS is text-based and contains `[Script Info]` and style
  sections.
- Keep reading through the example and the paragraphs that explain what goes
  into `CodecPrivate` versus what goes into each subtitle block.

Why this matters:

ASS is different from H.264 and AAC. It is not decoder binary config for
WebCodecs. It is a text subtitle script header. The header contains global
script information and style definitions. The timed subtitle blocks contain the
event dialogue rows.

Implementation lesson:

For `S_TEXT/ASS`, decoding `CodecPrivate` as UTF-8 is correct because the
mapping says this format is text-based. But that is a codec-specific decision,
not a generic rule for all `CodecPrivate` values.

Minimum ASS output from your parser:

```ts
{
  kind: "subtitle",
  format: "ass",
  header: new TextDecoder().decode(codecPrivate),
}
```

## 6. Suggested Reading Order

Read in this order:

1. Matroska Element Specification: `TrackEntry`, `CodecID`, `CodecPrivate`.
2. IETF codec mapping draft: Section 1 and Section 3.
3. IETF `V_MPEG4/ISO/AVC`: Section 3.3.13.
4. W3C WebCodecs AVC registration: Sections 1-4.
5. RFC 6381: AVC codec string paragraphs in Section 3.3.
6. ISO/IEC 14496-15: Section 5.3.3.1, if you can access it.
7. IETF `A_AAC`: Section 3.4.1.
8. W3C WebCodecs AAC registration: Sections 1-5.2.
9. RFC 6381: `mp4a` paragraphs in Section 3.3.
10. ISO/IEC 14496-3: Section 1.6.2.1 / Table 1.19, if you can access it.
11. IETF `S_TEXT/ASS`: Section 5.3.

## 7. Self-Check Before Coding

You are ready to code when you can answer these without guessing:

- Why is `CodecPrivate` stored as bytes first?
- Why does `CodecID` decide how those bytes are interpreted?
- For H.264, why does `64 00 28` become `avc1.640028`?
- For H.264, why can `CodecPrivate` be passed as WebCodecs
  `VideoDecoderConfig.description`?
- For AAC, why does audio object type `2` become `mp4a.40.2`?
- For AAC, why can `CodecPrivate` be passed as WebCodecs
  `AudioDecoderConfig.description`?
- For ASS, why is UTF-8 decoding appropriate even though it was wrong for
  H.264/AAC?

## 8. Parser Scope I Would Keep

For this project right now, implement only:

- H.264 `V_MPEG4/ISO/AVC`
  - Validate enough `avcC` structure to avoid out-of-bounds reads.
  - Build `avc1.xxxxxx`.
  - Extract `nalLengthSize`.
  - Preserve original bytes as `description`.
- AAC `A_AAC`
  - Bit-read `AudioSpecificConfig`.
  - Build `mp4a.40.<audioObjectType>`.
  - Extract sample rate and channel config.
  - Preserve original bytes as `description`.
- ASS `S_TEXT/ASS`
  - UTF-8 decode the header.
  - Keep raw bytes too if you want debugging.

Leave HEVC, AV1, Opus, FLAC, VVC, Dolby Vision, and strange legacy AAC IDs for
later. They are the same pattern, but they are not needed to understand the
first working MKV-to-WebCodecs path.
