// Storage seam for print files.
//
// The validator inspects bytes; persistence is a separate concern. This is the
// single interface the rest of the system talks to. A VercelBlobStore is the
// real backend; tests construct StubPrintFileStore DIRECTLY so they never touch
// real Blob.
//
// Two ingestion shapes both flow through this seam:
//   • put()  — server-side ingestion: the server already holds the bytes and
//     hands them off (used by the buffer-based uploadPlacement path / tests).
//   • head() + readBytes() — client-upload ingestion: the BROWSER uploaded
//     straight to Blob with a signed token (no 200MB buffered through a
//     function), then the server reads the stored bytes BACK to validate them.
//     head() with our own credentials only resolves blobs WE wrote, so it
//     doubles as the storage-ownership check that rejects a spoofed/foreign URL.
//
// SEAM: app code calls getPrintFileStore() (→ VercelBlobStore in this phase).

import {
  put,
  head as blobHead,
  issueSignedToken,
  presignUrl,
  BlobNotFoundError,
} from "@vercel/blob";

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

// Authoritative metadata for an already-stored blob — read from STORAGE, never
// from a client claim. Null means "not a blob in this store" (reject the URL).
export type StoredPrintFileHead = {
  url: string;
  size: number;
  contentType: string | null;
};

export interface PrintFileStore {
  /** Server-side ingestion: persist bytes the server is holding. */
  put(file: PrintFilePut): Promise<StoredPrintFile>;
  /** Authoritative metadata for a stored blob, or null if the URL is not a blob
   * in THIS store (used to reject a spoofed/foreign URL in the finalize path). */
  head(url: string): Promise<StoredPrintFileHead | null>;
  /** The ACTUAL stored bytes, for server-side validation (never client claims). */
  readBytes(url: string): Promise<Buffer>;
  /** A short-lived, CDN-direct URL that grants read access to a SINGLE stored
   * blob without exposing our credentials. The store is private (merchant design
   * IP is commercially sensitive), so the raw blob URL 403s; a caller that has
   * already verified ownership mints one of these to let the browser fetch the
   * file directly from the CDN. Never hand out the raw URL. */
  signedReadUrl(url: string, ttlSeconds?: number): Promise<string>;
}

// In-memory stub. Unlike a metadata-only mock it RETAINS the bytes, so the
// client-upload finalize path (head + readBytes) is exercisable without real
// Blob. Deterministic keys (filename-derived) keep tests stable — no Date/random.
export class StubPrintFileStore implements PrintFileStore {
  private records = new Map<string, StoredPrintFile>(); // by key
  private byUrl = new Map<string, { record: StoredPrintFile; buffer: Buffer }>();

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
    this.byUrl.set(record.url, { record, buffer: file.buffer });
    return record;
  }

  async head(url: string): Promise<StoredPrintFileHead | null> {
    const hit = this.byUrl.get(url);
    if (!hit) return null;
    return {
      url: hit.record.url,
      size: hit.record.bytes,
      contentType: hit.record.contentType,
    };
  }

  async readBytes(url: string): Promise<Buffer> {
    const hit = this.byUrl.get(url);
    if (!hit) throw new Error(`StubPrintFileStore: no bytes for ${url}`);
    return hit.buffer;
  }

  // No real signing in the stub — tests never render the link. Echo the stored
  // URL back (and confirm it's one we hold) so the contract is exercisable.
  async signedReadUrl(url: string): Promise<string> {
    if (!this.byUrl.has(url)) throw new Error(`StubPrintFileStore: no blob for ${url}`);
    return url;
  }

  // Test/inspection helper — not part of the persistence contract.
  get(key: string): StoredPrintFile | undefined {
    return this.records.get(key);
  }
}

