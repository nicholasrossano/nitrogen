import SwiftUI
import SDWebImageSwiftUI
import Charts

struct CardPreviewThumbnailView: View {
	enum Chrome { case rounded, none }
	enum RenderMode { case share, shelfForeground }
	
	let card: Card
	let fallbackHeadline: String
	let renderMode: RenderMode
	let chrome: Chrome
	
	@State private var artworkCandidates: [URL] = []
	@State private var artworkCandidateIndex = 0
	@State private var artworkURL: URL?
	
	init(
		card: Card,
		fallbackHeadline: String,
		renderMode: RenderMode = .share,
		chrome: Chrome = .rounded
	) {
		self.card = card
		self.fallbackHeadline = fallbackHeadline
		self.renderMode = renderMode
		self.chrome = chrome
	}
	
	private var showPlayableGlyphs: Bool {
		renderMode != .shelfForeground
	}
	
	private var normalizedCoreType: String {
		(card.enrichedMetadata?.coreEntity?.type ?? "")
			.lowercased()
			.replacingOccurrences(of: "_", with: "")
			.replacingOccurrences(of: "-", with: "")
			.replacingOccurrences(of: " ", with: "")
	}
	
	private var wantsFullBleedArtworkInShelf: Bool {
		renderMode == .shelfForeground
		&& (normalizedCoreType == "music" || normalizedCoreType == "book" || normalizedCoreType == "filmtv")
	}
	
	private var choice: WidgetManager.ShareThumbnailChoice {
		if renderMode == .shelfForeground {
			return WidgetManager.previewThumbnailChoice(for: card)
		}
		return WidgetManager.shareThumbnailChoice(for: card)
	}
	
	private var playableFlags: (hasPlayable: Bool, isVideo: Bool) {
		guard let enriched = card.enrichedMetadata else { return (false, false) }
		
		if let music = enriched.musicMetadata {
			if music.videoURL != nil { return (true, true) }
			if music.previewURL != nil { return (true, false) }
		}
		
		if let film = enriched.filmTvMetadata {
			if let trailer = film.trailerURL?.trimmingCharacters(in: .whitespacesAndNewlines),
			   !trailer.isEmpty {
				return (true, true)
			}
		}
		
		return (false, false)
	}
	
	private var text: (title: String, subtitle: String?) {
		shareWidgetContent(for: card, fallbackHeadline: fallbackHeadline)
	}
	
	private func isSharePreviewURLValid(_ url: URL) -> Bool {
		if url.isFileURL { return true }
		guard let scheme = url.scheme?.lowercased() else { return false }
		return scheme == "http" || scheme == "https"
	}
	
	private func safeURL(_ url: URL?) -> URL? {
		guard let url else { return nil }
		return isSharePreviewURLValid(url) ? url : nil
	}
	
	private func resetArtworkCandidates() {
		var urls = card.shareArtworkURLs().filter(isSharePreviewURLValid)
		
		if let book = card.enrichedMetadata?.bookMetadata {
			let bookCandidates = book.coverURLCandidates().filter(isSharePreviewURLValid)
			if let first = urls.first, bookCandidates.contains(first) {
				var merged = bookCandidates
				for url in urls where !merged.contains(url) {
					merged.append(url)
				}
				urls = merged
			}
		}
		
		artworkCandidates = urls
		artworkCandidateIndex = 0
		artworkURL = urls.first
	}
	
	private func recordBookCoverFailureIfNeeded(_ url: URL?) {
		guard let url, let book = card.enrichedMetadata?.bookMetadata else { return }
		if book.coverURLCandidates().contains(url) {
			book.recordCoverFailure(url)
		}
	}
	
	private func advanceArtworkCandidate() {
		let nextIndex = artworkCandidateIndex + 1
		guard nextIndex < artworkCandidates.count else {
			artworkURL = nil
			return
		}
		artworkCandidateIndex = nextIndex
		artworkURL = artworkCandidates[nextIndex]
	}
	
