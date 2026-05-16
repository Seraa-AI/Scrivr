export function cx(
  ...names: Array<string | false | null | undefined>
): string | undefined {
  const className = Array.from(
    new Set(names.filter(Boolean).flatMap((name) => String(name).split(/\s+/))),
  ).join(" ");
  return className || undefined;
}
