import "server-only";
import { Readable } from "node:stream";
import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient, RestError, type ContainerClient } from "@azure/storage-blob";
import { blobEnv } from "@/lib/server/env";

// Soubory pacientů (fotky, PDF, podpisy, hlasovky) v privátním kontejneru Azure Blob Storage.
// Ven jdou jen přes API, které ověří oprávnění. Klíč blobu neobsahuje osobní údaje.
// Přihlášení: connection string (lokálně), nebo URL účtu + managed identity (v Azure, role Storage Blob Data Contributor).

export type StoredBlob = { body: ReadableStream<Uint8Array>; contentType: string; contentLength?: number };

export interface BlobStore {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredBlob | null>;
  delete(key: string): Promise<void>;
}

class AzureBlobStore implements BlobStore {
  constructor(private readonly container: ContainerClient) {}

  async put(key: string, data: Uint8Array, contentType: string) {
    // ifNoneMatch "*": existující blob se nikdy nepřepíše.
    await this.container.getBlockBlobClient(key).uploadData(data, {
      blobHTTPHeaders: { blobContentType: contentType },
      conditions: { ifNoneMatch: "*" },
    });
  }

  async get(key: string): Promise<StoredBlob | null> {
    try {
      const res = await this.container.getBlobClient(key).download();
      if (!res.readableStreamBody) return null;
      return {
        body: Readable.toWeb(res.readableStreamBody as Readable) as ReadableStream<Uint8Array>,
        contentType: res.contentType ?? "application/octet-stream",
        contentLength: res.contentLength,
      };
    } catch (error) {
      if (error instanceof RestError && error.statusCode === 404) return null;
      throw error;
    }
  }

  async delete(key: string) {
    await this.container.getBlobClient(key).deleteIfExists();
  }
}

let store: BlobStore | undefined;

export function getBlobStore(): BlobStore {
  if (!store) {
    const env = blobEnv();
    // SDK opakuje dočasné chyby s exponenciálním čekáním; tady jen meze.
    const options = { retryOptions: { maxTries: 4, tryTimeoutInMs: 60_000 } };
    const service = env.AZURE_STORAGE_CONNECTION_STRING
      ? BlobServiceClient.fromConnectionString(env.AZURE_STORAGE_CONNECTION_STRING, options)
      : new BlobServiceClient(env.AZURE_STORAGE_ACCOUNT_URL!, new DefaultAzureCredential(), options);
    store = new AzureBlobStore(service.getContainerClient(env.AZURE_STORAGE_CONTAINER));
  }
  return store;
}
