import { CHUNK_SIZE } from "./mkv";

export type Backend = {
  fetchBytes: (offset: number, size?: number) => Promise<Uint8Array<ArrayBuffer>>;
};

export async function createBackend(filePath: string, source: "local" | "http"): Promise<Backend> {
  // if (source === "local") {
  //   const handle = await open(filePath, "r");
  //   const stats = await handle.stat();
  //   const fileSize = stats.size;
  //
  //   async function fetchBytes(offset: number, size: number = CHUNK_SIZE) {
  //     if (offset >= fileSize) {
  //       return new Uint8Array(0);
  //     }
  //     const bytesToRead = Math.max(0, Math.min(size, fileSize - offset));
  //
  //     const buf = new Uint8Array(bytesToRead);
  //     const { bytesRead } = await handle.read(buf, 0, bytesToRead, offset);
  //     return buf.slice(0, bytesRead);
  //   }
  //
  //   return {
  //     fetchBytes,
  //   };
  // }

  if (source === "http") {
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

  return {
    fetchBytes: () => new Promise(() => new Uint8Array(0)),
  };
}
