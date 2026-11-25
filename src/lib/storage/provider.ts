/**
 * Storage-provider abstraction. Clinical records reference media by permanent UUID and a
 * media_storage_locations row — never by provider-specific paths — so Google Drive or
 * S3-compatible providers can be added later without restructuring the database.
 */
export type ProviderId = 'local_opfs' | 'google_drive' | 's3' | 'export';

export interface StoredFileInfo {
  path: string;
  size: number;
  sha256?: string;
}

export interface StorageStatus {
  provider: ProviderId;
  available: boolean;
  quota?: number | null;
  usage?: number | null;
  persisted?: boolean | null;
  note?: string;
}

export interface MediaStorageProvider {
  readonly id: ProviderId;
  /** Begin an incremental write (recording). */
  beginWrite(path: string): Promise<void>;
  appendChunk(path: string, chunk: ArrayBuffer, flush?: boolean): Promise<number>;
  finishWrite(path: string): Promise<StoredFileInfo>;
  abortWrite(path: string): Promise<void>;
  /** Save a whole Blob/File (photo, import, restore). */
  save(path: string, data: Blob | ArrayBuffer | string): Promise<StoredFileInfo>;
  retrieve(path: string): Promise<File | null>;
  verify(path: string, expected?: { size?: number | null; sha256?: string | null }): Promise<{ ok: boolean; size?: number; sha256?: string; reason?: string }>;
  list(prefix: string): Promise<StoredFileInfo[]>;
  exportFile(path: string): Promise<File | null>;
  /** Deletion requires administrator approval after verified archival — enforced by callers. */
  delete(path: string, approval: { approvedBy: string; verifiedArchive: boolean }): Promise<void>;
  status(): Promise<StorageStatus>;
}

/** Reserved for the Google Drive migration (planned). Intentionally not implemented in this MVP. */
export interface MigrationTarget {
  readonly id: Exclude<ProviderId, 'local_opfs' | 'export'>;
  upload(mediaId: string, file: File, folderPath: string, onProgress?: (sent: number) => void): Promise<{ cloudFileId: string; cloudPath: string }>;
  verifyRemote(cloudFileId: string, expected: { size: number; sha256: string }): Promise<boolean>;
}
