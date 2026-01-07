// ActionCapsule.swift

import SwiftUI
import UIKit
import LinkPresentation
import SafariServices
import FirebaseAnalytics
import Charts
import FirebaseAuth
import FirebaseFirestore

struct ActionCapsule: View {
	let card     : Card
	let cardId   : String
	let topicId  : String
	let headline : String
	let topicName: String
	let sources  : [Source]
	
	@Binding var isBookmarked: Bool
	var updateBookmarkCache: ((String, Bool) -> Void)?
	
	@EnvironmentObject private var servicesLocator: AppServicesLocator
	@EnvironmentObject private var homeViewModel: HomeViewModel
	@EnvironmentObject private var onboarding: OnboardingManager
	@Environment(\.colorScheme) private var colorScheme
	@State private var showReportMenu  = false
	@State private var showSourcesList = false
	@State private var safariURL: URL?
	@State private var isDisliked: Bool = false
	@State private var showAdminConsole = false
	
	@State private var reportDetentFraction: CGFloat? = nil
	@State private var didLoadDislikeState: Bool = false
	
	private let db = Firestore.firestore()
	
	private var shareLinkTitle: String {
		if let dn = card.domainName?.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines),
		   !dn.isEmpty {
			return dn
		}
		let trimmedTopic = topicName.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
		if !trimmedTopic.isEmpty { return trimmedTopic }
		return "Foreword"
	}
	
	private var primaryShareHeadline: String {
		let trimmedHeadline = headline.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
		if !trimmedHeadline.isEmpty {
			return trimmedHeadline
		}
		if let cardHeadline = card.headline?.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines),
		   !cardHeadline.isEmpty {
			return cardHeadline
		}
		return shareLinkTitle
	}
	
	private var isAdmin: Bool {
		FeatureFlagsManager.shared.currentUserRole == "admin"
	}
	
	var body: some View {
		let size    = UIScreen.main.bounds.width * 0.08
		let imgSize = size * 0.40
		let cleanSources  = sources.deduplicated()
		let singleSource  = cleanSources.count == 1 ? cleanSources.first : nil
		let isSingle      = singleSource != nil
		
		let displayedBookmarked: Bool = {
			if let v = homeViewModel.bookmarkStatuses[cardId] { return v }
			return isBookmarked
		}()
		
		HStack(spacing: 0) {
			Button {
				UIImpactFeedbackGenerator(style: .light).impactOccurred()
				Analytics.logEvent("sources_tap", parameters: [
					"card_id": cardId as NSString,
					"topic_id": topicId as NSString,
					"screen": "home" as NSString
				])
				if let src = singleSource {
					openSingleSource(src)
				} else {
					showSourcesList = true
				}
			} label: {
				Text(isSingle ? "Source" : "Sources")
					.dynamicTypeSize(.medium ... .medium)
					.font(.custom("Avenir", size: imgSize * 0.9))
					.foregroundColor(.white)
					.frame(minWidth: size * 1.8, maxHeight: size)
			}
			.sheet(isPresented: $showSourcesList) {
				SourceListView(sources: cleanSources, cardId: cardId)
					.presentationDetents(dynDetents(for: cleanSources))
					.presentationCornerRadius(60)
					.presentationDragIndicator(.visible)
			}
			.sheet(item: $safariURL) { url in
				SafariView(url: url)
			}
			
			Divider()
				.frame(width: 1, height: size * 0.60)
				.background(Color.white.opacity(0.35))
				.padding(.vertical, size * 0.05)
			
			Button {
				UIImpactFeedbackGenerator(style: .light).impactOccurred()
				let wasLiked = displayedBookmarked
				let willLike = !wasLiked
				Analytics.logEvent("thumbs_up_tap", parameters: [
					"card_id": cardId as NSString,
					"topic_id": topicId as NSString,
					"screen": "home" as NSString,
					"will_like": NSNumber(value: willLike)
				])
				
				if isDisliked {
					isDisliked = false
					showReportMenu = false
					showAdminConsole = false
					Analytics.logEvent("dislike_remove", parameters: [
						"card_id": cardId as NSString,
						"topic_id": topicId as NSString,
						"screen": "home" as NSString
					])
					persistDislikeState(isDisliked: false)
				}
				
				Analytics.logEvent("bookmark_tap", parameters: [
					"card_id": cardId as NSString,
					"topic_id": topicId as NSString,
					"will_bookmark": NSNumber(value: willLike),
					"screen": "home" as NSString
				])
				toggleBookmark(current: wasLiked)
			} label: {
				Image(systemName: (homeViewModel.bookmarkStatuses[cardId] ?? isBookmarked) ? "hand.thumbsup.fill" : "hand.thumbsup")
					.font(.system(size: imgSize))
					.foregroundColor(.white)
					.frame(width: size, height: size)
			}
			
			Divider()
				.frame(width: 1, height: size * 0.60)
				.background(Color.white.opacity(0.35))
				.padding(.vertical, size * 0.05)
			
			Button {
				UIImpactFeedbackGenerator(style: .light).impactOccurred()
				let willDislike = !isDisliked
				let wasLiked = displayedBookmarked
				Analytics.logEvent("thumbs_down_tap", parameters: [
					"card_id": cardId as NSString,
					"topic_id": topicId as NSString,
					"screen": "home" as NSString,
					"will_dislike": NSNumber(value: willDislike)
				])
				
				if willDislike {
					isDisliked = true
					Analytics.logEvent("dislike_add", parameters: [
						"card_id": cardId as NSString,
						"topic_id": topicId as NSString,
						"screen": "home" as NSString
					])
					persistDislikeState(isDisliked: true)
					
					if wasLiked {
						Analytics.logEvent("bookmark_tap", parameters: [
							"card_id": cardId as NSString,
							"topic_id": topicId as NSString,
							"will_bookmark": NSNumber(value: false),
							"screen": "home" as NSString
						])
						toggleBookmark(current: true)
					}
					
					if isAdmin {
						showAdminConsole = true
						showReportMenu   = false
					} else {
						showReportMenu   = true
						showAdminConsole = false
					}
				} else {
					isDisliked = false
					showReportMenu = false
					showAdminConsole = false
					Analytics.logEvent("dislike_remove", parameters: [
						"card_id": cardId as NSString,
						"topic_id": topicId as NSString,
						"screen": "home" as NSString
					])
					persistDislikeState(isDisliked: false)
				}
			} label: {
				Image(systemName: isDisliked ? "hand.thumbsdown.fill" : "hand.thumbsdown")
					.font(.system(size: imgSize))
					.foregroundColor(.white)
					.frame(width: size, height: size)
			}
			.sheet(isPresented: $showReportMenu) {
				ReportMenu(
					isPresented: $showReportMenu,
					cardId: cardId,
					onHeightChange: { frac in
						self.reportDetentFraction = frac
					}
				)
				.presentationDetents(dynReportDetents(reportDetentFraction))
			}
			.sheet(isPresented: $showAdminConsole) {
				AdminConsole(
					isPresented: $showAdminConsole,
					cardId: cardId,
					card: card
				)
				.presentationDetents([.large])
			}
			
			Divider()
				.frame(width: 1, height: size * 0.60)
				.background(Color.white.opacity(0.35))
				.padding(.vertical, size * 0.05)
			
			Button {
				UIImpactFeedbackGenerator(style: .light).impactOccurred()
				Analytics.logEvent("share_tap", parameters: [
					"card_id": cardId as NSString,
					"topic_id": topicId as NSString,
					"screen": "home" as NSString
				])
				shareContent()
			} label: {
				Image(systemName: "arrowshape.turn.up.forward.fill")
					.font(.system(size: imgSize))
					.foregroundColor(.white)
					.frame(width: size, height: size)
			}
		}
		.frame(height: size)
		.background(
			Color.black.opacity(colorScheme == .light ? 0.30 : 0.50),
			in: Capsule()
		)
		.overlay(
			Capsule()
				.stroke(Color.white.opacity(0.35), lineWidth: 0.6)
		)
		.clipShape(Capsule())
		.animation(.easeInOut(duration: 0.18), value: homeViewModel.bookmarkStatuses[cardId] ?? isBookmarked)
		.onAppear {
			loadDislikeStateIfNeeded()
		}
	}
	
	private func dynDetents(for srcs: [Source]) -> Set<PresentationDetent> {
		let screenH: CGFloat = UIScreen.main.bounds.height
		let rowH   : CGFloat = 80
		let chrome : CGFloat = 24 + 100
		let needed : CGFloat = CGFloat(srcs.count) * rowH + chrome
		let fraction = max(0.30, min(0.82, needed / screenH))
		return [.fraction(fraction), .large]
	}
	
	private func dynReportDetents(_ fraction: CGFloat?) -> Set<PresentationDetent> {
		let f = max(0.30, min(0.82, fraction ?? 0.5))
		return [.fraction(f), .large]
	}
	
	private func openSingleSource(_ src: Source) {
		guard let link = src.url, let url = URL(string: link) else { return }
		safariURL = url
		
		let domain = normalizedDomain(from: url)
		let name   = (src.name ?? domain)
		Analytics.logEvent("source_open", parameters: [
			"card_id": cardId as NSString,
			"source_name": name as NSString,
			"domain": domain as NSString,
			"position": NSNumber(value: 0),
			"screen": "home" as NSString
		])
	}
	
	private func shareContent() {
		let deepLink = "https://links.ponder-app.ai/cards/\(cardId)"
		guard let url = URL(string: deepLink) else { return }
		
		let headlineForShare = primaryShareHeadline
		let currentCardId = cardId
		let currentTopicId = topicId
		let currentCard = card
		
		CardShareThumbnailRenderer.buildPreviewImage(for: currentCard, headline: headlineForShare) { maybeImage in
			let img = maybeImage ?? imageFromHeadline(headline: headlineForShare)
			
			let urlSource = CardShareItemSource(
				headlineImage: img,
				deepLinkURL: url,
				topicName: headlineForShare
			)
			
			let platformImageSource = CardSharePlatformImageSource(
				image: img,
				deepLinkURL: url
			)
			
			let vc = UIActivityViewController(
				activityItems: [urlSource, platformImageSource],
				applicationActivities: nil
			)
			vc.completionWithItemsHandler = { activityType, completed, _, _ in
				if completed {
					let channel = (activityType?.rawValue ?? "unknown")
					Analytics.logEvent("share_complete", parameters: [
						"card_id": currentCardId as NSString,
						"topic_id": currentTopicId as NSString,
						"channel": channel as NSString,
						"screen": "home" as NSString
					])
				}
			}
			
			if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
			   let root  = scene.windows.first?.rootViewController {
				root.present(vc, animated: true)
			}
		}
	}
	
	private func toggleBookmark(current: Bool) {
		if current {
			servicesLocator.bookmarksService.removeBookmark(cardId: cardId) { success in
				if success {
					homeViewModel.bookmarkStatuses[cardId] = false
					isBookmarked = false
					updateBookmarkCache?(cardId, false)
					NotificationCenter.default.post(name: .bookmarksUpdated, object: nil)
					Analytics.logEvent("bookmark_remove", parameters: [
						"card_id": cardId as NSString,
						"topic_id": topicId as NSString,
						"screen": "home" as NSString
					])
				}
			}
		} else {
			servicesLocator.bookmarksService.addBookmark(cardId: cardId, dateAdded: Date()) { success in
				if success {
					homeViewModel.bookmarkStatuses[cardId] = true
					isBookmarked = true
					updateBookmarkCache?(cardId, true)
					NotificationCenter.default.post(name: .bookmarksUpdated, object: nil)
					Analytics.logEvent("bookmark_add", parameters: [
						"card_id": cardId as NSString,
						"topic_id": topicId as NSString,
						"screen": "home" as NSString
					])
					
					let didStartFirstLike = onboarding.tryStart(flow: .firstLike)
					if didStartFirstLike {
						Analytics.logEvent("first_like_nudge_show", parameters: [
							"card_id": cardId as NSString,
							"topic_id": topicId as NSString,
							"screen": "home" as NSString,
							"trigger": "bookmark_add" as NSString
						])
					}
				}
			}
		}
	}
	
	private func loadDislikeStateIfNeeded() {
		guard !didLoadDislikeState else { return }
		didLoadDislikeState = true
		
		guard let uid = Auth.auth().currentUser?.uid else { return }
		db.collection("users")
			.document(uid)
			.collection("cardDislikes")
			.document(cardId)
			.getDocument { snap, _ in
				if let snap, snap.exists {
					self.isDisliked = true
				}
			}
	}
	
	private func persistDislikeState(isDisliked: Bool) {
		guard let uid = Auth.auth().currentUser?.uid else { return }
		let ref = db.collection("users").document(uid).collection("cardDislikes").document(cardId)
		if isDisliked {
			ref.setData([
				"cardId": cardId as NSString,
				"topicId": topicId as NSString,
				"screen": "home" as NSString,
				"createdAt": FieldValue.serverTimestamp(),
				"updatedAt": FieldValue.serverTimestamp()
			], merge: true)
		} else {
			ref.delete()
		}
	}
	
	private func imageFromHeadline(headline: String) -> UIImage {
		let screenWidth  = UIScreen.main.bounds.width
		let imageWidth   = screenWidth * 0.90
		let imageHeight  = imageWidth * 0.70
		
		let size         = CGSize(width: imageWidth, height: imageHeight)
		
		return UIGraphicsImageRenderer(size: size).image { _ in
			UIColor(red: 1, green: 0.995, blue: 0.985, alpha: 1).setFill()
			UIRectFill(CGRect(origin: .zero, size: size))
			
			let style     = NSMutableParagraphStyle()
			style.alignment = .left
			style.lineBreakMode = .byWordWrapping
			let fontSize  = imageWidth * 0.06
			let font      = UIFont(name: "Palatino", size: fontSize) ?? .systemFont(ofSize: fontSize)
			let attrs: [NSAttributedString.Key: Any] = [
				.font           : font,
				.paragraphStyle : style,
				.foregroundColor: UIColor.black
			]
			
			let text = NSAttributedString(string: headline, attributes: attrs)
			let lineHeight = font.lineHeight * 1.1
			let totalTextHeight = lineHeight * 2.0
			let rect = CGRect(
				x: 20,
				y: (size.height - totalTextHeight) / 2,
				width: size.width - 40,
				height: totalTextHeight
			)
			text.draw(in: rect)
		}
	}
	
	private func normalizedDomain(from url: URL) -> String {
		var host = (url.host ?? "").lowercased()
		if host.hasPrefix("www.") { host.removeFirst(4) }
		return host
	}
}

