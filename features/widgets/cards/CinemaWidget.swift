import SwiftUI
import UIKit
import SDWebImageSwiftUI
import FirebaseAnalytics
import Combine

struct CinemaWidget: View {
	let enrichedMetadata: EnrichedMetadata?
	let cardId          : String?
	let height          : CGFloat?
	
	@State private var showInlinePlayer = false
	@State private var pendingAutoCloseToken: UUID?
	
	@ObservedObject private var featureFlags = FeatureFlagsManager.shared
	
	init(enrichedMetadata: EnrichedMetadata?,
		 cardId: String? = nil,
		 height: CGFloat? = nil) {
		self.enrichedMetadata = enrichedMetadata
		self.cardId           = cardId
		self.height           = height
	}
	
	var body: some View {
		if let film = enrichedMetadata?.filmTvMetadata {
			content(for: film)
				.id(cardId)
				.overlay(InteractiveFrameReader())
				.onReceive(NotificationCenter.default.publisher(for: .stopInlineVideoForCard)) { notif in
					guard showInlinePlayer,
						  let cid = cardId,
						  let target = notif.userInfo?["cardID"] as? String,
						  target == cid else { return }
					
					let deferMs = (notif.userInfo?["defer_ui_close_ms"] as? Int) ?? 0
					let trigger = (notif.userInfo?["trigger"] as? String) ?? "card_change"
					
					if deferMs > 0 {
						let token = UUID()
						pendingAutoCloseToken = token
						DispatchQueue.main.asyncAfter(deadline: .now() + Double(deferMs) / 1000.0 + 0.02) {
							guard pendingAutoCloseToken == token else { return }
							guard showInlinePlayer else { return }
							
							Analytics.logEvent("cinema_trailer_inline_auto_close", parameters: [
								"screen": "home" as NSString,
								"card_id": cid as NSString,
								"trigger": trigger as NSString,
								"defer_ui_close_ms": NSNumber(value: deferMs)
							])
							
							showInlinePlayer = false
							pendingAutoCloseToken = nil
						}
					} else {
						pendingAutoCloseToken = nil
						Analytics.logEvent("cinema_trailer_inline_auto_close", parameters: [
							"screen": "home" as NSString,
							"card_id": cid as NSString,
							"trigger": trigger as NSString
						])
						showInlinePlayer = false
					}
				}
				.onReceive(NotificationCenter.default.publisher(for: .autoPlayMediaForCard)) { notif in
					guard featureFlags.isAutoplayEnabled else { return }
					guard let cid = cardId else { return }
					guard let target = notif.userInfo?["cardID"] as? String, target == cid else { return }
					let attempt = (notif.userInfo?["attempt"] as? Int) ?? 1
					
					pendingAutoCloseToken = nil
					
					Analytics.logEvent("cinema_autoplay_signal_received", parameters: [
						"screen": "home" as NSString,
						"card_id": cid as NSString,
						"attempt": NSNumber(value: attempt)
					])
					
					guard film.trailerURL?.isEmpty == false else { return }
					guard !showInlinePlayer else { return }
					
					TextToSpeechService.shared.pauseQueue()
					
					Analytics.logEvent("cinema_trailer_inline_open", parameters: [
						"screen": "home" as NSString,
						"card_id": cid as NSString,
						"trigger": "autoplay_media" as NSString
					])
					
					showInlinePlayer = true
				}
		}
	}
	
