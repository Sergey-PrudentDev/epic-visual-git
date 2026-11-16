import { spawn } from "node:child_process"
import type { BranchInfo, CommitOut, DiffOut, LogOut, OperateOut, ShowOut, StatusOut } from "./rpc.js"

export interface Run {
  code: number
  stdout: string
  stderr: string
}

/** Run git with args in cwd. No shell involved, so paths/paths with spaces are safe on Windows. */
export function git(cwd: string, args: string[], signal?: AbortSignal): Promise<Run> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", (d) => (stdout += String(d)))
    proc.stderr.on("data", (d) => (stderr += String(d)))
    const abort = () => proc.kill()
    if (signal) {
      if (signal.aborted) return proc.kill()
      signal.addEventListener("abort", abort, { once: true })
    }
    proc.on("error", (error) => {
      if (signal) signal.removeEventListener("abort", abort)
      reject(error)
    })
    proc.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", abort)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

export async function isRepo(cwd: string, signal?: AbortSignal): Promise<boolean> {
  const run = await git(cwd, ["rev-parse", "--is-inside-work-tree"], signal)
  return run.code === 0 && run.stdout.trim() === "true"
}

const TRACK = /\[ahead (\d+)(?:, behind (\d+))?\]|\[behind (\d+)\]/

/** Porcelain XY codes that mean "unmerged / conflicted". */
function isUnmerged(file: { index: string; worktree: string }): boolean {
  return (
    file.index === "U" ||
    file.worktree === "U" ||
    (file.index === "A" && file.worktree === "A") ||
    (file.index === "D" && file.worktree === "D")
  )
}

export async function readStatus(cwd: string, signal?: AbortSignal): Promise<StatusOut> {
  const run = await git(cwd, ["status", "--porcelain=v1", "--branch", "--untracked-files=normal"], signal)
  if (run.code !== 0) throw new Error(run.stderr.trim() || "git status failed")

  let branch: string | null = null
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  const files: StatusOut["files"] = []

  for (const line of run.stdout.split(/\r?\n/)) {
    if (!line) continue
    if (line.startsWith("## ")) {
      // An unborn branch reports "## No commits yet on master" — unwrap it so the
      // real branch name (master/main) shows right after `git init`.
      const header = line.slice(3).replace(/^No commits yet on /, "")
      const detached = header === "HEAD (no branch)" || header.startsWith("HEAD (detached") || header.startsWith("(no branch")
      if (!detached) {
        const dots = header.indexOf("...")
        branch = dots === -1 ? header.replace(/ .*/, "") : header.slice(0, dots)
        if (dots !== -1) upstream = header.slice(dots + 3).replace(/ .*/, "") || null
      }
      const track = TRACK.exec(header)
      if (track) {
        ahead = Number(track[1] ?? 0)
        behind = Number(track[2] ?? track[3] ?? 0)
      }
      continue
    }
    const index = line[0] ?? " "
    const worktree = line[1] ?? " "
    let path = line.slice(3)
    const arrow = path.indexOf(" -> ")
    if (arrow !== -1) path = path.slice(arrow + 4)
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1)
    files.push({ path, index: index === " " ? "" : index, worktree: worktree === " " ? "" : worktree })
  }

  const remotesRun = await git(cwd, ["remote", "-v"], signal)
  const remotes = new Map<string, string | null>()
  for (const line of remotesRun.stdout.split(/\r?\n/)) {
    const match = /^(.+?)\s+(\S+)\s+\(fetch\)$/.exec(line)
    if (match) remotes.set(match[1], match[2])
  }

  const refsActive = (
    await Promise.all(
      ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"].map((ref) =>
        git(cwd, ["rev-parse", "-q", "--verify", ref], signal),
      ),
    )
  ).some((run) => run.code === 0)
  // cherry-pick -n conflicts leave no refs behind — unmerged files are the only trace.
  const merging = refsActive || files.some(isUnmerged)

  return {
    isRepo: true,
    branch,
    upstream,
    ahead,
    behind,
    remotes: [...remotes.entries()].map(([name, url]) => ({ name, url })),
    files,
    staged: files.filter((f) => f.index !== "" && f.index !== "?").length,
    unstaged: files.filter((f) => f.worktree !== "" && f.worktree !== "?").length,
    untracked: files.filter((f) => f.index === "?" || f.worktree === "?").length,
    merging,
  }
}

function trackCounts(track: string): { ahead: number; behind: number } {
  const match = TRACK.exec(track)
  if (!match) return { ahead: 0, behind: 0 }
  return { ahead: Number(match[1] ?? 0), behind: Number(match[2] ?? match[3] ?? 0) }
}

