import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const script = join(root, "scripts/github-release.sh");

// Answers `gh api <path>` with the HTTP status named for releases or tags and logs every call.
const fakeGh = `#!/bin/bash
echo "$*" >> "$GH_LOG"
if [ "$1" = api ]; then
  case "$2" in
    */releases/tags/*) status="$RELEASE_STATUS" ;;
    */git/ref/tags/*) status="$TAG_STATUS" ;;
  esac
  [ "$status" = 200 ] && exit 0
  echo "gh: request failed (HTTP $status)" >&2
  exit 1
fi
`;

describe("GitHub release step", () => {
	let dir: string;
	let version: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "github-release-"));
		await writeFile(join(dir, "gh"), fakeGh);
		await chmod(join(dir, "gh"), 0o755);
		version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	async function release(releaseStatus: number, tagStatus: number) {
		const log = join(dir, "calls.log");
		await writeFile(log, "");
		const result = await run("bash", [script], {
			cwd: root,
			env: {
				...process.env,
				PATH: `${dir}:${process.env.PATH}`,
				GH_LOG: log,
				RELEASE_STATUS: String(releaseStatus),
				TAG_STATUS: String(tagStatus),
				GITHUB_REPOSITORY: "sferarc/vscode-ai-gateway",
				GITHUB_SHA: "abc123",
			},
		}).then(
			(r) => ({ ok: true, stderr: r.stderr }),
			(e: { stderr: string }) => ({ ok: false, stderr: e.stderr }),
		);
		const calls = (await readFile(log, "utf8")).trim().split("\n");
		return { ...result, calls };
	}

	it("skips when the release exists", async () => {
		const { ok, calls } = await release(200, 200);

		expect(ok).toBe(true);
		expect(calls.some((c) => c.startsWith("release create"))).toBe(false);
	});

	it("creates the release from an existing tag", async () => {
		const { ok, calls } = await release(404, 200);

		expect(ok).toBe(true);
		expect(calls).toContain(
			`release create v${version} --verify-tag --title v${version} --generate-notes`,
		);
	});

	it("creates the tag and release at this commit when neither exists", async () => {
		const { ok, calls } = await release(404, 404);

		expect(ok).toBe(true);
		expect(calls).toContain(
			`release create v${version} --target abc123 --title v${version} --generate-notes`,
		);
	});

	it("fails without creating when the release lookup errors", async () => {
		const { ok, stderr, calls } = await release(403, 404);

		expect(ok).toBe(false);
		expect(stderr).toContain("HTTP 403");
		expect(calls.some((c) => c.startsWith("release create"))).toBe(false);
	});
});
