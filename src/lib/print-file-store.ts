// Storage seam for print files.
//
// The validator inspects bytes; persistence is a separate concern. This is the
// single interface the rest of the system talks to. Today it's a stub that
// records a reference + metadata WITHOUT persisting bytes anywhere. When we're
// ready, a VercelBlobStore implements this same interface and nothing else in
// the design pipeline changes.
//
// SEAM: swap StubPrintFileStore → VercelBlobStore here. Do NOT wire Vercel Blob
// in this phase.

export type PrintFilePut = {
  buffer: Buffer;
  filename: string;
  contentType: string;
};

export type StoredPrintFile = {
  // The reference written to DesignPlacement.print_file_url. With the stub this
  // is a "stub://" URI; with Vercel Blob it becomes the real public/blob URL.
  url: string;
  key: string; // opaque storage key
  bytes: number;
  contentType: string;
};

export interface PrintFileStore {
  put(file: PrintFilePut): Promise<StoredPrintFile>;
}

// In-memory, no-persistence stub. Holds metadata only; the bytes are dropped.
// Deterministic keys (filename-derived) keep tests stable — no Date/random.
export class StubPrintFileStore implements PrintFileStore {
  private records = new Map<string, StoredPrintFile>();

  async put(file: PrintFilePut): Promise<StoredPrintFile> {
    const safeName = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `print-files/${safeName}`;
    const record: StoredPrintFile = {
      url: `stub://${key}`,
      key,
      bytes: file.buffer.length,
      contentType: file.contentType,
    };
    this.records.set(key, record);
    return record;
  }

  // Test/inspection helper — not part of the persistence contract.
  get(key: string): StoredPrintFile | undefined {
    return this.records.get(key);
  }
}
