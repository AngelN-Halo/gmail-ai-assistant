// Access control and request-origin checks for an internet-exposed deployment.

/**
 * Gmail accounts permitted to connect. Set ALLOWED_EMAILS to a comma-separated
 * list. This is fail-closed on purpose: an unset or empty list denies everyone.
 * Without it, anyone who finds the URL could connect their own Gmail account and
 * spend your Gmail API quota and model compute.
 */
export function isAllowedEmail(email: string): boolean {
  const raw = process.env.ALLOWED_EMAILS ?? "";
  const allowed = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (allowed.length === 0) {
    console.error(
      "ALLOWED_EMAILS is not set — refusing all sign-ins. " +
        "Set it to a comma-separated list of permitted Gmail addresses."
    );
    return false;
  }
  return allowed.includes(email.trim().toLowerCase());
}

/**
 * Reject state-changing requests that didn't originate from our own origin.
 * The session cookie is SameSite=Lax, which already blocks cross-site form
 * POSTs from carrying it; this is a second, explicit layer.
 */
export function hasValidOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  // Non-browser clients (curl, scripts) send no Origin. They also can't be
  // driven by a malicious page, so there is nothing to forge here.
  if (!origin) return true;

  const base = process.env.APP_BASE_URL;
  if (!base) return false;

  try {
    return new URL(origin).origin === new URL(base).origin;
  } catch {
    return false;
  }
}
