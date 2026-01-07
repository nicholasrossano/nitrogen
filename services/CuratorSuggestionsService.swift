import Foundation

final class CuratorSuggestionsService {
	static let shared = CuratorSuggestionsService()
	
	// ─────────── Section Header ───────────
	private let lock = NSLock()
	private var inFlightByCardId: [String: Task<[String], Never>] = [:]
	
	private init() {}
	
	private var openAIAPIKey: String {
		guard
			let path  = Bundle.main.path(forResource: "Secrets", ofType: "plist"),
			let plist = NSDictionary(contentsOfFile: path),
			let partA = plist["OpenAIAPIKey-PartA"] as? String,
			let partB = plist["OpenAIAPIKey-PartB"] as? String
		else { fatalError("API key parts missing") }
		return partA + partB
	}
	
	func generateSuggestions(for card: Card) async -> [String] {
		let headline = (card.headline ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		if headline.isEmpty { return [] }
		
		lock.lock()
		if let existing = inFlightByCardId[card.id] {
			lock.unlock()
			return await existing.value
		}
		
		let task = Task<[String], Never> { [weak self] in
			defer { self?.clearInFlight(cardId: card.id) }
			return await self?.generateSuggestionsInternal(for: card) ?? []
		}
		
		inFlightByCardId[card.id] = task
		lock.unlock()
		
		return await task.value
	}
	
	func pickActionSuggestion(from suggestions: [String]) -> String? {
		let normalized = suggestions.compactMap { normalizeSuggestion($0) }
		let short = normalized.filter { isWithinWordLimit($0) }
		
		if let bestShort = short.min(by: { $0.count < $1.count }) {
			return bestShort
		}
		
		return normalized.min(by: { $0.count < $1.count })
	}
	
	private func clearInFlight(cardId: String) {
		lock.lock()
		inFlightByCardId.removeValue(forKey: cardId)
		lock.unlock()
	}
	
	private func generateSuggestionsInternal(for card: Card) async -> [String] {
		let systemPrompt = CuratorConfig.suggestionsPromptForCard(
			headline: card.headline ?? "",
			body: card.body
		)
		
		let body: [String: Any] = [
			"model": CuratorConfig.Models.chatModel,
			"messages": [
				["role": "system", "content": systemPrompt],
				["role": "user",   "content": ""]
			],
			"temperature": 0.4
		]
		
		var request = URLRequest(url: CuratorConfig.API.chatCompletionsURL)
		request.httpMethod = "POST"
		request.setValue("Bearer \(openAIAPIKey)", forHTTPHeaderField: "Authorization")
		request.setValue("application/json",       forHTTPHeaderField: "Content-Type")
		request.httpBody = try? JSONSerialization.data(withJSONObject: body)
		
		do {
			let (data, _) = try await URLSession.shared.data(for: request)
			guard
				let json    = try JSONSerialization.jsonObject(with: data) as? [String: Any],
				let choices = json["choices"] as? [[String: Any]],
				let msg     = choices.first?["message"] as? [String: Any],
				let txt     = msg["content"] as? String
			else { return [] }
			
			let lines = txt
				.components(separatedBy: .newlines)
				.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
				.filter { !$0.isEmpty }
			
			let normalized = lines.compactMap { normalizeSuggestion($0) }
			if normalized.isEmpty { return [] }
			
			let short = normalized.filter { isWithinWordLimit($0) }
			if !short.isEmpty {
				return Array(short.prefix(CuratorConfig.suggestionCount))
			}
			
			return Array(normalized.prefix(CuratorConfig.suggestionCount))
		} catch {
			return []
		}
	}
	
	private func normalizeSuggestion(_ raw: String) -> String? {
		let trimmed = raw
			.replacingOccurrences(of: "\"", with: "")
			.replacingOccurrences(of: "“", with: "")
			.replacingOccurrences(of: "”", with: "")
			.trimmingCharacters(in: .whitespacesAndNewlines)
		
		if trimmed.isEmpty { return nil }
		let ended = trimmed.hasSuffix("?") ? trimmed : (trimmed + "?")
		return ended
	}
	
	private func isWithinWordLimit(_ text: String) -> Bool {
		let words = text.split(whereSeparator: { $0.isWhitespace })
		return words.count <= max(1, CuratorConfig.suggestionMaxWords)
	}
}
