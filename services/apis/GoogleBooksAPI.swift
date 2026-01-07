import Foundation

// ────────── Error types ──────────
enum GoogleBooksAPIError: Error {
	case missingAPIKey, invalidURL, unauthorized
	case network(Error), parsing(Error), noResults
}

// ────────── Wrapper ──────────
struct GoogleBooksAPI {
	
	// MARK: Static config
	private static let base = "https://www.googleapis.com/books/v1"
	private static let apiKey: String = {
		guard
			let p = Bundle.main.path(forResource: "Secrets", ofType: "plist"),
			let d = NSDictionary(contentsOfFile: p),
			let k = d["GoogleBooksAPIKey"] as? String, !k.isEmpty
		else { fatalError("Google Books API key missing") }
		return k
	}()
	
	// MARK: Public search
	typealias Completion = (Result<BookMetadata, GoogleBooksAPIError>) -> Void
	
	static func searchTopBook(_ userQuery: String, completion: @escaping Completion) {
		let gbQuery = "intitle:" + quote(userQuery)
		
		var comps = URLComponents(string: "\(base)/volumes")!
		comps.queryItems = [
			.init(name: "q",          value: gbQuery),
			.init(name: "maxResults", value: "10"),
			.init(name: "printType",  value: "books"),
			.init(name: "projection", value: "full"),
			.init(name: "key",        value: apiKey)
		]
		guard let url = comps.url else { completion(.failure(.invalidURL)); return }
		
		URLSession.shared.dataTask(with: url) { data, _, err in
			if let err { completion(.failure(.network(err))); return }
			guard let data else { completion(.failure(.noResults)); return }
			
			do {
				guard
					let root  = try JSONSerialization.jsonObject(with: data) as? [String: Any],
					var items = root["items"] as? [[String: Any]], !items.isEmpty
				else { completion(.failure(.noResults)); return }
				
				// ---- Very light fuzzy re-rank ----
				let target = userQuery.lowercased()
				items.sort { a, b in scoreMatch(a, target) > scoreMatch(b, target) }
				
				// ---- Pick first item that has *both* cover + ISBN ----
				guard let item = items.first(where: { itemHasCover($0) && itemHasISBN($0) })
				else { completion(.failure(.noResults)); return }
				
				let vInfo = item["volumeInfo"] as? [String: Any] ?? [:]
				
				// ---- Cover ----
				let thumb = (vInfo["imageLinks"] as? [String: Any])?["thumbnail"] as? String
				let cover = thumb?.replacingOccurrences(of: "http://", with: "https://")
				
				// ---- ISBNs ----
				let ids: [BookMetadata.IndustryIdentifier]? =
				(vInfo["industryIdentifiers"] as? [[String: String]])?
					.compactMap { .init(type: $0["type"], identifier: $0["identifier"]) }
				
				// ---- Build metadata ----
				let meta = BookMetadata(
					title        : vInfo["title"] as? String,
					subtitle     : vInfo["subtitle"] as? String,
					authors      : vInfo["authors"] as? [String],
					publisher    : vInfo["publisher"] as? String,
					publishedDate: vInfo["publishedDate"] as? String,
					description  : vInfo["description"] as? String,
					categories   : vInfo["categories"] as? [String],
					pageCount    : vInfo["pageCount"] as? Int,
					averageRating: vInfo["averageRating"] as? Double,
					ratingsCount : vInfo["ratingsCount"] as? Int,
					previewLink  : nil,
					industryIds  : ids,
					cover        : cover
				)
				
				completion(.success(meta))
				
			} catch {
				completion(.failure(.parsing(error)))
			}
		}
		.resume()
	}
	
	// MARK: – Helpers
	private static func quote(_ s: String) -> String {
		"\"\(s.trimmingCharacters(in: .whitespacesAndNewlines))\""
	}
	
	private static func scoreMatch(_ item: [String: Any], _ target: String) -> Double {
		guard let vInfo = item["volumeInfo"] as? [String: Any],
			  let title = vInfo["title"] as? String else { return 0 }
		
		let loTitle = title.lowercased()
		let tokens  = Set(target.split(separator: " ").map(String.init))
		let tokenHits = tokens.filter { loTitle.contains($0) }.count
		
		let dist  = levenshtein(loTitle, target)
		let ratio = 1.0 - Double(dist) / Double(max(loTitle.count, target.count))
		
		return Double(tokenHits) + ratio
	}
	
	private static func levenshtein(_ a: String, _ b: String) -> Int {
		let a = Array(a), b = Array(b)
		var prev = Array(0...b.count)
		for (i, ca) in a.enumerated() {
			var cur = [i + 1] + Array(repeating: 0, count: b.count)
			for (j, cb) in b.enumerated() {
				cur[j + 1] = ca == cb ? prev[j] : 1 + min(prev[j], prev[j + 1], cur[j])
			}
			prev = cur
		}
		return prev.last!
	}
	
	private static func itemHasCover(_ item: [String: Any]) -> Bool {
		guard
			let vInfo = item["volumeInfo"] as? [String: Any],
			let links = vInfo["imageLinks"] as? [String: Any],
			let thumb = links["thumbnail"] as? String
		else { return false }
		return !thumb.isEmpty
	}
	
	private static func itemHasISBN(_ item: [String: Any]) -> Bool {
		guard
			let vInfo = item["volumeInfo"] as? [String: Any],
			let ids   = vInfo["industryIdentifiers"] as? [[String: String]]
		else { return false }
		
		return ids.contains { ($0["type"]?.contains("ISBN") ?? false) && !($0["identifier"]?.isEmpty ?? true) }
	}
}
