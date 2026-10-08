/** `2.1.292` ≥ `2.1.289`; development suffixes are ignored; garbage reads as 0. */
export function versionAtLeast(version: string, floor: string): boolean {
  const parse = (v: string) => v.split(/[.-]/).slice(0, 3).map(n => Number.parseInt(n, 10) || 0)
  const a = parse(version)
  const b = parse(floor)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return true
}
