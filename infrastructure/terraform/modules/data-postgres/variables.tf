variable "name_prefix" {
  type = string
}

variable "subnet_ids" {
  description = "Subnets for DB subnet group (use 2 AZs — AWS requires ≥2 even for single-AZ instance)"
  type        = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "db_name" {
  type    = string
  default = "arena_of_100"
}

variable "db_username" {
  type    = string
  default = "arena"
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "allocated_storage" {
  type    = number
  default = 20
}

variable "backup_retention_period" {
  type    = number
  default = 1
}

variable "skip_final_snapshot" {
  type    = bool
  default = true
}

variable "deletion_protection" {
  type    = bool
  default = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
