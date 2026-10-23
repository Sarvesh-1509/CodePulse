import { Prisma } from "@prisma/client";
import type { ContestDifficulty } from "@codepulse/shared";

/**
 * LeetCode problem catalog for personal contests (Module 15).
 *
 * This is a small, self-contained, clearly identified catalog of verified
 * LeetCode problems. Each entry carries the real problem title, LeetCode
 * slug, public URL, difficulty, and topic tags as listed on LeetCode at the
 * time of writing.
 *
 * Data-source restriction (documented limitation):
 * - CodePulse has no integration that can dynamically enumerate LeetCode's
 *   full problem library, and scraping LeetCode or asking users for their
 *   LeetCode session is out of scope. So problem selection is limited to
 *   this catalog, which is isolated behind the selectProblems service so a
 *   real LeetCode-backed provider can replace it later without changing the
 *   contest system.
 * - Selection never fabricates problems: only catalog entries are offered.
 *   When fewer than three catalog problems match the requested criteria, the
 *   selection reports `complete: false` with the matches it has.
 */

export interface CatalogProblem {
  /** Stable catalog key, e.g. "two-sum". */
  id: string;
  /** `${platform}::${slug}` — matches the solved-event key format used by
   *  activity events elsewhere in CodePulse. */
  problemKey: string;
  title: string;
  slug: string;
  url: string;
  difficulty: "Easy" | "Medium" | "Hard";
  topics: string[];
}