export async function readBranches(cwd: string, signal?: AbortSignal): Promise<{ current: string | null; local: BranchInfo[]; remote: BranchInfo[] }> {
  const localRun = await git(
    cwd,
    ["for-each-ref", "refs/heads/", "--format=%(refname:short)%09%(HEAD)%09%(upstream:track)"],
    signal,
  )
  const local: BranchInfo[] = []
  let current: string | null = null
  for (const line of localRun.stdout.split(/\r?\n/)) {
    if (!line) continue
    const [name, head, track = ""] = line.split("\t")
    const { ahead, behind } = trackCounts(track)
    if (head === "*") current = name
    local.push({ name, current: head === "*", ahead, behind, remote: false })
  }

  const remoteRun = await git(cwd, ["for-each-ref", "refs/remotes/", "--format=%(refname:short)"], signal)
  const remote: BranchInfo[] = []
  for (const line of remoteRun.stdout.split(/\r?\n/)) {
    if (!line || line.endsWith("/HEAD")) continue
    remote.push({ name: line, current: false, ahead: 0, behind: 0, remote: true })
  }

  return { current, local, remote }
}

export async function readLog(cwd: string, limit: number, signal?: AbortSignal): Promise<LogOut> {
  const run = await git(
    cwd,
    ["log", `-n${Math.max(1, Math.min(100, limit))}`, "--date=relative", "--format=%h%x09%s%x09%an%x09%ad"],
    signal,
  )
  if (run.code !== 0) return { commits: [] }
  const commits = run.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash, subject, author, when] = line.split("\t")
      return { hash, subject, author: author ?? "", when: when ?? "" }
    })
  return { commits }
}

async function operate(cwd: string, args: string[], signal?: AbortSignal): Promise<OperateOut> {
  const run = await git(cwd, args, signal)
  const output = (run.stdout + "\n" + run.stderr).trim()
  return { ok: run.code === 0, output }
}

export async function fetchAll(cwd: string, signal?: AbortSignal): Promise<OperateOut> {
  return operate(cwd, ["fetch", "--all", "--prune", "--tags", "--progress"], signal)
}

export async function pull(cwd: string, strategy: "ff" | "rebase" | "merge", signal?: AbortSignal): Promise<OperateOut> {
  const flag = strategy === "ff" ? "--ff-only" : strategy === "rebase" ? "--rebase" : "--no-rebase"
  const args = strategy === "merge" ? ["pull", flag, "--no-edit"] : ["pull", flag]
  return operate(cwd, args, signal)
}

export async function push(cwd: string, setUpstream: boolean, signal?: AbortSignal): Promise<OperateOut> {
  const status = await readStatus(cwd, signal)
  if (!status.branch) return { ok: false, output: "Detached HEAD — checkout a branch before pushing." }
  const hasUpstream = (await git(cwd, ["rev-parse", "-q", "--verify", "@{upstream}"], signal)).code === 0
  const args = hasUpstream && !setUpstream ? ["push"] : ["push", "-u", "origin", status.branch]
  return operate(cwd, args, signal)
}

/** Create a repository in a folder that isn't one yet (git init). Non-destructive. */
export async function initRepo(cwd: string, signal?: AbortSignal): Promise<OperateOut> {
  if (await isRepo(cwd, signal)) return { ok: false, output: "already a git repository" }
  const run = await git(cwd, ["init", "-q"], signal)
  return {
    ok: run.code === 0,
    output:
      run.code === 0
        ? "repository initialised — files untouched, nothing leaves this machine until you add a remote and push"
        : (run.stdout + "\n" + run.stderr).trim(),
  }
}

export async function stage(cwd: string, paths: string[], signal?: AbortSignal): Promise<OperateOut> {

  if (paths.length === 0) return operate(cwd, ["add", "-A"], signal)
  return operate(cwd, ["add", "--", ...paths], signal)
}

export async function unstage(cwd: string, paths: string[], signal?: AbortSignal): Promise<OperateOut> {
  if (paths.length === 0) return operate(cwd, ["restore", "--staged", "."], signal)
  return operate(cwd, ["restore", "--staged", "--", ...paths], signal)
}

