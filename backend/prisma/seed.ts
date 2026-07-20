import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();

const token = () => randomBytes(24).toString("hex");
const hash = (pw: string) => bcrypt.hash(pw, 10);
const daysFromNow = (d: number) => new Date(Date.now() + d * 24 * 3600 * 1000);

async function main() {
  console.log("Seeding demo data…");

  // --- PM + their single application ---
  const pm = await prisma.user.create({
    data: {
      email: "pm@test.com",
      name: "Pat PM",
      role: "PM",
      passwordHash: await hash("password123"),
      emailVerifiedAt: new Date(),
    },
  });

  const app = await prisma.application.create({
    data: {
      name: "CheckoutApp",
      description: "Next-gen checkout experience we're piloting with partners.",
      ownerId: pm.id,
    },
  });

  // --- Companies (top-level, owned by the PM; each with an admin email) ---
  const cp = await prisma.company.create({
    data: { ownerId: pm.id, name: "CP Inc.", adminEmail: "admin@cp.com" },
  });
  const acme = await prisma.company.create({
    data: { ownerId: pm.id, name: "Acme Corp", adminEmail: "admin@acme.com" },
  });
  const globex = await prisma.company.create({
    data: { ownerId: pm.id, name: "Globex", adminEmail: "admin@globex.com" },
  });

  // CP Inc.'s admin has already set up their account; the others are pending.
  const cpAdmin = await prisma.user.create({
    data: {
      email: "admin@cp.com",
      name: "Casey Admin",
      role: "COMPANY_ADMIN",
      passwordHash: await hash("adminpass123"),
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.company.update({ where: { id: cp.id }, data: { adminUserId: cpAdmin.id } });

  // --- Participants (people at those companies) ---
  async function makeParticipant(
    email: string,
    name: string,
    companyId: string,
    password?: string
  ) {
    const user = password
      ? await prisma.user.create({
          data: {
            email,
            name,
            role: "PARTICIPANT",
            passwordHash: await hash(password),
            emailVerifiedAt: new Date(),
          },
        })
      : null;
    return prisma.participant.create({
      data: { companyId, email, name, userId: user?.id ?? null },
    });
  }

  const uma = await makeParticipant("uma@cp.com", "Uma Rao", cp.id, "userpass123");
  const raj = await makeParticipant("raj@cp.com", "Raj Patel", cp.id, "userpass123");
  const ana = await makeParticipant("ana@acme.com", "Ana Silva", acme.id, "userpass123");
  const bo = await makeParticipant("bo@globex.com", "Bo Chen", globex.id); // not yet accepted

  // --- Pilots ---
  const beta = await prisma.pilot.create({
    data: {
      applicationId: app.id,
      name: "Beta v2",
      description: "Second beta of the new checkout flow.",
      startDate: daysFromNow(-7),
      endDate: daysFromNow(21),
    },
  });
  const early = await prisma.pilot.create({
    data: {
      applicationId: app.id,
      name: "Early Access",
      description: "First look with our closest partners.",
      startDate: daysFromNow(-60),
      endDate: daysFromNow(-14),
    },
  });

  // --- Questions on Beta v2 ---
  const qEase = await prisma.question.create({
    data: {
      pilotId: beta.id,
      label: "How easy was onboarding?",
      type: "RATING",
      options: { min: 1, max: 5 },
      required: true,
      order: 0,
    },
  });
  const qImprove = await prisma.question.create({
    data: {
      pilotId: beta.id,
      label: "What would you improve?",
      type: "TEXTAREA",
      required: false,
      order: 1,
    },
  });

  // A question on Early Access too
  const qEarly = await prisma.question.create({
    data: { pilotId: early.id, label: "Overall impression?", type: "TEXT", order: 0 },
  });

  // --- Memberships (invitations into pilots) ---
  async function invite(pilotId: string, participantId: string, accepted: boolean) {
    return prisma.membership.create({
      data: {
        pilotId,
        participantId,
        inviteToken: token(),
        status: accepted ? "ACCEPTED" : "INVITED",
        acceptedAt: accepted ? new Date() : null,
      },
    });
  }
  await invite(beta.id, uma.id, true);
  await invite(beta.id, raj.id, true);
  await invite(beta.id, ana.id, true);
  await invite(beta.id, bo.id, false); // invited, hasn't accepted
  await invite(early.id, uma.id, true);

  // --- Companies added into pilots (PilotCompany) ---
  await prisma.pilotCompany.create({ data: { pilotId: beta.id, companyId: cp.id } });
  await prisma.pilotCompany.create({ data: { pilotId: beta.id, companyId: acme.id } });
  await prisma.pilotCompany.create({ data: { pilotId: early.id, companyId: cp.id } });

  // --- Submissions (dated entries) ---
  async function entry(
    pilotId: string,
    userId: string,
    answers: Record<string, string>,
    when: Date
  ) {
    const sub = await prisma.submission.create({
      data: { pilotId, userId, submittedAt: when, createdAt: when },
    });
    for (const [questionId, value] of Object.entries(answers)) {
      await prisma.answer.create({ data: { submissionId: sub.id, questionId, value } });
    }
  }

  await entry(beta.id, uma.userId!, { [qEase.id]: "3", [qImprove.id]: "Make it faster please" }, daysFromNow(-5));
  await entry(beta.id, uma.userId!, { [qEase.id]: "5", [qImprove.id]: "Much better now!" }, daysFromNow(-1));
  await entry(beta.id, raj.userId!, { [qEase.id]: "4", [qImprove.id]: "Clearer error messages" }, daysFromNow(-3));
  await entry(beta.id, ana.userId!, { [qEase.id]: "2", [qImprove.id]: "Confusing first step" }, daysFromNow(-2));
  await entry(early.id, uma.userId!, { [qEarly.id]: "Promising, a few rough edges" }, daysFromNow(-30));

  // --- A second application owned by the same PM (to show the apps list) ---
  const app2 = await prisma.application.create({
    data: {
      name: "MobileApp",
      description: "Companion mobile app we're piloting separately.",
      ownerId: pm.id,
    },
  });
  const dunder = await prisma.company.create({
    data: { ownerId: pm.id, name: "Dunder Mifflin", adminEmail: "admin@dundermifflin.com" },
  });
  const mobileBeta = await prisma.pilot.create({
    data: {
      applicationId: app2.id,
      name: "Mobile Closed Beta",
      description: "First mobile pilot.",
      startDate: daysFromNow(-3),
      endDate: daysFromNow(30),
    },
  });
  await prisma.pilotCompany.create({ data: { pilotId: mobileBeta.id, companyId: dunder.id } });
  // CP Inc. (used in CheckoutApp) is reused in this MobileApp pilot too — showing
  // that companies are top-level and shared across applications.
  await prisma.pilotCompany.create({ data: { pilotId: mobileBeta.id, companyId: cp.id } });
  await prisma.question.create({
    data: { pilotId: mobileBeta.id, label: "How's the mobile experience?", type: "TEXTAREA", order: 0 },
  });

  // --- Features (per application, managed by the PM) ---
  const featureNames = ["Checkout button", "Search bar", "Shopping cart", "Payment page"];
  const features = await Promise.all(
    featureNames.map((name) => prisma.feature.create({ data: { applicationId: app.id, name } }))
  );
  const mobileNav = await prisma.feature.create({
    data: { applicationId: app2.id, name: "Mobile navigation" },
  });
  await prisma.feature.create({ data: { applicationId: app2.id, name: "Push notifications" } });

  // Beta v2 tests all CheckoutApp features (the default). Add a feature-scoped
  // question so participants see a "Checkout button" section.
  await prisma.question.create({
    data: {
      pilotId: beta.id,
      featureId: features[0].id, // Checkout button
      label: "Rate the checkout button",
      type: "RATING",
      options: { min: 1, max: 5 },
      order: 2,
    },
  });

  // Mobile Closed Beta only tests a subset (Mobile navigation).
  await prisma.pilot.update({ where: { id: mobileBeta.id }, data: { allFeatures: false } });
  await prisma.pilotFeature.create({
    data: { pilotId: mobileBeta.id, featureId: mobileNav.id },
  });

  // --- A feedback theme + sample comments in Beta v2, already triaged ---
  const mobileTheme = await prisma.theme.create({
    data: {
      applicationId: app.id,
      name: "Checkout hard to find on mobile",
      description: "Several testers can't locate the checkout button on small screens.",
    },
  });

  // Canonical, prioritized, planned, and folded into the theme — with a PM note.
  const umaComment = await prisma.comment.create({
    data: {
      pilotId: beta.id,
      userId: uma.userId!,
      body: "The checkout button is hard to find on mobile — could it be more prominent?",
      category: "ENHANCEMENT",
      status: "PLANNED",
      priority: "HIGH",
      assignee: "Dana (design)",
      themeId: mobileTheme.id,
      features: { connect: [{ id: features[0].id }, { id: features[3].id }] },
      notes: {
        create: [{ body: "Reproduced on iPhone SE. Design to mock a sticky CTA for next sprint." }],
      },
    },
  });

  // A duplicate of Uma's report from another company, auto-marked DUPLICATE.
  await prisma.comment.create({
    data: {
      pilotId: beta.id,
      userId: ana.userId!,
      body: "Couldn't find how to check out on my phone. Had to switch to desktop.",
      category: "USABILITY",
      status: "DUPLICATE",
      duplicateOfId: umaComment.id,
      themeId: mobileTheme.id,
      features: { connect: [{ id: features[0].id }] },
    },
  });

  // A fresh, untriaged bug awaiting attention.
  await prisma.comment.create({
    data: {
      pilotId: beta.id,
      userId: raj.userId!,
      body: "Payment page threw an error the first time, worked on retry.",
      category: "BUG",
      priority: "CRITICAL",
      features: { connect: [{ id: features[3].id }] },
    },
  });

  // --- Feature star-ratings on Beta v2 (participants rate the piloted features) ---
  async function rate(userId: string, featureId: string, stars: number) {
    await prisma.featureRating.create({ data: { pilotId: beta.id, userId, featureId, stars } });
  }
  await rate(uma.userId!, features[0].id, 3); // Checkout button
  await rate(uma.userId!, features[1].id, 5); // Search bar
  await rate(uma.userId!, features[3].id, 4); // Payment page
  await rate(raj.userId!, features[0].id, 2);
  await rate(raj.userId!, features[3].id, 5);
  await rate(ana.userId!, features[0].id, 4);
  await rate(ana.userId!, features[1].id, 4);

  // --- Pilot chat: group channel, an announcement, a shared report, and a
  //     private thread between Uma and the PM ---
  async function chat(
    userId: string,
    body: string,
    opts: {
      kind?: "PUBLIC" | "ANNOUNCEMENT" | "PRIVATE";
      anonymous?: boolean;
      threadUserId?: string;
      commentId?: string;
      at: Date;
    }
  ) {
    await prisma.chatMessage.create({
      data: {
        pilotId: beta.id,
        userId,
        body,
        kind: opts.kind ?? "PUBLIC",
        anonymous: opts.anonymous ?? false,
        threadUserId: opts.threadUserId ?? null,
        commentId: opts.commentId ?? null,
        createdAt: opts.at,
      },
    });
  }

  // Public group channel (+ one PM announcement, one anonymous message, one shared report).
  await chat(pm.id, "Welcome to the Beta v2 channel! Drop questions and feedback here.", {
    kind: "ANNOUNCEMENT",
    at: daysFromNow(-6),
  });
  await chat(uma.userId!, "Is anyone else seeing the checkout button get cut off on mobile?", { at: daysFromNow(-5) });
  await chat(raj.userId!, "Yeah, same on my Pixel — switching to desktop worked.", { at: daysFromNow(-5) });
  await chat(uma.userId!, "Sharing my report so it's on everyone's radar 👇", {
    commentId: umaComment.id,
    at: daysFromNow(-4),
  });
  await chat(ana.userId!, "Honestly the search is great though — credit where it's due.", {
    anonymous: true,
    at: daysFromNow(-4),
  });
  await chat(pm.id, "Thanks all — a sticky checkout button is planned for next sprint.", { at: daysFromNow(-3) });

  // Private one-to-one thread between Uma and the PM.
  await chat(uma.userId!, "Quick one — could I get a few extra days to finish testing?", {
    kind: "PRIVATE",
    threadUserId: uma.userId!,
    at: daysFromNow(-2),
  });
  await chat(pm.id, "Of course, take an extra week. Thanks for the thorough feedback!", {
    kind: "PRIVATE",
    threadUserId: uma.userId!,
    at: daysFromNow(-2),
  });

  console.log("Done.");
  console.log("  PM login:            pm@test.com / password123  (2 apps: CheckoutApp, MobileApp)");
  console.log("  Company admin login: admin@cp.com / adminpass123");
  console.log("  Participant login:   uma@cp.com / userpass123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
