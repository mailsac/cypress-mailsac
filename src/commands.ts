/// <reference types="cypress" preserve="true" />
import type { MailsacMessage, WaitForMessageOptions } from './types';

declare global {
  namespace Cypress {
    interface Chainable {
      /** Wait in Node for a new matching email. Never pass an API key here. */
      mailsacWaitForMessage(options: WaitForMessageOptions): Chainable<MailsacMessage>;
    }
  }
}

Cypress.Commands.add('mailsacWaitForMessage', (options: WaitForMessageOptions) => {
  const timeout = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120_000) {
    throw new Error('Mailsac: timeoutMs must be an integer between 1 and 120000.');
  }
  // Only public matching criteria cross the browser/Node boundary.
  const criteria: WaitForMessageOptions = {
    email: options.email,
    receivedAfter: options.receivedAfter,
    subject: options.subject,
    subjectIncludes: options.subjectIncludes,
    from: options.from,
    timeoutMs: timeout,
    pollIntervalMs: options.pollIntervalMs,
  };
  return cy.task<MailsacMessage>('mailsac:waitForMessage', criteria, {
    log: false,
    timeout: timeout + 10_000,
  });
});
