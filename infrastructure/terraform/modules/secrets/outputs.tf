output "secret_arns" {
  description = "Map of secret key → ARN"
  value       = { for k, s in aws_secretsmanager_secret.this : k => s.arn }
}

output "secret_names" {
  value = { for k, s in aws_secretsmanager_secret.this : k => s.name }
}