	var body: some View {
		let hasPlayableMedia = showPlayableGlyphs ? playableFlags.hasPlayable : false
		
		let content: AnyView = {
			switch choice {
			case .stockChart(let metadata):
				return AnyView(StockShareThumbnailChartView(metadata: metadata, headline: fallbackHeadline))
			case .politicianPoll(let name, let points):
				return AnyView(PoliticianShareThumbnailPollView(name: name, points: points, headline: fallbackHeadline))
			case .headerImage(let url):
				return AnyView(HeaderImageRemoteView(url: safeURL(url), hasPlayableMedia: hasPlayableMedia, renderMode: renderMode))
			case .heroImage(let url):
				return AnyView(HeaderImageRemoteView(url: safeURL(url), hasPlayableMedia: hasPlayableMedia, renderMode: renderMode))
			case .artwork:
				if renderMode == .shelfForeground, wantsFullBleedArtworkInShelf, let url = artworkURL {
					return AnyView(FullBleedRemoteImageView(
						url: url,
						onFailure: {
							recordBookCoverFailureIfNeeded(url)
							advanceArtworkCandidate()
						}
					))
				}
				
				if renderMode == .shelfForeground {
					return AnyView(ShareWidgetForegroundOnlyView(
						artworkURL: artworkURL,
						title: text.title,
						subtitle: text.subtitle,
						hasPlayableMedia: hasPlayableMedia,
						onFailure: {
							recordBookCoverFailureIfNeeded(artworkURL)
							advanceArtworkCandidate()
						}
					))
				} else {
					return AnyView(ShareWidgetShareStyleView(
						artworkURL: artworkURL,
						title: text.title,
						subtitle: text.subtitle,
						hasPlayableMedia: hasPlayableMedia,
						fallbackHeadline: fallbackHeadline,
						onFailure: {
							recordBookCoverFailureIfNeeded(artworkURL)
							advanceArtworkCandidate()
						}
					))
				}
			case .none:
				if renderMode == .shelfForeground, normalizedCoreType == "research" {
					let entity = card.enrichedMetadata?.coreEntity
					let title = (entity?.title ?? entity?.name ?? fallbackHeadline).trimmingCharacters(in: .whitespacesAndNewlines)
					return AnyView(ResearchFallbackThumbnailView(
						journal: entity?.journal,
						title: title.isEmpty ? fallbackHeadline : title,
						authors: entity?.authors
					))
				}
				
				if renderMode == .shelfForeground {
					return AnyView(Color.clear)
				} else {
					return AnyView(FallbackHeadlineThumbnailView(headline: fallbackHeadline))
				}
			}
		}()
		
		let resolvedContent = content
			.onAppear(perform: resetArtworkCandidates)
			.onChange(of: card.id) { _ in resetArtworkCandidates() }
		
		switch chrome {
		case .none:
			return AnyView(resolvedContent)
		case .rounded:
			return AnyView(
				resolvedContent
					.clipShape(RoundedRectangle(cornerRadius: 30))
					.overlay(
						RoundedRectangle(cornerRadius: 30)
							.stroke(Color.primary.opacity(0.10), lineWidth: 0.8)
					)
			)
		}
	}
}

// ─────────── Full-bleed image (shelf-only) ───────────

private struct FullBleedRemoteImageView: View {
	let url: URL
	let onFailure: () -> Void
	
	var body: some View {
		GeometryReader { geo in
			WebImage(url: url)
				.onFailure { _ in onFailure() }
				.resizable()
				.scaledToFill()
				.frame(width: geo.size.width, height: geo.size.height, alignment: .top)
				.clipped()
		}
	}
}

// ─────────── Header image (NO overlays ever) ───────────

private struct HeaderImageRemoteView: View {
	let url: URL?
	let hasPlayableMedia: Bool
	let renderMode: CardPreviewThumbnailView.RenderMode
	