/** Verified LeetCode problems used as the contest problem pool. */
export const LEETCODE_CATALOG: CatalogProblem[] = [
  // --- Easy ---
  {
    id: "two-sum",
    problemKey: "LEETCODE::two-sum",
    title: "Two Sum",
    slug: "two-sum",
    url: "https://leetcode.com/problems/two-sum/",
    difficulty: "Easy",
    topics: ["Arrays", "Hash Table"],
  },
  {
    id: "valid-parentheses",
    problemKey: "LEETCODE::valid-parentheses",
    title: "Valid Parentheses",
    slug: "valid-parentheses",
    url: "https://leetcode.com/problems/valid-parentheses/",
    difficulty: "Easy",
    topics: ["Strings", "Stack"],
  },
  {
    id: "merge-two-sorted-lists",
    problemKey: "LEETCODE::merge-two-sorted-lists",
    title: "Merge Two Sorted Lists",
    slug: "merge-two-sorted-lists",
    url: "https://leetcode.com/problems/merge-two-sorted-lists/",
    difficulty: "Easy",
    topics: ["Linked List", "Two Pointers"],
  },
  {
    id: "best-time-to-buy-and-sell-stock",
    problemKey: "LEETCODE::best-time-to-buy-and-sell-stock",
    title: "Best Time to Buy and Sell Stock",
    slug: "best-time-to-buy-and-sell-stock",
    url: "https://leetcode.com/problems/best-time-to-buy-and-sell-stock/",
    difficulty: "Easy",
    topics: ["Arrays", "Dynamic Programming"],
  },
  {
    id: "contains-duplicate",
    problemKey: "LEETCODE::contains-duplicate",
    title: "Contains Duplicate",
    slug: "contains-duplicate",
    url: "https://leetcode.com/problems/contains-duplicate/",
    difficulty: "Easy",
    topics: ["Arrays", "Hash Table", "Sorting"],
  },
  {
    id: "maximum-subarray",
    problemKey: "LEETCODE::maximum-subarray",
    title: "Maximum Subarray",
    slug: "maximum-subarray",
    url: "https://leetcode.com/problems/maximum-subarray/",
    difficulty: "Easy",
    topics: ["Arrays", "Dynamic Programming", "Divide and Conquer"],
  },
  {
    id: "climbing-stairs",
    problemKey: "LEETCODE::climbing-stairs",
    title: "Climbing Stairs",
    slug: "climbing-stairs",
    url: "https://leetcode.com/problems/climbing-stairs/",
    difficulty: "Easy",
    topics: ["Dynamic Programming"],
  },
  {
    id: "binary-search",
    problemKey: "LEETCODE::binary-search",
    title: "Binary Search",
    slug: "binary-search",
    url: "https://leetcode.com/problems/binary-search/",
    difficulty: "Easy",
    topics: ["Array", "Binary Search"],
  },
  {
    id: "reverse-string",
    problemKey: "LEETCODE::reverse-string",
    title: "Reverse String",
    slug: "reverse-string",
    url: "https://leetcode.com/problems/reverse-string/",
    difficulty: "Easy",
    topics: ["Two Pointers", "Strings"],
  },
  {
    id: "palindrome-number",
    problemKey: "LEETCODE::palindrome-number",
    title: "Palindrome Number",
    slug: "palindrome-number",
    url: "https://leetcode.com/problems/palindrome-number/",
    difficulty: "Easy",
    topics: ["Math"],
  },
  {
    id: "roman-to-integer",
    problemKey: "LEETCODE::roman-to-integer",
    title: "Roman to Integer",
    slug: "roman-to-integer",
    url: "https://leetcode.com/problems/roman-to-integer/",
    difficulty: "Easy",
    topics: ["Math", "Hash Table"],
  },
  {
    id: "longest-common-prefix",
    problemKey: "LEETCODE::longest-common-prefix",
    title: "Longest Common Prefix",
    slug: "longest-common-prefix",
    url: "https://leetcode.com/problems/longest-common-prefix/",
    difficulty: "Easy",
    topics: ["Strings", "Trie"],
  },
  {
    id: "invert-binary-tree",
    problemKey: "LEETCODE::invert-binary-tree",
    title: "Invert Binary Tree",
    slug: "invert-binary-tree",
    url: "https://leetcode.com/problems/invert-binary-tree/",
    difficulty: "Easy",
    topics: ["Tree", "Depth-First Search", "Binary Tree"],
  },
  {
    id: "maximum-depth-of-binary-tree",
    problemKey: "LEETCODE::maximum-depth-of-binary-tree",
    title: "Maximum Depth of Binary Tree",
    slug: "maximum-depth-of-binary-tree",
    url: "https://leetcode.com/problems/maximum-depth-of-binary-tree/",
    difficulty: "Easy",
    topics: ["Tree", "Depth-First Search", "Breadth-First Search", "Binary Tree"],
  },
  {
    id: "lowest-common-ancestor-of-a-binary-search-tree",
    problemKey: "LEETCODE::lowest-common-ancestor-of-a-binary-search-tree",
    title: "Lowest Common Ancestor of a Binary Search Tree",
    slug: "lowest-common-ancestor-of-a-binary-search-tree",
    url: "https://leetcode.com/problems/lowest-common-ancestor-of-a-binary-search-tree/",
    difficulty: "Easy",
    topics: ["Tree", "Depth-First Search", "Binary Search Tree", "Binary Tree"],
  },
  // --- Medium ---
  {
    id: "longest-substring-without-repeating-characters",
    problemKey: "LEETCODE::longest-substring-without-repeating-characters",
    title: "Longest Substring Without Repeating Characters",
    slug: "longest-substring-without-repeating-characters",
    url: "https://leetcode.com/problems/longest-substring-without-repeating-characters/",
    difficulty: "Medium",
    topics: ["Hash Table", "Two Pointers", "String", "Sliding Window"],
  },
  {
    id: "longest-palindromic-substring",
    problemKey: "LEETCODE::longest-palindromic-substring",
    title: "Longest Palindromic Substring",
    slug: "longest-palindromic-substring",
    url: "https://leetcode.com/problems/longest-palindromic-substring/",
    difficulty: "Medium",
    topics: ["String", "Dynamic Programming"],
  },
  {
    id: "container-with-most-water",
    problemKey: "LEETCODE::container-with-most-water",
    title: "Container With Most Water",
    slug: "container-with-most-water",
    url: "https://leetcode.com/problems/container-with-most-water/",
    difficulty: "Medium",
    topics: ["Array", "Two Pointers", "Greedy"],
  },
  {
    id: "3sum",
    problemKey: "LEETCODE::3sum",
    title: "3Sum",
    slug: "3sum",
    url: "https://leetcode.com/problems/3sum/",
    difficulty: "Medium",
    topics: ["Array", "Two Pointers", "Sorting"],
  },
  {
    id: "letter-combinations-of-a-phone-number",
    problemKey: "LEETCODE::letter-combinations-of-a-phone-number",
    title: "Letter Combinations of a Phone Number",
    slug: "letter-combinations-of-a-phone-number",
    url: "https://leetcode.com/problems/letter-combinations-of-a-phone-number/",
    difficulty: "Medium",
    topics: ["Hash Table", "String", "Backtracking"],
  },
  {
    id: "generate-parentheses",
    problemKey: "LEETCODE::generate-parentheses",
    title: "Generate Parentheses",
    slug: "generate-parentheses",
    url: "https://leetcode.com/problems/generate-parentheses/",
    difficulty: "Medium",
    topics: ["String", "Dynamic Programming", "Backtracking"],
  },
  {
    id: "merge-intervals",
    problemKey: "LEETCODE::merge-intervals",
    title: "Merge Intervals",
    slug: "merge-intervals",
    url: "https://leetcode.com/problems/merge-intervals/",
    difficulty: "Medium",
    topics: ["Array", "Sorting"],
  },
  {
    id: "non-overlapping-intervals",
    problemKey: "LEETCODE::non-overlapping-intervals",
    title: "Non-overlapping Intervals",
    slug: "non-overlapping-intervals",
    url: "https://leetcode.com/problems/non-overlapping-intervals/",
    difficulty: "Medium",
    topics: ["Array", "Dynamic Programming", "Greedy"],
  },
  {
    id: "course-schedule",
    problemKey: "LEETCODE::course-schedule",
    title: "Course Schedule",
    slug: "course-schedule",
    url: "https://leetcode.com/problems/course-schedule/",
    difficulty: "Medium",
    topics: ["Breadth-First Search", "Depth-First Search", "Graphs", "Topological Sort"],
  },
  {
    id: "number-of-islands",
    problemKey: "LEETCODE::number-of-islands",
    title: "Number of Islands",
    slug: "number-of-islands",
    url: "https://leetcode.com/problems/number-of-islands/",
    difficulty: "Medium",
    topics: ["Breadth-First Search", "Depth-First Search", "Union Find", "Matrix", "Binary Search Tree"],
  },
  {
    id: "clone-graph",
    problemKey: "LEETCODE::clone-graph",
    title: "Clone Graph",
    slug: "clone-graph",
    url: "https://leetcode.com/problems/clone-graph/",
    difficulty: "Medium",
    topics: ["Breadth-First Search", "Depth-First Search", "Graphs"],
  },
  {
    id: "longest-increasing-subsequence",
    problemKey: "LEETCODE::longest-increasing-subsequence",
    title: "Longest Increasing Subsequence",
    slug: "longest-increasing-subsequence",
    url: "https://leetcode.com/problems/longest-increasing-subsequence/",
    difficulty: "Medium",
    topics: ["Array", "Dynamic Programming"],
  },
  {
    id: "coin-change",
    problemKey: "LEETCODE::coin-change",
    title: "Coin Change",
    slug: "coin-change",
    url: "https://leetcode.com/problems/coin-change/",
    difficulty: "Medium",
    topics: ["Array", "Dynamic Programming", "Breadth-First Search"],
  },
  {
    id: "combination-sum",
    problemKey: "LEETCODE::combination-sum",
    title: "Combination Sum",
    slug: "combination-sum",
    url: "https://leetcode.com/problems/combination-sum/",
    difficulty: "Medium",
    topics: ["Array", "Backtracking"],
  },
  {
    id: "binary-tree-level-order-traversal",
    problemKey: "LEETCODE::binary-tree-level-order-traversal",
    title: "Binary Tree Level Order Traversal",
    slug: "binary-tree-level-order-traversal",
    url: "https://leetcode.com/problems/binary-tree-level-order-traversal/",
    difficulty: "Medium",
    topics: ["Tree", "Breadth-First Search", "Binary Tree"],
  },
  {
    id: "validate-binary-search-tree",
    problemKey: "LEETCODE::validate-binary-search-tree",
    title: "Validate Binary Search Tree",
    slug: "validate-binary-search-tree",
    url: "https://leetcode.com/problems/validate-binary-search-tree/",
    difficulty: "Medium",
    topics: ["Tree", "Depth-First Search", "Binary Search Tree", "Binary Tree"],
  },
  // --- Hard ---
  {
    id: "median-of-two-sorted-arrays",
    problemKey: "LEETCODE::median-of-two-sorted-arrays",
    title: "Median of Two Sorted Arrays",
    slug: "median-of-two-sorted-arrays",
    url: "https://leetcode.com/problems/median-of-two-sorted-arrays/",
    difficulty: "Hard",
    topics: ["Array", "Binary Search", "Divide and Conquer"],
  },
  {
    id: "regular-expression-matching",
    problemKey: "LEETCODE::regular-expression-matching",
    title: "Regular Expression Matching",
    slug: "regular-expression-matching",
    url: "https://leetcode.com/problems/regular-expression-matching/",
    difficulty: "Hard",
    topics: ["String", "Dynamic Programming", "Recursion"],
  },
  {
    id: "merge-k-sorted-lists",
    problemKey: "LEETCODE::merge-k-sorted-lists",
    title: "Merge k Sorted Lists",
    slug: "merge-k-sorted-lists",
    url: "https://leetcode.com/problems/merge-k-sorted-lists/",
    difficulty: "Hard",
    topics: ["Linked List", "Divide and Conquer", "Heap", "Merge Sort"],
  },
  {
    id: "trapping-rain-water",
    problemKey: "LEETCODE::trapping-rain-water",
    title: "Trapping Rain Water",
    slug: "trapping-rain-water",
    url: "https://leetcode.com/problems/trapping-rain-water/",
    difficulty: "Hard",
    topics: ["Array", "Two Pointers", "Dynamic Programming", "Stack", "Monotonic Stack"],
  },
  {
    id: "word-ladder",
    problemKey: "LEETCODE::word-ladder",
    title: "Word Ladder",
    slug: "word-ladder",
    url: "https://leetcode.com/problems/word-ladder/",
    difficulty: "Hard",
    topics: ["Breadth-First Search", "Hash Table", "String"],
  },
  {
    id: "sudoku-solver",
    problemKey: "LEETCODE::sudoku-solver",
    title: "Sudoku Solver",
    slug: "sudoku-solver",
    url: "https://leetcode.com/problems/sudoku-solver/",
    difficulty: "Hard",
    topics: ["Array", "Backtracking", "Matrix"],
  },
  {
    id: "n-queens",
    problemKey: "LEETCODE::n-queens",
    title: "N-Queens",
    slug: "n-queens",
    url: "https://leetcode.com/problems/n-queens/",
    difficulty: "Hard",
    topics: ["Backtracking"],
  },
  {
    id: "reverse-nodes-in-k-group",
    problemKey: "LEETCODE::reverse-nodes-in-k-group",
    title: "Reverse Nodes in k-Group",
    slug: "reverse-nodes-in-k-group",
    url: "https://leetcode.com/problems/reverse-nodes-in-k-group/",
    difficulty: "Hard",
    topics: ["Linked List", "Stack", "Two Pointers"],
  },
];