	@ViewBuilder
	private func content(for film: FilmTvMetadata) -> some View {
		let imdbURL = film.imdbURL ??
		film.imdbID.flatMap { URL(string: "https://www.imdb.com/title/\($0)/") }
		
		let imdbRating = film.imdbRating?.trimmedValid
		let rtRating   = film.ratings?
			.first { ($0.source ?? "")
				.caseInsensitiveCompare("Rotten Tomatoes") == .orderedSame }?
			.value?
			.trimmedValid
		
		let trailer = film.trailerURL.flatMap { URL(string: $0) }
		let posterURL = film.poster.flatMap { URL(string: $0) }
		let videoPosterURL = film.videoPosterURL
		
		if let trailer, showInlinePlayer {
			InlineVideoPlayer(
				url: trailer,
				height: height,
				autoPlay: true,
				forceMutedOnAutoplay: false,
				analyticsPlayEvent: "cinema_trailer_play",
				analyticsEndEvent:  "cinema_trailer_end",
				cardId: cardId,
				baseAnalyticsParams: ["screen": "home", "widget_type": "cinema"],
				nowPlaying: NowPlayingMetadata(
					title: film.displayTitle,
					subtitle: film.displaySubtitle.isEmpty ? nil : film.displaySubtitle,
					artworkURL: posterURL
				),
				onPlay: { },
				onEnd:  { },
				onClose: {
					pendingAutoCloseToken = nil
					showInlinePlayer = false
				}
			)
		} else {
			let preview = CinemaPreview(
				title        : film.displayTitle,
				year         : film.displaySubtitle,
				imdbID       : film.imdbID,
				posterURL    : posterURL,
				externalURL  : imdbURL,
				trailerURL   : trailer,
				style        : .bar,
				height       : height,
				imdbRating   : imdbRating,
				rtRating     : rtRating,
				backgroundURL: videoPosterURL ?? posterURL,
				onPlayInline : trailer == nil ? nil : { trigger in
					TextToSpeechService.shared.pauseQueue()
					var params: [String: Any] = [
						"screen": "home" as NSString,
						"trigger": trigger as NSString
					]
					if let cid = cardId { params["card_id"] = cid as NSString }
					Analytics.logEvent("cinema_trailer_inline_open", parameters: params)
					pendingAutoCloseToken = nil
					showInlinePlayer = true
				}
			)
				.frame(maxWidth: .infinity)
			
			let face = ZStack {
				if let _ = trailer, let faceURL = videoPosterURL {
					posterFace(url: faceURL)
				} else {
					preview
				}
				
				VStack {
					Spacer(minLength: 0)
					OpenInPill(cardId: cardId, options: film.openInOptions())
						.padding(.trailing, 20)
						.padding(.bottom, 20)
						.frame(maxWidth: .infinity, alignment: .trailing)
				}
			}
			
			if let h = height {
				face.frame(height: h)
			} else {
				face
			}
		}
	}
	
	private func posterFace(url: URL) -> some View {
		GeometryReader { geo in
			WebImage(url: url)
				.resizable()
				.scaledToFill()
				.frame(width: geo.size.width, height: geo.size.height)
				.clipped()
				.contentShape(Rectangle())
				.overlay(playGlyph, alignment: .center)
				.onTapGesture {
					TextToSpeechService.shared.pauseQueue()
					var params: [String: Any] = [
						"screen": "home" as NSString,
						"trigger": "poster_tap" as NSString
					]
					if let cid = cardId { params["card_id"] = cid as NSString }
					Analytics.logEvent("cinema_poster_tap", parameters: params)
					Analytics.logEvent("cinema_trailer_inline_open", parameters: params)
					pendingAutoCloseToken = nil
					showInlinePlayer = true
				}
				.accessibilityAddTraits(.isButton)
		}
	}
	
	private var playGlyph: some View {
		Image(systemName: "play.fill")
			.resizable()
			.scaledToFit()
			.frame(width: 30, height: 30)
			.foregroundColor(.white)
			.shadow(radius: 4)
	}
}

// ─────────── Helpers ───────────
private extension String {
	var isNonValue: Bool {
		let lo = trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
		return lo.isEmpty || lo == "n/a" || lo == "na" || lo == "none"
	}
	var trimmedValid: String? {
		let t = trimmingCharacters(in: .whitespacesAndNewlines)
		return t.isNonValue ? nil : t
	}
}

private extension FilmTvMetadata {
	var displayTitle: String { title ?? "" }
	
	private var cleanYear: String {
		if let y = year, !y.isNonValue { return y }
		if let dateStr = released,
		   let y = dateStr.split(separator: "-").first,
		   !String(y).isNonValue { return String(y) }
		return ""
	}
	
