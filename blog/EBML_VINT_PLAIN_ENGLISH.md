# EBML VINT In Plain English

Goal:

- explain how Mediabunny reads EBML variable-length integers
- focus only on the bit math
- use simple byte examples

Relevant Mediabunny code:

- `readVarIntSize`
- `readVarInt`
- `readElementId`
- `readElementSize`

Source:

- https://github.com/Vanilagy/mediabunny/blob/main/src/matroska/ebml.ts

## The big idea

An EBML integer tells you its own byte length using the first `1` bit in the first byte.

Examples:

```text
1xxxxxxx  -> total width is 1 byte
01xxxxxx  -> total width is 2 bytes
001xxxxx  -> total width is 3 bytes
0001xxxx  -> total width is 4 bytes
```

So the parser first asks:

```text
"Where is the first 1 bit?"
```

That answer gives the width.

Then:

- for `Element ID`: keep that marker bit as part of the value
- for `Element Size`: remove that marker bit before building the value

That is the whole trick.

## Step 1: find the width

Mediabunny starts with this mask:

```text
10000000   // 0x80
```

Then it checks:

```text
does firstByte & mask equal 0?
```

If yes:

- first checked bit was `0`
- move mask one bit right
- width gets bigger by 1

Code shape:

```ts
let width = 1;
let mask = 0x80;

while ((firstByte & mask) === 0) {
  width++;
  mask >>= 1;
}
```

### Example A: `10011111`

```text
firstByte = 10011111
mask      = 10000000

10011111
10000000
--------
10000000   // not zero
```

First bit already `1`.

Result:

```text
width = 1
```

### Example B: `01000001`

First check:

```text
firstByte = 01000001
mask      = 10000000

01000001
10000000
--------
00000000   // zero
```

So first bit is `0`.

Shift mask right:

```text
mask = 01000000
width = 2
```

Check again:

```text
01000001
01000000
--------
01000000   // not zero
```

Result:

```text
width = 2
```

### Example C: `00100000`

Checks:

```text
mask 10000000 -> zero
mask 01000000 -> zero
mask 00100000 -> not zero
```

Result:

```text
width = 3
```

## Step 2: build the value

After width is known, parser reads that many bytes.

Important:

- `Element ID`: keep marker bit
- `Element Size`: clear marker bit

This is why IDs and sizes do not use exactly the same decode logic.

## IDs: keep the marker bit

Example:

```text
1A 45 DF A3
```

First byte:

```text
1A = 00011010
```

First `1` appears in position 4, so width is 4 bytes.

For IDs, Mediabunny keeps all bits:

```text
ID = 0x1A45DFA3
```

No marker-bit removal here.

## Sizes: clear the marker bit

For sizes, the marker bit is only a "length sign".
It is not part of the actual number.

Mediabunny clears it with:

```ts
value = firstByte & (mask - 1);
```

Plain English:

- `mask` points at the marker bit
- `mask - 1` creates a bitmask of all `1`s to the right of it
- `AND` keeps only those lower bits

### Why `mask - 1` works

If:

```text
mask = 10000000
```

Then:

```text
mask - 1 = 01111111
```

If:

```text
mask = 01000000
```

Then:

```text
mask - 1 = 00111111
```

If:

```text
mask = 00100000
```

Then:

```text
mask - 1 = 00011111
```

So `mask - 1` means:

```text
"keep everything to the right of the first 1"
```

## Size example 1: one-byte size `9F`

Byte:

```text
9F = 10011111
```

Width:

```text
first bit is 1 -> width = 1
mask = 10000000
```

Clear marker bit:

```text
firstByte = 10011111
mask - 1  = 01111111

10011111
01111111
--------
00011111
```

Result:

```text
size = 00011111 = 31
```

So:

```text
9F means:
- width = 1 byte
- size value = 31
```

## Size example 2: two-byte size `41 86`

Bytes:

```text
41 = 01000001
86 = 10000110
```

Width from first byte:

```text
01000001
10000000 -> zero
01000000 -> hit
```

So:

```text
width = 2
mask = 01000000
```

Clear marker bit in first byte:

```text
01000001
00111111   // mask - 1
--------
00000001
```

That gives the first part of the value:

```text
value = 0x01
```

Then append remaining bytes:

```text
value = 0x01
value = value * 256 + 0x86
value = 0x0186
value = 390
```

So:

```text
41 86 means:
- width = 2 bytes
- size = 390
```

## Size example 3: three-byte size

Bytes:

```text
20 11 22
```

First byte:

```text
20 = 00100000
```

Width:

```text
10000000 -> zero
01000000 -> zero
00100000 -> hit
```

So:

```text
width = 3
mask = 00100000
```

Clear marker bit:

```text
00100000
00011111
--------
00000000
```

Now append the rest:

```text
value = 0x00
value = 0x00 * 256 + 0x11 = 0x11
value = 0x11 * 256 + 0x22 = 0x1122
```

Result:

```text
size = 0x1122 = 4386
```

## Why multiplication by 256 works

When Mediabunny does:

```ts
value *= 1 << 8;
value += nextByte;
```

that is just:

```text
shift existing value left by 8 bits
then place next byte in the new low 8 bits
```

Example:

```text
value = 00000001
```

Shift left 8 bits:

```text
00000001 00000000
```

Add `10000110`:

```text
00000001 10000110
```

Which is:

```text
0x0186
```

## One sentence summary

EBML VINT decoding is:

```text
find first 1 -> that gives width
for size fields, remove that 1
then append remaining bytes to build the number
```

## Most common confusion

People often think:

```text
"remove the first 1 bit from the byte"
```

More accurate:

```text
"use the first 1 bit as a marker telling width;
for size values, mask it out before reading the numeric payload"
```

That is exactly what this line does:

```ts
value = firstByte & (mask - 1);
```

## Tiny pseudo-code

```ts
function readEbmlSize(bytes) {
  const firstByte = bytes[0];

  let width = 1;
  let mask = 0x80;

  while ((firstByte & mask) === 0) {
    width++;
    mask >>= 1;
  }

  let value = firstByte & (mask - 1);

  for (let i = 1; i < width; i++) {
    value = value * 256 + bytes[i];
  }

  return value;
}
```

## If you only remember 3 things

- first `1` bit tells byte width
- IDs keep marker bit; sizes remove it
- `mask - 1` creates the "keep only bits after marker" mask
