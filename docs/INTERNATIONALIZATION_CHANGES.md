# Internationalization Changes Summary

## Overview

This document summarizes the changes made to internationalize the game page component by replacing hardcoded Vietnamese strings with i18n translations.

## Files Modified

### 1. Vietnamese Messages File

**File:** `apps/web/messages/vi.json`

Added a new `Game` section with the following translation keys:

- `matchingTitle`: "Trận Đấu Đang Diễn Ra"
- `roundLabel`: "VÒNG"
- `roundComplexity`: "Độ Phức Tạp Vòng"
- `roundLevelExtreme`: "Cấp độ: Cực Hạn"
- `remainingLabel`: "Còn Lại"
- `rulesHeader`: "QUY TẮC PHÒNG ĐẤU // CÂU HỎI HỆ THỐNG"
- `lockedAnswer`: "ĐÃ KHÓA ĐÁP ÁN"
- `waiting`: "ĐANG ĐỢI..."
- `fallbackQuestion`: "Trong kiến trúc hệ thống monorepo sử dụng pnpm & Turborepo, thư mục nào chứa các code logic thuần túy (pure domain logic state machine) không phụ thuộc vào framework?"
- `opponentsTitle`: "ĐỐI THỦ XUNG QUANH"
- `aliveStatus`: "SỐNG"
- `eliminatedStatus`: "LOẠI"
- `antiHackDescription`: "Hệ thống Chống Hack"
- `antiHackDetails`: "Thời gian phản hồi được máy chủ ghi nhận và so sánh độ lệch ping để đảm bảo tính công bằng tuyệt đối."

### 2. English Messages File

**File:** `apps/web/messages/en.json`

Added a new `Game` section with the following translation keys:

- `matchingTitle`: "Live Match in Progress"
- `roundLabel`: "ROUND"
- `roundComplexity`: "Round Complexity"
- `roundLevelExtreme`: "Level: Extreme"
- `remainingLabel`: "Remaining"
- `rulesHeader`: "BATTLE RULES // SYSTEM QUESTION"
- `lockedAnswer`: "ANSWER LOCKED"
- `waiting`: "WAITING..."
- `fallbackQuestion`: "In a monorepo system architecture using pnpm & Turborepo, which directory contains pure domain logic state machine code that is framework-independent?"
- `opponentsTitle`: "OPPONENTS NEARBY"
- `aliveStatus`: "ALIVE"
- `eliminatedStatus`: "ELIMINATED"
- `antiHackDescription`: "Anti-Hack System"
- `antiHackDetails`: "Response time is recorded by the server and compared against ping deviation to ensure absolute fairness."

### 3. Game Page Component

**File:** `apps/web/src/app/[locale]/game/[matchId]/page.tsx`

Made the following changes:

1. Added import for `useTranslations` hook from "next-intl"
2. Initialized the translation hook with `const t = useTranslations("Game");`
3. Replaced all hardcoded Vietnamese strings with translation keys:
   - Line 199: "Trận Đấu Đang Diễn Ra" → `t('matchingTitle')`
   - Line 202: "VÒNG" → `t('roundLabel')` (combined with dynamic round number)
   - Line 208: "Độ Phức Tạp Vòng" → `t('roundComplexity')`
   - Line 211: "Cấp độ: Cực Hạn" → `t('roundLevelExtreme')`
   - Line 225: "Còn Lại" → `t('remainingLabel')`
   - Line 241: "QUY TẮC PHÒNG ĐẤU // CÂU HỎI HỆ THỐNG" → `t('rulesHeader')`
   - Line 245: "ĐÃ KHÓA ĐÁP ÁN" → `t('lockedAnswer')`
   - Line 245: "ĐANG ĐỢI..." → `t('waiting')`
   - Line 180-186: Fallback question text → `t('fallbackQuestion')`
   - Line 276: "ĐỐI THỦ XUNG QUANH" → `t('opponentsTitle')`
   - Line 344: "SỐNG" → `t('aliveStatus')`
   - Line 348: "LOẠI" → `t('eliminatedStatus')`
   - Line 361: "Hệ thống Chống Hack" → `t('antiHackDescription')`
   - Line 362-363: Anti-hack details → `t('antiHackDetails')`

## Dynamic Content Handling

The implementation properly handles dynamic content:

- Round numbers: Combined `t('roundLabel')` with the dynamic round number
- Player counts: Kept the existing `${remainingCount} / 100` format
- Status indicators: Used existing logic with translated status labels

## Testing

All changes have been verified:

- ✅ TypeScript compilation successful
- ✅ Production build successful
- ✅ Translation keys properly structured in both JSON files
- ✅ No syntax errors in the modified component

## Benefits

1. **Full Localization Support**: The game page now supports both Vietnamese and English locales
2. **Maintainable Code**: All UI strings are centralized in message files
3. **Easy Expansion**: Adding new languages is as simple as creating new message files
4. **Consistent Approach**: Follows the existing i18n patterns used throughout the application