export async function commit(cwd: string, message: string, stageAll: boolean, signal?: AbortSignal): Promise<CommitOut> {
  if (stageAll) {
    const added = await git(cwd, ["add", "-A"], signal)
    if (added.code !== 0) return { ok: false, output: added.stderr.trim(), hash: null }
  }
  const run = await git(cwd, ["commit", "-m", message], signal)
  const output = (run.stdout + "\n" + run.stderr).trim()
  if (run.code !== 0) return { ok: false, output, hash: null }
  const hash = (await git(cwd, ["rev-parse", "--short", "HEAD"], signal)).stdout.trim()
  return { ok: true, output, hash: hash || null }
}

export async function checkout(
  cwd: string,
  name: string,
  create: boolean,
  force: boolean,
  signal?: AbortSignal,
): Promise<OperateOut> {
  if (create) {
    const args = ["switch", "-c", name]
    if (force) args.push("--discard-changes")
    const run = await git(cwd, args, signal)
    return { ok: run.code === 0, output: (run.stdout + "\n" + run.stderr).trim() }
  }

  // Never pass a remote-tracking name (origin/x) straight to switch: that detaches HEAD.
  const slash = name.indexOf("/")
  const stripped = slash !== -1 ? name.slice(slash + 1) : name
  const hasLocal = async (branch: string) =>
    (await git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], signal)).code === 0

  const attempts: string[][] = []
  if (await hasLocal(name)) {
    attempts.push(["switch", name])
  } else if (slash !== -1 && (await hasLocal(stripped))) {
    attempts.push(["switch", stripped]) // caller asked for "origin/x", local "x" already exists
  } else {
    // Remote-only branch: create a local branch tracking a matching remote ref.
    const remoteRun = await git(cwd, ["for-each-ref", "refs/remotes/", "--format=%(refname:short)"], signal)
    const refs = remoteRun.stdout.split(/\r?\n/).filter((ref) => ref && !ref.endsWith("/HEAD"))
    // "origin/x" given explicitly: track that exact ref, branch name drops the remote segment.
    const byExact = slash !== -1 ? refs.find((ref) => ref === name) : undefined
    // "x" or "feature/x" given: any remote ref ending with that branch path tracks it.
    const bySuffix = refs.find((ref) => ref.endsWith("/" + name))
    if (byExact) attempts.push(["switch", "-c", stripped, "--track", byExact])
    else if (bySuffix) attempts.push(["switch", "-c", name, "--track", bySuffix])
    else attempts.push(["switch", name]) // unknown ref: let git's own DWIM / error message answer
  }

  for (let i = 0; i < attempts.length; i++) {
    const args = force ? [...attempts[i], "--discard-changes"] : attempts[i]
    const run = await git(cwd, args, signal)
    const isLast = i === attempts.length - 1
    if (run.code === 0 || isLast || force) {
      return { ok: run.code === 0, output: (run.stdout + "\n" + run.stderr).trim() }
    }
  }
  return { ok: false, output: "git switch failed" }
}

/**
 * Unified diff for one file vs HEAD (covers staged and unstaged changes).
 * Untracked files have no HEAD entry, so diff them against the null device
 * to render every line as added.
 */
export async function readDiff(cwd: string, path: string, signal?: AbortSignal, hash?: string): Promise<DiffOut> {
  if (hash) {
    const parent = await git(cwd, ["rev-parse", "--verify", "--quiet", `${hash}^`], signal)
    const from = parent.code === 0 ? parent.stdout.trim() : EMPTY_TREE
    const to = (await git(cwd, ["rev-parse", "--verify", "--quiet", `${hash}^{commit}`], signal)).stdout.trim()
    if (!to) throw new Error(`unknown commit: ${hash}`)
    const run = await git(cwd, ["diff", "-U3", "--end-of-options", from, to, "--", path], signal)
    let output = run.stdout.trim()
    if (run.code !== 0 || !output)
      output = (run.stderr || "").trim() || (await commitDiff(cwd, path, hash, signal))
    if (output.length > 400_000) output = output.slice(0, 400_000) + "\n… diff truncated …"
    return { ok: run.code === 0, path, output }
  }
  const st = await git(cwd, ["status", "--porcelain=v1", "--untracked-files=normal", "--", path], signal)
  const untracked = st.stdout.slice(0, 2) === "??"
  const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null"
  const args = untracked
    ? ["diff", "--no-index", "--", nullDevice, path]
    : ["diff", "-U3", "--end-of-options", "HEAD", "--", path]
  const run = await git(cwd, args, signal)
  // --no-index exits 1 when files differ, which is success for our purposes.
  const ok = run.code === 0 || run.code === 1
  let output = (run.stdout || run.stderr).trim()
  const budget = 400_000
  if (output.length > budget) output = output.slice(0, budget) + "\n… diff truncated …"
  return { ok, path, output }
}

