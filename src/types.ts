/** Options for the Node-side tasks. Never put the API key in Cypress.env(). */
export interface MailsacOptions {
  /** Defaults to the MAILSAC_API_KEY environment variable in the Node process. */
  apiKey?: string;
  /** Defaults to https://mailsac.com/api. HTTP is allowed only on loopback. */
  baseUrl?: string;
  /** Total wait, including API requests and retries. Default 30,000; maximum 120,000. */
  timeoutMs?: number;
  /** Default 1,000; minimum 250; maximum 10,000. */
  pollIntervalMs?: number;
}

/** Identify a new message without deleting other messages in the inbox. */
export interface WaitForMessageOptions {
  email: string;
  /** Capture new Date().toISOString() immediately before triggering your email. */
  receivedAfter: string;
  /** Exact, case-sensitive subject. At least one subject/from matcher is required. */
  subject?: string;
  /** Case-sensitive text that must occur in the subject. */
  subjectIncludes?: string;
  /** Sender address (not its display name); compared case-insensitively. */
  from?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface MailsacRecipient {
  address: string;
  name?: string;
}

/** Serializable message data returned to the browser; credentials remain in Node. */
export interface MailsacMessage {
  _id: string;
  subject: string;
  received: string;
  to: MailsacRecipient[];
  from: MailsacRecipient[];
  links: string[];
  text: string;
}
