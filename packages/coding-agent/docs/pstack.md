# Pstack in a project

`omk init --project` installs a pinned copy of [pstack](https://github.com/backnotprop/pstack) alongside the project context files. It uses the copy included in the `open-multi-agent-kit` package; initialization performs no network install and does not run pstack scripts.

```text
.omk/
  agents/
    pstack-poteto-agent.md
    pstack-comment-sicko.md
  skills/
    pstack/
      poteto-mode/SKILL.md
      principle-*/SKILL.md
      LICENSE
      UPSTREAM.json
```

Skill discovery uses OMK's existing project skill loader. Names are prefixed `pstack-`, so the user starts the mode with `/skill:pstack-poteto-mode`. The parent supplies the absolute skill path to each delegate. Existing generic skills such as `how` retain their own names. The installed agent files are adapted for OMK's paths and its host-enforced boundaries. The bundled skill names and slash references are adapted to the `pstack-` namespace. The bundle targets OMK only: delegation uses the `subagent` extension, transcripts come from `~/.omk/agent/sessions/`, skill folders are `.omk/skills/` and `~/.omk/agent/skills/`, and waiting uses timed shell commands instead of a `/loop` command. Model roles default to `inherit-parent`, the session model, and `/skill:pstack-setup-pstack` writes `~/.omk/agent/pstack-models.md`. Where a subagent cannot override the model, every seat runs on the session model and the bundle does not claim a cross-model review. Deslop uses the OMK `omk-aislop` skill, UI control uses Playwright or CDP, and CLI control uses tmux or a PTY. The vendored `watch-pr` tool still recognizes Cursor Bugbot review comments (`CURSOR_AUTOMATION_ID`) as an external review-bot integration, not a harness dependency.

Pstack and AdaptOrch can be used in the same project: pstack adds namespaced skills and agents, while the optional AdaptOrch bridge and MCP configuration remain separate. Installation does not enable, configure, invoke, or verify AdaptOrch, and does not install an `adaptorch-route` skill. If an `adaptorch-route` skill is already available, the normal skill loader can discover it alongside pstack. Using both requires the existing AdaptOrch setup and the relevant project-agent trust; neither component grants authority to the other. See [OMK + AdaptOrch](omk-adaptorch.md) and [settings](settings.md#adaptorchbridge).

The prefix avoids collisions with ordinary unprefixed skill names, but it does not reserve the namespace. Before the first install, setup checks OMK’s default project and user skill directories and stops before writing project files if an existing skill has a bundled `pstack-*` name. Rename the existing skill or choose a separate project before retrying. This preflight does not inspect additional configured skill paths or skills added later. If a duplicate appears through those routes, OMK’s normal project-over-user precedence and collision diagnostics apply. An existing `.omk/skills/pstack` directory is preserved rather than reinstalled. Identically named project and user agents follow the existing project-over-user precedence when `agentScope: "both"` is selected.

Project agents use the existing subagent extension. Its default scope is `user`; to discover and dispatch these project definitions, choose `agentScope: "project"` or `"both"` for a subagent call. Interactive calls prompt for project-agent trust. Headless calls cannot prompt, so use project scope only for a trusted project. Installing files does not approve a repository, automatically call any agent or change the agent scope. OMK host policies and the user's instructions take priority over instructions in a skill. Some upstream skills contain scripts that may request network access, install tools or perform GitHub operations. They run only if explicitly invoked under the normal tool and permission boundaries.

OMK's Node/Vitest suite excludes tests inside the vendored `resources/pstack` tree. They are retained as upstream resources and use separate Bun or Node test runners; running them is an explicit, separate upstream operation and may install tools or packages. The exclusion does not remove OMK's own pstack integration tests.

The subagent implementation is an example extension and is not loaded merely by installing this bundle. For a global npm installation on macOS or Linux, launch it explicitly from the initialized project:

```sh
omk -e "$(npm root -g)/open-multi-agent-kit/examples/extensions/subagent/index.ts"
```

For a local npm installation, use `omk -e ./node_modules/open-multi-agent-kit/examples/extensions/subagent/index.ts` from the package root. Once the extension is loaded, invoke `/skill:pstack-poteto-mode` and ask the parent to use `pstack-poteto-agent` with `agentScope: "project"`. An interactive request for a project-agent confirmation shows that the dispatch reached the existing trust boundary; without an available extension or approval, run the work locally instead. This setup has an offline fake-worker dispatch test; it has not been verified with a live model.

The installer preserves an existing `.omk/skills/pstack` directory and each existing agent file. It does not upgrade or merge into an earlier installation. To inspect changes before installation, use `omk init --project --dry-run`. A symlink in the `.omk`, `.omk/skills`, `.omk/skills/pstack` or `.omk/agents` directory path is rejected. For a newer snapshot, review and back up local customizations before replacing the installed pstack resources.

If installation stops during publication, a `.omk/skills/.pstack-install.lock` file remains and subsequent attempts report an incomplete or concurrent installation. After confirming no installer is running, inspect and preserve any project changes in `.omk/skills/pstack`, then remove or move the incomplete directory and lock before retrying. The installer does not automatically delete that directory or its contents. A destination and collision preflight runs before context files are written, but context files may have been created before a later copy failure, so a subsequent bare launch may no longer see an empty repository. Automatic bare-launch setup warns and allows normal launch to continue after a failure; explicit `omk init --project` returns an error. Resolve the incomplete installation and explicitly run `omk init --project` to retry.

The pstack snapshot is MIT licensed, Copyright 2026 Lauren Tan. The full notice ships with the skills and in the package's `resources/pstack/LICENSE`.

## Using pstack alongside AdaptOrch

Pstack and AdaptOrch are independent, optional resources. Project initialization does not change `.omk/mcp.json`, approve an MCP server, send a task to AdaptOrch or enable the default-off reasoning bridge. If you already configured an AdaptOrch MCP server, retain that configuration and follow [MCP setup and project trust](mcp.md); loading pstack does not itself establish a connection.

After configuring the desired integration and loading the subagent extension as described above, a user can explicitly select `/skill:pstack-poteto-mode` and an existing AdaptOrch-related skill or MCP tool for the same task. The model proposes tool calls; OMK's existing project trust, tool permissions and verification checks remain in control. An AdaptOrch response is evidence or advice within its stated scope, not proof that the task is correct.

The coexistence regression uses an offline fake MCP server and confirms that pstack initialization preserves a previously trusted MCP file and an existing AdaptOrch-named skill. It exercises the OMK MCP manager, skill loader and explicit skill admission. It does not demonstrate a live AdaptOrch connection, a model's choice of tool, or an automatic AdaptOrch verification loop. See [OMK + AdaptOrch](omk-adaptorch.md) and [runtime boundaries](runtime-algorithms.md#adaptorch-and-wpl-boundary).
