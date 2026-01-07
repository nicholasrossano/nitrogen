import SwiftUI
import SafariServices
import FirebaseAnalytics
import SDWebImageSwiftUI

struct ResearchWidget: View {
	let entity: CoreEntity
	let cardId: String?
	let height: CGFloat?
	let style: Style
	let screen: String?
	let topicId: String?
	let metadata: ResearchMetadata?
	let images: [ResearchMetadata.ImageAsset]?
	
	enum Style { case bubble, bar }
	
	@Environment(\.colorScheme) private var colorScheme
	@State private var safariURL: URL?
	@State private var articleChartAspectRatio: CGFloat?
	@State private var coverImageLoadFailed: Bool = false
	@State private var figureCaptionMeasuredHeight: CGFloat = 0
	
	// ─────────── Section Title ───────────
	private static let bubbleCorner: CGFloat = 20
	private static let barCornerTop: CGFloat = 10
	private static let bubbleHeight: CGFloat = 200
	private static let genericCoverFilename = "generic-cover.png"
	
	// ─────────── Section Title ───────────
	private struct FigureCaptionHeightKey: PreferenceKey {
		static var defaultValue: CGFloat = 0
		static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
			value = nextValue()
		}
	}
	
	init(
		entity: CoreEntity,
		cardId: String? = nil,
		height: CGFloat? = nil,
		style: Style = .bar,
		screen: String? = nil,
		topicId: String? = nil,
		metadata: ResearchMetadata? = nil,
		images: [ResearchMetadata.ImageAsset]? = nil
	) {
		self.entity   = entity
		self.cardId   = cardId
		self.height   = height
		self.style    = style
		self.screen   = screen
		self.topicId  = topicId
		self.metadata = metadata
		self.images   = images ?? metadata?.images
	}
	
	// ─────────── Section Title ───────────
	private func cleanedJournalName(_ name: String) -> String {
		name.replacingOccurrences(of: "\\s*\\([^)]*\\)", with: "", options: .regularExpression)
	}
	
	private func cleanedTitleText(_ raw: String?) -> String {
		guard let raw else { return "No title" }
		var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
		if text.isEmpty { return "No title" }
		
		// Strip any HTML tags the feed may include.
		text = text.replacingOccurrences(of: #"(?s)<[^>]+>"#, with: "", options: .regularExpression)
		
		// Decode a few common entities to avoid showing code-looking characters.
		text = text.replacingOccurrences(of: "&amp;", with: "&")
		text = text.replacingOccurrences(of: "&lt;", with: "<")
		text = text.replacingOccurrences(of: "&gt;", with: ">")
		text = text.replacingOccurrences(of: "&quot;", with: "\"")
		text = text.replacingOccurrences(of: "&#39;", with: "'")
		text = text.replacingOccurrences(of: "&apos;", with: "'")
		text = text.replacingOccurrences(of: "&#x27;", with: "'")
		text = text.replacingOccurrences(of: "&#x2019;", with: "'")
		text = text.replacingOccurrences(of: "&#8217;", with: "'")
		text = text.replacingOccurrences(of: "&rsquo;", with: "'")
		text = text.replacingOccurrences(of: "&lsquo;", with: "'")
		text = text.replacingOccurrences(of: "&nbsp;", with: " ")
		
		let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
		return trimmed.isEmpty ? "No title" : trimmed
	}
	
	private func secureURL(from raw: String?) -> URL? {
		guard let raw else { return nil }
		var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
		if s.isEmpty { return nil }
		if s.hasPrefix("http://") {
			s = s.replacingOccurrences(of: "http://", with: "https://")
		}
		return URL(string: s)
	}
	
	private func isGenericCoverURL(_ url: URL) -> Bool {
		let abs = url.absoluteString.lowercased()
		if abs.contains("/\(Self.genericCoverFilename)") { return true }
		if url.lastPathComponent.lowercased() == Self.genericCoverFilename { return true }
		return false
	}
	
	private func extractSizeHints(from urlString: String) -> (w: Int?, h: Int?) {
		var w: Int?
		var h: Int?
		
		if let comps = URLComponents(string: urlString) {
			let items = comps.queryItems ?? []
			for item in items {
				let key = item.name.lowercased()
				let val = item.value ?? ""
				if w == nil, (key == "w" || key == "width"), let n = Int(val) { w = n }
				if h == nil, (key == "h" || key == "height"), let n = Int(val) { h = n }
			}
		}
		
		if w == nil || h == nil {
			let lower = urlString.lowercased()
			let pattern = #"(\d{2,5})\s*x\s*(\d{2,5})"#
			if let re = try? NSRegularExpression(pattern: pattern, options: []) {
				let range = NSRange(location: 0, length: (lower as NSString).length)
				if let m = re.firstMatch(in: lower, options: [], range: range),
				   m.numberOfRanges >= 3 {
					let wStr = (lower as NSString).substring(with: m.range(at: 1))
					let hStr = (lower as NSString).substring(with: m.range(at: 2))
					if w == nil { w = Int(wStr) }
					if h == nil { h = Int(hStr) }
				}
			}
		}
		
		return (w, h)
	}
	
	private func bestLandscapeImageURL(from assets: [ResearchMetadata.ImageAsset]?) -> URL? {
		guard let assets, !assets.isEmpty else { return nil }
		
		let candidates: [(url: URL, w: Int?, h: Int?)] = assets.compactMap { asset in
			guard let u = secureURL(from: asset.url) else { return nil }
			let hints = extractSizeHints(from: u.absoluteString)
			return (u, hints.w, hints.h)
		}
		
		if candidates.isEmpty { return nil }
		
		let landscapes = candidates.filter { c in
			guard let w = c.w, let h = c.h else { return false }
			return w >= h
		}
		let pool = landscapes.isEmpty ? candidates : landscapes
		
		let sorted = pool.sorted { a, b in
			let aPixels = (a.w ?? 0) * (a.h ?? 0)
			let bPixels = (b.w ?? 0) * (b.h ?? 0)
			if aPixels != bPixels { return aPixels > bPixels }
			if (a.w ?? 0) != (b.w ?? 0) { return (a.w ?? 0) > (b.w ?? 0) }
			return a.url.absoluteString.count > b.url.absoluteString.count
		}
		
		return sorted.first?.url
	}
	
	private func normalizedImageKey(_ raw: String) -> String {
		guard var comps = URLComponents(string: raw) else { return raw }
		comps.query = nil
		comps.fragment = nil
		return comps.string ?? raw
	}
	
	private func figureCaptionText(for url: URL?) -> String? {
		guard let url else { return nil }
		let key = normalizedImageKey(url.absoluteString)
		
		guard let asset = images?.first(where: { normalizedImageKey(($0.url ?? "").trimmingCharacters(in: .whitespacesAndNewlines)) == key }) else {
			return nil
		}
		
		let caption = (asset.caption ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		let credit  = (asset.credit ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		
		let parts = [caption.isEmpty ? nil : caption, credit.isEmpty ? nil : credit].compactMap { $0 }
		if parts.isEmpty { return nil }
		return parts.joined(separator: " — ")
	}
	
	private func aspectRatioHint(for url: URL?) -> CGFloat? {
		guard let url else { return nil }
		let key = normalizedImageKey(url.absoluteString)
		guard let asset = images?.first(where: { normalizedImageKey(($0.url ?? "").trimmingCharacters(in: .whitespacesAndNewlines)) == key }) else {
			return nil
		}
		guard let raw = asset.url else { return nil }
		let hints = extractSizeHints(from: raw)
		guard let w = hints.w, let h = hints.h, h > 0 else { return nil }
		return CGFloat(w) / CGFloat(h)
	}
	
	private var coverURL: URL? {
		guard let u = secureURL(from: metadata?.journalCoverURL) else { return nil }
		if isGenericCoverURL(u) { return nil }
		return u
	}
	
	private var articleImageURL: URL? {
		bestLandscapeImageURL(from: images)
	}
	
	private var titleText: String {
		cleanedTitleText(entity.title ?? entity.name)
	}
	
	var body: some View {
		let fixedHeight = height ?? (style == .bubble ? Self.bubbleHeight : nil)
		let hasCover = (coverURL != nil && !coverImageLoadFailed)
		
		Group {
			if hasCover {
				journalCoverModeView
			} else if articleImageURL != nil {
				articleImageModeView
			} else {
				textModeView
			}
		}
		.frame(height: fixedHeight)
		.id(cardId)
		.overlay(InteractiveFrameReader())
		.transaction { $0.disablesAnimations = true }
		.onChange(of: metadata?.journalCoverURL) { _ in
			coverImageLoadFailed = false
		}
	}
	
	// ─────────── Section Title ───────────
	private var journalCoverModeView: some View {
		GeometryReader { geo in
			let bubbleShape = RoundedCorner(radius: Self.bubbleCorner, corners: .allCorners)
			let barShape    = RoundedCorner(radius: Self.barCornerTop, corners: [.topLeft, .topRight])
			let anyShape: AnyShape = (style == .bubble) ? AnyShape(bubbleShape) : AnyShape(barShape)
			
			let pad: CGFloat = 20
			let coverH = max(0, geo.size.height - pad * 2)
			let coverW = coverH * 2 / 3
			
			HStack(spacing: 20) {
				if let u = coverURL {
					WebImage(url: u)
						.onFailure { _ in
							coverImageLoadFailed = true
						}
						.resizable()
						.scaledToFill()
						.frame(width: coverW, height: coverH)
						.clipShape(RoundedRectangle(cornerRadius: 20))
						.contentShape(Rectangle())
						.allowsHitTesting(false)
						.onAppear {
							Analytics.logEvent("research_cover_request", parameters: [
								"card_id": (cardId ?? "") as NSString,
								"topic_id": (topicId ?? "") as NSString,
								"screen": (screen ?? "research_widget") as NSString,
								"trigger": "render" as NSString
							])
						}
				}
				
				VStack(alignment: .leading, spacing: 2) {
					Spacer(minLength: 0)
					
					Text(titleText)
						.font(.headline)
						.foregroundColor(.white)
						.lineLimit(3)
					
					if let authors = entity.authors, !authors.isEmpty {
						Text(authors.joined(separator: ", "))
							.font(.subheadline)
							.foregroundColor(.white.opacity(0.85))
							.lineLimit(3)
					}
					
					Spacer(minLength: 0)
				}
				
				Spacer(minLength: 0)
			}
			.padding(.all, pad)
			.frame(width: geo.size.width, height: geo.size.height)
			.background {
				ZStack {
					if let u = coverURL {
						ArtworkWave(url: u, shape: anyShape)
					}
					Color.black.opacity(colorScheme == .dark ? 0.25 : 0.35)
				}
			}
			.clipShape(anyShape)
			.overlay(anyShape.stroke(Color.white.opacity(0.25), lineWidth: 0.5))
			.shadow(color: .black.opacity(0.2), radius: 6, x: 0, y: 4)
			.contentShape(anyShape)
		}
		.onTapGesture { openArticle() }
		.contextMenu { Button("Open Article") { openArticle() } } preview: {
			if let link = entity.url, let url = URL(string: link) { SafariView(url: url) } else { Text("Unable to preview").padding() }
		}
		.sheet(item: $safariURL) { url in SafariView(url: url) }
	}
	
	// ─────────── Section Title ───────────
	private var articleImageModeView: some View {
		GeometryReader { geo in
			let bubbleShape = RoundedCorner(radius: Self.bubbleCorner, corners: .allCorners)
			let barShape    = RoundedCorner(radius: Self.barCornerTop, corners: [.topLeft, .topRight])
			let anyShape: AnyShape = (style == .bubble) ? AnyShape(bubbleShape) : AnyShape(barShape)
			
			let u = articleImageURL
			let captionText = figureCaptionText(for: u)
			
			let outerPad: CGFloat = 10
			let captionGap: CGFloat = (captionText == nil ? 0 : 6)
			let effectiveCaptionH: CGFloat = (captionText == nil ? 0 : max(0, figureCaptionMeasuredHeight))
			
			let availableW = max(0, geo.size.width - outerPad * 2)
			let availableH = max(0, geo.size.height - outerPad * 2 - captionGap - effectiveCaptionH)
			
			let ratio = max(0.01, (articleChartAspectRatio ?? aspectRatioHint(for: u) ?? 1.0))
			let naturalW = availableH * ratio
			let chartW = min(availableW, naturalW)
			let shouldCrop = naturalW > (availableW + 0.5)
			
			let chartShape = RoundedRectangle(cornerRadius: 25, style: .continuous)
			
			VStack(spacing: captionGap) {
				HStack(spacing: 0) {
					Spacer(minLength: 0)
					
					Group {
						if shouldCrop {
							WebImage(url: u)
								.onSuccess { image, _, _ in
									let w = image.size.width
									let h = image.size.height
									guard h > 0 else { return }
									let r = w / h
									DispatchQueue.main.async {
										let current = articleChartAspectRatio ?? 0
										if abs(current - r) > 0.01 {
											articleChartAspectRatio = r
										}
									}
								}
								.resizable()
								.scaledToFill()
								.frame(width: chartW, height: availableH)
								.clipped()
								.allowsHitTesting(false)
								.onAppear {
									Analytics.logEvent("research_article_image_request", parameters: [
										"card_id": (cardId ?? "") as NSString,
										"topic_id": (topicId ?? "") as NSString,
										"screen": (screen ?? "research_widget") as NSString,
										"trigger": "render" as NSString
									])
								}
						} else {
							WebImage(url: u)
								.onSuccess { image, _, _ in
									let w = image.size.width
									let h = image.size.height
									guard h > 0 else { return }
									let r = w / h
									DispatchQueue.main.async {
										let current = articleChartAspectRatio ?? 0
										if abs(current - r) > 0.01 {
											articleChartAspectRatio = r
										}
									}
								}
								.resizable()
								.scaledToFit()
								.frame(width: chartW, height: availableH)
								.allowsHitTesting(false)
								.onAppear {
									Analytics.logEvent("research_article_image_request", parameters: [
										"card_id": (cardId ?? "") as NSString,
										"topic_id": (topicId ?? "") as NSString,
										"screen": (screen ?? "research_widget") as NSString,
										"trigger": "render" as NSString
									])
								}
						}
					}
					.background(.ultraThinMaterial, in: chartShape)
					.clipShape(chartShape)
					.overlay(chartShape.stroke(Color.accentSecondary, lineWidth: 0.5))
					
					Spacer(minLength: 0)
				}
				.frame(height: availableH)
				
				if let captionText {
					Text(captionText)
						.font(.caption2)
						.foregroundColor(Color.primary.opacity(0.75))
						.multilineTextAlignment(.center)
						.lineLimit(2)
						.truncationMode(.tail)
						.fixedSize(horizontal: false, vertical: true)
						.padding(.horizontal, 8)
						.background(
							GeometryReader { proxy in
								Color.clear.preference(key: FigureCaptionHeightKey.self, value: proxy.size.height)
							}
						)
						.onPreferenceChange(FigureCaptionHeightKey.self) { newValue in
							if abs(figureCaptionMeasuredHeight - newValue) > 0.5 {
								figureCaptionMeasuredHeight = newValue
							}
						}
						.frame(maxWidth: .infinity)
				}
			}
			.padding(.all, outerPad)
			.frame(width: geo.size.width, height: geo.size.height)
			.background(alignment: .center) {
				if let u {
					WebImage(url: u)
						.resizable()
						.aspectRatio(contentMode: .fill)
						.frame(width: geo.size.width * 3,
							   height: geo.size.height * 8)
						.blur(radius: 70)
						.saturation(1.8)
						.brightness(-0.08)
						.opacity(0.5)
						.blendMode(.screen)
						.allowsHitTesting(false)
						.clipShape(anyShape)
						.drawingGroup()
				}
			}
			.background(
				.ultraThinMaterial,
				in: anyShape
			)
			.overlay(anyShape.stroke(Color.white.opacity(0.7), lineWidth: 0.5))
			.clipShape(anyShape)
			.shadow(color: .black.opacity(0.15), radius: 4, x: 0, y: 3)
			.contentShape(anyShape)
		}
		.onTapGesture { openArticle() }
		.contextMenu { Button("Open Article") { openArticle() } } preview: {
			if let link = entity.url, let url = URL(string: link) { SafariView(url: url) } else { Text("Unable to preview").padding() }
		}
		.sheet(item: $safariURL) { url in SafariView(url: url) }
	}
	
	// ─────────── Section Title ───────────
	private var textModeView: some View {
		GeometryReader { geo in
			let titleFontSize      = geo.size.width * 0.04
			let textColor          = Color.primary
			let secondaryTextColor = Color.primary.opacity(0.8)
			let tertiaryTextColor  = Color.primary.opacity(0.8)
			
			let bubbleShape = RoundedCorner(radius: Self.bubbleCorner, corners: .allCorners)
			let barShape    = RoundedCorner(radius: Self.barCornerTop, corners: [.topLeft, .topRight])
			let anyShape: AnyShape = (style == .bubble) ? AnyShape(bubbleShape) : AnyShape(barShape)
			
			ZStack(alignment: .topLeading) {
				anyShape
					.fill(.thinMaterial)
					.clipShape(anyShape)
					.overlay(anyShape.stroke(Color.primary.opacity(0.15), lineWidth: 0.5))
					.shadow(color: .black.opacity(0.2), radius: 6, x: 0, y: 4)
				
				VStack(alignment: .leading, spacing: 8) {
					if let journal = entity.journal {
						HStack(alignment: .top, spacing: 8) {
							Image(systemName: "newspaper.fill")
								.font(.system(size: titleFontSize * 0.95))
								.foregroundColor(Color.accentPrimary)
							
							Text(cleanedJournalName(journal))
								.font(.custom("Avenir", size: titleFontSize * 0.95))
								.foregroundColor(tertiaryTextColor)
								.lineLimit(2)
								.fixedSize(horizontal: false, vertical: true)
						}
					}
					
					Text(titleText)
						.font(.headline)
						.foregroundColor(textColor)
						.lineLimit(4)
						.fixedSize(horizontal: false, vertical: true)
					
					if let authors = entity.authors, !authors.isEmpty {
						Text(authors.joined(separator: ", "))
							.font(.custom("Avenir", size: titleFontSize * 0.8))
							.italic()
							.foregroundColor(secondaryTextColor)
							.lineLimit(3)
							.fixedSize(horizontal: false, vertical: true)
					}
					
					Spacer()
				}
				.padding(EdgeInsets(top: 24, leading: 16, bottom: 24, trailing: 16))
				.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
			}
			.frame(width: geo.size.width, height: geo.size.height)
			.contentShape(anyShape)
		}
		.onTapGesture { openArticle() }
		.contextMenu { Button("Open Article") { openArticle() } } preview: {
			if let link = entity.url, let url = URL(string: link) { SafariView(url: url) } else { Text("Unable to preview").padding() }
		}
		.sheet(item: $safariURL) { url in SafariView(url: url) }
	}
	
	// ─────────── Section Title ───────────
	private func openArticle() {
		guard let link = entity.url, let url = URL(string: link) else { return }
		var params: [String: Any] = [:]
		params["screen"]   = (screen ?? "") as NSString
		params["card_id"]  = (cardId ?? "") as NSString
		params["topic_id"] = (topicId ?? "") as NSString
		Analytics.logEvent("research_open", parameters: params)
		safariURL = url
	}
}
