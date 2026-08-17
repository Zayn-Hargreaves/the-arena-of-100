output "endpoint" {
  description = "host:port"
  value       = aws_db_instance.this.endpoint
  sensitive   = true
}

output "address" {
  value     = aws_db_instance.this.address
  sensitive = true
}

output "port" {
  value = aws_db_instance.this.port
}

output "db_name" {
  value = aws_db_instance.this.db_name
}

output "username" {
  value = aws_db_instance.this.username
}

output "master_user_secret_arn" {
  description = "ARN of the RDS-managed master-user secret (Secrets Manager)"
  value       = try(aws_db_instance.this.master_user_secret[0].secret_arn, null)
  sensitive   = true
}

output "resource_id" {
  value = aws_db_instance.this.resource_id
}
