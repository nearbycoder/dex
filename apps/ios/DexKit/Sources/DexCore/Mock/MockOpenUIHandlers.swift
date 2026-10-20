import Foundation

/// The mock agent's methods for: generative UI (operations run by cards, and their saved state).
extension MockAgent {
    func installOpenUIHandlers() {
        register("uiStates") { [unowned self] args, _ in self.store["ui:\(args.string(0) ?? "")"] ?? .object([:]) }
        register("saveUiState") { [unowned self] args, _ in
            guard let session = args.string(0), let card = args.string(1) else { return .null }
            var states = self.store["ui:\(session)"] ?? .object([:])
            states[card] = args.value(2)
            self.store["ui:\(session)"] = states
            return .null
        }
        register("runUiOperation") { [unowned self] args, _ in
            let name = args.string(1) ?? ""
            switch name {
            case "app_list_sessions": return ["ok": true, "result": try JSONValue(encoding: self.state.sessions)]
            case "app_delete_session": return args.value(3)["confirmed"]?.bool == true ? ["ok": true, "result": .null, "changed": "Deleted a chat"] : ["ok": "confirm", "summary": "Delete the chat?"]
            default: return ["ok": false, "error": .string("Unknown operation \(name)")]
            }
        }
    }
}
