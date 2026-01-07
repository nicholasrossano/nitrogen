// ─────────── YouTubeAPI.swift (FULL FILE) ───────────
// Two-pass lookup → filters junk edits, checks HD + popularity, verifies the ID
// is *public* (and, when required, *embeddable*) via videos.list before returning.

import Foundation

// ─────────── Error Types ───────────
enum YouTubeAPIError: Error {
	case missingKey
	case invalidURL
	case network(Error)
	case parsing(Error)
	case noResults
}

typealias YouTubeCompletion = (Result<Video, YouTubeAPIError>) -> Void

// ─────────── Wrapper ───────────
struct YouTubeAPI {
	// ─────────── Secrets loader ───────────
	private static let apiKey: String = {
		guard
			let path = Bundle.main.path(forResource: "Secrets", ofType: "plist"),
			let dict = NSDictionary(contentsOfFile: path),
			let key  = dict["YouTubeAPIKey"] as? String,
			!key.isEmpty
		else { fatalError("YouTubeAPIKey missing in Secrets.plist") }
		return key
	}()
	
	private static let searchURL = "https://www.googleapis.com/youtube/v3/search"
	private static let statusURL = "https://www.googleapis.com/youtube/v3/videos"
	
	// ─────────── Public entry point ───────────
	static func fetchTopVideo(
		for rawQuery: String,
		category: VideoCategory = .other,
		completion: @escaping YouTubeCompletion
	) {
		Task {
			let query = boost(rawQuery)
			
			// ➊ Try embeddable first
			if let vid = try await search(query: query,
										  category: category,
										  requireEmbeddable: true) {
				completion(.success(vid))
				return
			}
			
			// ➋ Fallback → link-only, still HD + official
			if var vid = try await search(query: query,
										  category: category,
										  requireEmbeddable: false) {
				vid.embeddable = false
				completion(.success(vid))
				return
			}
			
			completion(.failure(.noResults))
		}
	}
	
	// ─────────── Private helpers ───────────
	private static func boost(_ q: String) -> String {
		let l = q.lowercased()
		if l.contains("trailer") { return q + " official trailer" }
		if l.contains("music") || l.contains("song") { return q + " official music video" }
		return q
	}
	
	private static func search(
		query: String,
		category: VideoCategory,
		requireEmbeddable: Bool
	) async throws -> Video? {
		
		// Search params
		var comps = URLComponents(string: searchURL)!
		var items: [URLQueryItem] = [
			.init(name: "part",            value: "snippet"),
			.init(name: "type",            value: "video"),
			.init(name: "q",               value: query),
			.init(name: "maxResults",      value: "10"),
			.init(name: "videoDefinition", value: "high"),     // HD only
			.init(name: "videoSyndicated", value: "true"),
			.init(name: "order",           value: "viewCount"),
			.init(name: "key",             value: apiKey)
		]
		if requireEmbeddable { items.append(.init(name: "videoEmbeddable", value: "true")) }
		if category != .other { items.append(.init(name: "videoCategoryId", value: category.rawValue)) }
		comps.queryItems = items
		
		guard let url = comps.url else { throw YouTubeAPIError.invalidURL }
		let (data, _) = try await URLSession.shared.data(from: url)
		let resp      = try JSONDecoder().decode(SearchResponse.self, from: data)
		
		// Heuristic sort
		let prefer = ["official trailer", "official music video", "trailer", "music video", "official"]
		let banned = ["lyric", "lyrics", "live", "cover", "sped up", "slowed", "fan", "audio ", "edit", "visualizer"]
		
		func score(_ t: String) -> Int {
			let lower = t.lowercased()
			let bad   = banned.contains(where: { lower.contains($0) }) ? 100 : 0
			let good  = prefer.firstIndex(where: { lower.contains($0) }) ?? prefer.count
			return bad + good
		}
		
		for item in resp.items.sorted(by: { score($0.snippet.title) < score($1.snippet.title) }) {
			let id = item.id.videoId
			guard await isPlayable(id: id, requireEmbeddable: requireEmbeddable) else { continue }
			
			let thumbs   = item.snippet.thumbnails
			let thumbURL = URL(string: thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default.url)!
			
			return Video(
				id:           id,
				title:        item.snippet.title,
				description:  item.snippet.description,
				thumbnailURL: thumbURL,
				videoURL:     URL(string: "https://www.youtube.com/watch?v=\(id)")!,
				category:     category,
				embeddable:   requireEmbeddable
			)
		}
		return nil
	}
	
	// Verifies the ID is public (and embeddable if required)
	private static func isPlayable(id: String, requireEmbeddable: Bool) async -> Bool {
		var comps = URLComponents(string: statusURL)!
		comps.queryItems = [
			.init(name: "part", value: "status"),
			.init(name: "id",   value: id),
			.init(name: "key",  value: apiKey)
		]
		guard let url = comps.url else { return false }
		
		do {
			let (data, _) = try await URLSession.shared.data(from: url)
			let resp = try JSONDecoder().decode(VideoStatusResponse.self, from: data)
			guard let status = resp.items.first?.status else { return false }
			return status.privacyStatus == "public" && (!requireEmbeddable || status.embeddable)
		} catch { return false }
	}
}

// ─────────── Decoding structs ───────────
private struct SearchResponse: Decodable {
	struct Item: Decodable {
		struct ID: Decodable { let videoId: String }
		struct Snippet: Decodable {
			let title, description: String
			let thumbnails: Thumbnails
		}
		struct Thumbnails: Decodable {
			let `default`: Thumb
			let medium:    Thumb?
			let high:      Thumb?
			struct Thumb: Decodable { let url: String }
		}
		let id: ID
		let snippet: Snippet
	}
	let items: [Item]
}

private struct VideoStatusResponse: Decodable {
	struct Item: Decodable {
		struct Status: Decodable { let embeddable: Bool; let privacyStatus: String }
		let id: String
		let status: Status
	}
	let items: [Item]
}