// ─────────── Helpers ───────────

private extension Array where Element == Source {
	func deduplicated() -> [Source] {
		var seen = Set<String>()
		return self.filter { src in
			let key: String = {
				if let urlStr = src.url?.lowercased(),
				   let comp   = URL(string: urlStr) {
					return (comp.host ?? "") + "#" + comp.lastPathComponent
				}
				if let hl = src.headline?.lowercased() { return "h#" + hl }
				if let nm = src.name?.lowercased()     { return "n#" + nm }
				return UUID().uuidString
			}()
			if seen.contains(key) { return false }
			seen.insert(key)
			return true
		}
	}
}

// ─────────── Share widget + headline view (SwiftUI, then snap to UIImage) ───────────
private struct ShareWidgetThumbnailView: View {
	let artwork: UIImage
	let title: String
	let subtitle: String?
	let headline: String
	let hasPlayableMedia: Bool
	let isVideo: Bool
	
	private var artworkAspectRatio: CGFloat {
		let size = artwork.size
		guard size.height > 0 else { return 1 }
		return size.width / size.height
	}
	
	private static func thumbSize(
		for containerSize: CGSize,
		pad: CGFloat,
		aspect: CGFloat
	) -> CGSize {
		let maxContentWidth  = containerSize.width * 0.60
		let maxContentHeight = max(0, containerSize.height - pad * 2)
		let safeAspect = max(aspect, 0.01)
		let idealWidth  = maxContentHeight * safeAspect
		
		if idealWidth <= maxContentWidth {
			return CGSize(width: idealWidth, height: maxContentHeight)
		} else {
			return CGSize(width: maxContentWidth, height: maxContentWidth / safeAspect)
		}
	}
	
