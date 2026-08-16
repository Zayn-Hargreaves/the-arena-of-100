# Arena of 100 — AWS staging Terraform (demo)

Short-lived **staging-only** stack for a **3–5 day** group demo / evaluation.

| In Terraform                      | Out of Terraform                        |
| --------------------------------- | --------------------------------------- |
| VPC, ALB, ECS Fargate API         | **Vercel** (Next.js web)                |
| RDS Postgres 16                   | Local `docker-compose*.yml` (unchanged) |
| ElastiCache Redis 7               | Production / multi-region               |
| ECR, Secrets Manager, GitHub OIDC |                                         |

**Region:** `ap-southeast-1`

---

## Cost model (demo defaults)

Designed for **&lt; ~$50/month** if left up continuously; a 3–5 day run is typically **~$5–15** depending on hours.

| Component | Choice                                   | Why                    |
| --------- | ---------------------------------------- | ---------------------- |
| AZ        | Single data plane AZ                     | Cheap                  |
| NAT       | **None**                                 | Saves ~$32/mo + data   |
| Fargate   | 1× 0.25 vCPU / 512 MB, public IP         | Minimal                |
| RDS       | `db.t4g.micro`, 20 GB gp3, single-AZ     | Minimal                |
| Redis     | `cache.t4g.micro`, 1 node, no replica    | Minimal                |
| ALB       | 1 ALB (largest fixed cost after compute) | Required for HTTP + WS |
| Logs      | 7-day retention, no Container Insights   | Cheap                  |

### Security tradeoff (no NAT)

ECS tasks run in **public subnets with `assign_public_ip = true`**.

- RDS / Redis stay **`publicly_accessible = false`** and only accept traffic from the **ECS security group**.
- ECS only accepts **:3001 from the ALB SG**.
- Tasks still need outbound HTTPS for ECR / Secrets Manager / AWS APIs (via IGW).

This is **acceptable for a short private demo**, not for long-term production. Prefer private subnets + 1 NAT if you extend beyond the demo window.

### Fixed costs that dominate

- **ALB** ≈ $16–22/mo + LCU
- **Fargate** ≈ $7–10/mo for 0.25/512 always-on
- **RDS t4g.micro** ≈ $12–15/mo
- **Redis t4g.micro** ≈ $12/mo
- **NAT (not used)** would add ≈ $32/mo + data

**Destroy as soon as the demo ends.**

---

## Prerequisites

