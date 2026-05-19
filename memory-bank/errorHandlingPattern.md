# Error Handling Improvements

## Problem

The original error handling in `room.handler.ts` was fragile because it relied on string matching of error messages to determine error codes:

```typescript
const code =
  msg === ErrorCode.ROOM_NOT_FOUND
    ? ErrorCode.ROOM_NOT_FOUND
    : ErrorCode.INTERNAL_ERROR;
```

This approach is brittle because:

1. Error messages can change without notice
2. String comparison is not type-safe
3. It's difficult to maintain and extend

## Solution

Created a custom `RoomError` class and updated error handling throughout the codebase:

### 1. Created RoomError Class

File: `packages/shared/src/errors.ts`

```typescript
export class RoomError extends Error {
  public code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    super(message || code);
    this.code = code;
    this.name = "RoomError";
  }
}
```

### 2. Updated Services to Throw RoomError

File: `apps/api/src/modules/room/room.service.ts`

- Replaced `NotFoundException` and `BadRequestException` with `RoomError`
- Example:

```typescript
if (!room) {
  throw new RoomError(ErrorCode.ROOM_NOT_FOUND);
}
```

### 3. Updated Handlers to Detect RoomError

File: `apps/api/src/gateways/handlers/room.handler.ts`

- Updated catch blocks to check for `RoomError` instances:

```typescript
const code = error instanceof RoomError ? error.code : ErrorCode.INTERNAL_ERROR;
```

### 4. Updated Base Handler

File: `apps/api/src/gateways/handlers/base.handler.ts`

- Updated `requireAuth` method to throw `RoomError` instead of generic `Error`

## Benefits

1. Type-safe error handling
2. More maintainable code
3. Easier to extend with new error types
4. Proper separation of concerns
5. Eliminates fragile string matching

## Files Modified

1. `packages/shared/src/errors.ts` - New file with RoomError class
2. `packages/shared/src/index.ts` - Export RoomError
3. `apps/api/src/modules/room/room.service.ts` - Throw RoomError instead of generic exceptions
4. `apps/api/src/gateways/handlers/room.handler.ts` - Detect RoomError instances
5. `apps/api/src/gateways/handlers/base.handler.ts` - Use RoomError for auth errors
