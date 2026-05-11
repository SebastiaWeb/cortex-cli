export type SupportedTool = 'claude-code' | 'antigravity' | 'cursor';

export interface FileEntry {
  relativePath: string;
  content: Buffer;
  mode?: number;
}

export interface IToolAdapter {
  readonly tool: SupportedTool;
  getFiles(): AsyncIterable<FileEntry>;
  putFiles(files: AsyncIterable<FileEntry>): Promise<void>;
  getProjectPath(projectId: string): string | null;
}
