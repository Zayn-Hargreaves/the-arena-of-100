data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  # Thumbprint historically required; AWS now validates GitHub's cert chain.
  # Keep a well-known GitHub Actions thumbprint for older provider versions.
  github_oidc_thumbprint = "6938fd4d98bab03faadb97b34396831e3780aea1"
  role_name              = "${var.name_prefix}-gha"
  subjects = [
    "repo:${var.github_org}/${var.github_repo}:ref:refs/heads/main",
    "repo:${var.github_org}/${var.github_repo}:pull_request",
    "repo:${var.github_org}/${var.github_repo}:environment:staging",
  ]
}

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [local.github_oidc_thumbprint]
  tags            = merge(var.tags, { Name = "${var.name_prefix}-github-oidc" })
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 0 : 1
  url   = "https://token.actions.githubusercontent.com"
}

locals {
  oidc_provider_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn
}

resource "aws_iam_role" "gha" {
  name = local.role_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = local.oidc_provider_arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        "ForAnyValue:StringLike" = {
          "token.actions.githubusercontent.com:sub" = local.subjects
        }
      }
    }]
  })

  tags = merge(var.tags, { Name = local.role_name })
}

# Broad-enough demo deploy permissions: ECR push, ECS update, pass roles, run-task, TF apply scope.
# Tighten before any real production use.
resource "aws_iam_role_policy" "gha_deploy" {
  name = "${var.name_prefix}-gha-deploy"
  role = aws_iam_role.gha.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ECRAuth"
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      },
      {
        Sid    = "ECRPush"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:DescribeRepositories",
          "ecr:ListImages",
          "ecr:DescribeImages"
        ]
        Resource = var.ecr_repository_arn
      },
      {
        Sid    = "ECSDeploy"
        Effect = "Allow"
        Action = [
          "ecs:DescribeClusters",
          "ecs:DescribeServices",
          "ecs:DescribeTaskDefinition",
          "ecs:DescribeTasks",
          "ecs:ListTasks",
          "ecs:RegisterTaskDefinition",
          "ecs:UpdateService",
          "ecs:RunTask",
          "ecs:TagResource"
        ]
        Resource = "*"
      },
      {
        Sid      = "PassTaskRoles"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = [var.task_execution_role_arn, var.task_role_arn]
      },
      {
        Sid    = "LogsRead"
        Effect = "Allow"
        Action = [
          "logs:GetLogEvents",
          "logs:FilterLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = "*"
      },
      {
        Sid    = "TerraformStateAndRead"
        Effect = "Allow"
        Action = [
          "ec2:Describe*",
          "elasticloadbalancing:Describe*",
          "rds:Describe*",
          "elasticache:Describe*",
          "secretsmanager:Describe*",
          "secretsmanager:GetSecretValue",
          "secretsmanager:ListSecrets",
          "iam:GetRole",
          "iam:GetRolePolicy",
          "iam:GetOpenIDConnectProvider",
          "iam:ListRolePolicies",
          "iam:ListAttachedRolePolicies",
          "iam:GetPolicy",
          "iam:GetPolicyVersion",
          "cloudwatch:Describe*",
          "logs:DescribeLogGroups",
          "ecs:Describe*",
          "ecs:List*"
        ]
        Resource = "*"
      },
      {
        Sid    = "TerraformApplyDemo"
        Effect = "Allow"
        Action = [
          "ec2:*",
          "elasticloadbalancing:*",
          "rds:*",
          "elasticache:*",
          "secretsmanager:*",
          "ecr:*",
          "ecs:*",
          "logs:*",
          "iam:CreateRole",
          "iam:DeleteRole",
          "iam:PutRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:AttachRolePolicy",
          "iam:DetachRolePolicy",
          "iam:TagRole",
          "iam:UntagRole",
          "iam:UpdateAssumeRolePolicy",
          "iam:CreateOpenIDConnectProvider",
          "iam:DeleteOpenIDConnectProvider",
          "iam:TagOpenIDConnectProvider",
          "iam:UpdateOpenIDConnectProviderThumbprint",
          "iam:PassRole"
        ]
        Resource = "*"
      }
    ]
  })
}