	private var cleanDirector: String {
		(director ?? "")
			.trimmingCharacters(in: .whitespacesAndNewlines)
			.isNonValue ? "" : (director ?? "")
			.trimmingCharacters(in: .whitespacesAndNewlines)
	}
	
	private var cleanWriter: String {
		let first = (writer ?? "")
			.components(separatedBy: ",")
			.first?
			.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		return first.isNonValue ? "" : first
	}
	
	var displaySubtitle: String {
		let primary = cleanDirector.isEmpty ? cleanWriter : cleanDirector
		switch (primary.isEmpty, cleanYear.isEmpty) {
		case (false, false): return "\(primary) • \(cleanYear)"
		case (false, true):  return primary
		case (true, false):  return cleanYear
		default:             return ""
		}
	}
}

// ─────────── CinemaPreview ───────────
struct CinemaPreview: View {
	enum Style { case bubble, bar }
	
	let title       : String
	let year        : String
	let imdbID      : String?
	let posterURL   : URL?
	let externalURL : URL?
	let style       : Style
	let height      : CGFloat?
	let imdbRating  : String?
	let rtRating    : String?
	let backgroundURL: URL?
	
	private static let bubbleHeight: CGFloat = 200
	
	@State private var trailerURL : URL?
	@State private var showPlayer = false
	@State private var isTapAnimating = false
	@State private var hapticGenerator: UIImpactFeedbackGenerator?
	@Environment(\.openURL) private var openURL
	
	let onPlayInline: ((String) -> Void)?
	
	init(title: String,
		 year: String,
		 imdbID: String? = nil,
		 posterURL: URL?,
		 externalURL: URL? = nil,
		 trailerURL: URL? = nil,
		 style: Style,
		 height: CGFloat? = nil,
		 imdbRating: String? = nil,
		 rtRating: String? = nil,
		 backgroundURL: URL? = nil,
		 onPlayInline: ((String) -> Void)? = nil) {
		self.title        = title
		self.year         = year
		self.imdbID       = imdbID
		self.posterURL    = posterURL
		self.externalURL  = externalURL
		self.style        = style
		self.height       = height
		self.imdbRating   = imdbRating
		self.rtRating     = rtRating
		self.backgroundURL = backgroundURL
		self.onPlayInline = onPlayInline
		_trailerURL       = State(initialValue: trailerURL)
	}
	
