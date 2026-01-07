import Foundation
import Combine
import FirebaseAuth
import FirebaseAnalytics

enum SearchOutcome {
	case cards(searchId: String, cardIds: [String])
	case curatorMessage(searchId: String, query: String, message: String)
}

final class SearchManager: ObservableObject {
	@Published var outcome: SearchOutcome?
	
	private let session: URLSession
	private let userService: UserService
	
	// Track in-flight timings for latency_ms
	private var inflight: [String: Date] = [:]
	
	init(userService: UserService) {
		self.userService = userService
		let cfg = URLSessionConfiguration.default
		cfg.timeoutIntervalForRequest  = 300
		cfg.timeoutIntervalForResource = 600
		cfg.waitsForConnectivity       = true
		self.session = URLSession(configuration: cfg)
	}
	
	func runSearch(query: String) {
		guard
			!query.trimmingCharacters(in: .whitespaces).isEmpty,
			let uid = userService.getUserId()
		else { return }
		
		outcome = nil
		
		let sid = UUID().uuidString
		let payload: [String: Any] = [
			"userId"   : uid,
			"query"    : query,
			"searchId" : sid
		]
		
		// ─────────── Section Header ───────────
		inflight[sid] = Date()
		Analytics.logEvent("search_fetch_start", parameters: [
			"search_id": sid as NSString,
			"query_length": NSNumber(value: query.count)
		])
		
		guard
			let url  = URL(string: "https://us-east4-ponder-f84ce.cloudfunctions.net/scan_custom_search"),
			let body = try? JSONSerialization.data(withJSONObject: payload)
		else {
			self.finishFetch(searchId: sid, resultType: "bad_request", resultCount: nil, errorLabel: "encode")
			return
		}
		
		var request = URLRequest(url: url)
		request.httpMethod = "POST"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.httpBody   = body
		
		session.dataTask(with: request) { [weak self] data, resp, error in
			guard let self else { return }
			
			if let err = error {
				self.finishFetch(searchId: sid, resultType: "error", resultCount: nil, errorLabel: "network")
				print("scan_custom_search network error:", err.localizedDescription)
				return
			}
			guard
				let data,
				let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
			else {
				self.finishFetch(searchId: sid, resultType: "error", resultCount: nil, errorLabel: "bad_payload")
				print("scan_custom_search bad payload")
				return
			}
			
			let outcomeStr = (json["outcome"] as? String) ?? "unknown"
			let cardIds    = (json["cardIds"] as? [String]) ?? []
			let message    = (json["message"] as? String) ?? ""
			
			Analytics.logEvent("search_fetch_payload_parsed", parameters: [
				"search_id": sid as NSString,
				"outcome": outcomeStr as NSString,
				"has_message": NSNumber(value: message.isEmpty ? 0 : 1),
				"card_id_count": NSNumber(value: cardIds.count)
			])
			
			switch outcomeStr {
			case "cards":
				self.finishFetch(searchId: sid, resultType: "cards", resultCount: cardIds.count, errorLabel: nil)
				DispatchQueue.main.async {
					self.outcome = .cards(searchId: sid, cardIds: cardIds)
				}
				return
				
			case "summary", "no_results":
				// Treat these as the “explain in Curator” path
				self.finishFetch(searchId: sid, resultType: outcomeStr, resultCount: nil, errorLabel: nil)
				DispatchQueue.main.async {
					self.outcome = .curatorMessage(searchId: sid, query: query, message: message)
				}
				return
				
			default:
				self.finishFetch(searchId: sid, resultType: "unknown", resultCount: nil, errorLabel: "unexpected_outcome")
				print("⚠️ unexpected outcome:", outcomeStr, "payload:", json)
				return
			}
		}
		.resume()
	}
	
	// ─────────── Section Header ───────────
	private func finishFetch(searchId sid: String, resultType: String, resultCount: Int?, errorLabel: String?) {
		let start = inflight[sid] ?? Date()
		inflight.removeValue(forKey: sid)
		let latency = Int(max(0, Date().timeIntervalSince(start) * 1000))
		
		var params: [String: Any] = [
			"search_id": sid as NSString,
			"result_type": resultType as NSString,
			"latency_ms": NSNumber(value: latency)
		]
		if let c = resultCount { params["result_count"] = NSNumber(value: c) }
		if let e = errorLabel { params["error"] = e as NSString }
		
		Analytics.logEvent("search_fetch_complete", parameters: params)
	}
}
