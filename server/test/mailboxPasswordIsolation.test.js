import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const emailRoutes = fs.readFileSync(new URL('../src/routes/email.routes.js', import.meta.url), 'utf8');
const emailService = fs.readFileSync(new URL('../src/services/email.service.js', import.meta.url), 'utf8');
const glondiaMailService = fs.readFileSync(new URL('../src/services/glondia-mail.service.js', import.meta.url), 'utf8');
const prismaSchema = fs.readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');

test('mailbox password changes stay inside GlondiaMail', () => {
  const transportModel = prismaSchema.match(/model EmailTransportSetting \{[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(emailRoutes, /provider-credential/);
  assert.doesNotMatch(emailService, /saveProviderCredential|providerPassword/);
  assert.doesNotMatch(glondiaMailService, /ImapFlow|mailparser|nodemailer|mailCredentialService|providerCredential|encryptedPassword|providerPassword/);
  assert.doesNotMatch(prismaSchema, /EmailProviderCredential|encryptedPassword|email_provider_credentials/);
  assert.match(transportModel, /model EmailTransportSetting/);
  assert.doesNotMatch(transportModel, /password/i);
  assert.match(prismaSchema, /model MailFolder/);
  assert.match(prismaSchema, /model MailMessage/);
  assert.match(prismaSchema, /model MailAttachment/);
  assert.doesNotMatch(prismaSchema, /providerPassword|provider_password/);
});
