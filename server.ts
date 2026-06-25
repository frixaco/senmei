import path from "node:path";
import homepage from "./index.html";

const rootDir = import.meta.dir;
const port = Number(Bun.env.PORT ?? 3000);

const contentTypeByExt: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".wgsl": "text/wgsl; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function resolveFilePath(urlPath: string) {
  const decoded = decodeURIComponent(urlPath);
  const requested = decoded === "/" ? "/index.html" : decoded;
  const normalized = path.posix.normalize(requested);
  const safePath = normalized.replace(/^\/+/, "");
  const absolute = path.join(rootDir, safePath);

  if (!absolute.startsWith(rootDir)) {
    return null;
  }

  return absolute;
}

Bun.serve({
  port,
  development: true,
  routes: {
    "/": homepage,
    "/index.html": homepage,
  },
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const filePath = resolveFilePath(pathname);

    if (!filePath) {
      return new Response("Not found", { status: 404 });
    }

    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return new Response("Not found", { status: 404 });
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers = new Headers();

    if (contentTypeByExt[ext]) {
      headers.set("content-type", contentTypeByExt[ext]);
    }

    return new Response(file, { headers });
  },
});

console.log(`Serving on http://localhost:${port}`);
