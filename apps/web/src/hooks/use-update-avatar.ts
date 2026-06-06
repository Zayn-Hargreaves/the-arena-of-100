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
    mutationFn: (avatar: AvatarSeed) =>
      apiSendJson<UserSummary>(
        "/api/v1/users/me/avatar",
        "PATCH",
        { avatar },
        accessToken ?? undefined,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      void queryClient.invalidateQueries({
        queryKey: ["rankings", "leaderboard"],
      });
    },
  });
}