	var body: some View {
		GeometryReader { geo in
			let size = geo.size
			let pad: CGFloat = 20
			
			let thumbSize = Self.thumbSize(
				for: size,
				pad: pad,
				aspect: artworkAspectRatio
			)
			let thumbWidth  = thumbSize.width
			let thumbHeight = thumbSize.height
			
			let baseFontSize = min(size.width, 520) * 0.06
			let playIconSize = max(size.height * 0.18, 18)
			
			ZStack {
				Image(uiImage: artwork)
					.resizable()
					.scaledToFill()
					.frame(width: size.width, height: size.height)
					.blur(radius: 70)
					.saturation(1.8)
					.brightness(-0.08)
					.opacity(0.5)
					.clipped()
				
				HStack(spacing: 20) {
					ZStack {
						Image(uiImage: artwork)
							.resizable()
							.scaledToFill()
							.frame(width: thumbWidth, height: thumbHeight)
						
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
					.clipShape(RoundedRectangle(cornerRadius: 20))
					.compositingGroup()
					
					VStack(alignment: .leading, spacing: 2) {
						Text(title)
							.font(.system(size: baseFontSize, weight: .semibold))
							.foregroundColor(.white)
							.multilineTextAlignment(.leading)
							.lineLimit(2)
						
						if let subtitle, !subtitle.isEmpty {
							Text(subtitle)
								.font(.system(size: baseFontSize * 0.66, weight: .regular))
								.foregroundColor(.white.opacity(0.9))
								.multilineTextAlignment(.leading)
								.lineLimit(2)
						}
					}
					
					Spacer(minLength: 0)
				}
				.padding(.all, pad)
			}
			.frame(width: size.width, height: size.height)
		}
	}
}

// Header-only variant: full-bleed image header (for plays / no cover artwork or when header exists)
private struct HeaderImageThumbnailView: View {
	let image: UIImage
	let hasPlayableMedia: Bool
	let isVideo: Bool
	
