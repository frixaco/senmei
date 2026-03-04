# MKV Parser Learning Guide (No Ready-Made Solutions)

Goal: learn parser internals by building and verifying each piece yourself.
Rule: this guide gives checkpoints, invariants, and failure modes, not copy-paste code.

## Starter Glossary (Read Once)

- EBML: binary container format; Matroska is built on top of it.
- Element: one unit of EBML data: `ID + Size + Data`.
- Master element: element whose Data contains child elements.
- Leaf element: element whose Data is raw value bytes.
- VINT: variable-length integer encoding used for IDs and Sizes.
- Segment: top-level Matroska payload area after EBML Header.
- Segment Position: byte offset relative to Segment data start, not file start.
- Cluster: chunk of timed media blocks (video/audio/subtitle payloads).
- SimpleBlock: compact block carrying frame data + per-block flags.
- Track Ticks: per-track timestamp units before scaling to nanoseconds.
- TimestampScale: Segment scale factor to convert ticks to nanoseconds.
- CodecPrivate: codec init blob needed for decoder configuration.

## Reliable References (Verified 2026-03-03)

- RFC 8794 (EBML)
  - URL: https://www.rfc-editor.org/rfc/rfc8794.html
  - Reliability: Normative (IETF)
  - Use: VINT rules, Element ID/Size encoding, unknown-size semantics
- RFC 9559 (Matroska)
  - URL: https://www.rfc-editor.org/rfc/rfc9559.html
  - Reliability: Normative (IETF)
  - Use: Matroska schema, blocks, timestamps, segment positions
- Matroska Data Layout
  - URL: https://www.matroska.org/technical/diagram.html
  - Reliability: High (official project docs)
  - Use: fast mental model of tree layout
- Matroska Elements
  - URL: https://www.matroska.org/technical/elements.html
  - Reliability: High (official project docs)
  - Use: ID/type/path lookup table while implementing
- Matroska Notes
  - URL: https://www.matroska.org/technical/notes.html
  - Reliability: High (official project docs)
  - Use: Block/SimpleBlock flags, lacing details
- Matroska Codec Mappings
  - URL: https://www.matroska.org/technical/codec_specs.html
  - Reliability: High (official project docs)
  - Use: CodecID + CodecPrivate expectations

Reading priority:

- RFC 8794: sections 4, 5, 6
- RFC 9559: sections 4.5, 5.1, 6.1, 10, 11, 16

## Scope for v1 Parser

Implement only:

- EBML Header validation
- Segment child scanning
- Info (`TimestampScale`, `Duration`)
- Tracks needed for playback + selection
- Cluster parsing for `SimpleBlock` and `BlockGroup`
- Cues-based seek index (required for smooth seek/scrub)
- Subtitle extraction for plain text tracks

Defer:

- Attachments/Chapters/Tags details
- Full Matroska schema coverage
- Subtitle styling/rendering semantics (ASS/SSA layout/styling)
- Advanced edit structures (keep parser focused on playback path)

Must support for this project:

- Video: `V_MPEG4/ISO/AVC`, `V_MPEGH/ISO/HEVC`
- Audio: `A_AAC`
- Subtitles (text only): start with `S_TEXT/UTF8`
- Track selection metadata: `Name`, `Language`, `FlagDefault`, `FlagForced`

Explicit v1 policy (to avoid hidden bugs):

- If lacing appears, either parse it for that file or fail fast with clear error
- If Cues missing, use coarse fallback seek (scan forward to next decodable keyframe)
- If subtitle codec is not plain text, expose as unsupported, not silently ignored

## Core Concepts You Must Nail

### 1) VINT: same envelope, different interpretation

- Element ID: keep marker bit in the raw ID bytes
- Element Data Size: marker bit not part of value
- Unknown size: all VINT_DATA bits set to `1`
- Constraint: unknown size only valid for master elements with `unknownsizeallowed: true`

