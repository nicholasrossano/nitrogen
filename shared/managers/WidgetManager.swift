import SwiftUI
import SDWebImageSwiftUI
import UIKit
import FirebaseAnalytics

struct WidgetManager {
	// ─────────── Public helpers ───────────
	static func iconName(for widgetType: Card.WidgetType?) -> String? {
		guard let widgetType else { return nil }
		switch widgetType {
		case .art:        return "paintbrush.pointed.fill"
		case .restaurant: return "fork.knife"
		case .music:      return "music.quarternote.3"
		case .filmTv:     return "film"
		case .book:       return "book.fill"
		case .politician: return "building.columns.fill"
		case .research:   return "atom"
		case .stock:      return "chart.line.uptrend.xyaxis"
		case .athlete:    return "trophy.fill"
		case .team:       return "trophy.fill"
		}
	}
	
	static func hasAnyWidget(for card: Card?) -> Bool {
		guard let card, card.isWidgetDisabled != true else { return false }
		
		if isWidgetRenderable(for: card) {
			return true
		}
		
		if ImageWidget.heroImage(for: card) != nil {
			return true
		}
		
		if let person = card.enrichedMetadata?.personMetadata,
		   PersonWidget.isRenderable(person) {
			return true
		}
		
		return false
	}
	
	// ─────────── Share thumbnail strategy ───────────
	enum ShareThumbnailChoice {
		case stockChart(metadata: StockMetadata)
		case politicianPoll(name: String, points: [PoliticianMetadata.PollPoint])
		case headerImage(url: URL)
		case heroImage(url: URL)
		case artwork
		case none
	}
	
	static func shareThumbnailChoice(for card: Card?) -> ShareThumbnailChoice {
		guard let card else { return .none }
		
		let heroURL = ImageWidget.heroImage(for: card)?.imageURL
		
		guard card.isWidgetDisabled != true else {
			if let heroURL { return .heroImage(url: heroURL) }
			return .none
		}
		
		guard let enriched = card.enrichedMetadata else {
			if let heroURL { return .heroImage(url: heroURL) }
			return .none
		}
		
		if let stock = enriched.stockMetadata,
		   let points = stock.dataPoints,
		   !points.isEmpty,
		   stock.ticker != nil {
			return .stockChart(metadata: stock)
		}
		
		if let pol = enriched.politicianMetadata,
		   let series = pol.pollSeries,
		   !series.isEmpty {
			return .politicianPoll(name: pol.name ?? "", points: series)
		}
		
		let coreType = (enriched.coreEntity?.type ?? "").lowercased()
		let isMusicOrFilm = (coreType == "music" || coreType == "filmtv")
		if isMusicOrFilm,
		   let headerURL = enriched.musicMetadata?.videoPosterURL
			?? enriched.filmTvMetadata?.videoPosterURL {
			return .headerImage(url: headerURL)
		}
		
		let widgetType = resolvedWidgetType(for: card)
		let artworkURLs = card.shareArtworkURLs()
		
		if let widgetType,
		   (widgetType == .team || widgetType == .athlete),
		   let heroURL {
			return .heroImage(url: heroURL)
		}
		
		let prefersArtworkOverHero: Bool = {
			guard let widgetType else { return false }
			switch widgetType {
			case .art, .music, .filmTv, .book, .stock, .politician:
				return true
			case .athlete, .team:
				return true
			case .restaurant, .research:
				return false
			}
		}()
		
		if prefersArtworkOverHero, !artworkURLs.isEmpty {
			return .artwork
		}
		
		if let heroURL {
			return .heroImage(url: heroURL)
		}
		
		if !artworkURLs.isEmpty {
			return .artwork
		}
		
		return .none
	}
	
