"use strict";
// ============================================================
// Event Types - Game Đấu Trường 100
// Event Sourcing Pattern: All game actions are events
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.MatchEventType = exports.RoomEventType = void 0;
exports.createEvent = createEvent;
// Room Events
var RoomEventType;
(function (RoomEventType) {
    RoomEventType["ROOM_CREATED"] = "ROOM_CREATED";
    RoomEventType["PLAYER_JOINED"] = "PLAYER_JOINED";
    RoomEventType["PLAYER_LEFT"] = "PLAYER_LEFT";
    RoomEventType["ROOM_SETTINGS_UPDATED"] = "ROOM_SETTINGS_UPDATED";
    RoomEventType["MATCH_STARTED"] = "MATCH_STARTED";
})(RoomEventType || (exports.RoomEventType = RoomEventType = {}));
// Match Events
var MatchEventType;
(function (MatchEventType) {
    MatchEventType["MATCH_CREATED"] = "MATCH_CREATED";
    MatchEventType["MATCH_STARTED"] = "MATCH_STARTED";
    MatchEventType["ROUND_STARTED"] = "ROUND_STARTED";
    MatchEventType["ROUND_ENDED"] = "ROUND_ENDED";
    MatchEventType["ANSWER_SUBMITTED"] = "ANSWER_SUBMITTED";
    MatchEventType["PLAYER_ELIMINATED"] = "PLAYER_ELIMINATED";
    MatchEventType["MATCH_FINISHED"] = "MATCH_FINISHED";
    MatchEventType["PLAYER_RECONNECTED"] = "PLAYER_RECONNECTED";
    MatchEventType["PLAYER_DISCONNECTED"] = "PLAYER_DISCONNECTED";
})(MatchEventType || (exports.MatchEventType = MatchEventType = {}));
// Factory function for creating events (Command Pattern)
function createEvent(type, payload, seqNo) {
    return {
        id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type,
        timestamp: Date.now(),
        payload,
        seqNo,
    };
}
//# sourceMappingURL=events.js.map