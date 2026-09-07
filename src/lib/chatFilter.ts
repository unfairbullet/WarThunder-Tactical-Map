// Spam filter for game chat / kill feed. Drops disconnect notices, raw
// disconnect error codes, and client error lines — everything else stays.

const SPAM_PATTERNS: RegExp[] = [
  /has disconnected from the game\.?/i,
  /NET_PLAYER_DISCONNECT/i,
  /td! kd\?/i,
  /\/error\//i,
];

export function isSpamMessage(msg: string | undefined | null): boolean {
  if (!msg) return false;
  return SPAM_PATTERNS.some((re) => re.test(msg));
}

// Strips game markup tags like <color=#FF96966E>...</color> from message text.
// Nothing legitimate in these feeds uses angle brackets.
export function stripMarkup(msg: string | undefined | null): string {
  if (!msg) return "";
  return msg.replace(/<[^>]*>/g, "").trim();
}
