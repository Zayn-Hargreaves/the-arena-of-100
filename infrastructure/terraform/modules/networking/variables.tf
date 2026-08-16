variable "name_prefix" {
  description = "Resource name prefix (e.g. arena-staging)"
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.20.0.0/16"
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
