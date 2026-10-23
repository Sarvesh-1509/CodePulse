import type {
  ApiResponse,
  AnalyticsRange,
  AnalyticsSummaryDto,
  AuthData,
  ActivityDayDto,
  ActivityTotalsDto,
  ActivityCoverageDto,
  ContestEntryDto,
  CprDto,
  CprSnapshotDto,
  CreatedInvitationDto,
  ContestAttemptDto,
  ContestDto,
  ContestDifficulty,
  ContestLeaderboardEntryDto,
  ContestResultsDto,
  ContestStatus,
  ContestSummaryDto,
  CreateContestRequest,
  CreateRoomRequest,
  InvitationPreviewDto,
  LeaderboardEntryDto,
  LeaderboardMetric,
  LeaderboardPageDto,
  LeaderboardPeriod,
  LinkedAccountDto,
  LoginRequest,
  NativeRatingPointDto,
  PeriodComparisonDto,
  PlatformBreakdownDto,
  PlatformInfo,
  RecentActivityItemDto,
  RegisterRequest,
  RoomDetailsDto,
  RoomDto,
  RoomInvitationDto,
  RoomMemberDto,
  RoomMemberProgressDto,
  SafeUser,
  StreakDto,
  TrendBucketDto,
  UpdateProfileRequest,
  UpdateRoomRequest,
} from "@codepulse/shared";
import { CONTEST_TOPICS } from "@codepulse/shared";

// Configurable backend base URL. NEXT_PUBLIC_* is inlined at build time and
// is safe here: it holds no secret, only the public API origin.
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

export class ApiError extends Error {
  readonly status: number;
  readonly issues?: Record<string, string[] | undefined>;

  constructor(status: number, message: string, issues?: Record<string, string[] | undefined>) {
    super(message);
    this.status = status;                     
    this.issues = issues;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      // Required for HttpOnly cookie-based sessions.
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new ApiError(0, "Cannot reach the CodePulse API. Is the backend running?");
  }

  let body: ApiResponse<T> | null = null;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    // Non-JSON response (proxy error page, etc.).
  }

  if (!res.ok || !body?.success) {
    const issues = (body as { issues?: Record<string, string[] | undefined> } | null)?.issues;
    throw new ApiError(res.status, body?.message ?? `Request failed (${res.status}).`, issues);
  }
  return body.data as T;
}

function post<T>(path: string, data?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}

export async function registerRequest(data: RegisterRequest): Promise<SafeUser> {
  const result = await post<AuthData>("/api/auth/register", data);
  return result.user;
}

export async function loginRequest(data: LoginRequest): Promise<SafeUser> {
  const result = await post<AuthData>("/api/auth/login", data);
  return result.user;
}

export async function logoutRequest(): Promise<void> {
  await post("/api/auth/logout");
}

export async function getCurrentUser(): Promise<SafeUser> {
  const result = await apiFetch<AuthData>("/api/auth/me");
  return result.user;
}

export async function updateProfileRequest(data: UpdateProfileRequest): Promise<SafeUser> {
  const result = await apiFetch<AuthData>("/api/users/me", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return result.user;
}

export async function listPlatforms(): Promise<PlatformInfo[]> {
  const result = await apiFetch<{ platforms: PlatformInfo[] }>("/api/platforms");
  return result.platforms;
}

export async function listPlatformAccounts(): Promise<LinkedAccountDto[]> {
  const result = await apiFetch<{ accounts: LinkedAccountDto[] }>(
    "/api/platform-accounts"
  );
  return result.accounts;
}

export async function connectPlatformAccount(
  platform: string,
  username: string
): Promise<LinkedAccountDto> {
  const result = await post<{ account: LinkedAccountDto }>(
    `/api/platform-accounts/${platform}/connect`,
    { username }
  );
  return result.account;
}

export async function disconnectPlatformAccount(platform: string): Promise<void> {
  await apiFetch(`/api/platform-accounts/${platform}`, { method: "DELETE" });
}

export async function syncPlatformAccount(platform: string): Promise<LinkedAccountDto> {
  const result = await post<{ account: LinkedAccountDto }>(
    `/api/platform-accounts/${platform}/sync`
  );
  return result.account;
}

export interface ActivityStreakData {
  streak: StreakDto;
  coverage: ActivityCoverageDto;
  totals: ActivityTotalsDto;
}

export async function getActivityStreak(timezone?: string): Promise<ActivityStreakData> {
  const query = timezone ? `?timezone=${encodeURIComponent(timezone)}` : "";
  return apiFetch<ActivityStreakData>(`/api/activity/streak${query}`);
}

export interface ActivityDaysData {
  days: ActivityDayDto[];
  range: { start: string; end: string };
  timezone: string;
}

export async function getActivityDays(days = 364, end?: string): Promise<ActivityDaysData> {
  const params = new URLSearchParams({ days: String(days) });
  if (end) params.set("end", end);
  return apiFetch<ActivityDaysData>(`/api/activity/days?${params.toString()}`);
}

export interface RecentActivityData {
  items: RecentActivityItemDto[];
  pagination: { limit: number; offset: number; total: number };
}

export async function getRecentActivity(
  options: { limit?: number; offset?: number; platform?: string; type?: string } = {}
): Promise<RecentActivityData> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  if (options.platform) params.set("platform", options.platform);
  if (options.type) params.set("type", options.type);
  const query = params.toString();
  return apiFetch<RecentActivityData>(`/api/activity/recent${query ? `?${query}` : ""}`);
}

