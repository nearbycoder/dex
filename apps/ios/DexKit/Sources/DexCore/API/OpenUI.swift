import Foundation

/// The agent's methods for generated UIs (render_ui cards): their operations and their saved state.
public extension DexClient {
    /// Runs an app operation for a chat's card (a Query's live data or a button's Mutation). Admin operations answer
    /// `.confirm(summary)` until they're run again with `confirmed`.
    func runUiOperation(sessionId: String, name: String, args: JSONValue, query: Bool, confirmed: Bool = false) async throws -> UiOperationResult {
        try await call("runUiOperation", .string(sessionId), .string(name), args, ["query": .bool(query), "confirmed": .bool(confirmed)], as: UiOperationResult.self, timeout: 120)
    }

    /// Each card's saved form and filter state in a chat, by card (its render_ui call id).
    func uiStates(sessionId: String) async throws -> [String: JSONValue] {
        try await call("uiStates", .string(sessionId), as: JSONValue.self).object ?? [:]
    }

    func saveUiState(sessionId: String, card: String, state: JSONValue) async throws {
        try await run("saveUiState", .string(sessionId), .string(card), state)
    }
}
