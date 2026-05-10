"use strict";
// ============================================================
// State Types - Game Đấu Trường 100
// Server-Authoritative State Machine
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlayerStatus = exports.MatchStatus = exports.RoomStatus = void 0;
// Room States
var RoomStatus;
(function (RoomStatus) {
    RoomStatus["WAITING"] = "WAITING";
    RoomStatus["COUNTDOWN"] = "COUNTDOWN";
    RoomStatus["IN_GAME"] = "IN_GAME";
    RoomStatus["FINISHED"] = "FINISHED";
})(RoomStatus || (exports.RoomStatus = RoomStatus = {}));
// Match States (State Machine Pattern)
var MatchStatus;
(function (MatchStatus) {
    MatchStatus["CREATED"] = "CREATED";
    MatchStatus["COUNTDOWN"] = "COUNTDOWN";
    MatchStatus["ROUND_ACTIVE"] = "ROUND_ACTIVE";
    MatchStatus["ROUND_EVALUATING"] = "ROUND_EVALUATING";
    MatchStatus["ROUND_RESULT"] = "ROUND_RESULT";
    MatchStatus["FINISHED"] = "FINISHED";
})(MatchStatus || (exports.MatchStatus = MatchStatus = {}));
// Player States in Match
var PlayerStatus;
(function (PlayerStatus) {
    PlayerStatus["ACTIVE"] = "ACTIVE";
    PlayerStatus["ELIMINATED"] = "ELIMINATED";
    PlayerStatus["DISCONNECTED"] = "DISCONNECTED";
    PlayerStatus["WINNER"] = "WINNER";
})(PlayerStatus || (exports.PlayerStatus = PlayerStatus = {}));
//# sourceMappingURL=state.js.map