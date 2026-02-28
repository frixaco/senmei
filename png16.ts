const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let value = i
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[i] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] ?? 0
    value = CRC32_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

function adler32(bytes: Uint8Array): number {
  const MOD = 65521
  let a = 1
  let b = 0
  let i = 0

  while (i < bytes.length) {
    const blockEnd = Math.min(i + 5552, bytes.length)
    while (i < blockEnd) {
      a += bytes[i]!
      b += a
      i += 1
    }
    a %= MOD
    b %= MOD
  }

  return ((b << 16) | a) >>> 0
}

function zlibDeflateUncompressed(payload: Uint8Array): Uint8Array {
  const MAX_BLOCK_LENGTH = 65535
  const blockCount = Math.max(1, Math.ceil(payload.length / MAX_BLOCK_LENGTH))
  const out = new Uint8Array(2 + blockCount * 5 + payload.length + 4)

  let outOffset = 0
  out[outOffset] = 0x78
  out[outOffset + 1] = 0x01
  outOffset += 2

  let inOffset = 0
  if (payload.length === 0) {
    out[outOffset] = 0x01
    out[outOffset + 1] = 0x00
    out[outOffset + 2] = 0x00
    out[outOffset + 3] = 0xff
    out[outOffset + 4] = 0xff
    outOffset += 5
  } else {
    while (inOffset < payload.length) {
      const length = Math.min(MAX_BLOCK_LENGTH, payload.length - inOffset)
      const finalBlock = inOffset + length >= payload.length
      const nlen = ~length & 0xffff

      out[outOffset] = finalBlock ? 0x01 : 0x00
      out[outOffset + 1] = length & 0xff
      out[outOffset + 2] = (length >>> 8) & 0xff
      out[outOffset + 3] = nlen & 0xff
      out[outOffset + 4] = (nlen >>> 8) & 0xff
      outOffset += 5

      out.set(payload.subarray(inOffset, inOffset + length), outOffset)
      outOffset += length
      inOffset += length
    }
  }

  const checksum = adler32(payload)
  out[outOffset] = (checksum >>> 24) & 0xff
  out[outOffset + 1] = (checksum >>> 16) & 0xff
  out[outOffset + 2] = (checksum >>> 8) & 0xff
  out[outOffset + 3] = checksum & 0xff

  return out
}

function makePngChunk(type: string, chunkData: Uint8Array): Uint8Array {
  if (type.length !== 4) {
    throw new Error(`Invalid PNG chunk type: ${type}`)
  }

  const chunk = new Uint8Array(12 + chunkData.length)
  const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength)

  view.setUint32(0, chunkData.length, false)
  chunk[4] = type.charCodeAt(0)
  chunk[5] = type.charCodeAt(1)
  chunk[6] = type.charCodeAt(2)
  chunk[7] = type.charCodeAt(3)
  chunk.set(chunkData, 8)

  const checksum = crc32(chunk.subarray(4, 8 + chunkData.length))
  view.setUint32(8 + chunkData.length, checksum, false)

  return chunk
}

function float16BitsToNumber(bits: number): number {
  const sign = (bits & 0x8000) === 0 ? 1 : -1
  const exponent = (bits >> 10) & 0x1f
  const fraction = bits & 0x03ff

  if (exponent === 0) {
    if (fraction === 0) {
      return sign * 0
    }
    return sign * 2 ** -14 * (fraction / 1024)
  }

  if (exponent === 0x1f) {
    return fraction === 0 ? sign * Infinity : Number.NaN
  }

  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

function floatToPng16Channel(value: number): number {
  if (Number.isNaN(value) || value <= 0) {
    return 0
  }
  if (value >= 1 || !Number.isFinite(value)) {
    return 65535
  }
  return Math.round(value * 65535)
}

export function convertRgba16FloatBitsToUint16(
  rgba16FloatBits: Uint16Array,
): Uint16Array {
  const out = new Uint16Array(rgba16FloatBits.length)
  for (let i = 0; i < rgba16FloatBits.length; i += 1) {
    out[i] = floatToPng16Channel(float16BitsToNumber(rgba16FloatBits[i]!))
  }
  return out
}

export function encodeRgba16Png(
  width: number,
  height: number,
  rgba16: Uint16Array,
): Blob {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new Error(`Invalid PNG dimensions: ${width}x${height}`)
  }

  const expectedLength = width * height * 4
  if (rgba16.length !== expectedLength) {
    throw new Error(
      `Invalid RGBA16 buffer length: got ${rgba16.length}, expected ${expectedLength}`,
    )
  }

  const rawStride = 1 + width * 8
  const raw = new Uint8Array(rawStride * height)
  let src = 0

  for (let y = 0; y < height; y += 1) {
    let dst = y * rawStride
    raw[dst] = 0
    dst += 1

    for (let x = 0; x < width; x += 1) {
      const r = rgba16[src++]!
      const g = rgba16[src++]!
      const b = rgba16[src++]!
      const a = rgba16[src++]!

      raw[dst] = (r >>> 8) & 0xff
      raw[dst + 1] = r & 0xff
      raw[dst + 2] = (g >>> 8) & 0xff
      raw[dst + 3] = g & 0xff
      raw[dst + 4] = (b >>> 8) & 0xff
      raw[dst + 5] = b & 0xff
      raw[dst + 6] = (a >>> 8) & 0xff
      raw[dst + 7] = a & 0xff
      dst += 8
    }
  }

  const ihdrData = new Uint8Array(13)
  const ihdrView = new DataView(
    ihdrData.buffer,
    ihdrData.byteOffset,
    ihdrData.byteLength,
  )
  ihdrView.setUint32(0, width, false)
  ihdrView.setUint32(4, height, false)
  ihdrData[8] = 16
  ihdrData[9] = 6
  ihdrData[10] = 0
  ihdrData[11] = 0
  ihdrData[12] = 0

  const ihdr = makePngChunk('IHDR', ihdrData)
  const idat = makePngChunk('IDAT', zlibDeflateUncompressed(raw))
  const iend = makePngChunk('IEND', new Uint8Array(0))

  const png = new Uint8Array(
    PNG_SIGNATURE.length + ihdr.length + idat.length + iend.length,
  )
  let offset = 0
  png.set(PNG_SIGNATURE, offset)
  offset += PNG_SIGNATURE.length
  png.set(ihdr, offset)
  offset += ihdr.length
  png.set(idat, offset)
  offset += idat.length
  png.set(iend, offset)

  return new Blob([png], { type: 'image/png' })
}
