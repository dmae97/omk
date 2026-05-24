import { getProjectRootDiagnostics, type ProjectRootResolution } from "../../util/fs.js";
import { getOmkResourceSettings } from "../../util/resource-profile.js";
import {
  type CheckCategory,
  type DoctorOptions,
  type OmkResourceSettings,
  type DoctorCheckRun,
} from "./utils.js";
import {
  rootChecks,
  runtimeChecks,
  toolchainChecks,
  kimiChecks,
  projectChecks,
  omkChecks,
  agentYamlChecks,
  mcpSkillsChecks,
  memoryChecks,
  securityChecks,
} from "./checks.js";
import { applyDoctorFixes } from "./fix.js";
import { emitDoctorJsonReport, emitDoctorConsoleReport } from "./report.js";
import { buildDoctorPostFixCheck } from "./fix-plan.js";

function shouldVerifyDoctorFix(options: DoctorOptions): boolean {
  return options.fix === true && options.dryRun !== true && options.verifyFix !== false;
}

function buildDoctorCategories(
  root: string,
  rootResolution: ProjectRootResolution,
  resources: OmkResourceSettings
): CheckCategory[] {
  return [
    { title: "Project Root", checks: async () => rootChecks(rootResolution) },
    { title: "Runtime", checks: () => runtimeChecks(resources) },
    { title: "Toolchain", checks: () => toolchainChecks(root) },
    { title: "Primary Runtime", checks: () => kimiChecks(root, resources) },
    { title: "Project", checks: () => projectChecks(root) },
    { title: "OMK Scaffold", checks: () => omkChecks(root) },
    { title: "Agent YAML", checks: () => agentYamlChecks(root) },
    { title: "MCP & Skills", checks: () => mcpSkillsChecks(root, resources) },
    { title: "Memory", checks: () => memoryChecks(root) },
    { title: "Security", checks: () => securityChecks(root) },
  ];
}

async function runDoctorChecks(
  root: string,
  rootResolution: ProjectRootResolution,
  resources: OmkResourceSettings
): Promise<DoctorCheckRun> {
  const categories = buildDoctorCategories(root, rootResolution, resources);
  const categoryResults = await Promise.all(
    categories.map(async (cat) => {
      const results = await cat.checks();
      return { title: cat.title, results };
    })
  );
  return {
    categoryResults,
    allResults: categoryResults.flatMap(({ results }) => results),
  };
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<void> {
  const rootResolution = getProjectRootDiagnostics();
  const root = rootResolution.root;
  const resources = await getOmkResourceSettings();
  const preFixRun = shouldVerifyDoctorFix(options)
    ? await runDoctorChecks(root, rootResolution, resources)
    : undefined;
  const fixes = options.fix ? await applyDoctorFixes(root, options, rootResolution) : undefined;
  const postFixResources = options.fix ? await getOmkResourceSettings() : resources;
  const { categoryResults, allResults } = await runDoctorChecks(root, rootResolution, postFixResources);
  if (fixes?.fixPlan && preFixRun) {
    fixes.fixPlan.postCheck = buildDoctorPostFixCheck(preFixRun.allResults, allResults, fixes.fixPlan);
  }

  if (options.json) {
    emitDoctorJsonReport(allResults, rootResolution, resources, fixes, options);
    return;
  }

  await emitDoctorConsoleReport(categoryResults, allResults, fixes, options);
}