	// ─────────── Preview thumbnail strategy (matches WidgetManager.build precedence) ───────────
	static func previewThumbnailChoice(for card: Card?) -> ShareThumbnailChoice {
		guard let card else { return .none }
		
		let heroURL = ImageWidget.heroImage(for: card)?.imageURL
		
		guard card.isWidgetDisabled != true else {
			if let heroURL { return .heroImage(url: heroURL) }
			return .none
		}
		
		guard let enriched = card.enrichedMetadata else {
			if let heroURL { return .heroImage(url: heroURL) }
			return .none
		}
		
		let widgetType = resolvedWidgetType(for: card)
		let hasHeroImage = (heroURL != nil)
		let artworkURLs = card.shareArtworkURLs()
		
		let politicianMeta = enriched.politicianMetadata
		let hasPoll = !(politicianMeta?.pollSeries?.isEmpty ?? true)
		
		let stockMeta = enriched.stockMetadata
		let hasStockChart = !(stockMeta?.dataPoints?.isEmpty ?? true) && stockMeta?.ticker != nil
		
		let canSpecialty = isWidgetRenderable(for: card)
		
		let hasPrimaryWidget: Bool = {
			guard let widgetType, canSpecialty else { return false }
			if widgetType == .politician { return hasPoll }
			if widgetType == .stock      { return hasStockChart }
			if (widgetType == .team || widgetType == .athlete), hasHeroImage { return false }
			return true
		}()
		
		let hasPoliticianFallback = (widgetType == .politician && canSpecialty && !hasPoll)
		let hasStockFallback      = (widgetType == .stock && canSpecialty && !hasStockChart)
		
		let personMeta = enriched.personMetadata
		let canRenderPerson = personMeta.map { PersonWidget.isRenderable($0) } ?? false
		
		if hasPrimaryWidget, let widgetType {
			if widgetType == .stock, let stockMeta {
				return .stockChart(metadata: stockMeta)
			}
			
			if widgetType == .politician,
			   let pol = politicianMeta,
			   let series = pol.pollSeries {
				return .politicianPoll(name: pol.name ?? "", points: series)
			}
			
			if widgetType == .research {
				if let url = researchPreviewImageURL(enriched: enriched, heroURL: heroURL, artworkURLs: artworkURLs) {
					return .headerImage(url: url)
				}
				if let heroURL { return .heroImage(url: heroURL) }
				return .none
			}
			
			let coreType = (enriched.coreEntity?.type ?? "").lowercased()
			let isMusicOrFilm = (coreType == "music" || coreType == "filmtv")
			if isMusicOrFilm,
			   let headerURL = enriched.musicMetadata?.videoPosterURL
				?? enriched.filmTvMetadata?.videoPosterURL {
				return .headerImage(url: headerURL)
			}
			
			if !artworkURLs.isEmpty { return .artwork }
			if let heroURL { return .heroImage(url: heroURL) }
			return .none
		}
		
		if let heroURL { return .heroImage(url: heroURL) }
		
		if hasPoliticianFallback,
		   let urlStr = politicianMeta?.imageURL?.trimmingCharacters(in: .whitespacesAndNewlines),
		   !urlStr.isEmpty,
		   let url = URL(string: urlStr) {
			return .headerImage(url: url)
		}
		
		if hasStockFallback,
		   let urlStr = stockMeta?.companyLogoURL?.trimmingCharacters(in: .whitespacesAndNewlines),
		   !urlStr.isEmpty,
		   let url = URL(string: urlStr) {
			return .headerImage(url: url)
		}
		
		if canRenderPerson,
		   let urlStr = personMeta?.imageURL?.trimmingCharacters(in: .whitespacesAndNewlines),
		   !urlStr.isEmpty,
		   let url = URL(string: urlStr) {
			return .headerImage(url: url)
		}
		
		if !artworkURLs.isEmpty { return .artwork }
		
		return .none
	}
	
	// ─────────── Research preview image helpers ───────────
	private static let genericResearchCoverFilename = "generic-cover.png"
	
	private static func secureResearchURL(from raw: String?) -> URL? {
		guard let raw else { return nil }
		var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
		if s.isEmpty { return nil }
		if s.hasPrefix("http://") {
			s = s.replacingOccurrences(of: "http://", with: "https://")
		}
		return URL(string: s)
	}
	
