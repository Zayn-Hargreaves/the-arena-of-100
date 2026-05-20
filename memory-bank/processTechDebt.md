# Technical Debt Resolution: Zod Validation Migration

This document tracks the planning, architecture decisions, and implementation progress for migrating the validation and serialization layer of the `@arena/api` NestJS application from the unmaintained `class-validator` and `class-transformer` packages to [Zod](https://zod.dev).

---

## 🎯 Objectives

1. **Eliminate Dependency Risks**: Remove the unmaintained `class-validator` and `class-transformer` packages from the dependencies.
2. **Type Safety & Schema Reusability**: Leverage Zod's powerful type inference and native integration with modern tools.
3. **Consistent Validation**: Standardize validation across REST and WebSocket endpoints.
4. **Secure Data Serialization**: Protect sensitive data (like `correctAnswer` in the `Question` entity) without relying on decorators.

---

## ⚙️ Design Decisions

After evaluating several options, the following architectural choices have been established:

### 1. Integration Method: Custom `ZodValidationPipe`

We will use a lightweight, custom `ZodValidationPipe` to handle validation inside NestJS.

- **Why**: Keeps dependencies to a minimum (no extra packages like `@anatine/zod-nestjs` unless absolutely required for Swagger integration), and fits perfectly into Fastify and NestJS's standard request lifecycle.
- **How**: The pipe will receive a Zod Schema, parse the incoming payload, and throw custom `BadRequestException` on validation failure.

### 2. Migration Strategy: Module-by-Module (Gradual)

We will migrate one module at a time rather than changing the entire codebase in a single massive Pull Request.

- **Why**: Lowers the risk of regression, allows testing each section independently, and provides a clear POC (Proof of Concept) early on.
- **Sequence**:
  1. **Question Module**: Migrate DTOs and replace the `@Exclude()` decorator on the entity.
  2. **Auth Module**: Migrate auth-related validation.
  3. **Room Module**: Migrate room DTOs (complementing existing Zod parsing).
  4. **Match Module**: Migrate match-related validations.

### 3. Serialization & Custom Validation Replacement

- **Excluding Sensitive Fields**: We will replace `@Exclude()` by using dedicated Zod response schemas or explicit mapping at the Service or Controller boundary (e.g., using `z.object().omit({ correctAnswer: true })` or manual transformation).
- **Custom Array Constraints**: Replace `@IsInArray` (custom class-validator) with native Zod refinements (`z.array().refine(...)` or enum array checking).

---

## 🗺️ Implementation Plan & Status

### Phase 1: Foundation & Preparation (Completed)

- [x] Create custom `ZodValidationPipe` at `apps/api/src/common/pipes/zod-validation.pipe.ts`
- [x] Implement robust error formatter for Zod validation errors to maintain a consistent API response format
- [x] Define standard patterns for response serialization (e.g., omitting `correctAnswer` in `Question` schemas)
- [x] Document migration guide and Zod best practices for the team

### Phase 2: Gradual Module Migration (Completed)

- [x] **Question Module**:
  - [x] Migrate `create-question.dto.ts`, `bulk-import.dto.ts`, `random-query.dto.ts`, and `get-questions.dto.ts` to Zod schemas
  - [x] Remove `class-transformer` `@Exclude()` from `question.entity.ts` and use Zod serialization
  - [x] Update `QuestionController` to use `ZodValidationPipe`
  - [x] Ensure all Question tests (`vitest`) continue to pass
- [x] **Auth Module**:
  - [x] Migrate auth controller validations to Zod
- [x] **Room Module**:
  - [x] Refactor `RoomController` to use `ZodValidationPipe` instead of manual inline `.parse()` calls
- [x] **Match Module**:
  - [x] Migrate match validations to Zod (REST endpoints checked; no body/DTO payloads required validation)

### Phase 3: Clean-up & Dependency Removal (Completed)

- [x] Remove `class-validator` and `class-transformer` from `apps/api/package.json`
- [x] Delete `is-in-array.validator.ts` and its spec file
- [x] Run full project linting and test suite (`pnpm lint` and `pnpm test`) to ensure absolute correctness

---

## 📈 Progress Tracker

| Module / Component  | Task                                           | Status | Notes                               |
| :------------------ | :--------------------------------------------- | :----: | :---------------------------------- |
| **Common/Pipes**    | Custom `ZodValidationPipe`                     |   ✅   | Completed                           |
| **Question Module** | Migrate DTOs & Serialization                   |   ✅   | Completed                           |
| **Auth Module**     | Migrate DTOs                                   |   ✅   | Completed                           |
| **Room Module**     | Standardize Controllers to Pipe                |   ✅   | Completed                           |
| **Match Module**    | Migrate DTOs                                   |   ✅   | Completed (verified no DTOs needed) |
| **Dependencies**    | Remove `class-validator` & `class-transformer` |   ✅   | Completed & Cleaned up              |
