import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RefreshInput = z.infer<typeof refreshSchema>;

export class RefreshDto implements RefreshInput {
  @ApiProperty({
    example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    description: "The valid refresh token issued during login",
  })
  refreshToken!: string;
}
