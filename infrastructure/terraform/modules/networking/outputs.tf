output "vpc_id" {
  value = aws_vpc.this.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_data_subnet_ids" {
  description = "Private subnets for RDS/Redis (no IGW route)"
  value       = aws_subnet.private_data[*].id
}

output "primary_subnet_id" {
  description = "Preferred single-AZ public subnet for ECS (demo, no NAT)"
  value       = aws_subnet.public[0].id
}

output "alb_security_group_id" {
  value = aws_security_group.alb.id
}

output "ecs_security_group_id" {
  value = aws_security_group.ecs.id
}

output "rds_security_group_id" {
  value = aws_security_group.rds.id
}

output "redis_security_group_id" {
  value = aws_security_group.redis.id
}
