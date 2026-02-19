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

import { _resetLoggerForTesting, extractErrorMessage, initializeLogger, logger } from "./logger";

describe("Logger", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetLoggerForTesting();
	});

	it("does not throw when logging before initialization or after dispose", () => {
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
});
