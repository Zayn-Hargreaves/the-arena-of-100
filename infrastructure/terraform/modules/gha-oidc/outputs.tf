output "role_arn" {
  description = "Deploy/apply role ARN — GitHub secret AWS_ROLE_ARN; Environment staging only"
  value       = aws_iam_role.gha.arn
}

output "role_name" {
  value = aws_iam_role.gha.name
}

output "plan_role_arn" {
  description = "Read-only plan role ARN — GitHub secret AWS_ROLE_ARN_PLAN (PR + main)"
  value       = aws_iam_role.gha_plan.arn
}

output "plan_role_name" {
  value = aws_iam_role.gha_plan.name
}

output "oidc_provider_arn" {
  value = local.oidc_provider_arn
}
