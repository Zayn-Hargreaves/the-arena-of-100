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
  description = "Availability zones (single-AZ demo uses first only for data plane; second used for ALB multi-subnet requirement)"
  type        = list(string)
}

variable "tags" {
  description = "Common tags"
  type        = map(string)
  default     = {}
}
