import Foundation
import FirebaseAnalytics

enum DirectiveRegistry {
	
	/// Main entrypoint. Sends the user's text to the new Curator Agent (`agent_respond`)
	/// and returns ready-to-render ChatMessage instances in the order you can append them.
	static func execute(
		userText: String,
		cardId: String?,
		topicId: String?
	) async -> (messages: [ChatMessage], latencyMs: Int) {
		let start = Date()
		let messageId = UUID().uuidString  // kept for analytics continuity
		
		Analytics.logEvent("curator_directive_submit", parameters: [
			"card_id": (cardId ?? "") as NSString,
			"topic_id": (topicId ?? "") as NSString,
			"message": userText as NSString
		])
		
		do {
			let resp = try await CuratorAPI.agentRespond(
				userText: userText,
				geoCity: nil,           // (optionally pass city here)
				initialCard: nil,       // if you have the Card, pass it; cardId alone is insufficient
				modelCutoffISO: CuratorConfig.modelCutoffISO,
				recencyBufferDays: CuratorConfig.recencyBufferDays
			)
			
			var out: [ChatMessage] = []
			
			// 1) Assistant text (always first)
			if let t = resp.text, !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
				out.append(ChatMessage(text: t, isUser: false))
			}
			
			// 2) Widgets → ChatMessage(s)
			for w in (resp.widgets ?? []) {
				switch w.type.lowercased() {
				case "music", "track":
					if let m = buildMusicMessage(from: w) { out.append(m) }
					
				case "cinema", "movie", "film", "tv":
					if let m = buildCinemaMessage(from: w) { out.append(m) }
					
				case "books", "book":
					if let m = buildBookMessage(from: w) { out.append(m) }
					
				case "restaurants", "restaurant", "place", "places":
					if let m = buildRestaurantMessage(from: w) { out.append(m) }
					
				case "companies", "company", "stocks", "stock":
					if let m = buildStockMessage(from: w) { out.append(m) }
					
				default:
					continue
				}
			}
			
			let latency = max(0, Int(Date().timeIntervalSince(start) * 1000))
			Analytics.logEvent("curator_directive_result", parameters: [
				"card_id": (cardId ?? "") as NSString,
				"topic_id": (topicId ?? "") as NSString,
				"result_count": NSNumber(value: out.count),
				"latency_ms": NSNumber(value: latency)
			])
			
			return (out, latency)
			
		} catch {
			Analytics.logEvent("curator_directive_error", parameters: [
				"card_id": (cardId ?? "") as NSString,
				"topic_id": (topicId ?? "") as NSString,
				"error": "\(error)" as NSString
			])
			// Fallback: minimal assistant message
			return ([ChatMessage(text: "Sorry — I couldn’t fetch that just now.", isUser: false)],
					Int(Date().timeIntervalSince(start) * 1000))
		}
	}
}

// MARK: - Domain builders (use your concrete bubble types)

