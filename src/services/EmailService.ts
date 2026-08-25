import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendInviteEmail(to: string, inviteUrl: string): Promise<void> {
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to,
    subject: `You've been invited`,
    html: `
      <p>You've been invited to create an account.</p>
      <p><a href="${inviteUrl}">Click here to set up your account</a></p>
      <p>This link expires in 24 hours. If you weren't expecting this, you can ignore it.</p>
    `,
  });

  if (error) {
    throw new Error(`Failed to send invite email: ${error.message}`);
  }
}