	var body: some View {
		GeometryReader { geo in
			let size = geo.size
			let playIconSize = size.height * 0.18
			
			ZStack {
				Image(uiImage: image)
					.resizable()
					.scaledToFill()
					.frame(width: size.width, height: size.height)
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
			.frame(width: size.width, height: size.height)
		}
	}
}

// ─────────── Stock / Poll chart share thumbnail views (no blur, full-height chart) ───────────
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
	
	private func parseDate(_ raw: String) -> Date? {
		if let iso = ISO8601DateFormatter().date(from: raw) { return iso }
		let f = DateFormatter()
		f.locale = Locale(identifier: "en_US_POSIX")
		f.timeZone = TimeZone(secondsFromGMT: 0)
		f.dateFormat = "yyyy-MM-dd"
		return f.date(from: raw)
	}
	
	private var dateRangeLabel: String {
		guard
			let firstRaw = points.first?.date,
			let lastRaw  = points.last?.date,
			let first    = parseDate(firstRaw),
			let last     = parseDate(lastRaw)
		else { return "" }
		
		let cal = Calendar.current
		let monthFmt = DateFormatter()
		monthFmt.locale = .init(identifier: "en_US_POSIX")
		monthFmt.dateFormat = "MMM"
		let dayFmt = DateFormatter()
		dayFmt.locale = monthFmt.locale
		dayFmt.dateFormat = "d"
		let yearFmt = DateFormatter()
		yearFmt.locale = monthFmt.locale
		yearFmt.dateFormat = "yyyy"
		
		let m1 = monthFmt.string(from: first)
		let m2 = monthFmt.string(from: last)
		let d1 = dayFmt.string(from: first)
		let d2 = dayFmt.string(from: last)
		let dash = "\u{2013}"
		
		if cal.isDate(first, equalTo: last, toGranularity: .year) {
			if cal.isDate(first, equalTo: last, toGranularity: .month) {
				return "\(m1) \(d1)\(dash)\(d2)"
			} else {
				return "\(m1) \(d1)\(dash)\(m2) \(d2)"
			}
		}
		let y1 = yearFmt.string(from: first)
		let y2 = yearFmt.string(from: last)
		return "\(m1) \(d1) \(y1)\(dash)\(m2) \(d2) \(y2)"
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
						ForEach(points, id: \.date) { p in
							LineMark(
								x: .value("Date", p.date),
								y: .value("Close", p.close)
							)
							.interpolationMethod(.catmullRom)
							.foregroundStyle(changeColor)
						}
					}
					.chartYScale(domain: yRange)
					.chartXAxis(.hidden)
					.chartYAxis {
						AxisMarks(
							position: .trailing,
							values: [yRange.lowerBound, yRange.upperBound]
						) { v in
							AxisGridLine(
								centered: true,
								stroke: StrokeStyle(lineWidth: 0.5)
							)
							.foregroundStyle(
								Color.primary.opacity(scheme == .dark ? 0.30 : 0.20)
							)
							
							AxisValueLabel {
								if let num = v.as(Double.self) {
									Text(String(format: "%.2f", num))
										.font(.caption)
										.foregroundColor(
											Color.primary.opacity(
												scheme == .dark ? 0.85 : 0.65
											)
										)
								}
							}
						}
					}
					.padding(.horizontal, 4)
					
