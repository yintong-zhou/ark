/** "claude-haiku-5-5" reads "haiku 5.5"; names that do not follow that shape are left as they are. */
export const shortModel = (model: string): string => {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(model);
  return m ? `${m[1]} ${m[2]}.${m[3]}` : model;
};
