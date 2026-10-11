/**
 * Shared contracts for CodePulse.
 * Module 0: ApiResponse helpers. Modules 1-2: auth/user HTTP contracts.
 * Full database contracts arrive with later modules.
 */

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  timestamp?: string;
}

export function ok<T>(message: string, data?: T): ApiResponse<T> {
  return {
    success: true,
    message,
    ...(data !== undefined ? { data } : {}),
    timestamp: new Date().toISOString(),
  };
}

export function fail(message: string): ApiResponse<never> {
  return {
    success: false,
    message,
    timestamp: new Date().toISOString(),
  };
}

export type {
  AuthData,
  LoginRequest,
  RegisterRequest,
  SafeUser,
  UpdateProfileRequest,
} from "./auth";

export type {
  ConnectAccountRequest,
  ConnectionStatusDto,
  LinkedAccountDto,
  PlatformCapability,
  PlatformId,
  PlatformInfo,
  PlatformStatsDto,
} from "./platforms";

export type {
  ActivityDayDto,
  ActivityHistoryState,
  ActivityTotalsDto,
  ActivityTypeDto,
  PlatformCoverageDto,
  ActivityCoverageDto,
  RecentActivityItemDto,
  StreakDto,
} from "./activity";

export type {
  CprComponentsDto,
  CprCoverageDto,
  CprDto,
  CprSnapshotDto,
  CprStatus,
} from "./rating";

export type {
  RoomDetailsDto,
  RoomDto,
  RoomInvitationDto,
  CreatedInvitationDto,
  InvitationPreviewDto,
  CreateRoomRequest,
  UpdateRoomRequest,
  RoomMemberDto,
  RoomMemberProgressDto,
  RoomRole,
} from "./rooms";

export type {
  AnalyticsRange,
  TrendBucketDto,
  PlatformBreakdownDto,
  PeriodTotalsDto,
  PeriodComparisonDto,
  AnalyticsSummaryDto,
  ContestEntryDto,
  NativeRatingPointDto,
} from "./analytics";

export type {
  LeaderboardMetric,
  LeaderboardPeriod,
  LeaderboardUserDto,
  LeaderboardEntryDto,
  LeaderboardPageDto,
} from "./leaderboards";
