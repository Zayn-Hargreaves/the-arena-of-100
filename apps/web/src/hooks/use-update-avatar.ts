"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AvatarSeed } from "@arena/shared";
import { apiSendJson } from "@/lib/api-client";
import { useSocketStore } from "@/stores/socket-store";
import type { UserSummary } from "@/hooks/use-profile-stats";

export function useUpdateAvatar() {
  const queryClient = useQueryClient();
  const accessToken = useSocketStore((state) => state.accessToken);

  return useMutation({
    mutationFn: async (avatar: AvatarSeed) => {
      if (!accessToken) {
        throw new Error("Authentication required to update avatar");
      }
      return apiSendJson<UserSummary>(
        "/api/v1/users/me/avatar",
        "PATCH",
        { avatar },
        accessToken,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({
        queryKey: ["rankings", "leaderboard"],
      });
    },
  });
}