export async function getRating(): Promise<CprDto> {
  return apiFetch<CprDto>("/api/rating");
}

export async function recalculateRating(): Promise<CprDto> {
  return post<CprDto>("/api/rating/recalculate");
}

export async function getRatingHistory(limit = 20): Promise<{ snapshots: CprSnapshotDto[] }> {
  return apiFetch<{ snapshots: CprSnapshotDto[] }>(
    `/api/rating/history?limit=${encodeURIComponent(String(limit))}`
  );
}

// --- Module 12: analytics (all authenticated; identity comes from the session) ---

export interface AnalyticsQuery {
  range?: AnalyticsRange;
  start?: string;
  end?: string;
  timezone?: string;
}

function analyticsQueryString(query: AnalyticsQuery): string {
  const params = new URLSearchParams();
  // Preset and custom dates are never mixed: mirrors the backend rule that
  // rejects `range` combined with `start`/`end`.
  if (query.range !== undefined) params.set("range", query.range);
  if (query.start !== undefined) params.set("start", query.start);
  if (query.end !== undefined) params.set("end", query.end);
  if (query.timezone !== undefined) params.set("timezone", query.timezone);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

export interface AnalyticsTrendsBucket extends TrendBucketDto {
  kind: "daily" | "weekly" | "monthly";
}

export interface AnalyticsTrendsData {
  buckets: AnalyticsTrendsBucket[];
  kind: "daily" | "weekly" | "monthly";
  range: { start: string; end: string };
  timezone: string;
}

export interface AnalyticsPlatformsData {
  platforms: PlatformBreakdownDto[];
  range: { range: AnalyticsRange | "custom"; start: string; end: string; timezone: string };
}

export interface AnalyticsContestsData {
  items: ContestEntryDto[];
  pagination: { limit: number; offset: number; total: number };
}

export interface AnalyticsRatingsData {
  ratings: NativeRatingPointDto[];
  cpr: CprSnapshotDto[];
}

/** The backend defaults nothing: callers always send a preset or a pair. */
const DEFAULT_ANALYTICS_QUERY: AnalyticsQuery = { range: "30d" };

export async function getAnalyticsSummary(
  query: AnalyticsQuery = DEFAULT_ANALYTICS_QUERY
): Promise<AnalyticsSummaryDto> {
  return apiFetch<AnalyticsSummaryDto>(`/api/analytics/summary${analyticsQueryString(query)}`);
}

export async function getAnalyticsTrends(
  query: AnalyticsQuery = DEFAULT_ANALYTICS_QUERY
): Promise<AnalyticsTrendsData> {
  return apiFetch<AnalyticsTrendsData>(`/api/analytics/trends${analyticsQueryString(query)}`);
}

export async function getAnalyticsCompare(
  query: AnalyticsQuery = DEFAULT_ANALYTICS_QUERY
): Promise<PeriodComparisonDto> {
  return apiFetch<PeriodComparisonDto>(`/api/analytics/compare${analyticsQueryString(query)}`);
}

export async function getAnalyticsPlatforms(
  query: AnalyticsQuery = DEFAULT_ANALYTICS_QUERY
): Promise<AnalyticsPlatformsData> {
  return apiFetch<AnalyticsPlatformsData>(`/api/analytics/platforms${analyticsQueryString(query)}`);
}

export async function getAnalyticsContests(
  options: { limit?: number; offset?: number } = {}
): Promise<AnalyticsContestsData> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  const text = params.toString();
  return apiFetch<AnalyticsContestsData>(`/api/analytics/contests${text === "" ? "" : `?${text}`}`);
}

export async function getAnalyticsRatings(): Promise<AnalyticsRatingsData> {
  return apiFetch<AnalyticsRatingsData>("/api/analytics/ratings");
}