Failure modes:

- treating ID and Size with same decode path
- 32-bit overflow when shifting large sizes in JS

### 2) Segment Position is not file offset

From RFC 9559 section 16:

- position measured from start of Segment data area
- first child of Segment has Segment Position `0`

So:

- `absolute_offset = segment_data_start + segment_position`
- `segment_data_start = segment_id_offset + segment_header_length`

Failure mode:

- adding position to file start instead of Segment data start

### 3) SimpleBlock flag bits: avoid index confusion

Spec says “bit 0 is most-significant bit”.
In JS, use masks to avoid mental mismatch:

- keyframe: `0x80`
- invisible: `0x08`
- lacing: `(flags & 0x06) >> 1`
- discardable: `0x01`

Failure mode:

- interpreting “bit 0” as least-significant and flipping semantics

### 4) Timestamp math: use full formula early

General form (RFC 9559 section 11.2):

- `ns = ((cluster_ts + block_rel_ts * track_ts_scale) * timestamp_scale) - codec_delay`

v1 simplification allowed only if you assert:

- `track_ts_scale == 1.0`
- `codec_delay == 0`

Failure mode:

- seeking seems “almost right” but drifts on tracks with non-default values

## One Byte Walkthrough (Header Only)

Practice on first bytes of a real MKV:

- Bytes: `1A 45 DF A3` -> EBML Header ID
- Next byte often `9F`:
  - `9F` in binary: `10011111`
  - leading marker `1` => Size field length is 1 byte
  - size value is `0x1F` (strip marker bit)
  - Data length is 31 bytes
- So first element envelope is:
  - `ID=0x1A45DFA3`
  - `Size=31`
  - `Data=next 31 bytes`

Checkpoint:

- after consuming `4 + 1 + 31` bytes, cursor lands exactly at next top-level element

If cursor does not align:

- wrong VINT length logic
- wrong marker-bit stripping
- or off-by-one cursor update

## Minimum Success Path (First Decoded Video Frame)

Do only these first:

1. Lab 1 (VINT) pass
2. Lab 2 (element header) pass
3. Lab 4 (DocType validation) pass
4. Lab 5 (find Tracks + first Cluster)
5. Lab 6 (extract video track + CodecPrivate)
6. Lab 7 (extract one video SimpleBlock payload)
7. feed payload to decoder with parsed track metadata

Stop here and verify first decoded frame before adding seek/lacing.

## Minimum Success Path (Your Real Goal Set)

After first frame works, finish these in order:

1. Add AAC extraction path from same clusters
2. Add `BlockGroup` handling for timing/dependency elements used in real files
3. Add subtitle extraction for plain text tracks
4. Add Cues index and random-seek path
5. Add fallback seek when Cues missing
6. Add minimal track selection metadata + switching

## Parser Input Strategy: Chunk Stream vs Reader/Slice

Two valid ways to feed bytes into your parser:

- Push model: source gives arbitrary chunks, parser consumes whatever arrived
- Pull model: parser asks for bytes at absolute file offsets and gets a contiguous slice back

Plain English:

- push model says: "here is the next network/file chunk; try parsing now"
- pull model says: "give me bytes from offset `X` so I can parse the next element header"

Why push model gets annoying early:

- EBML headers are variable-length
- an `ID` can be split across chunk boundary
- a `Size` can be split across chunk boundary
- payload can be split across chunk boundary
- parser must keep leftover bytes and resume state cleanly

So with push model, you usually need:

- pending buffer
- current absolute file offset
- parser state machine (`reading id`, `reading size`, `reading data`)
- logic to pause when bytes are incomplete

Why pull model is simpler for MKV:

- parser owns the cursor
- reader/source handles fetching/caching bytes
- parser can first ask for a small header slice
- after reading `ID + Size`, parser can ask for exact payload bytes
- seeking and cue-based lookups fit this model naturally

Mediabunny-style mental model:

