import Foundation
import Combine

enum CuratorConversationKey: Hashable {
	case base
	case card(String)
}

final class CuratorSessionStore: ObservableObject {
	static let shared = CuratorSessionStore()
	
	@Published private var storage: [CuratorConversationKey: [ChatMessage]] = [:]
	
	// ─────────── Section Header ───────────
	// Session metadata (lives for the lifetime of the app process)
	private var sessionIDs: [CuratorConversationKey: String] = [:]
	private var sessionStarts: [CuratorConversationKey: Date] = [:]
	private var lastSavedCounts: [CuratorConversationKey: Int] = [:]
	
	// ─────────── Section Header ───────────
	// Suggestions cache (per conversation key, app-session scoped)
	private var suggestionsCache: [CuratorConversationKey: [String]] = [:]
	
	func messages(for key: CuratorConversationKey) -> [ChatMessage] {
		storage[key] ?? []
	}
	
	func setMessages(_ messages: [ChatMessage], for key: CuratorConversationKey) {
		storage[key] = messages
	}
	
	// ─────────── Section Header ───────────
	// App-session–scoped identity for a conversation thread
	@discardableResult
	func ensureSession(for key: CuratorConversationKey) -> (id: String, startedAt: Date) {
		if let id = sessionIDs[key], let start = sessionStarts[key] {
			return (id, start)
		}
		let id = UUID().uuidString
		let start = Date()
		sessionIDs[key] = id
		sessionStarts[key] = start
		return (id, start)
	}
	
	// ─────────── Section Header ───────────
	// Adopt an existing session id (e.g., search_<searchId>) so Curator writes to the same thread
	func adoptSession(id: String, startedAt: Date = Date(), for key: CuratorConversationKey, presetMessageCount: Int? = nil) {
		sessionIDs[key] = id
		sessionStarts[key] = startedAt
		if let c = presetMessageCount {
			lastSavedCounts[key] = c
		}
	}
	
	func sessionID(for key: CuratorConversationKey) -> String? {
		sessionIDs[key]
	}
	
	func sessionStart(for key: CuratorConversationKey) -> Date? {
		sessionStarts[key]
	}
	
	func lastSavedCount(for key: CuratorConversationKey) -> Int {
		lastSavedCounts[key] ?? 0
	}
	
	func setLastSavedCount(_ count: Int, for key: CuratorConversationKey) {
		lastSavedCounts[key] = count
	}
	
	// ─────────── Section Header ───────────
	// Suggestions cache accessors
	func cachedSuggestions(for key: CuratorConversationKey) -> [String]? {
		guard let list = suggestionsCache[key], !list.isEmpty else { return nil }
		return list
	}
	
	func setSuggestions(_ suggestions: [String], for key: CuratorConversationKey) {
		guard !suggestions.isEmpty else { return }
		suggestionsCache[key] = suggestions
	}
	
	func clearSuggestions(for key: CuratorConversationKey) {
		suggestionsCache.removeValue(forKey: key)
	}
	
	// ─────────── Section Header ───────────
	func clearMessages(for key: CuratorConversationKey) {
		storage[key] = []
		sessionIDs.removeValue(forKey: key)
		sessionStarts.removeValue(forKey: key)
		lastSavedCounts.removeValue(forKey: key)
		suggestionsCache.removeValue(forKey: key)
	}
	
	func clear() {
		storage.removeAll()
		sessionIDs.removeAll()
		sessionStarts.removeAll()
		lastSavedCounts.removeAll()
		suggestionsCache.removeAll()
	}
}
