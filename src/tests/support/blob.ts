import type { BlobStore } from "@/lib/server/blob";

// Úložiště souborů v paměti místo Azure Blob Storage.
export class MemoryBlobStore implements BlobStore {
  readonly blobs = new Map<string, { data: Uint8Array; contentType: string }>();

  async put(key: string, data: Uint8Array, contentType: string) {
    this.blobs.set(key, { data, contentType });
  }

  async get(key: string) {
    const blob = this.blobs.get(key);
    if (!blob) return null;
    return { body: new Blob([new Uint8Array(blob.data)]).stream(), contentType: blob.contentType, contentLength: blob.data.byteLength };
  }

  async delete(key: string) {
    this.blobs.delete(key);
  }
}

export const memoryBlobStore = new MemoryBlobStore();
