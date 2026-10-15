/** The user dismissed a prompt in the sign-in flow; callers stay quiet instead of reporting a failure. */
export class AuthCancelledError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AuthCancelledError";
	}
}