					HStack {
						Text(dateRangeLabel.uppercased())
							.font(.caption2)
							.foregroundColor(.secondary)
						Spacer()
					}
				}
				.padding(20)
			}
			.frame(width: size.width, height: size.height)
		}
	}
}

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
		let f = ISO8601DateFormatter()
		return f
	}()
	
	private var plots: [Plot] {
		let raw: [Plot] = points.compactMap { p in
			guard let ds = p.date,
				  let d  = Self.isoFormatter.date(from: ds + "T00:00:00Z"),
				  let pct = p.pct else { return nil }
			return Plot(date: d, pct: pct)
		}
			.sorted { $0.date < $1.date }
		
		let cal = Calendar.current
		var daily: [Date: [Plot]] = [:]
		for p in raw {
			daily[cal.startOfDay(for: p.date), default: []].append(p)
		}
		let binned: [Plot] = daily.map { (day, arr) in
			let avg = arr.map(\.pct).reduce(0, +) / Double(arr.count)
			return Plot(date: day, pct: avg)
		}
			.sorted { $0.date < $1.date }
		
		let cutoff = cal.date(byAdding: .day, value: -30, to: Date())!
		let recent = binned.filter { $0.date >= cutoff }
		return recent.isEmpty ? binned : recent
	}
	
	private var latest: Double { plots.last?.pct ?? 0 }
	
	private var yRange: ClosedRange<Double> {
		let values = plots.map(\.pct)
		guard let lo = values.min(), let hi = values.max() else { return 0...1 }
		let pad  = (hi - lo) * 0.05
		return max(0, lo - pad) ... min(100, hi + pad)
	}
	
	private var dateRangeLabel: String? {
		guard let first = plots.first?.date,
			  let last  = plots.last?.date else { return nil }
		let fmt = DateFormatter()
		fmt.dateFormat = "MMM dd"
		return "\(fmt.string(from: first).uppercased()) – \(fmt.string(from: last).uppercased())"
	}
	
	private var changeColor: Color {
		guard plots.count > 1,
			  let a = plots.first?.pct,
			  let b = plots.last?.pct else { return .blue }
		return b >= a ? .blue : .red
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
						ForEach(plots) { p in
							LineMark(
								x: .value("Date", p.date),
								y: .value("Pct",  p.pct)
							)
							.interpolationMethod(.catmullRom)
							.foregroundStyle(changeColor)
						}
					}
					.chartYScale(domain: yRange)
					.chartXAxis(.hidden)
					.chartYAxis(.hidden)
					
					HStack {
						if let range = dateRangeLabel {
							Text(range)
								.font(.caption2)
								.foregroundColor(.secondary)
						}
						Spacer()
					}
				}
				.padding(20)
			}
			.frame(width: size.width, height: size.height)
		}
	}
}

