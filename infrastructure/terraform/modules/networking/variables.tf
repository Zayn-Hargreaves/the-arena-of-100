variable "name_prefix" {
  description = "Resource name prefix (e.g. arena-staging)"
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR block (prefix length /16–/24 so public+private subnets fit)"
  type        = string
  default     = "10.20.0.0/16"

  validation {
    condition = try(
      can(cidrhost(var.vpc_cidr, 0)) &&
      tonumber(split("/", var.vpc_cidr)[1]) >= 16 &&
      tonumber(split("/", var.vpc_cidr)[1]) <= 24,
      false
    )
    error_message = "vpc_cidr prefix length must be between /16 and /24 inclusive (/25–/28 are rejected — too small for dual-AZ public+private subnets)."
  }
}

variable "azs" {
  description = "Availability zones (≥2 distinct). Public + private data subnets are created in each."
  type        = list(string)

  validation {
    condition     = length(distinct(var.azs)) >= 2
    error_message = "azs must contain at least 2 distinct availability zones."
  }
}

variable "tags" {
  description = "Common tags"
  type        = map(string)
  default     = {}
}
