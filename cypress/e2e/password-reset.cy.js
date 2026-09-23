import { extractLink, extractCode } from '../../dist/index.js';

// The test runner starts the example and fixture API in a separate Node process.
// No real inbox, external SMTP service or live API key is involved.
describe('password reset through Mailsac tasks', () => {
  let account;

  beforeEach(() => {
    cy.request('POST', '/__fixture/reset').then(({ body }) => { account = body; });
  });

  it('ignores old/unrelated mail, polls for arrival, changes the password and signs in', () => {
    const newPassword = 'my-new-demo-password';
    let receivedAfter;
    let resetUrl;
    cy.visit('/');
    cy.contains('a', 'Forgot your password?').click();
    cy.get('input[name=email]').type(account.email);
    cy.then(() => { receivedAfter = new Date().toISOString(); });
    cy.contains('button', 'Send reset email').click();
    cy.get('[role=status]').should('contain', 'a reset email is on its way');

    cy.then(() => cy.mailsacWaitForMessage({
      email: account.email,
      receivedAfter,
      subject: 'Reset your Example App password',
      from: 'no-reply@example.test',
      timeoutMs: 10000,
      pollIntervalMs: 250,
    })).then((message) => {
      expect(message._id).to.match(/^reset-/);
      expect(Date.parse(message.received)).to.be.at.least(Date.parse(receivedAfter));
      expect(message.text).to.include('Your verification code is');
      const code = extractCode(message);
      expect(code).to.match(/^\d{6}$/);
      expect(code).not.to.equal('999999');
      resetUrl = extractLink(message, {
        origin: new URL(Cypress.config('baseUrl')).origin,
        pathname: '/reset',
      });
      expect(new URL(resetUrl).searchParams.get('token')).to.have.length(48);
      cy.visit(resetUrl);
    });

    cy.get('input[name=password]').type(newPassword, { log: false });
    cy.contains('button', 'Update password').click();
    cy.contains('h1', 'Password updated').should('be.visible');
    cy.contains('a', 'Sign in').click();
    cy.get('input[name=email]').type(account.email);
    cy.get('input[name=password]').type(account.initialPassword, { log: false });
    cy.contains('button', 'Sign in').click();
    cy.get('[role=alert]').should('contain', 'Email or password is incorrect');
    cy.get('input[name=email]').type(account.email);
    cy.get('input[name=password]').type(newPassword, { log: false });
    cy.contains('button', 'Sign in').click();
    cy.location('pathname').should('equal', '/account');
    cy.get('[role=status]').should('contain', 'signed in successfully');

    // The email link is single-use, even after the new password worked.
    cy.then(() => cy.request({ url: resetUrl, failOnStatusCode: false })).then(({ status, body }) => {
      expect(status).to.equal(400);
      expect(body).to.include('already been used');
    });
  });

  it('matches a new email by subject substring', () => {
    const receivedAfter = new Date().toISOString();
    cy.request({ method: 'POST', url: '/forgot-password', form: true, body: { email: account.email } });
    cy.mailsacWaitForMessage({
      email: account.email,
      receivedAfter,
      subjectIncludes: 'Example App password',
      timeoutMs: 10000,
      pollIntervalMs: 250,
    }).then((message) => {
      expect(message._id).to.match(/^reset-/);
      expect(message.subject).to.equal('Reset your Example App password');
    });
  });
});
