import { Rpc } from "@opencode/plugin/rpc"

// ---------------------------------------------------------------------------
// Shared TypeScript views of the JSON Schema payloads below.
// ---------------------------------------------------------------------------

export interface FileStatus {
  path: string
  /** Porcelain XY index status, e.g. "M", "A", "R", "?" */
  index: string
  /** Porcelain XY worktree status, e.g. "M", "D", "?" */
  worktree: string
}

export interface StatusOut {
  isRepo: boolean
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  remotes: { name: string; url: string | null }[]
  files: FileStatus[]
  staged: number
  unstaged: number
  untracked: number
  merging: boolean
}

export interface BranchInfo {
  name: string
  current: boolean
  ahead: number
  behind: number
  remote: boolean
}

export interface BranchesOut {
  current: string | null
  local: BranchInfo[]
  remote: BranchInfo[]
}

export interface OperateOut {
  ok: boolean
  output: string
}

export interface CommitOut extends OperateOut {
  hash: string | null
}

export interface LogOut {
  commits: { hash: string; subject: string; author: string; when: string }[]
}

export interface DiffOut {
  ok: boolean
  path: string
  output: string
}

export interface CommitFile {
  path: string
  /** Name-status letter: A, M, D, R, T… */
  status: string
  /** Lines added; -1 = binary (git reports no line counts). */
  additions: number
  /** Lines removed; -1 = binary. */
  deletions: number
}

export interface ShowOut {
  /** Full 40-char hash. */
  hash: string
  subject: string
  author: string
  when: string
  files: CommitFile[]
}

// ---------------------------------------------------------------------------
// JSON Schema helpers
// ---------------------------------------------------------------------------

const str = { type: "string" }
const strOrNull = { type: ["string", "null"] }
const int = { type: "integer" }
const bool = { type: "boolean" }
const arr = (items: object) => ({ type: "array", items })
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})

const FILE_STATUS = obj({ path: str, index: str, worktree: str }, ["path", "index", "worktree"])
const REMOTE = obj({ name: str, url: strOrNull }, ["name"])
const BRANCH = obj(
  { name: str, current: bool, ahead: int, behind: int, remote: bool },
  ["name", "current", "ahead", "behind", "remote"],
)
const OPERATE = obj({ ok: bool, output: str }, ["ok", "output"])
const COMMIT = obj({ ok: bool, output: str, hash: strOrNull }, ["ok", "output"])
const LOG_ENTRY = obj({ hash: str, subject: str, author: str, when: str }, ["hash", "subject"])
const COMMIT_FILE = obj({ path: str, status: str, additions: int, deletions: int }, ["path", "status", "additions", "deletions"])

const ERRORS = {
  not_repo: obj({}),
  failed: obj({ message: str }, ["message"]),
}

// ---------------------------------------------------------------------------
// Contract: implemented by the server part, called by the TUI part (or any
// client via client.rpc(GitControl)).
//
// Every method accepts an optional `directory` so desktop GUIs (one window,
// many project locations) can pick the repository to act on. When omitted,
// the server resolves the caller's location.
// ---------------------------------------------------------------------------

const input = (properties: Record<string, unknown> = {}, required: string[] = []) =>
  obj({ directory: str, ...properties }, required)

export const GitControl = Rpc.define({
  id: "git-control",
  methods: {
    status: {
      input: input(),
      output: obj(
        {
          isRepo: bool,
          branch: strOrNull,
          upstream: strOrNull,
          ahead: int,
          behind: int,
          remotes: arr(REMOTE),
          files: arr(FILE_STATUS),
          staged: int,
          unstaged: int,
          untracked: int,
          merging: bool,
        },
        ["isRepo", "ahead", "behind", "remotes", "files", "staged", "unstaged", "untracked", "merging"],
      ),
    },
    branches: {
      input: input(),
      output: obj({ current: strOrNull, local: arr(BRANCH), remote: arr(BRANCH) }, ["local", "remote"]),
    },
    init: {
      input: input(),
      output: OPERATE,
      errors: ERRORS,
    },
    fetch: {
      input: input(),
      output: OPERATE,
      errors: ERRORS,
    },
    pull: {
      input: input({ strategy: { type: "string", enum: ["ff", "rebase", "merge"] } }, ["strategy"]),
      output: OPERATE,
      errors: ERRORS,
    },
    push: {
      input: input({ setUpstream: bool }, ["setUpstream"]),
      output: OPERATE,
      errors: ERRORS,
    },
    stage: {
      input: input({ paths: arr(str) }, ["paths"]),
      output: OPERATE,
      errors: ERRORS,
    },
    unstage: {
      input: input({ paths: arr(str) }, ["paths"]),
      output: OPERATE,
      errors: ERRORS,
    },
    commit: {
      input: input({ message: str, stageAll: bool }, ["message", "stageAll"]),
      output: COMMIT,
      errors: ERRORS,
    },
    checkout: {
      input: input({ name: str, create: bool, force: bool }, ["name", "create", "force"]),
      output: OPERATE,
      errors: ERRORS,
    },
    merge: {
      input: input({ branch: str }, ["branch"]),
      output: OPERATE,
      errors: ERRORS,
    },
    abort: {
      input: input(),
      output: OPERATE,
      errors: ERRORS,
    },
    log: {
      input: input({ limit: int }),
      output: obj({ commits: arr(LOG_ENTRY) }, ["commits"]),
      errors: ERRORS,
    },
    diff: {
      input: input({ path: str, hash: str }, ["path"]),
      output: obj({ ok: bool, path: str, output: str }, ["ok", "path", "output"]),
      errors: ERRORS,
    },
    show: {
      input: input({ hash: str }, ["hash"]),
      output: obj(
        { hash: str, subject: str, author: str, when: str, files: arr(COMMIT_FILE) },
        ["hash", "subject", "author", "when", "files"],
      ),
      errors: ERRORS,
    },
    revertCommit: {
      input: input({ hash: str }, ["hash"]),
      output: OPERATE,
      errors: ERRORS,
    },
    applyCommit: {
      input: input({ hash: str }, ["hash"]),
      output: OPERATE,
      errors: ERRORS,
    },
    checkoutFile: {
      input: input({ hash: str, path: str }, ["hash", "path"]),
      output: OPERATE,
      errors: ERRORS,
    },
  },
  events: {
    updated: { schema: obj({}) },
  },
})
