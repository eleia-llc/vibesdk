import { isLocalHost, isWorkersDevHostname } from '../../utils/urls';
import type { BrowserConsoleRequestFailure } from './types';

const LOCAL_PREVIEW_WARNING =
	'The console tool was pointed at a loopback preview (localhost or DEV_BROWSER_PREVIEW_ORIGIN). ' +
	'Cloudflare Browser Run cannot open that host. In production set ENVIRONMENT=prod (not dev, development, or local) ' +
	'and delete the Worker variables DEV_BROWSER_PREVIEW_ORIGIN and DEV_BROWSER_SIDECAR_URL. ' +
	'keep_vars keeps those variables after they are removed from wrangler.jsonc, so delete them in ' +
	'Workers → Settings → Variables. They are only for local `bun run dev` plus `bun run dev:browser`.';

const WORKERS_DEV_403_WARNING =
	'Cloudflare Browser Run received HTTP 403 from this workers.dev preview. Browser Run is always classified as a bot, ' +
	'and the workers.dev zone is Cloudflare\'s, so a WAF skip rule cannot be added there. ' +
	'Set CUSTOM_DOMAIN (and CUSTOM_PREVIEW_DOMAIN, when previews use another hostname) to a domain on a zone you control. ' +
	'On that zone, turn off Bot Fight Mode and Browser Integrity Check for the preview hostname. ' +
	'Allowlisting Browser Run itself needs an Enterprise WAF custom rule on Bot Detection ID. ' +
	'Also check Workers → Settings → Domains & Routes: Cloudflare Access on this Worker returns 403 because Browser Run cannot sign in. Disable Access on the preview hostname, or do not enable it for workers.dev.';

const GENERIC_403_WARNING =
	'The headless browser received HTTP 403 from the preview host. ' +
	'If Cloudflare Access is enabled for this Worker (Settings → Domains & Routes), disable it on the preview hostname. ' +
	'If the hostname is on your own zone, turn off Bot Fight Mode and Browser Integrity Check for that host. ' +
	'Browser Run identifies itself with cf-biso-request-id and cf-biso-devtools; an Enterprise WAF skip on Bot Detection ID can allow it.';

function hostnameOf(raw: string): string | undefined {
	try {
		return new URL(raw).hostname;
	} catch {
		return undefined;
	}
}

const DEV_BROWSER_VAR_NAMES = ['DEV_BROWSER_PREVIEW_ORIGIN', 'DEV_BROWSER_SIDECAR_URL'] as const;

/**
 * Deploy-summary warning. Printed only when a dev browser var is actually
 * set; an empty production deploy does not mention the console 403.
 */
export function deployDevBrowserConsoleWarning(
	...sources: Array<Record<string, string | undefined> | undefined>
): string | undefined {
	const set = DEV_BROWSER_VAR_NAMES.filter((name) => sources.some((source) => {
		const value = source?.[name];
		return typeof value === 'string' && value.trim().length > 0;
	}));
	if (set.length === 0) return undefined;
	return `${set.join(' and ')} is set. Those variables are only for local \`bun run dev\` plus \`bun run dev:browser\`. In production they point the Think console tool at a loopback sidecar, and the preview then fails (HTTP 403 on workers.dev, or a host Browser Run cannot open). Delete them under Workers → Settings → Variables and keep ENVIRONMENT=prod.`;
}

/** Returned instead of launching Browser Run when the URL is loopback. */
export function localPreviewCaptureBlock(url: string): string | undefined {
	const host = hostnameOf(url);
	if (!host || !isLocalHost(host)) return undefined;
	return LOCAL_PREVIEW_WARNING;
}

/**
 * Explain a 403 the production browser recorded against the preview host.
 * Third-party 403s are left as request failures without this warning.
 */
export function previewCaptureWarning(
	url: string,
	failures: BrowserConsoleRequestFailure[],
): string | undefined {
	const host = hostnameOf(url);
	if (!host) return undefined;
	const blocked = failures.some((failure) => {
		if (failure.status !== 403) return false;
		return hostnameOf(failure.url) === host;
	});
	if (!blocked) return undefined;
	if (isWorkersDevHostname(host)) return WORKERS_DEV_403_WARNING;
	return GENERIC_403_WARNING;
}
