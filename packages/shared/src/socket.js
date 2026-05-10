"use strict";
// ============================================================
// Socket Events - Game Đấu Trường 100
// Client-Server Communication Protocol
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerEvent = exports.ClientEvent = exports.SocketNamespace = void 0;
exports.getRoomChannel = getRoomChannel;
exports.getMatchChannel = getMatchChannel;
exports.getPlayerChannel = getPlayerChannel;
// Socket Namespaces
var SocketNamespace;
(function (SocketNamespace) {
    SocketNamespace["ROOM"] = "room";
    SocketNamespace["MATCH"] = "match";
})(SocketNamespace || (exports.SocketNamespace = SocketNamespace = {}));
// Client -> Server Events (Commands)
var ClientEvent;
(function (ClientEvent) {
    // Room Events
    ClientEvent["JOIN_ROOM"] = "join_room";
    ClientEvent["LEAVE_ROOM"] = "leave_room";
    ClientEvent["CREATE_ROOM"] = "create_room";
    ClientEvent["START_MATCH"] = "start_match";
    // Match Events
    ClientEvent["SUBMIT_ANSWER"] = "submit_answer";
    ClientEvent["REQUEST_SNAPSHOT"] = "request_snapshot";
    // Connection Events
    ClientEvent["AUTHENTICATE"] = "authenticate";
    ClientEvent["PING"] = "ping";
})(ClientEvent || (exports.ClientEvent = ClientEvent = {}));
// Server -> Client Events (Notifications)
var ServerEvent;
(function (ServerEvent) {
    // Room Events
    ServerEvent["ROOM_CREATED"] = "room_created";
    ServerEvent["PLAYER_JOINED"] = "player_joined";
    ServerEvent["PLAYER_LEFT"] = "player_left";
    ServerEvent["MATCH_STARTING"] = "match_starting";
    // Match Events
    ServerEvent["MATCH_STARTED"] = "match_started";
    ServerEvent["ROUND_STARTED"] = "round_started";
    ServerEvent["ROUND_ENDED"] = "round_ended";
    ServerEvent["ANSWER_RESULT"] = "answer_result";
    ServerEvent["PLAYER_ELIMINATED"] = "player_eliminated";
    ServerEvent["MATCH_FINISHED"] = "match_finished";
    // Sync Events
    ServerEvent["SNAPSHOT"] = "snapshot";
    ServerEvent["EVENT_BATCH"] = "event_batch";
    // Connection Events
    ServerEvent["AUTHENTICATED"] = "authenticated";
    ServerEvent["ERROR"] = "error";
    ServerEvent["PONG"] = "pong";
    ServerEvent["KICKED"] = "kicked";
})(ServerEvent || (exports.ServerEvent = ServerEvent = {}));
// Socket Channel Helpers
function getRoomChannel(roomId) {
    return `room:${roomId}`;
}
function getMatchChannel(matchId) {
    return `match:${matchId}`;
}
function getPlayerChannel(playerId) {
    return `player:${playerId}`;
}
//# sourceMappingURL=socket.js.map