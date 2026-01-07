import SwiftUI
import FirebaseRemoteConfig
import Combine
import FirebaseAuth
import FirebaseAnalytics

@MainActor
final class CuratorViewModel: ObservableObject {
	let DEBUG = true
	static let dailyLimit = CuratorConfig.maxExchanges
	
	@Published var messages:    [ChatMessage] = []
	@Published var suggestions: [String]      = []
	@Published var suggestionsReady           = false
	@Published var dailyLimitHit = DailyUsageLimiter.isLimitReached(for: .curatorExchanges, limit: CuratorViewModel.dailyLimit)
	
	@Published var suppressSuggestions: Bool = false
	@Published var threadSuggestion: String? = nil
	@Published var isPremiumUser: Bool = SubscriptionStatus.shared.isPremiumUser
	
	let introductions: [String]
	let initialCard: Card?
	private let conversationKey: CuratorConversationKey
	
	var curatorPrompt        = ""
	var isWaiting            = false
	var pendingMessageID: UUID?
	var previousResponseID:  String?
	private var cancellables = Set<AnyCancellable>()
	
	private let remoteConfig: RemoteConfig
	
	private static let modelCutoffISO      = CuratorConfig.modelCutoffISO
	private static let recencyBufferDays   = CuratorConfig.recencyBufferDays
	private static let recencyThresholdISO = CuratorConfig.recencyThresholdISO
	
	var openAIAPIKey: String {
		guard
			let path  = Bundle.main.path(forResource: "Secrets", ofType: "plist"),
			let plist = NSDictionary(contentsOfFile: path),
			let partA = plist["OpenAIAPIKey-PartA"] as? String,
			let partB = plist["OpenAIAPIKey-PartB"] as? String
		else { fatalError("API key parts missing") }
		return partA + partB
	}
	
	init(introductions: [String],
		 initialCard: Card? = nil,
		 conversationKey: CuratorConversationKey) {
		self.introductions   = introductions
		self.initialCard     = initialCard
		self.conversationKey = conversationKey
		
		self.messages = CuratorSessionStore.shared.messages(for: conversationKey)
		
		remoteConfig = RemoteConfig.remoteConfig()
		remoteConfig.configSettings = {
			let s = RemoteConfigSettings()
			s.minimumFetchInterval = CuratorConfig.remoteConfigMinimumFetchInterval
			return s
		}()
		
		let defaultPrompt = CuratorConfig.defaultCuratorPrompt
		remoteConfig.setDefaults([CuratorConfig.RemoteConfigKeys.curatorPrompt: defaultPrompt as NSString])
		
		remoteConfig.fetchAndActivate { [weak self] status, _ in
			guard let self else { return }
			self.curatorPrompt = self.remoteConfig.configValue(forKey: CuratorConfig.RemoteConfigKeys.curatorPrompt).stringValue ?? defaultPrompt
			if self.DEBUG {
				print("🟢 RemoteConfig status:", status.rawValue)
				print("🟢 Live curator_prompt ↓↓↓\n\(self.curatorPrompt)\n────────")
			}
		}
		
		if let _ = initialCard {
			let hasUserHistory = self.messages.contains(where: { $0.isUser })
			let shouldSuppress = hasUserHistory
			if shouldSuppress {
				self.suppressSuggestions = true
				self.suggestions = []
				self.suggestionsReady = false
				CuratorSessionStore.shared.clearSuggestions(for: self.conversationKey)
			} else {
				if let cached = CuratorSessionStore.shared.cachedSuggestions(for: conversationKey), !cached.isEmpty {
					self.suggestions = cached
					self.suggestionsReady = true
				} else {
					Task { await generateSuggestions() }
				}
			}
		}
		
		$messages
			.receive(on: DispatchQueue.main)
			.sink { msgs in
				CuratorSessionStore.shared.setMessages(msgs, for: conversationKey)
			}
			.store(in: &cancellables)
		
		NotificationCenter.default.publisher(for: .CuratorSeedMessage)
			.compactMap { $0.object as? String }
			.receive(on: DispatchQueue.main)
			.sink { [weak self] txt in
				guard let self else { return }
				if self.messages.count == 1,
				   let first = self.messages.first,
				   !first.isUser,
				   self.isIntroText(first.text ?? "") {
					self.messages[0] = .init(text: txt, isUser: false)
				} else if self.messages.isEmpty {
					self.messages.append(.init(text: txt, isUser: false))
				} else {
					self.messages.append(.init(text: txt, isUser: false))
				}
			}
			.store(in: &cancellables)
		
		NotificationCenter.default.publisher(for: .CuratorUserSubmit)
			.compactMap { $0.object as? String }
			.receive(on: DispatchQueue.main)
			.sink { [weak self] txt in
				self?.sendUserMessage(txt)
			}
			.store(in: &cancellables)
		
		isPremiumUser = SubscriptionStatus.shared.isPremiumUser
		SubscriptionStatus.shared.$isPremiumUser
			.receive(on: DispatchQueue.main)
			.sink { [weak self] premium in
				guard let self else { return }
				self.isPremiumUser = premium
				if premium {
					self.dailyLimitHit = false
				} else {
					self.dailyLimitHit = DailyUsageLimiter.isLimitReached(for: .curatorExchanges, limit: CuratorViewModel.dailyLimit)
				}
			}
			.store(in: &cancellables)
	}
	
