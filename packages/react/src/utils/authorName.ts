/**
 * An author id rendered for a person. Ids are namespaced (`provider:name`), and
 * every surface that shows one wants the name, bounded so it cannot push a
 * layout around.
 */
export function shortName(authorID: string, max = 22): string {
  const name = authorID.split(":").pop() ?? authorID;
  return name.length > max ? name.slice(0, max) + "…" : name;
}