	var body: some View {
		let fixedHeight = height ?? (style == .bubble ? Self.bubbleHeight : nil)
		
		GeometryReader { geo in
			let C      = constants(for: geo.size.height)
			let radius = 20.0
			let shape  : AnyShape = style == .bubble
			? AnyShape(RoundedRectangle(cornerRadius: radius))
			: AnyShape(RoundedCorner(radius: radius, corners: [.topLeft, .topRight]))
			
			HStack(spacing: 20) {
				ZStack {
					WebImage(url: posterURL)
						.resizable()
						.scaledToFill()
						.frame(width: C.posterW, height: C.posterH)
						.clipShape(RoundedRectangle(cornerRadius: 20))
						.scaleEffect(isTapAnimating ? 0.965 : 1.0)
						.contentShape(Rectangle())
						.gesture(
							DragGesture(minimumDistance: 0)
								.onChanged { _ in
									guard (onPlayInline != nil) || (trailerURL != nil) else { return }
									if !isTapAnimating {
										hapticGenerator = UIImpactFeedbackGenerator(style: .light)
										hapticGenerator?.prepare()
										withAnimation(.spring(response: 0.18, dampingFraction: 0.7)) {
											isTapAnimating = true
										}
									}
								}
								.onEnded { _ in
									guard (onPlayInline != nil) || (trailerURL != nil) else {
										withAnimation(.spring(response: 0.28, dampingFraction: 0.7)) {
											isTapAnimating = false
										}
										return
									}
									hapticGenerator?.impactOccurred(intensity: 0.7)
									withAnimation(.spring(response: 0.28, dampingFraction: 0.7)) {
										isTapAnimating = false
									}
									DispatchQueue.main.asyncAfter(deadline: .now() + 0.04) {
										Analytics.logEvent("cinema_poster_tap", parameters: [
											"screen": "curator" as NSString,
											"trigger": "tap" as NSString
										])
										if let onPlayInline {
											onPlayInline("trailer_button")
										} else {
											TextToSpeechService.shared.pauseQueue()
											showPlayer = true
										}
									}
								}
						)
						.accessibilityAddTraits(((onPlayInline != nil) || (trailerURL != nil)) ? .isButton : [])
					
					if trailerURL != nil || onPlayInline != nil {
						Image(systemName: "film.fill")
							.resizable()
							.scaledToFit()
							.frame(width: C.icon, height: C.icon)
							.foregroundColor(.white)
							.shadow(radius: 3)
							.opacity(0.95)
							.allowsHitTesting(false)
					}
				}
				
				VStack(alignment: .leading, spacing: 2) {
					Text(title)
						.font(.headline)
						.foregroundColor(.white)
						.lineLimit(2)
					
					Text(year)
						.font(.subheadline)
						.foregroundColor(.white.opacity(0.85))
						.lineLimit(2)
					
					if imdbRating != nil || rtRating != nil {
						ratingsRow
							.padding(.top, 4)
					}
				}
				
				Spacer(minLength: 0)
			}
			.padding(.all, C.pad)
			.frame(maxWidth: .infinity, maxHeight: .infinity)
			.background { ArtworkWave(url: backgroundURL ?? posterURL, shape: shape) }
			.clipShape(shape)
			.overlay(shape.stroke(Color.white.opacity(0.6), lineWidth: 0.5))
			.overlay(InteractiveFrameReader().allowsHitTesting(false))
		}
		.frame(height: fixedHeight)
		.transaction { $0.disablesAnimations = true }
		.fullScreenCover(
			isPresented: $showPlayer,
			onDismiss: { TextToSpeechService.shared.resumeQueue() }
		) {
			if let url = trailerURL {
				TrailerPlayerSheet(url: url)
			}
		}
	}
	
	@ViewBuilder
	private var ratingsRow: some View {
		HStack(spacing: 8) {
			if let imdb = imdbRating {
				HStack(spacing: 6) {
					Image("IMDb-Logo")
						.resizable()
						.aspectRatio(contentMode: .fit)
						.frame(height: 18)
					Text(imdb)
						.font(.caption)
						.foregroundColor(.white.opacity(0.9))
				}
			}
			
			if let rt = rtRating {
				HStack(spacing: 6) {
					Image("RottenTomatoes-Logo")
						.resizable()
						.aspectRatio(contentMode: .fit)
						.frame(height: 18)
					Text(rt)
						.font(.caption)
						.foregroundColor(.white.opacity(0.9))
				}
			}
		}
	}
	
	private func constants(for h: CGFloat)
	-> (posterW: CGFloat, posterH: CGFloat, pad: CGFloat, icon: CGFloat) {
		switch style {
		case .bubble:
			let pad: CGFloat = 20
			let posterH      = max(0, h - pad * 2)
			return (posterH * 2 / 3, posterH, pad, 22)
		case .bar:
			let pad: CGFloat = 20
			let posterH      = max(0, h - pad * 2)
			return (posterH * 2 / 3, posterH, pad, max(h * 0.12, 18))
		}
	}
}

// ─────────── Section Header ───────────
// Restores the convenience ID extractor CuratorView uses.
extension Movie {
	var imdbID: String? {
		if let direct = Mirror(reflecting: self).children
			.first(where: { ["imdbID","imdbId","imdb_id","id"].contains($0.label ?? "") })
			.flatMap({ $0.value as? String }),
		   direct.hasPrefix("tt") {
			return direct
		}
		for child in Mirror(reflecting: self).children {
			if let str = child.value as? String,
			   let range = str.range(of: #"tt\d{6,}"#, options: .regularExpression) {
				return String(str[range])
			}
		}
		return nil
	}
}