// ─────────── Share thumbnail rendering (mini widget card) ───────────
private enum CardShareThumbnailRenderer {
	static func buildPreviewImage(
		for card: Card?,
		headline: String,
		completion: @escaping (UIImage?) -> Void
	) {
		guard let card = card else {
			DispatchQueue.main.async { completion(nil) }
			return
		}
		
		let screenWidth  = UIScreen.main.bounds.width
		let imageWidth   = screenWidth * 0.90
		let imageHeight  = imageWidth * 0.70
		let size         = CGSize(width: imageWidth, height: imageHeight)
		
		let choice = WidgetManager.shareThumbnailChoice(for: card)
		
		switch choice {
		case .stockChart(let metadata):
			let rootView = StockShareThumbnailChartView(
				metadata: metadata,
				headline: headline
			)
			render(rootView: rootView, size: size, completion: completion)
			return
			
		case .politicianPoll(let name, let points):
			let rootView = PoliticianShareThumbnailPollView(
				name: name,
				points: points,
				headline: headline
			)
			render(rootView: rootView, size: size, completion: completion)
			return
			
		case .headerImage(let url):
			let flags = shareWidgetPlayableFlags(for: card)
			loadImage(from: url) { image in
				guard let image else {
					DispatchQueue.main.async { completion(nil) }
					return
				}
				let rootView = HeaderImageThumbnailView(
					image: image,
					hasPlayableMedia: flags.hasPlayable,
					isVideo: flags.isVideo
				)
				render(rootView: rootView, size: size, completion: completion)
			}
			return
			
		case .heroImage(let url):
			let flags = shareWidgetPlayableFlags(for: card)
			loadImage(from: url) { image in
				guard let image else {
					DispatchQueue.main.async { completion(nil) }
					return
				}
				let rootView = HeaderImageThumbnailView(
					image: image,
					hasPlayableMedia: flags.hasPlayable,
					isVideo: flags.isVideo
				)
				render(rootView: rootView, size: size, completion: completion)
			}
			return
			
		case .artwork:
			loadArtwork(for: card) { artwork in
				guard let artwork = artwork else {
					DispatchQueue.main.async { completion(nil) }
					return
				}
				
				let text = shareWidgetContent(for: card, fallbackHeadline: headline)
				guard !text.title.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines).isEmpty else {
					DispatchQueue.main.async { completion(nil) }
					return
				}
				
				let flags = shareWidgetPlayableFlags(for: card)
				
				let rootView = ShareWidgetThumbnailView(
					artwork: artwork,
					title: text.title,
					subtitle: text.subtitle,
					headline: headline,
					hasPlayableMedia: flags.hasPlayable,
					isVideo: flags.isVideo
				)
				
				render(rootView: rootView, size: size, completion: completion)
			}
			return
			
		case .none:
			DispatchQueue.main.async { completion(nil) }
			return
		}
	}
	
	private static func render<Root: View>(
		rootView: Root,
		size: CGSize,
		completion: @escaping (UIImage?) -> Void
	) {
		let hosting = UIHostingController(rootView: AnyView(rootView.ignoresSafeArea()))
		hosting.view.bounds = CGRect(origin: .zero, size: size)
		hosting.view.backgroundColor = .clear
		if #available(iOS 13.0, *) {
			hosting.overrideUserInterfaceStyle = .light
		}
		hosting.view.layoutIfNeeded()
		
		let renderer = UIGraphicsImageRenderer(size: size)
		let image = renderer.image { _ in
			hosting.view.drawHierarchy(in: hosting.view.bounds, afterScreenUpdates: true)
		}
		
		DispatchQueue.main.async {
			completion(image)
		}
	}
	
	private static func loadArtwork(for card: Card, completion: @escaping (UIImage?) -> Void) {
		let urls = card.shareArtworkURLs()
		guard !urls.isEmpty else {
			DispatchQueue.main.async { completion(nil) }
			return
		}
		
		func attempt(_ idx: Int) {
			if idx >= urls.count {
				DispatchQueue.main.async { completion(nil) }
				return
			}
			loadImage(from: urls[idx]) { img in
				if let img = img {
					completion(img)
				} else {
					attempt(idx + 1)
				}
			}
		}
		
		attempt(0)
	}
	
	private static func loadImage(from url: URL, completion: @escaping (UIImage?) -> Void) {
		if url.isFileURL {
			DispatchQueue.global(qos: .userInitiated).async {
				let data = try? Data(contentsOf: url)
				let image = data.flatMap(UIImage.init)
				DispatchQueue.main.async {
					completion(image)
				}
			}
		} else {
			URLSession.shared.dataTask(with: url) { data, _, _ in
				let image = data.flatMap(UIImage.init)
				DispatchQueue.main.async {
					completion(image)
				}
			}.resume()
		}
	}
	
	private static func shareWidgetContent(for card: Card, fallbackHeadline: String) -> (title: String, subtitle: String?) {
		guard let enriched = card.enrichedMetadata else {
			let t = (fallbackHeadline.isEmpty ? (card.headline ?? "") : fallbackHeadline)
			return (t, card.domainName)
		}
		
		if let music = enriched.musicMetadata {
			let rawTitle = (music.song ?? music.album ?? card.headline ?? "").trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
			let rawArtist = music.artist?.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines) ?? ""
			let title = rawTitle.isEmpty ? (card.headline ?? fallbackHeadline) : rawTitle
			let subtitle = rawArtist.isEmpty ? nil : rawArtist
			return (title, subtitle)
		}
		
		if let book = enriched.bookMetadata,
		   let cover = book.cover,
		   !cover.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines).isEmpty {
			let rawTitle = (book.title ?? card.headline ?? "").trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
			let title = rawTitle.isEmpty ? (card.headline ?? fallbackHeadline) : rawTitle
			let subtitle: String? = {
				guard let authors = book.authors, !authors.isEmpty else { return nil }
				let joined = authors.joined(separator: ", ").trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
				return joined.isEmpty ? nil : joined
			}()
			return (title, subtitle)
		}
		
		if let film = enriched.filmTvMetadata {
			var title = (film.title ?? card.headline ?? "").trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
			if title.isEmpty { title = card.headline ?? fallbackHeadline }
			title = title.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
			
			var bits: [String] = []
			if let director = film.director?.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines),
			   !director.isEmpty {
				bits.append(director)
			}
			if let year = film.year?.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines),
			   !year.isEmpty {
				bits.append(year)
			}
			let subtitle = bits.isEmpty ? nil : bits.joined(separator: " • ")
			return (title, subtitle)
		}
		
		if let team = enriched.teamMetadata {
			let nameParts = [team.city, team.team]
				.compactMap { $0?.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines) }
				.filter { !$0.isEmpty }
			let baseName = nameParts.isEmpty ? (team.team ?? "") : nameParts.joined(separator: " ")
			let title = baseName.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
			let subtitle = [team.division, team.league]
				.compactMap { $0?.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines) }
				.filter { !$0.isEmpty }
				.joined(separator: " • ")
			return (title.isEmpty ? (card.headline ?? fallbackHeadline) : title,
					subtitle.isEmpty ? nil : subtitle)
		}
		
		if let pol = enriched.politicianMetadata {
			let name = (pol.name ?? "").trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
			let subtitleBits = [pol.locale, pol.party]
				.compactMap { $0?.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines) }
				.filter { !$0.isEmpty }
			let subtitle = subtitleBits.isEmpty ? nil : subtitleBits.joined(separator: " • ")
			let title = name.isEmpty ? (card.headline ?? fallbackHeadline) : name
			return (title, subtitle)
		}
		
		if let sm = enriched.stockMetadata {
			let name = (sm.companyName?.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : $0 }
			?? (sm.ticker?.uppercased() ?? "")
			let trimmedName = name.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
			let subtitle = sm.companyIndustry?.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
			return (trimmedName.isEmpty ? (card.headline ?? fallbackHeadline) : trimmedName,
					(subtitle?.isEmpty == false ? subtitle : nil))
		}
		
		let fallbackTitle = (card.headline ?? fallbackHeadline)
		return (fallbackTitle, card.domainName)
	}
	
	private static func shareWidgetPlayableFlags(for card: Card) -> (hasPlayable: Bool, isVideo: Bool) {
		guard let enriched = card.enrichedMetadata else {
			return (false, false)
		}
		
		if let music = enriched.musicMetadata {
			if music.videoURL != nil {
				return (true, true)
			}
			if music.previewURL != nil {
				return (true, false)
			}
		}
		
		if let film = enriched.filmTvMetadata {
			if let trailer = film.trailerURL?.trimmingCharacters(in: .whitespacesAndNewlines),
			   !trailer.isEmpty {
				return (true, true)
			}
		}
		
		return (false, false)
	}
}
