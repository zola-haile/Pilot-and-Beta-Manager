import { prisma } from "../prisma";
import { HttpError } from "./http";
import { pilotStatus } from "./pilotStatus";
import { pilotedFeatures } from "./pilotFeatures";

// The complete, structured dump of one pilot's data. Kept role-agnostic and free
// of presentation concerns so it can back a JSON download, per-dataset CSVs, or
// (later) a push into Productboard. Report anonymity is preserved — anonymous
// reports/replies never carry an identity here either.
export async function buildPilotExport(pilotId: string) {
  const pilot = await prisma.pilot.findUnique({
    where: { id: pilotId },
    include: { application: { select: { name: true, ownerId: true } } },
  });
  if (!pilot) throw new HttpError(404, "Pilot not found");

  const features = await pilotedFeatures(pilot);
  const questions = await prisma.question.findMany({
    where: { pilotId },
    orderBy: { order: "asc" },
  });
  const questionLabel = new Map(questions.map((q) => [q.id, q.label]));

  // Identity/company lookups for this pilot's linked participants.
  const memberships = await prisma.membership.findMany({
    where: { pilotId, participant: { userId: { not: null } } },
    include: { participant: { include: { company: { select: { name: true } } } } },
  });
  const companyByUser = new Map(memberships.map((m) => [m.participant.userId!, m.participant.company.name]));
  const nameByUser = new Map(memberships.map((m) => [m.participant.userId!, m.participant.name]));
  const person = (u: { id: string; name: string | null; email: string }) => ({
    name: nameByUser.get(u.id) ?? u.name,
    email: u.email,
    company: companyByUser.get(u.id) ?? null,
  });

  // Anonymous reports/replies never carry an identity in the export.
  const anonPerson = { name: null, email: null, company: null };

  // Feedback reports (issues / ideas / praise) with triage state + public replies.
  const comments = await prisma.comment.findMany({
    where: { pilotId },
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { id: true, name: true, email: true } },
      features: { select: { name: true } },
      images: { select: { id: true } },
      theme: { select: { name: true } },
      replies: {
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  });
  const commentsOut = comments.map((c) => ({
    id: c.id,
    category: c.category,
    subject: c.subject,
    body: c.body,
    status: c.status,
    priority: c.priority,
    assignee: c.assignee,
    theme: c.theme?.name ?? null,
    features: c.features.map((f) => f.name),
    imageCount: c.images.length,
    createdAt: c.createdAt,
    anonymous: c.anonymous,
    author: c.anonymous ? anonPerson : person(c.user),
    replies: c.replies.map((r) => ({
      id: r.id,
      body: r.body,
      createdAt: r.createdAt,
      anonymous: r.anonymous,
      author: r.anonymous ? anonPerson : person(r.user),
    })),
  }));

  // Survey responses (structured answers, keyed by question label).
  const submissions = await prisma.submission.findMany({
    where: { pilotId, submittedAt: { not: null } },
    orderBy: { submittedAt: "asc" },
    include: { user: { select: { id: true, name: true, email: true } }, answers: true },
  });
  const responsesOut = submissions.map((s) => ({
    id: s.id,
    submittedAt: s.submittedAt,
    participant: person(s.user),
    answers: Object.fromEntries(
      s.answers.map((a) => [questionLabel.get(a.questionId) ?? a.questionId, a.value])
    ),
  }));

  // Feature star-ratings: per-participant entries + a per-feature summary.
  const ratings = await prisma.featureRating.findMany({
    where: { pilotId },
    include: { user: { select: { id: true, name: true, email: true } }, feature: { select: { id: true, name: true } } },
  });
  const ratingEntries = ratings.map((r) => ({
    feature: r.feature.name,
    stars: r.stars,
    participant: person(r.user),
    updatedAt: r.updatedAt,
  }));
  const ratingSummary = features.map((f) => {
    const rs = ratings.filter((r) => r.feature.id === f.id);
    const average = rs.length ? rs.reduce((a, r) => a + r.stars, 0) / rs.length : null;
    return { feature: f.name, average, count: rs.length };
  });

  return {
    exportedAt: new Date().toISOString(),
    project: pilot.application.name,
    pilot: {
      id: pilot.id,
      name: pilot.name,
      description: pilot.description,
      status: pilotStatus(pilot.startDate, pilot.endDate),
      startDate: pilot.startDate,
      endDate: pilot.endDate,
    },
    features: features.map((f) => ({ id: f.id, name: f.name })),
    questions: questions.map((q) => ({ id: q.id, label: q.label, type: q.type, required: q.required })),
    comments: commentsOut,
    responses: responsesOut,
    featureRatings: { summary: ratingSummary, entries: ratingEntries },
  };
}

export type PilotExport = Awaited<ReturnType<typeof buildPilotExport>>;
