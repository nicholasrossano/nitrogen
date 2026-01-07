import Foundation
import CryptoKit

// ─────────── TTSAPIClient ───────────
final class TTSAPIClient {
	private var openAIAPIKey: String {
		guard
			let path  = Bundle.main.path(forResource: "Secrets", ofType: "plist"),
			let plist = NSDictionary(contentsOfFile: path),
			let partA = plist["OpenAIAPIKey-PartA"] as? String,
			let partB = plist["OpenAIAPIKey-PartB"] as? String
		else { fatalError("API key parts missing for TTS client") }
		return partA + partB
	}
	
	private let ttsURL = URL(string: "https://api.openai.com/v1/audio/speech")!
	private let model  = "tts-1"
	private let cacheFolder: URL = {
		let url = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
			.appendingPathComponent("TTSCache", isDirectory: true)
		try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
		return url
	}()
	
	func generateTTS(summary: String, completion: @escaping (URL?) -> Void) {
		let engine = resolveEngine(TextToSpeechService.shared.selectedVoice)
		
		let cacheKey = "\(model)|\(engine)|\(summary)"
		let cachedURL = cacheFolder.appendingPathComponent("\(cacheKey.sha256).mp3")
		if FileManager.default.fileExists(atPath: cachedURL.path) {
			completion(cachedURL); return
		}
		
		let body: [String: Any] = [
			"model": model,
			"input": summary,
			"voice": engine,
			"format": "mp3"
		]
		
		var req = URLRequest(url: ttsURL)
		req.httpMethod = "POST"
		req.setValue("Bearer \(openAIAPIKey)", forHTTPHeaderField: "Authorization")
		req.setValue("application/json",       forHTTPHeaderField: "Content-Type")
		req.httpBody = try? JSONSerialization.data(withJSONObject: body)
		
		URLSession.shared.dataTask(with: req) { data, _, err in
			guard let data = data, err == nil else { completion(nil); return }
			do {
				try data.write(to: cachedURL)
				completion(cachedURL)
			} catch {
				print("TTS cache write failed: \(error)")
				completion(nil)
			}
		}.resume()
	}
	
	// ─────────── Section Header ───────────
	// Map any raw style to a supported engine token and guardrail
	private func resolveEngine(_ raw: String) -> String {
		let s = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
		if s == "deep" || s == "echo"    { return "echo" }
		if s == "light" || s == "shimmer" { return "shimmer" }
		// Fallback for unknown strings
		return "shimmer"
	}
}

// ─────────── SHA-256 helper ───────────
private extension String {
	var sha256: String {
		let hashed = SHA256.hash(data: Data(utf8))
		return hashed.map { String(format: "%02x", $0) }.joined()
	}
}