	var body: some View {
		GeometryReader { geo in
			let size = geo.size
			let playIconSize = max(size.height * 0.18, 18)
			
			ZStack {
				if let url {
					WebImage(url: url)
						.resizable()
						.scaledToFill()
						.frame(width: size.width, height: size.height)
						.clipped()
				} else {
					Color.clear
				}
				
				if hasPlayableMedia {
					Image(systemName: "play.fill")
						.resizable()
						.scaledToFit()
						.frame(width: playIconSize, height: playIconSize)
						.foregroundColor(.white)
						.shadow(radius: 4)
						.opacity(0.95)
				}
			}
			.frame(width: size.width, height: size.height)
		}
	}
}

// ─────────── Research fallback (shelf-only) ───────────

private struct ResearchFallbackThumbnailView: View {
	let journal: String?
	let title: String
	let authors: [String]?
	
	private func cleanedJournalName(_ name: String) -> String {
		name.replacingOccurrences(of: "\\s*\\([^)]*\\)", with: "", options: .regularExpression)
	}
	
	var body: some View {
		GeometryReader { geo in
			let titleFontSize = min(geo.size.width * 0.1, 18)
			let textColor = Color.primary
			let secondaryTextColor = Color.primary.opacity(0.8)
			let tertiaryTextColor = Color.primary.opacity(0.8)
			
			ZStack {
				Rectangle()
					.fill(Color(.systemBackground).opacity(0.75))
				
				VStack(alignment: .leading, spacing: 8) {
					if let journal, !journal.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
						HStack(alignment: .top, spacing: 8) {
							Image(systemName: "newspaper.fill")
								.font(.system(size: titleFontSize * 0.8))
								.foregroundColor(Color.accentPrimary)
							
							Text(cleanedJournalName(journal))
								.font(.custom("Avenir", size: titleFontSize * 0.8))
								.foregroundColor(tertiaryTextColor)
								.lineLimit(1)
								.fixedSize(horizontal: false, vertical: true)
						}
					}
					
					Text(title)
						.font(.custom("Avenir", size: titleFontSize * 0.8))
						.foregroundColor(textColor)
						.lineLimit(3)
						.minimumScaleFactor(0.92)
						.allowsTightening(true)
						.fixedSize(horizontal: false, vertical: true)
					
					if let authors, !authors.isEmpty {
						Text(authors.joined(separator: ", "))
							.font(.custom("Avenir", size: titleFontSize * 0.7))
							.italic()
							.foregroundColor(secondaryTextColor)
							.lineLimit(1)
							.fixedSize(horizontal: false, vertical: true)
					}
					
					Spacer(minLength: 0)
				}
				.padding(EdgeInsets(top: 18, leading: 16, bottom: 18, trailing: 16))
			}
			.frame(width: geo.size.width, height: geo.size.height)
		}
	}
}

// ─────────── Share-style widget preview (share mode only) ───────────

private struct ShareWidgetShareStyleView: View {
	let artworkURL: URL?
	let title: String
	let subtitle: String?
	let hasPlayableMedia: Bool
	let fallbackHeadline: String
	let onFailure: () -> Void
	
	@Environment(\.colorScheme) private var scheme
	
