import { Mailsac, type RequestParams } from '@mailsac/api';
import type { MailsacMessage, MailsacOptions, MailsacRecipient, WaitForMessageOptions } from './types';

export type { MailsacMessage, MailsacOptions, MailsacRecipient, WaitForMessageOptions } from './types';

const MAX_TIMEOUT = 120_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

// Only these deliberately constructed errors may escape the task. Axios errors
// include headers/configuration (and therefore the API key), so never expose them.
class MailsacError extends Error {
  constructor(message: string) {
    super(`Mailsac: ${message}`);
    this.name = 'MailsacError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integerOption(value: unknown, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new MailsacError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function validEmail(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 254) return false;
  const parts = value.split('@');
  if (parts.length !== 2 || parts[0].length < 1 || parts[0].length > 64) return false;
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(parts[0])) return false;
  if (parts[0].startsWith('.') || parts[0].endsWith('.') || parts[0].includes('..')) return false;
  return parts[1].split('.').every((label) =>
    label.length <= 63 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label));
}

function isoDate(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return NaN;
  }
  return Date.parse(value);
}

function baseUrl(value: unknown): string {
  const invalid = () => new MailsacError('baseUrl must be HTTPS (or loopback HTTP), without credentials, a query, or a fragment.');
  if (value !== undefined && typeof value !== 'string') throw invalid();
  let parsed: URL;
  try { parsed = new URL(value === undefined ? 'https://mailsac.com/api' : value as string); }
  catch { throw invalid(); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) ||
      parsed.username || parsed.password || parsed.search || parsed.hash) throw invalid();
  return parsed.toString().replace(/\/+$/, '');
}

function criteriaOptions(input: unknown, defaults: { timeoutMs: number; pollIntervalMs: number }) {
  if (!isRecord(input)) throw new MailsacError('waitForMessage requires an options object.');
  if (!validEmail(input.email)) throw new MailsacError('email must be a valid email address.');
  const after = isoDate(input.receivedAfter);
  if (!Number.isFinite(after)) throw new MailsacError('receivedAfter must be an ISO date-time including its timezone.');
  for (const key of ['subject', 'subjectIncludes'] as const) {
    if (input[key] !== undefined && (typeof input[key] !== 'string' || !(input[key] as string).trim() || (input[key] as string).length > 998)) {
      throw new MailsacError(`${key} must be a non-empty string of at most 998 characters.`);
    }
  }
  if (input.from !== undefined && !validEmail(input.from)) throw new MailsacError('from must be a valid sender email address.');
  if (input.subject === undefined && input.subjectIncludes === undefined && input.from === undefined) {
    throw new MailsacError('Provide subject, subjectIncludes, or from to identify the expected message.');
  }
  return {
    email: input.email,
    after,
    subject: input.subject as string | undefined,
    subjectIncludes: input.subjectIncludes as string | undefined,
    from: input.from as string | undefined,
    timeoutMs: integerOption(input.timeoutMs, defaults.timeoutMs, 1, MAX_TIMEOUT, 'timeoutMs'),
    pollIntervalMs: integerOption(input.pollIntervalMs, defaults.pollIntervalMs, 250, 10_000, 'pollIntervalMs'),
  };
}

type Criteria = ReturnType<typeof criteriaOptions>;

function recipients(value: unknown): MailsacRecipient[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).filter((item) => typeof item.address === 'string').map((item) => ({
    address: item.address as string,
    ...(typeof item.name === 'string' ? { name: item.name } : {}),
  }));
}

function matches(message: Record<string, unknown>, criteria: Criteria): boolean {
  const received = isoDate(message.received);
  return typeof message._id === 'string' && message._id.length > 0 && message._id.length <= 256 &&
    Number.isFinite(received) && received >= criteria.after &&
    (criteria.subject === undefined || message.subject === criteria.subject) &&
    (criteria.subjectIncludes === undefined || (typeof message.subject === 'string' && message.subject.includes(criteria.subjectIncludes))) &&
    (criteria.from === undefined || recipients(message.from).some((sender) => sender.address.toLowerCase() === criteria.from!.toLowerCase()));
}