export async function merge(cwd: string, branch: string, signal?: AbortSignal): Promise<OperateOut> {
  const run = await git(cwd, ["merge", "--no-edit", branch], signal)
  return { ok: run.code === 0, output: (run.stdout + "\n" + run.stderr).trim() }
}

/**
 * Cancel an in-progress merge and restore the working tree to its pre-merge
 * state. Refuses when no merge is running so the caller gets a clear message.
 */
/**
 * Cancel an in-progress merge, cherry-pick or revert and restore the working
 * tree to its pre-operation state. Refuses when nothing is running.
 */
export async function abortMerge(cwd: string, signal?: AbortSignal): Promise<OperateOut> {
  for (const [ref, command] of [
    ["MERGE_HEAD", "merge"],
    ["CHERRY_PICK_HEAD", "cherry-pick"],
    ["REVERT_HEAD", "revert"],
  ] as const) {
    const active = (await git(cwd, ["rev-parse", "-q", "--verify", ref], signal)).code === 0
    if (!active) continue
    const run = await git(cwd, [command, "--abort"], signal)
    return { ok: run.code === 0, output: (run.stdout + "\n" + run.stderr).trim() || `${command} aborted` }
  }
  // No sequencer ref: the only possible operation is a conflicted `cherry-pick -n`
  // (apply), which leaves unmerged files as its sole trace. Undo by resetting the
  // index back to HEAD and restoring the conflicted files from it.
  const st = await git(cwd, ["status", "--porcelain=v1", "--untracked-files=no"], signal)
  const conflicted: string[] = []
  for (const line of st.stdout.split(/\r?\n/)) {
    if (!line) continue
    const file = { index: line[0] === " " ? "" : line[0], worktree: line[1] === " " ? "" : line[1] }
    if (!isUnmerged(file)) continue
    let path = line.slice(3)
    const arrow = path.indexOf(" -> ")
    if (arrow !== -1) path = path.slice(arrow + 4)
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1)
    conflicted.push(path)
  }
  if (conflicted.length === 0) return { ok: false, output: "no merge in progress — nothing to abort" }
  await git(cwd, ["reset", "-q"], signal)
  const restore = await git(cwd, ["restore", "--", ...conflicted], signal)
  return {
    ok: restore.code === 0,
    output: restore.code === 0 ? "conflicts discarded — working tree restored" : (restore.stdout + "\n" + restore.stderr).trim(),
  }
}

// ---------------------------------------------------------------------------
// Commit details & revert
// ---------------------------------------------------------------------------

const HEX = /^[0-9a-fA-F]{4,40}$/

/** Git's canonical empty-tree hash — diff base for root commits. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

/**
 * Combined diff of a file brought in by a merge commit (git show --cc).
 * `git diff <first-parent> <merge>` is empty for such files, so fall back here.
 */
async function commitDiff(cwd: string, path: string, hash: string, signal?: AbortSignal): Promise<string> {
  const full = (await git(cwd, ["rev-parse", "--verify", "--quiet", `${hash}^{commit}`], signal)).stdout.trim()
  if (!full) return ""
  const run = await git(cwd, ["show", "--format=", "--cc", "-U3", "--end-of-options", full, "--", path], signal)
  return run.stdout.trim()
}

/**
 * Files touched by a commit with added/removed line counts.
 * Merge commits diff against their first parent (what the merge brought in).
 * Binary files report additions = -1 (git gives no line counts).
 */
export async function readCommit(cwd: string, hash: string, signal?: AbortSignal): Promise<ShowOut> {
  const verify = await git(cwd, ["rev-parse", "--verify", "--quiet", `${hash}^{commit}`], signal)
  if (verify.code !== 0) throw new Error(`unknown commit: ${hash}`)
  const full = verify.stdout.trim()

  const header = await git(cwd, ["show", "--no-patch", `--format=%an%x1f%aI%x1f%s`, full], signal)
  const [author = "", when = "", ...subjectParts] = header.stdout.trimEnd().split("\x1f")
  const subject = subjectParts.join("\x1f")

  const parents = await git(cwd, ["rev-list", "--parents", "-n", "1", full], signal)
  const isMerge = parents.stdout.trim().split(/\s+/).length > 2
  const range = isMerge ? [`${full}^1`, full] : []

  const numstat = await git(
    cwd,
    isMerge ? ["diff", "--numstat", "--no-color", ...range] : ["show", "--numstat", "--format=", "--no-color", full],
    signal,
  )
  const namestat = await git(
    cwd,
    isMerge ? ["diff", "--name-status", "--no-color", ...range] : ["show", "--name-status", "--format=", "--no-color", full],
    signal,
  )

  const stats = numstat.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [adds, dels, ...rest] = line.split("\t")
      const binary = adds === "-" || dels === "-"
      return {
        path: rest.join("\t"), // rename display like old => new stays intact
        additions: binary ? -1 : Number(adds) || 0,
        deletions: binary ? -1 : Number(dels) || 0,
      }
    })

  const statuses = namestat.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => (line[0] ?? "?").toUpperCase())

  const files = stats.map((stat, i) => ({ ...stat, status: statuses[i] ?? "M" }))
  return { hash: full, subject, author, when, files }
}

