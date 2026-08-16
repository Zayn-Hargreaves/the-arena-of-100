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
  description = "Browser origin for CORS (Vercel URL or localhost)"
  type        = string
  default     = "http://localhost:3000"
}

variable "jwt_secret" {
  description = "JWT signing secret — set via TF_VAR_jwt_secret or tfvars (never commit)"
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
  description = "RDS master password. Leave empty to auto-generate."
  type        = string
  default     = ""
  sensitive   = true
}

variable "redis_auth_token" {
  description = "Optional Redis AUTH (16–128 chars). Empty = no AUTH + no TLS (demo SG-locked)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "ecr_repository_name" {
  type    = string
  default = "arena-of-100-api"
}

variable "image_tag" {
  description = "Initial ECS image tag (CI overwrites via new task defs)"
  type        = string
  default     = "latest"
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

# --- Optional HTTPS ---
variable "enable_https" {
  description = "Require ACM cert; HTTP redirects to HTTPS"
  type        = bool
  default     = false
}

variable "certificate_arn" {
  description = "ACM certificate ARN in this region (only if enable_https)"
  type        = string
  default     = ""
}

variable "domain_name" {
  description = "Optional custom domain (documentation / future Route53)"
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Optional hosted zone — not required for demo (ALB DNS is enough)"
  type        = string
  default     = ""
}
