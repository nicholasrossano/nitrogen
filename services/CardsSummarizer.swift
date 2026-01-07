import Foundation
import FirebaseRemoteConfig

final class CardsSummarizer {
	private let remoteConfig: RemoteConfig
	private let defaultPrompt: String
	private let gptURL = URL(string: "https://api.openai.com/v1/chat/completions")!
	
	private var openAIAPIKey: String {
		guard
			let path = Bundle.main.path(forResource: "Secrets", ofType: "plist"),
			let plist = NSDictionary(contentsOfFile: path),
			let partA = plist["OpenAIAPIKey-PartA"] as? String,
			let partB = plist["OpenAIAPIKey-PartB"] as? String
		else {
			fatalError("API key parts missing for summarizer")
		}
		return partA + partB
	}
	
	init() {
		remoteConfig = RemoteConfig.remoteConfig()
		let settings = RemoteConfigSettings()
		settings.minimumFetchInterval = 0
		remoteConfig.configSettings = settings
		
		defaultPrompt = """
  You write concise, spoken-friendly summaries of news snippets.
  - Each snippet is delimited by '---Story Start---' and '---Story End---'.
  - Summarize EACH snippet independently in 1–2 sentences (clear, natural speech).
  - Do NOT add your own transitions/segues between snippets.
  - Keep a factual, neutral tone. Do not introduce outside context.
  - Output summaries in the same order, separated by a single newline.
  """
		remoteConfig.setDefaults(["summarization_prompt": defaultPrompt as NSString])
	}
	
	func summarizeCards(cards: [Card], completion: @escaping (String?) -> Void) {
		remoteConfig.fetchAndActivate { [weak self] activated, error in
			guard let self = self else { return }
			
			print("[RC] fetchAndActivate activated=\(activated) error=\(error?.localizedDescription ?? "nil")")
			
			let rcValue = self.remoteConfig.configValue(forKey: "summarization_prompt")
			switch rcValue.source {
			case .remote:  print("[RC] summarization_prompt → REMOTE")
			case .default: print("[RC] summarization_prompt → DEFAULT")
			case .static:  print("[RC] summarization_prompt → STATIC")
			@unknown default: print("[RC] summarization_prompt → UNKNOWN")
			}
			let systemPrompt = rcValue.stringValue ?? self.defaultPrompt
			
			// ─────────── Build snippets without injected “Published …” lines ───────────
			let delimiterStart = "\n---Story Start---\n"
			let delimiterEnd   = "\n---Story End---\n"
			let combinedText = cards.map { card -> String in
				let headline = card.headline ?? "No headline"
				let body     = card.body     ?? "No body"
				return "\(delimiterStart)Headline: \(headline)\nBody: \(body)\(delimiterEnd)"
			}.joined(separator: "\n")
			
			let requestBody: [String: Any] = [
				"model": "gpt-4o",
				"messages": [
					["role": "system", "content": systemPrompt],
					["role": "user",   "content": combinedText]
				],
				"temperature": 0.7
			]
			
			var request = URLRequest(url: self.gptURL)
			request.httpMethod = "POST"
			request.setValue("Bearer \(self.openAIAPIKey)", forHTTPHeaderField: "Authorization")
			request.setValue("application/json", forHTTPHeaderField: "Content-Type")
			request.httpBody = try? JSONSerialization.data(withJSONObject: requestBody)
			
			URLSession.shared.dataTask(with: request) { data, _, error in
				guard let data = data, error == nil else {
					completion(nil)
					return
				}
				do {
					if
						let json    = try JSONSerialization.jsonObject(with: data) as? [String: Any],
						let choices = json["choices"] as? [[String: Any]],
						let msg     = choices.first?["message"] as? [String: Any],
						let summary = msg["content"] as? String
					{
						completion(summary)
					} else {
						completion(nil)
					}
				} catch {
					completion(nil)
				}
			}.resume()
		}
	}
}
