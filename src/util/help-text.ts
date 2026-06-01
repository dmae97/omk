import { style, kimicatCliHero } from "../util/theme.js";
import { t } from "../util/i18n.js";

function fmtCommand(name: string, desc: string, tag?: string): string {
  const full = tag ? `${name} ${tag}` : name;
  const pad = Math.max(1, 22 - full.length);
  return `    ${style.mintBold(name)}${tag ? ` ${style.gray(tag)}` : ""}${" ".repeat(pad)}${style.gray(desc)}`;
}

export function buildCustomHelp(): string {
  return [
    "",
    kimicatCliHero(),
    "",
    "  " + style.purpleBold("Start Here") + style.gray(" ─────────────────────────────────────────────────────────"),
    "",
    fmtCommand("omk menu", t("cli.menuDesc")),
    fmtCommand("omk init", t("cli.initDesc")),
    fmtCommand("omk doctor", t("cli.doctorDesc")),
    fmtCommand("omk chat", t("cli.chatDesc")),
    fmtCommand("omk plan", t("cli.planDesc")),
    fmtCommand("omk hud", t("cli.hudDesc")),
    "",
    "  " + style.purpleBold("Stable") + style.gray(" ───────────────────────────────────────────────────────────"),
    "",
    fmtCommand("omk design", t("cli.designDesc")),
    fmtCommand("omk google", t("cli.googleDesc")),
    fmtCommand("omk index", t("cli.indexDesc")),
    fmtCommand("omk lsp", t("cli.lspDesc")),
    fmtCommand("omk star", t("cmd.starDesc")),
    fmtCommand("omk update", t("cmd.updateDesc")),
    "",
    "  " + style.purpleBold("Alpha") + style.gray(" ────────────────────────────────────────────────────────────"),
    "",
    fmtCommand("omk run", t("cli.runDesc"), "[alpha]"),
    fmtCommand("omk parallel", t("cmd.parallelDesc"), "[alpha]"),
    fmtCommand("omk summary", t("cli.summaryDesc"), "[alpha]"),
    fmtCommand("omk sync", t("cli.syncDesc"), "[alpha]"),
    fmtCommand("omk verify", t("cmd.verifyDesc"), "[alpha]"),
    fmtCommand("omk goal", t("cmd.goalDesc"), "[alpha]"),
    fmtCommand("omk runs", t("cmd.runsDesc"), "[alpha]"),
    fmtCommand("omk review", t("cmd.reviewDesc"), "[alpha]"),
    "",
    "  " + style.purpleBold("Experimental") + style.gray(" ───────────────────────────────────────────────────────"),
    "",
    fmtCommand("omk team", t("cli.teamDesc"), "[experimental]"),
    fmtCommand("omk merge", t("cli.mergeDesc"), "[experimental]"),
    fmtCommand("omk specify", t("cli.specifyDesc"), "[experimental]"),
    fmtCommand("omk agent", t("cli.agentDesc"), "[experimental]"),
    fmtCommand("omk skill", t("cli.skillDesc"), "[experimental]"),
    "",
    "  " + style.purpleBold(t("cli.quickStart")) + style.gray(" ────────────────────────────────────────────────────────"),
    "",
    "    " + style.gray("$") + " " + style.cream("omk init") + "     " + style.gray(t("cli.initProject")) +
    "\n    " + style.gray("$") + " " + style.cream("omk hud") + "      " + style.gray(t("cli.viewDashboard")) +
    "\n    " + style.gray("$") + " " + style.cream("omk chat") + "     " + style.gray(t("cli.startChat")) +
    "\n    " + style.gray("$") + " " + style.cream("omk menu") + "     " + style.gray(t("cli.showMenu")),
    "",
    "  " + style.gray(t("cli.fullHelp")),
    "",
  ].join("\n");
}
