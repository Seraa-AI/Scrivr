/**
 * An author id rendered for a person. Ids are namespaced (`provider:name`), and
 * every surface that shows one wants the name, bounded so it cannot push a
 * layout around.
 */
const MAX_NAME_LENGTH = 22;

export function shortName(authorID: string): string {
  const name = authorID.split(":").pop() ?? authorID;
  return name.length > MAX_NAME_LENGTH ? name.slice(0, MAX_NAME_LENGTH) + "…" : name;
}