1. AWS account + credentials (`aws configure` or env keys) with rights to create VPC/ECS/RDS/IAM/etc.
2. [Terraform](https://developer.hashicorp.com/terraform/install) ≥ 1.5
3. Docker (to build/push API image)
4. GitHub repo access (for OIDC deploy workflows)

Optional: ACM certificate in `ap-southeast-1` if you want HTTPS (`enable_https = true`).

**Domain / Route53 is optional.** Default demo uses plain **HTTP on the ALB DNS name**.

---

## 1. Configure

```bash
cd infrastructure/terraform/envs/staging
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars — at least github_org, jwt_secret, cors_origin
```

Never commit `terraform.tfvars` or `*.tfstate`.

---

## 2. Apply infrastructure

```bash
cd infrastructure/terraform/envs/staging
terraform init
terraform plan
terraform apply
```

Note outputs:

```bash
terraform output alb_dns_name
terraform output ecr_repository_url
terraform output gha_role_arn
terraform output -raw api_base_url
```

ECS service may stay unhealthy until the first image is pushed (step 3).

### Optional remote state

```bash
cd infrastructure/terraform/backend
terraform init && terraform apply -var="state_bucket_name=YOUR_UNIQUE_BUCKET"
# paste backend snippet into envs/staging/backend.tf, then:
cd ../envs/staging && terraform init -migrate-state
```

---

## 3. First image push

Build context is the **repo root** (see `apps/api/Dockerfile`).

```bash
AWS_REGION=ap-southeast-1
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URL=$(cd infrastructure/terraform/envs/staging && terraform output -raw ecr_repository_url)

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

# Runtime image (ECS service)
docker build -f apps/api/Dockerfile --target runtime -t "$ECR_URL:latest" .
docker push "$ECR_URL:latest"

# Build-stage image (has prisma CLI + tsx for migrate/seed)
docker build -f apps/api/Dockerfile --target build -t "$ECR_URL:migrate" .
docker push "$ECR_URL:migrate"
```

Force a new deployment:

```bash
CLUSTER=$(cd infrastructure/terraform/envs/staging && terraform output -raw ecs_cluster_name)
SERVICE=$(cd infrastructure/terraform/envs/staging && terraform output -raw ecs_service_name)
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --force-new-deployment --region ap-southeast-1
```

---

## 4. Run Prisma migrate (one-shot task)

Runtime image has **no** Prisma CLI. Use the `:migrate` tag (Dockerfile `build` stage).

```bash
cd infrastructure/terraform/envs/staging
CLUSTER=$(terraform output -raw ecs_cluster_name)
SUBNET=$(terraform output -json public_subnet_ids | jq -r '.[0]')
SG=$(terraform output -raw ecs_security_group_id)
ECR=$(terraform output -raw ecr_repository_url)
FAMILY=$(terraform output -raw migrate_task_definition_family)
REGION=ap-southeast-1

# Register a one-off task def revision pointing at :migrate with prisma command
# (simplest path used by .github/workflows/deploy-api-staging.yml)

aws ecs run-task \
  --region "$REGION" \
  --cluster "$CLUSTER" \
  --launch-type FARGATE \
  --task-definition "$FAMILY" \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET],securityGroups=[$SG],assignPublicIp=ENABLED}" \
  --overrides "{
    \"containerOverrides\": [{
      \"name\": \"migrate\",
      \"image\": \"${ECR}:migrate\",
      \"command\": [\"sh\",\"-c\",\"pnpm --filter @arena/api exec prisma migrate deploy && pnpm --filter @arena/api run prisma:seed:dev\"]
    }]
  }"
```

> Overrides may not accept `image` on all API versions. Prefer the GitHub **Deploy API (staging)** workflow, which registers a temporary task definition with the migrate image.

Watch logs:

```bash
aws logs tail "$(terraform output -raw log_group_name)" --follow --region ap-southeast-1
```

---

## 5. Point Vercel + CORS

1. Terraform / Secrets already set `CORS_ORIGIN` from `cors_origin` tfvar → your Vercel URL.
2. In Vercel project env:

   | Name                  | Value                                                     |
   | --------------------- | --------------------------------------------------------- |
   | `NEXT_PUBLIC_API_URL` | `http://<alb_dns_name>` (or `https://…` if HTTPS enabled) |

3. Redeploy the web app.
4. If you only have ALB HTTP, browsers may mix content if the Vercel site is HTTPS — for a real demo prefer `enable_https = true` + ACM, or test from HTTP preview. **Socket.IO** works over the same ALB origin; idle timeout is **3600s** and stickiness is on.

Guest JWT cookies: staging sets `CROSS_SITE_COOKIES=true` for cross-site Vercel → API.

---

## 6. GitHub Actions

Workflows (no-op unless secrets exist):

| Workflow                 | Trigger                                                                      | Purpose                                   |
| ------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------- |
| `terraform-staging.yml`  | PR / push to `main` on `infrastructure/terraform/**`, or `workflow_dispatch` | `plan` on PR; `apply` on merge/`dispatch` |
| `deploy-api-staging.yml` | push `main` (API paths) or `workflow_dispatch`                               | Build/push ECR, migrate task, ECS deploy  |

**GitHub configuration** (Settings → Secrets and variables → Actions):

| Secret / Var       | Value                                |
| ------------------ | ------------------------------------ |
| `AWS_ROLE_ARN`     | `terraform output -raw gha_role_arn` |
| `AWS_REGION` (var) | `ap-southeast-1`                     |

OIDC trust is limited to this `github_org/github_repo` on `main`, PRs, and `staging` environment.

If AWS is not configured, jobs **skip** (`if: secrets.AWS_ROLE_ARN != ''`) so CI stays green for contributors without cloud access.

---

## 7. Destroy after demo (important)

```bash
cd infrastructure/terraform/envs/staging
terraform destroy
```

Defaults that make destroy easy:

- `skip_final_snapshot = true`
- `deletion_protection = false`
- ECR `force_delete = true`
- Secrets Manager `recovery_window_in_days = 0`

Also remove Vercel env pointing at the dead ALB, and optional GitHub `AWS_ROLE_ARN` secret.

Confirm in the AWS console that VPC / RDS / ALB / ECS are gone so you are not billed.

---

## Secrets layout

| Secret path                  | Env injected into ECS |
| ---------------------------- | --------------------- |
| `{name_prefix}/DATABASE_URL` | `DATABASE_URL`        |
| `{name_prefix}/REDIS_URL`    | `REDIS_URL`           |
| `{name_prefix}/JWT_SECRET`   | `JWT_SECRET`          |

Plain env (non-secret): `NODE_ENV`, `PORT`, `DATABASE_SSL=true`, `CORS_ORIGIN`, `JWT_EXPIRES_IN`, `REFRESH_EXPIRES_IN`, `INSTANCE_ID`, `CROSS_SITE_COOKIES`.

To rotate JWT or CORS after apply: update tfvars / Secrets Manager and `terraform apply`, then force new ECS deployment.

---

## HTTPS (optional)

1. Request/validate an ACM cert in **ap-southeast-1**.
2. Set:

```hcl
enable_https    = true
certificate_arn = "arn:aws:acm:ap-southeast-1:..."
# optional DNS:
# domain_name     = "api.example.com"
# route53_zone_id = "Z..."
```

3. `terraform apply`
4. Point Vercel `NEXT_PUBLIC_API_URL` and `cors_origin` at `https://…`.

No Route53 zone is required — you can use the ALB DNS with an ACM cert only if the cert covers that name (usually you use a real domain).

---

## Module map

```
infrastructure/terraform/
  backend/                 # optional S3+DynamoDB state
  modules/
    networking/            # VPC, 2 public subnets, SGs (no NAT)
    data-postgres/         # RDS Postgres 16
    data-redis/            # ElastiCache Redis 7
    ecr/                   # arena-of-100-api
    secrets/               # Secrets Manager
    alb/                   # ALB + TG (WS idle 3600, stickiness)
    ecs-api/               # cluster, service, task defs
    gha-oidc/              # GitHub OIDC role
  envs/staging/            # wiring for this demo
```

---

## Local docker-compose

**Do not replace or break** `infrastructure/docker-compose*.yml`. Terraform is additive for AWS only. Local dev remains:

```bash
docker compose -f infrastructure/docker-compose.yml up -d
pnpm install && pnpm db:push && pnpm dev
```
