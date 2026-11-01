import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workflow = fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url));

function step(source: string, name: string): string {
	const start = source.indexOf(`- name: ${name}`);
	expect(start, `step "${name}"`).toBeGreaterThan(-1);
	const next = source.indexOf("\n      - ", start + 1);
	return next === -1 ? source.slice(start) : source.slice(start, next);
}

function runScript(stepSource: string): string {
	const lines = stepSource.split("\n");
	const body = lines.slice(lines.findIndex((line) => line.trim() === "run: |") + 1);
	return body
		.filter((line) => line.trim() !== "")
		.map((line) => line.replace(/^ {10}/, ""))
		.join("\n");
}

async function runHeadCheck(stepSource: string, sha: string, remoteHead: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "release-head-"));
	try {
		const git = join(dir, "git");
		await writeFile(git, `#!/bin/sh\nprintf '%s\\trefs/heads/main\\n' '${remoteHead}'\n`);
		await chmod(git, 0o755);
		const output = join(dir, "output");
		await writeFile(output, "");
		const log = execFileSync(
			"bash",
			["--noprofile", "--norc", "-eo", "pipefail", "-c", runScript(stepSource)],
			{
				env: {
					PATH: `${dir}:${process.env.PATH}`,
					GITHUB_REF: "refs/heads/main",
					GITHUB_SHA: sha,
					GITHUB_OUTPUT: output,
				},
				encoding: "utf8",
			},
		);
		return `${await readFile(output, "utf8")}${log}`;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

describe("release workflow", () => {
	it("reads the changesets action's kebab-case has-changesets output", async () => {
		const source = await readFile(workflow, "utf8");

		expect(source).toContain("steps.changesets.outputs.has-changesets == 'false'");
		expect(source).not.toContain("outputs.hasChangesets");
	});

	it("skips versioning and tagging when the run's commit is no longer the branch head", async () => {
		const source = await readFile(workflow, "utf8");
		const check = step(source, "Skip when the branch has moved on");

		expect(check).toContain("id: head");
		expect(source.indexOf(check)).toBeLessThan(
			source.indexOf("- name: Create version PR or publish"),
		);
		expect(step(source, "Create version PR or publish")).toContain(
			"if: steps.head.outputs.current == 'true'",
		);
		expect(step(source, "Tag and create GitHub release")).toContain(
			"steps.head.outputs.current == 'true'",
		);
	});

	it("marks the run current only when the remote head is its own commit", async () => {
		const check = step(await readFile(workflow, "utf8"), "Skip when the branch has moved on");

		expect(await runHeadCheck(check, "aaa", "aaa")).toBe("current=true\n");
		const stale = await runHeadCheck(check, "aaa", "bbb");
		expect(stale).toContain("current=false\n");
		expect(stale).toContain("::notice::aaa is no longer the head of refs/heads/main (now bbb)");
	});
});