	private static func isGenericResearchCoverURL(_ url: URL) -> Bool {
		let abs = url.absoluteString.lowercased()
		if abs.contains("/\(genericResearchCoverFilename)") { return true }
		if url.lastPathComponent.lowercased() == genericResearchCoverFilename { return true }
		return false
	}
	
	private static func researchChartImageURL(from metadata: ResearchMetadata?) -> URL? {
		let assets = metadata?.images ?? []
		for asset in assets {
			if let u = secureResearchURL(from: asset.url) { return u }
		}
		return nil
	}
	
	private static func researchCoverURL(from metadata: ResearchMetadata?) -> URL? {
		guard let u = secureResearchURL(from: metadata?.journalCoverURL) else { return nil }
		if isGenericResearchCoverURL(u) { return nil }
		return u
	}
	
	private static func researchPreviewImageURL(
		enriched: EnrichedMetadata,
		heroURL: URL?,
		artworkURLs: [URL]
	) -> URL? {
		let meta = enriched.researchMetadata
		
		if let chart = researchChartImageURL(from: meta) {
			return chart
		}
		
		if (meta?.images?.isEmpty ?? true), let firstArtwork = artworkURLs.first {
			return firstArtwork
		}
		
		if let cover = researchCoverURL(from: meta) {
			return cover
		}
		
		if let firstArtwork = artworkURLs.first {
			return firstArtwork
		}
		
		return nil
	}
	
	// ─────────── Section Header ───────────
	private static func isTheatre(_ card: Card) -> Bool {
		guard let enriched = card.enrichedMetadata else { return false }
		
		let subtype = enriched.coreEntity?.subtype?
			.lowercased()
			.replacingOccurrences(of: "_", with: "")
			.replacingOccurrences(of: "-", with: "")
			.replacingOccurrences(of: " ", with: "")
		
		if subtype == "theatre" || subtype == "theater" { return true }
		
		let metaType  = enriched.filmTvMetadata?.type?.lowercased() ?? ""
		let metaGenre = enriched.filmTvMetadata?.genre?.lowercased() ?? ""
		if metaType.contains("theatre") || metaType.contains("theater") { return true }
		if metaGenre.contains("theatre") || metaGenre.contains("theater") { return true }
		
		return false
	}
	
	private static func isPodcast(_ card: Card) -> Bool {
		guard let mm = card.enrichedMetadata?.musicMetadata else { return false }
		if let host = mm.appleMusicURL?.host?.lowercased(), host.contains("podcasts.apple.com") { return true }
		if let sp = mm.spotifyURL?.absoluteString.lowercased(), sp.contains("open.spotify.com/show") { return true }
		if let u = mm.previewURL?.absoluteString.lowercased() {
			if u.hasSuffix(".mp3") { return true }
			let hints = ["simplecast", "megaphone", "buzzsprout", "libsyn", "anchor.fm", "art19", "audioboom", "omnystudio"]
			if hints.first(where: { u.contains($0) }) != nil { return true }
		}
		return false
	}
	
	static func iconName(for card: Card?) -> String? {
		guard let card else { return nil }
		
		if let widgetType = resolvedWidgetType(for: card) {
			if widgetType == .music, isPodcast(card) { return "mic.fill" }
			return iconName(for: widgetType)
		}
		
		guard let coreTypeRaw = card.enrichedMetadata?.coreEntity?.type else { return nil }
		let normalizedType = coreTypeRaw
			.lowercased()
			.replacingOccurrences(of: "_", with: "")
			.replacingOccurrences(of: "-", with: "")
			.replacingOccurrences(of: " ", with: "")
		
		switch normalizedType {
		case "restaurant": return iconName(for: .restaurant)
		case "music":      return iconName(for: .music)
		case "filmtv":
			if isTheatre(card) { return "theatermasks.fill" }
			return iconName(for: .filmTv)
		case "book":       return iconName(for: .book)
		case "research":   return iconName(for: .research)
		case "stock":      return iconName(for: .stock)
		case "company":    return iconName(for: .stock)
		case "politician": return iconName(for: .politician)
		case "athlete":    return sportIconName(from: card.enrichedMetadata?.coreEntity?.sport)
		case "team":       return sportIconName(from: card.enrichedMetadata?.coreEntity?.sport)
		default:           return nil
		}
	}
	
