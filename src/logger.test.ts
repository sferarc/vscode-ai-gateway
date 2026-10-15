import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
	window: {
		createOutputChannel: vi.fn(() => ({
			error: vi.fn(),
			warn: vi.fn(),
			info: vi.fn(),
			debug: vi.fn(),
			dispose: vi.fn(),
		})),
	},
}));

import { extractErrorMessage } from "./logger";

describe("Logger", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
	});

	it("does not throw when logging before initialization or after dispose", async () => {
		const { initializeLogger, logger } = await import("./logger");
		expect(() => logger.info("test")).not.toThrow();
		const disposable = initializeLogger();
		expect(() => disposable.dispose()).not.toThrow();
	});
});

describe("extractErrorMessage", () => {
	it.each([
		[new Error("Something went wrong"), "Something went wrong"],
		["Raw error string", "Raw error string"],
		[{ message: "Object error" }, "Object error"],
		[null, "An unexpected error occurred"],
		[undefined, "An unexpected error occurred"],
		[123, "An unexpected error occurred"],
	])("extracts message from %p", (input, expected) => {
		expect(extractErrorMessage(input)).toBe(expected);
	});

	it("appends the cause chain of a fetch failure", () => {
		const socket = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), {
			code: "ECONNREFUSED",
		});
		const error = new TypeError("fetch failed", { cause: socket });
		expect(extractErrorMessage(error)).toBe("fetch failed (connect ECONNREFUSED 127.0.0.1:443)");
	});

	it("adds the code when the cause message lacks it", () => {
		const timeout = Object.assign(new Error("Connect Timeout Error"), {
			code: "UND_ERR_CONNECT_TIMEOUT",
		});
		const error = new TypeError("fetch failed", { cause: timeout });
		expect(extractErrorMessage(error)).toBe(
			"fetch failed (Connect Timeout Error [UND_ERR_CONNECT_TIMEOUT])",
		);
	});

	it("walks nested causes up to three levels and skips duplicates", () => {
		const root = new Error("level 4", { cause: new Error("level 5") });
		const third = new Error("level 2", { cause: new Error("level 3", { cause: root }) });
		const error = new Error("top", { cause: new Error("level 2", { cause: third }) });
		expect(extractErrorMessage(error)).toBe("top (level 2: level 3: level 4)");
	});

	it("stops on a cyclic cause", () => {
		const a = new Error("a");
		const b = new Error("b", { cause: a });
		Object.assign(a, { cause: b });
		expect(extractErrorMessage(a)).toBe("a (b)");
	});
});
