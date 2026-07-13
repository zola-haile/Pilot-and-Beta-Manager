import { prisma } from "../prisma";

type PilotRef = { id: string; applicationId: string; allFeatures: boolean };

/**
 * The features a pilot is actually testing. When `allFeatures` is true this is
 * every feature of the application (so features added later are automatically
 * included); otherwise it's the explicit PilotFeature selection.
 */
export async function pilotedFeatures(pilot: PilotRef) {
  if (pilot.allFeatures) {
    return prisma.feature.findMany({
      where: { applicationId: pilot.applicationId },
      orderBy: { name: "asc" },
    });
  }
  const pf = await prisma.pilotFeature.findMany({
    where: { pilotId: pilot.id },
    include: { feature: true },
    orderBy: { feature: { name: "asc" } },
  });
  return pf.map((x) => x.feature);
}

/** Just the ids of the features a pilot is testing. */
export async function pilotedFeatureIds(pilot: PilotRef): Promise<Set<string>> {
  const feats = await pilotedFeatures(pilot);
  return new Set(feats.map((f) => f.id));
}
