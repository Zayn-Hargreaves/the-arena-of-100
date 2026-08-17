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
7. **Operator-held secrets**: Redis AUTH (`redis_auth_token`) and app secrets (JWT). RDS master password is **AWS-managed** (`manage_master_user_password`) — read via `rds_master_user_secret_arn`, not a Terraform input

### HTTPS + domain (required for Vercel)

Public staging defaults to **`enable_https = true`**. You must provide:

- `certificate_arn` — ACM cert in **ap-southeast-1**
- `domain_name` — hostname clients use (e.g. `api.example.com`)
- Prefer Route53 alias (`route53_zone_id`) or equivalent DNS to the ALB

**Do not** point HTTPS-hosted web clients (Vercel) at plain `http://<alb-dns>`. Mixed content and cookie issues break the demo. Reserve HTTP-only ALB only for **local testing outside HTTPS-hosted web clients** (`enable_https = false` is an explicit opt-out, not the default).

### Credentials and Terraform state

- **RDS master password**: managed by AWS (`manage_master_user_password`). Not a Terraform input. Read via `GetSecretValue` on `rds_master_user_secret_arn` when seeding `DATABASE_URL`.
- **Redis AUTH**: required input (`redis_auth_token`). Still enters remote state as an ElastiCache attribute.
- **App secrets** (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`): secret **shells** only in Terraform — seed versions with CLI/OIDC after apply. ECS `api_desired_count` defaults to **0** until you seed and scale.

Mitigations already mandatory for this stack:

- Encrypted S3 remote state + DynamoDB locking
- Tight IAM on the state bucket and lock table (gha-oidc roles are scoped to those ARNs)
- Seed Secrets Manager from the operator/CI secret store — **not** from Terraform `secret_version` resources

---

## 0. Bootstrap remote state (**mandatory before first apply**)

Local state and plan files can contain **plaintext DB passwords, JWT material, and Redis AUTH**. Use encrypted S3 state + DynamoDB locking.

```bash
cd infrastructure/terraform/backend
terraform init
terraform apply -var="state_bucket_name=YOUR_UNIQUE_BUCKET"

# Inspect recommended backend settings (bucket + lock table names)
terraform output -raw backend_config_snippet
```

Staging uses a **partial** S3 backend: `key`, `region`, and `encrypt` are committed; **bucket** and **dynamodb_table** are supplied at init time.

```bash
cd infrastructure/terraform/envs/staging

# Local init — pass the same names the backend module created:
terraform init -input=false \
  -backend-config="bucket=YOUR_UNIQUE_BUCKET" \
  -backend-config="dynamodb_table=arena-terraform-locks"

# If you already had local state:
# terraform init -migrate-state \
#   -backend-config="bucket=YOUR_UNIQUE_BUCKET" \
#   -backend-config="dynamodb_table=arena-terraform-locks"
```

CI passes the same flags from GitHub variables `TF_STATE_BUCKET` and `TF_LOCK_TABLE`. Also set matching Terraform variables `tf_state_bucket` / `tf_lock_table` (tfvars or `TF_VAR_*`) so gha-oidc IAM can scope state access to those ARNs.

State bucket uses `force_destroy = false` and `prevent_destroy` so version history is preserved.

---

## 1. Configure

```bash
cd infrastructure/terraform/envs/staging
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars — github_org, jwt_secret, cors_origin (https://…),
# certificate_arn, domain_name, redis_auth_token,
# tf_state_bucket, tf_lock_table (HTTPS defaults on; RDS password is AWS-managed)
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
terraform output -raw rds_address
terraform output -raw redis_endpoint
```

### Seed Secrets Manager (values are **not** re-exported by Terraform)

Terraform only creates secret **shells** and starts ECS at **desired_count = 0**. After apply, construct URLs in your shell (OIDC deploy role or local AWS CLI) and `put-secret-value`. Scale to 1 only after the first image is in ECR (next section). Do **not** store production secret values via `aws_secretsmanager_secret_version` in Terraform.

Percent-encode passwords/tokens before embedding them in URLs (Redis AUTH may contain `#`, `&`, etc. — same as Terraform `urlencode(var.auth_token)`).

```bash
cd infrastructure/terraform/envs/staging

# Avoid shell tracing (set -x) while handling secrets
set +x
set -euo pipefail

# Operator-held secrets (never commit; from password manager / CI secrets)
DB_USER="arena"                          # or var.db_username
DB_NAME="arena_of_100"                   # or var.db_name
REDIS_AUTH='YOUR_REDIS_AUTH_TOKEN'       # same value passed as redis_auth_token
JWT_SECRET='YOUR_JWT_SECRET'             # same value as jwt_secret tfvar

RDS_HOST=$(terraform output -raw rds_address)
RDS_PORT=$(terraform output -raw rds_port)
REDIS_HOST=$(terraform output -raw redis_endpoint)
REDIS_PORT=$(terraform output -raw redis_port)

# RDS-managed master password (not a tfvar)
RDS_SECRET_ARN=$(terraform output -raw rds_master_user_secret_arn)
DB_PASSWORD=$(aws secretsmanager get-secret-value --secret-id "$RDS_SECRET_ARN" \
  --query SecretString --output text | jq -r .password)

# URL-encode password/token for URI safety
enc() { python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$1"; }

DATABASE_URL="postgresql://${DB_USER}:$(enc "$DB_PASSWORD")@${RDS_HOST}:${RDS_PORT}/${DB_NAME}?sslmode=require"
REDIS_URL="rediss://:$(enc "$REDIS_AUTH")@${REDIS_HOST}:${REDIS_PORT}"

# Put secret values via file input (not argv) — AWS CLI file://; requires CLI v2+
SECRET_TMP=$(mktemp)
chmod 600 "$SECRET_TMP"
trap 'rm -f "$SECRET_TMP"' EXIT

put_secret() {
  local secret_id="$1" value="$2"
  printf '%s' "$value" > "$SECRET_TMP"
  aws secretsmanager put-secret-value \
    --secret-id "$secret_id" \
    --secret-string "file://$SECRET_TMP"
}

put_secret "$(terraform output -json secret_names | jq -r '.DATABASE_URL')" "$DATABASE_URL"
put_secret "$(terraform output -json secret_names | jq -r '.REDIS_URL')" "$REDIS_URL"
put_secret "$(terraform output -json secret_names | jq -r '.JWT_SECRET')" "$JWT_SECRET"

# Keep desired_count=0 until the first image exists in ECR (next section).
```

`REDIS_URL` must use **`rediss://`** (TLS) and include the AUTH token (percent-encoded). The API accepts this via ioredis `REDIS_URL`.

ECS stays at **desired_count = 0** until secrets are seeded **and** the first image is pushed (scale up only after the image is in ECR).

---

## 3. First image push (immutable tags)

ECR is **`IMMUTABLE`** + `scan_on_push`. Do **not** reuse `:latest`. Use unique tags (commit SHA). Lifecycle keeps a wide tagged-image window for ECS task-def rollback.

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

**Only after** the runtime image is in ECR: scale the service up (lifecycle ignores `desired_count` after first apply). Do not start tasks against a missing image tag.

```bash
CLUSTER=$(cd infrastructure/terraform/envs/staging && terraform output -raw ecs_cluster_name)
SERVICE=$(cd infrastructure/terraform/envs/staging && terraform output -raw ecs_service_name)
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --desired-count 1 \
  --force-new-deployment \
  --region ap-southeast-1
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

Workflows (no-op unless secrets/vars exist):

| Workflow                 | Trigger                                                                      | Purpose                                    |
| ------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------ |
| `terraform-staging.yml`  | PR / push to `main` on `infrastructure/terraform/**`, or `workflow_dispatch` | `plan` (read-only role); `apply` on env    |
| `deploy-api-staging.yml` | push `main` (API paths) or `workflow_dispatch`                               | SHA tags → ECR, migrate, ECS + wait stable |

**GitHub configuration**

| Secret / Var            | Value                                                                   |
| ----------------------- | ----------------------------------------------------------------------- |
| `AWS_ROLE_ARN`          | `terraform output -raw gha_role_arn` (deploy / apply)                   |
| `AWS_ROLE_ARN_PLAN`     | `terraform output -raw gha_plan_role_arn` (plan only — **no** fallback) |
| `AWS_REGION` (var)      | `ap-southeast-1`                                                        |
| `TF_STATE_BUCKET` (var) | S3 state bucket name (backend bootstrap)                                |
| `TF_LOCK_TABLE` (var)   | DynamoDB lock table name                                                |
| `TF_CERTIFICATE_ARN`    | ACM ARN (required when HTTPS on — default)                              |
| `TF_DOMAIN_NAME`        | API hostname (required when HTTPS on)                                   |
| `TF_JWT_SECRET`         | JWT for apply / seed reference                                          |
| `TF_REDIS_AUTH_TOKEN`   | Redis AUTH (required for apply)                                         |

**GitHub Environment `staging` (required for deploy role trust):**

- Deployment branches: **main only**
- Required reviewers: at least one approval before apply/deploy
- Deploy OIDC subject is **only** `repo:ORG/REPO:environment:staging` — **no** `pull_request` on the apply/deploy role
- Plan job uses **only** `AWS_ROLE_ARN_PLAN` (`main` ref subject only — read-only)
- Apply / deploy jobs share concurrency group `staging-mutations` (`cancel-in-progress: false`) plus a turnstyle queue so mutations run FIFO
- Apply blocks if `TF_REDIS_AUTH_TOKEN` is missing, or if HTTPS is on and cert/domain are missing
- RDS master password is AWS-managed (no `TF_DB_PASSWORD`)

If AWS is not configured, plan jobs **skip** so CI stays green for contributors without cloud access. Apply fails closed when required secrets are absent.

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

1. `terraform apply`
2. Point Vercel `NEXT_PUBLIC_API_URL` and `cors_origin` at `https://…`.

`api_base_url` is `https://<domain_name>` when HTTPS + domain are set; `null` if HTTPS is on without a custom domain; `http://<alb-dns>` only when `enable_https = false`.

---

## Module map

```text
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
