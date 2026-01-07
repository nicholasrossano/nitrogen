//
//  AppleMusicAPI.swift
//

import Foundation

// MARK: – Error types
enum AppleMusicAPIError: Error {
	case missingDevToken
	case invalidURL
	case unauthorized          // 401 or 403
	case network(Error)
	case parsing(Error)
	case noResults
	case notJSON
}

// MARK: – Model
struct MusicTrack: Identifiable {
	let id: String
	let name: String
	let artist: String
	let artworkURL: URL
	let previewURL: URL?
	let appleMusicURL: URL
}

// MARK: – Wrapper
struct AppleMusicAPI {
	
	// MARK: static config
	private static let storefront = "us"
	private static let base = "https://api.music.apple.com/v1/catalog"
	
	/// Developer-token JWT stored in Secrets.plist  (AppleMusicAPIKey)
	private static let devToken: String = {
		guard
			let path = Bundle.main.path(forResource: "Secrets", ofType: "plist"),
			let dict = NSDictionary(contentsOfFile: path),
			let token = dict["AppleMusicAPIKey"] as? String,
			!token.isEmpty
		else { fatalError("AppleMusic developer token missing") }
		return token
	}()
	
	// MARK: – Public search
	typealias Completion = (Result<MusicTrack, AppleMusicAPIError>) -> Void
	
	static func searchTopTrack(_ query: String, completion: @escaping Completion) {
		// Build URL
		var comps = URLComponents(string: "\(base)/\(storefront)/search")!
		comps.queryItems = [
			.init(name: "term", value: query),
			.init(name: "limit", value: "1"),
			.init(name: "types", value: "songs")
		]
		guard let url = comps.url else {
			completion(.failure(.invalidURL)); return
		}
		
		// Request
		var req = URLRequest(url: url)
		req.setValue("Bearer \(devToken)", forHTTPHeaderField: "Authorization")
		
		URLSession.shared.dataTask(with: req) { data, resp, err in
			if let e = err {
				completion(.failure(.network(e))); return
			}
			
			guard let http = resp as? HTTPURLResponse else {
				completion(.failure(.network(NSError(domain: "No HTTP", code: 0)))); return
			}
			
			if http.statusCode == 401 || http.statusCode == 403 {
				completion(.failure(.unauthorized)); return
			}
			
			guard let data = data, !data.isEmpty else {
				completion(.failure(.noResults)); return
			}
			
			// Try JSON first
			do {
				let resp = try JSONDecoder().decode(SearchResponse.self, from: data)
				guard
					let song = resp.results.songs?.data.first
				else { completion(.failure(.noResults)); return }
				
				let attr = song.attributes
				let artTemplate = attr.artwork.url
				guard let artURL = URL(string: artTemplate
					.replacingOccurrences(of: "{w}", with: "400")
					.replacingOccurrences(of: "{h}", with: "400"))
				else { throw AppleMusicAPIError.parsing(NSError()) }
				
				let previewURL = attr.previews.first.flatMap { URL(string: $0.url) }
				
				let track = MusicTrack(
					id: song.id,
					name: attr.name,
					artist: attr.artistName,
					artworkURL: artURL,
					previewURL: previewURL,
					appleMusicURL: URL(string: attr.url)!
				)
				completion(.success(track))
				return
			} catch {
				// Fall through to raw-text debug for malformed JSON
			}
			
			// Not valid JSON → emit body for debugging
			let bodyStr = String(data: data, encoding: .utf8) ?? "<non-UTF8>"
			print("⚠️ Raw Apple Music response (\(http.statusCode)) ↓↓↓\n\(bodyStr)\n────────")
			completion(.failure(.notJSON))
			
		}.resume()
	}
}

// MARK: – Minimal JSON structs
private struct SearchResponse: Decodable {
	let results: Results
	struct Results: Decodable {
		let songs: SongsResult?
		struct SongsResult: Decodable { let data: [Song] }
	}
	struct Song: Decodable {
		let id: String
		let attributes: Attr
	}
	struct Attr: Decodable {
		let name: String
		let artistName: String
		let url: String
		let previews: [Preview]
		let artwork: Artwork
	}
	struct Preview: Decodable { let url: String }
	struct Artwork: Decodable { let url: String }
}
