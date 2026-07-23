import { prisma } from "../prisma";
import { config } from "../config";
import {
  sendEmail,
  reportPostedEmail,
  reportReplyEmail,
  privateMessageEmail,
  announcementEmail,
} from "./email";
import { COMMENT_CATEGORIES } from "./comments";

// Best-effort activity notifications. Every function is fire-and-forget and never
// throws — a failed lookup or email must never break the action that triggered it.
// Anonymity is preserved: emails carry no reporter/replier identity.

function trunc(s: string, n = 140): string {
  const t = s.trim();
  if (!t) return "(no text)";
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function categoryLabel(value: string): string {
  return COMMENT_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

const pmPilotUrl = (id: string) => `${config.appUrl}/pilots/${id}`;
const participantPilotUrl = (id: string) => `${config.appUrl}/participate/${id}`;

async function safeSend(msg: Parameters<typeof sendEmail>[0]): Promise<void> {
  try {
    await sendEmail(msg);
  } catch (err) {
    console.error("[notify] email failed:", (err as Error).message);
  }
}

/** New report posted → email the pilot's PM (the organizer). */
export async function notifyNewReport(commentId: string): Promise<void> {
  try {
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        pilot: {
          select: {
            id: true,
            name: true,
            application: { select: { owner: { select: { id: true, email: true } } } },
          },
        },
      },
    });
    if (!comment) return;
    const pm = comment.pilot.application.owner;
    if (pm.id === comment.userId) return; // never notify the actor about their own action
    await safeSend(
      reportPostedEmail({
        to: pm.email,
        pilotName: comment.pilot.name,
        categoryLabel: categoryLabel(comment.category),
        subject: comment.subject,
        snippet: trunc(comment.body),
        url: pmPilotUrl(comment.pilot.id),
      })
    );
  } catch (err) {
    console.error("[notify] notifyNewReport failed:", (err as Error).message);
  }
}

/** New reply in a report thread → email the report author, plus the PM if they didn't write it. */
export async function notifyReply(replyId: string): Promise<void> {
  try {
    const reply = await prisma.commentReply.findUnique({
      where: { id: replyId },
      include: {
        comment: {
          select: {
            subject: true,
            body: true,
            userId: true,
            pilot: {
              select: {
                id: true,
                name: true,
                application: { select: { owner: { select: { id: true, email: true } } } },
              },
            },
          },
        },
      },
    });
    if (!reply) return;
    const c = reply.comment;
    const pm = c.pilot.application.owner;
    const replierId = reply.userId;

    // Recipients (deduped, never the replier): the report's author, and the PM.
    const targets: { userId: string; toPm: boolean }[] = [];
    if (c.userId !== replierId) targets.push({ userId: c.userId, toPm: false });
    if (pm.id !== replierId && pm.id !== c.userId) targets.push({ userId: pm.id, toPm: true });

    for (const t of targets) {
      const user = await prisma.user.findUnique({ where: { id: t.userId }, select: { email: true } });
      if (!user) continue;
      await safeSend(
        reportReplyEmail({
          to: user.email,
          pilotName: c.pilot.name,
          reportSnippet: c.subject?.trim() || trunc(c.body, 100),
          replySnippet: trunc(reply.body),
          url: t.toPm ? pmPilotUrl(c.pilot.id) : participantPilotUrl(c.pilot.id),
        })
      );
    }
  } catch (err) {
    console.error("[notify] notifyReply failed:", (err as Error).message);
  }
}

/** New private ("Ask a question") message → email the other party in the thread. */
export async function notifyPrivateMessage(messageId: string): Promise<void> {
  try {
    const msg = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      include: {
        user: { select: { id: true, name: true } },
        pilot: {
          select: {
            id: true,
            name: true,
            application: { select: { owner: { select: { id: true, email: true } } } },
          },
        },
      },
    });
    if (!msg) return;
    const pm = msg.pilot.application.owner;
    // A thread is keyed on the participant: their own messages carry
    // userId === threadUserId. Anything else is from PM/overseer staff.
    const fromParticipant = msg.userId === msg.threadUserId;

    if (fromParticipant) {
      // Participant → PM (the pilot owner).
      if (pm.id === msg.userId) return;
      await safeSend(
        privateMessageEmail({
          to: pm.email,
          pilotName: msg.pilot.name,
          fromLabel: msg.user.name?.trim() || "A participant",
          snippet: trunc(msg.body),
          url: pmPilotUrl(msg.pilot.id),
        })
      );
    } else {
      // PM/overseer → the participant.
      const participant = await prisma.user.findUnique({
        where: { id: msg.threadUserId },
        select: { email: true },
      });
      if (!participant) return;
      await safeSend(
        privateMessageEmail({
          to: participant.email,
          pilotName: msg.pilot.name,
          fromLabel: "The organizer",
          snippet: trunc(msg.body),
          url: participantPilotUrl(msg.pilot.id),
        })
      );
    }
  } catch (err) {
    console.error("[notify] notifyPrivateMessage failed:", (err as Error).message);
  }
}

/** Everyone (participants + each partner company's admin) who should receive a
 *  pilot announcement, deduped by email. Participants get the in-app link. */
export async function announcementRecipients(
  pilotId: string
): Promise<{ email: string; participant: boolean }[]> {
  const [memberships, pilotCompanies] = await Promise.all([
    prisma.membership.findMany({
      where: { pilotId },
      select: { participant: { select: { email: true } } },
    }),
    prisma.pilotCompany.findMany({
      where: { pilotId },
      select: { company: { select: { adminEmail: true } } },
    }),
  ]);

  const byEmail = new Map<string, boolean>(); // email -> isParticipant
  for (const m of memberships) {
    const e = m.participant.email.toLowerCase();
    byEmail.set(e, true);
  }
  for (const pc of pilotCompanies) {
    const e = pc.company.adminEmail.toLowerCase();
    if (!byEmail.has(e)) byEmail.set(e, false); // don't downgrade a participant
  }
  return [...byEmail.entries()].map(([email, participant]) => ({ email, participant }));
}

/** New announcement → email every participant and company admin in the pilot. */
export async function notifyAnnouncement(announcementId: string): Promise<void> {
  try {
    const ann = await prisma.announcement.findUnique({
      where: { id: announcementId },
      include: {
        pilot: { select: { id: true, name: true } },
        _count: { select: { images: true } },
      },
    });
    if (!ann) return;

    const recipients = await announcementRecipients(ann.pilot.id);
    for (const r of recipients) {
      await safeSend(
        announcementEmail({
          to: r.email,
          pilotName: ann.pilot.name,
          subject: ann.subject,
          body: ann.body,
          url: r.participant ? participantPilotUrl(ann.pilot.id) : config.appUrl,
          attachmentCount: ann._count.images,
        })
      );
    }
  } catch (err) {
    console.error("[notify] notifyAnnouncement failed:", (err as Error).message);
  }
}