// --- Module 13: rooms and invitations (all authenticated) ---

function patch<T>(path: string, data: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(data) });
}

function remove(path: string): Promise<void> {
  return apiFetch<void>(path, { method: "DELETE" });
}

export async function listRooms(): Promise<RoomDto[]> {
  const result = await apiFetch<{ rooms: RoomDto[] }>("/api/rooms");
  return result.rooms;
}

export async function createRoom(data: CreateRoomRequest): Promise<RoomDto> {
  const result = await post<{ room: RoomDto }>("/api/rooms", data);
  return result.room;
}

export async function getRoomDetails(roomId: string): Promise<RoomDetailsDto> {
  const result = await apiFetch<{ room: RoomDetailsDto }>(
    `/api/rooms/${encodeURIComponent(roomId)}`
  );
  return result.room;
}

export async function updateRoom(roomId: string, data: UpdateRoomRequest): Promise<RoomDto> {
  const result = await patch<{ room: RoomDto }>(`/api/rooms/${encodeURIComponent(roomId)}`, data);
  return result.room;
}

export async function deleteRoom(roomId: string): Promise<void> {
  await remove(`/api/rooms/${encodeURIComponent(roomId)}`);
}

export interface LeaveRoomResult {
  left: boolean;
  roomDeleted: boolean;
  transferredToUsername: string | null;
}

export async function leaveRoom(roomId: string): Promise<LeaveRoomResult> {
  const result = await post<LeaveRoomResult>(
    `/api/rooms/${encodeURIComponent(roomId)}/leave`
  );
  return result;
}

export async function listRoomMembers(roomId: string): Promise<RoomMemberDto[]> {
  const result = await apiFetch<{ members: RoomMemberDto[] }>(
    `/api/rooms/${encodeURIComponent(roomId)}/members`
  );
  return result.members;
}

export async function removeRoomMember(roomId: string, userId: string): Promise<void> {
  await remove(`/api/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}`);
}

export async function getRoomProgress(roomId: string): Promise<RoomMemberProgressDto[]> {
  const result = await apiFetch<{ progress: RoomMemberProgressDto[] }>(
    `/api/rooms/${encodeURIComponent(roomId)}/progress`
  );
  return result.progress;
}

export interface CreateInvitationOptions {
  expiresInHours?: number;
  maxUses?: number;
  /** Invite a registered user directly by username (in-app, no link). */
  username?: string;
}

export async function createRoomInvitation(
  roomId: string,
  options: CreateInvitationOptions = {}
): Promise<CreatedInvitationDto> {
  return post<CreatedInvitationDto>(
    `/api/rooms/${encodeURIComponent(roomId)}/invitations`,
    options
  );
}

export async function listRoomInvitations(roomId: string): Promise<RoomInvitationDto[]> {
  const result = await apiFetch<{ invitations: RoomInvitationDto[] }>(
    `/api/rooms/${encodeURIComponent(roomId)}/invitations`
  );
  return result.invitations;
}

export async function revokeRoomInvitation(invitationId: string): Promise<RoomInvitationDto> {
  const result = await post<{ invitation: RoomInvitationDto }>(
    `/api/rooms/invitations/${encodeURIComponent(invitationId)}/revoke`
  );
  return result.invitation;
}

export async function validateInvitation(token: string): Promise<InvitationPreviewDto> {
  return apiFetch<InvitationPreviewDto>(
    `/api/rooms/invitations/${encodeURIComponent(token)}/validate`
  );
}

export interface AcceptInvitationResult {
  roomId: string;
  alreadyMember: boolean;
}

export async function acceptInvitation(token: string): Promise<AcceptInvitationResult> {
  return post<AcceptInvitationResult>(
    `/api/rooms/invitations/${encodeURIComponent(token)}/accept`
  );
}

export async function listReceivedInvitations(): Promise<RoomInvitationDto[]> {
  const result = await apiFetch<{ invitations: RoomInvitationDto[] }>(
    "/api/rooms/invitations/received"
  );
  return result.invitations;
}

export async function acceptReceivedInvitation(
  invitationId: string
): Promise<AcceptInvitationResult> {
  return post<AcceptInvitationResult>(
    `/api/rooms/invitations/received/${encodeURIComponent(invitationId)}/accept`
  );
}

export async function declineReceivedInvitation(invitationId: string): Promise<RoomInvitationDto> {
  const result = await post<{ invitation: RoomInvitationDto }>(
    `/api/rooms/invitations/received/${encodeURIComponent(invitationId)}/decline`
  );
  return result.invitation;
}

// --- Module 14: leaderboards ---

