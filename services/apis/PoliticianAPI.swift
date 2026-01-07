import Foundation

enum PoliticianAPIError: Error {
	case missingEndpoint
	case invalidURL
	case unauthorized
	case network(Error)
	case parsing
	case noResults
}

struct PoliticianAPI {
	
	// ─────────── Section Header ───────────
	private static func endpoint() -> String? {
		guard
			let path  = Bundle.main.path(forResource: "Secrets", ofType: "plist"),
			let dict  = NSDictionary(contentsOfFile: path),
			let url   = dict["PoliticianSearchURL"] as? String,
			!url.isEmpty
		else { return nil }
		return url
	}
	
	// ─────────── Section Header ───────────
	typealias Completion = (Result<PoliticianMetadata, PoliticianAPIError>) -> Void
	
	static func searchTopPolitician(_ query: String, completion: @escaping Completion) {
		guard let base = endpoint() else { completion(.failure(.missingEndpoint)); return }
		var comps = URLComponents(string: base)
		if comps == nil { completion(.failure(.invalidURL)); return }
		var items = comps!.queryItems ?? []
		items.append(.init(name: "q", value: query))
		comps!.queryItems = items
		guard let url = comps!.url else { completion(.failure(.invalidURL)); return }
		
		var req = URLRequest(url: url)
		req.timeoutInterval = 20
		
		URLSession.shared.dataTask(with: req) { data, resp, err in
			if let e = err { completion(.failure(.network(e))); return }
			guard let http = resp as? HTTPURLResponse else { completion(.failure(.parsing)); return }
			if http.statusCode == 401 || http.statusCode == 403 { completion(.failure(.unauthorized)); return }
			guard let data, !data.isEmpty else { completion(.failure(.noResults)); return }
			
			do {
				guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
					completion(.failure(.parsing)); return
				}
				let name        = obj["name"] as? String
				let party       = obj["party"] as? String
				let locale      = obj["locale"] as? String
				let position    = obj["position"] as? String
				let imageURL    = obj["imageURL"] as? String
				let wikidataID  = obj["wikidataID"] as? String
				let wiki        = (obj["wikipediaURL"] as? String).flatMap(URL.init)
				let official    = obj["officialURL"] as? String
				
				var polls: [PoliticianMetadata.PollPoint] = []
				if let arr = obj["pollSeries"] as? [[String: Any]] {
					for p in arr {
						let d = p["date"] as? String
						let pct = (p["pct"] as? NSNumber)?.doubleValue ?? (p["pct"] as? Double)
						polls.append(.init(date: d, pct: pct))
					}
				}
				
				let meta = PoliticianMetadata(
					name: name,
					party: party,
					locale: locale,
					position: position,
					imageURL: imageURL,
					wikidataID: wikidataID,
					wikipediaURL: wiki,
					officialURL: official,
					pollSeries: polls.isEmpty ? nil : polls
				)
				completion(.success(meta))
			} catch {
				completion(.failure(.parsing))
			}
		}.resume()
	}
}
