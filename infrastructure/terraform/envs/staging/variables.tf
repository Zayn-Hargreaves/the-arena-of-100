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

# --- Remote state (for gha-oidc IAM scoping; must match backend bootstrap) ---
variable "tf_state_bucket" {
  description = "S3 bucket name for Terraform state (same as backend -backend-config bucket)"
  type        = string
}

variable "tf_lock_table" {
  description = "DynamoDB lock table name (same as backend -backend-config dynamodb_table)"
  type        = string
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
  description = "RDS master password (required). Operator/CI supplies; also used when seeding DATABASE_URL into SM. Lives in TF state as RDS attribute — use encrypted remote state + tight IAM."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.db_password) >= 8
    error_message = "db_password is required (min 8 characters). Supply via TF_VAR_db_password / tfvars; do not rely on Terraform random generation."
  }
}

variable "redis_auth_token" {
  description = "Redis AUTH token (required, 16–128 chars, ElastiCache AUTH charset). Operator/CI supplies; seed rediss:// REDIS_URL into SM after apply. Lives in TF state as ElastiCache attribute."
  type        = string
  sensitive   = true

  validation {
    condition = (
      length(var.redis_auth_token) >= 16 &&
      length(var.redis_auth_token) <= 128 &&
      can(regex("^[A-Za-z0-9!&#$^<>-]+$", var.redis_auth_token))
    )
    error_message = "redis_auth_token must be 16–128 characters and only contain alphanumeric or ! & # $ ^ < > - (ElastiCache AUTH charset)."
  }
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