export interface LeaderboardQuery {
  metric?: LeaderboardMetric;
  period?: LeaderboardPeriod;
  page?: number;
  limit?: number;
}

function leaderboardQueryString(query: LeaderboardQuery): string {
  const params = new URLSearchParams();
  if (query.metric !== undefined) params.set("metric", query.metric);
  if (query.period !== undefined) params.set("period", query.period);
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

export async function getGlobalLeaderboard(
  query: LeaderboardQuery = {}
): Promise<LeaderboardPageDto> {
  return apiFetch<LeaderboardPageDto>(`/api/leaderboards/global${leaderboardQueryString(query)}`);
}

export async function getRoomLeaderboard(
  roomId: string,
  query: LeaderboardQuery = {}
): Promise<LeaderboardPageDto> {
  return apiFetch<LeaderboardPageDto>(
    `/api/leaderboards/rooms/${encodeURIComponent(roomId)}${leaderboardQueryString(query)}`
  );
}

// --- Module 15: personal contests ---

export interface ContestListQuery {
  roomId?: string;
}

export async function listContests(query: ContestListQuery = {}): Promise<{ contests: ContestSummaryDto[] }> {
  const params = new URLSearchParams();
  if (query.roomId) params.set("roomId", query.roomId);
  const text = params.toString();
  return apiFetch<{ contests: ContestSummaryDto[] }>(`/api/contests${text === "" ? "" : `?${text}`}`);
}

export interface CreateContestBody {
  roomId: string;
  name: string;
  description?: string | null;
  difficulty: ContestDifficulty;
  topics?: string[];
}

export async function createContest(
  body: CreateContestBody
): Promise<{ contest: ContestDto }> {
  return post<{ contest: ContestDto }>("/api/contests", body);
}

export async function getContest(contestId: string): Promise<{ contest: ContestDto }> {
  return apiFetch<{ contest: ContestDto }>(
    `/api/contests/${encodeURIComponent(contestId)}`
  );
}

export async function regenerateContest(
  contestId: string
): Promise<{ contest: ContestDto }> {
  return post<{ contest: ContestDto }>(
    `/api/contests/${encodeURIComponent(contestId)}/regenerate`
  );
}

export async function publishContest(
  contestId: string
): Promise<{ contest: ContestDto }> {
  return post<{ contest: ContestDto }>(
    `/api/contests/${encodeURIComponent(contestId)}/publish`
  );
}

export async function startContest(
  contestId: string
): Promise<{ attempt: ContestAttemptDto }> {
  return post<{ attempt: ContestAttemptDto }>(
    `/api/contests/${encodeURIComponent(contestId)}/start`
  );
}

export async function getAttempt(contestId: string): Promise<{ attempt: ContestAttemptDto }> {
  return apiFetch<{ attempt: ContestAttemptDto }>(
    `/api/contests/${encodeURIComponent(contestId)}/attempt`
  );
}

export async function completeProblem(
  contestId: string,
  problemId: string
): Promise<{ attempt: ContestAttemptDto }> {
  return post<{ attempt: ContestAttemptDto }>(
    `/api/contests/${encodeURIComponent(contestId)}/attempt/problems/${encodeURIComponent(problemId)}/complete`
  );
}

export async function getContestResults(
  contestId: string
): Promise<{ results: ContestResultsDto }> {
  return apiFetch<{ results: ContestResultsDto }>(
    `/api/contests/${encodeURIComponent(contestId)}/results`
  );
}

export type { SafeUser };
export type {
  ActivityCoverageDto,
  ActivityDayDto,
  ActivityTotalsDto,
  AnalyticsRange,
  AnalyticsSummaryDto,
  ContestAttemptDto,
  ContestDto,
  ContestDifficulty,
  ContestEntryDto,
  ContestLeaderboardEntryDto,
  ContestResultsDto,
  ContestStatus,
  ContestSummaryDto,
  CprDto,
  CprSnapshotDto,
  CreatedInvitationDto,
  CreateContestRequest,
  CreateRoomRequest,
  InvitationPreviewDto,
  LeaderboardEntryDto,
  LeaderboardMetric,
  LeaderboardPageDto,
  LeaderboardPeriod,
  LinkedAccountDto,
  NativeRatingPointDto,
  PeriodComparisonDto,
  PlatformBreakdownDto,
  PlatformInfo,
  RecentActivityItemDto,
  RoomDetailsDto,
  RoomDto,
  RoomInvitationDto,
  RoomMemberDto,
  RoomMemberProgressDto,
  StreakDto,
  TrendBucketDto,
  UpdateProfileRequest,
  UpdateRoomRequest,
};
export { CONTEST_TOPICS };
