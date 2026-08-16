# Arena of 100 — AWS staging Terraform (demo)

Short-lived **staging-only** stack for a **3–5 day** group demo / evaluation.

| In Terraform                      | Out of Terraform                        |
| --------------------------------- | --------------------------------------- |
| VPC, ALB, ECS Fargate API         | **Vercel** (Next.js web)                |
| RDS Postgres 16                   | Local `docker-compose*.yml` (unchanged) |
| ElastiCache Redis 7 (TLS + AUTH)  | Production / multi-region               |
| ECR (immutable tags), SM shells   | Secret _values_ (seeded outside TF)     |
| GitHub OIDC (plan + deploy roles) |                                         |

**Region:** `ap-southeast-1`

---

## Cost model (demo defaults)

Designed for **&lt; ~$50/month** if left up continuously; a 3–5 day run is typically **~$5–15** depending on hours.

| Component | Choice                                  | Why                  |
| --------- | --------------------------------------- | -------------------- |
| AZ        | Single data plane AZ preference         | Cheap                |
| NAT       | **None**                                | Saves ~$32/mo + data |
| Fargate   | 1× 0.25 vCPU / 512 MB, public IP        | Minimal              |
| RDS       | `db.t4g.micro`, 20 GB gp3, private data | Minimal              |
| Redis     | `cache.t4g.micro`, TLS + AUTH           | Minimal              |
| ALB       | HTTPS default (ACM required)            | Vercel-safe clients  |
| Logs      | 7-day retention, no Container Insights  | Cheap                |

### Security tradeoff (no NAT)

- **ECS** runs in **public** subnets with `assign_public_ip = true` (outbound via IGW for ECR / Secrets Manager).
- **RDS / Redis** sit in **private data subnets** (no default route to IGW). Same-VPC routing lets ECS reach them; SGs only allow ECS → data.
- ECS only accepts **:3001 from the ALB SG**.

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

