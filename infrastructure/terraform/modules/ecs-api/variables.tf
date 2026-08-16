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
  type    = string
  default = "latest"
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
