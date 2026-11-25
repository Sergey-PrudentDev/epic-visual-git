import { Plugin } from "@opencode/plugin"
import { GitControl } from "./rpc.js"
import * as g from "./git.js"

type HandlerContext = {
  signal: AbortSignal
  error: (type: string, message: string, data?: unknown) => never
  location?: { directory?: string }
}

type AnyInput = { directory?: string }

export default Plugin.define({
  id: "prudentdev.git-control",
  async setup(ctx) {
    let registration: Awaited<ReturnType<typeof ctx.rpc.register>> | undefined

    // Precedence: explicit input.directory (desktop GUI, multi-project windows)
    // > the location the call was routed to > this plugin instance's location.
    const dir = (input: AnyInput | undefined, context: HandlerContext) =>
      input?.directory || context.location?.directory || ctx.location.directory

    const emitUpdated = async () => {
      try {
        await registration?.events.emit("updated", {})
      } catch {
        // plugin unloading; nothing to notify
      }
    }

    const guard = async <T>(input: AnyInput | undefined, context: HandlerContext, fn: () => Promise<T>): Promise<T> => {
      if (!(await g.isRepo(dir(input, context), context.signal))) {
        return context.error("not_repo", `${dir(input, context)} is not a git repository`)
      }
      return fn()
    }

    const mutate = async <T extends { ok: boolean }>(
      input: AnyInput | undefined,
      context: HandlerContext,
      fn: () => Promise<T>,
    ): Promise<T> =>
      guard(input, context, async () => {
        const result = await fn()
        await emitUpdated()
        return result
      })

    registration = await ctx.rpc.register(GitControl, {
      status: async (input, context) => {
        const c = context as HandlerContext
        const cwd = dir(input as AnyInput, c)
        if (!(await g.isRepo(cwd, c.signal))) {
          return {
            isRepo: false,
            branch: null,
            upstream: null,
            ahead: 0,
            behind: 0,
            remotes: [],
            files: [],
            staged: 0,
            unstaged: 0,
            untracked: 0,
            merging: false,
          }
        }
        return g.readStatus(cwd, c.signal)
      },

      branches: async (input, context) => {
        const c = context as HandlerContext
        return guard(input as AnyInput, c, () => g.readBranches(dir(input as AnyInput, c), c.signal))
      },

      // Not wrapped in guard() by design: this is the one method that works
      // outside a repository — it creates one.
      init: async (input, context) => {
        const c = context as HandlerContext
        const result = await g.initRepo(dir(input as AnyInput, c), c.signal)
        if (result.ok) await emitUpdated()
        return result
      },

      setRemote: async (input, context) => {
        const c = context as HandlerContext
        const url = ((input as { url?: string }).url ?? "").trim()
        if (!url) return c.error("failed", "Paste the clone URL from your git hosting page first")
        return mutate(input as AnyInput, c, () => g.setRemote(dir(input as AnyInput, c), url, c.signal))
      },

      fetch: async (input, context) => {
        const c = context as HandlerContext
        return mutate(input as AnyInput, c, () => g.fetchAll(dir(input as AnyInput, c), c.signal))
      },

      pull: async (input, context) => {
        const c = context as HandlerContext
        const { strategy } = input as { strategy: "ff" | "rebase" | "merge" }
        return mutate(input as AnyInput, c, () => g.pull(dir(input as AnyInput, c), strategy, c.signal))
      },

      push: async (input, context) => {
        const c = context as HandlerContext
        const setUpstream = (input as { setUpstream?: boolean }).setUpstream === true
        return mutate(input as AnyInput, c, () => g.push(dir(input as AnyInput, c), setUpstream, c.signal))
      },

      prLink: async (input, context) => {
        const c = context as HandlerContext
        return guard(input as AnyInput, c, () => g.prInfo(dir(input as AnyInput, c), c.signal))
      },

      stage: async (input, context) => {
        const c = context as HandlerContext
        const paths = (input as { paths?: string[] }).paths ?? []
        return mutate(input as AnyInput, c, () => g.stage(dir(input as AnyInput, c), paths, c.signal))
      },

      unstage: async (input, context) => {
        const c = context as HandlerContext
        const paths = (input as { paths?: string[] }).paths ?? []
        return mutate(input as AnyInput, c, () => g.unstage(dir(input as AnyInput, c), paths, c.signal))
      },

      commit: async (input, context) => {
        const c = context as HandlerContext
        const { message, stageAll } = input as { message: string; stageAll?: boolean }
        if (!message || !message.trim()) return c.error("failed", "Commit message is empty")
        return mutate(input as AnyInput, c, () => g.commit(dir(input as AnyInput, c), message, stageAll === true, c.signal))
      },

      checkout: async (input, context) => {
        const c = context as HandlerContext
        const { name, create, force } = input as { name: string; create?: boolean; force?: boolean }
        return mutate(input as AnyInput, c, () =>
          g.checkout(dir(input as AnyInput, c), name, create === true, force === true, c.signal),
        )
      },

      merge: async (input, context) => {
        const c = context as HandlerContext
        const branch = (input as { branch: string }).branch
        return mutate(input as AnyInput, c, () => g.merge(dir(input as AnyInput, c), branch, c.signal))
      },

      abort: async (input, context) => {
        const c = context as HandlerContext
        return mutate(input as AnyInput, c, () => g.abortMerge(dir(input as AnyInput, c), c.signal))
      },

      log: async (input, context) => {
        const c = context as HandlerContext
        const limit = Number((input as { limit?: number }).limit ?? 20)
        return guard(input as AnyInput, c, () => g.readLog(dir(input as AnyInput, c), limit, c.signal))
      },

      diff: async (input, context) => {
        const c = context as HandlerContext
        const path = (input as { path?: string }).path ?? ""
        const hash = typeof (input as { hash?: string }).hash === "string" ? (input as { hash: string }).hash.trim() : ""
        if (!path) return c.error("failed", "diff requires a file path")
        return guard(input as AnyInput, c, () => g.readDiff(dir(input as AnyInput, c), path, c.signal, hash || undefined))
      },

      show: async (input, context) => {
        const c = context as HandlerContext
        const hash = (input as { hash?: string }).hash ?? ""
        if (!hash) return c.error("failed", "show requires a commit hash")
        return guard(input as AnyInput, c, () => g.readCommit(dir(input as AnyInput, c), hash, c.signal))
      },

      revertCommit: async (input, context) => {
        const c = context as HandlerContext
        const hash = (input as { hash?: string }).hash ?? ""
        if (!hash) return c.error("failed", "revertCommit requires a commit hash")
        return mutate(input as AnyInput, c, () => g.revertCommit(dir(input as AnyInput, c), hash, c.signal))
      },

      applyCommit: async (input, context) => {
        const c = context as HandlerContext
        const hash = (input as { hash?: string }).hash ?? ""
        if (!hash) return c.error("failed", "applyCommit requires a commit hash")
        return mutate(input as AnyInput, c, () => g.applyCommit(dir(input as AnyInput, c), hash, c.signal))
      },

      checkoutFile: async (input, context) => {
        const c = context as HandlerContext
        const { hash, path } = input as { hash?: string; path?: string }
        if (!hash || !path) return c.error("failed", "checkoutFile requires a commit hash and a file path")
        return mutate(input as AnyInput, c, () => g.checkoutFile(dir(input as AnyInput, c), hash!, path!, c.signal))
      },
    })

    console.log(`[git-control] Git control panel ready in ${ctx.location.directory}`)

    return () => {
      void registration?.dispose()
    }
  },
})
