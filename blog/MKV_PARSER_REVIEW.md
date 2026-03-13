# mkv.ts Review — Guide Gaps & Mediabunny Comparison

## mkv.ts vs MKV_PARSER_GUIDE.md — Gap Analysis

**What works:**

- Pull-model reader with LRU chunk cache + prefetch ✅
- VINT decode for IDs (marker bit kept) ✅
- VINT decode for sizes (marker bit stripped) ✅
- Unknown-size detection (all data bits = 1) ✅
- Unknown-size master walking (CLUSTER/SEGMENT) ✅
- Element schema lookup via `constants.ts` ✅

**Major gaps vs the guide's v1 spec:**

1. **No data value readers** — no `readUint`, `readFloat`, `readString`, `readBytes`. Tree is structure-only; can't extract `TimestampScale`, `CodecID`, `CodecPrivate`, `TrackNumber`, etc.
2. **No SeekHead usage** — `getTree()` hardcodes `header + segment` linear scan. Guide TODO says: use SeekHead for direct metadata lookup.
3. **No EBML Header validation** — doesn't check `DocType`, `DocTypeReadVersion`. (Lab 4)
4. **No Tracks extraction** — no per-track parsing of video/audio/subtitle metadata. (Lab 6)
5. **No Cluster/Block parsing** — no `SimpleBlock`/`BlockGroup` payload decode, no track number vint, no signed int16 relative timestamp, no keyframe flag extraction. (Lab 7)
6. **No Cues parsing** — no seek index, no binary search for random access. (Lab 8)
7. **No subtitle extraction** — (Lab 9)
8. **No Segment Position math** — no `segmentDataStart` tracking, so SeekHead offsets would be wrong.
9. **No lacing support** — guide says: parse or fail-fast. Currently silently ignored.
10. **Cross-chunk reads broken** — `BufferedReader.read()` doesn't handle reads spanning chunk boundaries. A 5-byte VINT starting at byte 262141 of a 256KB chunk will return truncated data.

---

## mkv.ts vs mediabunny — Architecture Comparison

| Aspect               | mkv.ts                   | mediabunny                                                                                                         |
| -------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **EBML layer**       | ID/size parsing only     | Full: readVarInt, readUnsignedInt, readSignedInt, readFloat, readAsciiString, readUnicodeString, readElementHeader |
| **Type system**      | Single `Element` type    | Typed wrappers (EBMLFloat32/64, EBMLSignedInt, EBMLUnicodeString) + EBMLId enum (~100 IDs)                         |
| **Demuxer**          | None (tree walk only)    | Full `MatroskaDemuxer`: readMetadata → readSegment → readCluster pipeline                                          |
| **SeekHead**         | Not parsed               | Parsed → used to jump directly to Info/Tracks/Cues/Tags                                                            |
| **Block parsing**    | Not done                 | Full: SimpleBlock + BlockGroup, lacing (Xiph/Fixed/EBML), BlockAdditions, ReferenceBlock                           |
| **Lacing**           | Not handled              | `expandLacedBlocks()` — Xiph, fixed-size, EBML lacing all decoded                                                  |
| **Seeking**          | None                     | Cue-based with cluster position cache, fallback linear scan, faulty-cue recovery                                   |
| **Content encoding** | Not handled              | HeaderStripping decode via `decodeBlockData()`                                                                     |
| **Error recovery**   | Throws on bad data       | `resync()` — byte-level brute-force scan for valid EBML ID                                                         |
| **Codec config**     | Not extracted            | Full: VP9 color space patching, ADTS stripping for AAC, AnnexB detection                                           |
| **Output API**       | Returns raw element tree | `getPacket()/getNextPacket()/getKeyPacket()` — playback-ready `EncodedPacket`                                      |
| **Muxer**            | None                     | Full muxer with interleaving, cluster finalization, SeekHead patching                                              |

---

## Recommended Next Steps (priority order)

- **Fix cross-chunk reads** — this is a correctness bug now
- **Add data value readers** (uint, float, string, bytes) — unlocks everything else
- **Parse SeekHead** → jump to Info/Tracks/Cues directly
- **Extract track metadata** (CodecID, CodecPrivate, dimensions, sample rate)
- **Parse SimpleBlock** (track vint, rel timestamp, flags, payload)
- **Parse Cues** for seek support
- **Add lacing** (at minimum fail-fast detection)

## Summary

The parser has the right foundation (pull-model, chunked I/O, VINT decode, schema-driven tree walk). The gap is mostly that it stops at structure and doesn't extract values — which is exactly what the guide's Labs 4–10 cover.
