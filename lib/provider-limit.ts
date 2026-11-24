const HTTP_STATUS = /\bHTTP (\d{3})\b/;

const RATE_LIMIT = /would exceed your account's rate limit|rate limit (?:reached|exceeded)/i;
const USAGE_LIMIT = /reached your specified API usage limits|included Hermes usage for today is used up/i;
const REGAIN = /(?:regain access on|resets at) ([^.]+?)(?:\.|$)/i;
const CREDITS = /requires more credits|add more credits|insufficient credits|out of credits/i;
const TOKEN_LIMIT = /prompt tokens limit exceeded/i;

const PROVIDER_STATUS = new Set(["400", "402", "429"]);

export function providerLimit(error: string | null | undefined): string | null {
  const text = (error || "").trim();
  if (!text) return null;
  const status = text.match(HTTP_STATUS)?.[1];
  if (!status || !PROVIDER_STATUS.has(status)) return null;
  if (USAGE_LIMIT.test(text)) {
    const until = text.match(REGAIN)?.[1]?.trim();
    return until ? `the account's usage limit is reached until ${until}` : "the account's usage limit is reached";
  }
  if (CREDITS.test(text)) return "the account is out of credits";
  if (TOKEN_LIMIT.test(text)) return "the account's prompt-token limit is used up";
  if (RATE_LIMIT.test(text)) return "its rate limit is used up";
  return null;
}

export function providerLimitText(job: { name?: string }, machine: string, why: string, error: string): string {
  return (
    `${job.name} on ${machine}: the AI provider refused the run, because ${why}. ` +
    `Nothing in our code to fix; the next run goes through when the limit resets. The provider said: ` +
    `${error.replace(/^.*?HTTP \d{3}:\s*/s, "").trim()}`
  );
}
