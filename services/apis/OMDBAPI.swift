import Foundation

// ─────────── Error types ───────────
enum OMDBAPIError: Error {
	case missingKey
	case invalidURL
	case network(Error)
	case parsing(Error)
	case noResults
}

// ─────────── Model ───────────
struct Movie: Identifiable {
	let id        : String
	let title     : String
	let year      : String
	let posterURL : URL?
	let imdbURL   : URL?
	let trailerURL: URL?
}

// ─────────── Wrapper ───────────
struct OMDBAPI {
	
	// ─────────── Static config ───────────
	private static let base = "https://www.omdbapi.com/"
	
	private static let apiKey: String = {
		guard
			let path = Bundle.main.path(forResource: "Secrets", ofType: "plist"),
			let dict = NSDictionary(contentsOfFile: path),
			let key  = dict["OMDBAPIKey"] as? String, !key.isEmpty
		else { fatalError("OMDB API key missing") }
		return key
	}()
	
	typealias Completion = (Result<Movie,OMDBAPIError>) -> Void
	
	// ─────────── Public search (auto-retry) ───────────
	static func searchTopMovie(_ rawQuery: String, completion: @escaping Completion) {
		queryOmdb(rawQuery) { first in
			switch first {
			case .success:
				completion(first)                       // found on first try
				
			case .failure:
				// strip trailing 4-digit year and retry, e.g.  "Parasite 2019" → "Parasite"
				let stripped = rawQuery.replacingOccurrences(
					of: #" \d{4}$"#,
					with: "",
					options: .regularExpression
				)
				guard stripped != rawQuery else {       // no year -> we're done
					completion(first); return
				}
				
				queryOmdb(stripped, completion: completion)
			}
		}
	}
}

// ─────────── Private helpers ───────────
private extension OMDBAPI {
	
	static func queryOmdb(_ query: String, completion: @escaping Completion) {
		// split optional trailing year
		let regex = try! NSRegularExpression(pattern: #"^(.*?)(?:\s+(\d{4}))?$"#)
		guard
			let m  = regex.firstMatch(in: query, range: NSRange(query.startIndex..., in: query)),
			let tR = Range(m.range(at: 1), in: query)
		else { completion(.failure(.invalidURL)); return }
		
		let title = String(query[tR]).trimmingCharacters(in: .whitespaces)
		let year  = Range(m.range(at: 2), in: query).map { String(query[$0]) }
		
		var comps = URLComponents(string: base)!
		comps.queryItems = [
			.init(name: "apikey", value: apiKey),
			.init(name: "s"     , value: title),
			.init(name: "type"  , value: "movie"),
			.init(name: "page"  , value: "1")
		]
		if let y = year { comps.queryItems?.append(.init(name: "y", value: y)) }
		guard let url = comps.url else { completion(.failure(.invalidURL)); return }
		
		URLSession.shared.dataTask(with: url) { data, _, err in
			if let e = err { completion(.failure(.network(e))); return }
			
			guard
				let data,
				let list = try? JSONDecoder().decode(SearchList.self, from: data),
				let first = list.Search.first
			else { completion(.failure(.noResults)); return }
			
			detailRequest(first.imdbID, completion: completion)
			
		}.resume()
	}
	
	static func detailRequest(_ imdbID: String, completion: @escaping Completion) {
		var comps = URLComponents(string: base)!
		comps.queryItems = [
			.init(name: "apikey", value: apiKey),
			.init(name: "i"     , value: imdbID),
			.init(name: "plot"  , value: "short")
		]
		guard let url = comps.url else { completion(.failure(.invalidURL)); return }
		
		URLSession.shared.dataTask(with: url) { data, _, err in
			if let e = err { completion(.failure(.network(e))); return }
			guard
				let data,
				let d = try? JSONDecoder().decode(MovieDetail.self, from: data)
			else { completion(.failure(.parsing(NSError()))); return }
			
			let poster = (d.Poster != "N/A") ? URL(string: d.Poster) : nil
			let imdb   = URL(string: "https://www.imdb.com/title/\(d.imdbID)")
			
			let movie = Movie(
				id        : d.imdbID,
				title     : d.Title,
				year      : d.Year,
				posterURL : poster,
				imdbURL   : imdb,
				trailerURL: nil
			)
			completion(.success(movie))
		}.resume()
	}
}

// ─────────── JSON structs ───────────
private struct SearchList: Decodable {
	let Search: [Hit]
	struct Hit: Decodable { let Title, Year, imdbID: String }
}

private struct MovieDetail: Decodable {
	let Title, Year, imdbID, Poster: String
}
