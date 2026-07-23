import { prisma } from "../prisma";
import { signUploadPath, saveDataUrlFile, SavedFile } from "./uploads";

// How a private-thread message is loaded (author + attachments).
const messageInclude = {
  user: { select: { id: true, name: true } },
  images: true,
} as const;

export interface IncomingFile {
  data: string; // data URL
  name?: string;
}

/** Persist up to 6 file attachments for a chat message. */
export async function saveChatImages(files: IncomingFile[]): Promise<SavedFile[]> {
  const saved: SavedFile[] = [];
  for (const f of files.slice(0, 6)) saved.push(await saveDataUrlFile(f.data, f.name));
  return saved;
}

type LoadedMessage = Awaited<
  ReturnType<typeof prisma.chatMessage.findFirstOrThrow<{ include: typeof messageInclude }>>
>;

export interface ChatMessageView {
  id: string;
  body: string;
  createdAt: Date;
  authorName: string | null;
  isOrganizer: boolean; // posted by the pilot's PM
  isMine: boolean; // posted by the viewer
  images: { id: string; url: string; name: string | null; mime: string | null }[]; // attachments (signed URLs)
}

/**
 * Shape a private-thread message for a given viewer. Private threads are a direct,
 * named line between the PM and one participant — never anonymous.
 */
export function serializeMessage(
  m: LoadedMessage,
  viewerId: string,
  ownerPmId: string
): ChatMessageView {
  const isOrganizer = m.userId === ownerPmId;
  return {
    id: m.id,
    body: m.body,
    createdAt: m.createdAt,
    authorName: m.user.name?.trim() || (isOrganizer ? "Organizer" : "Participant"),
    isOrganizer,
    isMine: m.userId === viewerId,
    images: m.images.map((i) => ({ id: i.id, url: signUploadPath(i.url), name: i.name, mime: i.mime })),
  };
}

/** One private thread (between the PM and the participant `threadUserId`). */
export async function listPrivateThread(
  pilotId: string,
  threadUserId: string,
  viewerId: string,
  ownerPmId: string
) {
  const messages = await prisma.chatMessage.findMany({
    where: { pilotId, threadUserId },
    orderBy: { createdAt: "asc" },
    include: messageInclude,
  });
  return messages.map((m) => serializeMessage(m, viewerId, ownerPmId));
}

/** For the PM: a summary of every participant who has an open private thread. */
export async function listPrivateThreads(pilotId: string) {
  const messages = await prisma.chatMessage.findMany({
    where: { pilotId },
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
