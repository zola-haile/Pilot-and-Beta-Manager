import { prisma } from "../prisma";
import { signUploadPath } from "./uploads";

// How a chat message is loaded from the DB (author + optional shared report).
const messageInclude = {
  user: { select: { id: true, name: true } },
  comment: { include: { features: true, images: true } },
} as const;

type LoadedMessage = Awaited<
  ReturnType<typeof prisma.chatMessage.findFirstOrThrow<{ include: typeof messageInclude }>>
>;

export interface ChatReportView {
  category: string;
  body: string;
  features: { id: string; name: string }[];
  images: { id: string; url: string }[];
}
export interface ChatMessageView {
  id: string;
  body: string;
  kind: "PUBLIC" | "ANNOUNCEMENT" | "PRIVATE";
  createdAt: Date;
  authorName: string | null; // null = posted anonymously
  isOrganizer: boolean; // posted by the pilot's PM (only when not anonymous)
  isMine: boolean; // posted by the viewer
  report: ChatReportView | null; // a shared report snapshot, if any
}

/**
 * Shape a message for a given viewer. Anonymity is absolute for public messages:
 * an anonymous one exposes neither the author's name nor that it came from the
 * organizer. Anonymity never applies to private DMs (they're a direct, named line).
 */
export function serializeMessage(
  m: LoadedMessage,
  viewerId: string,
  ownerPmId: string
): ChatMessageView {
  const anon = m.anonymous && m.kind !== "PRIVATE";
  const isOrganizer = !anon && m.userId === ownerPmId;
  const authorName = anon
    ? null
    : m.user.name?.trim() || (isOrganizer ? "Organizer" : "Participant");
  return {
    id: m.id,
    body: m.body,
    kind: m.kind,
    createdAt: m.createdAt,
    authorName,
    isOrganizer,
    isMine: m.userId === viewerId,
    report: m.comment
      ? {
          category: m.comment.category,
          body: m.comment.body,
          features: m.comment.features.map((f) => ({ id: f.id, name: f.name })),
          images: m.comment.images.map((i) => ({ id: i.id, url: signUploadPath(i.url) })),
        }
      : null,
  };
}

/** The public group channel (normal messages + announcements), oldest first. */
export async function listPublicChat(pilotId: string, viewerId: string, ownerPmId: string) {
  const messages = await prisma.chatMessage.findMany({
    where: { pilotId, kind: { in: ["PUBLIC", "ANNOUNCEMENT"] } },
    orderBy: { createdAt: "asc" },
    include: messageInclude,
  });
  return messages.map((m) => serializeMessage(m, viewerId, ownerPmId));
}

/** One private DM thread (between the PM and the participant `threadUserId`). */
export async function listPrivateThread(
  pilotId: string,
  threadUserId: string,
  viewerId: string,
  ownerPmId: string
) {
  const messages = await prisma.chatMessage.findMany({
    where: { pilotId, kind: "PRIVATE", threadUserId },
    orderBy: { createdAt: "asc" },
    include: messageInclude,
  });
  return messages.map((m) => serializeMessage(m, viewerId, ownerPmId));
}

/** For the PM: a summary of every participant who has an open private thread. */
export async function listPrivateThreads(pilotId: string) {
  const messages = await prisma.chatMessage.findMany({
    where: { pilotId, kind: "PRIVATE" },
    orderBy: { createdAt: "asc" },
    include: { threadUser: { select: { id: true, name: true } } },
  });
  // Company per participant, via this pilot's memberships.
  const memberships = await prisma.membership.findMany({
    where: { pilotId, participant: { userId: { not: null } } },
    include: { participant: { include: { company: { select: { name: true } } } } },
  });
  const companyByUser = new Map(
    memberships.map((m) => [m.participant.userId!, m.participant.company.name])
  );

  const threads = new Map<string, { userId: string; name: string; company: string | null; count: number; lastAt: Date }>();
  for (const m of messages) {
    if (!m.threadUserId) continue;
    const t = threads.get(m.threadUserId);
    if (t) {
      t.count += 1;
      t.lastAt = m.createdAt;
    } else {
      threads.set(m.threadUserId, {
        userId: m.threadUserId,
        name: m.threadUser?.name?.trim() || "Participant",
        company: companyByUser.get(m.threadUserId) ?? null,
        count: 1,
        lastAt: m.createdAt,
      });
    }
  }
  return [...threads.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
}

/** Load one message freshly serialized (used right after creating it). */
export async function serializeCreated(id: string, viewerId: string, ownerPmId: string) {
  const m = await prisma.chatMessage.findUniqueOrThrow({ where: { id }, include: messageInclude });
  return serializeMessage(m, viewerId, ownerPmId);
}
