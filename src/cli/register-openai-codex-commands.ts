import type { Command } from "commander";

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function addOpenAiAuthOptions(command: Command): Command {
  return command
    .option("--choice <plus-pro|business-enterprise|api-key|later>", "Onboarding path; never used as an auth bypass")
    .option("--plan <plan>", "Alias for --choice")
    .option("--run", "Run the official Codex login flow when a ChatGPT/Codex choice is selected")
    .option("--device-auth", "Use device-auth login when running Codex login")
    .option("--api-key-env <name>", "OpenAI Platform project API key environment variable", "OPENAI_API_KEY")
    .option("--json", "Output JSON");
}

function addImageOptions(command: Command): Command {
  return command
    .option("--model <model>", "OpenAI image model", "gpt-image-2")
    .option("--size <size>", "Output size, e.g. 1024x1024")
    .option("--quality <quality>", "Output quality (low|medium|high|auto)")
    .option("--background <background>", "Background (transparent|opaque|auto)")
    .option("--output-format <format>", "Output format (png|jpeg|webp)", "png")
    .option("--n <count>", "Number of images requested; OMK saves the first returned image", "1")
    .option("--api-key-env <name>", "Environment variable containing an ephemeral OpenAI Platform project API key", "OPENAI_API_KEY")
    .option("--timeout-ms <ms>", "OpenAI request timeout in milliseconds", "120000")
    .option("--json", "Output JSON");
}

export function registerOpenAiCodexCommands(program: Command): void {
  const codex = program.command("codex").description("Codex CLI integration helpers");
  addOpenAiAuthOptions(
    codex
      .command("auth")
      .description("Guide/verify Codex auth without reading ~/.codex/auth.json tokens")
  ).action(async (options) => {
    const { codexAuthCommand } = await import("../commands/codex.js");
    await codexAuthCommand(options);
  });

  const openai = program.command("openai").description("OpenAI setup helpers");
  addOpenAiAuthOptions(
    openai
      .command("setup")
      .description("Guide Codex login and OpenAI Platform API-key setup without storing OAuth or API keys")
  ).action(async (options) => {
    const { openAiSetupCommand } = await import("../commands/codex.js");
    await openAiSetupCommand(options);
  });

  const image = program.command("image").description("Generate or edit images with the OpenAI Images API");
  addImageOptions(
    image
      .command("generate <prompt>")
      .description("Generate an image with OpenAI; default model is gpt-image-2")
  ).action(async (prompt, options) => {
    const { imageGenerateCommand } = await import("../commands/image.js");
    await imageGenerateCommand(prompt, options);
  });

  addImageOptions(
    image
      .command("edit <image> <prompt>")
      .description("Edit one or more source images with OpenAI; default model is gpt-image-2")
      .option("-i, --image <path>", "Additional source image path", collectOption, [])
      .option("--mask <path>", "Optional mask image path")
  ).action(async (imagePath, prompt, options) => {
    const { imageEditCommand } = await import("../commands/image.js");
    await imageEditCommand([imagePath, ...(options.image ?? [])], prompt, options);
  });
}