function retryAfterMs(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(String(value));
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

/** Register these tasks inside setupNodeEvents; this module must never be imported by browser tests. */
export function createMailsacTasks(options: MailsacOptions = {}) {
  if (!isRecord(options)) throw new MailsacError('createMailsacTasks requires an options object.');
  const apiKey = options.apiKey === undefined ? process.env.MAILSAC_API_KEY : options.apiKey;
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey)) {
    throw new MailsacError('Set MAILSAC_API_KEY in the Node process or pass apiKey to createMailsacTasks.');
  }
  const defaults = {
    timeoutMs: integerOption(options.timeoutMs, 30_000, 1, MAX_TIMEOUT, 'timeoutMs'),
    pollIntervalMs: integerOption(options.pollIntervalMs, 1000, 250, 10_000, 'pollIntervalMs'),
  };
  const client = new Mailsac({
    baseURL: baseUrl(options.baseUrl),
    headers: { 'Mailsac-Key': apiKey, 'User-Agent': '@mailsac/cypress' },
    // Never forward the API key to a redirect destination.
    maxRedirects: 0,
    maxContentLength: MAX_RESPONSE_BYTES,
    maxBodyLength: MAX_RESPONSE_BYTES,
  });

  return {
    'mailsac:waitForMessage': async (input: WaitForMessageOptions): Promise<MailsacMessage> => {
      const criteria = criteriaOptions(input, defaults);
      const deadline = performance.now() + criteria.timeoutMs;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), criteria.timeoutMs);
      const timeoutError = () => new MailsacError(`Timed out after ${criteria.timeoutMs} ms waiting for a matching email. Check the recipient, receivedAfter, and message filters.`);
      const remaining = () => {
        const ms = Math.ceil(deadline - performance.now());
        if (ms <= 0 || controller.signal.aborted) throw timeoutError();
        return ms;
      };
      const sleep = async (ms: number) => {
        const duration = Math.min(ms, remaining());
        await new Promise<void>((resolve) => {
          const finish = () => { clearTimeout(delay); controller.signal.removeEventListener('abort', finish); resolve(); };
          const delay = setTimeout(finish, duration);
          controller.signal.addEventListener('abort', finish, { once: true });
        });
        remaining();
      };
      const request = async <T>(operation: (params: RequestParams) => Promise<{ data: T }>): Promise<T> => {
        for (;;) {
          try {
            const response = await operation({ signal: controller.signal, timeout: remaining(), maxRedirects: 0 });
            remaining();
            return response.data;
          } catch (error: unknown) {
            if (error instanceof MailsacError) throw error;
            if (controller.signal.aborted || (isRecord(error) && error.code === 'ECONNABORTED')) throw timeoutError();
            remaining();
            const response = isRecord(error) && isRecord(error.response) ? error.response : undefined;
            const status = response && typeof response.status === 'number' ? response.status : undefined;
            if (status === 429 || (status !== undefined && status >= 500 && status <= 599)) {
              const headers = response && isRecord(response.headers) ? response.headers : undefined;
              await sleep(Math.max(criteria.pollIntervalMs, retryAfterMs(headers?.['retry-after'])));
              continue;
            }
            if (status === 401 || status === 403) {
              throw new MailsacError(`API access denied (HTTP ${status}). Check the Node-side API key and inbox permissions.`);
            }
            if (status !== undefined) throw new MailsacError(`API request failed (HTTP ${status}).`);
            throw new MailsacError('API request failed. Check connectivity and baseUrl.');
          }
        }
      };

      try {
        const email = encodeURIComponent(criteria.email);
        for (;;) {
          const messages: unknown = await request((params) => client.messages.listMessages(email, { limit: 100 }, params));
          if (!Array.isArray(messages)) throw new MailsacError('API returned an invalid message list.');
          const matching = messages.filter(isRecord).filter((message) => matches(message, criteria))
            .sort((a, b) => isoDate(b.received) - isoDate(a.received));
          if (matching.length) {
            const id = matching[0]._id as string;
            if (/\p{C}/u.test(id) || id === '.' || id === '..') throw new MailsacError('API returned an invalid message identifier.');
            const encodedId = encodeURIComponent(id);
            const metadata: unknown = await request((params) => client.messages.getMessageMetadata(email, encodedId, params));
            if (!isRecord(metadata) || metadata._id !== id || !matches(metadata, criteria)) {
              throw new MailsacError('API returned inconsistent message metadata.');
            }
            const text: unknown = await request((params) => client.messages.getBodyPlainText(email, encodedId, undefined, { ...params, format: 'text' }));
            if (typeof text !== 'string') throw new MailsacError('API returned invalid message text.');
            return {
              _id: id,
              subject: typeof metadata.subject === 'string' ? metadata.subject : '',
              received: new Date(isoDate(metadata.received)).toISOString(),
              to: recipients(metadata.to),
              from: recipients(metadata.from),
              links: Array.isArray(metadata.links) ? metadata.links.filter((link): link is string => typeof link === 'string') : [],
              text,
            };
          }
          await sleep(criteria.pollIntervalMs);
        }
      } catch (error: unknown) {
        if (error instanceof MailsacError) throw error;
        throw new MailsacError('Could not retrieve the expected email. Check task configuration and connectivity.');
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    },
  };
}