1. AWS account + credentials (`aws configure` or env keys) with rights to create VPC/ECS/RDS/IAM/S3/DynamoDB/etc.
2. [Terraform](https://developer.hashicorp.com/terraform/install) ≥ 1.5
3. Docker (to build/push API image)
4. GitHub repo access (for OIDC deploy workflows)
5. **ACM certificate** in `ap-southeast-1` + **domain** for HTTPS (required before connecting Vercel)
6. **Encrypted remote backend** (next section) — **mandatory before first `apply`**

### HTTPS + domain (required for Vercel)

Public staging defaults to **`enable_https = true`**. You must provide:

- `certificate_arn` — ACM cert in **ap-southeast-1**
- `domain_name` — hostname clients use (e.g. `api.example.com`)
- Prefer Route53 alias (`route53_zone_id`) or equivalent DNS to the ALB

**Do not** point HTTPS-hosted web clients (Vercel) at plain `http://<alb-dns>`. Mixed content and cookie issues break the demo. Reserve HTTP-only ALB only for **local testing outside HTTPS-hosted web clients** (`enable_https = false` is an explicit opt-out, not the default).

---

## 0. Bootstrap remote state (**mandatory before first apply**)

Local state and plan files can contain **plaintext DB passwords, JWT material, and Redis AUTH**. Use encrypted S3 state + DynamoDB locking.

```bash
cd infrastructure/terraform/backend
terraform init
terraform apply -var="state_bucket_name=YOUR_UNIQUE_BUCKET"

# Copy outputs into envs/staging/backend.tf (replace TODO_* placeholders)
terraform output -raw backend_config_snippet
# edit ../envs/staging/backend.tf → bucket + dynamodb_table

cd ../envs/staging
terraform init -migrate-state   # if you already had local state; else: terraform init
```

State bucket uses `force_destroy = false` and `prevent_destroy` so version history is preserved.

---

## 1. Configure

```bash
cd infrastructure/terraform/envs/staging
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars — github_org, jwt_secret, cors_origin (https://…),
# certificate_arn, domain_name (HTTPS defaults on)
```

Never commit `terraform.tfvars`, `*.tfvars.json`, or `*.tfstate`.

---

## 2. Apply infrastructure

```bash
cd infrastructure/terraform/envs/staging
terraform plan
terraform apply
```

Note outputs:

```bash
terraform output alb_dns_name
terraform output ecr_repository_url
terraform output gha_role_arn
terraform output gha_plan_role_arn
terraform output -raw api_base_url
terraform output secret_names
```

### Seed Secrets Manager (values are **not** in Terraform state)

Terraform only creates secret **shells**. After apply, seed versions (OIDC deploy role or local AWS CLI):

```bash
cd infrastructure/terraform/envs/staging
PREFIX=$(terraform output -raw secret_names | jq -r '.DATABASE_URL' | sed 's|/DATABASE_URL||')  # or use names map

aws secretsmanager put-secret-value \
  --secret-id "$(terraform output -json secret_names | jq -r '.DATABASE_URL')" \
  --secret-string "$(terraform output -raw seed_database_url)"

aws secretsmanager put-secret-value \
  --secret-id "$(terraform output -json secret_names | jq -r '.REDIS_URL')" \
  --secret-string "$(terraform output -raw seed_redis_url)"   # rediss://:TOKEN@host:6379

aws secretsmanager put-secret-value \
  --secret-id "$(terraform output -json secret_names | jq -r '.JWT_SECRET')" \
  --secret-string "YOUR_JWT_SECRET_FROM_TFVARS"
```

`REDIS_URL` must use **`rediss://`** (TLS) and include the AUTH token. The API accepts this via ioredis `REDIS_URL`.

ECS may stay unhealthy until secrets are seeded and the first image is pushed.

---

## 3. First image push (immutable tags)

ECR is **`IMMUTABLE`** + `scan_on_push`. Do **not** reuse `:latest`. Use unique tags (commit SHA).

```bash
AWS_REGION=ap-southeast-1
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URL=$(cd infrastructure/terraform/envs/staging && terraform output -raw ecr_repository_url)
TAG=$(git rev-parse HEAD)   # or any unique tag matching image_tag / migrate_image_tag for bootstrap

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

# Runtime image (ECS service) — tag must match var.image_tag on first apply, or register a new TD
docker build -f apps/api/Dockerfile --target runtime -t "$ECR_URL:$TAG" .
docker push "$ECR_URL:$TAG"

# Build-stage image (Prisma CLI) — unique migrate-* tag
docker build -f apps/api/Dockerfile --target build -t "$ECR_URL:migrate-$TAG" .
docker push "$ECR_URL:migrate-$TAG"
```

If the initial task definition used `image_tag = "bootstrap"`, either push that tag once or let the **Deploy API (staging)** workflow register a SHA-tagged revision.

Force a new deployment after pushing a matching tag:

```bash
CLUSTER=$(cd infrastructure/terraform/envs/staging && terraform output -raw ecs_cluster_name)
SERVICE=$(cd infrastructure/terraform/envs/staging && terraform output -raw ecs_service_name)
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --force-new-deployment --region ap-southeast-1
```

---

## 4. Run Prisma migrate (one-shot task)

Runtime image has **no** Prisma CLI. Use the **migrate** image URI (Dockerfile `build` stage). Task definition uses `migrate_image_uri` and a valid `prisma migrate deploy` command.

Prefer the GitHub **Deploy API (staging)** workflow (registers a temporary task definition with the SHA migrate image — **does not** swap image via `run-task` overrides).

Manual sketch:

```bash
cd infrastructure/terraform/envs/staging
CLUSTER=$(terraform output -raw ecs_cluster_name)
SUBNET=$(terraform output -json public_subnet_ids | jq -r '.[0]')
SG=$(terraform output -raw ecs_security_group_id)
FAMILY=$(terraform output -raw migrate_task_definition_family)
REGION=ap-southeast-1

# Register TD revision with migrate image URI, then:
aws ecs run-task \
  --region "$REGION" \
  --cluster "$CLUSTER" \
  --launch-type FARGATE \
  --task-definition "$FAMILY" \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET],securityGroups=[$SG],assignPublicIp=ENABLED}"
```

Watch logs:

```bash
aws logs tail "$(terraform output -raw log_group_name)" --follow --region ap-southeast-1
```

---

## 5. Point Vercel + CORS

**Prerequisites:** HTTPS ALB listener + ACM + domain (step prerequisites). Do not use HTTP ALB DNS for Vercel.

1. Terraform plain env sets `CORS_ORIGIN` from `cors_origin` tfvar → your **https://** Vercel URL.
2. In Vercel project env:

   | Name                  | Value                                   |
   | --------------------- | --------------------------------------- |
   | `NEXT_PUBLIC_API_URL` | `https://api.example.com` (your domain) |

3. Redeploy the web app.
4. **Socket.IO** uses the same origin; ALB idle timeout is **3600s** and stickiness is on.

Guest JWT cookies: staging sets `CROSS_SITE_COOKIES=true` for cross-site Vercel → API (requires HTTPS on both sides).

HTTP without TLS is reserved for **local** API testing only — not for browsers loading an HTTPS Vercel site.

---

## 6. GitHub Actions

Workflows (no-op unless secrets exist):

| Workflow                 | Trigger                                                                      | Purpose                                    |
| ------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------ |
| `terraform-staging.yml`  | PR / push to `main` on `infrastructure/terraform/**`, or `workflow_dispatch` | `plan` (read-only role); `apply` on env    |
| `deploy-api-staging.yml` | push `main` (API paths) or `workflow_dispatch`                               | SHA tags → ECR, migrate, ECS + wait stable |

**GitHub configuration**

| Secret / Var         | Value                                         |
| -------------------- | --------------------------------------------- |
| `AWS_ROLE_ARN`       | `terraform output -raw gha_role_arn` (deploy) |
| `AWS_ROLE_ARN_PLAN`  | `terraform output -raw gha_plan_role_arn`     |
| `AWS_REGION` (var)   | `ap-southeast-1`                              |
| `TF_CERTIFICATE_ARN` | ACM ARN                                       |
| `TF_DOMAIN_NAME`     | API hostname                                  |
| `TF_JWT_SECRET`      | JWT for apply / seed reference                |

**GitHub Environment `staging` (required for deploy role trust):**

- Deployment branches: **main only**
- Required reviewers: at least one approval before apply/deploy
- Deploy OIDC subject is **only** `repo:ORG/REPO:environment:staging` — **no** `pull_request` on the apply/deploy role
- Plan job uses `AWS_ROLE_ARN_PLAN` (PR + `main` subjects, read-only)

If AWS is not configured, jobs **skip** so CI stays green for contributors without cloud access.

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

State bucket is **protected** (`prevent_destroy`) — empty/delete it manually if you must remove the backend stack.

Also remove Vercel env pointing at the dead API, and optional GitHub AWS role secrets.

Confirm in the AWS console that VPC / RDS / ALB / ECS are gone so you are not billed.

---

## Secrets layout

| Secret path                  | Env injected into ECS | How value is set                        |
| ---------------------------- | --------------------- | --------------------------------------- |
| `{name_prefix}/DATABASE_URL` | `DATABASE_URL`        | `put-secret-value` after apply (not TF) |
| `{name_prefix}/REDIS_URL`    | `REDIS_URL`           | `rediss://:AUTH@host:port` after apply  |
| `{name_prefix}/JWT_SECRET`   | `JWT_SECRET`          | `put-secret-value` after apply          |

Plain env (non-secret): `NODE_ENV`, `PORT`, `DATABASE_SSL=true`, `CORS_ORIGIN`, `JWT_EXPIRES_IN`, `REFRESH_EXPIRES_IN`, `INSTANCE_ID`, `CROSS_SITE_COOKIES`.

To rotate JWT or CORS: update SM / plain env and force a new ECS deployment. Prefer not re-applying secrets into Terraform state.

---

## HTTPS

1. Request/validate an ACM cert in **ap-southeast-1**.
2. Set in tfvars (defaults already prefer HTTPS):

```hcl
enable_https    = true
certificate_arn = "arn:aws:acm:ap-southeast-1:..."
domain_name     = "api.example.com"
# route53_zone_id = "Z..."
```

3. `terraform apply`
4. Point Vercel `NEXT_PUBLIC_API_URL` and `cors_origin` at `https://…`.

---

## Module map

```
infrastructure/terraform/
  backend/                 # mandatory S3+DynamoDB state bootstrap
  modules/
    networking/            # VPC, public + private data subnets, SGs (no NAT)
    data-postgres/         # RDS Postgres 16 (private data subnets)
    data-redis/            # ElastiCache Redis 7 TLS+AUTH (private data)
    ecr/                   # IMMUTABLE tags, scan on push
    secrets/               # SM shells only (no secret versions in TF)
    alb/                   # ALB + TG (HTTPS default, WS idle 3600)
    ecs-api/               # cluster, service, runtime + migrate task defs
    gha-oidc/              # plan (RO) + deploy (environment:staging) roles
  envs/staging/            # wiring for this demo
```

---

## Local docker-compose

**Do not replace or break** `infrastructure/docker-compose*.yml`. Terraform is additive for AWS only. Local dev remains:

```bash
docker compose -f infrastructure/docker-compose.yml up -d
pnpm install && pnpm db:push && pnpm dev
```

Local Redis stays `redis://localhost:6379` (no TLS). Staging uses `rediss://` only in AWS Secrets Manager.
