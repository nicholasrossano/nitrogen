import Foundation

enum SportsAPIError: Error {
	case missingEndpoint
	case invalidURL
	case unauthorized
	case network(Error)
	case parsing
	case noResults
}

struct SportsAPI {
	
	// ─────────── Section Header ───────────
	private static func endpoint(_ key: String) -> String? {
		guard
			let path  = Bundle.main.path(forResource: "Secrets", ofType: "plist"),
			let dict  = NSDictionary(contentsOfFile: path),
			let url   = dict[key] as? String,
			!url.isEmpty
		else { return nil }
		return url
	}
	
	// ─────────── Section Header ───────────
	typealias TeamCompletion = (Result<CuratorTeam, SportsAPIError>) -> Void
	typealias AthleteCompletion = (Result<CuratorAthlete, SportsAPIError>) -> Void
	
	static func searchTopTeam(_ query: String, completion: @escaping TeamCompletion) {
		guard let base = endpoint("TeamSearchURL") else { completion(.failure(.missingEndpoint)); return }
		request(base: base, q: query) { (json) in
			guard let obj = json else { completion(.failure(.parsing)); return }
			let team   = obj["team"] as? String
			let city   = obj["city"] as? String
			let division = obj["division"] as? String
			let league = obj["league"] as? String
			let logo   = (obj["logoURL"] as? String).flatMap(URL.init)
			let ext    = ((obj["espnURL"] as? String) ?? (obj["wikipediaURL"] as? String)).flatMap(URL.init)
			let ranking = (obj["ranking"] as? NSNumber)?.intValue ?? (obj["ranking"] as? Int)
			
			var recordStr: String?
			let wins  = (obj["wins"] as? NSNumber)?.intValue ?? (obj["wins"] as? Int)
			let losses = (obj["losses"] as? NSNumber)?.intValue ?? (obj["losses"] as? Int)
			let draws  = (obj["draws"] as? NSNumber)?.intValue ?? (obj["draws"] as? Int)
			if let w = wins, let l = losses {
				if let d = draws { recordStr = "\(w)–\(l)–\(d)" } else { recordStr = "\(w)–\(l)" }
			}
			
			let payload = CuratorTeam(
				team: team,
				city: city,
				division: division,
				league: league,
				logoURL: logo,
				externalURL: ext,
				ranking: ranking,
				record: recordStr
			)
			if logo == nil && (team ?? "").isEmpty { completion(.failure(.noResults)); return }
			completion(.success(payload))
		} failure: { err in
			completion(.failure(err))
		}
	}
	
	static func searchTopAthlete(_ query: String, completion: @escaping AthleteCompletion) {
		guard let base = endpoint("AthleteSearchURL") else { completion(.failure(.missingEndpoint)); return }
		request(base: base, q: query) { (json) in
			guard let obj = json else { completion(.failure(.parsing)); return }
			let name   = obj["name"] as? String
			let pos    = obj["position"] as? String
			let team   = obj["team"] as? String
			let league = obj["league"] as? String
			let head   = (obj["imageURL"] as? String).flatMap(URL.init)
			let ext    = ((obj["espnURL"] as? String) ?? (obj["wikipediaURL"] as? String)).flatMap(URL.init)
			let ranking = (obj["ranking"] as? NSNumber)?.intValue ?? (obj["ranking"] as? Int)
			
			let payload = CuratorAthlete(
				name: name,
				position: pos,
				team: team,
				league: league,
				imageURL: head,
				externalURL: ext,
				ranking: ranking
			)
			if head == nil && (name ?? "").isEmpty { completion(.failure(.noResults)); return }
			completion(.success(payload))
		} failure: { err in
			completion(.failure(err))
		}
	}
	
	// ─────────── Section Header ───────────
	private static func request(base: String, q: String, success: @escaping ([String: Any]?) -> Void, failure: @escaping (SportsAPIError) -> Void) {
		var comps = URLComponents(string: base)
		if comps == nil { failure(.invalidURL); return }
		var items = comps!.queryItems ?? []
		items.append(.init(name: "q", value: q))
		comps!.queryItems = items
		guard let url = comps!.url else { failure(.invalidURL); return }
		
		var req = URLRequest(url: url)
		req.timeoutInterval = 20
		
		URLSession.shared.dataTask(with: req) { data, resp, err in
			if let e = err { failure(.network(e)); return }
			guard let http = resp as? HTTPURLResponse else { failure(.parsing); return }
			if http.statusCode == 401 || http.statusCode == 403 { failure(.unauthorized); return }
			guard let data, !data.isEmpty else { failure(.noResults); return }
			
			do {
				let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
				success(obj)
			} catch {
				failure(.parsing)
			}
		}.resume()
	}
}
