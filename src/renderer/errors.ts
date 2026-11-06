/** IPC wraps main-process errors; keep only the readable part. */
export const readable = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
