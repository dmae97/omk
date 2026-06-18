/**
 * Skills inventory selector.
 *
 * Renders the skills currently loaded by the active session. Read-only:
 * does not invoke or modify any skill. ESC/Ctrl+C close the selector.
 */

import { Container, getKeybindings, Spacer, Text } from "@earendil-works/omk-tui";
import type { ResourceDiagnostic } from "../../../core/resource-loader.ts";
import type { Skill } from "../../../core/skills.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint, rawKeyHint } from "./keybinding-hints.ts";

export interface SkillsSelectorInput {
	skills: ReadonlyArray<Skill>;
	diagnostics: ReadonlyArray<ResourceDiagnostic>;
	enableSkillCommands: boolean;
}

export class SkillsSelectorComponent extends Container {
	private skills: ReadonlyArray<Skill>;
	private selectedIndex = 0;
	private listContainer: Container;
	private detailContainer: Container;
	private onCancelCallback: () => void;

	constructor(input: SkillsSelectorInput, onCancel: () => void) {
		super();

		this.skills = input.skills;
		this.onCancelCallback = onCancel;

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		this.addChild(new Text(theme.fg("accent", theme.bold("Skills")), 1, 0));
		this.addChild(
			new Text(
				theme.fg(
					"muted",
					`  ${this.skills.length} loaded · slash commands ${input.enableSkillCommands ? "enabled" : "disabled"}`,
				),
				1,
				0,
			),
		);
		this.addChild(new Spacer(1));

		if (!input.enableSkillCommands) {
			this.addChild(
				new Text(theme.fg("warning", "  Skill slash commands are disabled. Toggle via /settings."), 1, 0),
			);
			this.addChild(new Spacer(1));
		}

		for (const diag of input.diagnostics.slice(0, 5)) {
			const tone = diag.type === "warning" || diag.type === "collision" ? "warning" : "error";
			this.addChild(new Text(theme.fg(tone, `  ${diag.type}: ${diag.message}`), 1, 0));
		}
		if (input.diagnostics.length > 0) {
			this.addChild(new Spacer(1));
		}

		this.listContainer = new Container();
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));

		this.detailContainer = new Container();
		this.addChild(this.detailContainer);
		this.addChild(new Spacer(1));

		this.addChild(
			new Text(
				rawKeyHint("↑↓", "navigate") +
					"  " +
					keyHint("tui.select.confirm", "details") +
					"  " +
					keyHint("tui.select.cancel", "close"),
				1,
				0,
			),
		);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		this.updateList();
		this.updateDetail();
	}

	private updateList(): void {
		this.listContainer.clear();
		if (this.skills.length === 0) {
			this.listContainer.addChild(new Text(theme.fg("muted", "  No skills loaded."), 1, 0));
			return;
		}
		for (let i = 0; i < this.skills.length; i++) {
			const skill = this.skills[i];
			const isSelected = i === this.selectedIndex;
			const name = isSelected ? theme.fg("accent", `→ ${skill.name}`) : `  ${skill.name}`;
			const scopeTag = theme.fg("muted", ` [${skill.sourceInfo.scope}]`);
			const tail = skill.disableModelInvocation ? theme.fg("dim", " · model-invocation off") : "";
			this.listContainer.addChild(new Text(`${name}${scopeTag}${tail}`, 1, 0));
		}
	}

	private updateDetail(): void {
		this.detailContainer.clear();
		const skill = this.skills[this.selectedIndex];
		if (!skill) return;
		const desc = (skill.description || "").trim();
		const oneLine = desc.length > 200 ? `${desc.slice(0, 197)}...` : desc;
		this.detailContainer.addChild(new Text(theme.fg("muted", `  ${oneLine || "(no description)"}`), 1, 0));
		this.detailContainer.addChild(new Text(theme.fg("muted", `  path: ${skill.filePath}`), 1, 0));
		this.detailContainer.addChild(
			new Text(theme.fg("muted", `  source: ${skill.sourceInfo.source} · scope: ${skill.sourceInfo.scope}`), 1, 0),
		);
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.up")) {
			if (this.skills.length === 0) return;
			this.selectedIndex = this.selectedIndex === 0 ? this.skills.length - 1 : this.selectedIndex - 1;
			this.updateList();
			this.updateDetail();
		} else if (kb.matches(keyData, "tui.select.down")) {
			if (this.skills.length === 0) return;
			this.selectedIndex = this.selectedIndex === this.skills.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
			this.updateDetail();
		} else if (kb.matches(keyData, "tui.select.confirm")) {
			this.updateDetail();
		} else if (kb.matches(keyData, "tui.select.cancel")) {
			this.onCancelCallback();
		}
	}
}
