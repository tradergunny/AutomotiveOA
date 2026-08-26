import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { list, put } from "@vercel/blob";

/**
 * Photo storage behind one small seam (M2 brief §5 + founder decision):
 * BLOB_READ_WRITE_TOKEN selects the Vercel Blob driver (staging/production
 * on Vercel — its filesystem is ephemeral); dev and self-host run the
 * local-disk driver below. Photos are customer data — bytes only ever leave
 * through the authenticated, tenant-checked /api/photos/[id] route, never a
 * public URL, regardless of driver.
 */
export interface PhotoStore {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array<ArrayBuffer> | null>;
}

/** Server-generated storage key: shop/case scoped with a random tail. */
export function newPhotoKey(shopId: string, caseId: string, contentType: string): string {
  const ext =
    contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  return `${shopId}/${caseId}/${crypto.randomUUID()}.${ext}`;
}

// Keys come from newPhotoKey, but the driver still refuses anything that
// could escape its base directory.
const SAFE_KEY = /^[A-Za-z0-9-]+(\/[A-Za-z0-9-]+)*\/[A-Za-z0-9-]+\.[a-z0-9]+$/;

function assertSafeKey(key: string) {
  if (!SAFE_KEY.test(key)) {
    throw new Error(`unsafe storage key: ${key}`);
  }
}

export function createLocalPhotoStore(baseDir: string): PhotoStore {
  return {
    async put(key, data) {
      assertSafeKey(key);
      const file = path.join(baseDir, key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data);
    },
    async get(key) {
      assertSafeKey(key);
      try {
        return new Uint8Array(await readFile(path.join(baseDir, key)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
  };
}

/**
 * Vercel Blob driver. Blob objects are "public" in Vercel's model, but their
 * pathnames end in newPhotoKey's random UUID, so the URL carries the same
 * entropy as an unguessable token — and the app never hands it out: the
 * server fetches the bytes here and streams them through the authenticated
 * photo route. (Revisit if Vercel ships private blobs; tracked for M8.)
 */
export function createBlobPhotoStore(): PhotoStore {
  return {
    async put(key, data, contentType) {
      assertSafeKey(key);
      await put(key, Buffer.from(data), {
        access: "public",
        contentType,
        addRandomSuffix: false,
        cacheControlMaxAge: 31536000,
      });
    },
    async get(key) {
      assertSafeKey(key);
      const { blobs } = await list({ prefix: key, limit: 1 });
      const blob = blobs.find((b) => b.pathname === key);
      if (!blob) return null;
      const response = await fetch(blob.url);
      if (!response.ok) return null;
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

/** The app's store. Blob when its token is present; local disk otherwise. */
export const photoStore: PhotoStore = process.env.BLOB_READ_WRITE_TOKEN
  ? createBlobPhotoStore()
  : createLocalPhotoStore(
      process.env.PHOTO_STORAGE_DIR ?? path.join(process.cwd(), ".data", "photos"),
    );
