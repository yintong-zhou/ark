export const FACES: readonly string[] = Array.from({ length: 24 }, (_, i) => `face-${String(i + 1).padStart(2, '0')}`);
export const HEAD_FACE = 'face-head';

/** Returns the first unused face, or the least used face when all are taken. */
export function nextFace(used: readonly (string | undefined)[]): string {
  const counts = new Map(FACES.map((face) => [face, 0]));
  for (const face of used) {
    if (face !== undefined && counts.has(face)) counts.set(face, counts.get(face)! + 1);
  }
  return FACES.reduce((best, face) => counts.get(face)! < counts.get(best)! ? face : best);
}

/** Assigns missing faces in id order while preserving the input order. */
export function assignFaces<T extends { id: string; avatar?: string }>(agents: T[]): T[] {
  const used = agents.map((agent) => agent.avatar);
  const assigned = new Map<T, string>();
  for (const agent of [...agents].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (agent.avatar === undefined) {
      const face = nextFace(used);
      used.push(face);
      assigned.set(agent, face);
    }
  }
  return agents.map((agent) => assigned.has(agent) ? { ...agent, avatar: assigned.get(agent)! } : agent);
}
