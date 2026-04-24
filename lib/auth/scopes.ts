export const REQUIRED_OAUTH_SCOPES = [
	"openid",
	"profile",
	"email",
	"offline_access",
	"api.connectors.read",
	"api.connectors.invoke",
] as const;

export const SCOPE = REQUIRED_OAUTH_SCOPES.join(" ");

function parseOAuthScope(scope: string | undefined): Set<string> {
	return new Set(
		(scope ?? "")
			.split(/\s+/)
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0),
	);
}

export function getMissingRequiredOAuthScopes(scope: string | undefined): string[] {
	const granted = parseOAuthScope(scope);
	return REQUIRED_OAUTH_SCOPES.filter((required) => !granted.has(required));
}

export function hasRequiredOAuthScopes(scope: string | undefined): boolean {
	return getMissingRequiredOAuthScopes(scope).length === 0;
}
