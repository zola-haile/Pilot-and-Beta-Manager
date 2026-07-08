import { config } from "../config";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Sends an email. The default "console" transport just logs the message to the
 * terminal so invite flows are fully testable locally with no SMTP setup.
 * Swap EMAIL_TRANSPORT=smtp (and wire a real client here) for production.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  if (config.email.transport === "console") {
    console.log(
      [
        "",
        "──────────── ✉️  EMAIL (console transport) ────────────",
        `From:    ${config.email.from}`,
        `To:      ${message.to}`,
        `Subject: ${message.subject}`,
        "",
        message.text,
        "───────────────────────────────────────────────────────",
        "",
      ].join("\n")
    );
    return;
  }

  // Placeholder for a real SMTP integration (e.g. nodemailer).
  throw new Error(
    `Email transport "${config.email.transport}" is not implemented yet.`
  );
}

// Sent to a company admin when their company is added to a pilot and they have
// not yet set up an account.
export function adminInviteEmail(params: {
  to: string;
  companyName: string;
  pilotName: string;
  setupUrl: string;
  inviterName?: string | null;
}): EmailMessage {
  const inviter = params.inviterName ?? "A pilot organizer";
  return {
    to: params.to,
    subject: `${params.companyName} was added to the "${params.pilotName}" pilot`,
    text: [
      `${inviter} added ${params.companyName} to the "${params.pilotName}" pilot program`,
      `and made you the company administrator.`,
      "",
      "Set up your account to invite your team and manage participation:",
      params.setupUrl,
      "",
      "As admin you can invite as many people as you like (by email or a shareable",
      "link), and optionally take part in the pilot yourself.",
    ].join("\n"),
  };
}

// Sent to a company admin who already has an account when added to a new pilot.
export function adminNotifyEmail(params: {
  to: string;
  companyName: string;
  pilotName: string;
  manageUrl: string;
  inviterName?: string | null;
}): EmailMessage {
  const inviter = params.inviterName ?? "A pilot organizer";
  return {
    to: params.to,
    subject: `${params.companyName} was added to the "${params.pilotName}" pilot`,
    text: [
      `${inviter} added ${params.companyName} to the "${params.pilotName}" pilot program.`,
      "",
      "Open your admin dashboard to invite your team and manage participation:",
      params.manageUrl,
    ].join("\n"),
  };
}

// Sent when a PM manually invites a company's admin (not tied to a pilot).
export function adminSetupEmail(params: {
  to: string;
  companyName: string;
  setupUrl: string;
  inviterName?: string | null;
}): EmailMessage {
  const inviter = params.inviterName ?? "A pilot organizer";
  return {
    to: params.to,
    subject: `You're the admin for ${params.companyName}`,
    text: [
      `${inviter} made you the administrator for ${params.companyName} in their pilot program.`,
      "",
      "Set up your account to invite your team and manage participation:",
      params.setupUrl,
      "",
      "As admin you can invite as many people as you like (by email or a shareable",
      "link), and optionally take part in pilots yourself.",
    ].join("\n"),
  };
}

// Sent when the admin already has an account (manual re-send).
export function adminReminderEmail(params: {
  to: string;
  companyName: string;
  manageUrl: string;
  inviterName?: string | null;
}): EmailMessage {
  return {
    to: params.to,
    subject: `Reminder: you administer ${params.companyName}`,
    text: [
      `You're the administrator for ${params.companyName}. Open your admin dashboard to invite`,
      "your team and manage participation:",
      params.manageUrl,
    ].join("\n"),
  };
}

export function inviteEmail(params: {
  to: string;
  pilotName: string;
  inviteUrl: string;
  inviterName?: string | null;
}): EmailMessage {
  const inviter = params.inviterName ? `${params.inviterName} has` : "You have been";
  return {
    to: params.to,
    subject: `You're invited to the "${params.pilotName}" pilot`,
    text: [
      `${inviter} invited you to take part in the "${params.pilotName}" pilot program.`,
      "",
      "Open this link to accept the invitation and get started:",
      params.inviteUrl,
      "",
      "If you weren't expecting this, you can ignore this email.",
    ].join("\n"),
  };
}
