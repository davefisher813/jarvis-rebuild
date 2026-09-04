// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { FilesService } from "./FilesService";
import { MemoryFileStore, SupabaseFileStore } from "./FileStore";
import { sizeLabel, fileStem } from "./types";

// A FILE OF YOUR OWN (2026-09-02). The row about a file, the shelf the demo
// keeps its bytes on, and the Supabase store's path and URL behaviour
// against a fake client. The EXIF strip and the size gate have their own
// tests in shared/fileStorage.

describe("sizeLabel and fileStem", () => {
  it("say the size in the unit a person would", () => {
    expect(sizeLabel(0)).toBe("");
    expect(sizeLabel(512)).toBe("512 B");
    expect(sizeLabel(340 * 1024)).toBe("340 KB");
    expect(sizeLabel(1.25 * 1024 * 1024)).toBe("1.3 MB");
    expect(sizeLabel(2 * 1024 * 1024)).toBe("2 MB");
  });
  it("title a note after the file, without the extension or the underscores", () => {
    expect(fileStem("IMG_4021.jpg")).toBe("IMG 4021");
    expect(fileStem("rent-receipt-sep.pdf")).toBe("Rent receipt sep");
    expect(fileStem(".hidden")).toBe("Untitled");
  });
});

describe("FilesService", () => {
  it("lists a scope newest first and forgets a removed row", async () => {
    const svc = new FilesService(new Store(new InMemoryAdapter()), "u1");
    const a = await svc.create({ name: "a.jpg", path: "u1/a/a.jpg", mime: "image/jpeg", bytes: 10, scope: "money", addedAt: "2026-09-01" });
    const b = await svc.create({ name: "b.pdf", path: "u1/b/b.pdf", mime: "application/pdf", bytes: 20, scope: "money", addedAt: "2026-09-02" });
    expect((await svc.list("money")).map((f) => f.id)).toEqual([b, a]);
    await svc.update(a, { path: "u1/a/a2.jpg" });
    expect((await svc.get(a))?.data.path).toBe("u1/a/a2.jpg");
    await svc.remove(b);
    expect((await svc.list("money")).map((f) => f.id)).toEqual([a]);
  });
});

// jsdom's File has no arrayBuffer(); give it the one the browser has.
const fileOf = (bytes: Uint8Array, name: string, type: string): File => {
  const f = new File([bytes as BlobPart], name, { type });
  Object.defineProperty(f, "arrayBuffer", { value: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) });
  return f;
};
const png = () => {
  // A minimal PNG header plus IEND: enough for the strip to pass it through.
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  return fileOf(bytes, "shot one.png", "image/png");
};

describe("MemoryFileStore", () => {
  it("shelves an upload under the owner and the entity, serves it, and sweeps a folder", async () => {
    let n = 0;
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:" + ++n, revokeObjectURL: () => undefined });
    try {
      const store = new MemoryFileStore("u1");
      const stored = await store.upload("note1", png());
      expect(stored.path.startsWith("u1/note1/")).toBe(true);
      expect(stored.path.endsWith("-shot_one.png")).toBe(true);
      expect(stored.mime).toBe("image/png");
      expect(await store.url(stored.path)).toBe("blob:1");
      // B1-6: a second upload under the same entity with the SAME filename
      // must land on its own path, not overwrite the first.
      const second = await store.upload("note1", fileOf(new Uint8Array([9, 9]), "shot one.png", "image/png"));
      expect(second.path).not.toBe(stored.path);
      expect(await store.url(stored.path)).not.toBeNull();
      await store.upload("note1", fileOf(new Uint8Array([1, 2]), "b.pdf", "application/pdf"));
      await store.removeAll("note1");
      expect(await store.url(stored.path)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("refuses what the gate refuses, before any shelf work", async () => {
    const store = new MemoryFileStore("u1");
    await expect(store.upload("n", new File(["x"], "x.txt", { type: "text/plain" }))).rejects.toThrow(/not supported/);
  });
});

describe("SupabaseFileStore", () => {
  const fake = () => {
    const calls: Record<string, unknown[]> = { upload: [], remove: [], signed: [], list: [] };
    const bucket = {
      upload: (path: string, bytes: Uint8Array, opts: unknown) => { calls.upload!.push([path, bytes.byteLength, opts]); return Promise.resolve({ error: null }); },
      createSignedUrl: (path: string, s: number) => { calls.signed!.push([path, s]); return Promise.resolve({ data: { signedUrl: "https://x/" + path }, error: null }); },
      remove: (paths: string[]) => { calls.remove!.push(paths); return Promise.resolve({ error: null }); },
      list: (folder: string) => { calls.list!.push(folder); return Promise.resolve({ data: [{ name: "a.png" }, { name: "b.pdf" }], error: null }); },
    };
    const client = { storage: { from: (b: string) => { expect(b).toBe("user-files"); return bucket; } } };
    return { client: client as unknown as ConstructorParameters<typeof SupabaseFileStore>[0], calls };
  };

  it("uploads under {uid}/{entity}/{uniq}-{name} with the content type, and signs reads once an hour", async () => {
    const { client, calls } = fake();
    const store = new SupabaseFileStore(client, "uid-9");
    const stored = await store.upload("ent", png());
    expect(stored.path.startsWith("uid-9/ent/")).toBe(true);
    expect(stored.path.endsWith("-shot_one.png")).toBe(true);
    expect(calls.upload![0]).toEqual([stored.path, 20, { contentType: "image/png", upsert: true }]);
    expect(await store.url(stored.path)).toBe("https://x/" + stored.path);
    expect(await store.url(stored.path)).toBe("https://x/" + stored.path);
    expect(calls.signed).toHaveLength(1);
  });
  it("gives two same-named uploads to the same entity different paths (B1-6)", async () => {
    const { client } = fake();
    const store = new SupabaseFileStore(client, "uid-9");
    const first = await store.upload("ent", png());
    const second = await store.upload("ent", png());
    expect(first.path).not.toBe(second.path);
  });

  it("sweeps a folder by listing it, and skips empty paths", async () => {
    const { client, calls } = fake();
    const store = new SupabaseFileStore(client, "uid-9");
    await store.remove(["", "uid-9/x/a.png"]);
    expect(calls.remove![0]).toEqual(["uid-9/x/a.png"]);
    await store.removeAll("ent");
    expect(calls.list![0]).toBe("uid-9/ent");
    expect(calls.remove![1]).toEqual(["uid-9/ent/a.png", "uid-9/ent/b.pdf"]);
  });
});
