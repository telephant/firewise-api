import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const FROM_EMAIL = process.env.FROM_EMAIL || 'Firewise <noreply@firewise.app>';

/**
 * Send family invitation email
 */
export async function sendFamilyInvitation(
  toEmail: string,
  inviterName: string,
  familyName: string,
  inviteToken: string
): Promise<boolean> {
  if (!resend) {
    console.warn('[Email] Resend not configured, skipping email');
    console.log('[Email] Would send invitation to:', toEmail);
    console.log('[Email] Invite URL:', `${FRONTEND_URL}/fire/invite/${inviteToken}`);
    return true; // Return true in dev mode
  }

  const inviteUrl = `${FRONTEND_URL}/fire/invite/${inviteToken}`;

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: toEmail,
      subject: `${inviterName} invited you to join their family on Firewise`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a1a;">You're invited!</h1>
          <p style="font-size: 16px; color: #4a4a4a;">
            <strong>${inviterName}</strong> has invited you to join the <strong>${familyName}</strong> family on Firewise.
          </p>
          <p style="font-size: 16px; color: #4a4a4a;">
            By joining, you'll be able to view and manage shared financial data together.
          </p>
          <a href="${inviteUrl}"
             style="display: inline-block; background-color: #3b82f6; color: white;
                    padding: 12px 24px; text-decoration: none; border-radius: 6px;
                    font-weight: 600; margin: 16px 0;">
            Accept Invitation
          </a>
          <p style="font-size: 14px; color: #6a6a6a;">
            This invitation expires in 7 days.
          </p>
          <p style="font-size: 14px; color: #6a6a6a;">
            If you didn't expect this invitation, you can safely ignore this email.
          </p>
          <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;">
          <p style="font-size: 12px; color: #9a9a9a;">
            Firewise - Your Personal Finance Dashboard
          </p>
        </div>
      `,
      text: `
${inviterName} invited you to join their family on Firewise

You've been invited to join the ${familyName} family on Firewise. By joining, you'll be able to view and manage shared financial data together.

Accept the invitation: ${inviteUrl}

This invitation expires in 7 days.

If you didn't expect this invitation, you can safely ignore this email.
      `,
    });

    if (error) {
      console.error('[Email] Failed to send invitation:', error);
      return false;
    }

    console.log('[Email] Invitation sent successfully:', data?.id);
    return true;
  } catch (err) {
    console.error('[Email] Error sending invitation:', err);
    return false;
  }
}
