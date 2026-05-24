export interface McpServerDefinition {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface InitTtyLike {
  isTTY?: boolean;
}

export interface InitCommandOptions {
  profile: string;
  interactiveSetup?: boolean;
  importUserSkills?: boolean;
  localUser?: boolean;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  stdin?: InitTtyLike;
  stdout?: InitTtyLike;
  argv?: string[];
  promptGitHubStar?: (repoUrl: string) => Promise<boolean>;
  starRepo?: (repoUrl: string) => Promise<void> | void;
  promptLocalUserRuntime?: (context: { homeDir: string }) => Promise<boolean>;
  promptDeepSeekSetup?: () => Promise<boolean>;
  promptDeepSeekApiKey?: () => Promise<string>;
}

export interface CopyTemplateDirOptions {
  skipEntry?: (srcPath: string, entry: import("node:fs").Dirent) => boolean | Promise<boolean>;
}

export interface SkillCopyStats {
  copied: number;
  skippedUnsafe: number;
  skippedUnavailable: number;
}

export type RuntimeScope = "all" | "project";
