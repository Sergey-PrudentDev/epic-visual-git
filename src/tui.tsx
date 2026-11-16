import { createSignal } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import { GitControl } from "./rpc.js"
import type { BranchesOut, CommitOut, LogOut, OperateOut, StatusOut } from "./rpc.js"

const CREDIT = "opencode-git-control · made by PrudentDev · https://PrudentDev.com"

export default Plugin.define({
  id: "prudentdev.git-control.tui",
  async setup(context) {
    const rpc = context.client.rpc(GitControl)
    const [badge, setBadge] = createSignal<string | null>(null)
    let panelOpen = false

    const location = () => context.location ?? context.data.location.default()
    const withDir = <T extends object>(extra: T) => {
      const d = (location() as { directory?: string }).directory
      return d ? { directory: d, ...extra } : { ...extra }
    }

    async function refreshBadge() {
      try {
        const s = (await rpc.status(withDir({}))) as StatusOut
        if (!s.isRepo) {
          setBadge(null)
          return s
        }
        const dirty = s.staged + s.unstaged + s.untracked
        const parts = [s.branch ?? "detached"]
        if (s.ahead > 0) parts.push(`↑${s.ahead}`)
        if (s.behind > 0) parts.push(`↓${s.behind}`)
        if (dirty > 0) parts.push(`±${dirty}`)
        setBadge(parts.join(" "))
        context.data.location.vcs.invalidate(location())
        return s
      } catch {
        setBadge(null)
        return null
      }
    }

    const unsubscribe = rpc.events.on("updated", () => void refreshBadge())
    void refreshBadge()

    const unsubscribeSlot = context.ui.slot({
      append: "home.footer.status",
      render: () => {
        const text = badge()
        if (!text) return null
        return <text fg={context.theme.text.base}>⎇ {text}</text>
      },
    })

    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: "prudentdev.git-control.panel",
          title: "Open Git control panel",
          group: "Git",
          palette: true,
          slash: { name: "git", aliases: ["git-control"] },
          run: () => void panel(),
        },
      ],
    }))

    function toast(title: string, message: string, error = false) {
      context.ui.toast.show({ title, message, variant: error ? "error" : "success", duration: error ? 6000 : 3000 })
    }

    async function report(title: string, result: OperateOut | CommitOut) {
      if (result.ok) {
        const first = result.output.split(/\r?\n/).filter(Boolean)[0] ?? "Done"
        toast(title, first)
      } else {
        await context.ui.dialog.alert({ title: `${title} failed`, message: result.output || "Unknown git error" })
      }
    }

    async function panel() {
      if (panelOpen) return
      panelOpen = true
      try {
        for (;;) {
          const s = await refreshBadge()
          if (!s) {
            await context.ui.dialog.alert({ title: "Git", message: "Cannot reach the OpenCode server for git-control." })
            return
          }
          if (!s.isRepo) {
            await context.ui.dialog.alert({ title: "Git", message: `${location().directory ?? "This folder"} is not a git repository.` })
            return
          }
          if (s.merging) toast("Merge in progress", "Finish or abort the pending merge before using panel actions.", true)

          const action = await context.ui.dialog.select({
            title: `Git · ${s.branch ?? "detached HEAD"}${s.upstream ? ` (${s.upstream})` : ""}`,
            options: [
              {
                title: "Status",
                value: "status",
                description: `${s.files.length} changed · ${s.staged} staged · ${s.untracked} untracked`,
              },
              { title: "Stage all (add)", value: "stage", description: "git add -A" },
              { title: "Commit…", value: "commit", description: s.staged > 0 ? `${s.staged} staged` : "nothing staged yet" },
              { title: "Push", value: "push", description: s.upstream ? (s.ahead > 0 ? `${s.ahead} commit(s) ahead` : "up to date") : "no upstream — will publish branch" },
              { title: "Pull", value: "pull", description: s.behind > 0 ? `${s.behind} commit(s) behind upstream` : "up to date" },
              { title: "Fetch all remotes", value: "fetch", description: "fetch --all --prune --tags" },
              {
                title: "Branches…",
                value: "branches",
                description: `${s.branch ?? "detached"} · switch, create, track`,
              },
              { title: "Merge a branch into current…", value: "merge", description: "git merge --no-edit" },
              { title: "Unstage all", value: "unstage", description: "git restore --staged ." },
              { title: "Recent commits…", value: "log", description: "last 15 commits" },
            ],
          })
          if (!action) return
          await handle(action, s)
        }
      } finally {
        panelOpen = false
      }
    }

    async function handle(action: string, s: StatusOut) {
      switch (action) {
        case "status": {
          const lines = s.files.slice(0, 30).map((f) => `${(f.index || " ")}${(f.worktree || " ")} ${f.path}`)
          if (s.files.length > 30) lines.push(`… and ${s.files.length - 30} more`)
          await context.ui.dialog.alert({
            title: `Status · ${s.branch ?? "detached"}${s.upstream ? ` ↔ ${s.upstream}` : " (no upstream)"}`,
            message: lines.length ? lines.join("\n") : "Working tree clean. " + CREDIT,
          })
          return
        }
        case "stage":
          return report("Staged", (await rpc.stage(withDir({ paths: [] }))) as OperateOut)
        case "unstage": {
          const yes = await context.ui.dialog.confirm({ title: "Unstage everything?", message: "git restore --staged ." })
          if (yes) return report("Unstaged", (await rpc.unstage(withDir({ paths: [] }))) as OperateOut)
          return
        }
        case "commit": {
          if (s.files.length === 0) {
            toast("Commit", "Nothing to commit — working tree clean.", true)
            return
          }
          const stageAll = s.staged === 0 && (s.unstaged > 0 || s.untracked > 0)
            ? (await context.ui.dialog.confirm({
                title: "Nothing is staged",
                message: `Stage all ${s.files.length} changed file(s) before committing?`,
                label: { confirm: "Stage all", cancel: "Cancel" },
              })) === true
            : false
          const message = await context.ui.dialog.prompt({
            title: "Commit message",
            placeholder: "Summarize the change, e.g. feat: add git control panel",
          })
          if (message === undefined || message.trim() === "") return
          const result = (await rpc.commit({ message: message.trim(), stageAll })) as CommitOut
          if (result.ok) {
            toast("Committed", result.hash ? `${result.hash} · ${message.trim().split("\n")[0]}` : "Done")
            const doPush = await context.ui.dialog.confirm({ title: "Push now?", message: "Push this commit to the remote?" })
            if (doPush) await doPushFlow(s)
          } else {
            await context.ui.dialog.alert({ title: "Commit failed", message: result.output || "Unknown git error" })
          }
          return
        }
        case "push":
          return doPushFlow(s)
        case "pull": {
          const strategy = await context.ui.dialog.select({
            title: `Pull ${s.behind > 0 ? `${s.behind} commit(s)` : "from upstream"}`,
            current: "ff",
            options: [
              { title: "Fast-forward only", value: "ff", description: "safest — fails if history diverged" },
              { title: "Rebase local commits", value: "rebase", description: "git pull --rebase" },
              { title: "Merge", value: "merge", description: "git pull --no-rebase --no-edit" },
            ],
          })
          if (!strategy) return
          return report("Pull", (await rpc.pull({ strategy: strategy as "ff" | "rebase" | "merge" })) as OperateOut)
        }
        case "fetch":
          return report("Fetch", (await rpc.fetch()) as OperateOut)
        case "branches":
          return branchesFlow()
        case "merge":
          return mergeFlow()
        case "log": {
          const out = (await rpc.log({ limit: 15 })) as LogOut
          if (out.commits.length === 0) {
            toast("Log", "No commits yet.", true)
            return
          }
          await context.ui.dialog.alert({
            title: "Recent commits",
            message: out.commits.map((c) => `${c.hash}  ${c.subject}  · ${c.author}, ${c.when}`).join("\n"),
          })
          return
        }
      }
    }

    async function doPushFlow(s: StatusOut) {
      if (!s.branch) {
        toast("Push", "Detached HEAD — check out a branch first.", true)
        return
      }
      let setUpstream = false
      if (!s.upstream) {
        setUpstream =
          (await context.ui.dialog.confirm({
            title: "Publish branch",
            message: `${s.branch} has no upstream. Push with: git push -u origin ${s.branch}?`,
            label: { confirm: "Publish", cancel: "Cancel" },
          })) === true
        if (!setUpstream) return
      }
      return report("Push", (await rpc.push({ setUpstream })) as OperateOut)
    }

    async function branchesFlow() {
      const b = (await rpc.branches()) as BranchesOut
      const options = [
        { title: "＋ New branch from current…", value: "__new__", description: `git switch -c <name>`, category: "Create" },
        ...b.local.map((branch) => ({
          title: branch.name,
          value: branch.name,
          category: "Local",
          description: branch.current
            ? "current branch"
            : [branch.ahead > 0 ? `↑${branch.ahead}` : "", branch.behind > 0 ? `↓${branch.behind}` : ""].filter(Boolean).join(" ") || "switch to it",
        })),
        ...b.remote.map((branch) => ({ title: branch.name, value: branch.name, category: "Remote", description: "checkout as tracking branch" })),
      ]
      const selected = await context.ui.dialog.select({ title: "Branches", options, search: defaultSearch })
      if (!selected) return

      if (selected === "__new__") {
        const name = await context.ui.dialog.prompt({ title: "New branch name", placeholder: "feature/my-work" })
        if (name === undefined || name.trim() === "") return
        return report(`Create ${name.trim()}`, (await rpc.checkout({ name: name.trim(), create: true, force: false })) as OperateOut)
      }

      const target = selected.replace(/^remotes\//, "")
      const isCurrent = b.current === selected
      if (isCurrent) {
        toast("Branch", `Already on ${selected}.`, true)
        return
      }
      const yes = await context.ui.dialog.confirm({ title: "Switch branch", message: `git switch ${target}` })
      if (!yes) return
      const result = (await rpc.checkout({ name: target, create: false, force: false })) as OperateOut
      if (result.ok) {
        toast("Switched", target)
        return
      }
      const discard = await context.ui.dialog.confirm({
        title: "Switch failed",
        message: `${result.output}\n\nRetry with --discard-changes? This DESTROYS uncommitted changes.`,
        label: { confirm: "Discard & switch", cancel: "Keep them" },
      })
      if (discard) return report("Switched", (await rpc.checkout({ name: target, create: false, force: true })) as OperateOut)
    }

    async function mergeFlow() {
      const b = (await rpc.branches()) as BranchesOut
      const candidates = [...b.local.filter((branch) => !branch.current), ...b.remote]
      if (candidates.length === 0) {
        toast("Merge", "No other branches to merge.", true)
        return
      }
      const selected = await context.ui.dialog.select({
        title: "Merge into current branch",
        options: candidates.map((branch) => ({
          title: branch.name,
          value: branch.name,
          category: branch.remote ? "Remote" : "Local",
        })),
        search: defaultSearch,
      })
      if (!selected) return
      const yes = await context.ui.dialog.confirm({ title: "Merge", message: `git merge --no-edit ${selected}` })
      if (!yes) return
      const result = (await rpc.merge({ branch: selected })) as OperateOut
      if (result.ok) {
        toast("Merged", selected)
        return
      }
      const hint = /CONFLICT/.test(result.output) ? "\n\nResolve conflicts, then commit — or run: git merge --abort" : ""
      await context.ui.dialog.alert({ title: "Merge failed", message: (result.output || "Unknown git error") + hint })
    }

    function defaultSearch(query: string, options: { title: string }[]) {
      const q = query.toLowerCase()
      return options.filter((option) => option.title.toLowerCase().includes(q))
    }

    return () => {
      unsubscribe()
      unsubscribeSlot()
    }
  },
})
