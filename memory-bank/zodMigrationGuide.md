# Zod Validation & Serialization Migration Guide

This guide details the standard patterns, utilities, and best practices for migrating `@arena/api` NestJS application from the unmaintained `class-validator` and `class-transformer` packages to [Zod](https://zod.dev).

---

## 🎯 Architectural Overview

To keep concerns separated (as required for clean enterprise architecture), we separate validation and presentation-layer serialization from internal database entities:

1. **Input Validation**: Handled by the custom `ZodValidationPipe` bound at the route parameter level.
2. **Output Serialization**: Handled by the custom `ZodSerializerInterceptor` (applied via `@ZodSerialize(schema)` decorator) at the route method level.
3. **Swagger Integration**: Handled by defining explicit DTO classes implementing Zod-inferred types, decorated with `@ApiProperty()`.

---

## ⚙️ Core Components Reference

### 1. Custom `ZodValidationPipe`

The custom pipe is defined at `apps/api/src/common/pipes/zod-validation.pipe.ts`.
It parses the input using `schema.safeParse` and, if it fails, formats all Zod issues into a `string[]` of format `field: error message`. This ensures compatibility with current error formats caught by `HttpExceptionFilter`.

**Usage Example:**

```typescript
import { Body, Controller, Post } from "@nestjs/common";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import {
  createQuestionSchema,
  CreateQuestionDto,
} from "./dto/create-question.dto";

@Controller("questions")
export class QuestionController {
  @Post()
  async create(
    @Body(new ZodValidationPipe(createQuestionSchema))
    createQuestionDto: CreateQuestionDto,
  ) {
    return this.questionService.create(createQuestionDto);
  }
}
```

### 2. Custom `ZodSerialize` Decorator

The custom response serializer is defined at `apps/api/src/common/interceptors/zod-serializer.interceptor.ts`.
It strips any unmapped or sensitive properties (like `correctAnswer` in a public question schema) before the response reaches the client. It handles single objects, arrays, and paginated responses automatically.

**Usage Example:**

```typescript
import { Controller, Get } from "@nestjs/common";
import { ZodSerialize } from "../../common/interceptors/zod-serializer.interceptor";
import { questionResponseSchema } from "./dto/question-response.dto";

@Controller("questions")
export class QuestionController {
  @Get()
  @ZodSerialize(questionResponseSchema)
  async findAll() {
    return this.questionService.findAll(); // Returns raw questions containing correctAnswer; interceptor strips it
  }
}
```

---

## 🛠️ Step-by-Step Migration Pattern

When migrating a module (e.g., Auth, Question, Room), follow this 3-step pattern:

### Step 1: Write Zod Validation and Response Schemas

Define both input validation and response serialization schemas in your DTO files.

**Example: `create-question.dto.ts`**

```typescript
import { z } from "zod";
import { ApiProperty } from "@nestjs/swagger";

// 1. Define the Zod Schema
export const createQuestionSchema = z
  .object({
    content: z.string().min(10).max(1000),
    options: z.array(z.string().min(1)).min(2).max(6),
    correctAnswer: z.string(),
    difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
    active: z.boolean().optional(),
  })
  // Replace custom decorators (e.g. @IsInArray) with native Zod refinements
  .refine((data) => data.options.includes(data.correctAnswer), {
    message: "correctAnswer must be one of the options",
    path: ["correctAnswer"],
  });

// 2. Infer the type from Zod Schema
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;

// 3. Define the DTO class for Swagger, implementing the Zod type
export class CreateQuestionDto implements CreateQuestionInput {
  @ApiProperty({ example: "What is the capital of France?" })
  content!: string;

  @ApiProperty({ example: ["Paris", "London", "Berlin"] })
  options!: string[];

  @ApiProperty({ example: "Paris" })
  correctAnswer!: string;

  @ApiProperty({ example: "EASY", enum: ["EASY", "MEDIUM", "HARD"] })
  difficulty!: "EASY" | "MEDIUM" | "HARD";

  @ApiProperty({ example: true, required: false })
  active?: boolean;
}
```

### Step 2: Write Response Schema

Create a clean public presentation schema to omit sensitive data.

**Example: `question-response.dto.ts`**

```typescript
import { z } from "zod";

// Create public schema by omitting 'correctAnswer' from creation schema
export const questionResponseSchema = z.object({
  id: z.string(),
  content: z.string(),
  options: z.array(z.string()),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
  active: z.boolean(),
  createdAt: z.date().or(z.string()),
  updatedAt: z.date().or(z.string()),
});

export type QuestionResponse = z.infer<typeof questionResponseSchema>;
```

### Step 3: Decorate Controller Actions

Update your controller to use the pipe and interceptor.

```typescript
@Post()
async create(
  @Body(new ZodValidationPipe(createQuestionSchema))
  createQuestionDto: CreateQuestionDto,
) {
  return this.questionService.create(createQuestionDto);
}

@Get(":id")
@ZodSerialize(questionResponseSchema)
async findOne(@Param("id") id: string) {
  return this.questionService.findOne(id);
}
```

---

## 💡 Best Practices

1. **Keep Schemas and DTOs Synced**: Always make sure the properties defined on the Swagger DTO class perfectly implement the Zod schema type (`implements ZodType`). This guarantees compile-time safety and prevents Swagger from going stale.
2. **Replace Class-Validator Decorators**:
   - `@IsString()` ➡️ `z.string()`
   - `@MinLength(N)` ➡️ `z.string().min(N)`
   - `@IsEmail()` ➡️ `z.string().email()`
   - `@IsOptional()` ➡️ `z.optional()` or `.optional()` suffix
   - `@ArrayMinSize(N)` ➡️ `z.array().min(N)`
3. **Use Refinements for Complex Logic**: Any validation checking properties against other properties (like checking if a value is contained in another property's array) should be done using `.refine((data) => ..., { message: "...", path: ["fieldname"] })`.
