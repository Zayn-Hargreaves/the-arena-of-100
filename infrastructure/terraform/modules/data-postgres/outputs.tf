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

output "resource_id" {
  value = aws_db_instance.this.resource_id
}