	var isExchangeLimitReached: Bool { !isPremiumUser && dailyLimitHit }
	
	func sendUserMessage(_ text: String) {
		let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return }
		guard !isExchangeLimitReached else { return }
		
		threadSuggestion = nil
		
		let hadUserBefore = messages.contains(where: { $0.isUser })
		messages.append(.init(text: trimmed, isUser: true))
		
		if !hadUserBefore, initialCard != nil {
			suppressSuggestions = true
			CuratorSessionStore.shared.clearSuggestions(for: conversationKey)
		}
		
		Task { await sendToOpenAIResponses(trimmed) }
	}
	
	func insertWidget(_ widget: ChatMessage) -> Int {
		if let id = pendingMessageID,
		   let idx = messages.firstIndex(where: { $0.id == id }) {
			messages[idx] = widget
			pendingMessageID = nil
			DailyUsageLimiter.increment(.curatorExchanges)
			dailyLimitHit = DailyUsageLimiter.isLimitReached(for: .curatorExchanges, limit: CuratorViewModel.dailyLimit)
			return idx
		} else {
			messages.append(widget)
			DailyUsageLimiter.increment(.curatorExchanges)
			dailyLimitHit = DailyUsageLimiter.isLimitReached(for: .curatorExchanges, limit: CuratorViewModel.dailyLimit)
			return messages.count - 1
		}
	}
	
	func replaceLoading(with text: String) {
		guard let id = pendingMessageID else { return }
		if let idx = messages.firstIndex(where: { $0.id == id }) {
			messages[idx] = .init(text: text, isUser: false)
		} else {
			messages.append(.init(text: text, isUser: false))
		}
		pendingMessageID = nil
	}
	
	private func isIntroText(_ t: String) -> Bool {
		let trimmed = t.trimmingCharacters(in: .whitespacesAndNewlines)
		return trimmed == CuratorConfig.onboardingIntro
		|| introductions.contains { $0.trimmingCharacters(in: .whitespacesAndNewlines) == trimmed }
	}
	
	internal func sendToOpenAIResponses(_ userInput: String) async {
		guard !isWaiting, !isExchangeLimitReached else { return }
		isWaiting = true
		
		let loading = ChatMessage(text: CuratorConfig.randomLoadingText(), isUser: false)
		pendingMessageID = loading.id
		messages.append(loading)
		
		var instructions = curatorPrompt
		if let card = initialCard {
			instructions += "\n\nCARD CONTEXT"
			instructions += "\nHeadline: \"\((card.headline ?? "").trimmingCharacters(in: .whitespacesAndNewlines))\""
			let bodyExcerpt = (card.body ?? "")
				.replacingOccurrences(of: "\n", with: " ")
				.trimmingCharacters(in: .whitespacesAndNewlines)
			if !bodyExcerpt.isEmpty {
				instructions += "\nBody (excerpt ≤600 chars): \"\(String(bodyExcerpt.prefix(600)))\""
			}
			if let em = card.enrichedMetadata {
				if let t = em.teamMetadata {
					let teamName = [t.city, t.team].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }.joined(separator: " ")
					let div = (t.division ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
					let lg  = (t.league ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
					let rec = (t.recordString ?? t.recordString ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
					let parts = [teamName.isEmpty ? t.team ?? "" : teamName, lg, div, rec].filter { !$0.isEmpty }.joined(separator: " • ")
					if !parts.isEmpty { instructions += "\nEntity: TEAM \(parts)" }
				} else if let a = em.athleteMetadata {
					let nm = (a.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
					let team = (a.team ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
					let lg = (a.league ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
					let pos = (a.position ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
					let parts = [nm, team, lg, pos].filter { !$0.isEmpty }.joined(separator: " • ")
					if !parts.isEmpty { instructions += "\nEntity: ATHLETE \(parts)" }
				} else if let p = em.politicianMetadata {
					let nm = (p.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
					let loc = (p.locale ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
					let party = (p.party ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
					let parts = [nm, loc, party].filter { !$0.isEmpty }.joined(separator: " • ")
					if !parts.isEmpty { instructions += "\nEntity: POLITICIAN \(parts)" }
				}
			}
			instructions += "\nUse the SPORTS ANSWER RULE when applicable."
		}
		instructions += "\nCurrent date: \(ISO8601DateFormatter().string(from: Date()))"
		
		var body: [String: Any] = [
			"model": CuratorConfig.Models.responseModel,
			"input": userInput,
			"instructions": instructions,
			"tools": [["type": "web_search"]],
			"store": true
		]
		if let prev = previousResponseID { body["previous_response_id"] = prev }
		
		if DEBUG {
			print("📝 OpenAI INPUT → \(userInput)")
			print("📝 instructions first 600 chars ↓↓↓\n\(instructions.prefix(600))\n────────")
		}
		
		var req = URLRequest(url: CuratorConfig.API.responsesURL)
		req.httpMethod = "POST"
		req.setValue("Bearer \(openAIAPIKey)", forHTTPHeaderField: "Authorization")
		req.setValue("application/json",       forHTTPHeaderField: "Content-Type")
		req.httpBody = try? JSONSerialization.data(withJSONObject: body)
		
		do {
			let (data, _) = try await URLSession.shared.data(for: req)
			guard
				let json   = try JSONSerialization.jsonObject(with: data) as? [String: Any],
				let status = json["status"] as? String, status == "completed"
			else { throw NSError(domain: "OpenAI", code: 1) }
			
			previousResponseID = json["id"] as? String
			
			let txt: String
			if let t = json["output_text"] as? String {
				txt = t
			} else if
				let outputs = json["output"] as? [[String: Any]],
				let msg     = outputs.first(where: { ($0["type"] as? String) == "message" }),
				let content = msg["content"] as? [[String: Any]],
				let piece   = content.first,
				let t       = piece["text"] as? String {
				txt = t
			} else { txt = "Sorry, I didn’t catch that." }
			
			if DEBUG { print("📝 OpenAI OUTPUT ↓↓↓\n\(txt)\n────────") }
			
			handleCuratorResponse(txt.trimmingCharacters(in: .whitespacesAndNewlines))
			DailyUsageLimiter.increment(.curatorExchanges)
			dailyLimitHit = DailyUsageLimiter.isLimitReached(for: .curatorExchanges, limit: CuratorViewModel.dailyLimit)
			
			Task { await generateThreadSuggestion() }
			
		} catch {
			replaceLoading(with: "Network error: \(error.localizedDescription)")
			if DEBUG { print("🛑 OpenAI network error:", error) }
		}
		
		isWaiting = false
	}
	
	private func handleCuratorResponse(_ content: String) {
		replaceLoading(with: content)
	}
	
	func generateSuggestions() async {
		guard let card = initialCard else {
			await MainActor.run { self.suggestionsReady = true }
			return
		}
		
		let list = await CuratorSuggestionsService.shared.generateSuggestions(for: card)
		
		await MainActor.run {
			self.suggestions = list
			self.suggestionsReady = true
			if !list.isEmpty {
				CuratorSessionStore.shared.setSuggestions(list, for: self.conversationKey)
			}
		}
	}
	
	private func generateThreadSuggestion() async {
		let transcript = buildConversationTranscript(maxMessages: 16)
		guard !transcript.isEmpty else {
			await MainActor.run { self.threadSuggestion = nil }
			return
		}
		
		let sys = """
You write exactly one sharp, helpful follow-up question the user could ask next to deepen THIS conversation.
Rules:
• Base it on the entire transcript, not just the last message.
• ≤\(CuratorConfig.suggestionMaxWords) words.
• No preface, no quotes, no punctuation beyond a question mark.
• Avoid meta prompts (e.g., “anything else?”) and keep it specific.
Output ONLY the question text.
"""
		let usr = "Transcript:\n\(transcript)\n\nReturn exactly one question."
		
		let body: [String: Any] = [
			"model": CuratorConfig.Models.chatModel,
			"messages": [
				["role": "system", "content": sys],
				["role": "user",   "content": usr]
			],
			"temperature": 0.7
		]
		
		var req = URLRequest(url: CuratorConfig.API.chatCompletionsURL)
		req.httpMethod = "POST"
		req.setValue("Bearer \(openAIAPIKey)", forHTTPHeaderField: "Authorization")
		req.setValue("application/json",       forHTTPHeaderField: "Content-Type")
		req.httpBody = try? JSONSerialization.data(withJSONObject: body)
		
		do {
			let (data, _) = try await URLSession.shared.data(for: req)
			guard
				let json    = try JSONSerialization.jsonObject(with: data) as? [String: Any],
				let choices = json["choices"] as? [[String: Any]],
				let msg     = choices.first?["message"] as? [String: Any],
				let txt     = msg["content"] as? String
			else {
				await MainActor.run { self.threadSuggestion = nil }
				return
			}
			let cleaned = sanitizeSuggestion(txt)
			await MainActor.run { self.threadSuggestion = cleaned }
		} catch {
			if DEBUG { print("🛑 thread suggestion error:", error) }
			await MainActor.run { self.threadSuggestion = nil }
		}
	}
	
	private func buildConversationTranscript(maxMessages: Int) -> String {
		guard !messages.isEmpty else { return "" }
		let recent = Array(messages.suffix(maxMessages))
		let lines: [String] = recent.map { m in
			let role = m.isUser ? "User" : "Curator"
			if let t = m.text, !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
				return "\(role): \(t.trimmingCharacters(in: .whitespacesAndNewlines))"
			}
			if let tr = m.track { return "\(role): [music] \(tr.name) — \(tr.artist)" }
			if let v  = m.video { return "\(role): [video] \(v.title)" }
			if let mv = m.movie {
				let title = (mv.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
				let yr = (mv.year ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
				return "\(role): [movie] \(title)\(yr.isEmpty ? "" : " (\(yr)"))"
			}
			if let b = m.book { return "\(role): [book] \(b.title)" }
			if let r = m.restaurant { return "\(role): [restaurant] \(r.name)" }
			if let s = m.stock { return "\(role): [stock] \(s.ticker)" }
			if let p = m.politician { return "\(role): [politician] \(p.name ?? "")" }
			if let a = m.athlete { return "\(role): [athlete] \(a.name ?? "")" }
			if let t = m.team { return "\(role): [team] \(t.team ?? "")" }
			if m.image != nil { return "\(role): [image]" }
			return "\(role):"
		}
		return lines.joined(separator: "\n")
	}
	
	private func sanitizeSuggestion(_ raw: String) -> String? {
		let trimmed = raw
			.replacingOccurrences(of: "\"", with: "")
			.replacingOccurrences(of: "“", with: "")
			.replacingOccurrences(of: "”", with: "")
			.trimmingCharacters(in: .whitespacesAndNewlines)
		
		if trimmed.isEmpty { return nil }
		let words = trimmed.split(whereSeparator: { $0.isWhitespace })
		let maxWords = max(1, CuratorConfig.suggestionMaxWords)
		let clipped = words.count > maxWords ? words.prefix(maxWords).joined(separator: " ") : trimmed
		let ended = clipped.hasSuffix("?") ? clipped : (clipped + "?")
		return ended
	}
}

extension Notification.Name {
	static let CuratorSeedMessage = Notification.Name("CuratorSeedMessage")
	static let CuratorUserSubmit  = Notification.Name("CuratorUserSubmit")
}