/**
 * Undo a whole commit by creating a new commit that reverses it
 * (git revert — history is never rewritten). Requires a clean working tree.
 */
export async function revertCommit(cwd: string, hash: string, signal?: AbortSignal): Promise<OperateOut> {
  if (!HEX.test(hash)) return { ok: false, output: "invalid commit hash" }
  const dirty = await git(cwd, ["status", "--porcelain=v1", "--untracked-files=no"], signal)
  if (dirty.stdout.trim())
    return { ok: false, output: "working tree has uncommitted changes — commit or stash them before reverting" }
  const verify = await git(cwd, ["rev-parse", "--verify", "--quiet", `${hash}^{commit}`], signal)
  if (verify.code !== 0) return { ok: false, output: `unknown commit: ${hash}` }
  const full = verify.stdout.trim()
  const parents = await git(cwd, ["rev-list", "--parents", "-n", "1", full], signal)
  const args =
    parents.stdout.trim().split(/\s+/).length > 2
      ? ["revert", "--no-edit", "-m", "1", full] // merge commit: revert the merge itself
      : ["revert", "--no-edit", full]
  return operate(cwd, args, signal)
}

/**
 * Apply one commit's changes onto the *current* branch without committing
 * anything (git cherry-pick -n): the result shows up as pending changes in
 * the working tree, ready to diff, adjust, or commit yourself. Merge commits
 * apply the changes the merge itself brought in (-m 1).
 */
export async function applyCommit(cwd: string, hash: string, signal?: AbortSignal): Promise<OperateOut> {
  if (!HEX.test(hash)) return { ok: false, output: "invalid commit hash" }
  const dirty = await git(cwd, ["status", "--porcelain=v1", "--untracked-files=no"], signal)
  if (dirty.stdout.trim())
    return { ok: false, output: "working tree has uncommitted changes — commit or stash them before applying" }
  const verify = await git(cwd, ["rev-parse", "--verify", "--quiet", `${hash}^{commit}`], signal)
  if (verify.code !== 0) return { ok: false, output: `unknown commit: ${hash}` }
  const full = verify.stdout.trim()
  const parents = await git(cwd, ["rev-list", "--parents", "-n", "1", full], signal)
  const args =
    parents.stdout.trim().split(/\s+/).length > 2
      ? ["cherry-pick", "-n", "-m", "1", full]
      : ["cherry-pick", "-n", full]
  const result = await operate(cwd, args, signal)
  if (!result.ok && /CONFLICT/.test(result.output))
    result.output += "\nFix the conflicted files and commit, or press Abort to discard the whole apply."
  return result
}

/**
 * Checkout one file from a given commit into the working tree as a pending
 * change (git restore --source=<commit>) — nothing is committed, so the diff
 * shows up in the Changes list. Refuses while the file has uncommitted
 * changes, so nothing you were working on can be silently overwritten.
 */
export async function checkoutFile(cwd: string, hash: string, path: string, signal?: AbortSignal): Promise<OperateOut> {
  if (!HEX.test(hash)) return { ok: false, output: "invalid commit hash" }
  const dirty = await git(cwd, ["status", "--porcelain=v1", "--", path], signal)
  if (dirty.stdout.trim())
    return { ok: false, output: `${path} has uncommitted changes — commit or stash them first` }
  const verify = await git(cwd, ["rev-parse", "--verify", "--quiet", `${hash}^{commit}`], signal)
  if (verify.code !== 0) return { ok: false, output: `unknown commit: ${hash}` }
  const full = verify.stdout.trim()
  const exists = await git(cwd, ["cat-file", "-e", `${full}:${path}`], signal)
  if (exists.code !== 0) return { ok: false, output: `${path} does not exist in commit ${full.slice(0, 8)}` }
  return operate(cwd, ["restore", `--source=${full}`, "--", path], signal)
}
