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
          data: { email, name, role: "PARTICIPANT", passwordHash: await hash(password) },
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
  await prisma.feature.create({ data: { applicationId: app2.id, name: "Mobile navigation" } });
  await prisma.feature.create({ data: { applicationId: app2.id, name: "Push notifications" } });

  // --- A sample comment from Uma in Beta v2 ---
  await prisma.comment.create({
    data: {
      pilotId: beta.id,
      userId: uma.userId!,
      body: "The checkout button is hard to find on mobile — could it be more prominent?",
      category: "ENHANCEMENT",
      features: { connect: [{ id: features[0].id }, { id: features[3].id }] },
    },
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
