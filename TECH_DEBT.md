# Technical Debt: Dependency Risk - class-transformer & class-validator

## Issue

The project currently uses `class-transformer@^0.5.1` and `class-validator@^0.15.1`, both of which are effectively unmaintained:

- No releases since November 2021
- Minimal activity in their respective GitHub repositories
- Potential future security/compatibility risks

## Current Usage

1. **class-transformer**:
   - `question.entity.ts`: `@Exclude()` decorator to hide sensitive data
   - `get-questions.dto.ts`: `@Transform()` and `@Type()` decorators for data transformation

2. **class-validator**:
   - Extensively used in DTOs for request validation
   - Custom validator implementation (`is-in-array.validator.ts`)

## Current Usage Patterns

### class-transformer

1. **@Exclude()** - Used in `question.entity.ts` to hide the `correctAnswer` field from serialization
2. **@Transform()** - Used in `get-questions.dto.ts` to transform boolean query parameters
3. **@Type()** - Used in `get-questions.dto.ts` to convert query parameters to numbers

### class-validator

1. **Basic validations** - `@IsString()`, `@IsInt()`, `@IsBoolean()`, `@IsArray()`, etc.
2. **Constraints** - `@Min()`, `@Max()`, `@MinLength()`, `@MaxLength()`, `@ArrayMinSize()`, `@ArrayMaxSize()`
3. **Conditional validations** - `@IsOptional()`
4. **Custom validations** - `@IsInArray()` custom validator
5. **Enum validations** - `@IsEnum()`

## Migration Plan

### Phase 1: Evaluation & Preparation

- [x] Evaluate Zod as primary replacement (already in dependencies)
- [x] Assess `@anatine/zod-nestjs` for NestJS integration (custom pipeline chosen to minimize deps)
- [x] Create proof-of-concept migration for one module
- [x] Document migration guidelines and best practices

### Phase 2: Gradual Migration

- [x] Migrate auth module to Zod validation
- [x] Migrate room module to Zod validation
- [x] Migrate question module to Zod validation
- [x] Migrate match module to Zod validation

### Phase 3: Removal

- [x] Remove `class-transformer` and `class-validator` dependencies
- [x] Update documentation and setup guides
- [x] Remove Dependabot ignore rules for these packages

## Risk Mitigation

Until full migration:

- Monitor security advisories for these packages
- Dependabot configured to ignore these packages to prevent automated updates
- Document workaround procedures for potential issues

## Alternatives Evaluated

1. **Zod** (Recommended):
   - Actively maintained
   - Already in project dependencies
   - Used in some controllers already
   - Strong TypeScript inference
   - Good NestJS ecosystem integrations

2. **io-ts**:
   - Functional approach to schema validation
   - More complex for team adoption

3. **Joi**:
   - Popular but less TypeScript friendly

4. **Maintained forks**:
   - Limited community adoption
   - Uncertain long-term viability

## Room Module Security Vulnerability (RoomController spoofing) [RESOLVED]

### Issue

The REST endpoints in `RoomController` (such as `POST /rooms`, `POST /rooms/join`, and `POST /rooms/:roomId/leave`) previously accepted `userId` as a plain Query Parameter (`@Query("userId") userId: string`) without verifying that it belonged to the authenticated requester.

- This created an access control vulnerability where a user could spoof any other user's ID to maliciously perform operations (create rooms, force join other rooms, force leave other rooms) on their behalf.

### Remediation Plan (Completed)

1. Ensure `RoomController` is not marked with `@Public()` decorator (authentication is enforced via global `JwtAuthGuard`).
2. Remove `@Query("userId")` from all controller methods.
3. Retrieve `userId` securely from the authenticated Fastify request context: `req.user.userId`.

### Status: RESOLVED

This vulnerability has been fully resolved:

1. All unverified `@Query("userId")` inputs were removed from REST endpoints in `RoomController`.
2. The user's ID is retrieved securely from the JWT-decoded payload stored in the Fastify request context (`req.user.userId`) populated by the global `JwtAuthGuard`.
3. A complete Vitest unit test suite was added to `room.controller.spec.ts` covering request-context-based secure route execution for room creation, joining, and leaving. All tests pass successfully and no lint errors are present.