const CATALOG_BY_KEY = new Map(LEETCODE_CATALOG.map((p) => [p.id, p]));

/** Simple 32-bit hash used for deterministic, seed-dependent tie-breaking. */
function seedHash(seed: number, text: string): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/** Score a catalog problem against the requested criteria. Higher = better match. */
function scoreProblem(
  problem: CatalogProblem,
  difficulty: ContestDifficulty,
  selectedTopics: string[]
): number {
  let score = 0;
  const topicSet = new Set(selectedTopics);
  let matched = 0;
  for (const topic of problem.topics) {
    if (topicSet.has(topic)) matched += 1;
  }
  score += matched * 10;
  if (difficulty !== "MIXED" && problem.difficulty.toUpperCase() === difficulty) score += 5;
  return score;
}

export interface SelectProblemsInput {
  difficulty: ContestDifficulty;
  topics: string[];
  seed: number;
  limit?: number;
}

export interface SelectProblemsResult {
  /** Catalog problems augmented with platform + position for insertion. */
  problems: Array<CatalogProblem & { platform: "LEETCODE"; position: number }>;
  matchedTopics: string[];
  complete: boolean; // true when the requested number of problems was selected
}

/**
 * Select up to `limit` distinct catalog problems matching the criteria.
 *
 * Problems are ranked by topic overlap then exact difficulty match; ties are
 * broken deterministically using the seed, so changing the seed (regenerate)
 * produces a different selection among equally-good candidates while still
 * preferring higher-scoring problems overall.
 */
