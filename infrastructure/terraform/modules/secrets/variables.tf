variable "name_prefix" {
  type = string
}

variable "secret_keys" {
  description = "Non-sensitive set of secret name suffixes (for_each keys). Values are seeded outside Terraform."
  type        = set(string)
}

variable "tags" {
  type    = map(string)
  default = {}
}
