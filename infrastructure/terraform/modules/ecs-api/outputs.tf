output "cluster_id" {
  value = aws_ecs_cluster.this.id
}

output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "service_name" {
  value = aws_ecs_service.api.name
}

output "service_id" {
  value = aws_ecs_service.api.id
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.api.arn
}

output "task_definition_family" {
  value = aws_ecs_task_definition.api.family
}

output "migrate_task_definition_arn" {
  value = aws_ecs_task_definition.migrate.arn
}

output "migrate_task_definition_family" {
  value = aws_ecs_task_definition.migrate.family
}

output "execution_role_arn" {
  value = aws_iam_role.execution.arn
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.api.name
}
