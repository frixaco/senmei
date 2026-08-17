import { CHUNK_SIZE } from "./mkv";

export type Backend = {
  fetchBytes: (offset: number, size?: number) => Promise<Uint8Array<ArrayBuffer>>;
};

export async function createBackend(source: string | Blob): Promise<Backend> {
  if (typeof source !== "string") {
    return createBlobBackend(source);
  }
  return createHttpBackend(source);
}

async function createBlobBackend(file: Blob): Promise<Backend> {
  const fileSize = file.size;

  return {
    async fetchBytes(offset: number, size: number = CHUNK_SIZE) {
      if (offset >= fileSize) {
        return new Uint8Array(0);
      }
      const bytesToRead = Math.max(0, Math.min(size, fileSize - offset));
      const buf = await file.slice(offset, offset + bytesToRead).arrayBuffer();
      return new Uint8Array(buf);
    },
  };
}

async function createHttpBackend(filePath: string): Promise<Backend> {
  let fileSize = 0;

  const response = await fetch(filePath, {
    headers: {
      Range: `bytes=0-0`,
    },
  });
  if (response.status === 206 && response.headers.has("content-range")) {
    const endByte = response.headers.get("content-range")!.split("/")?.[1];
    if (endByte) {
      fileSize = Number(endByte);
    }
  }

  async function fetchBytes(offset: number, size: number = CHUNK_SIZE) {
    if (offset >= fileSize) {
      return new Uint8Array(0);
    }

    const start = offset;
    const end = offset + size - 1;
    // handle content-range final byte number
    const rangeEnd = Math.min(fileSize - 1, end);

    const response = await fetch(filePath, {
      headers: {
        Range: `bytes=${start}-${rangeEnd}`,
      },
    });

    if (response.status === 206) {
      return new Uint8Array(await response.arrayBuffer());
    }

    // we need to stream
    if (response.status === 200) {
      throw new Error("Can't stream");
    }

    // TODO: handle 416

    throw new Error("Unexpected");
  }

  return {
    fetchBytes,
  };
}