	var body: some View {
		GeometryReader { geo in
			let size = geo.size
			let pad: CGFloat = max(14, size.width * 0.06)
			let baseFontSize = min(size.width, 520) * 0.065
			let playIconSize = max(size.height * 0.18, 18)
			
			ZStack {
				if let artworkURL {
					WebImage(url: artworkURL)
						.onFailure { _ in onFailure() }
						.resizable()
						.scaledToFill()
						.frame(width: size.width, height: size.height)
						.blur(radius: 80)
						.saturation(1.45)
						.brightness(-0.16)
						.opacity(0.98)
						.clipped()
					
					Rectangle()
						.fill(Color.black.opacity(scheme == .dark ? 0.2 : 0.1))
					
					HStack(spacing: pad) {
						ZStack {
							WebImage(url: artworkURL)
								.onFailure { _ in onFailure() }
								.resizable()
								.scaledToFill()
								.frame(width: size.width * 0.34, height: size.height - pad * 2)
								.clipped()
							
							if hasPlayableMedia {
								Image(systemName: "play.fill")
									.resizable()
									.scaledToFit()
									.frame(width: playIconSize, height: playIconSize)
									.foregroundColor(.white)
									.shadow(radius: 4)
									.opacity(0.95)
							}
						}
						.clipShape(RoundedRectangle(cornerRadius: 18))
						
						VStack(alignment: .leading, spacing: 4) {
							Text(title)
								.font(.system(size: baseFontSize, weight: .semibold))
								.foregroundColor(.white)
								.multilineTextAlignment(.leading)
								.lineLimit(2)
							
							if let subtitle, !subtitle.isEmpty {
								Text(subtitle)
									.font(.system(size: baseFontSize * 0.66, weight: .regular))
									.foregroundColor(.white.opacity(0.88))
									.multilineTextAlignment(.leading)
									.lineLimit(2)
							}
							
							Spacer(minLength: 0)
						}
						
						Spacer(minLength: 0)
					}
					.padding(.all, pad)
				} else {
					FallbackHeadlineThumbnailView(headline: fallbackHeadline)
				}
			}
			.frame(width: size.width, height: size.height)
		}
	}
}

// ─────────── Foreground-only widget preview (shelf mode) ───────────

private struct ShareWidgetForegroundOnlyView: View {
	let artworkURL: URL?
	let title: String
	let subtitle: String?
	let hasPlayableMedia: Bool
	let onFailure: () -> Void
	
	var body: some View {
		GeometryReader { geo in
			let size = geo.size
			let pad: CGFloat = max(14, size.width * 0.06)
			let baseFontSize = min(size.width, 520) * 0.065
			let playIconSize = max(size.height * 0.18, 18)
			
			if let artworkURL {
				HStack(spacing: pad) {
					ZStack {
						WebImage(url: artworkURL)
							.onFailure { _ in onFailure() }
							.resizable()
							.scaledToFill()
							.frame(width: size.width * 0.34, height: size.height - pad * 2)
							.clipped()
						
						if hasPlayableMedia {
							Image(systemName: "play.fill")
								.resizable()
								.scaledToFit()
								.frame(width: playIconSize, height: playIconSize)
								.foregroundColor(.white)
								.shadow(radius: 4)
								.opacity(0.95)
						}
					}
					.clipShape(RoundedRectangle(cornerRadius: 18))
					
					VStack(alignment: .leading, spacing: 4) {
						Text(title)
							.font(.system(size: baseFontSize, weight: .semibold))
							.foregroundColor(.white)
							.shadow(radius: 1.5)
							.multilineTextAlignment(.leading)
							.lineLimit(2)
						
						if let subtitle, !subtitle.isEmpty {
							Text(subtitle)
								.font(.system(size: baseFontSize * 0.66, weight: .regular))
								.foregroundColor(.white.opacity(0.86))
								.shadow(radius: 1.2)
								.multilineTextAlignment(.leading)
								.lineLimit(2)
						}
						
						Spacer(minLength: 0)
					}
					
					Spacer(minLength: 0)
				}
				.padding(.all, pad)
				.frame(width: size.width, height: size.height)
			} else {
				Color.clear.frame(width: size.width, height: size.height)
			}
		}
	}
}

// ─────────── Fallback ───────────

private struct FallbackHeadlineThumbnailView: View {
	let headline: String
	
	var body: some View {
		ZStack {
			LinearGradient(
				gradient: Gradient(colors: [
					Color.black.opacity(0.75),
					Color.black.opacity(0.55)
				]),
				startPoint: .topLeading,
				endPoint: .bottomTrailing
			)
			
			Text(headline.trimmingCharacters(in: .whitespacesAndNewlines))
				.font(.custom("Avenir", size: 16))
				.foregroundColor(.white)
				.multilineTextAlignment(.leading)
				.lineLimit(4)
				.padding(16)
				.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		}
	}
}

// ─────────── Stock chart thumbnail (dynamic) ───────────

private struct StockShareThumbnailChartView: View {
	let metadata: StockMetadata
	let headline: String
	
