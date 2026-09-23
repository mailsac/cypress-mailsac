import type { MailsacMessage } from './types';

export interface LinkOptions {
  /** Only links with this exact origin are accepted, e.g. https://app.example.com. */
  origin: string;
  /** Optional exact URL pathname, e.g. /reset-password. */
  pathname?: string;
}

/** Return one distinct matching link; fail rather than guessing between messages or hosts. */
export function extractLink(message: Pick<MailsacMessage, 'links'>, options: LinkOptions): string {
  let origin: URL;
  try { origin = new URL(options.origin); } catch { throw new Error('Mailsac: provide a valid link origin.'); }
  if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Mailsac: link origin must be an HTTP(S) origin without a path, credentials, query or fragment.');
  }
  const matches = new Set<string>();
  for (const raw of message.links) {
    let link: URL;
    try { link = new URL(raw); } catch { continue; }
    if (link.origin === origin.origin && !link.username && !link.password &&
        ['https:', 'http:'].includes(link.protocol) &&
        (options.pathname === undefined || link.pathname === options.pathname)) {
      matches.add(link.href);
    }
  }
  if (matches.size !== 1) throw new Error(`Mailsac: expected one distinct matching link; found ${matches.size}.`);
  return matches.values().next().value!;
}

export interface CodeOptions {
  /** Regular expression source. Defaults to a standalone six-digit code. */
  pattern?: string;
  /** Supported flags: i, m, s, u. All matches are always checked. */
  flags?: string;
  /** Capture group to return; zero (the entire match) by default. */
  group?: number;
}

/** Return one distinct code; matching multiple different codes is an error. */
export function extractCode(message: Pick<MailsacMessage, 'text'>, options: CodeOptions = {}): string {
  const group = options.group ?? 0;
  const flags = options.flags ?? '';
  if (!Number.isInteger(group) || group < 0 || !/^[imsu]*$/.test(flags) || new Set(flags).size !== flags.length) {
    throw new Error('Mailsac: invalid code capture group or flags.');
  }
  let expression: RegExp;
  try { expression = new RegExp(options.pattern ?? '\\b\\d{6}\\b', flags + 'g'); }
  catch { throw new Error('Mailsac: invalid code pattern.'); }
  const codes = new Set<string>();
  for (const match of message.text.matchAll(expression)) {
    const code = match[group];
    if (code) codes.add(code);
  }
  if (codes.size !== 1) throw new Error(`Mailsac: expected one distinct matching code; found ${codes.size}.`);
  return codes.values().next().value!;
}