1. ask for `2..16` bytes at `currentPos`
2. parse element header
3. now know `id`, `size`, and `dataStart`
4. ask for exact `size` bytes of data
5. parse or skip
6. move to next absolute position

Important distinction:

- this does not remove "need more bytes" from the system
- it moves that problem into the reader/cache layer
- parser code becomes much simpler because it reads from slices that are already contiguous

Recommended approach for this project:

- v1 parser core: use pull model with a tiny reader abstraction
- later, if you need true live streaming, build a chunk-buffered source under that same reader API

Recommended playback-facing API shape:

- keep parser internals offset-based; keep app-facing API time-based
- prefer a stateful per-track stream/cursor API over a stateless lookup-only API
- good fit:
  - `const s = video.stream()`
  - `await s.seekMs(ms)`
  - `const current = await s.current()`
  - `const upcoming = await s.readAheadNs(ns)`
- reason:
  - seeking/scrubbing are stateful operations
  - HTTP/range streaming wants cache state, prefetch windows, and cancellation
  - sequential playback should reuse parser/cluster/cue context instead of recomputing from scratch
- avoid ambiguous shapes like `frame(ms).prepare(ns)`:
  - `frame(...)` sounds like one value
  - `prepare(...)` sounds like future range fetch
  - one object then mixes "single sample data" with "stateful stream cursor"

Practical reason:

- Matroska seeking, Segment Positions, Cue lookups, and cluster scans all work more naturally with absolute offsets than with raw chunk callbacks

Rule of thumb:

- if parser code keeps asking "what if header ends in next chunk?", you are still mixing source-layer problems into parser-layer logic
- if parser code mostly thinks in `offset -> header -> payload -> next offset`, your layering is probably right

For learning:

- build parser against a file-backed/random-access reader first
- add true incremental stream support only after first-frame extraction works

## Incremental Labs (Build + Verify)

### Lab 1: VINT decoder

Inputs:

- byte stream
- offset

Edge cases:

- 1..8 octet lengths
- invalid leading pattern
- values beyond 32-bit

Pass checks:

- expected length detected correctly
- ID decode path and Size decode path both tested
- unknown-size value recognized correctly

Expected output shape:

- `{ lengthBytes, rawValue, interpretedAs: "id" | "size", isUnknownSize }`

### Lab 2: Element header parser (`ID + Size`)

Inputs:

- raw buffer
- element offset

Edge cases:

- short buffer
- unknown-size elements
- invalid ID length for your constraints

Pass checks:

- first element in MKV is `0x1A45DFA3`
- parser never reads past available bytes

Expected output shape:

- `{ idHex, size, headerLen, dataStart, dataEnd }`

### Lab 3: Tree walker with bounds

Inputs:

- parent start/end
- child cursor

Edge cases:

- unknown element IDs
- unknown-size masters
- malformed child crossing parent boundary

Pass checks:

- clean skip for unknown known-size elements
- deterministic stop condition for unknown-size masters

Expected output shape:

- list of rows:
  - `{ depth, idHex, start, headerLen, size, endOrUnknown, kind: "master" | "leaf" | "unknown" }`

### Lab 4: EBML Header validation

Read and validate:

- `DocType` (`matroska` or `webm`)
- `DocTypeReadVersion` <= supported version

Pass checks:

- invalid DocType rejected early
- clear error reason returned

Expected output shape:

- `{ ok, docType, docTypeReadVersion, reasonIfRejected }`

### Lab 5: Segment metadata scan

Collect:

- SeekHead locations
- Info
- Tracks

Pass checks:

- first Cluster found without full-file parse
- works when Cues are near EOF

Expected output shape:

- `{ segmentDataStart, infoPos, tracksPos, firstClusterPos, cuesPosMaybe, seekHeadEntries[] }`

### Lab 6: Tracks extraction

Per track capture:

