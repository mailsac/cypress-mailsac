// Browser-safe exports. Node tasks and credentials live in the separate /node entry point.
export { extractLink, extractCode } from './extract';
export type { LinkOptions, CodeOptions } from './extract';
export type { MailsacMessage, MailsacRecipient, MailsacOptions, WaitForMessageOptions } from './types';
