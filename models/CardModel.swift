import Foundation

struct Card: Identifiable, Equatable, Codable {
	let id: String
	let body: String?
	let headline: String?
	let timestamp: Date?
	let topic: String?
	let sources: [Source]?
	let directPlagiarismScore: Double?
	let rankingScore: Double?
	let status: String?
	let reasonCode: String?
	let spoiler: Bool?
	let enrichedMetadata: EnrichedMetadata?
	let apiAttributions: [APIAttribution]?
	let isWidgetDisabled: Bool?
	
	// ─────────── Init helpers (unchanged fields) ───────────
	init(
		id: String,
		body: String? = nil,
		headline: String? = nil,
		timestamp: Date? = nil,
		topic: String? = nil,
		sources: [Source]? = nil,
		directPlagiarismScore: Double? = nil,
		rankingScore: Double? = nil,
		status: String? = nil,
		reasonCode: String? = nil,
		spoiler: Bool? = nil,
		enrichedMetadata: EnrichedMetadata? = nil,
		apiAttributions: [APIAttribution]? = nil,
		isWidgetDisabled: Bool? = nil
	) {
		self.id = id
		self.body = body
		self.headline = headline
		self.timestamp = timestamp
		self.topic = topic
		self.sources = sources
		self.directPlagiarismScore = directPlagiarismScore
		self.rankingScore = rankingScore
		self.status = status
		self.reasonCode = reasonCode
		self.spoiler = spoiler
		self.enrichedMetadata = enrichedMetadata
		self.apiAttributions = apiAttributions
		self.isWidgetDisabled = isWidgetDisabled
	}
	
	// ─────────── JSON initializer  ───────────
	init(fromJson json: [String: Any]) {
		self.id = json["id"] as? String ?? ""
		self.body = json["body"] as? String
		self.headline = json["headline"] as? String
		if let t = json["timestamp"] as? String {
			self.timestamp = ISO8601DateFormatter().date(from: t)
		} else { self.timestamp = nil }
		self.topic = json["topic"] as? String
		if let src = json["sources"] as? [[String: Any]] {
			self.sources = src.compactMap { Source(fromJson: $0) }
		} else { self.sources = nil }
		self.directPlagiarismScore = json["directPlagiarismScore"] as? Double
		self.rankingScore = json["rankingScore"] as? Double
		self.status = json["status"] as? String
		self.reasonCode = json["reasonCode"] as? String
		self.spoiler = json["spoiler"] as? Bool
		
		if let enriched = json["enrichedMetadata"] as? [String: Any] {
			self.enrichedMetadata = EnrichedMetadata(fromJson: enriched)
		} else { self.enrichedMetadata = nil }
		
		if let att = json["apiAttributions"] as? [[String: Any]] {
			self.apiAttributions = att.compactMap {
				guard let api = $0["api"] as? String else { return nil }
				return APIAttribution(api: api, icon: $0["icon"] as? String)
			}
		} else { self.apiAttributions = nil }
		
		self.isWidgetDisabled = json["isWidgetDisabled"] as? Bool
	}
}

// ─────────── Widget eligibility (updated) ───────────
extension Card {
	enum WidgetType { case art, restaurant, music, filmTv, book, research, stock, politician, athlete, team }
	
	var eligibleWidgetType: WidgetType? {
		guard isWidgetDisabled != true,
			  let enriched = enrichedMetadata else { return nil }
		
		if let artStr = enriched.generatedArtURL ?? enriched.genArtwork?.url,
		   !artStr.isEmpty, URL(string: artStr) != nil { return .art }
		
		if let rest = enriched.restaurantMetadata,
		   FeatureFlagsManager.shared.isRestaurantWidgetEnabled,
		   let rating = rest.ratingYelp ?? rest.ratingGoogle,
		   rating > 0 { return .restaurant }
		
		if enriched.coreEntity?.type == "music",
		   enriched.musicMetadata != nil,
		   FeatureFlagsManager.shared.isMusicWidgetEnabled { return .music }
		
		if enriched.coreEntity?.type == "filmTv",
		   let film = enriched.filmTvMetadata,
		   let poster = film.poster, !poster.isEmpty, poster != "N/A",
		   FeatureFlagsManager.shared.isCinemaWidgetEnabled { return .filmTv }
		
		if enriched.coreEntity?.type == "book",
		   enriched.bookMetadata != nil,
		   FeatureFlagsManager.shared.isBookWidgetEnabled { return .book }
		
		if enriched.coreEntity?.type == "research",
		   enriched.coreEntity?.url != nil,
		   FeatureFlagsManager.shared.isResearchWidgetEnabled { return .research }
		
		if enriched.stockMetadata != nil,
		   FeatureFlagsManager.shared.isStockWidgetEnabled { return .stock }
		
		if enriched.coreEntity?.type == "politician",
		   enriched.politicianMetadata != nil { return .politician }
		
		if enriched.coreEntity?.type == "athlete",
		   enriched.athleteMetadata != nil { return .athlete }
		
		if enriched.coreEntity?.type == "team",
		   enriched.teamMetadata != nil { return .team }
		
		return nil
	}
	
	var domainId: String? {
		enrichedMetadata?.domain?.id
	}
	
	var domainName: String? {
		enrichedMetadata?.domain?.name
	}
	
	var domainCategories: [String] {
		enrichedMetadata?.domain?.categories ?? []
	}
	
	var domainSubcategoryId: String? {
		guard domainId == "11" else { return nil }
		return domainCategories.first(where: { $0.hasPrefix("research_") }) ?? domainCategories.first
	}
	
	// ─────────── Artwork for widget/share backgrounds ───────────
	func shareArtworkURLs() -> [URL] {
		var urls: [URL] = []
		
		if let gen = enrichedMetadata?.generatedArtURL,
		   let u = URL(string: gen) { urls.append(u) }
		else if let gen2 = enrichedMetadata?.genArtwork?.url,
				let u = URL(string: gen2) { urls.append(u) }
		
		if let u = enrichedMetadata?.musicMetadata?.artworkURL { urls.append(u) }
		
		if let poster = enrichedMetadata?.filmTvMetadata?.poster,
		   !poster.isEmpty, poster != "N/A",
		   let u = URL(string: poster) { urls.append(u) }
		
		if let head = enrichedMetadata?.filmTvPerson?.imageURL,
		   !head.isEmpty,
		   let u = URL(string: head) {
			urls.append(u)
		}
		
		if let u = enrichedMetadata?.bookMetadata?.coverURLCandidates().first {
			urls.append(u)
		}
		
		if let meta = enrichedMetadata?.politicianMetadata,
		   let img = meta.imageURL,
		   let u = URL(string: img) {
			let hasPoll = !(meta.pollSeries?.isEmpty ?? true)
			if !hasPoll { urls.append(u) }
		}
		
		if let img = enrichedMetadata?.athleteMetadata?.imageURL,
		   let u = URL(string: img) { urls.append(u) }
		
		if let logo = enrichedMetadata?.teamMetadata?.logoURL,
		   let u = URL(string: logo) { urls.append(u) }
		
		if let img = enrichedMetadata?.personMetadata?.imageURL,
		   !img.isEmpty,
		   let u = URL(string: img) {
			urls.append(u)
		}
		
		if let sm = enrichedMetadata?.stockMetadata {
			let hasChart = !(sm.dataPoints?.isEmpty ?? true) && sm.ticker != nil
			if !hasChart,
			   let logo = sm.companyLogoURL,
			   !logo.isEmpty,
			   let u = URL(string: logo) {
				urls.append(u)
			}
		}
		
		return urls
	}
}
