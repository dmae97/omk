import { starGitHubRepo, getStarPromptSummary } from "../util/first-run-star.js";
import { OMK_REPO_URL } from "../util/version.js";

export async function starCommand(options: { status?: boolean } = {}): Promise<void> {
  if (options.status) {
    const summary = await getStarPromptSummary();
    if (!summary) {
      console.log("No star prompt state found.");
      return;
    }
    console.log(`Answered: ${summary.answered}`);
    if (summary.starred != null) console.log(`Starred: ${summary.starred}`);
    if (summary.starError) console.log(`Error: ${summary.starError}`);
    return;
  }

  const summary = await getStarPromptSummary();
  if (summary?.starred === true) {
    console.log("Already starred. Thanks! 💜");
    return;
  }

  try {
    await starGitHubRepo(OMK_REPO_URL);
    console.log("Starred! Thanks for supporting oh-my-kimi 💜");
  } catch (e) {
    console.error("Failed to star:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