	static func clipCorners(isExpanded: Bool, hasWidget: Bool) -> UIRectCorner {
		if !isExpanded { return .allCorners }
		return hasWidget ? [.bottomLeft] : [.topLeft, .topRight, .bottomLeft]
	}
	
	static func isWidgetRenderable(for card: Card?) -> Bool {
		guard let card,
			  card.isWidgetDisabled != true,
			  let _ = resolvedWidgetType(for: card),
			  let enriched = card.enrichedMetadata else { return false }
		
		switch resolvedWidgetType(for: card)! {
		case .art:
			guard FeatureFlagsManager.shared.isArtWidgetEnabled else { return false }
			if let s = enriched.generatedArtURL ?? enriched.genArtwork?.url,
			   !s.isEmpty, URL(string: s) != nil { return true }
			return false
			
		case .music:
			return enriched.musicMetadata?.artworkURL != nil
			
		case .filmTv:
			if let meta = enriched.filmTvMetadata,
			   let poster = meta.poster,
			   let title  = meta.title,
			   !poster.isEmpty, poster != "N/A",
			   !title.isEmpty { return true }
			if let person = enriched.filmTvPerson,
			   let img = person.imageURL,
			   !img.isEmpty,
			   URL(string: img) != nil { return true }
			return false
			
		case .book:
			if let meta = enriched.bookMetadata,
			   let cover = meta.cover { return !cover.isEmpty && cover != "N/A" }
			return false
			
		case .research:
			if let entity = enriched.coreEntity {
				return entity.type?.lowercased() == "research" && entity.url != nil
			}
			return false
			
		case .stock:
			if let meta = enriched.stockMetadata {
				let hasChart = !(meta.dataPoints?.isEmpty ?? true) && meta.ticker != nil
				let hasFallback: Bool = {
					let name = meta.companyName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
					let logo = meta.companyLogoURL?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
					let hasNameOrTicker = (!name.isEmpty) || (meta.ticker != nil && !(meta.ticker ?? "").isEmpty)
					let logoIsURL = URL(string: logo) != nil
					return hasNameOrTicker && logoIsURL
				}()
				return hasChart || hasFallback
			}
			return false
			
		case .restaurant:
			return enriched.restaurantMetadata != nil
			
		case .politician:
			if let meta = enriched.politicianMetadata {
				let hasPoll  = !(meta.pollSeries?.isEmpty ?? true)
				let hasPhoto = {
					guard let urlStr = meta.imageURL,
						  !urlStr.isEmpty,
						  URL(string: urlStr) != nil else { return false }
					return true
				}()
				return hasPoll || hasPhoto
			}
			return false
			
		case .athlete:
			if let img = enriched.athleteMetadata?.imageURL,
			   !img.isEmpty, URL(string: img) != nil { return true }
			return false
			
		case .team:
			if let logo = enriched.teamMetadata?.logoURL,
			   !logo.isEmpty, URL(string: logo) != nil { return true }
			return false
		}
	}
	
	@available(*, deprecated, message: "Use iconName(for:) with Card? instead.")
	static func iconNameIfRenderable(for card: Card?) -> String? { iconName(for: card) }
	
	private static func filmTvFallbackType(for card: Card) -> Card.WidgetType? {
		guard let enriched = card.enrichedMetadata else { return nil }
		if card.eligibleWidgetType != nil { return nil }
		if enriched.filmTvPerson != nil || enriched.filmTvMetadata != nil { return .filmTv }
		if enriched.coreEntity?.type?.lowercased() == "filmtv" { return .filmTv }
		return nil
	}
	
	private static func resolvedWidgetType(for card: Card) -> Card.WidgetType? {
		if card.isWidgetDisabled == true { return nil }
		
		if let t = card.eligibleWidgetType { return t }
		
		if let mm = card.enrichedMetadata?.musicMetadata,
		   mm.artworkURL != nil {
			return .music
		}
		
		if (card.enrichedMetadata?.coreEntity?.type?.lowercased() == "research") { return .research }
		if let meta = card.enrichedMetadata?.bookMetadata,
		   let cover = meta.cover,
		   !cover.isEmpty, cover != "N/A" { return .book }
		if let t = filmTvFallbackType(for: card) { return t }
		return nil
	}
	