- TrackNumber, TrackType, CodecID, CodecPrivate
- Name, Language, FlagDefault, FlagForced
- video: PixelWidth/PixelHeight
- audio: SamplingFrequency/Channels/BitDepth

Pass checks:

- map Block track number to parsed track entry
- unsupported codec gets explicit “known unsupported” path
- track list gives enough data for minimal UI selection

Expected output shape:

- one record per track:
  - `{ trackNumber, trackType, codecId, codecPrivateLen, name?, language?, default?, forced?, video?, audio?, supported }`

### Lab 7: Cluster parse (`SimpleBlock` + `BlockGroup`)

Parse:

- track number (EBML-like vint in block header)
- relative timestamp (signed int16)
- flags + frame payload
- `BlockGroup` fields needed for playback timing/dependency (`BlockDuration`, `ReferenceBlock` when present)

Pass checks:

- keyframe detection matches `mkvinfo` output
- timestamps monotonic enough for decoder input rules
- known `BlockGroup`-using test file plays correctly

Expected output shape:

- one record per parsed block:
  - `{ clusterTs, relTs, trackNumber, blockKind, flagsHex?, keyframe?, lacingMode?, payloadLen, blockDuration?, referenceBlock?, ptsNs }`

### Lab 8: Cues index + seek

Parse:

- CueTime
- CueTrackPositions/CueClusterPosition

Algorithm:

- binary search cue <= target time
- jump to cluster offset via Segment Position conversion
- decode forward from nearest keyframe

Pass checks:

- repeated random seeks land near target
- no off-by-one in offset math
- scrub interactions do not stall on frequent short seeks

Expected output shape:

- cues table rows:
  - `{ cueTime, cueTrack, cueClusterPos, absoluteClusterOffset }`
- seek decision:
  - `{ targetTime, chosenCueTime, chosenClusterOffset, decodeStartBlockTs }`

### Lab 9: Subtitle extraction (text only)

Parse:

- subtitle track entries from `Tracks`
- subtitle payload blocks from `Cluster`
- timing from cluster/block timestamps (plus duration if present)

Pass checks:

- plain text subtitles appear in correct order and near-correct times
- unsupported subtitle codecs are reported clearly

Expected output shape:

- subtitle event rows:
  - `{ trackNumber, startNs, endNsMaybe, text, codecId, supported }`

### Lab 10: Minimal track selection

Implement:

- choose active video/audio/subtitle track by TrackNumber
- default to `FlagDefault` when user has no explicit choice
- preserve user-selected track across seeks

Pass checks:

- switching tracks changes decoded output source as expected
- seek continues on selected tracks without desync

Expected output shape:

- active selection state:
  - `{ videoTrack, audioTrack, subtitleTrack, source: "default" | "user" }`

## Verification Workflow

Reference tools:

```bash
brew install mkvtoolnix
mkvinfo yourfile.mkv
mkvinfo -v yourfile.mkv
```

Recommended loop:

- run one lab
- diff your parsed offsets/IDs/timestamps against `mkvinfo -v`
- fix root cause before next lab

If available, also run:

- `mkvalidator yourfile.mkv` for container conformance sanity

## Common Mistakes (Seen Often)

- using JS bitwise ops for 64-bit sizes
- forgetting second SeekHead can exist
- assuming Cues always present or early in file
- assuming lacing never appears because first test file had none
- hardcoding decoder config fields that should come from parsed metadata
- ignoring `BlockGroup` and then failing on files without `SimpleBlock`-only layout
- extracting subtitles without explicit unsupported path for non-text subtitle codecs

## Done Criteria for v1

- opens local MKV
- validates EBML Header
- lists tracks with selection metadata (`name/language/default/forced`)
- emits AVC/HEVC video and AAC audio frames from clusters
- extracts plain text subtitles with timestamps
- seeks/scrubs via Cues, with fallback when Cues missing
- supports minimal track selection and switching
- reports clear errors on malformed/unsupported cases
