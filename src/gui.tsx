import { createEffect, createMemo, createSignal, ErrorBoundary, For, onCleanup, Show } from "solid-js"
import { Command, MenuItem, Panel, Plugin, type PanelTab } from "@opencode/plugin/gui"
import { GitControl } from "./rpc.js"
import type { BranchesOut, CommitOut, DiffOut, LogOut, OperateOut, ShowOut, StatusOut } from "./rpc.js"

const CREDIT = "Epic Visual Git · PrudentDev · https://PrudentDev.com"

/** Rename display paths like "a/{old => new}/b.txt" -> a usable pathspec. */
function realPath(display: string): string {
  const braces = display.replace(/\{[^}]* => ([^}]*)\}/g, "$1").replace(/\/\/+/g, "/")
  if (braces.includes(" => ")) return braces.split(" => ").pop()!.trim()
  return braces
}

const CSS = `
.ggc{display:flex;flex-direction:column;gap:12px;font-size:13px;line-height:1.45;padding:12px 14px}
.ggc-card{position:relative;overflow:hidden;border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:12px;padding:11px;display:flex;flex-direction:column;gap:8px;background:linear-gradient(168deg,color-mix(in srgb,currentColor 6%,transparent),transparent 65%),color-mix(in srgb,currentColor 2%,transparent);box-shadow:0 6px 18px -14px rgba(0,0,0,.7)}
.ggc-card::before{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,transparent,#58a6ff,#3fb950,transparent);opacity:.7}
.ggc-label{display:flex;align-items:center;gap:6px;font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;opacity:.6;font-weight:700}
.ggc-label::before{content:"";flex:none;width:3px;height:11px;border-radius:2px;background:linear-gradient(180deg,#58a6ff,#3fb950)}
.ggc-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.ggc-spacer{flex:1}
.ggc-btn{appearance:none;border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:color-mix(in srgb,currentColor 7%,transparent);color:inherit;padding:4px 11px;border-radius:7px;font:inherit;font-size:12.5px;cursor:pointer;transition:background .12s,border-color .12s,transform .06s;box-shadow:0 1px 0 rgba(0,0,0,.25)}
.ggc-btn:hover:not(:disabled){background:color-mix(in srgb,currentColor 15%,transparent)}
.ggc-btn:active:not(:disabled){transform:translateY(1px)}
.ggc-btn:disabled{opacity:.45;cursor:default}
.ggc-btn--primary{background:linear-gradient(180deg,#3fb950,#2ea043);border-color:#2ea043;color:#fff;font-weight:600;text-shadow:0 1px 0 rgba(0,0,0,.25);box-shadow:0 1px 0 rgba(0,0,0,.25),0 0 14px rgba(46,160,67,.28)}
.ggc-btn--primary:hover:not(:disabled){background:linear-gradient(180deg,#4cc75e,#33ad4c)}
.ggc-btn--danger{color:#f85149;border-color:color-mix(in srgb,#f85149 40%,transparent)}
.ggc-btn--danger:hover:not(:disabled){background:color-mix(in srgb,#f85149 14%,transparent)}
.ggc-btn--armed{background:color-mix(in srgb,#f85149 22%,transparent);border-color:#f85149;color:#f85149;font-weight:600;animation:ggc-pulse 1.15s ease-out infinite}
@keyframes ggc-pulse{0%,100%{box-shadow:0 0 0 0 rgba(248,81,73,.5)}55%{box-shadow:0 0 0 5px rgba(248,81,73,0)}}
.ggc-btn:focus-visible,.ggc-act:focus-visible{outline:2px solid color-mix(in srgb,#58a6ff 55%,transparent);outline-offset:1px}
.ggc-pill{display:inline-flex;gap:3px;align-items:center;padding:1px 8px;border-radius:999px;font-size:11.5px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);background:color-mix(in srgb,currentColor 6%,transparent)}
.ggc-branch{font-weight:700;font-size:15px;background:linear-gradient(90deg,#58a6ff,#7ee787);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.ggc-upstream{opacity:.6;font-size:12px}
.ggc-warn{color:#d29922;font-size:12px}
.ggc-list{overflow:auto;margin:0 -4px;padding:0 4px}
.ggc ::-webkit-scrollbar{width:8px;height:8px}
.ggc ::-webkit-scrollbar-track{background:transparent}
.ggc ::-webkit-scrollbar-thumb{background:color-mix(in srgb,currentColor 16%,transparent);border-radius:8px}
.ggc ::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,currentColor 26%,transparent)}
.ggc-file{display:flex;gap:7px;align-items:center;font-family:ui-monospace,Consolas,monospace;font-size:12px;padding:2px 5px;border-radius:6px;white-space:nowrap;cursor:pointer;transition:background .1s}
.ggc-file:hover{background:color-mix(in srgb,currentColor 9%,transparent)}
.ggc-fileacts{margin-left:auto;display:inline-flex;gap:4px;align-items:center;opacity:0;transition:opacity .12s ease}
.ggc-file:hover .ggc-fileacts,.ggc-file:focus-within .ggc-fileacts{opacity:1}
.ggc-act{width:17px;height:17px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;font-size:12px;line-height:1;cursor:pointer;border:1px solid color-mix(in srgb,currentColor 25%,transparent);background:color-mix(in srgb,currentColor 8%,transparent);color:inherit;transition:color .1s,border-color .1s,background .1s,transform .05s}
.ggc-act:active{transform:scale(.9)}
.ggc-act--add:hover:not(:disabled){color:#3fb950;border-color:#3fb950;background:rgba(46,160,67,.18)}
.ggc-act--rm:hover:not(:disabled){color:#f85149;border-color:#f85149;background:rgba(248,81,73,.15)}
.ggc-refresh{width:20px;height:20px;flex:none;margin-left:2px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;font-size:13px;line-height:1;cursor:pointer;border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:color-mix(in srgb,currentColor 6%,transparent);color:inherit;opacity:.7;transition:opacity .1s,color .1s,border-color .1s}
.ggc-refresh:hover:not(:disabled){opacity:1;color:#58a6ff;border-color:color-mix(in srgb,#58a6ff 45%,transparent)}
.ggc-refresh:disabled{opacity:.4;cursor:default}
.ggc-refresh.ggc-spin{animation:ggc-rot .8s linear infinite}
@keyframes ggc-rot{to{transform:rotate(360deg)}}
.ggc-xy{flex:none;width:24px;text-align:center}
.ggc-path{overflow:hidden;text-overflow:ellipsis}
.ggc-input{background:color-mix(in srgb,currentColor 5%,transparent);border:1px solid color-mix(in srgb,currentColor 20%,transparent);color:inherit;border-radius:7px;padding:4px 8px;font:inherit;font-size:12.5px}
.ggc-input:focus-visible{outline:none;border-color:#58a6ff;box-shadow:0 0 0 2px color-mix(in srgb,#58a6ff 25%,transparent)}
.ggc-textarea{width:100%;box-sizing:border-box;min-height:46px;resize:vertical}
.ggc-check{display:flex;gap:5px;align-items:center;font-size:12px;opacity:.85;cursor:pointer}
.ggc-note{font-size:12px;min-height:15px;white-space:pre-line}
.ggc-ok{color:#3fb950}
.ggc-bad{color:#f85149}
.ggc-hint{font-size:11px;opacity:.55;line-height:1.35}
.ggc-sub{font-size:11px;opacity:.62;font-weight:600}
.ggc-log{position:relative;display:flex;gap:8px;align-items:center;font-size:12px;padding:2.5px 5px 2.5px 18px;border-radius:6px;white-space:nowrap;cursor:pointer;transition:background .1s}
.ggc-log::after{content:"";position:absolute;left:7.5px;top:0;bottom:0;width:1px;background:linear-gradient(180deg,color-mix(in srgb,#58a6ff 30%,transparent),color-mix(in srgb,#3fb950 26%,transparent))}
.ggc-log::before{content:"";position:absolute;left:5px;top:calc(50% - 3px);width:6px;height:6px;border-radius:50%;background:color-mix(in srgb,#58a6ff 45%,transparent);z-index:1}
.ggc-log:hover{background:color-mix(in srgb,currentColor 8%,transparent)}
.ggc-log--sel{background:color-mix(in srgb,#58a6ff 10%,transparent)}
.ggc-log--sel::before{background:#58a6ff;box-shadow:0 0 6px rgba(88,166,255,.8)}
.ggc-caret{flex:none;width:9px;opacity:.5;font-size:9px}
.ggc-hash{flex:none;font-family:ui-monospace,Consolas,monospace;color:#8b949e}
.ggc-subject{overflow:hidden;text-overflow:ellipsis}
.ggc-cdetail{border:1px solid color-mix(in srgb,#58a6ff 22%,transparent);border-radius:9px;padding:8px;display:flex;flex-direction:column;gap:5px;background:color-mix(in srgb,#58a6ff 5%,transparent);margin:2px 0 5px}
.ggc-cfile{display:flex;gap:6px;align-items:center;font-family:ui-monospace,Consolas,monospace;font-size:11.5px;padding:2px 4px;border-radius:5px}
.ggc-cfile:hover{background:color-mix(in srgb,currentColor 7%,transparent)}
.ggc-stat{flex:none;font-size:11px;margin-left:auto;padding-left:6px}
.ggc-mini{padding:1px 8px;font-size:11px;border-radius:6px}
.ggc-diffwrap{overflow:auto;max-height:320px;border:1px solid color-mix(in srgb,currentColor 12%,transparent);border-radius:8px;padding:6px 8px;background:color-mix(in srgb,currentColor 3%,transparent);font-family:ui-monospace,Consolas,monospace;font-size:11.5px;line-height:1.55}
.ggc-filespane{display:flex;gap:9px;align-items:flex-start;margin:0 -4px;padding:0 4px}
.ggc-split-left{flex:1 1 auto;min-width:0;margin:0}
.ggc-filespane--split .ggc-split-left{flex:0 0 38%;max-width:38%}
.ggc-split-right{flex:1 1 62%;min-width:0;display:flex;flex-direction:column;gap:4px}
.ggc-diffhead{display:flex;gap:6px;align-items:center}
.ggc-diffpath{font-family:ui-monospace,Consolas,monospace;font-size:11px;opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
.ggc-splitclose{flex:none;width:17px;height:17px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;font-size:10px;line-height:1;cursor:pointer;border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:color-mix(in srgb,currentColor 6%,transparent);color:inherit;opacity:.65;transition:opacity .1s,color .1s,border-color .1s}
.ggc-splitclose:hover{opacity:1;color:#f85149;border-color:#f85149}
.ggc-file--sel{background:color-mix(in srgb,#58a6ff 13%,transparent)}
.ggc-file--sel:hover{background:color-mix(in srgb,#58a6ff 17%,transparent)}
.ggc-diffline{white-space:pre;display:block}
.d-add{color:#3fb950;background:rgba(46,160,67,.15)}
.d-del{color:#f85149;background:rgba(248,81,73,.12)}
.d-hunk{color:#4c9aff;opacity:.85}
.d-meta{opacity:.55;color:#58a6ff}
.d-ctx{opacity:.75}
.ggc-credit{opacity:.4;font-size:10.5px;text-align:right}
`