	@Environment(\.colorScheme) private var scheme
	
	private var points: [StockMetadata.DataPoint] {
		metadata.dataPoints?.filter { !$0.close.isNaN } ?? []
	}
	
	private var pctChange: Double? {
		guard let first = points.first,
			  let last  = points.last,
			  first.close != 0 else { return nil }
		return (last.close - first.close) / first.close * 100
	}
	
	private var yRange: ClosedRange<Double> {
		guard !points.isEmpty else { return 0...1 }
		let closes = points.map(\.close)
		let minV = closes.min() ?? 0
		let maxV = closes.max() ?? 1
		let pad  = (maxV - minV) * 0.01
		let low  = minV - pad
		let high = max(low + 0.01, maxV + pad)
		return low...high
	}
	
	private var changeColor: Color {
		guard let pct = pctChange else { return .primary }
		return pct >= 0 ? .green : .red
	}
	
	var body: some View {
		GeometryReader { geo in
			let size = geo.size
			
			ZStack {
				Rectangle()
					.fill(Color(.systemGray6))
					.overlay(
						Rectangle()
							.stroke(Color.primary.opacity(0.15), lineWidth: 0.5)
					)
				
				VStack(spacing: 6) {
					HStack {
						Text(metadata.ticker?.uppercased() ?? "")
							.font(.headline)
							.foregroundColor(.primary)
						Spacer()
						if let pct = pctChange {
							Text(String(format: "%.2f%%", pct))
								.font(.subheadline)
								.foregroundColor(changeColor)
						}
					}
					
					Chart {
						ForEach(points, id: \.date) { point in
							LineMark(
								x: .value("Date", point.date),
								y: .value("Close", point.close)
							)
							.interpolationMethod(.catmullRom)
							.foregroundStyle(changeColor)
						}
					}
					.chartYScale(domain: yRange)
					.chartXAxis(.hidden)
					.chartYAxis(.hidden)
				}
				.padding(16)
			}
			.frame(width: size.width, height: size.height)
		}
	}
}

// ─────────── Politician poll thumbnail (dynamic) ───────────

private struct PoliticianShareThumbnailPollView: View {
	let name: String
	let points: [PoliticianMetadata.PollPoint]
	let headline: String
	
	private struct Plot: Identifiable {
		let id = UUID()
		let date: Date
		let pct: Double
	}
	
	private static let isoFormatter: ISO8601DateFormatter = {
		let formatter = ISO8601DateFormatter()
		return formatter
	}()
	
	private var plots: [Plot] {
		let raw: [Plot] = points.compactMap { point in
			guard let dateString = point.date,
				  let date = Self.isoFormatter.date(from: dateString + "T00:00:00Z"),
				  let pct = point.pct else { return nil }
			return Plot(date: date, pct: pct)
		}
			.sorted { $0.date < $1.date }
		return raw
	}
	
	private var latest: Double { plots.last?.pct ?? 0 }
	private var changeColor: Color { .blue }
	
	private var yRange: ClosedRange<Double> {
		guard !plots.isEmpty else { return 0...1 }
		let values = plots.map(\.pct)
		let minV = values.min() ?? 0
		let maxV = values.max() ?? 1
		let span = maxV - minV
		let pad = max(span * 0.08, 1.0)
		let low = max(0, minV - pad)
		let high = min(100, maxV + pad)
		return low...max(low + 0.01, high)
	}
	
	var body: some View {
		GeometryReader { geo in
			let size = geo.size
			
			ZStack {
				Rectangle()
					.fill(Color(.systemGray6))
					.overlay(
						Rectangle()
							.stroke(Color.primary.opacity(0.15), lineWidth: 0.5)
					)
				
				VStack(spacing: 6) {
					HStack {
						Text(name.capitalized)
							.font(.headline)
							.foregroundColor(.primary)
						Spacer()
						Text(String(format: "%.0f%%", latest))
							.font(.subheadline)
							.foregroundColor(changeColor)
					}
					
					Chart {
						ForEach(plots) { plot in
							LineMark(
								x: .value("Date", plot.date),
								y: .value("Pct", plot.pct)
							)
							.interpolationMethod(.catmullRom)
							.foregroundStyle(changeColor)
						}
					}
					.chartYScale(domain: yRange)
					.chartXAxis(.hidden)
					.chartYAxis(.hidden)
				}
				.padding(16)
			}
			.frame(width: size.width, height: size.height)
		}
	}
}

