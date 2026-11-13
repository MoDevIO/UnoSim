import { enterTutorUmlArtifacts } from "../../../../../server/services/tutor/uml/service";
/** Tests keep the production request scope alive across awaits and always release its pins. */
export async function withTutorUmlArtifacts<T>(
  owner: string | undefined,
  session: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  let result!: Promise<T>;
  const release = enterTutorUmlArtifacts(owner, session, () => {
    result = (async () => run())();
  });
  try {
    return await result;
  } finally {
    release();
  }
}