export function selectProblems(input: SelectProblemsInput): SelectProblemsResult {
  const limit = input.limit ?? 3;
  const selectedTopics = new Set(input.topics.filter((t) => t.length > 0));

  const candidates = LEETCODE_CATALOG.filter((p) => {
    if (input.difficulty !== "MIXED" && p.difficulty.toUpperCase() !== input.difficulty) return false;
    if (selectedTopics.size > 0) {
      return p.topics.some((t) => selectedTopics.has(t));
    }
    return true;
  });

  const scored = candidates.map((p) => ({
    problem: p,
    score: scoreProblem(p, input.difficulty, input.topics),
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Stable tie-break: seed-dependent hash of the problem title.
    const ha = seedHash(input.seed, `a:${a.problem.id}`);
    const hb = seedHash(input.seed, `b:${b.problem.id}`);
    if (ha !== hb) return ha - hb;
    return a.problem.id.localeCompare(b.problem.id);
  });

  const picked = scored.slice(0, limit).map((s) => s.problem);
  const matchedTopics = new Set<string>();
  for (const p of picked) {
    for (const t of p.topics) {
      if (selectedTopics.size === 0 || selectedTopics.has(t)) matchedTopics.add(t);
    }
  }

  return {
    problems: picked.map((p, index) => ({
      ...p,
      platform: "LEETCODE",
      position: index + 1,
    })),
    matchedTopics: [...matchedTopics].sort(),
    complete: picked.length === limit,
  };
}

export function catalogProblemById(id: string): CatalogProblem | undefined {
  return CATALOG_BY_KEY.get(id);
}

export function allCatalogTopics(): string[] {
  const topics = new Set<string>();
  for (const p of LEETCODE_CATALOG) {
    for (const t of p.topics) topics.add(t);
  }
  return [...topics].sort();
}