	@ViewBuilder
	static func iconOverlay(for card: Card?) -> some View {
		_SearchBadgeOrIconView(card: card)
	}
	
	private struct _SearchBadgeOrIconView: View {
		let card: Card?
		
		var body: some View {
			if let name = WidgetManager.iconName(for: card) {
				Image(systemName: name)
					.font(.system(size: 16, weight: .medium))
					.foregroundColor(Color.accentPrimary)
					.frame(width: 28, height: 28)
			} else {
				EmptyView()
			}
		}
	}
	
	@ViewBuilder
	static func build(
		card: Card,
		geometry: GeometryProxy,
		widgetHeight: CGFloat
	) -> some View {
		_WidgetSurface(card: card, geometry: geometry, widgetHeight: widgetHeight)
	}
	
	private struct _WidgetSurface: View {
		let card: Card
		let geometry: GeometryProxy
		let widgetHeight: CGFloat
		@Environment(\.curatorBubbleFallbackEnabled) private var bubbleFallback
		
		var body: some View {
			let enriched = card.enrichedMetadata
			let widgetType = WidgetManager.resolvedWidgetType(for: card)
			let hasHeroImage = ImageWidget.heroImage(for: card) != nil
			
			let politicianMeta = enriched?.politicianMetadata
			let hasPoll = !(politicianMeta?.pollSeries?.isEmpty ?? true)
			
			let stockMeta = enriched?.stockMetadata
			let hasStockChart = !(stockMeta?.dataPoints?.isEmpty ?? true)
			
			let canSpecialty = WidgetManager.isWidgetRenderable(for: card)
			
			let hasPrimaryWidget: Bool = {
				guard let wt = widgetType, canSpecialty else { return false }
				if wt == .politician { return hasPoll }
				if wt == .stock      { return hasStockChart }
				if (wt == .team || wt == .athlete), hasHeroImage { return false }
				return true
			}()
			
			let hasPoliticianFallback = (widgetType == .politician && canSpecialty && !hasPoll)
			let hasStockFallback      = (widgetType == .stock && canSpecialty && !hasStockChart)
			
			let personMeta = enriched?.personMetadata
			let canRenderPerson = personMeta.map { PersonWidget.isRenderable($0) } ?? false
			
			if hasPrimaryWidget, let widgetType {
				switch widgetType {
				case .art:
					ArtWidget(enrichedMetadata: card.enrichedMetadata, cardId: card.id, height: widgetHeight)
						.frame(height: widgetHeight)
						.widgetSwapEffect(id: card.id)
					
				case .music:
					MusicWidget(enrichedMetadata: card.enrichedMetadata, cardId: card.id)
						.frame(height: widgetHeight)
						.widgetSwapEffect(id: card.id)
					
				case .filmTv:
					if let person = card.enrichedMetadata?.filmTvPerson,
					   let img = person.imageURL,
					   !img.isEmpty,
					   URL(string: img) != nil {
						if hasHeroImage {
							ImageWidget(card: card, height: widgetHeight)
								.frame(height: widgetHeight, alignment: .top)
								.widgetSwapEffect(id: card.id)
						} else {
							CinemaPersonWidget(
								metadata: person,
								cardId: card.id,
								height: widgetHeight,
								style: .bar
							)
							.frame(height: widgetHeight, alignment: .top)
							.widgetSwapEffect(id: card.id)
						}
					} else {
						CinemaWidget(enrichedMetadata: card.enrichedMetadata, cardId: card.id)
							.frame(height: widgetHeight, alignment: .top)
							.widgetSwapEffect(id: card.id)
					}
					
				case .book:
					if let book = card.enrichedMetadata?.bookMetadata {
						BookWidget(metadata: book, cardId: card.id)
							.frame(height: widgetHeight, alignment: .top)
							.widgetSwapEffect(id: card.id)
					} else {
						EmptyView()
					}
					
				case .research:
					if let entity = card.enrichedMetadata?.coreEntity {
						ResearchWidget(
							entity: entity,
							cardId: card.id,
							height: widgetHeight,
							style: .bar,
							screen: "feed" ,
							topicId: card.topic,
							metadata: card.enrichedMetadata?.researchMetadata
						)
						.frame(height: widgetHeight, alignment: .top)
						.widgetSwapEffect(id: card.id)
					} else {
						EmptyView()
					}
					
				case .stock:
					StockWidget(metadata: card.enrichedMetadata?.stockMetadata, cardId: card.id)
						.frame(height: widgetHeight, alignment: .top)
						.widgetSwapEffect(id: card.id)
					
				case .restaurant:
					if let rest = card.enrichedMetadata?.restaurantMetadata {
						RestaurantWidget(metadata: rest, cardId: card.id)
							.frame(height: widgetHeight, alignment: .top)
							.widgetSwapEffect(id: card.id)
					} else {
						EmptyView()
					}
					
				case .politician:
					if let meta = card.enrichedMetadata?.politicianMetadata {
						let hasSeries = !(meta.pollSeries?.isEmpty ?? true)
						
						if hasSeries {
							PoliticianWidget(metadata: meta, cardId: card.id, height: widgetHeight, style: .bar)
								.frame(height: widgetHeight, alignment: .top)
								.widgetSwapEffect(id: card.id)
						} else {
							let subtitle = [meta.locale, meta.party]
								.compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
								.filter { !$0.isEmpty }
								.joined(separator: " • ")
								.capitalized
							
							PoliticianPreview(
								name: meta.name ?? "",
								subtitle: subtitle,
								headshot: meta.imageURL.flatMap(URL.init),
								externalURL: meta.officialURL.flatMap(URL.init),
								style: .bar,
								height: widgetHeight
							)
							.frame(maxWidth: .infinity)
							.frame(height: widgetHeight, alignment: .top)
							.widgetSwapEffect(id: card.id)
						}
					} else {
						EmptyView()
					}
					
				case .athlete:
					AthleteWidget(metadata: card.enrichedMetadata?.athleteMetadata, cardId: card.id, height: widgetHeight)
						.frame(height: widgetHeight, alignment: .top)
						.widgetSwapEffect(id: card.id)
					
				case .team:
					TeamWidget(metadata: card.enrichedMetadata?.teamMetadata, cardId: card.id, height: widgetHeight)
						.frame(height: widgetHeight, alignment: .top)
						.widgetSwapEffect(id: card.id)
				}
			} else if hasHeroImage {
				ImageWidget(card: card, height: widgetHeight)
					.frame(height: widgetHeight, alignment: .top)
					.widgetSwapEffect(id: card.id)
			} else if canRenderPerson || hasPoliticianFallback || hasStockFallback {
				if canRenderPerson, let person = personMeta {
					PersonWidget(
						metadata: person,
						cardId: card.id,
						height: widgetHeight,
						style: .bar
					)
					.frame(height: widgetHeight, alignment: .top)
					.widgetSwapEffect(id: card.id)
				} else if hasPoliticianFallback, let meta = politicianMeta {
					let subtitle = [meta.locale, meta.party]
						.compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
						.filter { !$0.isEmpty }
						.joined(separator: " • ")
						.capitalized
					
					PoliticianPreview(
						name: meta.name ?? "",
						subtitle: subtitle,
						headshot: meta.imageURL.flatMap(URL.init),
						externalURL: meta.officialURL.flatMap(URL.init),
						style: .bar,
						height: widgetHeight
					)
					.frame(maxWidth: .infinity)
					.frame(height: widgetHeight, alignment: .top)
					.widgetSwapEffect(id: card.id)
				} else if hasStockFallback, let meta = stockMeta {
					StockWidget(metadata: meta, cardId: card.id)
						.frame(height: widgetHeight, alignment: .top)
						.widgetSwapEffect(id: card.id)
				} else {
					if bubbleFallback {
						CardBubble(
							headline: card.headline ?? "",
							bodyText: ""
						)
						.frame(height: widgetHeight, alignment: .top)
						.widgetSwapEffect(id: card.id)
						.onAppear {
							var params: [String: Any] = [
								"screen": "curator" as NSString,
								"source": "voice_header" as NSString
							]
							params["card_id"] = card.id as NSString
							Analytics.logEvent("curator_voice_header_bubble_fallback", parameters: params)
						}
					} else {
						EmptyView()
					}
				}
			} else {
				if bubbleFallback {
					CardBubble(
						headline: card.headline ?? "",
						bodyText: ""
					)
					.frame(height: widgetHeight, alignment: .top)
					.widgetSwapEffect(id: card.id)
					.onAppear {
						var params: [String: Any] = [
							"screen": "curator" as NSString,
							"source": "voice_header" as NSString
						]
						params["card_id"] = card.id as NSString
						Analytics.logEvent("curator_voice_header_bubble_fallback", parameters: params)
					}
				} else {
					EmptyView()
				}
			}
		}
	}
	