// ─────────── Share-style text content ───────────

private func shareWidgetContent(for card: Card, fallbackHeadline: String) -> (title: String, subtitle: String?) {
	guard let enriched = card.enrichedMetadata else {
		let title = (fallbackHeadline.isEmpty ? (card.headline ?? "") : fallbackHeadline)
		return (title, card.domainName)
	}
	
	if let music = enriched.musicMetadata {
		let rawTitle = (music.song ?? music.album ?? card.headline ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		let rawArtist = music.artist?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		let title = rawTitle.isEmpty ? (card.headline ?? fallbackHeadline) : rawTitle
		let subtitle = rawArtist.isEmpty ? nil : rawArtist
		return (title, subtitle)
	}
	
	if let book = enriched.bookMetadata {
		let rawTitle = (book.title ?? card.headline ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		let title = rawTitle.isEmpty ? (card.headline ?? fallbackHeadline) : rawTitle
		let subtitle: String? = {
			guard let authors = book.authors, !authors.isEmpty else { return nil }
			let joined = authors.joined(separator: ", ").trimmingCharacters(in: .whitespacesAndNewlines)
			return joined.isEmpty ? nil : joined
		}()
		return (title, subtitle)
	}
	
	if let film = enriched.filmTvMetadata {
		var title = (film.title ?? card.headline ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		if title.isEmpty { title = card.headline ?? fallbackHeadline }
		title = title.trimmingCharacters(in: .whitespacesAndNewlines)
		
		var subtitleBits: [String] = []
		if let director = film.director?.trimmingCharacters(in: .whitespacesAndNewlines), !director.isEmpty {
			subtitleBits.append(director)
		}
		if let year = film.year?.trimmingCharacters(in: .whitespacesAndNewlines), !year.isEmpty {
			subtitleBits.append(year)
		}
		let subtitle = subtitleBits.isEmpty ? nil : subtitleBits.joined(separator: " • ")
		return (title, subtitle)
	}
	
	if let team = enriched.teamMetadata {
		let nameParts = [team.city, team.team]
			.compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
			.filter { !$0.isEmpty }
		let baseName = nameParts.isEmpty ? (team.team ?? "") : nameParts.joined(separator: " ")
		let title = baseName.trimmingCharacters(in: .whitespacesAndNewlines)
		let subtitle = [team.division, team.league]
			.compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
			.filter { !$0.isEmpty }
			.joined(separator: " • ")
		return (title.isEmpty ? (card.headline ?? fallbackHeadline) : title,
				subtitle.isEmpty ? nil : subtitle)
	}
	
	if let politician = enriched.politicianMetadata {
		let name = (politician.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		let subtitleBits = [politician.locale, politician.party]
			.compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
			.filter { !$0.isEmpty }
		let subtitle = subtitleBits.isEmpty ? nil : subtitleBits.joined(separator: " • ")
		let title = name.isEmpty ? (card.headline ?? fallbackHeadline) : name
		return (title, subtitle)
	}
	
	if let stock = enriched.stockMetadata {
		let name = (stock.companyName?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : $0 }
		?? (stock.ticker?.uppercased() ?? "")
		let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
		let subtitle = stock.companyIndustry?.trimmingCharacters(in: .whitespacesAndNewlines)
		return (trimmedName.isEmpty ? (card.headline ?? fallbackHeadline) : trimmedName,
				(subtitle?.isEmpty == false ? subtitle : nil))
	}
	
	let fallbackTitle = (card.headline ?? fallbackHeadline)
	return (fallbackTitle, card.domainName)
}
