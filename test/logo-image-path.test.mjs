import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getOmkLogoImagePath } from "../dist/util/fs.js";

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("logo image path accepts safe project-relative images", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-logo-safe-"));
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  process.env.OMK_PROJECT_ROOT = projectRoot;

  try {
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await writeFile(join(projectRoot, "omk-logo.png"), Buffer.concat([PNG_HEADER, Buffer.from("tiny")]));
    await writeFile(join(projectRoot, ".omk", "config.toml"), '[theme]\nlogo_image = "omk-logo.png"\n');

    assert.equal(await getOmkLogoImagePath(), join(projectRoot, "omk-logo.png"));
  } finally {
    if (previousRoot === undefined) {
      delete process.env.OMK_PROJECT_ROOT;
    } else {
      process.env.OMK_PROJECT_ROOT = previousRoot;
    }
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("logo image path rejects absolute images unless trusted-local opt-in is set", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-logo-absolute-"));
  const outsideRoot = await mkdtemp(join(tmpdir(), "omk-logo-outside-"));
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  const previousTrust = process.env.OMK_TRUST_ABSOLUTE_LOGO_PATH;
  process.env.OMK_PROJECT_ROOT = projectRoot;
  delete process.env.OMK_TRUST_ABSOLUTE_LOGO_PATH;

  try {
    const logoPath = join(outsideRoot, "omk-logo.png");
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await writeFile(logoPath, Buffer.concat([PNG_HEADER, Buffer.from("tiny")]));
    await writeFile(join(projectRoot, ".omk", "config.toml"), `[theme]\nlogo_image = "${logoPath}"\n`);

    assert.equal(await getOmkLogoImagePath(), null);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.OMK_PROJECT_ROOT;
    } else {
      process.env.OMK_PROJECT_ROOT = previousRoot;
    }
    if (previousTrust === undefined) {
      delete process.env.OMK_TRUST_ABSOLUTE_LOGO_PATH;
    } else {
      process.env.OMK_TRUST_ABSOLUTE_LOGO_PATH = previousTrust;
    }
    await rm(projectRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});
