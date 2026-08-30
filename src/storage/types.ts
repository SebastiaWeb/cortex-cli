export interface RemoteFile {
  path: string;
  size: number;
  mtime?: number;
}

export interface IStorageBackend {
  readonly name: string;
  list(): Promise<RemoteFile[]>;
  has(path: string): Promise<boolean>;
  read(path: string): Promise<Buffer>;
  write(path: string, content: Buffer): Promise<void>;
  remove(path: string): Promise<void>;
  /** Batched write — backends that can (e.g. GitHub) commit the whole batch atomically. */
  writeMany(files: Array<{ path: string; content: Buffer }>): Promise<void>;
  /** Batched remove — see writeMany. */
  removeMany(paths: string[]): Promise<void>;
}