// Real persistence on Vercel Blob. The bytes are uploaded to Blob storage and
// the returned `url` is the Blob URL written to DesignPlacement.print_file_url.
// Auth is BLOB_READ_WRITE_TOKEN (server-only).
//
// The store is PRIVATE: print files are merchants' commercial design IP in a
// multi-tenant platform, so — like wholesale costs and printer identity
// elsewhere in this build — they must not be world-readable by anyone who gets
// a URL. Consequences of private access:
//   • every write uses access:"private";
//   • the raw blob URL 403s to an unauthenticated GET, so readBytes() must send
//     our Bearer token, and any browser-facing read goes through signedReadUrl()
//     (a short-lived, ownership-gated, CDN-direct URL) — never the raw URL.
//
// addRandomSuffix keeps each upload at a unique URL, so a re-upload over a
// FLAGGED placement gets a fresh URL (the DesignPlacement row is updated to
// point at it); the previous blob is simply left orphaned — cleanup of orphans
// is a later concern, not part of this slice.
export class VercelBlobStore implements PrintFileStore {
  private readonly token: string | undefined;

  constructor(token: string | undefined = process.env.BLOB_READ_WRITE_TOKEN) {
    this.token = token;
  }

  async put(file: PrintFilePut): Promise<StoredPrintFile> {
    if (!this.token) {
      throw new Error(
        "BLOB_READ_WRITE_TOKEN is not set — cannot upload print files to Vercel Blob."
      );
    }
    const safeName = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const pathname = `print-files/${safeName}`;
    const blob = await put(pathname, file.buffer, {
      access: "private",
      contentType: file.contentType,
      addRandomSuffix: true,
      token: this.token,
    });
    return {
      url: blob.url,
      key: blob.pathname,
      bytes: file.buffer.length,
      contentType: file.contentType,
    };
  }

  // Resolve a URL against OUR store. Returns null for a URL that isn't a blob we
  // wrote (head() is authenticated with our token), which is what lets the
  // finalize path reject a spoofed/foreign URL before trusting it.
  async head(url: string): Promise<StoredPrintFileHead | null> {
    if (!this.token) {
      throw new Error(
        "BLOB_READ_WRITE_TOKEN is not set — cannot read print files from Vercel Blob."
      );
    }
    try {
      const h = await blobHead(url, { token: this.token });
      return { url: h.url, size: h.size, contentType: h.contentType ?? null };
    } catch (e) {
      if (e instanceof BlobNotFoundError) return null;
      throw e;
    }
  }

  // Read the ACTUAL stored bytes back so validation runs against what's in
  // storage, never a client-claimed payload. The store is private, so the raw
  // URL 403s to an anonymous GET — we authenticate with our Bearer token.
  async readBytes(url: string): Promise<Buffer> {
    if (!this.token) {
      throw new Error(
        "BLOB_READ_WRITE_TOKEN is not set — cannot read print files from Vercel Blob."
      );
    }
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to read print file from Blob (${res.status}): ${url}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  // Mint a short-lived, CDN-direct GET URL scoped to THIS blob's exact pathname.
  // issueSignedToken delegates a get-only, time-boxed grant; presignUrl signs a
  // concrete URL the CDN verifies without our token ever leaving the server. The
  // caller is responsible for the ownership check BEFORE calling this — a signed
  // URL is bearer authority for whoever holds it until it expires.
  async signedReadUrl(url: string, ttlSeconds = 300): Promise<string> {
    if (!this.token) {
      throw new Error(
        "BLOB_READ_WRITE_TOKEN is not set — cannot sign print file URLs."
      );
    }
    // The pathname (incl. addRandomSuffix) is the path segment of the blob URL.
    const pathname = decodeURIComponent(new URL(url).pathname).replace(/^\//, "");
    const validUntil = Date.now() + ttlSeconds * 1000;
    const issued = await issueSignedToken({
      token: this.token,
      pathname,
      operations: ["get"],
      validUntil,
    });
    const { presignedUrl } = await presignUrl(issued, {
      operation: "get",
      pathname,
      access: "private",
      validUntil,
    });
    return presignedUrl;
  }
}

// App-facing factory. Returns the real Blob-backed store. Tests must NOT call
// this — they construct StubPrintFileStore directly so no test ever hits Blob.
export function getPrintFileStore(): PrintFileStore {
  return new VercelBlobStore();
}
