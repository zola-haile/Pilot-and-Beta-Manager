import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();

/* ----------------------------- helpers ------------------------------ */

const token = () => randomBytes(24).toString("hex");
const hash = (pw: string) => bcrypt.hash(pw, 10);
const daysFromNow = (d: number) => new Date(Date.now() + d * 24 * 3600 * 1000);

// Demo passwords, one per role tier.
const PM_PW = "password123";
const ADMIN_PW = "adminpass123";
const USER_PW = "userpass123";

/** Empties every table so the seed can be re-run from a clean slate. */
async function resetDatabase() {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  const tables = rows
    .map((r) => r.tablename)
    .filter((t) => t !== "_prisma_migrations")
    .map((t) => `"public"."${t}"`);
  if (tables.length === 0) return;
  // TRUNCATE ... CASCADE clears everything and resets identities in one shot.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY CASCADE;`);
}

/** A PM (org member) with a login. */
async function pm(email: string, name: string, organizationId: string, orgRole: "OWNER" | "ADMIN" | "MEMBER") {
  return prisma.user.create({
    data: { email, name, role: "PM", passwordHash: await hash(PM_PW), organizationId, orgRole, emailVerifiedAt: new Date() },
  });
}

/** A partner-company admin (the person in charge at a partner company). */
async function companyAdmin(email: string, name: string) {
  return prisma.user.create({
    data: { email, name, role: "COMPANY_ADMIN", passwordHash: await hash(ADMIN_PW), emailVerifiedAt: new Date() },
  });
}

/** A partner company owned (managed) by a PM. Pass an admin user to link a live account. */
function company(ownerId: string, name: string, adminEmail: string, adminUserId?: string) {
  return prisma.company.create({ data: { ownerId, name, adminEmail, adminUserId: adminUserId ?? null } });
}

/** A person at a partner company; give a password to create a real login. */
async function participant(email: string, name: string, companyId: string, password?: string) {
  const user = password
    ? await prisma.user.create({
        data: { email, name, role: "PARTICIPANT", passwordHash: await hash(password), emailVerifiedAt: new Date() },
      })
    : null;
  return prisma.participant.create({ data: { companyId, email, name, userId: user?.id ?? null } });
}

