//
//  YelpAPI.swift
//

import Foundation

// ─────────── Error types ───────────
enum YelpAPIError: Error {
	case missingAPIKey
	case invalidURL
	case network(Error)
	case parsing(Error)
	case noResults
}

// ─────────── Yelp API wrapper ───────────
struct YelpAPI {
	// MARK: Static config
	private static let base  = "https://api.yelp.com/v3/businesses"
	private static let apiKey: String = {
		guard
			let p = Bundle.main.path(forResource: "Secrets", ofType: "plist"),
			let d = NSDictionary(contentsOfFile: p),
			let k = d["YelpAPIKey"] as? String, !k.isEmpty
		else { fatalError("Yelp API key missing") }
		return k
	}()
	
	// MARK: Public search
	typealias Completion = (Result<RestaurantMetadata, YelpAPIError>) -> Void
	
	static func searchTopRestaurant(_ rawQuery: String,
									completion: @escaping Completion) {
		
		let (name, city) = splitQuery(rawQuery)
		search(name: name, city: city) { primary in
			switch primary {
			case .success(let meta):
				completion(.success(meta))               // 🎯 got it
			case .failure:
				// ─────────── Fallback: Business Match ───────────
				businessMatch(name: name, city: city) { match in
					switch match {
					case .success(let meta): completion(.success(meta))
					case .failure:          completion(.failure(.noResults))
					}
				}
			}
		}
	}
}

// MARK: – Private helpers
private extension YelpAPI {
	
	// ─────────── Primary Search ───────────
	static func search(name: String,
					   city: String,
					   completion: @escaping Completion) {
		var comps = URLComponents(string: "\(base)/search")!
		comps.queryItems = [
			URLQueryItem(name: "term",     value: name),
			URLQueryItem(name: "location", value: city),
			URLQueryItem(name: "limit",    value: "5")
		]
		guard let url = comps.url else { completion(.failure(.invalidURL)); return }
		
		var req = URLRequest(url: url)
		req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
		
		URLSession.shared.dataTask(with: req) { data, res, err in
			if let err { completion(.failure(.network(err))); return }
			if let http = res as? HTTPURLResponse,
			   !(200...299).contains(http.statusCode) {
				completion(.failure(.network(NSError(domain: "YelpHTTP",
													 code: http.statusCode))))
				return
			}
			guard let data else { completion(.failure(.noResults)); return }
			
			do {
				let json  = try JSONSerialization.jsonObject(with: data) as? [String: Any]
				let hits  = json?["businesses"] as? [[String: Any]] ?? []
				
#if DEBUG
				print("🍽️  Yelp search '\(name)' in \(city) → \(hits.count) hits")
#endif
				
				guard let b = hits.first else { completion(.failure(.noResults)); return }
				completion(.success(meta(from: b)))
				
			} catch { completion(.failure(.parsing(error))) }
		}.resume()
	}
	
	// ─────────── Business Match fallback ───────────
	static func businessMatch(name: String,
							  city: String,
							  completion: @escaping Completion) {
		var comps = URLComponents(string: "\(base)/matches")!
		comps.queryItems = [
			URLQueryItem(name: "name",    value: name),
			URLQueryItem(name: "city",    value: city),
			URLQueryItem(name: "country", value: "US")
		]
		guard let url = comps.url else { completion(.failure(.invalidURL)); return }
		
		var req = URLRequest(url: url)
		req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
		
		URLSession.shared.dataTask(with: req) { data, res, err in
			if let err { completion(.failure(.network(err))); return }
			if let http = res as? HTTPURLResponse,
			   !(200...299).contains(http.statusCode) {
				completion(.failure(.network(NSError(domain: "YelpHTTP",
													 code: http.statusCode))))
				return
			}
			guard let data else { completion(.failure(.noResults)); return }
			
			do {
				let root = try JSONSerialization.jsonObject(with: data) as? [String: Any]
				let matches = root?["businesses"] as? [[String: Any]] ?? []
				
#if DEBUG
				print("🔎 Yelp MATCH '\(name)' → \(matches.count) hits")
#endif
				
				guard let first = matches.first,
					  let id    = first["id"] as? String else {
					completion(.failure(.noResults)); return
				}
				
				// ---- Fetch full business by ID ----
				businessDetail(id: id, completion: completion)
				
			} catch { completion(.failure(.parsing(error))) }
		}.resume()
	}
	
	// ─────────── Business Detail fetch ───────────
	static func businessDetail(id: String,
							   completion: @escaping Completion) {
		guard let url = URL(string: "\(base)/\(id)") else {
			completion(.failure(.invalidURL)); return
		}
		var req = URLRequest(url: url)
		req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
		
		URLSession.shared.dataTask(with: req) { data, res, err in
			if let err { completion(.failure(.network(err))); return }
			if let http = res as? HTTPURLResponse,
			   !(200...299).contains(http.statusCode) {
				completion(.failure(.network(NSError(domain: "YelpHTTP",
													 code: http.statusCode))))
				return
			}
			guard let data else { completion(.failure(.noResults)); return }
			
			do {
				let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
				completion(.success(meta(from: json)))
			} catch { completion(.failure(.parsing(error))) }
		}.resume()
	}
	
	// ─────────── Build RestaurantMetadata ───────────
	static func meta(from b: [String: Any]) -> RestaurantMetadata {
		let photosRaw = (b["photos"] as? [String]) ??
		[b["image_url"] as? String].compactMap { $0 }
		
		return RestaurantMetadata(
			name             : b["name"] as? String,
			yelpId           : b["id"] as? String,
			googlePlaceId    : nil,
			yelpUrl          : b["url"] as? String,
			reviewCountYelp  : (b["review_count"] as? NSNumber)?.intValue,
			userRatingsTotal : nil,
			ratingGoogle     : nil,
			ratingYelp       : (b["rating"] as? NSNumber)?.doubleValue,
			priceLevel       : mapPrice(b["price"] as? String),
			photos           : photosRaw,
			categories       : (b["categories"] as? [[String: Any]])?
				.compactMap { $0["title"] as? String }
		)
	}
	
	// ─────────── Helpers ───────────
	static func splitQuery(_ raw: String) -> (name: String, city: String) {
		let parts = raw.components(separatedBy: ",")
		if parts.count >= 2 {
			return (parts[0].trimmingCharacters(in: .whitespacesAndNewlines),
					parts[1].trimmingCharacters(in: .whitespacesAndNewlines))
		}
		let tokens = raw.lowercased().split(separator: " ")
		if let idx = tokens.firstIndex(where: { ["nyc", "new", "york"].contains($0) }) {
			let name = tokens[..<idx].joined(separator: " ")
			return (name, "New York")
		}
		return (raw, "New York")          // default city
	}
	
	static func mapPrice(_ p: String?) -> Int? {
		guard let p else { return nil }
		return p.count
	}
}
