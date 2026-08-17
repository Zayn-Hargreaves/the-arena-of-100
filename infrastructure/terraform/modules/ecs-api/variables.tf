variable "name_prefix" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "Subnets for Fargate tasks (public for demo — assign public IP)"
  type        = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "target_group_arn" {
  type = string
}

variable "ecr_repository_url" {
  type = string
}

variable "image_tag" {
  description = "Runtime image tag (prefer immutable commit SHA; avoid reusing mutable tags with IMMUTABLE ECR)"
  type        = string
  default     = "bootstrap"
}

variable "migrate_image_uri" {
  description = "Full image URI for the migrate task definition (build-stage image with Prisma CLI). Must not reuse the runtime image tag."
  type        = string
}

variable "cpu" {
  type    = number
  default = 256
}

variable "memory" {
  type    = number
  default = 512
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "container_port" {
  type    = number
  default = 3001
}

variable "assign_public_ip" {
  description = "true for demo (no NAT). false if using private subnets + NAT"
  type        = bool
  default     = true
}

variable "plain_environment" {
  description = "Non-secret env vars (key → value)"
  type        = map(string)
  default     = {}
}

variable "secret_environment" {
  description = "Secret env vars (env name → Secrets Manager ARN)"
  type        = map(string)
  default     = {}
}

variable "log_retention_days" {
  type    = number
  default = 7
}

variable "tags" {
  type    = map(string)
  default = {}
}
