variable "aws_region" {
  type    = string
  default = "ap-southeast-1"
}

variable "name_prefix" {
  description = "Prefix for all resource names"
  type        = string
  default     = "arena-staging"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

# --- GitHub OIDC ---
variable "github_org" {
  description = "GitHub org or username owning the repo"
  type        = string
}

variable "github_repo" {
  description = "Repository name only (e.g. the-arena-of-100)"
  type        = string
  default     = "the-arena-of-100"
}

variable "create_github_oidc_provider" {
  description = "false if this AWS account already has the GitHub OIDC provider"
  type        = bool
  default     = true
}

# --- API config ---
variable "cors_origin" {
  description = "Browser origin for CORS (HTTPS Vercel URL)"
  type        = string
  default     = "https://localhost:3000"
}

variable "jwt_secret" {
  description = "JWT signing secret — seed into Secrets Manager after apply (not stored as SM version by TF). Still required as a sensitive input for operators to seed."
  type        = string
  sensitive   = true
}

variable "jwt_expires_in" {
  type    = string
  default = "24h"
}

variable "refresh_expires_in" {
  description = "Refresh token TTL in seconds"
  type        = string
  default     = "604800"
}

variable "db_username" {
  type    = string
  default = "arena"
}

variable "db_name" {
  type    = string
  default = "arena_of_100"
}

variable "db_password" {
  description = "RDS master password. Leave empty to auto-generate. Seed DATABASE_URL into SM after apply."
  type        = string
  default     = ""
  sensitive   = true
}

variable "redis_auth_token" {
  description = "Redis AUTH (16–128 chars). Leave empty to auto-generate. Required for TLS+AUTH; seed rediss:// REDIS_URL into SM after apply."
  type        = string
  default     = ""
  sensitive   = true
}

variable "ecr_repository_name" {
  type    = string
  default = "arena-of-100-api"
}

variable "image_tag" {
  description = "Initial runtime ECS image tag (immutable ECR — use unique tags / commit SHA; CI registers newer revs)"
  type        = string
  default     = "bootstrap"
}

variable "migrate_image_tag" {
  description = "Tag for the migrate/build-stage image when migrate_image_uri is empty"
  type        = string
  default     = "migrate-bootstrap"
}

variable "migrate_image_uri" {
  description = "Full migrate image URI override (optional). Default: ecr_url:migrate_image_tag"
  type        = string
  default     = ""
}

variable "api_cpu" {
  type    = number
  default = 256
}

variable "api_memory" {
  type    = number
  default = 512
}

variable "api_desired_count" {
  type    = number
  default = 1
}

# --- HTTPS (default on for public ALB + Vercel clients) ---
variable "enable_https" {
  description = "Require ACM cert; HTTP redirects to HTTPS. Default true for public staging."
  type        = bool
  default     = true
}

variable "certificate_arn" {
  description = "ACM certificate ARN in this region (required when enable_https=true)"
  type        = string
  default     = ""
}

variable "domain_name" {
  description = "API hostname for HTTPS clients (e.g. api.example.com). Required for Vercel HTTPS web."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Optional hosted zone for domain_name alias to ALB"
  type        = string
  default     = ""
}
