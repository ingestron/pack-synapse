// Where the targets' texts differ, token by token: the tokens common to every
// target, found with a longest common subsequence, and the stretches between them
// that differ (spec section 8.1).

/** Words, runs of space, and single other characters. */
export function tokens(text: string): string[] {
  return text.match(/[A-Za-z0-9_]+|\s+|[^A-Za-z0-9_\s]/g) ?? [];
}

/** A stretch of tokens: in each target, from `starts[i]` up to `ends[i]`. */
export interface Stretch {
  /** True when its text is the same in every target. */
  same: boolean;
  starts: number[];
  ends: number[];
}

/**
 * Each target's tokens cut into stretches that are the same in every target and
 * stretches that differ. A stretch that differs is never empty in any target: it takes
 * in the stretch next to it instead, so each variable has a value in every target.
 * @example stretches([tokens("a = 'x-y'"), tokens("a = 'z'")]) // same, differs, same
 */
export function stretches(lists: readonly string[][]): Stretch[] {
  const anchors = commonTokens(lists);
  const found: Stretch[] = [];
  for (let k = 0; k <= anchors[0]!.length; k += 1) {
    const starts = anchors.map((positions) => (k === 0 ? 0 : positions[k - 1]! + 1));
    const ends = anchors.map((positions, index) => positions[k] ?? lists[index]!.length);
    if (starts.some((start, index) => start < ends[index]!))
      found.push({ same: sameText(lists, starts, ends), starts, ends });
    if (k < anchors[0]!.length)
      found.push({ same: true, starts: ends, ends: ends.map((end) => end + 1) });
  }
  return widened(lists, merged(lists, found));
}

/**
 * For each target, the positions of the tokens common to every target, in order:
 * the common subsequence of all the targets, built one target at a time.
 */
function commonTokens(lists: readonly string[][]): number[][] {
  let common = lists[0]!.map((_, index) => index);
  for (const list of lists.slice(1)) {
    const kept = new Set(
      lcs(
        common.map((index) => lists[0]![index]!),
        list,
      ).map(([at]) => at),
    );
    common = common.filter((_, at) => kept.has(at));
  }
  const shared = common.map((index) => lists[0]![index]!);
  return lists.map((list) => lcs(shared, list).map(([, position]) => position));
}

/**
 * The pairs of positions of a longest common subsequence of `a` and `b`, in order.
 * The common start and end are matched first, so the table covers only what differs.
 */
export function lcs(a: readonly string[], b: readonly string[]): [number, number][] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a.at(-1 - end) === b.at(-1 - end))
    end += 1;
  const middle = table(a.slice(start, a.length - end), b.slice(start, b.length - end));
  const pairs: [number, number][] = [];
  for (let at = 0; at < start; at += 1) pairs.push([at, at]);
  for (const [i, j] of middle) pairs.push([start + i, start + j]);
  for (let at = end; at > 0; at -= 1) pairs.push([a.length - at, b.length - at]);
  return pairs;
}

/** The classic dynamic-programming table of common lengths, then its path back. */
function table(a: readonly string[], b: readonly string[]): [number, number][] {
  const width = b.length + 1;
  const lengths = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1)
    for (let j = b.length - 1; j >= 0; j -= 1)
      lengths[i * width + j] =
        a[i] === b[j]
          ? lengths[(i + 1) * width + j + 1]! + 1
          : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) pairs.push([i++, j++]);
    else if (lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!) i += 1;
    else j += 1;
  }
  return pairs;
}

function sameText(lists: readonly string[][], starts: number[], ends: number[]): boolean {
  const texts = lists.map((list, index) => list.slice(starts[index], ends[index]).join(""));
  return new Set(texts).size === 1;
}

/** Neighbouring stretches of the same kind, joined. */
function merged(lists: readonly string[][], found: Stretch[]): Stretch[] {
  const joined: Stretch[] = [];
  for (const stretch of found) {
    const last = joined.at(-1);
    if (last && last.same === stretch.same) joined[joined.length - 1] = join(lists, last, stretch);
    else joined.push(stretch);
  }
  return joined;
}

function join(lists: readonly string[][], first: Stretch, second: Stretch): Stretch {
  return { same: first.same, starts: first.starts, ends: second.ends };
}

/**
 * A stretch that differs and is empty in a target takes in one token of the stretch
 * before it, else of the stretch after it; a stretch left with no tokens goes.
 */
function widened(lists: readonly string[][], found: Stretch[]): Stretch[] {
  const result = [...found];
  for (const stretch of result.filter(emptySomewhere)) {
    const at = result.indexOf(stretch);
    const before = result[at - 1];
    const after = result[at + 1];
    if (before) {
      before.ends = before.ends.map((end) => end - 1);
      stretch.starts = stretch.starts.map((start) => start - 1);
    } else if (after) {
      after.starts = after.starts.map((start) => start + 1);
      stretch.ends = stretch.ends.map((end) => end + 1);
    }
    stretch.same = sameText(lists, stretch.starts, stretch.ends);
  }
  return result.filter((stretch) =>
    stretch.starts.some((start, index) => start < stretch.ends[index]!),
  );
}

const emptySomewhere = (stretch: Stretch) =>
  !stretch.same && stretch.starts.some((start, index) => start === stretch.ends[index]);