	private static func sportIconName(from sportRaw: String?) -> String {
		guard let sport = sportRaw?.lowercased().trimmingCharacters(in: .whitespacesAndNewlines),
			  !sport.isEmpty else {
			return "trophy.fill"
		}
		switch sport {
		case "soccer", "association football", "futbol", "fútbol":
			return "soccerball.inverse"
		case "basketball", "nba":
			return "basketball.fill"
		case "american football", "football", "nfl", "cfb", "college football":
			return "football.fill"
		case "baseball", "mlb", "npb", "kbo":
			return "baseball.fill"
		case "tennis", "atp", "wta":
			return "tennis.racket"
		case "volleyball":
			return "volleyball.fill"
		case "cricket", "cricket ball", "ipl", "t20", "odi", "test cricket":
			return "cricket.ball.fill"
		case "hockey", "ice hockey", "nhl":
			return "hockey.puck.fill"
		case "golf", "pga", "lpga", "the open":
			return "flag.fill"
		case "rugby", "rugby union", "rugby league", "super rugby", "six nations":
			return "football.fill"
		case "boxing", "boxer", "mma", "ufc", "mixed martial arts", "wrestling":
			return "trophy.fill"
		case "gymnastics", "artistic gymnastics", "rhythmic gymnastics", "trampoline":
			return "trophy.fill"
		case "cycling", "road cycling", "tour de france", "giro", "vuelta", "bmx":
			return "bicycle"
		case "track", "athletics", "track and field", "marathon":
			return "stopwatch.fill"
		case "weightlifting", "powerlifting", "strongman", "crossfit":
			return "dumbbell.fill"
		case "esports", "e-sports", "e sport", "gaming":
			return "gamecontroller.fill"
		case "motorsport", "auto racing", "motor racing", "grand prix", "gp",
			"formula 1", "formula one", "f1", "formula-1", "f-1",
			"formula e", "formula-e", "fe",
			"f2", "formula 2", "formula two", "f3", "formula 3", "formula three",
			"indycar", "indycars", "indy car", "indy 500",
			"nascar",
			"motogp", "moto gp", "moto2", "moto3", "superbike", "wsbk",
			"wec", "world endurance", "endurance", "lemans", "le mans", "imsa",
			"wrc", "rally", "rallycross":
			return "steeringwheel"
		default:
			return "trophy.fill"
		}
	}
}

// ─────────── Section Header ───────────
private struct CuratorBubbleFallbackKey: EnvironmentKey {
	static let defaultValue: Bool = false
}

extension EnvironmentValues {
	var curatorBubbleFallbackEnabled: Bool {
		get { self[CuratorBubbleFallbackKey.self] }
		set { self[CuratorBubbleFallbackKey.self] = newValue }
	}
}

extension View {
	func widgetSwapEffect(id idValue: String) -> some View {
		self
			.id(idValue)
			.animation(nil, value: idValue)
			.transaction { $0.disablesAnimations = true }
	}
}