private extension DirectiveRegistry {
	// MUSIC → MusicTrack (AppleMusicAPI)
	static func buildMusicMessage(from w: AgentWidget) -> ChatMessage? {
		let song = (w.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		guard !song.isEmpty else { return nil }
		
		let artist = parseArtist(from: w.subtitle) ?? ""
		guard !artist.isEmpty else { return nil }
		
		guard let artworkURL = urlFromMaybeNA(w.artwork_url) else { return nil }
		let previewURL = urlFromMaybeNA(w.preview_url)
		
		// Deeplink to Apple Music search if we don’t have a canonical track URL
		let q = "\(artist) \(song)".addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? song
		let appleURL = URL(string: "https://music.apple.com/us/search?term=\(q)&media=music")!
		
		let track = MusicTrack(
			id: w.canonical_id ?? UUID().uuidString,
			name: song,
			artist: artist,
			artworkURL: artworkURL,
			previewURL: previewURL,
			appleMusicURL: appleURL
		)
		return ChatMessage(track: track)
	}
	
	// CINEMA → Movie (OMDBAPI)
	static func buildCinemaMessage(from w: AgentWidget) -> ChatMessage? {
		let title = (w.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		guard !title.isEmpty else { return nil }
		
		let year = parseYear(from: w.subtitle) ?? ""
		let id = (w.canonical_id ?? "").isEmpty ? UUID().uuidString : (w.canonical_id ?? "")
		let posterURL = urlFromMaybeNA(w.poster_url)
		let imdbURL: URL? = {
			let cid = (w.canonical_id ?? "")
			return cid.hasPrefix("tt") ? URL(string: "https://www.imdb.com/title/\(cid)") : nil
		}()
		let trailerURL = urlFromMaybeNA(w.trailer_url)
		
		let movie = Movie(
			id: id,
			title: title,
			year: year,
			posterURL: posterURL,
			imdbURL: imdbURL,
			trailerURL: trailerURL
		)
		return ChatMessage(movie: movie)
	}
	
	// BOOKS → BookMetadata (authors: [String], cover: String?)
	static func buildBookMessage(from w: AgentWidget) -> ChatMessage? {
		let title = (w.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		guard !title.isEmpty else { return nil }
		
		let author = parseBookAuthor(from: w.subtitle)
		guard !author.isEmpty else { return nil }
		
		let cover = normalizeNA(w.cover_url) // BookMetadata expects String? for cover
		let book = BookMetadata(
			title: title,
			subtitle: nil,
			authors: [author],
			publisher: nil,
			publishedDate: nil,
			description: nil,
			categories: nil,
			pageCount: nil,
			averageRating: nil,
			ratingsCount: nil,
			previewLink: nil,
			industryIds: nil,
			cover: cover
		)
		return ChatMessage(book: book)
	}
	
	// RESTAURANTS → RestaurantMetadata (priceLevel:Int?, photos:[String]?)
	static func buildRestaurantMessage(from w: AgentWidget) -> ChatMessage? {
		let name = (w.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		guard !name.isEmpty else { return nil }
		
		let priceLevel = parsePriceLevel(from: w.subtitle)
		let photo = normalizeNA(w.photo_url)
		let photos = photo.map { [$0] }
		
		// Parse category from subtitle if present ("Italian • $$")
		let categories: [String]? = {
			let s = (w.subtitle ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
			guard !s.isEmpty else { return nil }
			let left = s.components(separatedBy: "•").first?.trimmingCharacters(in: .whitespaces) ?? ""
			return left.isEmpty ? nil : [left]
		}()
		
		let place = RestaurantMetadata(
			name: name,
			yelpId: nil,
			googlePlaceId: nil,
			yelpUrl: nil,
			reviewCountYelp: nil,
			userRatingsTotal: nil,
			ratingGoogle: nil,
			ratingYelp: nil,
			priceLevel: priceLevel,
			photos: photos,
			categories: categories
		)
		return ChatMessage(restaurant: place)
	}
	
	// COMPANIES / STOCKS → StockMetadata (chart or company tile)
	static func buildStockMessage(from w: AgentWidget) -> ChatMessage? {
		var dict: [String: Any] = [:]
		
		// Identity
		if let t = normalizeNA(w.ticker) ?? normalizeNA(w.canonical_id) {
			dict["ticker"] = t
		}
		// Company fallback fields
		if let name = w.companyName ?? normalizeNA(w.title) { dict["companyName"] = name }
		if let industry = w.companyIndustry ?? normalizeNA(w.subtitle) { dict["companyIndustry"] = industry }
		if let logo = w.companyLogoURL { dict["companyLogoURL"] = logo }
		if let url  = w.companyURL { dict["companyURL"] = url }
		
		// Optional chart series (if the agent included it)
		if let pts = w.dataPoints, !pts.isEmpty {
			let arr: [[String: Any]] = pts.map { ["date": $0.date, "close": $0.close] }
			dict["dataPoints"] = arr
		}
		
		let stock = StockMetadata(fromJson: dict)
		return ChatMessage(stock: stock)
	}
}

// MARK: - Tiny string helpers

private extension DirectiveRegistry {
	static func urlFromMaybeNA(_ s: String?) -> URL? {
		guard let raw = s?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty, raw != "N/A" else { return nil }
		return URL(string: raw)
	}
	static func normalizeNA(_ s: String?) -> String? {
		guard let raw = s?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty, raw != "N/A" else { return nil }
		return raw
	}
	static func parseArtist(from subtitle: String?) -> String? {
		guard let s = subtitle, !s.isEmpty else { return nil }
		if let left = s.split(separator: "—").first { return String(left).trimmingCharacters(in: .whitespaces) }
		return s.trimmingCharacters(in: .whitespaces)
	}
	static func parseYear(from subtitle: String?) -> String? {
		guard let s = subtitle else { return nil }
		if let match = s.range(of: #"(?<!\d)(\d{4})(?!\d)"#, options: .regularExpression) {
			return String(s[match])
		}
		return nil
	}
	static func parseBookAuthor(from subtitle: String?) -> String {
		guard let s = subtitle?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return "" }
		if let left = s.split(separator: "—").first { return String(left).trimmingCharacters(in: .whitespaces) }
		return s
	}
	static func parsePriceLevel(from subtitle: String?) -> Int? {
		guard let s = subtitle?.replacingOccurrences(of: " ", with: "") else { return nil }
		if s.contains("$$$$") { return 4 }
		if s.contains("$$$")  { return 3 }
		if s.contains("$$")   { return 2 }
		if s.contains("$")    { return 1 }
		return nil
	}
}