/** Invite a participant into a pilot (optionally already accepted). */
function invite(pilotId: string, participantId: string, accepted: boolean) {
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

/** A dated, finalized survey entry. */
async function entry(pilotId: string, userId: string, answers: Record<string, string>, when: Date) {
  const sub = await prisma.submission.create({ data: { pilotId, userId, submittedAt: when, createdAt: when } });
  for (const [questionId, value] of Object.entries(answers)) {
    await prisma.answer.create({ data: { submissionId: sub.id, questionId, value } });
  }
}

/** A participant's 1–5★ rating of a piloted feature. */
function rate(pilotId: string, userId: string, featureId: string, stars: number) {
  return prisma.featureRating.create({ data: { pilotId, userId, featureId, stars } });
}

/** A chat message (public / announcement / private DM), optionally sharing a report. */
function chat(
  pilotId: string,
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
  return prisma.chatMessage.create({
    data: {
      pilotId,
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

/* ------------------------------- seed ------------------------------- */

async function main() {
  console.log("Emptying database…");
  await resetDatabase();
  console.log("Seeding demo data…");

  /* ===== Organization + its PMs =====================================
   * Northwind Labs is the vendor team running the pilots.
   *   Pat   — OWNER  (in charge of the whole org, sees everything)
   *   Morgan — ADMIN (org-wide oversight, plus runs their own pilot)
   *   Sam   — MEMBER (only sees/manages their own work)
   * ================================================================== */
  const org = await prisma.organization.create({ data: { name: "Northwind Labs" } });
  const pat = await pm("pm@test.com", "Pat PM", org.id, "OWNER");
  const morgan = await pm("morgan@test.com", "Morgan Admin", org.id, "ADMIN");
  const sam = await pm("sam@test.com", "Sam Member", org.id, "MEMBER");

  // A fourth PM invited but not yet joined.
  await prisma.orgInvite.create({
    data: { organizationId: org.id, email: "jordan@test.com", role: "MEMBER", invitedByName: "Pat PM" },
  });

  /* ===== Partner-company admins (owners on the partner side) ========= */
  const casey = await companyAdmin("admin@cp.com", "Casey Admin"); // CP Inc.
  const ivy = await companyAdmin("admin@initech.com", "Ivy Admin"); // Initech

  /* ===== Pat's project: CheckoutApp ================================= */
  const checkout = await prisma.application.create({
    data: { name: "CheckoutApp", description: "Next-gen checkout experience we're piloting with partners.", ownerId: pat.id },
  });

  // Partner companies (CP Inc.'s admin has an account; the rest are pending).
  const cp = await company(pat.id, "CP Inc.", "admin@cp.com", casey.id);
  const acme = await company(pat.id, "Acme Corp", "admin@acme.com");
  const globex = await company(pat.id, "Globex", "admin@globex.com");

  // People at those companies.
  const uma = await participant("uma@cp.com", "Uma Rao", cp.id, USER_PW);
  const raj = await participant("raj@cp.com", "Raj Patel", cp.id, USER_PW);
  const ana = await participant("ana@acme.com", "Ana Silva", acme.id, USER_PW);
  const bo = await participant("bo@globex.com", "Bo Chen", globex.id); // invited, not joined

  // Features of the product.
  const [checkoutBtn, searchBar, cart, payment] = await Promise.all(
    ["Checkout button", "Search bar", "Shopping cart", "Payment page"].map((name) =>
      prisma.feature.create({ data: { applicationId: checkout.id, name } })
    )
  );

  // Pilots: one active, one already finished.
  const beta = await prisma.pilot.create({
    data: {
      applicationId: checkout.id,
      name: "Beta v2",
      description: "Second beta of the new checkout flow.",
      startDate: daysFromNow(-7),
      endDate: daysFromNow(21),
    },
  });
  const early = await prisma.pilot.create({
    data: {
      applicationId: checkout.id,
      name: "Early Access",
      description: "First look with our closest partners.",
      startDate: daysFromNow(-60),
      endDate: daysFromNow(-14),
    },
  });

  // Beta v2 questions (incl. one scoped to the Checkout button feature).
  const qEase = await prisma.question.create({
    data: { pilotId: beta.id, label: "How easy was onboarding?", type: "RATING", options: { min: 1, max: 5 }, required: true, order: 0 },
  });
  const qImprove = await prisma.question.create({
    data: { pilotId: beta.id, label: "What would you improve?", type: "TEXTAREA", order: 1 },
  });
  await prisma.question.create({
    data: { pilotId: beta.id, featureId: checkoutBtn.id, label: "Rate the checkout button", type: "RATING", options: { min: 1, max: 5 }, order: 2 },
  });
  const qEarly = await prisma.question.create({
    data: { pilotId: early.id, label: "Overall impression?", type: "TEXT", order: 0 },
  });

  // Roster + companies-in-pilot.
  await invite(beta.id, uma.id, true);
  await invite(beta.id, raj.id, true);
  await invite(beta.id, ana.id, true);
  await invite(beta.id, bo.id, false);
  await invite(early.id, uma.id, true);
  await prisma.pilotCompany.create({ data: { pilotId: beta.id, companyId: cp.id } });
  await prisma.pilotCompany.create({ data: { pilotId: beta.id, companyId: acme.id } });
  await prisma.pilotCompany.create({ data: { pilotId: early.id, companyId: cp.id } });

  // Submitted entries (a history over time).
  await entry(beta.id, uma.userId!, { [qEase.id]: "3", [qImprove.id]: "Make it faster please" }, daysFromNow(-5));
  await entry(beta.id, uma.userId!, { [qEase.id]: "5", [qImprove.id]: "Much better now!" }, daysFromNow(-1));
  await entry(beta.id, raj.userId!, { [qEase.id]: "4", [qImprove.id]: "Clearer error messages" }, daysFromNow(-3));
  await entry(beta.id, ana.userId!, { [qEase.id]: "2", [qImprove.id]: "Confusing first step" }, daysFromNow(-2));
  await entry(early.id, uma.userId!, { [qEarly.id]: "Promising, a few rough edges" }, daysFromNow(-30));

  // Feature star-ratings.
  await rate(beta.id, uma.userId!, checkoutBtn.id, 3);
  await rate(beta.id, uma.userId!, searchBar.id, 5);
  await rate(beta.id, uma.userId!, payment.id, 4);
  await rate(beta.id, raj.userId!, checkoutBtn.id, 2);
  await rate(beta.id, raj.userId!, payment.id, 5);
  await rate(beta.id, ana.userId!, checkoutBtn.id, 4);
  await rate(beta.id, ana.userId!, searchBar.id, 4);

  // Feedback: a triaged theme with a canonical report, a duplicate, and a fresh bug.
  const checkoutTheme = await prisma.theme.create({
    data: {
      applicationId: checkout.id,
      name: "Checkout hard to find on mobile",
      description: "Several testers can't locate the checkout button on small screens.",
    },
  });
  const umaReport = await prisma.comment.create({
    data: {
      pilotId: beta.id,
      userId: uma.userId!,
      body: "The checkout button is hard to find on mobile — could it be more prominent?",
      category: "ENHANCEMENT",
      status: "PLANNED",
      priority: "HIGH",
      assignee: "Dana (design)",
      themeId: checkoutTheme.id,
      features: { connect: [{ id: checkoutBtn.id }, { id: payment.id }] },
      notes: { create: [{ body: "Reproduced on iPhone SE. Design to mock a sticky CTA for next sprint." }] },
    },
  });
  await prisma.comment.create({
    data: {
      pilotId: beta.id,
      userId: ana.userId!,
      body: "Couldn't find how to check out on my phone. Had to switch to desktop.",
      category: "USABILITY",
      status: "DUPLICATE",
      duplicateOfId: umaReport.id,
      themeId: checkoutTheme.id,
      features: { connect: [{ id: checkoutBtn.id }] },
    },
  });
  await prisma.comment.create({
    data: {
      pilotId: beta.id,
      userId: raj.userId!,
      body: "Payment page threw an error the first time, worked on retry.",
      category: "BUG",
      priority: "CRITICAL",
      features: { connect: [{ id: payment.id }] },
    },
  });

  // Chat: announcement, public thread, an anonymous note, a shared report, and a private DM.
  await chat(beta.id, pat.id, "Welcome to the Beta v2 channel! Drop questions and feedback here.", { kind: "ANNOUNCEMENT", at: daysFromNow(-6) });
  await chat(beta.id, uma.userId!, "Is anyone else seeing the checkout button get cut off on mobile?", { at: daysFromNow(-5) });
  await chat(beta.id, raj.userId!, "Yeah, same on my Pixel — switching to desktop worked.", { at: daysFromNow(-5) });
  await chat(beta.id, uma.userId!, "Sharing my report so it's on everyone's radar.", { commentId: umaReport.id, at: daysFromNow(-4) });
  await chat(beta.id, ana.userId!, "Honestly the search is great though — credit where it's due.", { anonymous: true, at: daysFromNow(-4) });
  await chat(beta.id, pat.id, "Thanks all — a sticky checkout button is planned for next sprint.", { at: daysFromNow(-3) });
  await chat(beta.id, uma.userId!, "Quick one — could I get a few extra days to finish testing?", { kind: "PRIVATE", threadUserId: uma.userId!, at: daysFromNow(-2) });
  await chat(beta.id, pat.id, "Of course, take an extra week. Thanks for the thorough feedback!", { kind: "PRIVATE", threadUserId: uma.userId!, at: daysFromNow(-2) });

  /* ===== Pat's second project: MobileApp ============================ */
  const mobile = await prisma.application.create({
    data: { name: "MobileApp", description: "Companion mobile app we're piloting separately.", ownerId: pat.id },
  });
  const dunder = await company(pat.id, "Dunder Mifflin", "admin@dundermifflin.com");
  const [mobileNav] = await Promise.all([
    prisma.feature.create({ data: { applicationId: mobile.id, name: "Mobile navigation" } }),
    prisma.feature.create({ data: { applicationId: mobile.id, name: "Push notifications" } }),
  ]);
  const mobileBeta = await prisma.pilot.create({
    data: {
      applicationId: mobile.id,
      name: "Mobile Closed Beta",
      description: "First mobile pilot.",
      startDate: daysFromNow(-3),
      endDate: daysFromNow(30),
      allFeatures: false, // only tests a subset
    },
  });
  await prisma.pilotFeature.create({ data: { pilotId: mobileBeta.id, featureId: mobileNav.id } });
  const mobileQ = await prisma.question.create({
    data: { pilotId: mobileBeta.id, label: "How's the mobile experience?", type: "TEXTAREA", order: 0 },
  });
  // Dunder Mifflin joins; CP Inc. (shared, top-level) is reused here too.
  await prisma.pilotCompany.create({ data: { pilotId: mobileBeta.id, companyId: dunder.id } });
  await prisma.pilotCompany.create({ data: { pilotId: mobileBeta.id, companyId: cp.id } });

  const kim = await participant("kim@dundermifflin.com", "Kim Reyes", dunder.id, USER_PW);
  const leo = await participant("leo@dundermifflin.com", "Leo Novak", dunder.id, USER_PW);
  await invite(mobileBeta.id, kim.id, true);
  await invite(mobileBeta.id, leo.id, true);
  await invite(mobileBeta.id, uma.id, true); // Uma (CP Inc.) also tests the mobile pilot
  await entry(mobileBeta.id, kim.userId!, { [mobileQ.id]: "Navigation is intuitive, love the bottom tabs." }, daysFromNow(-2));
  await entry(mobileBeta.id, leo.userId!, { [mobileQ.id]: "App felt sluggish on older Android devices." }, daysFromNow(-1));
  await entry(mobileBeta.id, uma.userId!, { [mobileQ.id]: "Consistent with the web checkout — nice." }, daysFromNow(-1));
  await rate(mobileBeta.id, kim.userId!, mobileNav.id, 5);
  await rate(mobileBeta.id, leo.userId!, mobileNav.id, 3);
  await prisma.comment.create({
    data: {
      pilotId: mobileBeta.id,
      userId: leo.userId!,
      body: "Noticeable lag opening the menu on a Pixel 4a.",
      category: "PERFORMANCE",
      priority: "MEDIUM",
      features: { connect: [{ id: mobileNav.id }] },
    },
  });
  await chat(mobileBeta.id, pat.id, "Welcome to the Mobile Closed Beta! Tell us how it feels on your device.", { kind: "ANNOUNCEMENT", at: daysFromNow(-3) });
  await chat(mobileBeta.id, kim.userId!, "Bottom tab nav is a big improvement.", { at: daysFromNow(-2) });

  /* ===== Morgan's project (org ADMIN runs their own too): InsightsDashboard = */
  const insights = await prisma.application.create({
    data: { name: "InsightsDashboard", description: "Analytics dashboard Morgan is piloting.", ownerId: morgan.id },
  });
  const soylent = await company(morgan.id, "Soylent Corp", "admin@soylent.com");
  const [widgets, csvExport] = await Promise.all(
    ["Dashboard widgets", "Export to CSV", "Scheduled reports"].map((name) =>
      prisma.feature.create({ data: { applicationId: insights.id, name } })
    )
  );
  const insightsPilot = await prisma.pilot.create({
    data: {
      applicationId: insights.id,
      name: "Analytics Preview",
      description: "Preview of the new analytics dashboard.",
      startDate: daysFromNow(-10),
      endDate: daysFromNow(14),
    },
  });
  const iQ1 = await prisma.question.create({
    data: { pilotId: insightsPilot.id, label: "How useful are the default widgets?", type: "RATING", options: { min: 1, max: 5 }, order: 0 },
  });
  const iQ2 = await prisma.question.create({
    data: { pilotId: insightsPilot.id, label: "What report would you add?", type: "TEXTAREA", order: 1 },
  });
  const priya = await participant("priya@soylent.com", "Priya Nair", soylent.id, USER_PW);
  const quinn = await participant("quinn@soylent.com", "Quinn Lee", soylent.id, USER_PW);
  await invite(insightsPilot.id, priya.id, true);
  await invite(insightsPilot.id, quinn.id, true);
  await prisma.pilotCompany.create({ data: { pilotId: insightsPilot.id, companyId: soylent.id } });
  await entry(insightsPilot.id, priya.userId!, { [iQ1.id]: "4", [iQ2.id]: "A cohort retention report." }, daysFromNow(-4));
  await entry(insightsPilot.id, quinn.userId!, { [iQ1.id]: "3", [iQ2.id]: "CSV export is a must-have." }, daysFromNow(-2));
  await rate(insightsPilot.id, priya.userId!, widgets.id, 4);
  await rate(insightsPilot.id, quinn.userId!, csvExport.id, 5);
  await prisma.comment.create({
    data: {
      pilotId: insightsPilot.id,
      userId: quinn.userId!,
      body: "CSV export truncates at 1,000 rows — I need the full dataset.",
      category: "BUG",
      priority: "HIGH",
      features: { connect: [{ id: csvExport.id }] },
    },
  });
  await chat(insightsPilot.id, morgan.id, "Welcome! Poke around the dashboard and tell us what's missing.", { kind: "ANNOUNCEMENT", at: daysFromNow(-9) });
  await chat(insightsPilot.id, priya.userId!, "Loving the widgets. A retention report would be great.", { at: daysFromNow(-4) });

  /* ===== Sam's project (org MEMBER, own work only): MobileWallet ===== */
  const walletApp = await prisma.application.create({
    data: { name: "MobileWallet", description: "Sam's pilot for the new mobile wallet.", ownerId: sam.id },
  });
  const initech = await company(sam.id, "Initech", "admin@initech.com", ivy.id);
  const umbrella = await company(sam.id, "Umbrella Co", "admin@umbrella.com");
  const [tapToPay, balance, txns] = await Promise.all(
    ["Tap to pay", "Balance view", "Transaction history"].map((name) =>
      prisma.feature.create({ data: { applicationId: walletApp.id, name } })
    )
  );
  const wallet = await prisma.pilot.create({
    data: {
      applicationId: walletApp.id,
      name: "Wallet early access",
      description: "First look at the wallet for a few partners.",
      startDate: daysFromNow(-3),
      endDate: daysFromNow(25),
    },
  });
  const wQ1 = await prisma.question.create({
    data: { pilotId: wallet.id, label: "How smooth was setup?", type: "RATING", options: { min: 1, max: 5 }, required: true, order: 0 },
  });
  const wQ2 = await prisma.question.create({
    data: { pilotId: wallet.id, label: "Any friction points?", type: "TEXTAREA", order: 1 },
  });
  const finn = await participant("finn@initech.com", "Finn Wright", initech.id, USER_PW);
  const gwen = await participant("gwen@initech.com", "Gwen Ito", initech.id, USER_PW);
  const hugo = await participant("hugo@umbrella.com", "Hugo Marsh", umbrella.id); // invited, not joined
  await invite(wallet.id, finn.id, true);
  await invite(wallet.id, gwen.id, true);
  await invite(wallet.id, hugo.id, false);
  await prisma.pilotCompany.create({ data: { pilotId: wallet.id, companyId: initech.id } });
  await prisma.pilotCompany.create({ data: { pilotId: wallet.id, companyId: umbrella.id } });
  await entry(wallet.id, finn.userId!, { [wQ1.id]: "4", [wQ2.id]: "Fingerprint step took two tries." }, daysFromNow(-2));
  await entry(wallet.id, gwen.userId!, { [wQ1.id]: "5", [wQ2.id]: "Super smooth — loved tap to pay." }, daysFromNow(-1));
  await rate(wallet.id, finn.userId!, tapToPay.id, 4);
  await rate(wallet.id, finn.userId!, balance.id, 3);
  await rate(wallet.id, gwen.userId!, tapToPay.id, 5);
  await rate(wallet.id, gwen.userId!, txns.id, 4);
  await prisma.comment.create({
    data: {
      pilotId: wallet.id,
      userId: finn.userId!,
      body: "Tap to pay occasionally needs a second tap to register.",
      category: "BUG",
      priority: "MEDIUM",
      features: { connect: [{ id: tapToPay.id }] },
    },
  });
  await prisma.comment.create({
    data: {
      pilotId: wallet.id,
      userId: gwen.userId!,
      body: "Would love a running balance right on the home screen.",
      category: "FEATURE_REQUEST",
      status: "TRIAGED",
      features: { connect: [{ id: balance.id }] },
    },
  });
  await chat(wallet.id, sam.id, "Welcome to the Wallet early access channel!", { kind: "ANNOUNCEMENT", at: daysFromNow(-2) });
  await chat(wallet.id, finn.userId!, "Tap to pay is slick — sometimes needs a second tap though.", { at: daysFromNow(-2) });
  await chat(wallet.id, gwen.userId!, "Setup was painless for me!", { at: daysFromNow(-1) });

  /* ------------------------------ summary ---------------------------- */
  console.log("Done.  Organization: Northwind Labs\n");
  console.log(`  PMs / owners (${PM_PW}):`);
  console.log("    pm@test.com       OWNER  · CheckoutApp (Beta v2, Early Access), MobileApp; sees all");
  console.log("    morgan@test.com   ADMIN  · InsightsDashboard (Analytics Preview); oversees all");
  console.log("    sam@test.com      MEMBER · MobileWallet (Wallet early access); own work only");
  console.log(`\n  Partner-company admins (${ADMIN_PW}):`);
  console.log("    admin@cp.com      Casey · CP Inc. (owned by Pat)");
  console.log("    admin@initech.com Ivy   · Initech (owned by Sam)");
  console.log(`\n  Participants (${USER_PW}): uma@cp.com, raj@cp.com, ana@acme.com,`);
  console.log("    kim@dundermifflin.com, leo@dundermifflin.com, finn@initech.com,");
  console.log("    gwen@initech.com, priya@soylent.com, quinn@soylent.com");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