export default Plugin.define({
  i18n: {
    en: {
      "panel.title": "Git",
      "command.open": "Epic Visual Git: open control panel",
      "menu.open": "Epic Visual Git",
    },
  },
  setup(ctx) {
    // ctx.client changes when the server restarts, so read it lazily on every call.
    const rpc = () => ctx.client.rpc(GitControl)

    const tab: PanelTab = {
      id: "main",
      get title() {
        return ctx.t("panel.title")
      },
      closable: "compact",
      fallback: true,
    }

    ctx.add(Panel, {
      id: "main",
      region: "side",
      width: "narrow",
      mobile: {
        get title() {
          return ctx.t("panel.title")
        },
        order: 45,
        kind: "menu",
        icon: "file-tree",
      },
      list: (input) => (input.open.includes("main") ? [tab] : []),
      render: (props) => (
        <ErrorBoundary
          fallback={(error) => (
            <div class="ggc">
              <div class="ggc-note ggc-bad">
                Git panel hit an error: {String((error as Error)?.message ?? error)} — close and reopen the panel to recover.
              </div>
            </div>
          )}
        >
          <GitView dir={() => props.session.directory} />
        </ErrorBoundary>
      ),
    })

    ctx.add(
      Command,
      (): Command => ({
        id: "open",
        title: ctx.t("command.open"),
        keywords: "git branch commit push pull merge stage fetch",
        group: ctx.t("panel.title"),
        slash: { name: "git" },
        enabled: !!ctx.sessions.current(),
        run: () => {
          const session = ctx.sessions.current()
          if (session) ctx.layout.toggle(`${ctx.id}:main`, session)
        },
      }),
    )

    ctx.add(
      MenuItem,
      (): MenuItem => {
        const session = ctx.sessions.current()
        const open = !!session && ctx.layout.state(`${ctx.id}:main`, session) !== "closed"
        return {
          menu: "session.panel",
          id: "main",
          title: ctx.t("menu.open"),
          icon: "file-tree",
          keybind: `${ctx.id}.open`,
          opened: open,
          run: () => {
            if (session) ctx.layout.open(`${ctx.id}:main`, session)
          },
        }
      },
    )

    function GitView(props: { dir: () => string }) {
      const [status, setStatus] = createSignal<StatusOut | null>(null)
      const [branches, setBranches] = createSignal<BranchesOut>({ current: null, local: [], remote: [] })
      const [log, setLog] = createSignal<LogOut["commits"]>([])
      const [note, setNote] = createSignal("")
      const [busy, setBusy] = createSignal(false)
      const [message, setMessage] = createSignal("")
      const [stageAll, setStageAll] = createSignal(true)
      const [strategy, setStrategy] = createSignal<"ff" | "rebase" | "merge">("ff")
      const [switchSel, setSwitchSel] = createSignal("")
      const [mergeSel, setMergeSel] = createSignal("")
      const [newBranch, setNewBranch] = createSignal("")
      const [diffPath, setDiffPath] = createSignal<string | null>(null)
      const [diffOut, setDiffOut] = createSignal("")
      const [diffBusy, setDiffBusy] = createSignal(false)

      const DIFF_MAX_LINES = 2500
      const diffLines = createMemo(() => diffOut().split(/\r?\n/).slice(0, DIFF_MAX_LINES))

      function lineClass(line: string) {
        if (line.startsWith("+") && !line.startsWith("+++")) return "ggc-diffline d-add"
        if (line.startsWith("-") && !line.startsWith("---")) return "ggc-diffline d-del"
        if (line.startsWith("@@")) return "ggc-diffline d-hunk"
        if (/^(diff --git|index |new file mode|deleted file mode|old mode|new mode|similarity |rename |copy |Binary files)/.test(line))
          return "ggc-diffline d-meta"
        return "ggc-diffline d-ctx"
      }

      async function openDiff(path: string, hash?: string) {
        setDiffPath(path)
        setDiffBusy(true)
        setDiffOut("")
        try {
          const d = (await rpc().diff({ directory: props.dir(), path, ...(hash ? { hash } : {}) })) as DiffOut
          setDiffOut(d.output || "(no textual diff — binary or mode-only change)")
        } catch (error) {
          setDiffOut(String((error as Error)?.message ?? error))
        } finally {
          setDiffBusy(false)
        }
      }

      const [expanded, setExpanded] = createSignal<string | null>(null)
      const [detail, setDetail] = createSignal<ShowOut | null>(null)
      const [detailBusy, setDetailBusy] = createSignal(false)
      const [armed, setArmed] = createSignal("")
      let armTimer: ReturnType<typeof setTimeout> | undefined
      onCleanup(() => clearTimeout(armTimer))

      /** Two-step confirm: first click arms the button, a second within 4 s runs it. */
      function arm(key: string, run: () => Promise<void>) {
        clearTimeout(armTimer)
        if (armed() === key) {
          setArmed("")
          void run()
          return
        }
        setArmed(key)
        armTimer = setTimeout(() => setArmed(""), 4000)
      }

      async function toggleCommit(hash: string) {
        if (expanded() === hash) {
          setExpanded(null)
          setDetail(null)
          return
        }
        setExpanded(hash)
        setDetail(null)
        setArmed("")
        setDetailBusy(true)
        try {
          setDetail((await rpc().show({ directory: props.dir(), hash })) as ShowOut)
        } catch (error) {
          setNote(`Commit ${hash}: ${String((error as Error)?.message ?? error)}`)
          setExpanded(null)
        } finally {
          setDetailBusy(false)
        }
      }

      const commitStatusColor = (status: string) =>
        ({ A: "color:#3fb950", D: "color:#f85149", M: "color:#d29922", R: "color:#58a6ff", C: "color:#58a6ff", T: "opacity:.6" }[status] ?? "opacity:.6")

      const firstLine = (text: string) => String(text ?? "").split(/\r?\n/).find(Boolean) ?? ""

      // Never blank the panel on a transient failure: keep showing the last good
      // state and report the error, instead of collapsing to an empty fallback.
      async function refresh() {
        const directory = props.dir()
        try {
          // status answers for every folder (isRepo:false outside a repo), so it
          // loads first — otherwise branches/log rejecting with not_repo would
          // fail the whole refresh and hide the panel's real state.
          const s = (await rpc().status({ directory })) as StatusOut
          setStatus(s)
          if (!s.isRepo) {
            setBranches({ current: null, local: [], remote: [] })
            setLog([])
            return
          }
          const [b, l] = await Promise.all([
            rpc().branches({ directory }) as Promise<BranchesOut>,
            rpc().log({ directory, limit: 15 }) as Promise<LogOut>,
          ])
          setBranches(b)
          setLog(l.commits)
        } catch (error) {
          setNote(`git-control: ${String((error as Error)?.message ?? error)}`)
        }
      }

      async function act(label: string, run: () => Promise<OperateOut | CommitOut>) {
        setBusy(true)
        setNote("")
        try {
          const result = await run()
          setNote(result.ok ? `${label} ✓ ${firstLine(result.output)}` : `${label} ✗ ${firstLine(result.output)}`)
        } catch (error) {
          setNote(`${label} ✗ ${String((error as Error)?.message ?? error)}`)
        } finally {
          setBusy(false)
          await refresh()
        }
      }

      async function commitNow() {
        const text = message().trim()
        if (!text || busy()) return
        await act(status()?.merging ? "Merge commit" : "Commit", () =>
          rpc().commit({ directory: props.dir(), message: text, stageAll: stageAll() }),
        )
        if (!note().includes("✗")) setMessage("")
      }

      createEffect(() => {
        props.dir()
        setDiffPath(null)
        setExpanded(null)
        setDetail(null)
        void refresh()
      })
      const unsubscribe = rpc().events.on("updated", () => void refresh())
      onCleanup(unsubscribe)

      const isConflict = (file: { index: string; worktree: string }) =>
        file.index === "U" ||
        file.worktree === "U" ||
        (file.index === "A" && file.worktree === "A") ||
        (file.index === "D" && file.worktree === "D")
      const conflictCount = (files: StatusOut["files"]) => files.filter(isConflict).length

      // Anything in the working tree that git can add: untracked (?), modified (M),
      // deleted (D) or conflicted (U — staging it marks the conflict resolved).
      const canStage = (file: { index: string; worktree: string }) => file.worktree !== ""
      // A staged change can be unstaged — except a conflict, which git refuses to
      // unstage; stage-and-commit or Abort is the path there.
      const canUnstage = (file: { index: string; worktree: string }) =>
        !isConflict(file) && file.index !== "" && file.index !== "?"

      const branchColor = (file: { index: string; worktree: string }) =>
        isConflict(file)
          ? "color:#f85149;font-weight:700"
          : file.index === "?" || file.worktree === "?"
            ? "opacity:.55"
            : file.index
              ? "color:#3fb950"
              : "color:#d29922"

      return (
        <div class="ggc">
          <style>{CSS}</style>
          <Show
            when={status()}
            fallback={
              <div class="ggc">
                <div class="ggc-note" classList={{ "ggc-bad": !!note() }}>
                  {note() || "Loading git status…"}
                </div>
                <Show when={note()}>
                  <button class="ggc-btn" disabled={busy()} onClick={() => void refresh()}>
                    Retry
                  </button>
                </Show>
              </div>
            }
          >
            {(s) => (
              s().isRepo ? (
              <>
                <div class="ggc-row">
                  <span class="ggc-branch">⎇ {s().branch ?? "detached HEAD"}</span>
                  <Show when={s().upstream} fallback={<span class="ggc-pill" style={{ color: "#d29922" }}>no upstream</span>}>
                    <span class="ggc-upstream">↔ {s().upstream}</span>
                  </Show>
                  <span class="ggc-spacer" />
                  <Show when={s().ahead > 0}>
                    <span class="ggc-pill" style={{ color: "#4c9aff" }} title="commits ahead of upstream">
                      ↑ {s().ahead}
                    </span>
                  </Show>
                  <Show when={s().behind > 0}>
                    <span class="ggc-pill" style={{ color: "#d29922" }} title="commits behind upstream">
                      ↓ {s().behind}
                    </span>
                  </Show>
                  <Show when={s().files.length > 0}>
                    <span class="ggc-pill" title="changed files">± {s().files.length}</span>
                  </Show>
                  <Show when={conflictCount(s().files) > 0}>
                    <span class="ggc-pill ggc-bad" title="conflicted files that need resolution">⚠ {conflictCount(s().files)}</span>
                  </Show>
                  <button
                    class="ggc-refresh"
                    classList={{ "ggc-spin": busy() }}
                    disabled={busy()}
                    title="Refresh — reload status, branches and history right now"
                    onClick={() => void refresh()}
                  >
                    ⟳
                  </button>
                </div>

                <Show when={s().merging}>
                  <div class="ggc-card" style={{ "border-color": "rgba(248,81,73,.45)" }}>
                    <div style={{ "font-weight": "600", color: "#f85149" }}>
                      {conflictCount(s().files) > 0 ? `Conflicts — ${conflictCount(s().files)} file(s)` : "Undo in progress"}
                    </div>
                    <div class="ggc-hint">
                      {conflictCount(s().files) > 0
                        ? "Conflicted files are marked red in Changes below. Edit them to resolve the <<<<<<< ======= >>>>>>> markers, then Stage all and Commit to finish. Or discard the whole operation and go back to how things were."
                        : "Nothing left to resolve — Commit to finish recording it, or discard below."}
                    </div>
                    <div class="ggc-row">
                      <button
                        class="ggc-btn ggc-btn--danger"
                        disabled={busy()}
                        title="git merge/cherry-pick/revert --abort — cancels the operation and restores the state from before it"
                        onClick={() => act("Abort", () => rpc().abort({ directory: props.dir() }))}
                      >
                        Abort
                      </button>
                    </div>
                  </div>
                </Show>

                <div class="ggc-card">
                  <div class="ggc-label">Sync</div>
                  <div class="ggc-row">
                    <button class="ggc-btn" disabled={busy()} onClick={() => act("Fetch", () => rpc().fetch({ directory: props.dir() }))}>
                      Fetch
                    </button>
                    <select
                      class="ggc-btn"
                      value={strategy()}
                      title="How Pull brings remote commits into your branch"
                      onInput={(e) => setStrategy(e.currentTarget.value as "ff" | "rebase" | "merge")}
                    >
                      <option value="ff">Fast forward only</option>
                      <option value="rebase">Rebase</option>
                      <option value="merge">Merge</option>
                    </select>
                    <button class="ggc-btn" disabled={busy()} onClick={() => act("Pull", () => rpc().pull({ directory: props.dir(), strategy: strategy() }))}>
                      Pull
                    </button>
                    <span class="ggc-spacer" />
                    <button
                      class="ggc-btn ggc-btn--primary"
                      disabled={busy()}
                      onClick={() => act(s().upstream ? "Push" : "Publish", () => rpc().push({ directory: props.dir(), setUpstream: !s().upstream }))}
                    >
                      {s().upstream ? (s().ahead > 0 ? `Push ↑${s().ahead}` : "Push") : "Publish (push -u)"}
                    </button>
                    <div class="ggc-hint" style={{ "flex-basis": "100%" }}>
                      {strategy() === "ff"
                        ? "Fast forward only: the safe default — pull fails instead of touching history if your branch has its own commits."
                        : strategy() === "rebase"
                          ? "Rebase: replays your unpushed commits on top of the remote branch — keeps history linear."
                          : "Merge: always joins the branches with a merge commit — easiest to undo, busier history."}
                    </div>
                  </div>
                </div>

                <div class="ggc-card">
                  <div class="ggc-label">
                    Changes · {s().staged} staged, {s().unstaged} modified, {s().untracked} untracked
                    <Show when={conflictCount(s().files) > 0}>
                      <span class="ggc-bad">, {conflictCount(s().files)} conflicted</span>
                    </Show>
                  </div>
                  <div class="ggc-row">
                    <button class="ggc-btn" disabled={busy()} onClick={() => act("Stage all", () => rpc().stage({ directory: props.dir(), paths: [] }))}>
                      Stage all
                    </button>
                    <button class="ggc-btn" disabled={busy()} onClick={() => act("Unstage all", () => rpc().unstage({ directory: props.dir(), paths: [] }))}>
                      Unstage all
                    </button>
                  </div>
                  <Show
                    when={s().files.length > 0 || diffPath() !== null}
                    fallback={
                      <div style={{ "text-align": "center", padding: "5px 0 3px" }}>
                        <span class="ggc-pill ggc-ok">✓ working tree clean</span>
                      </div>
                    }
                  >
                    <Show when={diffPath() === null}>
                      <div class="ggc-hint">Click a file to see its diff · hover a row to stage (+) or unstage (−) just that file</div>
                    </Show>
                    <div class="ggc-filespane" classList={{ "ggc-filespane--split": diffPath() !== null }}>
                      <div class="ggc-list ggc-split-left" style={{ "max-height": diffPath() !== null ? "341px" : "180px" }}>
                          <For each={s().files}>
                            {(file) => (
                              <div
                                class="ggc-file"
                                classList={{ "ggc-file--sel": diffPath() === file.path }}
                                title={isConflict(file) ? `Conflicted — click to see the diff: ${file.path}` : `View diff — ${file.path}`}
                                onClick={() => void openDiff(file.path)}
                              >
                                <span class="ggc-xy" style={branchColor(file)}>
                                  {file.index || " "}
                                  {file.worktree || " "}
                                </span>
                                <span class="ggc-path">{file.path}</span>
                                <span class="ggc-fileacts">
                                  <Show when={canStage(file)}>
                                    <button
                                      class="ggc-act ggc-act--add"
                                      disabled={busy()}
                                      aria-label={`Stage ${file.path}`}
                                      title={isConflict(file) ? "git add — mark this file resolved by staging it" : "git add — stage just this file for the next commit"}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        void act(`Stage ${file.path}`, () => rpc().stage({ directory: props.dir(), paths: [file.path] }))
                                      }}
                                    >
                                      +
                                    </button>
                                  </Show>
                                  <Show when={canUnstage(file)}>
                                    <button
                                      class="ggc-act ggc-act--rm"
                                      disabled={busy()}
                                      aria-label={`Unstage ${file.path}`}
                                      title="git restore --staged — take just this file out of the commit, your edits stay in the file"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        void act(`Unstage ${file.path}`, () => rpc().unstage({ directory: props.dir(), paths: [file.path] }))
                                      }}
                                    >
                                      −
                                    </button>
                                  </Show>
                                </span>
                              </div>
                            )}
                          </For>
                        </div>
                        <Show when={diffPath() !== null}>
                          <div class="ggc-split-right">
                            <div class="ggc-diffhead">
                              <span class="ggc-diffpath" title={diffPath() ?? ""}>{diffPath()}</span>
                              <button class="ggc-splitclose" title="Close the diff view" onClick={() => setDiffPath(null)}>✕</button>
                            </div>
                            <div class="ggc-diffwrap">
                              <Show when={!diffBusy()} fallback={<span class="ggc-diffline d-meta">Loading diff…</span>}>
                                <For each={diffLines()}>
                                  {(line) => <span class={lineClass(line)}>{line === "" ? " " : line}</span>}
                                </For>
                                <Show when={diffOut().split(/\r?\n/).length > DIFF_MAX_LINES}>
                                  <span class="ggc-diffline d-meta">… showing the first {DIFF_MAX_LINES} lines — open the file for the rest</span>
                                </Show>
                              </Show>
                            </div>
                          </div>
                        </Show>
                    </div>
                  </Show>
                  <textarea
                    class="ggc-input ggc-textarea"
                    rows={2}
                    placeholder="Write a commit message… (Ctrl+Enter to commit)"
                    value={message()}
                    onInput={(e) => setMessage(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                        e.preventDefault()
                        void commitNow()
                      }
                    }}
                  />
                  <div class="ggc-row">
                    <label class="ggc-check">
                      <input type="checkbox" checked={stageAll()} onInput={(e) => setStageAll(e.currentTarget.checked)} />
                      stage all first
                    </label>
                    <span class="ggc-spacer" />
                    <button class="ggc-btn ggc-btn--primary" disabled={busy() || message().trim() === ""} onClick={() => void commitNow()}>
                      {s().merging ? "Commit merge" : "Commit"}
                    </button>
                  </div>
                </div>

                <div class="ggc-card">
                  <div class="ggc-label">Branch</div>
                  <div class="ggc-sub">Switch to another branch</div>
                  <div class="ggc-row">
                    <select class="ggc-btn" style={{ "max-width": "185px" }} value={switchSel()} onInput={(e) => setSwitchSel(e.currentTarget.value)}>
                      <option value="">Choose a branch…</option>
                      <For each={branches().local}>
                        {(branch) => <option value={branch.name}>{branch.name}{branch.current ? " · current" : ""}</option>}
                      </For>
                      <For each={branches().remote}>
                        {(branch) => <option value={branch.name}>{branch.name} (remote)</option>}
                      </For>
                    </select>
                    <button
                      class="ggc-btn"
                      disabled={busy() || switchSel() === ""}
                      title="git switch — refuses if your uncommitted changes would be overwritten"
                      onClick={() => act("Switch", () => rpc().checkout({ directory: props.dir(), name: switchSel(), create: false, force: false }))}
                    >
                      Switch
                    </button>
                    <button
                      class="ggc-btn ggc-btn--danger"
                      disabled={busy() || switchSel() === ""}
                      title="git switch --discard-changes — destroys uncommitted changes"
                      onClick={() => act("Force switch", () => rpc().checkout({ directory: props.dir(), name: switchSel(), create: false, force: true }))}
                    >
                      Force
                    </button>
                  </div>
                  <div class="ggc-sub">Create a new branch from “{s().branch ?? "HEAD"}”</div>
                  <div class="ggc-row">
                    <input
                      class="ggc-input"
                      style={{ "min-width": "0", flex: "1" }}
                      placeholder="New branch name…"
                      value={newBranch()}
                      onInput={(e) => setNewBranch(e.currentTarget.value)}
                    />
                    <button
                      class="ggc-btn"
                      disabled={busy() || newBranch().trim() === ""}
                      title="git switch -c — creates the branch and checks it out"
                      onClick={async () => {
                        const name = newBranch().trim()
                        await act(`Create ${name}`, () => rpc().checkout({ directory: props.dir(), name, create: true, force: false }))
                        setNewBranch("")
                      }}
                    >
                      Create & switch
                    </button>
                  </div>
                  <div class="ggc-sub">Merge another branch into “{s().branch ?? "HEAD"}”</div>
                  <div class="ggc-row">
                    <select class="ggc-btn" style={{ "max-width": "185px" }} value={mergeSel()} onInput={(e) => setMergeSel(e.currentTarget.value)}>
                      <option value="">Choose a branch to merge…</option>
                      <For each={branches().local.filter((branch) => !branch.current)}>
                        {(branch) => <option value={branch.name}>{branch.name}</option>}
                      </For>
                      <For each={branches().remote}>
                        {(branch) => <option value={branch.name}>{branch.name} (remote)</option>}
                      </For>
                    </select>
                    <button
                      class="ggc-btn"
                      disabled={busy() || mergeSel() === ""}
                      title="git merge --no-edit — if files conflict, the merge stays open in this panel for you to resolve"
                      onClick={() => act("Merge", () => rpc().merge({ directory: props.dir(), branch: mergeSel() }))}
                    >
                      Merge
                    </button>
                  </div>
                </div>

                <div class="ggc-card">
                  <div class="ggc-label">History</div>
                  <Show when={note()}>
                    <div class="ggc-note" classList={{ "ggc-ok": !!note() && !note().includes("✗"), "ggc-bad": note().includes("✗") }}>
                      {note()}
                    </div>
                  </Show>
                  <div class="ggc-list" style={{ "max-height": "280px" }}>
                    <For each={log()}>
                      {(commit) => (
                        <>
                          <div
                            class="ggc-log"
                            classList={{ "ggc-log--sel": expanded() === commit.hash }}
                            title={`${commit.subject} — ${commit.author}, ${commit.when}`}
                            onClick={() => void toggleCommit(commit.hash)}
                          >
                            <span class="ggc-caret">{expanded() === commit.hash ? "▾" : "▸"}</span>
                            <span class="ggc-hash">{commit.hash}</span>
                            <span class="ggc-subject">{commit.subject}</span>
                          </div>
                          <Show when={expanded() === commit.hash}>
                            <div class="ggc-cdetail">
                              <Show when={!detailBusy()} fallback={<span class="ggc-hint">Loading commit…</span>}>
                                <Show when={detail()}>
                                  {(d) => (
                                    <>
                                      <div class="ggc-row">
                                        <span
                                          class="ggc-pill"
                                          style={{ "min-width": "0", flex: "1", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}
                                          title={`Committed by ${d().author} on ${d().when}`}
                                        >
                                          {d().author} · {d().when}
                                        </span>
                                        <button
                                          class="ggc-btn ggc-mini"
                                          classList={{ "ggc-btn--armed": armed() === "apply" }}
                                          disabled={busy()}
                                          title="git cherry-pick -n — applies this commit's changes onto your current branch as pending changes (nothing is committed). Needs a clean working tree"
                                          onClick={() =>
                                            arm("apply", async () => {
                                              await act("Apply to branch", () => rpc().applyCommit({ directory: props.dir(), hash: d().hash }))
                                            })
                                          }
                                        >
                                          {armed() === "apply" ? "Confirm apply?" : "Apply to branch"}
                                        </button>
                                        <button
                                          class="ggc-btn ggc-btn--danger ggc-mini"
                                          classList={{ "ggc-btn--armed": armed() === "undo" }}
                                          disabled={busy()}
                                          title="git revert — creates a new commit that undoes all of this commit's changes. Needs a clean working tree"
                                          onClick={() =>
                                            arm("undo", async () => {
                                              await act("Undo commit", () => rpc().revertCommit({ directory: props.dir(), hash: d().hash }))
                                            })
                                          }
                                        >
                                          {armed() === "undo" ? "Confirm undo?" : "Undo commit"}
                                        </button>
                                      </div>
                                      <Show
                                        when={d().files.length > 0}
                                        fallback={<span class="ggc-hint">No file changes recorded in this commit</span>}
                                      >
                                        <div class="ggc-list" style={{ "max-height": "200px" }}>
                                          <For each={d().files}>
                                            {(f) => (
                                              <div
                                                class="ggc-cfile"
                                                style={{ cursor: "pointer" }}
                                                title={`View this commit's colored diff for ${f.path}`}
                                                onClick={() => void openDiff(realPath(f.path), d().hash)}
                                              >
                                                <span class="ggc-xy" style={commitStatusColor(f.status)}>{f.status}</span>
                                                <span class="ggc-path">{f.path}</span>
                                                <span class="ggc-stat">
                                                  {f.additions < 0 ? (
                                                    <span style={{ opacity: 0.55 }}>bin</span>
                                                  ) : (
                                                    <>
                                                      <span style={{ color: "#3fb950" }}>+{f.additions}</span>{" "}
                                                      <span style={{ color: "#f85149" }}>−{f.deletions}</span>
                                                    </>
                                                  )}
                                                </span>
                                                <button
                                                  class="ggc-btn ggc-mini"
                                                  classList={{ "ggc-btn--armed": armed() === f.path }}
                                                  disabled={busy()}
                                                  title={`Checkout ${f.path} from this commit into your working tree as a pending change (git restore --source) — see and tweak it in Changes first; needs the file clean`}
                                                  onClick={(e) => {
                                                    e.stopPropagation()
                                                    arm(f.path, async () => {
                                                      await act(`Checkout ${f.path}`, () =>
                                                        rpc().checkoutFile({ directory: props.dir(), hash: d().hash, path: f.path }),
                                                      )
                                                    })
                                                  }}
                                                >
                                                  {armed() === f.path ? "Confirm?" : "Checkout"}
                                                </button>
                                              </div>
                                            )}
                                          </For>
                                        </div>
                                      </Show>
                                    </>
                                  )}
                                </Show>
                              </Show>
                            </div>
                          </Show>
                        </>
                      )}
                    </For>
                  </div>
                </div>
              </>
              ) : (
                <div class="ggc-card" style={{ "border-color": "rgba(88,166,255,.4)" }}>
                  <div style={{ "font-weight": 600, color: "#58a6ff" }}>This folder isn't a Git repository</div>
                  <div class="ggc-hint">
                    Git can start watching this folder — nothing is changed or deleted, and nothing leaves this machine
                    until you add a remote and push. Want it back the way it was? Just delete the hidden .git folder.
                  </div>
                  <div class="ggc-row">
                    <button
                      class="ggc-btn ggc-btn--primary"
                      disabled={busy()}
                      title="git init — start tracking the files in this folder; creates a hidden .git folder and touches nothing else"
                      onClick={() => void act("Initialize repository", () => rpc().init({ directory: props.dir() }))}
                    >
                      Initialize repository
                    </button>
                    <button
                      class="ggc-refresh"
                      classList={{ "ggc-spin": busy() }}
                      disabled={busy()}
                      title="Refresh — check this folder again"
                      onClick={() => void refresh()}
                    >
                      ⟳
                    </button>
                  </div>
                </div>
              )
            )}
          </Show>
          <div class="ggc-credit">{CREDIT}</div>
        </div>
      )
    }
  },
})
