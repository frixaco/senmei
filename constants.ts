type ElementDefinition = readonly [name: string, id: number, isMaster?: true];

const ELEMENT_DEFINITIONS = [
  // EBML header / globals
  ["EBML", 0x1a45dfa3, true],
  ["EBML_VERSION", 0x4286],
  ["EBML_READ_VERSION", 0x42f7],
  ["EBML_MAX_ID_LENGTH", 0x42f2],
  ["EBML_MAX_SIZE_LENGTH", 0x42f3],
  ["DOC_TYPE", 0x4282],
  ["DOC_TYPE_VERSION", 0x4287],
  ["DOC_TYPE_READ_VERSION", 0x4285],
  ["CRC32", 0xbf],
  ["VOID", 0xec],

  // Top-level Matroska elements
  ["SEGMENT", 0x18538067, true],
  ["SEEK_HEAD", 0x114d9b74, true],
  ["INFO", 0x1549a966, true],
  ["TRACKS", 0x1654ae6b, true],
  ["CLUSTER", 0x1f43b675, true],
  ["CUES", 0x1c53bb6b, true],
  ["ATTACHMENTS", 0x1941a469, true],

  // Seek head
  ["SEEK", 0x4dbb, true],
  ["SEEK_ID", 0x53ab],
  ["SEEK_POSITION", 0x53ac],

  // Info
  ["SEGMENT_UUID", 0x73a4],
  ["TIMESTAMP_SCALE", 0x2ad7b1],
  ["DURATION", 0x4489],
  ["DATE_UTC", 0x4461],
  ["MUXING_APP", 0x4d80],
  ["WRITING_APP", 0x5741],

  // Tracks
  ["TRACK_ENTRY", 0xae, true],
  ["TRACK_NUMBER", 0xd7],
  ["TRACK_UID", 0x73c5],
  ["TRACK_TYPE", 0x83],
  ["FLAG_ENABLED", 0xb9],
  ["FLAG_DEFAULT", 0x88],
  ["FLAG_FORCED", 0x55aa],
  ["FLAG_LACING", 0x9c],
  ["DEFAULT_DURATION", 0x23e383],
  ["NAME", 0x536e],
  ["LANGUAGE", 0x22b59c],
  ["LANGUAGE_BCP47", 0x22b59d],
  ["CODEC_ID", 0x86],
  ["CODEC_PRIVATE", 0x63a2],
  ["CODEC_DELAY", 0x56aa],
  ["SEEK_PRE_ROLL", 0x56bb],
  ["ATTACHMENT_LINK", 0x7446],

  // Content encoding (header stripping compression)
  ["CONTENT_ENCODINGS", 0x6d80, true],
  ["CONTENT_ENCODING", 0x6240, true],
  ["CONTENT_ENCODING_ORDER", 0x5031],
  ["CONTENT_ENCODING_SCOPE", 0x5032],
  ["CONTENT_ENCODING_TYPE", 0x5033],
  ["CONTENT_COMPRESSION", 0x5034, true],
  ["CONTENT_COMP_ALGO", 0x4254],
  ["CONTENT_COMP_SETTINGS", 0x4255],

  // Video track settings
  ["VIDEO", 0xe0, true],
  ["PIXEL_WIDTH", 0xb0],
  ["PIXEL_HEIGHT", 0xba],
  ["DISPLAY_WIDTH", 0x54b0],
  ["DISPLAY_HEIGHT", 0x54ba],

  // Audio track settings
  ["AUDIO", 0xe1, true],
  ["SAMPLING_FREQUENCY", 0xb5],
  ["CHANNELS", 0x9f],
  ["BIT_DEPTH", 0x6264],

  // Cluster payload
  ["TIMESTAMP", 0xe7],
  ["POSITION", 0xa7],
  ["PREV_SIZE", 0xab],
  ["SIMPLE_BLOCK", 0xa3],
  ["BLOCK_GROUP", 0xa0, true],
  ["BLOCK", 0xa1],
  ["BLOCK_DURATION", 0x9b],
  ["REFERENCE_BLOCK", 0xfb],
  ["CODEC_STATE", 0xa4],

  // Cues
  ["CUE_POINT", 0xbb, true],
  ["CUE_TIME", 0xb3],
  ["CUE_TRACK_POSITIONS", 0xb7, true],
  ["CUE_TRACK", 0xf7],
  ["CUE_CLUSTER_POSITION", 0xf1],
  ["CUE_RELATIVE_POSITION", 0xf0],
  ["CUE_DURATION", 0xb2],
  ["CUE_BLOCK_NUMBER", 0x5378],
  ["CUE_CODEC_STATE", 0xea],

  // Tags
  ["TAGS", 0x1254c367, true],
  ["TAG", 0x7373, true],
  ["TARGETS", 0x63c0, true],
  ["TARGET_TYPE_VALUE", 0x68ca],
  ["TARGET_TYPE", 0x63ca],
  ["TAG_TRACK_UID", 0x63c5],
  ["SIMPLE_TAG", 0x67c8, true],
  ["TAG_NAME", 0x45a3],
  ["TAG_LANGUAGE", 0x447a],
  ["TAG_LANGUAGE_BCP47", 0x447b],
  ["TAG_STRING", 0x4487],
  ["TAG_BINARY", 0x4485],

  // Attachments
  ["ATTACHED_FILE", 0x61a7, true],
  ["FILE_NAME", 0x466e],
  ["FILE_MEDIA_TYPE", 0x4660],
  ["FILE_DATA", 0x465c],
  ["FILE_UID", 0x46ae],
] as const satisfies ReadonlyArray<ElementDefinition>;

type ElementDefinitionEntry = (typeof ELEMENT_DEFINITIONS)[number];
export type ElementName = ElementDefinitionEntry[0];
type ElementIdByName = {
  [Definition in ElementDefinitionEntry as Definition[0]]: Definition[1];
};

type ElementInfo = Readonly<{
  name: ElementName;
  isMaster: boolean;
}>;

export const ELEMENT_INFO: Readonly<Record<number, ElementInfo>> =
  Object.fromEntries(
    ELEMENT_DEFINITIONS.map(([name, id, isMaster]) => [
      id,
      { name, isMaster: isMaster === true },
    ]),
  );

export const ELEMENT_ID = Object.fromEntries(
  ELEMENT_DEFINITIONS.map(([name, id]) => [name, id]),
) as ElementIdByName;

export const ELEMENT_NAME = Object.fromEntries(
  ELEMENT_DEFINITIONS.map(([name, id]) => [id, name]),
) as Record<number, string>;

export const MASTER_ELEMENTS: Set<number> = new Set(
  ELEMENT_DEFINITIONS.flatMap(([, id, isMaster]) => (isMaster ? [id] : [])),
);

export const TRACK_TYPE = {
  VIDEO: 1,
  AUDIO: 2,
  SUBTITLE: 17,
} as const;
