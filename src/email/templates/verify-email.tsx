import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import { render } from '@react-email/render';
import { EMAIL_FONTS_CSS, emailTheme as t } from './theme.js';

export interface VerifyEmailProps {
  verifyUrl: string;
  expiresInHours: number;
  deleteAfterDays: number;
}

export const VERIFY_EMAIL_SUBJECT = 'Verify your email for LinkPocket';

/** FR-A2: the verification email. Content is all ours; React escapes the link. */
export function VerifyEmail({ verifyUrl, expiresInHours, deleteAfterDays }: VerifyEmailProps) {
  return (
    <Html lang="en">
      <Head>
        <link rel="stylesheet" href={EMAIL_FONTS_CSS} />
      </Head>
      <Preview>Confirm your address to start saving links.</Preview>
      <Body style={{ backgroundColor: t.ground, margin: 0, padding: '32px 16px' }}>
        <Container
          style={{
            backgroundColor: t.surface,
            border: `1px solid ${t.border}`,
            borderRadius: 12,
            maxWidth: 480,
            padding: '32px 28px',
          }}
        >
          <Text
            style={{
              color: t.ink,
              fontFamily: t.headingFont,
              fontSize: 18,
              fontWeight: 600,
              margin: '0 0 24px',
            }}
          >
            LinkPocket<span style={{ color: t.accent }}>.</span>
          </Text>
          <Heading
            as="h1"
            style={{
              color: t.ink,
              fontFamily: t.headingFont,
              fontSize: 26,
              fontWeight: 600,
              lineHeight: '32px',
              margin: '0 0 12px',
            }}
          >
            Verify your email
          </Heading>
          <Text style={{ color: t.ink, fontFamily: t.bodyFont, fontSize: 16, lineHeight: '24px' }}>
            Confirm this address to finish setting up your account and start saving links.
          </Text>
          <Section style={{ margin: '28px 0' }}>
            <Button
              href={verifyUrl}
              style={{
                backgroundColor: t.ink,
                borderRadius: 8,
                color: t.ground,
                fontFamily: t.bodyFont,
                fontSize: 16,
                fontWeight: 700,
                padding: '14px 24px',
              }}
            >
              Verify email
            </Button>
          </Section>
          <Text
            style={{ color: t.muted, fontFamily: t.bodyFont, fontSize: 14, lineHeight: '20px' }}
          >
            The link works once and expires in {expiresInHours} hours. If the button does not work,
            paste this address into your browser:
          </Text>
          <Text
            style={{
              color: t.ink,
              fontFamily: t.monoFont,
              fontSize: 13,
              lineHeight: '20px',
              wordBreak: 'break-all',
            }}
          >
            {verifyUrl}
          </Text>
          <Text
            style={{ color: t.muted, fontFamily: t.bodyFont, fontSize: 14, lineHeight: '20px' }}
          >
            Did not sign up? Ignore this email. Unverified accounts are deleted after{' '}
            {deleteAfterDays} days.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export async function renderVerifyEmail(
  props: VerifyEmailProps,
): Promise<{ subject: string; html: string; text: string }> {
  const element = <VerifyEmail {...props} />;
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: VERIFY_EMAIL_SUBJECT, html, text };
}
