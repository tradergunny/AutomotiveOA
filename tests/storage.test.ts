import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalPhotoStore, newPhotoKey, type PhotoStore } from "@/lib/storage";

let dir: string;
let store: PhotoStore;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "photo-store-"));
  store = createLocalPhotoStore(dir);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("local photo store", () => {
  it("round-trips bytes under a generated key", async () => {
    const key = newPhotoKey("shop1", "case1", "image/jpeg");
    expect(key).toMatch(/^shop1\/case1\/[0-9a-f-]+\.jpg$/);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await store.put(key, bytes, "image/jpeg");
    expect(await store.get(key)).toEqual(bytes);
  });

  it("returns null for a missing key", async () => {
    expect(await store.get("shop1/case1/missing.jpg")).toBeNull();
  });

  it("maps content types to extensions", () => {
    expect(newPhotoKey("s", "c", "image/png")).toMatch(/\.png$/);
    expect(newPhotoKey("s", "c", "image/webp")).toMatch(/\.webp$/);
    expect(newPhotoKey("s", "c", "image/jpeg")).toMatch(/\.jpg$/);
  });

  it("refuses keys that could escape the base directory", async () => {
    for (const evil of ["../evil.jpg", "a/../../evil.jpg", "/etc/passwd", "a//b.jpg", "a/b"]) {
      await expect(store.get(evil)).rejects.toThrow("unsafe storage key");
      await expect(store.put(evil, new Uint8Array([0]), "image/jpeg")).rejects.toThrow(
        "unsafe storage key",
      );
    }
  });
});
