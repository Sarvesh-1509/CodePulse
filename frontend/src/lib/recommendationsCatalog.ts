import type { PlatformId } from "@codepulse/shared";
import type { RecommendationDifficulty, RecommendationTopic } from "./recommendations";

/**
 * Small sample problem catalog for the personalized recommendations feature.
 *
 * This is clearly separated from real user statistics: entries here only
 * provide title/platform/difficulty/topics/problem URL for problems the engine
 * may suggest. Solved-exclusion keys use the same `${platform}::${problemId}`
 * format as the rest of CodePulse (e.g. LeetCode slug identifiers such as
 * "two-sum", Codeforces contest-index keys such as "1791A").
 */

export interface CatalogProblem {
  /** Stable human id, e.g. "coin-change". */
  id: string;
  /** `${platform}::${problemIdentifier}` — matches solved keys. */
  key: string;
  platform: PlatformId;
  title: string;
  url: string;
  difficulty: RecommendationDifficulty;
  topics: RecommendationTopic[];
}

export const RECOMMENDATIONS_CATALOG: CatalogProblem[] = [
  // LeetCode — fundamentals / Dynamic Programming / Graphs / Sorting / Two Pointers / Trees.
  {
    id: "climbing-stairs",
    key: "LEETCODE::climbing-stairs",
    platform: "LEETCODE",
    title: "Climbing Stairs",
    url: "https://leetcode.com/problems/climbing-stairs/",
    difficulty: "Easy",
    topics: ["Dynamic Programming"],
  },
  {
    id: "valid-parentheses",
    key: "LEETCODE::valid-parentheses",
    platform: "LEETCODE",
    title: "Valid Parentheses",
    url: "https://leetcode.com/problems/valid-parentheses/",
    difficulty: "Easy",
    topics: ["Strings"],
  },
  {
    id: "jump-game",
    key: "LEETCODE::jump-game",
    platform: "LEETCODE",
    title: "Jump Game",
    url: "https://leetcode.com/problems/jump-game/",
    difficulty: "Easy",
    topics: ["Greedy Algorithms"],
  },
  {
    id: "coin-change",
    key: "LEETCODE::coin-change",
    platform: "LEETCODE",
    title: "Coin Change",
    url: "https://leetcode.com/problems/coin-change/",
    difficulty: "Medium",
    topics: ["Dynamic Programming"],
  },
  {
    id: "number-of-islands",
    key: "LEETCODE::number-of-islands",
    platform: "LEETCODE",
    title: "Number of Islands",
    url: "https://leetcode.com/problems/number-of-islands/",
    difficulty: "Medium",
    topics: ["Graphs"],
  },
  {
    id: "merge-intervals",
    key: "LEETCODE::merge-intervals",
    platform: "LEETCODE",
    title: "Merge Intervals",
    url: "https://leetcode.com/problems/merge-intervals/",
    difficulty: "Medium",
    topics: ["Sorting"],
  },
  {
    id: "longest-substring",
    key: "LEETCODE::longest-substring-without-repeating-characters",
    platform: "LEETCODE",
    title: "Longest Substring Without Repeating Characters",
    url: "https://leetcode.com/problems/longest-substring-without-repeating-characters/",
    difficulty: "Medium",
    topics: ["Two Pointers"],
  },
  {
    id: "course-schedule",
    key: "LEETCODE::course-schedule",
    platform: "LEETCODE",
    title: "Course Schedule",
    url: "https://leetcode.com/problems/course-schedule/",
    difficulty: "Medium",
    topics: ["Graphs"],
  },
  {
    id: "longest-common-subsequence",
    key: "LEETCODE::longest-common-subsequence",
    platform: "LEETCODE",
    title: "Longest Common Subsequence",
    url: "https://leetcode.com/problems/longest-common-subsequence/",
    difficulty: "Hard",
    topics: ["Dynamic Programming", "Strings"],
  },
  {
    id: "binary-tree-path-sum",
    key: "LEETCODE::binary-tree-maximum-path-sum",
    platform: "LEETCODE",
    title: "Binary Tree Maximum Path Sum",
    url: "https://leetcode.com/problems/binary-tree-maximum-path-sum/",
    difficulty: "Hard",
    topics: ["Trees", "Dynamic Programming"],
  },
  // Codeforces — quick easy picks (Greedy / Strings / math-flavored).
  {
    id: "watermelon",
    key: "CODEFORCES::4A",
    platform: "CODEFORCES",
    title: "Watermelon",
    url: "https://codeforces.com/problemset/problem/4/A/Watermelon/",
    difficulty: "Easy",
    topics: ["Greedy Algorithms"],
  },
  {
    id: "theatre-square",
    key: "CODEFORCES::1A",
    platform: "CODEFORCES",
    title: "Theatre Square",
    url: "https://codeforces.com/problemset/problem/1/A/TheatreSquare/",
    difficulty: "Easy",
    topics: ["Greedy Algorithms"],
  },
  {
    id: "way-too-long-words",
    key: "CODEFORCES::71A",
    platform: "CODEFORCES",
    title: "Way Too Long Words",
    url: "https://codeforces.com/problemset/problem/71/A/WayTooLongWords/",
    difficulty: "Easy",
    topics: ["Strings"],
  },
  {
    id: "elephant",
    key: "CODEFORCES::617A",
    platform: "CODEFORCES",
    title: "Elephant",
    url: "https://codeforces.com/problemset/problem/617/A/Elephant/",
    difficulty: "Easy",
    topics: ["Greedy Algorithms"],
  },
];
