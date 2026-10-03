export function shuffleIndices(length: number, anchor = -1, random: () => number = Math.random) {
  const remaining = Array.from({ length }, (_, index) => index).filter((index) => index !== anchor)
  for (let index = remaining.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.min(.999999999, Math.max(0, random())) * (index + 1))
    ;[remaining[index], remaining[target]] = [remaining[target], remaining[index]]
  }
  return anchor >= 0 && anchor < length ? [anchor, ...remaining] : remaining
}
